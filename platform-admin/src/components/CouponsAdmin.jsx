import { useEffect, useState } from 'react';
import {
  listCoupons, createCoupon, deleteCoupon,
  createPromotionCode, setPromotionCodeActive,
  discountLabel, durationLabel, fmtUnix,
} from '../lib/coupons.js';
import { C, FONT, radius } from '../theme.js';

export default function CouponsAdmin() {
  const [coupons, setCoupons] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try {
      setCoupons(await listCoupons());
    } catch (e) {
      setError(e?.message || 'Failed to load coupons.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function onDelete(id) {
    if (!window.confirm(`Delete coupon "${id}"?\n\nExisting subscriptions keep it; it just can't be applied to new ones.`)) return;
    try { await deleteCoupon(id); await load(); }
    catch (e) { setError(e?.message || 'Delete failed.'); }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px', color: C.ink, letterSpacing: '-.005em' }}>Coupons</h1>
          <div style={{ fontSize: 13, color: C.muted }}>
            {coupons ? `${coupons.length} coupon${coupons.length === 1 ? '' : 's'}` : 'Loading…'} on the platform Stripe account
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={btnGhost}>↻ Refresh</button>
          <button onClick={() => setShowNew(true)} style={btnPrimary}>+ New coupon</button>
        </div>
      </div>

      {error && <Banner>{error}</Banner>}

      <div style={{ background: C.bgCard, border: `1px solid ${C.rule}`, borderRadius: radius.lg, overflow: 'hidden' }}>
        {loading ? (
          <Empty>Loading coupons…</Empty>
        ) : !coupons || coupons.length === 0 ? (
          <Empty>No coupons yet. Create one to get started.</Empty>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.bgCode, borderBottom: `1px solid ${C.rule}` }}>
                <Th>Coupon</Th><Th>Discount</Th><Th>Duration</Th>
                <Th>Redemptions</Th><Th>Promo codes</Th><Th>Status</Th>
                <Th align="right" style={{ width: 60 }}></Th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c, i) => (
                <CouponRow key={c.id} c={c} zebra={i % 2 === 1} onDelete={onDelete} onChanged={load} setError={setError} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && <NewCouponModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} setError={setError} />}
    </>
  );
}

function CouponRow({ c, zebra, onDelete, onChanged, setError }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <tr style={{ borderBottom: `1px solid ${C.ruleSoft}`, background: zebra ? C.bgCode : 'transparent' }}>
        <Td>
          <div style={{ fontWeight: 600, color: C.ink }}>{c.name || c.id}</div>
          <code style={{ fontSize: 10, color: C.mutedSoft }}>{c.id}</code>
        </Td>
        <Td><strong style={{ color: C.plum }}>{discountLabel(c)}</strong></Td>
        <Td>{durationLabel(c)}</Td>
        <Td>
          {c.timesRedeemed}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}
          {c.redeemBy && <div style={{ fontSize: 10, color: C.mutedSoft }}>by {fmtUnix(c.redeemBy)}</div>}
        </Td>
        <Td>
          {c.promotionCodes.length === 0
            ? <span style={{ color: C.mutedSoft }}>—</span>
            : c.promotionCodes.map(p => (
                <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 6, marginBottom: 4 }}>
                  <code style={{
                    fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                    background: p.active ? C.successSoft : C.ruleSoft,
                    color:      p.active ? C.success     : C.muted,
                    textDecoration: p.active ? 'none' : 'line-through',
                  }}>{p.code}</code>
                  <button title={p.active ? 'Deactivate' : 'Activate'} onClick={async () => {
                    try { await setPromotionCodeActive(p.id, !p.active); onChanged(); }
                    catch (e) { setError(e?.message || 'Toggle failed.'); }
                  }} style={miniBtn}>{p.active ? '⏸' : '▶'}</button>
                </span>
              ))}
          <button onClick={() => setAdding(a => !a)} style={{ ...miniBtn, color: C.plum }}>+ code</button>
        </Td>
        <Td><StatusChip valid={c.valid} /></Td>
        <Td align="right">
          <button title="Delete coupon" onClick={() => onDelete(c.id)} style={{ ...miniBtn, color: C.danger }}>🗑</button>
        </Td>
      </tr>
      {adding && (
        <tr style={{ background: C.bgCode }}>
          <td colSpan={7} style={{ padding: '10px 14px' }}>
            <AddPromoForm couponId={c.id} onDone={() => { setAdding(false); onChanged(); }} setError={setError} />
          </td>
        </tr>
      )}
    </>
  );
}

function AddPromoForm({ couponId, onDone, setError }) {
  const [code, setCode] = useState('');
  const [max,  setMax]  = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError('');
    try {
      await createPromotionCode({ couponId, code: code.trim() || undefined, maxRedemptions: max || undefined });
      onDone();
    } catch (e) { setError(e?.message || 'Could not create promo code.'); }
    finally     { setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: C.muted }}>Promo code for <code>{couponId}</code>:</span>
      <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="AUTO (blank = random)" style={input} />
      <input value={max} onChange={e => setMax(e.target.value.replace(/\D/g, ''))} placeholder="Max uses (opt)" style={{ ...input, width: 120 }} />
      <button onClick={submit} disabled={busy} style={btnPrimary}>{busy ? 'Adding…' : 'Add code'}</button>
      <button onClick={onDone} style={btnGhost}>Cancel</button>
    </div>
  );
}

