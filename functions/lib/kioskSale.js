// Server-side port of the pure money math from mobile/src/lib/checkout.js
// (computeTotals + buildTechSplit). recordKioskSale uses these to RECOMPUTE the
// bill from the tech-authored checkoutSession — never trusting amounts the kiosk
// sends — so a compromised kiosk can't under/over-charge or skim a tip split.
// MUST stay in sync with mobile/src/lib/checkout.js. Kiosk carts never carry
// promo or gift-card redemption (kioskHandoffAvailable gates them out), so those
// branches are intentionally dropped here.

const r2 = (n) => Math.round(n * 100) / 100;

function computeTotals(input) {
  const {
    lines = [], productsTotal = 0,
    discount = null, taxRate = 0,
    ccFeePct = 0, ccFeeFlat = 0, method = 'cash', noCardTips = false,
    tip = { custom: false, amount: 0, pct: null },
    clientCredit = 0, applyCredit = false,
  } = input || {};

  const servicesTotal = lines.reduce((s, l) => s + (Number(l.price) || 0), 0);
  const subtotal = servicesTotal + productsTotal;

  const discountAmount = (!discount || !discount.value) ? 0
    : discount.isPercent ? r2(subtotal * (Number(discount.value) || 0) / 100)
    : Math.min(Number(discount.value) || 0, subtotal);

  const afterDiscounts = Math.max(subtotal - discountAmount, 0);

  const nonTaxableServiceTotal = lines.reduce((s, l) => l.taxable === false ? s + (Number(l.price) || 0) : s, 0);
  const taxableSubtotal  = Math.max(subtotal - nonTaxableServiceTotal, 0);
  const taxableShare     = subtotal > 0 ? taxableSubtotal / subtotal : 0;
  const taxableAfterDisc = Math.max(taxableSubtotal - discountAmount * taxableShare, 0);
  const taxAmt           = Math.round(taxableAfterDisc * (Number(taxRate) || 0)) / 100;

  const billBeforeTip = afterDiscounts + taxAmt;
  const tipsDisabled  = method === 'card' && noCardTips;
  const tipAmt = tipsDisabled ? 0
    : tip.custom ? (Number(tip.amount) || 0)
    : (tip.pct ? Math.round(subtotal * tip.pct) / 100 : 0);

  const creditApply = applyCredit && clientCredit > 0 ? Math.min(clientCredit, billBeforeTip) : 0;
  const charged     = Math.max(billBeforeTip - creditApply, 0);
  const total       = charged + tipAmt;
  const ccFee       = method === 'card' && total > 0 ? r2(total * ccFeePct / 100 + ccFeeFlat) : 0;

  return { subtotal, discountAmount, afterDiscounts, taxAmt, billBeforeTip, tipAmt, creditApply, charged, total, ccFee };
}

function buildTechSplit(lines, tipAmt, tipByTech = null) {
  const splitMap = {};
  (lines || []).forEach(l => {
    const t = l.techName || '';
    if (!splitMap[t]) splitMap[t] = { revenue: 0, services: [] };
    splitMap[t].revenue += Number(l.price) || 0;
    splitMap[t].services.push(l.name || '—');
  });
  const entries = Object.entries(splitMap);
  if (entries.length <= 1) return null;

  if (Array.isArray(tipByTech) && tipByTech.length) {
    const m = {};
    tipByTech.forEach(t => { const k = t.techName || ''; m[k] = (m[k] || 0) + (Number(t.amount) || 0); });
    return entries.map(([techName, d]) => {
      const tipShare = Math.round((m[techName] || 0) * 100) / 100;
      return { techName, revenue: d.revenue, services: d.services, tipShare, tip: tipShare };
    });
  }

  const totalRev = entries.reduce((s, [, d]) => s + d.revenue, 0);
  let allocated = 0;
  return entries.map(([techName, d], i) => {
    const ratio = totalRev > 0 ? d.revenue / totalRev : 1 / entries.length;
    let tipShare;
    if (i === entries.length - 1) tipShare = Math.round((tipAmt - allocated) * 100) / 100;
    else { tipShare = Math.round(ratio * tipAmt * 100) / 100; allocated += tipShare; }
    return { techName, revenue: d.revenue, services: d.services, tipShare, tip: tipShare };
  });
}

// Flatten a checkoutSession cart's appts into priced service `lines`.
function linesFromCart(cart) {
  const lines = [];
  for (const a of (cart?.appts || [])) {
    for (const s of (a.services || [])) {
      lines.push({ name: s.name || '—', price: Number(s.price) || 0, techName: s.techName || a.techName || '', taxable: s.taxable !== false });
    }
  }
  return lines;
}

module.exports = { computeTotals, buildTechSplit, linesFromCart, r2 };
