// ── Feature flags + tier-based canary rollouts ────────────────────────────
// Used to gradually roll a new feature out: ship the code to everyone in a
// single deploy, then progressively enable per tier. If something goes
// wrong, flip the flag off — instant rollback without redeploying.
//
// Resolution order for isFeatureOn(name, { tier, featureFlags }):
//   1. Per-tenant override (settings.featureFlags[name]) — beats everything.
//      Useful for "this one tenant is the canary" or "this Pro tenant
//      bought the early-access add-on."
//   2. Tier default from FEATURE_TIER_DEFAULTS[name][tier] below.
//   3. Global default: false (everything is off unless explicitly enabled).
//
// Rollout discipline:
//   - Land the feature behind a flag with all tiers OFF except `demo`.
//   - Soak 1-3 days on demo.plumenexus.com. Verify no errors.
//   - Flip `owner` to true (Meraki). Soak 3-7 days.
//   - Flip `free` to true. Soak 7-14 days.
//   - Flip `pro` and `enterprise` to true.
//   - When 100% rolled out and stable for ≥2 weeks, REMOVE the flag and
//     inline the feature. Flags that linger become tech debt.

// Canary tiers, lowest-stakes to highest-stakes.
// Tier on tenants/{tid}/data/settings.tier — admin-editable; default 'free'
// for new self-service signups. Existing tenants backfilled by
// scripts/backfill-tier.cjs (Meraki = 'owner', demo = 'demo').
export const TIERS = ['demo', 'owner', 'free', 'pro', 'enterprise'];

// Per-feature tier defaults. Add an entry when you ship a new feature
// behind a flag. Omitting a tier defaults it to false.
export const FEATURE_TIER_DEFAULTS = {
  // Demo flag — the canary ribbon at the bottom of HomeScreen.
  // Validates that the feature-flag pipeline works end-to-end.
  // Currently visible only on demo tenant.
  canaryRibbon: { demo: true },

  // Curated/collapsed home grid (Core / Grow / Admin + "Show more") + the
  // per-user Simple Mode density switch. Ships dark; roll out demo → owner → …
  curatedHome: { demo: true, owner: true, free: true, pro: true, enterprise: true },

  // Launch & Grow module (Phase 2) — guided business setup + growth + AI coach.
  // Ships dark; roll out demo → owner → … once content + AI are reviewed.
  launchGrow: { demo: true, owner: true, free: true, pro: true, enterprise: true },

  // Add new features here as they're rolled out. Examples:
  //   newCheckoutFlow:        { demo: true, owner: true },
  //   advancedReportsBeta:    { demo: true, owner: true, pro: true },
  //   experimentalAiVoice:    { demo: true },
};

// Resolve a feature flag for a given tenant context.
// `tenant` shape: { tier?: string, featureFlags?: { [name]: boolean } }
// Both fields normally come from data/settings — see AppContext.
export function isFeatureOn(name, tenant) {
  if (!name) return false;
  const override = tenant?.featureFlags?.[name];
  if (override === true || override === false) return override;
  const tier = tenant?.tier || 'free';
  const tierDefault = FEATURE_TIER_DEFAULTS[name]?.[tier];
  if (tierDefault === true || tierDefault === false) return tierDefault;
  return false;
}
