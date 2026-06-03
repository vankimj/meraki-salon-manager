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

export const PLAN_RANK = { starter: 0, studio: 1, pro: 2, enterprise: 3 };

// Default module catalog. Edit `plan` to move a feature between tiers.
// `description` shows in the tile-visibility settings panel.
export const MODULES = [
  // ── Starter (core salon operations, free) ───────────────
  { id: 'schedule',    label: 'Schedule',         desc: 'Appointments & calendar',           plan: 'starter', adminOnly: false },
  { id: 'clients',     label: 'Clients',          desc: 'Profiles & visit history',          plan: 'starter', adminOnly: false },
  { id: 'services',    label: 'Services',         desc: 'Menu & pricing',                    plan: 'starter', adminOnly: false },
  { id: 'employees',   label: 'Employees',        desc: 'Team & profiles',                   plan: 'starter', adminOnly: true  },
  { id: 'walkin',      label: 'Walk-in Kiosk',    desc: 'Live turn rotation + waitlist',     plan: 'starter', adminOnly: false },

  // ── Studio (run your salon better — analytics, inventory, payments) ─
  { id: 'reports',     label: 'Reports',          desc: 'Revenue & analytics + AI assistant', plan: 'studio',  adminOnly: false },
  { id: 'earnings',    label: 'Earnings',         desc: 'Tips, services & take-home',        plan: 'studio',  adminOnly: false },
  { id: 'attendance',  label: 'Attendance',       desc: 'Clock-in / clock-out times',        plan: 'studio',  adminOnly: true  },
  { id: 'giftcards',   label: 'Gift Cards',       desc: 'Gift cards & promo codes',          plan: 'studio',  adminOnly: true  },
  { id: 'meetings',    label: 'Meetings',         desc: 'Internal team meetings',            plan: 'studio',  adminOnly: true  },
  { id: 'products',    label: 'Products',         desc: 'Retail inventory & stock',          plan: 'studio',  adminOnly: true  },

  // ── Pro (grow your business — outbound comms, payroll, recurring revenue) ─
  { id: 'chat',        label: 'Communications',   desc: 'SMS, email & in-app messages',      plan: 'pro',     adminOnly: false },
  { id: 'marketing',   label: 'Marketing',        desc: 'Email campaigns & outreach',        plan: 'pro',     adminOnly: true  },
  { id: 'hr',          label: 'HR',               desc: 'Payroll & compensation',            plan: 'pro',     adminOnly: true  },
  { id: 'memberships', label: 'Memberships',      desc: 'Recurring plans & members',         plan: 'pro',     adminOnly: true  },
];

// Tenants without an explicit plan field are treated as pro — preserves
// behavior for the bootstrap admin / Meraki tenant which predates billing.
// New SaaS signups go through createTenantOnboarding and get an explicit
// plan stamped at creation, so this default only catches grandfathered docs.
//
// Trial handling: a tenant on the 14-day Pro trial has plan='pro' +
// trialEndsAt set. When the trial expires WITHOUT a subscription, we
// downgrade UI gating to 'starter' here. The webhook clears trialEndsAt
// once a paid subscription becomes active, so a real paid tenant is
// never affected by the trial check.
export function effectivePlan(settings) {
  const plan = settings?.plan || 'pro';
  const trialEndsAt = settings?.trialEndsAt;
  if (trialEndsAt && (plan === 'pro' || plan === 'studio')) {
    if (new Date(trialEndsAt).getTime() < Date.now()) return 'starter';
  }
  return plan;
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

export function isModuleAvailableForPlan(moduleOrId, plan) {
  const mod = typeof moduleOrId === 'string' ? MODULES.find(m => m.id === moduleOrId) : moduleOrId;
  if (!mod) return false;
  return PLAN_RANK[mod.plan] <= PLAN_RANK[plan];
}

// Owner-controlled on/off state, distinct from hiddenTiles (which only hides a
// home-screen tile). A disabled module is fully off: hidden AND not routable.
// `settings.disabledModules` is written only by the setModuleEnabled callable
// so the Memberships cancel-first precondition can't be skipped from the client.
export function isModuleEnabled(settings, moduleId) {
  return !(settings?.disabledModules || []).includes(moduleId);
}

// Modules a downgrade from currentPlan → targetPlan would remove (available
// now, not available on the target tier). Pure — reused by the downgrade UI
// and tests. Returns full module objects.
export function modulesLostOnDowngrade(currentPlan, targetPlan) {
  if (PLAN_RANK[targetPlan] >= PLAN_RANK[currentPlan]) return [];
  return MODULES.filter(m =>
    isModuleAvailableForPlan(m, currentPlan) && !isModuleAvailableForPlan(m, targetPlan)
  );
}

// Filter the module list down to what should be visible on the home screen
// for this user. Combines: plan gate + role gate + owner-disabled + per-tile hide.
export function getVisibleModules(settings, { isAdmin, hiddenTiles } = {}) {
  const plan = effectivePlan(settings);
  const hidden = new Set(hiddenTiles || settings?.hiddenTiles || []);
  return MODULES.filter(m => {
    if (m.adminOnly && !isAdmin) return false;
    if (!isModuleAvailableForPlan(m, plan)) return false;
    if (!isModuleEnabled(settings, m.id)) return false;
    if (hidden.has(m.id)) return false;
    return true;
  });
}

// MODULE_TITLES lookup compatible with the existing App.jsx mount table.
export const MODULE_TITLES_FROM_CATALOG = Object.fromEntries(
  MODULES.map(m => [m.id, m.label === 'Gift Cards' ? 'Gift Cards & Promos'
                       : m.label === 'Products' ? 'Products & Inventory'
                       : m.label])
);
