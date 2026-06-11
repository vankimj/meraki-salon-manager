import { describe, it, expect } from 'vitest';
import { txComponents, txRevenue, computePnl } from './pnl';

const RANGE = { startDate: '2026-05-01', endDate: '2026-05-31' };

// A sale receipt: $100 service, $8 tax, $20 tip, paid card, $3 cc fee.
const sale = (over = {}) => ({
  date: '2026-05-10', status: 'done', transactionType: 'sale',
  services: [{ name: 'Gel', price: 100 }],
  payment: { total: 128, subtotal: 100, tax: 8, tip: 20, ccFee: 3, method: 'card' },
  ...over,
});

describe('txComponents / txRevenue', () => {
  it('excludes tax + tips from revenue', () => {
    const c = txComponents(sale());
    expect(txRevenue(c, 'cash')).toBe(100);
    expect(txRevenue(c, 'accrual')).toBe(100);
  });
  it('nets discounts out of revenue', () => {
    const c = txComponents(sale({ payment: { total: 90, tax: 0, tip: 0, discountAmount: 10 } }));
    expect(txRevenue(c, 'accrual')).toBe(90);
  });
  it('gift-card SALE is revenue under cash, deferred under accrual', () => {
    // Pure gift-card purchase: no service, $50 gift card sold.
    const gc = { transactionType: 'sale', services: [], payment: { total: 50, gcSalesTotal: 50 } };
    const c = txComponents(gc);
    expect(txRevenue(c, 'cash')).toBe(50);     // cash in now
    expect(txRevenue(c, 'accrual')).toBe(0);   // deferred liability
  });
  it('gift-card REDEMPTION counts under accrual, not re-counted under cash', () => {
    // $100 service fully paid by a previously-bought gift card.
    const c = txComponents(sale({ payment: { total: 100, tax: 0, tip: 0, giftCard: { applied: 100 } } }));
    expect(txRevenue(c, 'accrual')).toBe(100); // service delivered = revenue
    expect(txRevenue(c, 'cash')).toBe(0);      // no new cash now
  });
  it('store-credit redemption: accrual counts, cash does not', () => {
    const c = txComponents(sale({ payment: { total: 100, tax: 0, tip: 0, creditApplied: 100 } }));
    expect(txRevenue(c, 'accrual')).toBe(100);
    expect(txRevenue(c, 'cash')).toBe(0);
  });
});

describe('computePnl — revenue & refunds', () => {
  it('sums net revenue excluding tax/tips and surfaces them as memo', () => {
    const p = computePnl([sale(), sale()], [], { basis: 'cash', ...RANGE });
    expect(p.revenue.net).toBe(200);
    expect(p.memo.salesTaxCollected).toBe(16);
    expect(p.memo.tipsCollected).toBe(40);
  });
  it('refunds reduce net revenue', () => {
    const refund = sale({ transactionType: 'refund', services: [{ price: 40 }], payment: { total: 40, tax: 0, tip: 0 } });
    const p = computePnl([sale(), refund], [], { basis: 'cash', ...RANGE });
    expect(p.revenue.refunds).toBe(40);
    expect(p.revenue.net).toBe(60); // 100 − 40
  });
});

describe('computePnl — COGS', () => {
  it('uses captured line cost, else product cost lookup', () => {
    const t1 = { transactionType: 'sale', services: [], retailProducts: [{ id: 'p1', qty: 2, price: 20, cost: 8 }], payment: { total: 40 } };
    const t2 = { transactionType: 'sale', services: [], retailProducts: [{ id: 'p2', qty: 1, price: 30 }], payment: { total: 30 } };
    const p = computePnl([t1, t2], [], { basis: 'cash', productCostById: { p2: 12 }, ...RANGE });
    expect(p.cogs).toBe(28); // 2×8 + 1×12
    expect(p.grossProfit).toBe(p.revenue.net - 28);
  });
});

describe('computePnl — labor basis difference', () => {
  const payrollRuns = [{ paidDate: '2026-05-15', total: 500 }, { paidDate: '2026-04-30', total: 999 }];
  const bonuses     = [{ date: '2026-05-20', amount: 100 }, { date: '2026-06-01', amount: 50 }];
  it('cash labor = payroll + bonuses PAID in range', () => {
    const p = computePnl([sale()], [], { basis: 'cash', payrollRuns, bonuses, ...RANGE });
    expect(p.opex.laborCommissions).toBe(500); // 999 is out of range
    expect(p.opex.laborBonuses).toBe(100);      // 50 is out of range
    expect(p.opex.laborTotal).toBe(600);
  });
  it('accrual labor = commission EARNED + bonuses', () => {
    const p = computePnl([sale()], [], { basis: 'accrual', payrollRuns, bonuses, commissionEarned: 320, ...RANGE });
    expect(p.opex.laborCommissions).toBe(320);
    expect(p.opex.laborBonuses).toBe(100);
    expect(p.opex.laborTotal).toBe(420);
  });
});

describe('computePnl — opex & net operating income', () => {
  it('groups manual expenses by category and computes net operating income', () => {
    const expenses = [
      { category: 'Rent / occupancy', amount: 30, date: '2026-05-01' },
      { category: 'Supplies & inventory', amount: 12, date: '2026-05-05' },
      { category: 'Rent / occupancy', amount: 0, date: '2026-05-15' },
    ];
    const p = computePnl([sale()], expenses, { basis: 'cash', payrollRuns: [{ paidDate: '2026-05-10', total: 25 }], ...RANGE });
    expect(p.opex.byCategory['Rent / occupancy']).toBe(30);
    expect(p.opex.byCategory['Supplies & inventory']).toBe(12);
    expect(p.opex.manualTotal).toBe(42);
    expect(p.opex.processingFees).toBe(3);
    // net rev 100 − cogs 0 = gross 100; opex = labor 25 + fees 3 + manual 42 = 70 → NOI 30
    expect(p.netOperatingIncome).toBe(30);
  });
});
