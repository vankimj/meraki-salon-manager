// Pure checkout math — ported VERBATIM from the web CheckoutModal
// (src/modules/checkout/CheckoutModal.jsx) so mobile and web price a sale
// identically. This is money math: do not re-derive, only copy. Unit-tested.

// Compute every derived total for a sale.
//
// input:
//   lines:        [{ price:Number, taxable?:bool }]   // one per service line (edited prices)
//   productsTotal, gcSalesTotal: Number               // retail + gift-cards-sold (0 until those land)
//   discount:     { isPercent:bool, value:Number } | null
//   promo:        { type:'percent'|'amount', value:Number } | null
//   taxRate:      Number   // percent, e.g. 7.5
//   ccFeePct, ccFeeFlat: Number
//   method:       'cash' | 'card'
//   noCardTips:   bool
//   tip:          { custom:bool, amount:Number, pct:Number|null }
//   giftCardBalance: Number  applyGC: bool
//   clientCredit:    Number  applyCredit: bool
export function computeTotals(input) {
  const {
    lines = [], productsTotal = 0, gcSalesTotal = 0,
    discount = null, promo = null, taxRate = 0,
    ccFeePct = 0, ccFeeFlat = 0, method = 'cash', noCardTips = false,
    tip = { custom: false, amount: 0, pct: null },
    giftCardBalance = 0, applyGC = false,
    clientCredit = 0, applyCredit = false,
  } = input || {};

  const r2 = (n) => Math.round(n * 100) / 100;
  const servicesTotal = lines.reduce((s, l) => s + (Number(l.price) || 0), 0);
  const subtotal = servicesTotal + productsTotal + gcSalesTotal;

  const discountAmount = (!discount || !discount.value) ? 0
    : discount.isPercent ? r2(subtotal * (Number(discount.value) || 0) / 100)
    : Math.min(Number(discount.value) || 0, subtotal);

  const promoAmount = !promo ? 0
    : promo.type === 'percent' ? r2(subtotal * (Number(promo.value) || 0) / 100)
    : Math.min(Number(promo.value) || 0, subtotal);

  const afterDiscounts = Math.max(subtotal - discountAmount - promoAmount, 0);

  // Tax on the post-discount taxable base. Gift-card sales + lines flagged
  // taxable:false are excluded.
  const nonTaxableServiceTotal = lines.reduce((s, l) => l.taxable === false ? s + (Number(l.price) || 0) : s, 0);
  const taxableSubtotal  = Math.max(subtotal - gcSalesTotal - nonTaxableServiceTotal, 0);
  const taxableShare     = subtotal > 0 ? taxableSubtotal / subtotal : 0;
  const taxableAfterDisc = Math.max(taxableSubtotal - (discountAmount + promoAmount) * taxableShare, 0);
  const taxAmt           = Math.round(taxableAfterDisc * (Number(taxRate) || 0)) / 100;

  const billBeforeTip = afterDiscounts + taxAmt;
  const tipsDisabled  = method === 'card' && noCardTips;
  const tipAmt = tipsDisabled ? 0
    : tip.custom ? (Number(tip.amount) || 0)
    : (tip.pct ? Math.round(subtotal * tip.pct) / 100 : 0);

  const gcApply     = applyGC && giftCardBalance > 0 ? Math.min(giftCardBalance, billBeforeTip) : 0;
  const creditApply = applyCredit && clientCredit > 0 ? Math.min(clientCredit, billBeforeTip - gcApply) : 0;
  const charged     = Math.max(billBeforeTip - gcApply - creditApply, 0);
  const total       = charged + tipAmt;
  const ccFee       = method === 'card' && total > 0 ? r2(total * ccFeePct / 100 + ccFeeFlat) : 0;

  return { subtotal, discountAmount, promoAmount, afterDiscounts, taxAmt, billBeforeTip, tipAmt, gcApply, creditApply, charged, total, ccFee };
}

// Per-tech revenue split + tip allocated by revenue ratio. Returns null for a
// single tech (no split needed). `lines` carry { price, techName }. Last entry
// absorbs rounding so tipShares sum EXACTLY to tipAmt.
export function buildTechSplit(lines, tipAmt) {
  const splitMap = {};
  (lines || []).forEach(l => {
    const t = l.techName || '';
    if (!splitMap[t]) splitMap[t] = { revenue: 0, services: [] };
    splitMap[t].revenue += Number(l.price) || 0;
    splitMap[t].services.push(l.name || '—');
  });
  const entries = Object.entries(splitMap);
  if (entries.length <= 1) return null;
  const totalRev = entries.reduce((s, [, d]) => s + d.revenue, 0);
  let allocated = 0;
  return entries.map(([techName, d], i) => {
    const ratio = totalRev > 0 ? d.revenue / totalRev : 1 / entries.length;
    let tipShare;
    if (i === entries.length - 1) tipShare = Math.round((tipAmt - allocated) * 100) / 100;
    else { tipShare = Math.round(ratio * tipAmt * 100) / 100; allocated += tipShare; }
    return { techName, revenue: d.revenue, services: d.services, tipShare };
  });
}

// Opaque URL-safe token for the hosted /r/{token} receipt page (mirrors web
// genUrlSafeToken). It is the ONLY secret gating that PUBLIC, unauthenticated
// page (which returns client PII), so it MUST come from a CSPRNG: Math.random()
// (xorshift128+) is state-recoverable from a few observed tokens, letting an
// attacker predict other clients' receipt links. expo-crypto's getRandomBytes is
// the native CSPRNG (already a dep). The 64-char alphabet is 2^6, so `byte & 63`
// maps uniformly with no modulo bias. Lazy-require so the pure module still
// imports in node/test contexts; fall back to Math.random only if the native
// module is somehow unavailable (e.g. before a rebuild).
export function genReceiptToken(len = 22) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  try {
    const bytes = require('expo-crypto').getRandomBytes(len);
    let s = '';
    for (let i = 0; i < len; i++) s += alphabet[bytes[i] & 63];
    return s;
  } catch (_) {
    let s = '';
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
  }
}

// Turn a single free-text receipt-contact field (the kiosk / checkout "text or
// email my receipt" input) into the { phone, email } shape completeSale wants.
// A value containing "@" is treated as an email; anything else as a phone (the
// server normalizes the digits). Returns null when blank so callers can pass it
// straight through. Whitespace-only and a bare "@" are both treated as empty.
export function parseReceiptContact(raw) {
  const v = (raw || '').trim();
  if (!v) return null;
  if (v.includes('@')) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? { email: v } : null;
  }
  return /\d/.test(v) ? { phone: v } : null;
}

// Normalize a mobile promo record ({type, discountPct, discountAmount}) into
// the {type, value} shape computeTotals expects.
export function normalizePromo(p) {
  if (!p) return null;
  return { type: p.type === 'amount' ? 'amount' : 'percent',
           value: p.type === 'amount' ? (Number(p.discountAmount) || 0) : (Number(p.discountPct) || 0),
           code: p.code, id: p.id, singleUse: p.singleUse, maxUses: p.maxUses, usedCount: p.usedCount };
}
