// Single source of truth for the app's module catalog.
//
// Drives:
//   - Home-screen tile rendering (which tiles to show)
//   - Admin Settings → Tile visibility (which can be toggled by the user)
//   - Plan-based gating ("Upgrade to Pro" overlays / hidden features)
//   - The MODULE_TITLES lookup in App.jsx
//
// Two layers of filtering apply, in order:
//   1. PLAN GATE — if the module's `plan` rank is higher than the tenant's
//      current plan, hide it entirely. The user can't even see the tile,
//      let alone toggle it on.
//   2. USER HIDE — among modules the plan allows, the owner can hide
//      individual tiles via Settings (stored as `settings.hiddenTiles`).
//
// adminOnly is independent of plan: even a non-admin with a Pro plan
// won't see HR.

import { roleCan, normalizeRole } from './rbac';
import { PLAN_RANK, normalizePlan, unlockedModulesFor } from './planEntitlements';

export { PLAN_RANK } from './planEntitlements';

// Default module catalog. Edit `plan` to move a feature between tiers.
// `description` shows in the tile-visibility settings panel.
// `cap` = the RBAC capability required to see the tile (see lib/rbac.js). When a
// role is known, getVisibleModules gates on cap; adminOnly is the legacy
// fallback for callers that don't yet pass a role.
// `group` buckets each module for the home screen's progressive disclosure:
//   'core'  — daily drivers, always shown
//   'grow'  — growth/operational tools, behind "Show more"
//   'admin' — staff/admin/back-office, behind "Show more"
// `plan` is the BASE tier a module belongs to (the tier whose price includes it).
// Tier assignment mirrors the public pricing page so the app enforces exactly
// what we sell. A purchased Power Pack / add-on can unlock a higher-tier module
// on a lower base — see unlockedModulesFor() in planEntitlements.js.
export const MODULES = [
  // ── Solo (single-chair essentials; also the Founders'-Year free tier) ───
  // Marketing copy: scheduling + booking, POS, gift cards, promo codes,
  // AI-powered reports, data export.
  { id: 'schedule',    label: 'Schedule',         desc: 'Appointments & calendar',           plan: 'solo',    adminOnly: false, cap: 'schedule',         group: 'core'  },
  { id: 'clients',     label: 'Clients',          desc: 'Profiles & visit history',          plan: 'solo',    adminOnly: false, cap: 'clients',          group: 'core'  },
  { id: 'services',    label: 'Services',         desc: 'Menu & pricing',                    plan: 'solo',    adminOnly: false, cap: 'services_edit',     group: 'core'  },
  { id: 'employees',   label: 'Employees',        desc: 'Team & profiles',                   plan: 'solo',    adminOnly: true,  cap: 'employees',        group: 'admin' },
  { id: 'walkin',      label: 'Walk-in Manager',  desc: 'Turn rotation + waitlist',          plan: 'solo',    adminOnly: false, cap: 'walkin',           group: 'grow', hideForVerticals: ['personalTraining'] },
  { id: 'reports',     label: 'Reports',          desc: 'Revenue & analytics + AI assistant', plan: 'solo',   adminOnly: false, cap: 'reports',          group: 'core'  },
  { id: 'receipts',    label: 'Sales & Receipts', desc: 'Browse, search, resend & refund sales', plan: 'solo', adminOnly: false, cap: 'reports',         group: 'core'  },
  { id: 'earnings',    label: 'Earnings',         desc: 'Tips, services & take-home',        plan: 'solo',    adminOnly: false, cap: 'earnings_own',     group: 'grow'  },
  { id: 'giftcards',   label: 'Gift Cards',       desc: 'Gift cards & promo codes',          plan: 'solo',    adminOnly: true,  cap: 'giftcards_manage', group: 'grow'  },

  // ── Studio (full team; bundles the Comms Pack) ──────────────────────────
  // Marketing copy: + SMS reminders + 2-way (Comms), multi-tech splits,
  // smart walk-in, custom booking domain.
  { id: 'chat',        label: 'Communications',   desc: 'SMS, email & in-app messages',      plan: 'studio',  adminOnly: false, cap: 'chat',             group: 'grow'  },
  { id: 'attendance',  label: 'Attendance',       desc: 'Clock-in / clock-out times',        plan: 'studio',  adminOnly: true,  cap: 'attendance',       group: 'admin' },
  { id: 'meetings',    label: 'Meetings',         desc: 'Internal team meetings',            plan: 'studio',  adminOnly: true,  cap: 'meetings',         group: 'grow'  },
  { id: 'products',    label: 'Products',         desc: 'Retail inventory & stock',          plan: 'studio',  adminOnly: true,  cap: 'products_edit',    group: 'grow'  },

  // ── Salon Pro (unlimited staff; bundles Operations + Marketing + AI) ────
  // Marketing copy: + Gusto payroll (Operations), Marketing pack, AI pack,
  // multi-location.
  { id: 'marketing',   label: 'Marketing',        desc: 'Email campaigns & outreach',        plan: 'salonPro', adminOnly: true,  cap: 'marketing',       group: 'grow'  },
  { id: 'hr',          label: 'HR',               desc: 'Payroll & compensation',            plan: 'salonPro', adminOnly: true,  cap: 'hr',              group: 'admin' },
  { id: 'memberships', label: 'Memberships',      desc: 'Recurring plans & members',         plan: 'salonPro', adminOnly: true,  cap: 'memberships',     group: 'grow'  },

  // ── Personal-training vertical modules ──────────────────────────────────
  // `intake` is broadly useful (consent/waiver/health forms) so it shows for
  // every vertical. `programs` is training-specific, so it's gated to the
  // personalTraining vertical via showForVerticals.
  { id: 'intake',      label: 'Intake & Waivers', desc: 'Forms, health history & e-signatures', plan: 'solo',  adminOnly: true,  cap: 'intake',          group: 'grow'  },
  { id: 'programs',    label: 'Programs',         desc: 'Personalized training plans',          plan: 'solo',  adminOnly: false, cap: 'programs',        group: 'core', showForVerticals: ['personalTraining'] },
  { id: 'store',       label: 'Store',            desc: 'Sell products & supplements (Stripe payouts to you)', plan: 'solo', adminOnly: true, cap: 'store',     group: 'grow', showForVerticals: ['personalTraining'] },

  // Launch & Grow — guided business setup + growth (Phase 2). Owner-only and
  // gated behind the `launchGrow` feature flag so it ships dark until rolled out.
  { id: 'grow',        label: 'Launch & Grow',    desc: 'Start, run & grow your business',    plan: 'solo',    adminOnly: true,  cap: 'settings',         group: 'grow',  flag: 'launchGrow' },

  // Admin opens the settings overlay (not a routed view) — surfaced as a tile to
  // match the mobile app. Owner-only (the 'settings' capability).
  { id: 'admin',       label: 'Admin',            desc: 'Users, settings, logs & trash',     plan: 'solo',    adminOnly: true,  cap: 'settings',         group: 'admin' },
];

