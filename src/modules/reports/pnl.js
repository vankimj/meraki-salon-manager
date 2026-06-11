// Accountant-grade Profit & Loss. Pure functions, no I/O — fully unit-tested.
//
// Revenue-recognition rules (documented so an accountant can verify, and
// surfaced as a methodology note in the UI):
//   • Revenue EXCLUDES sales tax (a liability owed to the state) and tips
//     (a pass-through paid to staff) — never income. Both shown as memo lines.
//   • Refunds reduce revenue (contra-revenue), not expense.
//   • Discounts/promos reduce revenue (we recognize the net amount earned).
//   • Gift cards:
//       cash basis    — a gift-card SALE is revenue when sold; redeeming a gift
//                       card later is NOT re-counted (the cash came in at sale).
//       accrual basis — a gift-card sale is deferred (a liability); revenue is
//                       recognized when the service/retail is delivered.
//   • Store credit: issuing it (refund-to-credit) reduces revenue; redeeming it
//       is delivered service/retail — counted under accrual, not re-counted as
//       cash under cash basis (no new cash moved).
//   • Labor:
//       cash basis    — payroll runs + bonuses actually PAID in the period.
//       accrual basis — commission EARNED in the period + bonuses.
//   • COGS — retail product cost × qty (captured cost on the line, else the
//       product's current cost). Service has no COGS here.
//   • Operating expenses — from the manual expense ledger, by category.

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function num(n) { return Number(n) || 0; }

// Pull the money components out of one transaction (receipt-shaped). Signs are
// POSITIVE magnitudes; `isRefund` flags direction. Voids/cancellations carry no
// money and are filtered out before this is called.
export function txComponents(t) {
  const p = t.payment || {};
  const serviceRev = (t.services || []).reduce((s, sv) => s + num(sv.price), 0);
  const retailItems = (t.retailProducts || []).map(x => ({ id: x.id || null, qty: num(x.qty) || 1, price: num(x.price) }));
  const retailRev  = retailItems.reduce((s, x) => s + x.price * x.qty, 0);
  const giftCardSold = num(p.gcSalesTotal) || (t.giftCardsSold || []).reduce((s, g) => s + num(g.amount), 0);
  return {
    isRefund:      t.transactionType === 'refund',
    serviceRev, retailRev, retailItems,
    discount:      num(p.discountAmount) + num(p.promoAmount),
    tax:           num(p.tax),
    tip:           num(p.tip),
    ccFee:         num(p.ccFee),
    giftCardSold,
    paidByGiftCard: num(p.giftCard?.applied),
    paidByCredit:   num(p.creditApplied),
  };
}

// Revenue recognized for one transaction under the given basis. Excludes tax +
// tips always. Refund magnitudes are returned positive; caller subtracts.
export function txRevenue(c, basis) {
  // Earned value delivered = service + retail, net of discounts.
  const earned = Math.max(0, c.serviceRev + c.retailRev - c.discount);
  if (basis === 'accrual') {
    // Recognize delivered service/retail; gift-card sale is deferred (excluded).
    return earned;
  }
  // cash: cash received for revenue = earned, minus value paid by
  // already-banked gift card / store credit, plus gift cards sold now.
  return earned - c.paidByGiftCard - c.paidByCredit + c.giftCardSold;
}

// Retail COGS for one transaction — cost × qty, captured cost preferred, else
// the product's current cost (productCostById map).
export function txCogs(c, t, productCostById = {}) {
  return (t.retailProducts || []).reduce((s, x) => {
    const cost = x.cost != null ? num(x.cost) : num(productCostById[x.id]);
    return s + cost * (num(x.qty) || 1);
  }, 0);
}

