import { useState, useRef } from 'react';
import { saveAppointment, fetchClient, saveClient } from '../../lib/firestore';
import { resizeImg } from '../../utils/helpers';
import { logActivity } from '../../lib/logger';

export default function RefundModal({ appt, onComplete, onClose }) {
  const payment     = appt.payment || {};
  const maxRefund   = payment.total ?? payment.subtotal ?? 0;

  const [amount,    setAmount]    = useState(String(maxRefund));
  const [reason,    setReason]    = useState('');
  const [photo,     setPhoto]     = useState('');
  const [addCredit, setAddCredit] = useState(!!appt.clientId);
  const [saving,    setSaving]    = useState(false);
  const fileRef = useRef(null);

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setPhoto(await resizeImg(file, 800, 800, 0.82)); }
    catch {}
  }

  async function submit() {
    const amt = Number(amount) || 0;
    if (amt <= 0) return;
    setSaving(true);
    try {
      const refund = {
        amount: amt,
        reason: reason.trim(),
        photo:  photo || null,
        addedCredit: addCredit && !!appt.clientId,
        refundedAt: new Date().toISOString(),
      };
      const { id, createdAt, ...data } = appt;
      await saveAppointment(id, { ...data, refund });
      logActivity('refund_issued', `${appt.clientName || 'Walk-in'} · $${amt.toFixed(2)}${reason.trim() ? ' · ' + reason.trim() : ''}${addCredit && appt.clientId ? ' · credit added' : ''}`);

      if (addCredit && appt.clientId) {
        const c = await fetchClient(appt.clientId);
        if (c) {
          const { id: cid, createdAt: cc, ...cd } = c;
          await saveClient(cid, { ...cd, credit: ((c.credit || 0) + amt) });
        }
      }

      onComplete();
    } catch (e) {
      console.error('[Refund] save failed:', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 420, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Issue Refund</div>
            <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>{appt.clientName || 'Walk-in'} · {appt.techName}</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>
              Refund amount {maxRefund > 0 && <span style={{ color: 'var(--pn-text-faint)' }}>· original: ${maxRefund.toFixed(2)}</span>}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, color: 'var(--pn-text-faint)' }}>$</span>
              <input type="number" min={0} max={maxRefund || undefined} value={amount}
                onChange={e => setAmount(e.target.value)} autoFocus
                style={{ flex: 1, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 15, fontWeight: 600, background: 'var(--pn-bg)' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>
              Reason <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="Describe the issue…"
              style={{ width: '100%', fontFamily: 'inherit', border: `1px solid ${reason.trim() ? 'var(--pn-border-strong)' : '#fca5a5'}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, background: 'var(--pn-bg)', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 6 }}>Photo (optional)</label>
            {photo ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img src={photo} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--pn-border)' }} />
                <button onClick={() => setPhoto('')} style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.5)', color: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()}
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px dashed var(--pn-border-strong)', background: 'var(--pn-bg)', color: 'var(--pn-text-faint)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                + Attach photo
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhoto} />
          </div>

          {appt.clientId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--pn-text)' }}>
              <input type="checkbox" checked={addCredit} onChange={e => setAddCredit(e.target.checked)} />
              Add refund as store credit to {appt.clientName}'s account
            </label>
          )}

        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--pn-border)', display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={{ flex: 1, fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'var(--pn-surface)', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '10px' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving || !(Number(amount) > 0) || !reason.trim()}
            style={{ flex: 2, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: saving || !(Number(amount) > 0) || !reason.trim() ? 'var(--pn-surface-muted)' : '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '10px' }}>
            {saving ? 'Processing…' : `Issue Refund · $${(Number(amount) || 0).toFixed(2)}`}
          </button>
        </div>

      </div>
    </div>
  );
}