function NewCouponModal({ onClose, onCreated, setError }) {
  const [kind,     setKind]     = useState('percent'); // percent | amount
  const [percent,  setPercent]  = useState('100');
  const [amount,   setAmount]   = useState('');
  const [duration, setDuration] = useState('repeating');
  const [months,   setMonths]   = useState('6');
  const [name,     setName]     = useState('');
  const [id,       setId]       = useState('');
  const [maxR,     setMaxR]     = useState('');
  const [busy,     setBusy]     = useState(false);
  const [localErr, setLocalErr] = useState('');

  async function submit() {
    setBusy(true); setLocalErr(''); setError('');
    try {
      await createCoupon({
        percentOff:       kind === 'percent' ? Number(percent) : undefined,
        amountOff:        kind === 'amount'  ? Math.round(Number(amount) * 100) : undefined,
        currency:         kind === 'amount'  ? 'usd' : undefined,
        duration,
        durationInMonths: duration === 'repeating' ? Number(months) : undefined,
        name:             name.trim() || undefined,
        id:               id.trim() || undefined,
        maxRedemptions:   maxR || undefined,
      });
      onCreated();
    } catch (e) {
      setLocalErr(e?.message || 'Stripe rejected the coupon.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="New coupon">
      <Field label="Discount type">
        <Seg value={kind} onChange={setKind} options={[['percent', 'Percent off'], ['amount', 'Amount off ($)']]} />
      </Field>
      {kind === 'percent' ? (
        <Field label="Percent off (1–100)">
          <input value={percent} onChange={e => setPercent(e.target.value.replace(/[^\d.]/g, ''))} style={input} />
        </Field>
      ) : (
        <Field label="Amount off (USD)">
          <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 10.00" style={input} />
        </Field>
      )}
      <Field label="Duration">
        <Seg value={duration} onChange={setDuration} options={[['once', 'Once'], ['repeating', 'Repeating'], ['forever', 'Forever']]} />
      </Field>
      {duration === 'repeating' && (
        <Field label="Number of months">
          <input value={months} onChange={e => setMonths(e.target.value.replace(/\D/g, ''))} style={input} />
        </Field>
      )}
      <Field label="Name (shown on invoices, optional)">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Starter 6 Months Free" style={input} />
      </Field>
      <Field label="Coupon ID (optional — leave blank for random)">
        <input value={id} onChange={e => setId(e.target.value.replace(/\s/g, ''))} placeholder="e.g. STARTER6FREE" style={{ ...input, fontFamily: FONT.mono }} />
      </Field>
      <Field label="Max total redemptions (optional)">
        <input value={maxR} onChange={e => setMaxR(e.target.value.replace(/\D/g, ''))} placeholder="unlimited" style={input} />
      </Field>

      {localErr && <div style={{ fontSize: 12, color: C.danger, margin: '4px 0 8px' }}>{localErr}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button onClick={onClose} style={btnGhost}>Cancel</button>
        <button onClick={submit} disabled={busy} style={btnPrimary}>{busy ? 'Creating…' : 'Create coupon'}</button>
      </div>
    </Modal>
  );
}

// ── small shared UI bits ─────────────────────────────────
function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,25,35,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 460, width: '100%', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.rule}`, background: C.bgCode, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: C.muted, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.mutedSoft, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

function Seg({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${C.rule}`, borderRadius: 8, overflow: 'hidden' }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} style={{
          padding: '7px 13px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          background: value === v ? C.plum : '#fff', color: value === v ? '#fff' : C.muted,
        }}>{label}</button>
      ))}
    </div>
  );
}

function StatusChip({ valid }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      background: valid ? C.successSoft : C.ruleSoft, color: valid ? C.success : C.muted,
      textTransform: 'uppercase', letterSpacing: '.05em',
    }}>{valid ? 'Valid' : 'Expired'}</span>
  );
}

function Banner({ children }) {
  return <div style={{ padding: '10px 14px', marginBottom: 16, background: C.dangerSoft, border: `1px solid ${C.danger}40`, borderRadius: 8, fontSize: 13, color: '#991b1b' }}>{children}</div>;
}
function Th({ children, align = 'left', style = {} }) {
  return <th style={{ textAlign: align, padding: '10px 14px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', ...style }}>{children}</th>;
}
function Td({ children, align = 'left' }) {
  return <td style={{ padding: '10px 14px', textAlign: align, verticalAlign: 'middle' }}>{children}</td>;
}
function Empty({ children }) {
  return <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>{children}</div>;
}

const btnPrimary = { padding: '8px 14px', fontSize: 13, fontWeight: 600, background: C.plum, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost   = { padding: '8px 14px', fontSize: 13, fontWeight: 600, background: C.bgCard, color: C.text, border: `1px solid ${C.rule}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' };
const miniBtn    = { padding: '1px 6px', fontSize: 11, fontWeight: 600, background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' };
const input      = { padding: '8px 12px', fontSize: 13, border: `1px solid ${C.rule}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' };
