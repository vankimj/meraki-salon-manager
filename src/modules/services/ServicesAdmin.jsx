import { useState, useEffect, useRef } from 'react';
import Button from '../../components/Button';
import { fetchServices, createService, saveService, deleteService, servicesExist, clearServices } from '../../lib/firestore';
import { groupByCategory, formatPrice, formatDuration, validateService, blankService } from '../../utils/serviceHelpers';
import TrashButton from '../../components/TrashButton';
import { SEED_SERVICES, CATEGORY_ORDER } from '../../data/seedServices';
import { logActivity } from '../../lib/logger';
import EmptyState from '../../components/EmptyState';
import CoachMark from '../../components/CoachMark';
import { resizeImg } from '../../utils/helpers';
import { useApp } from '../../context/AppContext';
import { resolveVertical } from '../../data/verticals';
import { fetchOnboarding } from '../../lib/onboarding';

export default function ServicesAdmin() {
  const { isTech, showToast, settings } = useApp();
  const [services,   setServices]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [editing,    setEditing]    = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [errors,     setErrors]     = useState({});
  const [undoStack,  setUndoStack]  = useState([]);
  const [redoStack,  setRedoStack]  = useState([]);
  const undoRef = useRef([]);

  function syncUndo(next) { undoRef.current = next; setUndoStack(next); }

  function commitDelete(svc) {
    deleteService(svc.id).catch(() => {});
    logActivity('service_deleted', svc.name);
  }

  useEffect(() => {
    return () => { undoRef.current.forEach(commitDelete); };
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      let svcs = await fetchServices();
      if (!svcs.length && await shouldAutoSeedNailMenu()) {
        await seedAll();
        svcs = await fetchServices();
      }
      setServices(svcs);
    } catch (e) {
      console.error('[ServicesAdmin] load failed:', e);
    } finally {
      setLoading(false);
    }
  }

  // The legacy nail starter menu must seed ONLY for nail / legacy tenants. A
  // vertical that brings its own service template (e.g. personal training) must
  // never get it. The onboarding wizard writes settings.vertical server-side
  // without refreshing in-memory state, so when the in-memory value is absent we
  // re-read the onboarding industry fresh to avoid the stale-undefined window.
  // resolveVertical(...).serviceTemplateId === 'nail-salon' covers nails + every
  // not-yet-registered industry (hair/both/other), keeping their behavior intact.
  async function shouldAutoSeedNailMenu() {
    const isNailSeed = (key) => resolveVertical(key).serviceTemplateId === 'nail-salon';
    if (settings?.vertical) return isNailSeed(settings.vertical);
    try {
      return isNailSeed((await fetchOnboarding())?.industry);
    } catch {
      return true;
    }
  }

  async function seedAll() {
    const exists = await servicesExist();
    if (exists) return;
    for (const [i, svc] of SEED_SERVICES.entries()) {
      await createService({ ...svc, sortOrder: i });
    }
    logActivity('services_seeded', `${SEED_SERVICES.length} services`);
  }

  async function handleReseed() {
    if (!confirm(`Replace all ${services.length} services with the Meraki Nail Studio defaults? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await clearServices();
      for (const [i, svc] of SEED_SERVICES.entries()) {
        await createService({ ...svc, sortOrder: i });
      }
      logActivity('services_reseeded', `${SEED_SERVICES.length} services`);
      const svcs = await fetchServices();
      setServices(svcs);
    } catch (e) {
      console.error('[ServicesAdmin] reseed failed:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    const { valid, errors: errs } = validateService(editing);
    if (!valid) { setErrors(errs); return; }
    setErrors({});
    setSaving(true);
    try {
      const { id, ...data } = editing;
      if (id) {
        await saveService(id, data);
        logActivity('service_updated', editing.name);
      } else {
        await createService(data);
        logActivity('service_added', editing.name);
      }
      await load();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(svc) {
    if (!confirm(`Delete "${svc.name}"?`)) return;
    setServices(s => s.filter(x => x.id !== svc.id));
    setRedoStack([]);
    const next = [svc, ...undoRef.current];
    if (next.length > 2) { commitDelete(next[next.length - 1]); }
    syncUndo(next.slice(0, 2));
    showToast(`Deleted "${svc.name}" — use Undo above to revert`);
  }

  function handleUndo() {
    const [item, ...rest] = undoRef.current;
    if (!item) return;
    setServices(s => [...s, item].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
    setRedoStack(r => [item, ...r]);
    syncUndo(rest);
  }

  function handleRedo() {
    setRedoStack(prev => {
      const [item, ...rest] = prev;
      if (!item) return prev;
      setServices(s => s.filter(x => x.id !== item.id));
      const next = [item, ...undoRef.current];
      if (next.length > 2) { commitDelete(next[next.length - 1]); }
      syncUndo(next.slice(0, 2));
      return rest;
    });
  }

  async function toggleActive(svc) {
    await saveService(svc.id, { active: !svc.active });
    setServices(s => s.map(x => x.id === svc.id ? { ...x, active: !x.active } : x));
  }

  // Canonical Meraki option templates per service name. Keys are case-insensitive,
  // hyphen-flexible. Each option has an absolute price + duration (overrides base).
  // Sourced verbatim from merakinailstudio.glossgenius.com — keep this map as the
  // single source of truth and re-run 'Apply Meraki options' after edits.
  const SUGGESTED = {
    'gel x': [
      { name: 'Gel X Only',                       price: 70, duration: 60 },
      { name: 'Gel X With Removal',               price: 80, duration: 75 },
      { name: 'Gel X + Mani',                     price: 80, duration: 70 },
      { name: 'Gel X + Removal + Mani',           price: 90, duration: 80 },
    ],
    'structured gel manicure': [
      { name: 'Structure Gel Mani',               price: 50, duration: 60 },
      { name: 'Structure Gel Mani + Removal',     price: 60, duration: 75 },  // price inferred — verify
    ],
    'gel manicure': [
      { name: 'Gel Manicure',                     price: 40, duration: 35 },
      { name: 'Gel Manicure With Removal',        price: 40, duration: 40 },
    ],
    'dip': [
      { name: 'Dip only',                         price: 50, duration: 45 },
      { name: 'Dip + Removal',                    price: 50, duration: 55 },
      { name: 'Dip Mani',                         price: 60, duration: 50 },
      { name: 'Dip Removal + Manicure',           price: 60, duration: 60 },
      { name: 'Dip Extensions',                   price: 60, duration: 60 },
      { name: 'Dip Extension + Removal',          price: 60, duration: 70 },
      { name: 'Dip Extension + Manicure',         price: 70, duration: 70, priceFrom: true },
      { name: 'Dip Extension + Removal + Mani',   price: 70, duration: 80 },
      { name: 'Dip Removal',                      price: 15, duration: 10 },
    ],
    'signature manicure': [
      { name: 'Regular Polish',                   price: 32, duration: 35 },
      { name: 'With Gel Polish',                  price: 52, duration: 45 },  // price inferred — verify
    ],
    'deluxe manicure': [
      { name: 'Regular Polish',                   price: 40, duration: 40 },
      { name: 'With Gel Polish',                  price: 60, duration: 45 },
    ],
    'spa pedicure': [
      { name: 'Regular Polish',                   price: 40, duration: 35 },
      { name: 'With Gel Polish',                  price: 60, duration: 45 },
    ],
    'signature pedicure': [
      { name: 'Regular Polish',                   price: 52, duration: 45 },
      { name: 'Gel Polish',                       price: 72, duration: 60 },  // price inferred — verify
    ],
    'deluxe pedicure': [
      { name: 'Regular Polish',                   price: 65, duration: 60 },
      { name: 'With Gel Polish',                  price: 85, duration: 70 },
    ],
    'nail repair': [
      { name: 'Gel Polish Repair',                price:  5, duration: 15 },
      { name: 'Dip Nail Repair',                  price:  5, duration: 15 },
      { name: 'Gel X Nail Repair',                price:  7, duration: 20 },
      { name: 'Structured Gel Repair',            price:  7, duration: 20 },
    ],
    'nail art': [
      { name: 'Nail Art (price varies)',          price:  5, duration: 25, priceFrom: true },
      { name: 'French Tips',                      price: 15, duration: 25, priceFrom: true },
      { name: 'Chrome',                           price: 15, duration: 10 },
      { name: 'Cat Eye',                          price: 15, duration: 10 },
      { name: 'Rhine Stones (price varies)',      price:  5, duration: 10, priceFrom: true },
      { name: '3D Flowers / Bows (price varies)', price:  5, duration: 10, priceFrom: true },
      { name: 'Glitter Ombré',                    price: 15, duration: 10 },
      { name: 'Air Brush',                        price: 25, duration: 10, priceFrom: true },
      { name: 'Ombre',                            price: 15, duration: 10 },
    ],
    'removal': [
      { name: 'Acrylic',                          price: 20, duration: 20 },
      { name: 'Gel X',                            price: 20, duration: 20 },
      { name: 'Dip',                              price: 15, duration: 20 },
      { name: 'Gel Removal',                      price: 10, duration: 20 },
      { name: 'Structured Gel Removal',           price: 15, duration: 20 },
      { name: 'Polygel / Hard gel Removal',       price: 20, duration: 25 },  // price inferred — verify
    ],
  };

  function normalizeKey(s) {
    return (s || '').toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function optionsMatchTemplate(existing, tpl) {
    if (!Array.isArray(existing) || existing.length !== tpl.length) return false;
    return tpl.every((opt, i) => {
      const cur = existing[i] || {};
      return cur.name === opt.name
        && (cur.price ?? null) === (opt.price ?? null)
        && (cur.duration ?? null) === (opt.duration ?? null)
        && !!cur.priceFrom === !!opt.priceFrom;
    });
  }

  async function applySuggestedOptions() {
    // Anything in SUGGESTED whose stored options don't match (missing or stale).
    const targets = services.filter(s => {
      const tpl = SUGGESTED[normalizeKey(s.name)];
      if (!tpl) return false;
      return !optionsMatchTemplate(s.options, tpl);
    });
    if (targets.length === 0) {
      showToast('All matched services are already up to date.');
      return;
    }
    const summary = targets.map(s => {
      const tpl = SUGGESTED[normalizeKey(s.name)];
      const had = (s.options || []).length;
      return `• ${s.name} — ${had ? `replacing ${had} options with ${tpl.length}` : `adding ${tpl.length} options`}`;
    }).join('\n');
    if (!confirm(`Apply Meraki canonical options to ${targets.length} service${targets.length === 1 ? '' : 's'}?\n\n${summary}\n\nExisting options on these services will be replaced.`)) return;
    try {
      for (const svc of targets) {
        const tpl = SUGGESTED[normalizeKey(svc.name)];
        const opts = tpl.map((o, i) => ({ id: `opt_${svc.id}_${i}`, ...o }));
        await saveService(svc.id, { options: opts });
      }
      const fresh = await fetchServices();
      setServices(fresh);
      showToast(`Updated ${targets.length} service${targets.length === 1 ? '' : 's'}`);
    } catch (e) {
      showToast('Failed: ' + (e.message || 'unknown'), 4000);
    }
  }

  const groups = groupByCategory(services);
  const activeCount = services.filter(s => s.active !== false).length;

  if (loading) return <Empty>Loading services…</Empty>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        {!isTech && (
          <button onClick={handleReseed} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
            ↺ Reset to defaults
          </button>
        )}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>{services.length} total · {activeCount} active</span>
          {undoStack.length > 0 && <Btn onClick={handleUndo}>↩ Undo</Btn>}
          {redoStack.length > 0 && <Btn onClick={handleRedo}>↪ Redo</Btn>}
          <TrashButton collections={['services']} scope="Services" />
          {!isTech && <Btn color="#3D95CE" onClick={() => { setEditing(blankService()); setErrors({}); }}>+ Add Service</Btn>}
        </div>
      </div>

      {groups.length === 0 && (
        <EmptyState
          icon="✂️"
          title="Set up your service menu"
          description="Add the services you offer (manicures, pedicures, lashes, etc.) with their durations and prices. Clients see this list when booking online, and the schedule auto-blocks time based on the service duration."
          actions={!isTech ? [{ label: '+ Add a service', onClick: () => { setEditing(blankService()); setErrors({}); } }] : []}
        />
      )}

      <style>{`@keyframes svcFade{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}`}</style>
      {groups.map(({ category, services: svcs }) => (
        <div key={category} style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px 10px', borderBottom: '1px solid var(--pn-border)', background: 'var(--pn-bg)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 600, color: '#2D7A5F', letterSpacing: '.16em', textTransform: 'uppercase' }}>{category}</span>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: 10, fontWeight: 500, color: 'var(--pn-text-faint)', letterSpacing: '.12em' }}>{svcs.length} {svcs.length === 1 ? 'service' : 'services'}</span>
          </div>
          {svcs.map((svc, i) => (
            <div key={svc.id}
              onClick={() => { setEditing({ ...svc }); setErrors({}); }}
              style={{ padding: '13px 18px', borderBottom: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', gap: 14, opacity: svc.active === false ? .42 : 1, cursor: 'pointer', transition: 'box-shadow .15s ease, background .15s ease', animation: svc.active === false ? 'none' : 'svcFade .4s ease both', animationDelay: `${i * 28}ms` }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--pn-bg)'; e.currentTarget.style.boxShadow = 'inset 3px 0 0 #2D7A5F'; }}
              onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.boxShadow = ''; }}>
              <ServiceThumb image={svc.image} name={svc.name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, fontWeight: 500, color: 'var(--pn-text)', letterSpacing: '.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{svc.name}</span>
                  <span style={{ flex: 1, borderBottom: '1px dotted var(--pn-border-strong)', transform: 'translateY(-3px)', minWidth: 18 }} />
                  <span style={{ fontFamily: "'Cinzel', serif", fontSize: 14, fontWeight: 600, color: '#2D7A5F', whiteSpace: 'nowrap', letterSpacing: '.02em' }}>{formatPrice(svc.basePrice, svc.priceFrom)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 3 }}>
                  <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: 13.5, color: 'var(--pn-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{svc.description || ''}</span>
                  <span style={{ fontSize: 10, color: 'var(--pn-text-faint)', letterSpacing: '.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatDuration(svc.duration, svc.durationMin)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                {!isTech && <Toggle active={svc.active} onChange={() => toggleActive(svc)} />}
                {!isTech && <Btn onClick={() => { setEditing({ ...svc }); setErrors({}); }}>Edit</Btn>}
                {!isTech && <Btn color="#ef4444" onClick={() => handleDelete(svc)}>Del</Btn>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {editing && (
        <ServiceModal
          svc={editing}
          errors={errors}
          saving={saving}
          onChange={patch => setEditing(e => ({ ...e, ...patch }))}
          onSave={handleSave}
          onClose={() => { setEditing(null); setErrors({}); }}
        />
      )}

      <CoachMark
        id="services_intro"
        icon="✂️"
        title="This menu drives your booking page"
        body="The services here are exactly what clients see when they book online. Set duration + price for each — the schedule auto-blocks the right amount of time when one is picked. Group them with categories for a tidy menu."
      />
    </div>
  );
}

function ServiceThumb({ image, name }) {
  const [err, setErr] = useState(false);
  if (image && !err) {
    return (
      <img
        src={image} alt={name}
        onError={() => setErr(true)}
        style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: 'var(--pn-surface-alt)' }}
      />
    );
  }
  const colors = { M: '#4A7DB5', P: '#2D7A5F', A: '#B57A4A' };
  const bg = colors[name?.[0]?.toUpperCase()] || '#999';
  return (
    <div style={{ width: 48, height: 48, borderRadius: 8, background: bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
      💅
    </div>
  );
}

function ServiceModal({ svc, errors, saving, onChange, onSave, onClose }) {
  const isNew = !svc.id;
  const fileRef = useRef(null);
  const [imgErr, setImgErr] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await resizeImg(file, 600, 400, 0.82);
      onChange({ image: b64 });
      setImgErr(false);
    } catch { /* ignore */ }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, padding: 24, width: '92%', maxWidth: 440, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{isNew ? 'Add Service' : 'Edit Service'}</span>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>×</button>
        </div>

        {/* Image preview + controls */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 6 }}>Service photo</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 80, height: 80, borderRadius: 10, overflow: 'hidden', background: 'var(--pn-surface-alt)', flexShrink: 0, border: '1px solid var(--pn-border)' }}>
              {svc.image && !imgErr
                ? <img src={svc.image} alt="" onError={() => setImgErr(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>💅</div>
              }
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                value={svc.image || ''}
                onChange={e => { onChange({ image: e.target.value }); setImgErr(false); }}
                placeholder="Paste image URL…"
                style={{ ...inputStyle, fontSize: 11 }}
              />
              <button onClick={() => fileRef.current?.click()} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-text-muted)', textAlign: 'left' }}>
                ↑ Upload photo…
              </button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
            </div>
          </div>
        </div>

        <Field label="Service name" error={errors.name}>
          <input value={svc.name} onChange={e => onChange({ name: e.target.value })} placeholder="e.g. Gel Manicure" style={inputStyle} />
        </Field>

        <Field label="Category" error={errors.category}>
          <select value={svc.category} onChange={e => onChange({ category: e.target.value })} style={inputStyle}>
            {CATEGORY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
            <option value="custom">Custom…</option>
          </select>
          {svc.category === 'custom' && (
            <input placeholder="Category name" style={{ ...inputStyle, marginTop: 6 }} onChange={e => onChange({ category: e.target.value })} />
          )}
        </Field>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <Field label="Base price ($)" error={errors.basePrice} style={{ flex: 1 }}>
            <input type="number" min={0} value={svc.basePrice} onChange={e => onChange({ basePrice: Number(e.target.value) })} style={inputStyle} />
          </Field>
          <Field label="Duration (min)" error={errors.duration} style={{ flex: 1 }}>
            <input type="number" min={1} value={svc.duration} onChange={e => onChange({ duration: Number(e.target.value) })} style={inputStyle} />
          </Field>
          <Field label="Turn value (pts)" style={{ flex: 1 }}>
            <input type="number" min={0} step={0.5} value={svc.turnValue ?? ''} placeholder="1"
              onChange={e => onChange({ turnValue: e.target.value === '' ? null : Number(e.target.value) })} style={inputStyle} />
          </Field>
        </div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: -6, marginBottom: 12 }}>
          Turn value is only used when the walk-in rotation is set to “by value of work” (Admin → Settings). Blank = counts as 1 turn. e.g. polish change 0.5, full set 2.
        </div>

        <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pn-text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={svc.priceFrom} onChange={e => onChange({ priceFrom: e.target.checked })} />
            Price is "starting from" ($X+)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pn-text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={svc.durationMin} onChange={e => onChange({ durationMin: e.target.checked })} />
            Duration is minimum (Xmin+)
          </label>
        </div>

        <Field label="Description">
          <textarea value={svc.description || ''} onChange={e => onChange({ description: e.target.value })} rows={3}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} placeholder="Brief description of what's included…" />
        </Field>

        <Field label="Options / Variants (optional)">
          <ServiceOptionsEditor
            options={svc.options || []}
            onChange={opts => onChange({ options: opts })}
          />
        </Field>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--pn-text)', cursor: 'pointer', marginBottom: 10 }}>
          <input type="checkbox" checked={svc.active} onChange={e => onChange({ active: e.target.checked })} />
          Active (visible to clients)
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--pn-text)', cursor: 'pointer', marginBottom: 10 }}>
          <input type="checkbox" style={{ marginTop: 3 }} checked={svc.taxable !== false} onChange={e => onChange({ taxable: e.target.checked })} />
          <span>
            Subject to sales tax
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.45 }}>
              On for regular services. Turn off for cancellation fees, no-show fees, or any non-service charges where Ohio sales tax doesn't apply.
            </div>
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--pn-text)', cursor: 'pointer', marginBottom: 14 }}>
          <input type="checkbox" style={{ marginTop: 3 }} checked={!!svc.canRequireRemoval} onChange={e => onChange({ canRequireRemoval: e.target.checked })} />
          <span>
            Can require removal
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.45 }}>
              When booking online, customers will be asked if they need an existing set removed first. The fee is set in <strong>Admin → 💰 Financial</strong>.
            </div>
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--pn-text)', cursor: 'pointer', marginBottom: 14 }}>
          <input type="checkbox" style={{ marginTop: 3 }} checked={!!svc.categoryExclusive} onChange={e => onChange({ categoryExclusive: e.target.checked })} />
          <span>
            Exclusive in category
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.45 }}>
              Block adding this service when another exclusive service from <strong>{svc.category || 'the same category'}</strong> is already in the cart. Use for "one set of hands / one set of feet" rules — set this on every Manicure and every Pedicure so customers can only pick one of each per visit. Leave OFF for add-ons (Nail Art, Removal, etc.).
            </div>
          </span>
        </label>

        <Field label="Max in cart per booking" hint="How many copies of this service a customer can add to one booking. Default 1. Set to 2 for Removal so customers can book one removal for hands and one for feet. Higher values only make sense for repeatable add-ons (e.g. extra nail art).">
          <input type="number" min={1} max={10} value={svc.maxInCart ?? 1}
            onChange={e => onChange({ maxInCart: Math.max(1, Number(e.target.value) || 1) })}
            style={{ ...inputStyle, width: 100 }} />
        </Field>

        <Field label="Auto-rebook interval (weeks)" hint="At checkout, prompt the client to book their next visit this many weeks out. 0 = no prompt.">
          <input type="number" min={0} max={26} value={svc.defaultRebookWeeks ?? 0}
            onChange={e => onChange({ defaultRebookWeeks: Math.max(0, Number(e.target.value) || 0) })}
            style={{ ...inputStyle, width: 100 }} />
        </Field>

        {/* Tier 7: per-service flow overrides. These override the
            corresponding global Booking Flow settings (Admin → Settings →
            🧭 Booking Flow) ONLY when this service is in the cart. */}
        <div style={{ background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>
            Booking-flow overrides for this service
          </div>
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
            When this service is in the cart, these win over the global Booking Flow settings. Leave blank to inherit.
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--pn-text)', cursor: 'pointer', marginBottom: 12 }}>
            <input type="checkbox" style={{ marginTop: 3 }}
              checked={!!svc.flowOverrides?.requireSignIn}
              onChange={e => onChange({ flowOverrides: { ...(svc.flowOverrides || {}), requireSignIn: e.target.checked || undefined } })} />
            <span>
              Require sign-in to book this service
              <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.45 }}>
                Useful for VIP services, services with a deposit, or anything you want auditable to a specific account.
              </div>
            </span>
          </label>

          <Field label="Minimum lead time (minutes)" hint="When this service is in the cart, customers can't book any slot starting sooner than this. Leave blank to inherit the global value.">
            <input type="number" min={0} max={1440}
              value={svc.flowOverrides?.minLeadTimeMinutes ?? ''}
              onChange={e => {
                const raw = e.target.value;
                const n = raw === '' ? undefined : Math.max(0, Number(raw) || 0);
                onChange({ flowOverrides: { ...(svc.flowOverrides || {}), minLeadTimeMinutes: n } });
              }}
              placeholder="(inherit)"
              style={{ ...inputStyle, width: 140 }} />
          </Field>

          <Field label="Customer note shown in cart" hint="A short line of text shown to the customer when this service is added — e.g. 'Please come with bare nails.' or 'Patch test required 24h before.'">
            <input type="text" maxLength={140}
              value={svc.flowOverrides?.customNote ?? ''}
              onChange={e => onChange({ flowOverrides: { ...(svc.flowOverrides || {}), customNote: e.target.value || undefined } })}
              placeholder="(none)"
              style={{ ...inputStyle, width: '100%' }} />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, ...btnBase }}>Cancel</button>
          <button onClick={onSave} disabled={saving} style={{ flex: 2, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE', opacity: saving ? .6 : 1 }}>
            {saving ? 'Saving…' : (isNew ? 'Add Service' : 'Save Changes')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServiceOptionsEditor({ options, onChange }) {
  function patch(idx, patchObj) {
    onChange(options.map((o, i) => i === idx ? { ...o, ...patchObj } : o));
  }
  function remove(idx) { onChange(options.filter((_, i) => i !== idx)); }
  function add() {
    onChange([...options, { id: `opt_${Date.now()}_${options.length}`, name: '', price: 0, duration: 0, priceFrom: false }]);
  }

  return (
    <div style={{ background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: 10 }}>
      {options.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', padding: '6px 4px 10px', lineHeight: 1.5 }}>
          No options yet. Use options to offer variants like Short/Medium/Long or add-ons (Nail Art, Removal). Each option has its own price and duration.
        </div>
      )}
      {options.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, paddingLeft: 2 }}>
          <div style={{ flex: 2, fontSize: 10, fontWeight: 600, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Name</div>
          <div style={{ width: 64, fontSize: 10, fontWeight: 600, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Price ($)</div>
          <div style={{ width: 56, fontSize: 10, fontWeight: 600, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Min</div>
          <div style={{ width: 28, fontSize: 10, fontWeight: 600, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', textAlign: 'center' }} title='Display price as "starts at" (e.g. $15+). Useful when the final price varies — like Nail Art.'>$+?</div>
          <div style={{ width: 28 }} />
        </div>
      )}
      {options.map((opt, i) => (
        <div key={opt.id || i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <input value={opt.name || ''} onChange={e => patch(i, { name: e.target.value })}
            placeholder="Option name (e.g. Gel-X with removal)"
            style={{ flex: 2, minWidth: 0, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '7px 9px', fontSize: 12, background: 'var(--pn-surface)' }} />
          <input type="number" value={opt.price ?? 0} onChange={e => patch(i, { price: Number(e.target.value) })}
            title="Price ($)" placeholder="$"
            style={{ width: 64, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '7px 9px', fontSize: 12, background: 'var(--pn-surface)' }} />
          <input type="number" value={opt.duration ?? 0} onChange={e => patch(i, { duration: Number(e.target.value) })}
            title="Duration (min)" placeholder="min"
            style={{ width: 56, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '7px 9px', fontSize: 12, background: 'var(--pn-surface)' }} />
          <label title='Display price as "starts at" (e.g. $15+). Use for variable-price options like Nail Art.'
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, fontSize: 11, color: 'var(--pn-text-muted)', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={!!opt.priceFrom} onChange={e => patch(i, { priceFrom: e.target.checked })} />
          </label>
          <button onClick={() => remove(i)} title="Remove option"
            style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #fca5a5', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', flexShrink: 0 }}>×</button>
        </div>
      ))}
      <button onClick={add}
        style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, border: '1px dashed var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
        + Add option
      </button>
      {options.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 8, lineHeight: 1.5 }}>
          Each option's price + duration overrides the base service. Check the <strong>$+?</strong> box to display the price as <strong>"$X+"</strong> instead of <strong>"$X"</strong> — useful for options whose final cost varies (Nail Art, Air Brush, etc.).
        </div>
      )}
    </div>
  );
}

function Toggle({ active, onChange }) {
  return (
    <div onClick={onChange} style={{ width: 34, height: 20, borderRadius: 10, background: active ? '#22c55e' : 'var(--pn-surface-muted)', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background .2s' }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: active ? 16 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
    </div>
  );
}

function Field({ label, error, hint, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && !error && <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 3, lineHeight: 1.45 }}>{hint}</div>}
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>{error}</div>}
    </div>
  );
}

function Btn({ onClick, color, children }) {
  return <Button onClick={onClick} color={color}>{children}</Button>;
}

function Empty({ children }) {
  return <div style={{ padding: 16, textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 13 }}>{children}</div>;
}

const inputStyle = { fontFamily: 'inherit', width: '100%', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--pn-text)', outline: 'none', background: 'var(--pn-bg)', boxSizing: 'border-box' };
const btnBase    = { fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'var(--pn-surface)', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 14px', color: 'var(--pn-text)' };