// Tenants without an explicit plan field are treated as Salon Pro — preserves
// behavior for the bootstrap admin / Meraki tenant which predates billing.
// normalizePlan also maps legacy ids (starter→solo, pro→salonPro) so
// grandfathered docs keep working without a data migration.
//
// Trial handling: a paid-tier trial (studio / salonPro) has the plan set +
// trialEndsAt. When the trial expires WITHOUT a subscription, we downgrade UI
// gating to 'solo' (the free tier). The webhook clears trialEndsAt once a paid
// subscription becomes active, so a real paid tenant is never affected.
export function effectivePlan(settings) {
  const plan = normalizePlan(settings?.plan);
  const trialEndsAt = settings?.trialEndsAt;
  if (trialEndsAt && (plan === 'salonPro' || plan === 'studio')) {
    if (new Date(trialEndsAt).getTime() < Date.now()) return 'solo';
  }
  return plan;
}

// Full entitlement snapshot for a tenant: effective base plan plus the set of
// modules unlocked by any purchased Power Packs / atomic add-ons. The packs and
// atomicAddOns arrays live on data/settings (mirrored from the tenant root doc
// at signup). This is the helper feature-level code should consult.
export function getEntitlements(settings) {
  const plan  = effectivePlan(settings);
  const packs = settings?.packs || [];
  const atoms = settings?.atomicAddOns || [];
  return { plan, packs, atoms, unlocked: unlockedModulesFor(packs, atoms) };
}

// True iff the tenant is currently inside an unexpired trial window.
// Used by the Billing UI to render a countdown banner.
export function isInTrial(settings) {
  const trialEndsAt = settings?.trialEndsAt;
  if (!trialEndsAt) return false;
  return new Date(trialEndsAt).getTime() > Date.now();
}

