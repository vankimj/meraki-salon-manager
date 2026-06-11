import { useState } from 'react';
import { callFn } from '../../lib/firebase';
import { TENANT_ID } from '../../lib/tenant';
import { logActivity } from '../../lib/logger';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
function newIdemKey() {
  try { return String(crypto.randomUUID()).replace(/-/g, ''); }
  catch { return 'k' + Date.now() + Math.random().toString(36).slice(2, 12); }
}

export default function RefundModal({ receipt, onClose, onDone, showToast, commissionDefault = 'withhold' }) {
  const pay = receipt.payment || {};
  // Refundable = the full value paid: card/cash (pay.total) + store credit + gift
  // card. A store-credit-paid sale has pay.total === 0 — that was the $0 refund bug.
  const moneyPaid  = Number(pay.total) || 0;
  const creditPaid = Number(pay.creditApplied) || 0;
  const gcPaid     = Number((pay.giftCard && pay.giftCard.applied) || 0);
  const original   = moneyPaid + creditPaid + gcPaid;
  const already    = Number(receipt.refundedAmount) || 0;
  const remaining  = Math.max(0, original - already);
  const isCard = pay.method === 'card' && !!pay.stripePaymentIntentId;
  const canRefundMoney = moneyPaid > 0.001;   // only offer a money refund if card/cash was actually charged
  const techs = (() => {
    const ts = (Array.isArray(pay.techSplit) && pay.techSplit.length)
      ? pay.techSplit.map(s => s.techName || '').filter(Boolean)
      : [pay.techName || receipt.techName || ''].filter(Boolean);
    return [...new Set(ts)];
  })();
  const [amount, setAmount] = useState(remaining ? remaining.toFixed(2) : '');
  const [reason, setReason] = useState('');
  const [refundTo, setRefundTo] = useState(canRefundMoney ? 'money' : 'credit');   // 'money' | 'credit'
  const [commission, setCommission] = useState(() => {
    const init = {}; techs.forEach(t => { init[t] = commissionDefault === 'goodwill' ? 'goodwill' : 'withhold'; }); return init;
  });
  const [busy, setBusy] = useState(false);
  const [idem] = useState(newIdemKey);
  const mbtn = (on) => ({ flex: 1, padding: '9px 8px', borderRadius: 8, border: `1.5px solid ${on ? '#2D7A5F' : 'var(--pn-border)'}`, background: on ? 'var(--pn-success-bg)' : 'var(--pn-bg)', color: on ? 'var(--pn-success)' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' });
  const cbtn = (on) => ({ padding: '6px 12px', fontSize: 12.5, fontWeight: 800, border: 'none', background: on ? '#2D7A5F' : 'var(--pn-surface-muted)', color: on ? '#fff' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' });

  // A money refund can't exceed what was actually charged to card/cash; store
  // credit can be returned up to the full remaining value.
  const cap = refundTo === 'money' ? Math.min(moneyPaid, remaining) : remaining;

  async function submit() {
    const amt = Number(amount) || 0;
    if (amt <= 0) { showToast('Enter a refund amount'); return; }
    if (amt > cap + 0.001) { showToast(`Refund can't exceed ${money(cap)}${refundTo === 'money' ? ' back to the original payment' : ''}.`); return; }
    if (!reason.trim()) { showToast('Add a reason for the refund.'); return; }
    setBusy(true);
    try {
      const res = await callFn('refundSale')({ tenantId: TENANT_ID, receiptId: receipt.id, amountCents: Math.round(amt * 100), reason: reason.trim(), refundTo, commissionByTech: commission, idempotencyKey: idem });
      if (!res.data?.ok) throw new Error(res.data?.error || 'Refund failed.');
      const kind = refundTo === 'credit' ? 'store-credit refund' : isCard ? 'card refund' : 'refund';
      logActivity('refund_issued', `${money(amt)} ${kind} · ${receipt.clientName || 'Walk-in'}${reason.trim() ? ' · ' + reason.trim() : ''}`);
      onDone(refundTo === 'credit' ? `${money(amt)} added as store credit` : isCard ? `${money(amt)} refunded to the card` : `${money(amt)} refund recorded`);
    } catch (e) { showToast('Refund failed: ' + (e?.message || 'error')); setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 420, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--pn-text)' }}>Refund</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 22, color: 'var(--pn-text-muted)', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginBottom: 12 }}>{receipt.clientName || 'Walk-in'} · original {money(original)}{already > 0 ? ` · ${money(already)} already refunded` : ''}</div>

        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Refund to</label>
        <div style={{ display: 'flex', gap: 8, margin: '6px 0 8px' }}>
          {canRefundMoney && (
            <button onClick={() => { setRefundTo('money'); setAmount(Math.min(moneyPaid, remaining).toFixed(2)); }} style={mbtn(refundTo === 'money')}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{isCard ? 'Back to card' : 'Cash'}</div>
              <div style={{ fontSize: 11, opacity: .7 }}>{isCard ? 'Stripe refund' : 'hand cash back'}</div>
            </button>
          )}
          {!!receipt.clientId && (
            <button onClick={() => { setRefundTo('credit'); setAmount(remaining.toFixed(2)); }} style={mbtn(refundTo === 'credit')}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>Store credit</div>
              <div style={{ fontSize: 11, opacity: .7 }}>no money moves</div>
            </button>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 12, lineHeight: 1.4 }}>
          {refundTo === 'credit'
            ? `Adds ${money(Number(amount) || 0)} to ${receipt.clientName || 'the client'}'s balance — the original payment is NOT refunded.`
            : isCard ? 'Refunds the customer’s card for real, via Stripe.'
            : 'Records the refund — hand the cash back yourself.'}
        </div>

        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Refund amount</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 12px' }}>
          <span style={{ color: 'var(--pn-text-faint)' }}>$</span>
          <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder={remaining.toFixed(2)}
            style={{ flex: 1, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 11px', fontSize: 14, background: 'var(--pn-bg)', color: 'var(--pn-text)' }} />
          <button onClick={() => setAmount(cap.toFixed(2))} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>Full</button>
        </div>

        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Reason</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this being refunded?" rows={3} maxLength={400}
          style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 11px', fontSize: 13.5, background: 'var(--pn-bg)', color: 'var(--pn-text)', resize: 'vertical' }} />

        {techs.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Commission</label>
            {techs.map(t => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--pn-text)' }}>{t || '—'}</span>
                <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--pn-border)' }}>
                  <button onClick={() => setCommission(p => ({ ...p, [t]: 'withhold' }))} style={cbtn((commission[t] || 'withhold') === 'withhold')}>Withhold</button>
                  <button onClick={() => setCommission(p => ({ ...p, [t]: 'goodwill' }))} style={cbtn(commission[t] === 'goodwill')}>Goodwill</button>
                </div>
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: 'var(--pn-text-muted)', marginTop: 6, lineHeight: 1.4 }}>Withhold = tech loses commission on their share of the refund. Goodwill = tech keeps it; the salon absorbs it.</div>
          </div>
        )}

        <button onClick={submit} disabled={busy || !(Number(amount) > 0) || !reason.trim()}
          style={{ width: '100%', marginTop: 18, padding: '12px', fontWeight: 800, fontSize: 14, borderRadius: 12, border: 'none', background: 'var(--pn-danger)', color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: (busy || !(Number(amount) > 0) || !reason.trim()) ? 0.5 : 1, fontFamily: 'inherit' }}>
          {busy ? 'Processing…' : refundTo === 'credit' ? `Give ${money(Number(amount) || 0)} credit` : isCard ? `Refund ${money(Number(amount) || 0)} to card` : `Record ${money(Number(amount) || 0)} refund`}
        </button>
        <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', textAlign: 'center', marginTop: 10 }}>Every refund alerts all admins (push, email, text) with your name.</div>
      </div>
    </div>
  );
}
