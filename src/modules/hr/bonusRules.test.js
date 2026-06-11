import { describe, it, expect } from 'vitest';
import { buildBonusContext, evaluateRule, evaluateBonusRules } from './bonusRules';

const rule = (over = {}) => ({
  name: 'R', enabled: true, scopeTechNames: [],
  criteria: [{ metric: 'serviceRevenue', value: 1000 }],
  payoutType: 'fixed', payoutValue: 50, payoutMax: 0,
  ...over,
});

describe('buildBonusContext', () => {
  it('computes appt count, new clients, rebooking and rating average', () => {
    const techAppts = [
      { clientId: 'a', date: '2026-06-05' },
      { clientId: 'b', date: '2026-06-06' },
      { clientId: 'c', date: '2026-06-07' }, // walk-in style with id still counted
    ];
    const allAppts = [
      ...techAppts,
      { clientId: 'a', date: '2026-01-01' }, // a is a returning client (prior)
      { clientId: 'b', date: '2026-07-20' }, // b rebooked (future)
    ];
    const ratings = [
      { techName: 'Sam', rating: 5 },
      { techName: 'Sam', rating: 3 },
      { techName: 'Other', rating: 1 },
    ];
    const ctx = buildBonusContext({
      techName: 'Sam', serviceRevenue: 1234.567, techAppts, allAppts, ratings,
      startDate: '2026-06-01', endDate: '2026-06-30',
    });
    expect(ctx.apptCount).toBe(3);
    expect(ctx.newClientCount).toBe(2);      // b and c had no prior appt; a did
    expect(ctx.rebookRate).toBeCloseTo(33.33, 1); // 1 of 3 served has a future appt
    expect(ctx.ratingAvg).toBe(4);           // (5+3)/2, Other ignored
    expect(ctx.serviceRevenue).toBe(1234.57);
  });

  it('attributes retail to the primary tech only', () => {
    const receipts = [
      { primaryTechName: 'Sam', retailProducts: [{ price: 10, qty: 2 }, { price: 5 }] }, // 25
      { primaryTechName: 'Jo',  retailProducts: [{ price: 100, qty: 1 }] },              // ignored
      { tech: 'Sam',            retailProducts: [{ price: 7, qty: 3 }] },                // 21 (tech fallback)
    ];
    const ctx = buildBonusContext({ techName: 'Sam', receipts });
    expect(ctx.retailSales).toBe(46);
  });

  it('computes tenure in whole months and clamps missing data to 0', () => {
    const ctx = buildBonusContext({ techName: 'Sam', hireDate: '2025-06-30', endDate: '2026-06-10' });
    expect(ctx.tenureMonths).toBe(11);
    const empty = buildBonusContext({ techName: 'Sam' });
    expect(empty).toMatchObject({ apptCount: 0, newClientCount: 0, rebookRate: 0, retailSales: 0, ratingAvg: 0, tenureMonths: 0 });
  });
});

describe('evaluateRule', () => {
  const ctx = { techName: 'Sam', serviceRevenue: 2000, apptCount: 40, rebookRate: 80, newClientCount: 5, retailSales: 300, ratingAvg: 4.8, tenureMonths: 12 };

  it('pays a fixed amount when the single criterion passes', () => {
    expect(evaluateRule(rule(), ctx)).toEqual({ matched: true, amount: 50, name: 'R' });
  });

  it('does not pay when the criterion fails', () => {
    expect(evaluateRule(rule({ criteria: [{ metric: 'serviceRevenue', value: 5000 }] }), ctx).matched).toBe(false);
  });

  it('AND-gates: all criteria must pass', () => {
    const r = rule({ criteria: [{ metric: 'serviceRevenue', value: 1000 }, { metric: 'ratingAvg', value: 4.9 }] });
    expect(evaluateRule(r, ctx).matched).toBe(false); // rating 4.8 < 4.9
    const r2 = rule({ criteria: [{ metric: 'serviceRevenue', value: 1000 }, { metric: 'ratingAvg', value: 4.5 }] });
    expect(evaluateRule(r2, ctx).matched).toBe(true);
  });

  it('disabled rules never match', () => {
    expect(evaluateRule(rule({ enabled: false }), ctx).matched).toBe(false);
  });

  it('a rule with no criteria never auto-pays', () => {
    expect(evaluateRule(rule({ criteria: [] }), ctx).matched).toBe(false);
  });

  it('scope limits the rule to named techs', () => {
    expect(evaluateRule(rule({ scopeTechNames: ['Jo'] }), ctx).matched).toBe(false);
    expect(evaluateRule(rule({ scopeTechNames: ['Sam'] }), ctx).matched).toBe(true);
    expect(evaluateRule(rule({ scopeTechNames: [] }), ctx).matched).toBe(true); // empty = all
  });

  it('pctRevenue payout = percent of service revenue', () => {
    expect(evaluateRule(rule({ payoutType: 'pctRevenue', payoutValue: 5 }), ctx).amount).toBe(100); // 5% of 2000
  });

  it('perAppt payout = amount per appointment', () => {
    expect(evaluateRule(rule({ payoutType: 'perAppt', payoutValue: 2 }), ctx).amount).toBe(80); // 40 * 2
  });

  it('applies the payout cap', () => {
    expect(evaluateRule(rule({ payoutType: 'pctRevenue', payoutValue: 50, payoutMax: 250 }), ctx).amount).toBe(250);
  });
});

describe('evaluateBonusRules', () => {
  const ctx = { techName: 'Sam', serviceRevenue: 2000, apptCount: 40, rebookRate: 80, newClientCount: 5, retailSales: 300, ratingAvg: 4.8, tenureMonths: 12 };

  it('sums matching rules and lists only the ones that paid', () => {
    const rules = [
      rule({ name: 'Revenue', payoutValue: 50 }),                                  // pays 50
      rule({ name: 'Rebook', criteria: [{ metric: 'rebookRate', value: 75 }], payoutValue: 25 }), // pays 25
      rule({ name: 'Tenure5y', criteria: [{ metric: 'tenureMonths', value: 60 }], payoutValue: 100 }), // no
      rule({ name: 'Disabled', enabled: false, payoutValue: 999 }),                 // no
    ];
    const out = evaluateBonusRules(rules, ctx);
    expect(out.ruleBonusTotal).toBe(75);
    expect(out.ruleBonusLines).toEqual([{ name: 'Revenue', amount: 50 }, { name: 'Rebook', amount: 25 }]);
  });

  it('returns zero for an empty rule set', () => {
    expect(evaluateBonusRules([], ctx)).toEqual({ ruleBonusTotal: 0, ruleBonusLines: [] });
  });
});
