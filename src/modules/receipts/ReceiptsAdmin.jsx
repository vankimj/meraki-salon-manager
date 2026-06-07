import { useState, useEffect, useMemo } from 'react';
import { fetchReceiptsByRange, fetchReceiptsByClientName, fetchAppointmentsByIds, fetchClient } from '../../lib/firestore';
import { callFn } from '../../lib/firebase';
import { TENANT_ID } from '../../lib/tenant';
import { useApp } from '../../context/AppContext';
import { logActivity } from '../../lib/logger';

// Web Sales & Receipts — parity with the mobile ReceiptsScreen. Browse recent
// sales (range presets), search a client by name across all time, expand a sale
// for line items, resend the receipt by text or email (each participant of a
// combined sale individually), and issue a refund (real Stripe refund for card
// sales via refundSale, record-only for cash).
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const RANGES = [{ d: 30, label: '30 days' }, { d: 90, label: '3 months' }, { d: 180, label: '6 months' }, { d: 365, label: '1 year' }];

function fmtDate(r) {
  const d = r.date || String(r.createdAt || '').slice(0, 10);
  const [y, m, day] = String(d).split('-');
  if (!y || !m || !day) return String(d || '');
  return `${Number(m)}/${Number(day)}/${String(y).slice(2)}`;
}
const cap = (s) => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '';
// Card brand + last4 if captured (in-person sales, going forward); else blank.
function paidWith(pay) {
  if (pay?.method === 'card' && pay.cardBrand && pay.cardLast4) return `${cap(pay.cardBrand)} ••${pay.cardLast4}`;
  return '';
}
function refundTypeLabel(r) {
  const m = r?.method;
  if (m === 'store_credit' || r?.addedCredit) return 'Store-credit';
  if (m === 'card') return 'Card';
  if (m === 'cash') return 'Cash';
  return 'Recorded';
}
function parseContact(raw) {
  const v = (raw || '').trim();
  if (!v) return null;
  if (v.includes('@')) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? { email: v } : null;
  return /\d/.test(v) ? { phone: v } : null;
}
function newIdemKey() {
  try { return String(crypto.randomUUID()).replace(/-/g, ''); }
  catch { return 'k' + Date.now() + Math.random().toString(36).slice(2, 12); }
}

