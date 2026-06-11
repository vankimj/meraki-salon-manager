// Financial ledger — an append-only, immutable record of EVERY money movement in
// the salon, so the year can be reconciled to the penny. Entries are written by
// Firestore triggers (sales/refunds, from the receipt itself) and by the
// adjustClientCredit callable (manual store-credit changes carry reason/who that
// only exist in the call). Each entry has a deterministic eventId so a trigger
// retry overwrites rather than double-counts. Written ONLY via Admin SDK; the
// rules make it client-read-only (admin) and never client-writable.

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Idempotent append: eventId is the doc id, so retries converge.
async function appendLedger(db, tenantId, eventId, entry) {
  const ref = db.doc(`tenants/${tenantId}/ledger/${String(eventId).slice(0, 200)}`);
  await ref.set({
    eventId,
    at: entry.at || new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    ...entry,
  }, { merge: true });
}

// A completed sale → one 'sale' entry (money/value IN). Captures the gross + the
// component breakdown (tip, tax, discount, credit + gift-card applied) so the
// ledger reconciles against the receipt.
function buildSaleEntry(receiptId, r) {
  const p = r.payment || {};
  const techName = r.techName
    || (Array.isArray(p.techSplit) ? p.techSplit.map(s => s.techName).filter(Boolean).join(', ') : '')
    || '';
  return {
    type: 'sale',
    at: p.paidAt || r.createdAt || new Date().toISOString(),
    amount: r2(p.total),
    direction: 'in',
    method: p.method || null,
    clientId: r.clientId || null,
    clientName: r.clientName || 'Walk-in',
    techName,
    by: p.paidBy || null,
    tip: r2(p.tip),
    tax: r2(p.tax),
    discountAmount: r2(p.discountAmount),
    creditApplied: r2(p.creditApplied),
    giftCardApplied: r2(p.giftCard && p.giftCard.applied),
    stripePaymentIntentId: p.stripePaymentIntentId || null,
    refReceiptId: receiptId,
    refViewToken: r.viewToken || receiptId,
    detail: `Sale $${r2(p.total).toFixed(2)} · ${r.clientName || 'Walk-in'}${p.method ? ' · ' + p.method : ''}${techName ? ' · ' + techName : ''}`,
  };
}

// A refund recorded on a receipt → one 'refund' entry (money/value OUT). Carries
// the destination (cash/card vs store credit) and the per-tech commission
// treatment (withhold vs goodwill) — the two things you'd audit on any refund.
function buildRefundEntry(receiptId, r, rf) {
  const dest = rf.addedCredit || rf.method === 'store_credit' ? 'credit' : 'money';
  return {
    type: 'refund',
    at: rf.refundedAt || new Date().toISOString(),
    amount: r2(rf.amount),
    direction: 'out',
    method: rf.method || (r.payment && r.payment.method) || null,
    refundDest: dest,
    commissionByTech: rf.commissionByTech || null,
    stripeRefundId: rf.stripeRefundId || null,
    clientId: r.clientId || null,
    clientName: r.clientName || 'Walk-in',
    techName: r.techName || '',
    by: rf.issuedBy || null,
    reason: rf.reason || '',
    refReceiptId: receiptId,
    refViewToken: r.viewToken || receiptId,
    refundKey: rf.key || null,
    detail: `Refund $${r2(rf.amount).toFixed(2)} (${dest === 'credit' ? 'store credit' : 'money back'}) · ${r.clientName || 'Walk-in'}${rf.reason ? ' · "' + rf.reason + '"' : ''}`,
  };
}

// A redo (service redone by another tech) → commission moves; record it.
function buildRedoEntry(receiptId, r, rd, i) {
  return {
    type: 'redo',
    at: rd.at || rd.redoneAt || new Date().toISOString(),
    amount: r2(rd.amount),
    direction: 'neutral',
    method: 'commission_transfer',
    clientId: r.clientId || null,
    clientName: r.clientName || 'Walk-in',
    techName: `${rd.fromTech || '—'} → ${rd.toTech || '—'}`,
    reason: rd.reason || '',
    refReceiptId: receiptId,
    refViewToken: r.viewToken || receiptId,
    redoIndex: i,
    detail: `Redo $${r2(rd.amount).toFixed(2)} · commission ${rd.fromTech || '—'} → ${rd.toTech || '—'}${rd.reason ? ' · "' + rd.reason + '"' : ''}`,
  };
}

module.exports = { appendLedger, buildSaleEntry, buildRefundEntry, buildRedoEntry, r2 };
