// Verifies the SERVER money-math port (functions/lib/kioskSale.js) against
// hand-computed values. recordKioskSale recomputes the bill with these — a drift
// from the client math would mis-charge customers, so this is a guard.
import { describe, it, expect } from 'vitest';

const { computeTotals, buildTechSplit, linesFromCart } = await import('../../functions/lib/kioskSale.js');

describe('server computeTotals', () => {
  it('one service, tax only, cash', () => {
    const t = computeTotals({ lines: [{ price: 40, taxable: true }], taxRate: 7.5, method: 'cash' });
    expect(t.subtotal).toBe(40);
    expect(t.taxAmt).toBe(3);          // 40 * 7.5%
    expect(t.billBeforeTip).toBe(43);
    expect(t.total).toBe(43);
  });
  it('percent tip is on subtotal, not the taxed bill', () => {
    const t = computeTotals({ lines: [{ price: 40, taxable: true }], taxRate: 7.5, method: 'cash', tip: { pct: 20 } });
    expect(t.tipAmt).toBe(8);          // 40 * 20%
    expect(t.total).toBe(51);          // 43 + 8
  });
  it('fixed discount reduces the taxable base', () => {
    const t = computeTotals({ lines: [{ price: 40, taxable: true }], taxRate: 7.5, discount: { value: 10, isPercent: false }, method: 'cash' });
    expect(t.discountAmount).toBe(10);
    expect(t.afterDiscounts).toBe(30);
    expect(t.taxAmt).toBe(2.25);       // 30 * 7.5%
    expect(t.total).toBe(32.25);
  });
  it('store credit lowers the charged amount but not the tip', () => {
    const t = computeTotals({ lines: [{ price: 40, taxable: true }], taxRate: 0, method: 'card', tip: { custom: true, amount: 5 }, clientCredit: 15, applyCredit: true });
    expect(t.creditApply).toBe(15);
    expect(t.charged).toBe(25);        // 40 - 15
    expect(t.total).toBe(30);          // 25 + 5 tip
  });
  it('non-taxable line is excluded from tax', () => {
    const t = computeTotals({ lines: [{ price: 40, taxable: true }, { price: 20, taxable: false }], taxRate: 10, method: 'cash' });
    expect(t.subtotal).toBe(60);
    expect(t.taxAmt).toBe(4);          // only the $40 taxable line: 40 * 10%
  });
});

describe('linesFromCart', () => {
  it('flattens appt services into priced lines with tech fallback', () => {
    const cart = { appts: [{ techName: 'Ana', services: [{ name: 'Gel', price: 40 }, { name: 'Art', price: 10, techName: 'Tess' }] }] };
    expect(linesFromCart(cart)).toEqual([
      { name: 'Gel', price: 40, techName: 'Ana', taxable: true },
      { name: 'Art', price: 10, techName: 'Tess', taxable: true },
    ]);
  });
});

describe('buildTechSplit', () => {
  it('single tech → null (no split)', () => {
    expect(buildTechSplit([{ price: 40, techName: 'Ana' }], 8)).toBeNull();
  });
  it('splits the tip by revenue share, last tech absorbs rounding', () => {
    const split = buildTechSplit([{ price: 60, techName: 'Ana' }, { price: 40, techName: 'Tess' }], 10);
    expect(split.find(s => s.techName === 'Ana').tip).toBe(6);
    expect(split.find(s => s.techName === 'Tess').tip).toBe(4);
  });
});
