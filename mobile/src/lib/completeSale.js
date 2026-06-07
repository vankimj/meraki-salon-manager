import { buildTechSplit, genReceiptToken } from './checkout';
import { updateAppointment, updateGiftCard, savePromoCode, saveProduct, createReceipt, fetchClient, saveClient, claimSaleSideEffects } from './firestore';

// Writes a completed sale, shared by the tech checkout (CheckoutScreen) and the
// front-desk kiosk so both produce IDENTICAL receipts (no duplicated money
// logic). Marks each appt done with payment, applies gift-card / promo / stock
// side effects, and writes the canonical receipt — which carries apptIds (so
// Reports counts it once, not double with the done appts) and clientPhone (which
// fires sendReceiptSms). Pure of UI: the caller handles toasts + clearing the tab.
//
// `totals` is the already-resolved totals object (cash or card) from computeTotals.
// `cashTendered` (optional) records the cash given + computes changeDue on the receipt.
// `saleId` (a stable per-checkout key) makes the receipt idempotent — a retried
// completeSale (after a transient write failure) overwrites the same receipt
// instead of double-counting revenue. `skipSideEffects` is set on a retry so the
// non-idempotent side effects (gift-card debit, promo count, stock) run exactly
// once. Side effects are best-effort: a failure there (e.g. a non-admin can't
// write gift cards) is collected, never thrown — it must not block recording a
// sale whose money is already captured.
export async function completeSale({
  tab, lines, products = [], totals, settings = {}, email = null,
  method = 'cash', stripePaymentIntentId = null,
  discType = 'none', discVal = 0, promo = null, giftCard = null,
  cashTendered = null, saleId = null, skipSideEffects = false,
  receiptContact = null, issueCredit = 0, tipByTech = null,
  cardBrand = null, cardLast4 = null,
}) {
  const t = totals;
  const sp = buildTechSplit(lines, t.tipAmt, tipByTech);
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
    ...(cardBrand ? { cardBrand, cardLast4: cardLast4 || null } : {}),
    ...(cashTendered != null ? { cashTendered: Number(cashTendered) || 0, changeDue } : {}),
    techSplit: sp,
    apptIds: (tab.appts || []).map(a => a.id),
    paidAt: new Date().toISOString(), paidBy: email || null,
  };

  // Non-idempotent side effects FIRST, exactly once, best-effort: never throw —
  // money may already be captured, so a side-effect failure must not block
  // recording the sale below. Collected + returned. `skipSideEffects` is the
  // in-memory retry guard; claimSaleSideEffects is the DURABLE guard — it stops
  // an offline-queue replay (side effects committed, critical write failed →
  // sale replayed) from double-applying credit / gift-card / stock writes.
  const sideEffectErrors = [];
  let runSideEffects = !skipSideEffects;
  if (runSideEffects && saleId) runSideEffects = await claimSaleSideEffects(saleId);
  if (runSideEffects) {
    if (giftCard && t.gcApply > 0) {
      try { await updateGiftCard(giftCard.id, { balance: Math.max((giftCard.balance || 0) - t.gcApply, 0) }); }
      catch (e) { sideEffectErrors.push('Gift card not debited: ' + (e?.message || 'failed')); }
    }
    if (promo) {
      try {
        const newCount = (promo.usedCount || 0) + 1;
        const maxHit = promo.maxUses && newCount >= promo.maxUses;
        await savePromoCode(promo.id, { usedCount: newCount, ...((promo.singleUse || maxHit) ? { active: false } : {}) });
      } catch (e) { sideEffectErrors.push('Promo not updated: ' + (e?.message || 'failed')); }
    }
    for (const it of products) {
      await saveProduct(it.product.id, { stock: Math.max(0, (Number(it.product.stock) || 0) - it.qty) }).catch(() => {});
    }
    // Client store-credit bookkeeping, in ONE write (mirrors web): deduct
    // exactly what the totals applied, then add any staff-issued goodwill
    // credit. Best-effort + retry-guarded (skipSideEffects) so a re-save never
    // double-deducts or double-issues.
    const issued = Number(issueCredit) || 0;
    const creditClientId = (tab.appts || []).map(a => a.clientId).find(Boolean) || null;
    if ((t.creditApply > 0 || issued > 0) && creditClientId) {
      try {
        const c = await fetchClient(creditClientId);
        const newCredit = Math.max((Number(c?.credit) || 0) - t.creditApply, 0) + issued;
        await saveClient(creditClientId, { credit: newCredit });
      } catch (e) { sideEffectErrors.push('Store credit not updated: ' + (e?.message || 'failed')); }
    }
  }

  // Critical, idempotent records. Appt updates use setDoc(merge) and the receipt
  // uses the stable saleId, so a retry overwrites rather than duplicates.
  for (let apptIdx = 0; apptIdx < (tab.appts || []).length; apptIdx++) {
    const a = tab.appts[apptIdx];
    const svc = (a.services || []).map((s, svcIdx) => {
      const li = lines.findIndex(l => l.apptIdx === apptIdx && l.svcIdx === svcIdx);
      return { ...s, price: li >= 0 ? lines[li].price : (Number(s.price) || 0), techName: li >= 0 ? lines[li].techName : s.techName };
    });
    const apptSubtotal = svc.reduce((s, x) => s + (Number(x.price) || 0), 0);
    await updateAppointment(a.id, { services: svc, status: 'done', payment: { ...payment, amountForThisAppt: apptSubtotal } });
  }

  const primaryAppt = (tab.appts || [])[0] || null;
  const clientNames = Array.from(new Set((tab.appts || []).map(a => a.clientName || 'Walk-in').filter(Boolean)));
  const allServices = lines.map(l => ({ name: l.name, price: l.price, techName: l.techName }));
  let clientEmail = null;
  try { if (primaryAppt?.clientId) clientEmail = (await fetchClient(primaryAppt.clientId))?.email || null; } catch (_) {}
  // A walk-in (no client on file) can still get a texted/emailed receipt by
  // entering their contact at the kiosk. The contact entered for THIS sale wins
  // over anything on the appt/client — server normalizes the phone + fires the
  // sendReceiptSms / sendReceiptEmail triggers off these two fields.
  const contactPhone = (receiptContact?.phone || '').trim();
  const contactEmail = (receiptContact?.email || '').trim();
  await createReceipt({
    clientId:    primaryAppt?.clientId || null,
    clientName:  clientNames.join(' + ') || 'Walk-in',
    clientPhone: contactPhone || primaryAppt?.clientPhone || null,
    clientEmail: contactEmail || clientEmail,
    viewToken:   saleId || genReceiptToken(22),
    techName:    sp ? sp.map(s => s.techName).join(', ') : (allServices[0]?.techName || ''),
    date:        primaryAppt?.date || new Date().toISOString().slice(0, 10),
    startTime:   primaryAppt?.startTime || '',
    services:    allServices,
    retailProducts,
    payment,
    apptIds:     (tab.appts || []).map(a => a.id),
  }, saleId);

  return { total: t.total, changeDue, split: sp, sideEffectErrors };
}
