import { useState, useEffect, useRef } from 'react';
import { fetchServices, createService, saveService, deleteService, servicesExist, clearServices } from '../../lib/firestore';
import { groupByCategory, formatPrice, formatDuration, validateService, blankService } from '../../utils/serviceHelpers';
import { SEED_SERVICES, CATEGORY_ORDER } from '../../data/seedServices';
import { logActivity } from '../../lib/logger';
import { resizeImg } from '../../utils/helpers';
import { useApp } from '../../context/AppContext';

export default function ServicesAdmin() {
  const { isTech, showToast } = useApp();
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
      if (!svcs.length) {
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

  // Suggested option templates per service name. Keys are case-insensitive,
  // hyphen-flexible service names; each template is an array of options
  // expressed as deltas from the base (priceAdd / durationAdd).
  // Names align with what merakinailstudio.glossgenius.com surfaces.
  const SUGGESTED = {
    'gel x':                   [{ name: 'Gel-X only',                 priceAdd:  0, durationAdd:  0 },
                                { name: 'Gel-X with removal',         priceAdd: 10, durationAdd: 20 },
                                { name: 'Gel-X + Manicure',           priceAdd: 25, durationAdd: 30 }],
    'structured gel manicure': [{ name: 'Structured gel only',        priceAdd:  0, durationAdd:  0 },
                                { name: 'Structured gel + removal',   priceAdd: 10, durationAdd: 20 },
                                { name: 'Structured gel + manicure',  priceAdd: 20, durationAdd: 30 }],
    'gel manicure':            [{ name: 'Gel manicure only',          priceAdd:  0, durationAdd:  0 },
                                { name: 'Gel manicure + removal',     priceAdd: 10, durationAdd: 20 }],
    'dip':                     [{ name: 'Dip only',                   priceAdd:  0, durationAdd:  0 },
                                { name: 'Dip + removal',              priceAdd: 10, durationAdd: 20 },
                                { name: 'Dip + manicure',             priceAdd: 25, durationAdd: 30 }],
    'gel polish change':       [{ name: 'Polish change only',         priceAdd:  0, durationAdd:  0 },
                                { name: 'Polish change + removal',    priceAdd: 10, durationAdd: 20 }],
    'spa pedicure':            [{ name: 'Regular polish',             priceAdd:  0, durationAdd:  0 },
                                { name: 'With gel polish',            priceAdd: 10, durationAdd: 15 }],
    'signature pedicure':      [{ name: 'Regular polish',             priceAdd:  0, durationAdd:  0 },
                                { name: 'With gel polish',            priceAdd: 10, durationAdd: 15 }],
    'deluxe pedicure':         [{ name: 'Regular polish',             priceAdd:  0, durationAdd:  0 },
                                { name: 'With gel polish',            priceAdd: 10, durationAdd: 15 }],
  };

  function normalizeKey(s) {
    return (s || '').toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  async function applySuggestedOptions() {
    const eligible = services.filter(s => SUGGESTED[normalizeKey(s.name)] && (!s.options || s.options.length === 0));
    if (eligible.length === 0) {
      showToast('No services need options — every match already has them.');
      return;
    }
    const summary = eligible.map(s => `• ${s.name} — ${SUGGESTED[normalizeKey(s.name)].length} options`).join('\n');
    if (!confirm(`Apply suggested options to ${eligible.length} service${eligible.length === 1 ? '' : 's'}?\n\n${summary}\n\nYou can edit each one in the service editor after.`)) return;
    try {
      for (const svc of eligible) {
        const tpl = SUGGESTED[normalizeKey(svc.name)];
        const opts = tpl.map((o, i) => ({ id: `opt_${svc.id}_${i}`, ...o }));
        await saveService(svc.id, { options: opts });
      }
      const fresh = await fetchServices();
      setServices(fresh);
      showToast(`Applied options to ${eligible.length} service${eligible.length === 1 ? '' : 's'}`);
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
          <button onClick={handleReseed} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #d0d0d0', background: '#fafafa', color: '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
            ↺ Reset to defaults
          </button>
        )}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#aaa' }}>{services.length} total · {activeCount} active</span>
          {undoStack.length > 0 && <Btn onClick={handleUndo}>↩ Undo</Btn>}
          {redoStack.length > 0 && <Btn onClick={handleRedo}>↪ Redo</Btn>}
          {!isTech && <Btn color="#7c3aed" onClick={applySuggestedOptions}>↺ Apply suggested options</Btn>}
          {!isTech && <Btn color="#3D95CE" onClick={() => { setEditing(blankService()); setErrors({}); }}>+ Add Service</Btn>}
        </div>
      </div>

      {groups.length === 0 && <Empty>No services yet — click Add Service to start.</Empty>}

      {groups.map(({ category, services: svcs }) => (
        <div key={category} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #e8e8e8', fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: '.06em', textTransform: 'uppercase', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{category}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#bbb', letterSpacing: 0, textTransform: 'none' }}>{svcs.length}</span>
          </div>
          {svcs.map(svc => (
            <div key={svc.id} style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 12, opacity: svc.active ? 1 : .45 }}>
              <ServiceThumb image={svc.image} name={svc.name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{svc.name}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {formatPrice(svc.basePrice, svc.priceFrom)} · {formatDuration(svc.duration, svc.durationMin)}
                </div>
                {svc.description && (
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{svc.description}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
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
        style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: '#f0f0f0' }}
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
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '92%', maxWidth: 440, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{isNew ? 'Add Service' : 'Edit Service'}</span>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>×</button>
        </div>

        {/* Image preview + controls */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 6 }}>Service photo</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 80, height: 80, borderRadius: 10, overflow: 'hidden', background: '#f0f0f0', flexShrink: 0, border: '1px solid #e8e8e8' }}>
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
              <button onClick={() => fileRef.current?.click()} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid #d0d0d0', background: '#fafafa', cursor: 'pointer', fontFamily: 'inherit', color: '#555', textAlign: 'left' }}>
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
        </div>

        <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', cursor: 'pointer' }}>
            <input type="checkbox" checked={svc.priceFrom} onChange={e => onChange({ priceFrom: e.target.checked })} />
            Price is "starting from" ($X+)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', cursor: 'pointer' }}>
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

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#333', cursor: 'pointer', marginBottom: 18 }}>
          <input type="checkbox" checked={svc.active} onChange={e => onChange({ active: e.target.checked })} />
          Active (visible to clients)
        </label>

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
    onChange([...options, { id: `opt_${Date.now()}_${options.length}`, name: '', priceAdd: 0, durationAdd: 0 }]);
  }

  return (
    <div style={{ background: '#fafafa', border: '1px solid #ececec', borderRadius: 10, padding: 10 }}>
      {options.length === 0 && (
        <div style={{ fontSize: 11, color: '#aaa', padding: '6px 4px 10px', lineHeight: 1.5 }}>
          No options yet. Use options to offer variants like Short/Medium/Long or add-ons (Nail Art, Removal). Each option can adjust price and duration.
        </div>
      )}
      {options.map((opt, i) => (
        <div key={opt.id || i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <input value={opt.name || ''} onChange={e => patch(i, { name: e.target.value })}
            placeholder="Option name (e.g. Short, Add-on Nail Art)"
            style={{ flex: 2, minWidth: 0, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 6, padding: '7px 9px', fontSize: 12, background: '#fff' }} />
          <input type="number" value={opt.priceAdd ?? 0} onChange={e => patch(i, { priceAdd: Number(e.target.value) })}
            title="Price adjustment ($)" placeholder="$"
            style={{ width: 64, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 6, padding: '7px 9px', fontSize: 12, background: '#fff' }} />
          <input type="number" value={opt.durationAdd ?? 0} onChange={e => patch(i, { durationAdd: Number(e.target.value) })}
            title="Duration adjustment (min)" placeholder="min"
            style={{ width: 56, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 6, padding: '7px 9px', fontSize: 12, background: '#fff' }} />
          <button onClick={() => remove(i)} title="Remove option"
            style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', color: '#ef4444', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', flexShrink: 0 }}>×</button>
        </div>
      ))}
      <button onClick={add}
        style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, border: '1px dashed #c0c0c0', background: '#fff', color: '#555', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
        + Add option
      </button>
      {options.length > 0 && (
        <div style={{ fontSize: 10, color: '#aaa', marginTop: 8, lineHeight: 1.5 }}>
          Price/duration values are added to the base. Use 0 for "no change". Negative numbers are allowed (e.g. -10 for a discount).
        </div>
      )}
    </div>
  );
}

function Toggle({ active, onChange }) {
  return (
    <div onClick={onChange} style={{ width: 34, height: 20, borderRadius: 10, background: active ? '#22c55e' : '#d0d0d0', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background .2s' }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: active ? 16 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
    </div>
  );
}

function Field({ label, error, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>{error}</div>}
    </div>
  );
}

function Btn({ onClick, color, children }) {
  return (
    <button onClick={onClick} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: 'none', background: color || '#e8e8e8', color: color ? '#fff' : '#555', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <div style={{ padding: 16, textAlign: 'center', color: '#bbb', fontSize: 13 }}>{children}</div>;
}

const inputStyle = { fontFamily: 'inherit', width: '100%', border: '1px solid #d8d8d8', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#333', outline: 'none', background: '#fafafa', boxSizing: 'border-box' };
const btnBase    = { fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: '#fff', border: '1px solid #d0d0d0', borderRadius: 8, padding: '8px 14px', color: '#333' };
