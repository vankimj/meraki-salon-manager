import { useState, useEffect, useRef } from 'react';
import { parsePhoneNumberFromString as lpnParse } from 'libphonenumber-js';

// Self-contained so it can be unit-tested without dragging in ScheduleAdmin's
// firestore/Stripe import tree. Style + phone-format are local copies of the
// parent's equivalents (kept visually identical).
const inp = { fontFamily: 'inherit', width: '100%', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: 'var(--pn-text)', outline: 'none', background: 'var(--pn-bg)', boxSizing: 'border-box' };

function displayPhone(p) {
  if (!p) return '';
  try {
    const parsed = String(p).startsWith('+') ? lpnParse(String(p)) : lpnParse(String(p), 'US');
    if (parsed?.isValid()) return parsed.format('INTERNATIONAL');
  } catch (_) { /* fall through */ }
  return String(p);
}

export default function ClientSearch({ clients, clientId, clientName, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selected = clients.find(c => c.id === clientId);

  // When no client is linked, the text in the box IS the appt's clientName — so a
  // prefilled name (e.g. a walk-in seated from the queue via Manual/Next) shows
  // up, and typing both filters the list and updates the draft appt. A separate
  // local `query` state previously ignored the prefilled clientName → blank box.
  const query = clientId ? '' : (clientName || '');

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Sort alphabetically client-side so the dropdown order is predictable
  // even if the upstream `clients` collection is unsorted.
  const sortedAll = [...clients].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const filtered = query.length >= 1
    ? sortedAll.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || (c.phone || '').includes(query)).slice(0, 50)
    : sortedAll.slice(0, 100);

  function selectClient(c) {
    onChange({ clientId: c.id, clientName: c.name });
    setOpen(false);
  }

  function clearClient() {
    onChange({ clientId: '', clientName: '' });
  }

  if (selected) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        ...inp, cursor: 'default', paddingTop: 6, paddingBottom: 6,
        ...(selected.banned ? { background: 'var(--pn-danger-bg)', borderColor: '#fca5a5' } : {}),
      }}>
        {selected.banned && <span title="Banned client" style={{ fontSize: 14 }}>🚫</span>}
        <span style={{
          flex: 1, fontSize: 13,
          color: selected.banned ? 'var(--pn-danger)' : 'var(--pn-text)',
          fontWeight: selected.banned ? 600 : 400,
        }}>{selected.name}{selected.banned && ' · Banned'}</span>
        {selected.phone && <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{displayPhone(selected.phone)}</span>}
        <button onClick={clearClient} style={{ border: 'none', background: 'none', color: 'var(--pn-text-faint)', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          value={clientId ? (clientName || '') : query}
          onChange={e => {
            setOpen(true);
            if (!clientId) onChange({ clientId: '', clientName: e.target.value });
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search clients by name…"
          style={{ ...inp, ...(clientId ? { paddingRight: 28 } : {}) }}
          readOnly={!!clientId}
        />
        {/* A prefilled clientId whose client isn't in the loaded list (e.g.
            created via the kiosk after this screen mounted) shows the name but
            has no chip — give it a × so the link isn't a dead end. */}
        {clientId && (
          <button onClick={clearClient} aria-label="Clear client"
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: 'var(--pn-text-faint)', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
        )}
      </div>
      {open && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 2px)', background: 'var(--pn-surface)', border: '1px solid var(--pn-border-strong)', borderRadius: 8, zIndex: 200, maxHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', boxShadow: '0 6px 20px rgba(0,0,0,.12)' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '12px', fontSize: 12, color: 'var(--pn-text-muted)', textAlign: 'center', borderBottom: '1px solid var(--pn-border)' }}>
              No matches{query ? ` for “${query}”` : ''}. Close this menu and add a <strong style={{ color: '#92400e' }}>phone or email</strong> below — we'll create a new profile when you save.
            </div>
          )}
          {filtered.map(c => (
            <div
              key={c.id}
              onMouseDown={() => selectClient(c)}
              style={{
                padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                borderBottom: '1px solid var(--pn-border)',
                background: c.banned ? 'var(--pn-danger-bg)' : 'transparent',
              }}
              onMouseEnter={e => e.currentTarget.style.background = c.banned ? 'var(--pn-danger-bg)' : 'var(--pn-surface-alt)'}
              onMouseLeave={e => e.currentTarget.style.background = c.banned ? 'var(--pn-danger-bg)' : ''}
            >
              {c.banned && <span title="Banned client — do not accept bookings" style={{ fontSize: 13 }}>🚫</span>}
              <span style={{
                flex: 1,
                color: c.banned ? 'var(--pn-danger)' : 'var(--pn-text)',
                fontWeight: c.banned ? 600 : 400,
              }}>
                {c.name}
                {c.banned && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>· Banned</span>}
              </span>
              {c.phone && <span style={{ fontSize: 11, color: c.banned ? 'var(--pn-danger)' : 'var(--pn-text-faint)' }}>{displayPhone(c.phone)}</span>}
            </div>
          ))}
          {filtered.length === 0 && query && (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--pn-text-faint)' }}>No match — “{query}” will become a new client profile once you add a phone or email below.</div>
          )}
        </div>
      )}
    </div>
  );
}
