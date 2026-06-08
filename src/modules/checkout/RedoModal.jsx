import { useState, useEffect } from 'react';
import { redoService, fetchEmployees } from '../../lib/firestore';
import { logActivity } from '../../lib/logger';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Stable, regex-safe idempotency key ([A-Za-z0-9_-]{8,128}) generated once per
// open modal — mirrors ReceiptsAdmin's newIdemKey + RefundModal's idem pattern.
function newIdemKey() {
  try { return String(crypto.randomUUID()).replace(/-/g, ''); }
  catch { return 'k' + Date.now() + Math.random().toString(36).slice(2, 12); }
}

// Derive the redoable service line items from a receipt. Prefer the explicit
// `services` line items (name, price, original tech); fall back to one row per
// tech in payment.techSplit (using their split revenue) when no line items.
function deriveServices(receipt) {
  if (!receipt) return [];
  const pay = receipt.payment || {};
  const lines = Array.isArray(receipt.services) ? receipt.services : [];
  const fromLines = lines
    .map(s => ({
      name:     String(s?.name || '').trim(),
      amount:   Number(s?.price) || 0,
      techName: String(s?.techName || pay.techName || receipt.techName || '').trim(),
    }))
    .filter(s => s.name && s.amount > 0 && s.techName);
  if (fromLines.length) return fromLines;
  const split = Array.isArray(pay.techSplit) ? pay.techSplit : [];
  return split
    .map(s => ({
      name:     'Service',
      amount:   Number(s?.revenue) || 0,
      techName: String(s?.techName || '').trim(),
    }))
    .filter(s => s.amount > 0 && s.techName);
}

// Record a service redo from the receipts hub. Multi-select the redone
// service(s), pick the tech who redid the work, and a reason. The server moves
// the commission for those services from the original tech to the redo tech —
// NO money is refunded. Idempotent (one stable key per open modal).
export default function RedoModal({ receipt, onClose, onDone, showToast }) {
  const items = deriveServices(receipt);

  const [selected, setSelected] = useState({});   // { index: true }
  const [redoTech, setRedoTech] = useState('');
  const [reason,   setReason]   = useState('');
  const [techs,    setTechs]    = useState([]);
  const [busy,     setBusy]     = useState(false);
  const [idem]                  = useState(newIdemKey);

  useEffect(() => {
    let alive = true;
    fetchEmployees()
      .then(list => { if (alive) setTechs((list || []).filter(e => e.active !== false && (e.name || '').trim())); })
      .catch(() => { if (alive) setTechs([]); });
    return () => { alive = false; };
  }, []);

  const selectedItems = items.filter((_, i) => selected[i]);
  const totalAmt = selectedItems.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const canSubmit = selectedItems.length > 0 && !!redoTech && !!reason.trim() && !busy;

  function toggle(i) { setSelected(p => ({ ...p, [i]: !p[i] })); }

  async function submit() {
    if (selectedItems.length === 0) { showToast('Pick at least one service that was redone.'); return; }
    if (!redoTech) { showToast('Choose who redid the service.'); return; }
    if (!reason.trim()) { showToast('Add a reason for the redo.'); return; }
    setBusy(true);
    try {
      const res = await redoService({
        receiptId: receipt.id,
        services: selectedItems.map(it => ({ name: it.name, amount: it.amount, techName: it.techName })),
        redoTech,
        reason: reason.trim(),
        idempotencyKey: idem,
        notify: true,
      });
      if (!res?.ok) throw new Error(res?.error || 'Redo failed.');
      logActivity('service_redone', `${money(totalAmt)} redo · ${receipt.clientName || 'Walk-in'} → ${redoTech}${reason.trim() ? ' · ' + reason.trim() : ''}`);
      onDone(`Redo recorded — ${money(totalAmt)} commission moved to ${redoTech}`);
    } catch (e) { showToast('Redo failed: ' + (e?.message || 'error')); setBusy(false); }
  }

  const rowBtn = (on) => ({
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
    border: `1.5px solid ${on ? '#2D7A5F' : 'var(--pn-border)'}`, background: on ? 'var(--pn-success-bg)' : 'var(--pn-bg)',
    borderRadius: 10, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', fontFamily: 'inherit',
  });
  const chip = (on) => ({
    padding: '8px 13px', fontSize: 13, fontWeight: 800, borderRadius: 18,
    border: `1.5px solid ${on ? '#2D7A5F' : 'var(--pn-border)'}`, background: on ? 'var(--pn-success-bg)' : 'var(--pn-bg)',
    color: on ? 'var(--pn-success)' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit',
  });

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 420, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--pn-text)' }}>Redo service</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 22, color: 'var(--pn-text-muted)', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginBottom: 12 }}>{receipt.clientName || 'Walk-in'}{receipt.techName ? ` · originally ${receipt.techName}` : ''}</div>

        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Which service(s) were redone?</label>
        <div style={{ margin: '8px 0 4px' }}>
          {items.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--pn-text-muted)', marginBottom: 8 }}>No redoable services found on this sale.</div>
          ) : items.map((it, i) => {
            const on = !!selected[i];
            return (
              <button key={`it${i}`} onClick={() => toggle(i)} style={rowBtn(on)}>
                <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, border: `1.5px solid ${on ? '#2D7A5F' : 'var(--pn-border)'}`, background: on ? '#2D7A5F' : 'var(--pn-surface)', color: '#fff', fontSize: 13, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: on ? 'var(--pn-success)' : 'var(--pn-text)' }}>{it.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 2 }}>{it.techName}</span>
                </span>
                <span style={{ fontSize: 14, fontWeight: 800, color: on ? 'var(--pn-success)' : 'var(--pn-text)' }}>{money(it.amount)}</span>
              </button>
            );
          })}
        </div>

        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Redo tech</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0 4px' }}>
          {techs.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--pn-text-muted)' }}>No active techs found.</div>
          ) : techs.map(t => {
            const name = (t.name || '').trim();
            const on = redoTech === name;
            return (
              <button key={t.id || name} onClick={() => setRedoTech(name)} style={chip(on)}>{name}</button>
            );
          })}
        </div>

        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Reason</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this being redone?" rows={3} maxLength={400}
          style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 11px', fontSize: 13.5, background: 'var(--pn-bg)', color: 'var(--pn-text)', resize: 'vertical' }} />

        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 10, lineHeight: 1.4 }}>
          This moves the commission for the selected service(s) from the original tech to {redoTech || 'the redo tech'}. No money is refunded.
        </div>

        <button onClick={submit} disabled={!canSubmit}
          style={{ width: '100%', marginTop: 18, padding: '12px', fontWeight: 800, fontSize: 14, borderRadius: 12, border: 'none', background: '#2D7A5F', color: '#fff', cursor: canSubmit ? 'pointer' : 'default', opacity: canSubmit ? 1 : 0.5, fontFamily: 'inherit' }}>
          {busy ? 'Processing…' : `Record redo${totalAmt > 0 ? ` · ${money(totalAmt)}` : ''}`}
        </button>
        <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', textAlign: 'center', marginTop: 10 }}>The original tech and the redo tech are both notified of the commission change.</div>
      </div>
    </div>
  );
}
