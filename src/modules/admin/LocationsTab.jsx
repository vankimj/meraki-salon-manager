import { useEffect, useState } from 'react';
import { subscribeLocations, saveLocations, DEFAULT_LOCATION_ID } from '../../lib/locations';

// Manage a tenant's locations AFTER onboarding. Single-location tenants have
// one "Main" entry; adding a second turns on the location switcher + per-location
// tax everywhere. Writes the canonical tenants/{tid}/data/locations doc.
const blankLoc = () => ({
  id: 'loc_' + Math.random().toString(36).slice(2, 9),
  name: '', address: '', phone: '', taxRate: '', isPrimary: false, active: true,
});

export default function LocationsTab() {
  const [state, setState] = useState(null);
  const [draft, setDraft] = useState([]);
  const [defaultId, setDefaultId] = useState(DEFAULT_LOCATION_ID);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => subscribeLocations(s => {
    setState(s);
    // Hydrate the editable draft once (or when the doc changes server-side and
    // we're not mid-edit). Keep taxRate as a string for the input.
    setDraft(s.list.map(l => ({ ...l, taxRate: l.taxRate ?? '' })));
    setDefaultId(s.defaultLocationId || DEFAULT_LOCATION_ID);
  }), []);

  function patch(i, delta) { setDraft(d => d.map((l, j) => j === i ? { ...l, ...delta } : l)); }
  function addLocation() { setDraft(d => [...d, blankLoc()]); }
  function removeLocation(i) {
    setDraft(d => {
      const next = d.filter((_, j) => j !== i);
      return next.length ? next : d; // never remove the last one
    });
  }

  const activeCount = draft.filter(l => l.active !== false).length;

  function validate() {
    if (draft.length === 0) return 'At least one location is required.';
    for (const l of draft) {
      if (!l.name?.trim()) return 'Every location needs a name.';
      if (l.taxRate !== '' && l.taxRate != null && !(Number(l.taxRate) >= 0)) return `"${l.name}" has an invalid tax rate.`;
    }
    if (activeCount === 0) return 'At least one location must be active.';
    if (!draft.some(l => l.id === defaultId && l.active !== false)) return 'The default location must be one of the active locations.';
    return '';
  }

  async function save() {
    const err = validate();
    if (err) { setMsg(err); return; }
    setSaving(true); setMsg('');
    try {
      const list = draft.map(l => ({
        id: l.id, name: l.name.trim(), address: (l.address || '').trim(), phone: (l.phone || '').trim(),
        taxRate: l.taxRate === '' || l.taxRate == null ? null : Number(l.taxRate),
        isPrimary: l.id === defaultId, active: l.active !== false,
      }));
      await saveLocations({ list, defaultLocationId: defaultId });
      setMsg('Saved ✓');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setMsg(e?.message || 'Save failed.');
    } finally { setSaving(false); }
  }

  if (state === null) return <div style={{ padding: 20, color: 'var(--pn-text-muted)' }}>Loading locations…</div>;

  return (
    <div style={{ padding: '4px 2px' }}>
      <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.5, marginBottom: 14 }}>
        Manage your salon locations. {activeCount > 1
          ? <strong style={{ color: '#16a34a' }}>Multi-location is ON</strong>
          : 'Add a second active location to turn on the location switcher and per-location tax.'} Leave a location's
        tax rate blank to use the tenant default from Settings.
      </div>

      {draft.map((l, i) => (
        <div key={l.id} style={{ border: `1px solid ${l.active !== false ? 'var(--pn-border-strong)' : 'var(--pn-border)'}`, borderRadius: 10, padding: 12, marginBottom: 10, background: l.active !== false ? 'var(--pn-surface)' : 'var(--pn-bg)', opacity: l.active !== false ? 1 : 0.7 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input value={l.name} onChange={e => patch(i, { name: e.target.value })} placeholder="Location name"
              style={{ flex: 1, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', color: 'var(--pn-text)' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--pn-text-muted)', cursor: 'pointer' }}>
              <input type="radio" name="defaultLoc" checked={defaultId === l.id} onChange={() => setDefaultId(l.id)} /> Default
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input value={l.address} onChange={e => patch(i, { address: e.target.value })} placeholder="Address"
              style={inp} />
            <input value={l.phone} onChange={e => patch(i, { phone: e.target.value })} placeholder="Phone"
              style={inp} />
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--pn-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Tax %
              <input type="number" min={0} step="0.01" value={l.taxRate} onChange={e => patch(i, { taxRate: e.target.value })} placeholder="default"
                style={{ ...inp, width: 80 }} />
            </label>
            <label style={{ fontSize: 12, color: 'var(--pn-text-muted)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={l.active !== false} onChange={e => patch(i, { active: e.target.checked })} /> Active
            </label>
            {draft.length > 1 && (
              <button onClick={() => removeLocation(i)} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--pn-danger, #dc2626)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Remove</button>
            )}
          </div>
        </div>
      ))}

      <button onClick={addLocation} style={{ fontSize: 13, fontWeight: 600, color: '#3D95CE', background: 'none', border: '1px dashed var(--pn-border-strong)', borderRadius: 8, padding: '9px 0', width: '100%', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 14 }}>
        + Add location
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={save} disabled={saving} style={{ fontSize: 14, fontWeight: 700, color: '#fff', background: '#2D7A5F', border: 'none', borderRadius: 10, padding: '10px 22px', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily: 'inherit' }}>
          {saving ? 'Saving…' : 'Save locations'}
        </button>
        {!!msg && <span style={{ fontSize: 13, color: msg === 'Saved ✓' ? '#16a34a' : 'var(--pn-danger, #dc2626)' }}>{msg}</span>}
      </div>
    </div>
  );
}

const inp = { fontFamily: 'inherit', fontSize: 13, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', color: 'var(--pn-text)' };