// Sum labor paid (cash) or earned (accrual) within the period.
//   payrollRuns: [{ paidDate|date, total|amount }]  (cash — what left the bank)
//   bonuses:     [{ date|createdAt, amount }]
//   commissionEarned: number (accrual — computed by caller from the period's
//                     receipts, e.g. sum of tech commission slices)
function laborTotal({ basis, payrollRuns = [], bonuses = [], commissionEarned = 0, startDate, endDate }) {
  const inRange = (d) => d && String(d).slice(0, 10) >= startDate && String(d).slice(0, 10) <= endDate;
  const bonusPaid = bonuses
    .filter(b => inRange(b.paidDate || b.date || b.createdAt))
    .reduce((s, b) => s + num(b.amount), 0);
  if (basis === 'accrual') {
    return { commissions: r2(commissionEarned), bonuses: r2(bonusPaid), total: r2(commissionEarned + bonusPaid) };
  }
  const payrollPaid = payrollRuns
    .filter(pr => inRange(pr.paidDate || pr.date || pr.createdAt))
    .reduce((s, pr) => s + num(pr.total ?? pr.amount ?? pr.netPay), 0);
  return { commissions: r2(payrollPaid), bonuses: r2(bonusPaid), total: r2(payrollPaid + bonusPaid) };
}

// Build the full P&L statement.
//   transactions: receipt-shaped rows for the period (sales + refunds; voids/
//                 cancellations should already be excluded by the caller).
//   expenses:     manual operating-expense rows [{ category, amount, date }].
//   opts: { basis, payrollRuns, bonuses, commissionEarned, productCostById,
//           startDate, endDate }
export function computePnl(transactions, expenses, opts = {}) {
  const basis = opts.basis === 'accrual' ? 'accrual' : 'cash';
  const txns = (transactions || []).filter(t =>
    t && (!t.transactionType || t.transactionType === 'sale' || t.transactionType === 'refund'));

  let serviceRev = 0, retailRev = 0, refunds = 0, cogs = 0;
  let tax = 0, tips = 0, processingFees = 0, giftCardsSold = 0;
  txns.forEach(t => {
    const c = txComponents(t);
    const sign = c.isRefund ? -1 : 1;
    const rev = txRevenue(c, basis);
    if (c.isRefund) refunds += Math.abs(rev);
    else {
      // Split the recognized revenue back into service/retail proportionally for
      // display (the recognized total is what matters for the P&L math).
      const base = c.serviceRev + c.retailRev || 1;
      serviceRev += rev * (c.serviceRev / base);
      retailRev  += rev * (c.retailRev / base);
    }
    cogs           += sign * txCogs(c, t, opts.productCostById);
    tax            += sign * c.tax;
    tips           += sign * c.tip;
    processingFees += sign * c.ccFee;
    if (!c.isRefund) giftCardsSold += c.giftCardSold;
  });

  const netRevenue = r2(serviceRev + retailRev - refunds);
  cogs = r2(Math.max(0, cogs));
  const grossProfit = r2(netRevenue - cogs);

  const labor = laborTotal({
    basis, payrollRuns: opts.payrollRuns, bonuses: opts.bonuses,
    commissionEarned: opts.commissionEarned || 0,
    startDate: opts.startDate, endDate: opts.endDate,
  });

  const byCategory = {};
  (expenses || []).forEach(e => {
    const k = e.category || 'Other';
    byCategory[k] = r2((byCategory[k] || 0) + num(e.amount));
  });
  const manualOpex = r2(Object.values(byCategory).reduce((s, v) => s + v, 0));

  const totalOpex = r2(labor.total + r2(processingFees) + manualOpex);
  const netOperatingIncome = r2(grossProfit - totalOpex);

  return {
    basis,
    revenue: {
      service: r2(serviceRev),
      retail:  r2(retailRev),
      refunds: r2(refunds),
      net:     netRevenue,
    },
    cogs,
    grossProfit,
    opex: {
      laborCommissions: labor.commissions,
      laborBonuses:     labor.bonuses,
      laborTotal:       labor.total,
      processingFees:   r2(processingFees),
      byCategory,
      manualTotal:      manualOpex,
      total:            totalOpex,
    },
    netOperatingIncome,
    // Memo — money that moved but is NOT income/expense.
    memo: {
      salesTaxCollected: r2(tax),
      tipsCollected:     r2(tips),
      giftCardsSold:     r2(giftCardsSold),
    },
  };
}
