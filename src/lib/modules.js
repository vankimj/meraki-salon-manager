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

export const PLAN_RANK = { starter: 0, studio: 1, pro: 2, enterprise: 3 };

// Default module catalog. Edit `plan` to move a feature between tiers.
// `description` shows in the tile-visibility settings panel.
// `cap` = the RBAC capability required to see the tile (see lib/rbac.js). When a
// role is known, getVisibleModules gates on cap; adminOnly is the legacy
// fallback for callers that don't yet pass a role.
// `group` buckets each module for the home screen's progressive disclosure:
//   'core'  — daily drivers, always shown
//   'grow'  — growth/operational tools, behind "Show more"
//   'admin' — staff/admin/back-office, behind "Show more"
export const MODULES = [
  // ── Starter (core salon operations, free) ───────────────
  { id: 'schedule',    label: 'Schedule',         desc: 'Appointments & calendar',           plan: 'starter', adminOnly: false, cap: 'schedule',         group: 'core'  },
  { id: 'clients',     label: 'Clients',          desc: 'Profiles & visit history',          plan: 'starter', adminOnly: false, cap: 'clients',          group: 'core'  },
  { id: 'services',    label: 'Services',         desc: 'Menu & pricing',                    plan: 'starter', adminOnly: false, cap: 'services_edit',     group: 'core'  },
  { id: 'employees',   label: 'Employees',        desc: 'Team & profiles',                   plan: 'starter', adminOnly: true,  cap: 'employees',        group: 'admin' },
  { id: 'walkin',      label: 'Walk-in Manager',  desc: 'Turn rotation + waitlist',          plan: 'starter', adminOnly: false, cap: 'walkin',           group: 'grow'  },

  // ── Studio (run your salon better — analytics, inventory, payments) ─
  { id: 'reports',     label: 'Reports',          desc: 'Revenue & analytics + AI assistant', plan: 'studio',  adminOnly: false, cap: 'reports',         group: 'core'  },
  { id: 'receipts',    label: 'Sales & Receipts', desc: 'Browse, search, resend & refund sales', plan: 'studio', adminOnly: false, cap: 'reports',      group: 'core'  },
  { id: 'earnings',    label: 'Earnings',         desc: 'Tips, services & take-home',        plan: 'studio',  adminOnly: false, cap: 'earnings_own',     group: 'grow'  },
  { id: 'attendance',  label: 'Attendance',       desc: 'Clock-in / clock-out times',        plan: 'studio',  adminOnly: true,  cap: 'attendance',       group: 'admin' },
  { id: 'giftcards',   label: 'Gift Cards',       desc: 'Gift cards & promo codes',          plan: 'studio',  adminOnly: true,  cap: 'giftcards_manage', group: 'grow'  },
  { id: 'meetings',    label: 'Meetings',         desc: 'Internal team meetings',            plan: 'studio',  adminOnly: true,  cap: 'meetings',         group: 'grow'  },
  { id: 'products',    label: 'Products',         desc: 'Retail inventory & stock',          plan: 'studio',  adminOnly: true,  cap: 'products_edit',    group: 'grow'  },

  // ── Pro (grow your business — outbound comms, payroll, recurring revenue) ─
  { id: 'chat',        label: 'Communications',   desc: 'SMS, email & in-app messages',      plan: 'pro',     adminOnly: false, cap: 'chat',             group: 'grow'  },
  { id: 'marketing',   label: 'Marketing',        desc: 'Email campaigns & outreach',        plan: 'pro',     adminOnly: true,  cap: 'marketing',        group: 'grow'  },
  { id: 'hr',          label: 'HR',               desc: 'Payroll & compensation',            plan: 'pro',     adminOnly: true,  cap: 'hr',               group: 'admin' },
  { id: 'memberships', label: 'Memberships',      desc: 'Recurring plans & members',         plan: 'pro',     adminOnly: true,  cap: 'memberships',      group: 'grow'  },

  // Launch & Grow — guided business setup + growth (Phase 2). Owner-only and
  // gated behind the `launchGrow` feature flag so it ships dark until rolled out.
  { id: 'grow',        label: 'Launch & Grow',    desc: 'Start, run & grow your business',    plan: 'starter', adminOnly: true,  cap: 'settings',         group: 'grow',  flag: 'launchGrow' },

  // Admin opens the settings overlay (not a routed view) — surfaced as a tile to
  // match the mobile app. Owner-only (the 'settings' capability).
  { id: 'admin',       label: 'Admin',            desc: 'Users, settings, logs & trash',     plan: 'starter', adminOnly: true,  cap: 'settings',         group: 'admin' },
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
// for this user. Combines: plan gate + RBAC capability gate + owner-disabled +
// per-tile hide. Pass `role` for capability gating; `isAdmin` is the legacy
// fallback (adminOnly) for callers not yet migrated to roles.
export function getVisibleModules(settings, { role, isAdmin, hiddenTiles, hasFeature } = {}) {
  const plan = effectivePlan(settings);
  const hidden = new Set(hiddenTiles || settings?.hiddenTiles || []);
  const r = role ? normalizeRole(role) : null;
  return MODULES.filter(m => {
    if (m.flag && !(typeof hasFeature === 'function' && hasFeature(m.flag))) return false;  // flag-gated module (ships dark)
    if (r) { if (m.cap && !roleCan(r, m.cap)) return false; }   // RBAC capability gate
    else if (m.adminOnly && !isAdmin) return false;             // legacy fallback
    if (!isModuleAvailableForPlan(m, plan)) return false;
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
