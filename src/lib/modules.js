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

export const PLAN_RANK = { starter: 0, pro: 1, enterprise: 2 };

// Default module catalog. Edit `plan` to move a feature between tiers.
// `description` shows in the tile-visibility settings panel.
export const MODULES = [
  // ── Starter (core salon operations) ─────────────────────
  { id: 'schedule',    label: 'Schedule',         desc: 'Appointments & calendar',           plan: 'starter', adminOnly: false },
  { id: 'clients',     label: 'Clients',          desc: 'Profiles & visit history',          plan: 'starter', adminOnly: false },
  { id: 'services',    label: 'Services',         desc: 'Menu & pricing',                    plan: 'starter', adminOnly: false },
  { id: 'employees',   label: 'Employees',        desc: 'Team & profiles',                   plan: 'starter', adminOnly: true  },
  { id: 'walkin',      label: 'Walk-in Kiosk',    desc: 'Live turn rotation + waitlist',     plan: 'starter', adminOnly: false },

  // ── Pro (growth + management) ───────────────────────────
  { id: 'reports',     label: 'Reports',          desc: 'Revenue & analytics + AI assistant', plan: 'pro',    adminOnly: false },
  { id: 'chat',        label: 'Communications',   desc: 'SMS, email & in-app messages',      plan: 'pro',     adminOnly: false },
  { id: 'earnings',    label: 'Earnings',         desc: 'Tips, services & take-home',        plan: 'pro',     adminOnly: false },
  { id: 'marketing',   label: 'Marketing',        desc: 'Email campaigns & outreach',        plan: 'pro',     adminOnly: true  },
  { id: 'hr',          label: 'HR',               desc: 'Payroll & compensation',            plan: 'pro',     adminOnly: true  },
  { id: 'attendance',  label: 'Attendance',       desc: 'Clock-in / clock-out times',        plan: 'pro',     adminOnly: true  },
  { id: 'giftcards',   label: 'Gift Cards',       desc: 'Gift cards & promo codes',          plan: 'pro',     adminOnly: true  },
  { id: 'memberships', label: 'Memberships',      desc: 'Recurring plans & members',         plan: 'pro',     adminOnly: true  },
  { id: 'meetings',    label: 'Meetings',         desc: 'Internal team meetings',            plan: 'pro',     adminOnly: true  },
  { id: 'products',    label: 'Products',         desc: 'Retail inventory & stock',          plan: 'pro',     adminOnly: true  },
];

// Tenants without an explicit plan field are treated as pro — preserves
// behavior for the bootstrap admin / Meraki tenant which predates billing.
// New SaaS signups go through createTenantOnboarding and get an explicit
// plan stamped at creation, so this default only catches grandfathered docs.
export function effectivePlan(settings) {
  return settings?.plan || 'pro';
}

export function isModuleAvailableForPlan(moduleOrId, plan) {
  const mod = typeof moduleOrId === 'string' ? MODULES.find(m => m.id === moduleOrId) : moduleOrId;
  if (!mod) return false;
  return PLAN_RANK[mod.plan] <= PLAN_RANK[plan];
}

// Filter the module list down to what should be visible on the home screen
// for this user. Combines: plan gate + role gate + per-tile hide preference.
export function getVisibleModules(settings, { isAdmin, hiddenTiles } = {}) {
  const plan = effectivePlan(settings);
  const hidden = new Set(hiddenTiles || settings?.hiddenTiles || []);
  return MODULES.filter(m => {
    if (m.adminOnly && !isAdmin) return false;
    if (!isModuleAvailableForPlan(m, plan)) return false;
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
