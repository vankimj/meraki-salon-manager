import { buildTechSplit, genReceiptToken } from './checkout';
import { updateAppointment, updateGiftCard, savePromoCode, saveProduct, createReceipt, fetchClient } from './firestore';

// Writes a completed sale, shared by the tech checkout (CheckoutScreen) and the
// front-desk kiosk so both produce IDENTICAL receipts (no duplicated money
// logic). Marks each appt done with payment, applies gift-card / promo / stock
// side effects, and writes the canonical receipt — which carries apptIds (so
// Reports counts it once, not double with the done appts) and clientPhone (which
// fires sendReceiptSms). Pure of UI: the caller handles toasts + clearing the tab.
//
// `totals` is the already-resolved totals object (cash or card) from computeTotals.
// `cashTendered` (optional) records the cash given + computes changeDue on the receipt.
export async function completeSale({
  tab, lines, products = [], totals, settings = {}, email = null,
  method = 'cash', stripePaymentIntentId = null,
  discType = 'none', discVal = 0, promo = null, giftCard = null,
  cashTendered = null,
}) {
  const t = totals;
  const sp = buildTechSplit(lines, t.tipAmt);
  const retailProducts = products.length > 0
    ? products.map(it => ({ id: it.product.id, name: it.product.name, price: it.product.price, qty: it.qty }))
    : null;
  const changeDue = (method === 'cash' && cashTendered != null)
    ? Math.max(0, (Number(cashTendered) || 0) - t.total)
    : null;

  const payment = {
    retailProducts,
    subtotal: t.subtotal,
    discountType: discType === 'none' ? null : discType,
    discountValue: Number(discVal) || 0,
    discountAmount: t.discountAmount,
    promoCode: promo ? promo.code : null,
    promoAmount: t.promoAmount,
    tax: t.taxAmt, taxRate: Number(settings?.taxRate) || 0,
    giftCard: giftCard && t.gcApply > 0 ? { code: giftCard.code, id: giftCard.id, applied: t.gcApply } : null,
    creditApplied: t.creditApply,
    charged: t.charged, tip: t.tipAmt, total: t.total,
    method, ccFee: t.ccFee,
    ccFeePct: Number(settings?.ccFeePct) || 0, ccFeeFlat: Number(settings?.ccFeeFlat) || 0,
    stripePaymentIntentId: stripePaymentIntentId || null,
    ...(cashTendered != null ? { cashTendered: Number(cashTendered) || 0, changeDue } : {}),
    techSplit: sp,
    apptIds: (tab.appts || []).map(a => a.id),
    paidAt: new Date().toISOString(), paidBy: email || null,
  };

  // Reconstruct each appt's services with edited prices; mark done + attach payment.
  for (let apptIdx = 0; apptIdx < (tab.appts || []).length; apptIdx++) {
    const a = tab.appts[apptIdx];
    const svc = (a.services || []).map((s, svcIdx) => {
      const li = lines.findIndex(l => l.apptIdx === apptIdx && l.svcIdx === svcIdx);
      return { ...s, price: li >= 0 ? lines[li].price : (Number(s.price) || 0), techName: li >= 0 ? lines[li].techName : s.techName };
    });
    const apptSubtotal = svc.reduce((s, x) => s + (Number(x.price) || 0), 0);
    await updateAppointment(a.id, { services: svc, status: 'done', payment: { ...payment, amountForThisAppt: apptSubtotal } });
  }

  if (giftCard && t.gcApply > 0) {
    await updateGiftCard(giftCard.id, { balance: Math.max((giftCard.balance || 0) - t.gcApply, 0) });
  }
  if (promo) {
    const newCount = (promo.usedCount || 0) + 1;
    const maxHit = promo.maxUses && newCount >= promo.maxUses;
    await savePromoCode(promo.id, { usedCount: newCount, ...((promo.singleUse || maxHit) ? { active: false } : {}) });
  }
  for (const it of products) {
    await saveProduct(it.product.id, { stock: Math.max(0, (Number(it.product.stock) || 0) - it.qty) }).catch(() => {});
  }

  const primaryAppt = (tab.appts || [])[0] || null;
  const clientNames = Array.from(new Set((tab.appts || []).map(a => a.clientName || 'Walk-in').filter(Boolean)));
  const allServices = lines.map(l => ({ name: l.name, price: l.price, techName: l.techName }));
  let clientEmail = null;
  try { if (primaryAppt?.clientId) clientEmail = (await fetchClient(primaryAppt.clientId))?.email || null; } catch (_) {}
  await createReceipt({
    clientId:    primaryAppt?.clientId || null,
    clientName:  clientNames.join(' + ') || 'Walk-in',
    clientPhone: primaryAppt?.clientPhone || null,
    clientEmail,
    viewToken:   genReceiptToken(22),
    techName:    sp ? sp.map(s => s.techName).join(', ') : (allServices[0]?.techName || ''),
    date:        primaryAppt?.date || new Date().toISOString().slice(0, 10),
    startTime:   primaryAppt?.startTime || '',
    services:    allServices,
    retailProducts,
    payment,
    apptIds:     (tab.appts || []).map(a => a.id),
  });

  return { total: t.total, changeDue, split: sp };
}
