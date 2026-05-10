import { useState } from 'react';
import { createTenantRecord, provisionTenantDocs } from '../lib/tenants.js';
import { C, FONT, radius, shadow } from '../theme.js';

const PLANS = [
  { value: 'solo',     label: 'Solo' },
  { value: 'studio',   label: 'Studio' },
  { value: 'salonPro', label: 'Salon Pro' },
];

export default function NewTenantModal({ onClose, onCreated }) {
  const [id,     setId]     = useState('');
  const [name,   setName]   = useState('');
  const [owner,  setOwner]  = useState('');
  const [plan,   setPlan]   = useState('solo');
  const [foundersMember, setFoundersMember] = useState(true);
  const [active, setActive] = useState(true);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState('');

  function update(setter) {
    return e => {
      const v = e?.target ? e.target.value : e;
      setter(v);
      setError('');
    };
  }

  function handleIdChange(e) {
    const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setId(v);
    setError('');
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!id.trim() || !name.trim() || !owner.trim()) {
      setError('Salon ID, name, and owner email are all required.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner.trim())) {
      setError('Owner email looks invalid.');
      return;
    }
    setBusy(true);
    try {
      const slugId = id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      await createTenantRecord(slugId, {
        name:           name.trim(),
        ownerEmail:     owner.trim(),
        plan,
        foundersMember,
        active,
      });
      await provisionTenantDocs(slugId, owner.trim());
      onCreated();
    } catch (err) {
      setError(err?.message || 'Failed to create tenant.');
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,25,35,.5)',
      zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}
      onClick={onClose}
    >
      <form onClick={e => e.stopPropagation()} onSubmit={handleSave} style={{
        background: '#fff', borderRadius: radius.lg,
        padding: 24, width: '100%', maxWidth: 440,
        boxShadow: shadow.lg, fontFamily: FONT.body,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, marginBottom: 4 }}>+ New tenant</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>
          Onboard a new salon. Provisioning happens automatically (settings, slides, users).
        </div>

        <Field label="Salon ID" hint="lowercase letters, digits, dashes — becomes the subdomain">
          <input value={id} onChange={handleIdChange} placeholder="e.g. luxenails" required style={inputStyle()} />
          {id && <div style={{ fontSize: 10, color: C.mutedSoft, marginTop: 4 }}>URL: {id}.plumenexus.com</div>}
        </Field>

        <Field label="Salon name">
          <input value={name} onChange={update(setName)} placeholder="e.g. Luxe Nails Studio" required style={inputStyle()} />
        </Field>

        <Field label="Owner email">
          <input type="email" value={owner} onChange={update(setOwner)} placeholder="owner@email.com" required style={inputStyle()} />
        </Field>

        <Field label="Plan">
          <select value={plan} onChange={update(setPlan)} style={inputStyle()}>
            {PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>

        <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, background: foundersMember ? '#dcfce7' : C.bgCode, marginBottom: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={foundersMember} onChange={e => setFoundersMember(e.target.checked)} />
          <span style={{ fontSize: 12, color: C.text }}>
            <strong>Founders' Member</strong> — Solo plan free for life
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, background: C.bgCode, marginBottom: 18, cursor: 'pointer' }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          <span style={{ fontSize: 12, color: C.text }}>Active</span>
        </label>

        {error && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: C.dangerSoft, border: `1px solid ${C.danger}40`, borderRadius: 8, fontSize: 12, color: '#991b1b' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy} style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 600,
            background: 'transparent', color: C.muted,
            border: `1px solid ${C.rule}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
          <button type="submit" disabled={busy} style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 600,
            background: busy ? C.rule : C.ink, color: '#fff',
            border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
          }}>{busy ? 'Creating…' : 'Create tenant'}</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
        {label} {hint && <span style={{ color: C.mutedSoft, fontWeight: 400 }}>· {hint}</span>}
      </div>
      {children}
    </label>
  );
}

function inputStyle() {
  return {
    width: '100%', boxSizing: 'border-box',
    padding: '8px 12px', fontSize: 13,
    border: `1px solid ${C.rule}`, borderRadius: 8,
    background: '#fff', fontFamily: 'inherit', outline: 'none',
  };
}
