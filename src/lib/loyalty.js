// Pure loyalty-points math. Shared by the checkout redeem path and tests; the
// server earn trigger (creditLoyaltyOnReceipt) inlines the same Math.floor rule.
//
// config (settings.loyaltyConfig):
//   enabled          — master on/off
//   pointsPerDollar   — points earned per $1 actually paid (e.g. 1)
//   redemptionValue   — dollars each point is worth when redeemed (e.g. 0.05 → 20 pts = $1)
//   minRedeemPoints   — floor before a client can redeem (e.g. 100)

export function resolveLoyaltyConfig(settings) {
  const c = (settings && settings.loyaltyConfig) || {};
  return {
    enabled:         c.enabled === true,
    pointsPerDollar: Number(c.pointsPerDollar) || 0,
    redemptionValue: Number(c.redemptionValue) || 0,
    minRedeemPoints: Number(c.minRedeemPoints) || 0,
  };
}

// Whole points earned on an amount actually paid (floored — no fractional points).
export function pointsForCharge(cfg, charged) {
  const perDollar = Number(cfg && cfg.pointsPerDollar) || 0;
  const base = Number(charged) || 0;
  if (perDollar <= 0 || base <= 0) return 0;
  return Math.floor(base * perDollar);
}

// Max points redeemable against a remaining bill, in WHOLE points, capped by the
// client's balance and the bill. Returns { redeemPts, dollars }. Below the
// minRedeemPoints floor → redeems nothing.
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
