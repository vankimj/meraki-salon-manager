// Role-Based Access Control — the single source of truth for what each role can
// do. Pure + dependency-free so it's shared by web UI gating, mobile, and (the
// matrix mirrored into) Firestore rules. UI gating is UX only; the server still
// enforces every sensitive action (see firestore.rules + the callables).
//
// Confirmed model (2026-06-09):
//   Owner    — everything.
//   Manager  — full operations + reports + refunds, but NOT hr/settings/users/billing.
//   Staff    — own schedule, checkout, view+edit clients, own earnings.
//   Scheduler— front desk: all schedules, checkout, clients, sell gift cards; NO reports.
//   Kiosk    — locked kiosk only, zero management access (anti privilege-escalation).
//   (readonly — legacy view-only; kept for back-compat.)

// Canonical roles, most→least privileged. 'pending'/'denied' are access STATES,
// handled outside RBAC (login gate), not roles here.
export const ROLES = ['owner', 'manager', 'staff', 'scheduler', 'kiosk', 'readonly'];

export const ROLE_LABELS = {
  owner:     'Owner',
  manager:   'Manager',
  staff:     'Staff (tech)',
  scheduler: 'Scheduler (front desk)',
  kiosk:     'Kiosk',
  readonly:  'Read-only',
};

export const ROLE_DESCRIPTIONS = {
  owner:     'Full access — billing, users, HR, settings, everything.',
  manager:   'Runs the salon: schedule, checkout, reports, refunds, inventory. No billing, users, HR, or settings.',
  staff:     'A nail tech: own calendar, checkout, clients, and their own earnings.',
  scheduler: 'Front desk: all calendars, checkout, clients, sell gift cards. No reports or earnings.',
  kiosk:     'Locked front-desk kiosk only. No access to management screens.',
  readonly:  'Can view the schedule, clients, and reports but not change anything.',
};

// Legacy/alias role names → canonical.
const ALIASES = { admin: 'owner', tech: 'staff', front_desk: 'scheduler' };

// Capabilities. Module-visibility caps + a few action-level caps (refund,
// schedule_all vs own, earnings_all vs own, giftcards_sell).
export const CAPS = [
  'pos',             // run checkout / POS
  'refund',          // issue refunds
  'schedule',        // see + use the schedule
  'schedule_all',    // edit ANY tech's calendar (else own only)
  'clients',         // view + edit clients
  'services_edit',   // edit the service menu / pricing
  'reports',         // reports, analytics, sales & receipts
  'earnings_own',    // see own earnings
  'earnings_all',    // see every tech's earnings
  'giftcards_manage',// gift-card / promo admin
  'giftcards_sell',  // sell a gift card at checkout
  'products_edit',   // retail inventory
  'employees',       // manage team profiles
  'attendance',      // attendance / timeclock records
  'meetings',        // internal meetings
  'marketing',       // campaigns
  'memberships',     // recurring plans
  'store',           // product marketplace (Stripe Connect storefront)
  'intake',          // intake & waiver forms
  'programs',        // personalized training programs
  'chat',            // communications
  'walkin',          // walk-in manager
  'hr',              // payroll / compensation        (owner-only)
  'settings',        // admin settings                (owner-only)
  'users',           // user + role management         (owner-only)
  'billing',         // subscription / billing         (owner-only)
];

const OWNER_ONLY = ['hr', 'settings', 'users', 'billing'];

// Role → the capabilities it has. Owner is the full set; manager is everything
// minus the owner-only group; the rest are explicit allow-lists.
export const ROLE_CAPS = {
  owner:     [...CAPS],
  manager:   CAPS.filter(c => !OWNER_ONLY.includes(c)),
  staff:     ['pos', 'schedule', 'clients', 'earnings_own', 'chat', 'programs'],
  scheduler: ['pos', 'schedule', 'schedule_all', 'clients', 'giftcards_sell', 'walkin', 'chat'],
  kiosk:     [],
  readonly:  ['schedule', 'clients', 'reports'],
};

// Normalize any stored role string to a canonical role. Unknown → null (no
// access) so a typo can't silently grant capabilities.
export function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (!r) return null;
  if (ALIASES[r]) return ALIASES[r];
  return ROLES.includes(r) ? r : null;
}

export function roleLabel(role)  { const r = normalizeRole(role); return r ? ROLE_LABELS[r] : 'No access'; }
export function roleCaps(role)   { const r = normalizeRole(role); return r ? ROLE_CAPS[r] : []; }

// Does this role have the capability? readonly is view-only: it never gets
// edit/action caps even if a future matrix tweak adds one by mistake.
export function roleCan(role, cap) {
  const r = normalizeRole(role);
  if (!r) return false;
  return ROLE_CAPS[r].includes(cap);
}

// True for roles that should reach the management app at all (everyone but a
// kiosk user / no-access). Drives the "you have no modules" empty state.
export function isManagementRole(role) {
  const r = normalizeRole(role);
  return !!r && r !== 'kiosk' && ROLE_CAPS[r].length > 0;
}

// Owner check that survives the rename (admin → owner).
export function isOwner(role) { return normalizeRole(role) === 'owner'; }
