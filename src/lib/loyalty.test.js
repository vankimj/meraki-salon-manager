import { describe, it, expect } from 'vitest';
import { resolveLoyaltyConfig, pointsForCharge, redeemableLoyalty } from './loyalty';

describe('resolveLoyaltyConfig', () => {
  it('defaults missing config to disabled + zeros', () => {
    expect(resolveLoyaltyConfig({})).toEqual({ enabled: false, pointsPerDollar: 0, redemptionValue: 0, minRedeemPoints: 0 });
  });
  it('reads loyaltyConfig fields', () => {
    const c = resolveLoyaltyConfig({ loyaltyConfig: { enabled: true, pointsPerDollar: 1, redemptionValue: 0.05, minRedeemPoints: 100 } });
    expect(c).toEqual({ enabled: true, pointsPerDollar: 1, redemptionValue: 0.05, minRedeemPoints: 100 });
  });
});

describe('pointsForCharge', () => {
  const cfg = { pointsPerDollar: 1 };
  it('floors to whole points', () => {
    expect(pointsForCharge(cfg, 42.9)).toBe(42);
  });
  it('scales by pointsPerDollar', () => {
    expect(pointsForCharge({ pointsPerDollar: 2 }, 10)).toBe(20);
  });
  it('earns nothing on 0 or negative', () => {
    expect(pointsForCharge(cfg, 0)).toBe(0);
    expect(pointsForCharge(cfg, -5)).toBe(0);
    expect(pointsForCharge({ pointsPerDollar: 0 }, 100)).toBe(0);
  });
});

describe('redeemableLoyalty', () => {
  const cfg = { redemptionValue: 0.05, minRedeemPoints: 100 }; // 20 pts = $1, min 100

  it('redeems whole points capped by the bill', () => {
    // 500 pts available = $25, bill $10 → can only use $10 = 200 pts
    expect(redeemableLoyalty(cfg, 500, 10)).toEqual({ redeemPts: 200, dollars: 10 });
  });
  it('caps at the client balance', () => {
    // 150 pts available = $7.50, bill $100 → use all 150 = $7.50
    expect(redeemableLoyalty(cfg, 150, 100)).toEqual({ redeemPts: 150, dollars: 7.5 });
  });
  it('redeems nothing below the minimum', () => {
    expect(redeemableLoyalty(cfg, 99, 100)).toEqual({ redeemPts: 0, dollars: 0 });
  });
  it('redeems nothing when the bill is 0', () => {
    expect(redeemableLoyalty(cfg, 500, 0)).toEqual({ redeemPts: 0, dollars: 0 });
  });
  it('redeems nothing when redemptionValue is 0', () => {
    expect(redeemableLoyalty({ redemptionValue: 0, minRedeemPoints: 0 }, 500, 50)).toEqual({ redeemPts: 0, dollars: 0 });
  });
  it('never exceeds the bill in dollars', () => {
    const r = redeemableLoyalty(cfg, 100000, 33.33);
    expect(r.dollars).toBeLessThanOrEqual(33.33);
  });
});