// Days remaining in the trial (rounded up). Returns 0 if not in trial.
export function trialDaysRemaining(settings) {
  if (!isInTrial(settings)) return 0;
  const ms = new Date(settings.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

// Pure base-tier check: does `plan`'s rank include this module's tier? Accepts
// legacy plan ids (normalized). Does NOT consider purchased packs — use
// hasModuleAccess for the full entitlement answer.
export function isModuleAvailableForPlan(moduleOrId, plan) {
  const mod = typeof moduleOrId === 'string' ? MODULES.find(m => m.id === moduleOrId) : moduleOrId;
  if (!mod) return false;
  return PLAN_RANK[mod.plan] <= PLAN_RANK[normalizePlan(plan)];
}

// Full access check for a tenant: base tier OR unlocked by a purchased pack/atom.
export function hasModuleAccess(settings, moduleOrId) {
  const mod = typeof moduleOrId === 'string' ? MODULES.find(m => m.id === moduleOrId) : moduleOrId;
  if (!mod) return false;
  const { plan, unlocked } = getEntitlements(settings);
  return isModuleAvailableForPlan(mod, plan) || unlocked.has(mod.id);
}

// Owner-controlled on/off state, distinct from hiddenTiles (which only hides a
// home-screen tile). A disabled module is fully off: hidden AND not routable.
// `settings.disabledModules` is written only by the setModuleEnabled callable
// so the Memberships cancel-first precondition can't be skipped from the client.
export function isModuleEnabled(settings, moduleId) {
  return !(settings?.disabledModules || []).includes(moduleId);
}

// Modules a downgrade from currentPlan → targetPlan would remove (available
// now, not available on the target tier). A module kept alive by a purchased
// pack/atom (`unlocked`) is NOT lost. Pure — reused by the downgrade UI and
// tests. Returns full module objects.
export function modulesLostOnDowngrade(currentPlan, targetPlan, unlocked = new Set()) {
  const cur = normalizePlan(currentPlan);
  const tgt = normalizePlan(targetPlan);
  if (PLAN_RANK[tgt] >= PLAN_RANK[cur]) return [];
  return MODULES.filter(m =>
    isModuleAvailableForPlan(m, cur) && !isModuleAvailableForPlan(m, tgt) && !unlocked.has(m.id)
  );
}

// Filter the module list down to what should be visible on the home screen
// for this user. Combines: plan gate + RBAC capability gate + owner-disabled +
// per-tile hide. Pass `role` for capability gating; `isAdmin` is the legacy
// fallback (adminOnly) for callers not yet migrated to roles.
export function getVisibleModules(settings, { role, isAdmin, hiddenTiles, hasFeature } = {}) {
  const hidden = new Set(hiddenTiles || settings?.hiddenTiles || []);
  const vertical = settings?.vertical || 'nails';
  const r = role ? normalizeRole(role) : null;
  return MODULES.filter(m => {
    if (m.flag && !(typeof hasFeature === 'function' && hasFeature(m.flag))) return false;  // flag-gated module (ships dark)
    if (m.hideForVerticals && m.hideForVerticals.includes(vertical)) return false;          // tile not relevant to this vertical (e.g. walk-in turn rotation for personal training)
    if (m.showForVerticals && !m.showForVerticals.includes(vertical)) return false;         // tile is specific to other verticals (e.g. training programs only show for personalTraining)
    if (r) { if (m.cap && !roleCan(r, m.cap)) return false; }   // RBAC capability gate
    else if (m.adminOnly && !isAdmin) return false;             // legacy fallback
    if (!hasModuleAccess(settings, m)) return false;            // base tier OR purchased pack
    if (!isModuleEnabled(settings, m.id)) return false;
    if (hidden.has(m.id)) return false;
    return true;
  });
}

// Bucket the visible modules into the home-screen groups for progressive
// disclosure. Pure — Core renders open; Grow/Admin collapse behind "Show more".
// Order within each group follows MODULES order. `opts` is forwarded to
// getVisibleModules ({ role, isAdmin, hiddenTiles }).
export const MODULE_GROUPS = ['core', 'grow', 'admin'];
export function getGroupedModules(settings, opts = {}) {
  const visible = getVisibleModules(settings, opts);
  const groups = { core: [], grow: [], admin: [] };
  for (const m of visible) (groups[m.group] || groups.core).push(m);
  return groups;
}

// MODULE_TITLES lookup compatible with the existing App.jsx mount table.
export const MODULE_TITLES_FROM_CATALOG = Object.fromEntries(
  MODULES.map(m => [m.id, m.label === 'Gift Cards' ? 'Gift Cards & Promos'
                       : m.label === 'Products' ? 'Products & Inventory'
                       : m.label])
);