export default function ReceiptsAdmin() {
  const { isAdmin, isTech, showToast } = useApp();
  const canWrite = !!(isAdmin || isTech);   // resend + refund (backend also enforces)

  const [rangeDays, setRangeDays] = useState(180);
  const [list, setList]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId]   = useState(null);
  const [q, setQ]             = useState('');
  const [allTime, setAllTime] = useState(null);   // { name, results }
  const [searching, setSearching] = useState(false);
  const [refundReceipt, setRefundReceipt] = useState(null);

  async function load() {
    setLoading(true);
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - rangeDays);
    const fmt = (d) => d.toISOString().slice(0, 10);
    try {
      const r = await fetchReceiptsByRange(fmt(start), fmt(end));
      setList((r || []).filter(x => x._deleted !== true)
        .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || ''))));
    } catch {
      setList([]); showToast('Failed to load receipts.');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [rangeDays]);

  async function searchAllTime() {
    const name = q.trim();
    if (!name) return;
    setSearching(true);
    try {
      const r = await fetchReceiptsByClientName(name);
      setAllTime({ name, results: (r || []).filter(x => x._deleted !== true) });
    } catch { setAllTime({ name, results: [] }); showToast('Search failed.'); }
    finally { setSearching(false); }
  }

  const filtered = useMemo(() => {
    if (allTime) return allTime.results;
    const term = q.trim().toLowerCase();
    if (!term || !list) return list || [];
    return list.filter(r =>
      String(r.clientName || '').toLowerCase().includes(term) ||
      String(r.clientPhone || '').includes(term) ||
      String(r.clientEmail || '').toLowerCase().includes(term));
  }, [allTime, q, list]);

  function afterRefund(msg) {
    setRefundReceipt(null);
    if (allTime) searchAllTime(); else load();
    if (msg) showToast(msg + ' — admins notified.');
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '4px 2px 40px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={q}
          onChange={e => { setQ(e.target.value); if (allTime) setAllTime(null); }}
          onKeyDown={e => { if (e.key === 'Enter') searchAllTime(); }}
          placeholder="Search by client name"
          style={{ flex: 1, minWidth: 200, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '9px 12px', fontSize: 14, background: 'var(--pn-bg)', color: 'var(--pn-text)' }}
        />
        {!!q.trim() && (
          <button onClick={searchAllTime} disabled={searching}
            style={{ padding: '9px 16px', fontWeight: 700, fontSize: 13, borderRadius: 8, border: 'none', background: 'var(--tm-accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
            {searching ? 'Searching…' : 'All dates'}
          </button>
        )}
      </div>

      {allTime ? (
        <button onClick={() => setAllTime(null)}
          style={{ width: '100%', textAlign: 'left', marginBottom: 12, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--tm-accent)', background: 'var(--pn-info-bg, var(--pn-surface-alt))', color: 'var(--tm-accent)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          All-time results for “{allTime.name}” · {allTime.results.length} found — click to clear
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {RANGES.map(r => {
            const active = rangeDays === r.d;
            return (
              <button key={r.d} onClick={() => { setList(null); setRangeDays(r.d); }}
                style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 600, borderRadius: 16, border: `1.5px solid ${active ? '#2D7A5F' : 'var(--pn-border)'}`, background: active ? 'var(--pn-success-bg)' : 'var(--pn-bg)', color: active ? 'var(--pn-success)' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                {r.label}
              </button>
            );
          })}
        </div>
      )}

      {loading && !allTime ? (
        <div style={{ textAlign: 'center', color: 'var(--pn-text-faint)', padding: '50px 0' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--pn-text-faint)', padding: '50px 0', fontSize: 14 }}>
          {allTime ? `No sales found for “${allTime.name}”.` : q.trim() ? 'No matches in this window — try “All dates”.' : 'No sales in this window.'}
        </div>
      ) : (
        filtered.map(item => (
          <ReceiptCard key={item.id} item={item} open={openId === item.id}
            onToggle={() => setOpenId(openId === item.id ? null : item.id)}
            canWrite={canWrite} showToast={showToast} onRefund={() => setRefundReceipt(item)} />
        ))
      )}

      {refundReceipt && (
        <RefundModal receipt={refundReceipt} onClose={() => setRefundReceipt(null)} onDone={afterRefund} showToast={showToast} />
      )}
    </div>
  );
}

function ReceiptCard({ item, open, onToggle, canWrite, showToast, onRefund }) {
  const pay = item.payment || {};
  const refunded = Number(item.refundedAmount) || 0;
  const remaining = Math.max(0, (Number(pay.total) || 0) - refunded);
  const method = pay.method || '';
  return (
    <div style={{ border: '1px solid var(--pn-border)', borderRadius: 12, background: 'var(--pn-surface)', marginBottom: 10, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, cursor: 'pointer' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--pn-text)' }}>{item.clientName || 'Walk-in'}</div>
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 2 }}>{fmtDate(item)}{item.techName ? ` · ${item.techName}` : ''}{method ? ` · ${method}` : ''}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--pn-text)', textDecoration: refunded > 0 ? 'line-through' : 'none' }}>{money(pay.total)}</div>
          {refunded > 0 && <div style={{ fontSize: 10.5, color: 'var(--pn-danger)', fontWeight: 700 }}>−{money(refunded)} refunded</div>}
        </div>
        <span style={{ color: 'var(--pn-text-muted)', width: 14, textAlign: 'center' }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ padding: '4px 14px 16px', borderTop: '1px solid var(--pn-border)' }}>
          {(item.services || []).map((s, i) => (
            <Row key={`s${i}`} label={`${s.name || '—'}${s.techName ? ` · ${s.techName}` : ''}`} value={money(s.price)} />
          ))}
          {(item.retailProducts || []).map((p, i) => (
            <Row key={`p${i}`} label={`${p.name}${p.qty > 1 ? ` ×${p.qty}` : ''}`} value={money((Number(p.price) || 0) * (p.qty || 1))} />
          ))}
          {pay.discountAmount > 0 && <Row muted label="Discount" value={`−${money(pay.discountAmount)}`} />}
          {pay.promoAmount > 0 && <Row muted label="Promo" value={`−${money(pay.promoAmount)}`} />}
          {pay.giftCard?.applied > 0 && <Row muted label="Gift card used" value={`−${money(pay.giftCard.applied)}`} />}
          {pay.creditApplied > 0 && <Row muted label="Store credit used" value={`−${money(pay.creditApplied)}`} />}
          {pay.tax > 0 && <Row muted label="Tax" value={money(pay.tax)} />}
          {pay.tip > 0 && <Row muted label="Tip" value={money(pay.tip)} />}
          <div style={{ borderTop: '1px solid var(--pn-border)', marginTop: 6, paddingTop: 6 }}>
            <Row bold label="Total" value={`${money(pay.total)}${paidWith(pay) ? ' · ' + paidWith(pay) : ''}`} />
          </div>
          {(item.refunds || (item.refund ? [item.refund] : [])).map((r, i) => (
            <div key={`rf${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', marginTop: i === 0 ? 6 : 0 }}>
              <span style={{ fontSize: 12.5, color: 'var(--pn-danger)', fontWeight: 700 }}>↩ {refundTypeLabel(r)} refund{r.reason ? ` · ${r.reason}` : ''}</span>
              <span style={{ fontSize: 12.5, color: 'var(--pn-danger)', fontWeight: 700 }}>−{money(r.amount)}</span>
            </div>
          ))}

          {canWrite && (
            <>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 16, marginBottom: 6 }}>Resend receipt</div>
              {(item.apptIds || []).length > 1
                ? <Recipients receipt={item} showToast={showToast} />
                : <ResendRow receipt={item} defaultContact={item.clientPhone || item.clientEmail || ''} showToast={showToast} />}

              {remaining > 0 ? (
                <button onClick={onRefund}
                  style={{ marginTop: 14, padding: '10px 16px', fontWeight: 800, fontSize: 13.5, borderRadius: 10, border: '1px solid var(--pn-danger)', background: 'transparent', color: 'var(--pn-danger)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  ↩ Refund{refunded > 0 ? ` (${money(remaining)} left)` : ''}
                </button>
              ) : (
                <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 700, color: 'var(--pn-text-faint)' }}>Fully refunded</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, muted, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
      <span style={{ fontSize: muted ? 12.5 : 13.5, color: muted ? 'var(--pn-text-muted)' : 'var(--pn-text)', fontWeight: bold ? 800 : muted ? 400 : 600 }}>{label}</span>
      <span style={{ fontSize: muted ? 12.5 : 13.5, color: muted ? 'var(--pn-text-muted)' : 'var(--pn-text)', fontWeight: bold ? 800 : 700 }}>{value}</span>
    </div>
  );
}

function ResendRow({ receipt, defaultContact, showToast }) {
  const [val, setVal] = useState(defaultContact || '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  async function send() {
    const c = parseContact(val);
    if (!c) { showToast('Enter a valid phone or email.'); return; }
    setBusy(true); setSent('');
    try {
      const fn = c.email ? 'resendReceiptEmail' : 'resendReceiptSms';
      const res = await callFn(fn)({ tenantId: TENANT_ID, receiptId: receipt.id, viewToken: receipt.viewToken || null, ...(c.email ? { email: c.email } : { phone: c.phone }) });
      if (res.data?.ok || res.data?.sandboxed) setSent(c.email ? `Emailed to ${c.email}` : `Texted to ${c.phone}`);
      else { const e = res.data?.error || 'failed'; showToast("Couldn't send: " + (e === 'no_phone' ? 'no phone on file' : e === 'no_email' ? 'no email on file' : e)); }
    } catch (e) { showToast('Send failed: ' + (e?.message || 'error')); }
    finally { setBusy(false); }
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={val} onChange={e => { setVal(e.target.value); if (sent) setSent(''); }} placeholder="Phone or email"
          style={{ flex: 1, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 11px', fontSize: 13.5, background: 'var(--pn-bg)', color: 'var(--pn-text)' }} />
        <button onClick={send} disabled={busy}
          style={{ padding: '8px 18px', fontWeight: 800, fontSize: 13, borderRadius: 8, border: 'none', background: '#2D7A5F', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
      {!!sent && <div style={{ fontSize: 12, color: 'var(--pn-success)', fontWeight: 700, marginTop: 6 }}>✓ {sent}</div>}
    </div>
  );
}

function Recipients({ receipt, showToast }) {
  const [people, setPeople] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const appts = await fetchAppointmentsByIds(receipt.apptIds || []);
        const byKey = new Map();
        for (const a of appts) {
          const k = a.clientId || `w:${a.clientName || a.id}`;
          if (!byKey.has(k)) byKey.set(k, { clientId: a.clientId || null, name: a.clientName || 'Walk-in', contact: '' });
        }
        const arr = [...byKey.values()];
        await Promise.all(arr.map(async (p) => {
          if (!p.clientId) return;
          const c = await fetchClient(p.clientId).catch(() => null);
          if (c) { p.contact = c.phone || c.email || ''; p.name = c.name || p.name; }
        }));
        if (alive) setPeople(arr);
      } catch { if (alive) setPeople([]); }
    })();
    return () => { alive = false; };
  }, [receipt.id]);

  if (people === null) return <div style={{ fontSize: 12.5, color: 'var(--pn-text-faint)' }}>Loading recipients…</div>;
  if (people.length <= 1) return <ResendRow receipt={receipt} defaultContact={people[0]?.contact || receipt.clientPhone || receipt.clientEmail || ''} showToast={showToast} />;
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 6 }}>Combined sale — send to each person:</div>
      {people.map((p, i) => (
        <div key={p.clientId || `w${i}`} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4 }}>{p.name}</div>
          <ResendRow receipt={receipt} defaultContact={p.contact} showToast={showToast} />
        </div>
      ))}
    </div>
  );
}

function RefundModal({ receipt, onClose, onDone, showToast }) {
  const pay = receipt.payment || {};
  const original = Number(pay.total) || 0;
  const already = Number(receipt.refundedAmount) || 0;
  const remaining = Math.max(0, original - already);
  const isCard = pay.method === 'card' && !!pay.stripePaymentIntentId;
  const [amount, setAmount] = useState(remaining ? remaining.toFixed(2) : '');
  const [reason, setReason] = useState('');
  const [refundTo, setRefundTo] = useState('money');   // 'money' | 'credit'
  const [busy, setBusy] = useState(false);
  const [idem] = useState(newIdemKey);
  const mbtn = (on) => ({ flex: 1, padding: '9px 8px', borderRadius: 8, border: `1.5px solid ${on ? '#2D7A5F' : 'var(--pn-border)'}`, background: on ? 'var(--pn-success-bg)' : 'var(--pn-bg)', color: on ? 'var(--pn-success)' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' });

  async function submit() {
    const amt = Number(amount) || 0;
    if (amt <= 0) { showToast('Enter a refund amount'); return; }
    if (amt > remaining + 0.001) { showToast(`Refund can't exceed the remaining ${money(remaining)}.`); return; }
    if (!reason.trim()) { showToast('Add a reason for the refund.'); return; }
    setBusy(true);
    try {
      const res = await callFn('refundSale')({ tenantId: TENANT_ID, receiptId: receipt.id, amountCents: Math.round(amt * 100), reason: reason.trim(), refundTo, idempotencyKey: idem });
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
          <button onClick={() => setRefundTo('money')} style={mbtn(refundTo === 'money')}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>{isCard ? 'Back to card' : 'Cash'}</div>
            <div style={{ fontSize: 11, opacity: .7 }}>{isCard ? 'Stripe refund' : 'hand cash back'}</div>
          </button>
          {!!receipt.clientId && (
            <button onClick={() => setRefundTo('credit')} style={mbtn(refundTo === 'credit')}>
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
          <button onClick={() => setAmount(remaining.toFixed(2))} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>Full</button>
        </div>

        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Reason</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this being refunded?" rows={3} maxLength={400}
          style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 11px', fontSize: 13.5, background: 'var(--pn-bg)', color: 'var(--pn-text)', resize: 'vertical' }} />

        <button onClick={submit} disabled={busy || !(Number(amount) > 0) || !reason.trim()}
          style={{ width: '100%', marginTop: 18, padding: '12px', fontWeight: 800, fontSize: 14, borderRadius: 12, border: 'none', background: 'var(--pn-danger)', color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: (busy || !(Number(amount) > 0) || !reason.trim()) ? 0.5 : 1, fontFamily: 'inherit' }}>
          {busy ? 'Processing…' : refundTo === 'credit' ? `Give ${money(Number(amount) || 0)} credit` : isCard ? `Refund ${money(Number(amount) || 0)} to card` : `Record ${money(Number(amount) || 0)} refund`}
        </button>
        <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', textAlign: 'center', marginTop: 10 }}>Every refund alerts all admins (push, email, text) with your name.</div>
      </div>
    </div>
  );
}
