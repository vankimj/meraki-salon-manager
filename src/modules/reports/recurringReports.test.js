import { describe, it, expect } from 'vitest';
import { computeMembershipStats, computeSessionPackStats, computeClientValue } from './recurringReports';

describe('computeMembershipStats', () => {
  it('normalizes yearly to monthly and sums MRR/ARR over active only', () => {
    const s = computeMembershipStats([
      { status: 'active', price: 100, billingPeriod: 'monthly', planName: 'Unlimited' },
      { status: 'active', price: 1200, billingPeriod: 'yearly',  planName: 'Annual' },   // 100/mo
      { status: 'paused', price: 100, billingPeriod: 'monthly', planName: 'Unlimited' },
      { status: 'cancelled', price: 100, billingPeriod: 'monthly', planName: 'Unlimited' },
      { _deleted: true, status: 'active', price: 999, billingPeriod: 'monthly' },          // ignored
    ]);
    expect(s.active).toBe(2);
    expect(s.paused).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.mrr).toBe(200);
    expect(s.arr).toBe(2400);
    expect(s.avgValue).toBe(100);
  });
  it('breaks MRR down by plan, sorted desc', () => {
    const s = computeMembershipStats([
      { status: 'active', price: 50,  billingPeriod: 'monthly', planName: 'Small Group' },
      { status: 'active', price: 200, billingPeriod: 'monthly', planName: 'Unlimited' },
      { status: 'active', price: 50,  billingPeriod: 'monthly', planName: 'Small Group' },
    ]);
    expect(s.plans[0]).toEqual({ name: 'Unlimited', count: 1, mrr: 200 });
    expect(s.plans[1]).toEqual({ name: 'Small Group', count: 2, mrr: 100 });
  });
  it('handles empty input', () => {
    const s = computeMembershipStats([]);
    expect(s).toMatchObject({ active: 0, mrr: 0, arr: 0, avgValue: 0, churnRate: 0 });
    expect(s.plans).toEqual([]);
  });
});

describe('computeSessionPackStats', () => {
  it('tracks sold / remaining (liability) / used + utilization', () => {
    const s = computeSessionPackStats([
      { status: 'active',   totalSessions: 10, remaining: 4 },  // 6 used
      { status: 'active',   totalSessions: 5,  remaining: 5 },  // 0 used
      { status: 'depleted', totalSessions: 10, remaining: 0 },  // 10 used
      { _deleted: true,     totalSessions: 99, remaining: 99 }, // ignored
    ]);
    expect(s.totalPacks).toBe(3);
    expect(s.active).toBe(2);
    expect(s.depleted).toBe(1);
    expect(s.sessionsSold).toBe(25);
    expect(s.sessionsRemaining).toBe(9);
    expect(s.sessionsUsed).toBe(16);
    expect(s.utilization).toBeCloseTo(16 / 25);
  });
  it('a pack with 0 remaining is not active even if status says active', () => {
    const s = computeSessionPackStats([{ status: 'active', totalSessions: 5, remaining: 0 }]);
    expect(s.active).toBe(0);
    expect(s.depleted).toBe(1);
  });
});

describe('computeClientValue', () => {
  it('sorts clients by lifetime revenue with avg ticket', () => {
    const list = computeClientValue({
      c1: { name: 'Sam', revenue: 300, count: 3 },
      c2: { name: 'Alex', revenue: 1000, count: 4 },
    });
    expect(list[0]).toMatchObject({ clientId: 'c2', name: 'Alex', revenue: 1000, visits: 4, avgTicket: 250 });
    expect(list[1]).toMatchObject({ clientId: 'c1', avgTicket: 100 });
  });
});
