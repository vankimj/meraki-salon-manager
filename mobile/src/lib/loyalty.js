// Mobile copy of src/lib/loyalty.js — pure loyalty-points math. Kept in sync
// with the web version (and the server earn rule in functions/index.js).

export function resolveLoyaltyConfig(settings) {
  const c = (settings && settings.loyaltyConfig) || {};
  return {
    enabled:         c.enabled === true,
    pointsPerDollar: Number(c.pointsPerDollar) || 0,
    redemptionValue: Number(c.redemptionValue) || 0,
    minRedeemPoints: Number(c.minRedeemPoints) || 0,
  };
}

export function redeemableLoyalty(cfg, clientPoints, remainingBill) {
  const rv   = Number(cfg && cfg.redemptionValue) || 0;
  const pts  = Number(clientPoints) || 0;
  const bill = Number(remainingBill) || 0;
  const min  = Number(cfg && cfg.minRedeemPoints) || 0;
  if (rv <= 0 || bill <= 0 || pts < Math.max(min, 1)) return { redeemPts: 0, dollars: 0 };
  const maxByBill = Math.floor(bill / rv);
  const redeemPts = Math.min(pts, maxByBill);
  if (redeemPts < min || redeemPts <= 0) return { redeemPts: 0, dollars: 0 };
  const dollars = Math.round(redeemPts * rv * 100) / 100;
  return { redeemPts, dollars };
}
