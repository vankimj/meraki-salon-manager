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
  'intake',          // intake & waiver forms
  'programs',        // personalized training programs
  'chat',            // communications
  'walkin',          // walk-in manager
  'hr',              // payroll / compensation        (owner-only)
  'settings',        // admin settings                (owner-only)
  'users',           // user + role management         (owner-only)
  'billing',         // subscription / billing         (owner-only)
];

export const OWNER_ONLY = ['hr', 'settings', 'users', 'billing'];

// Capabilities that gate a Firestore-rules collection by CAPABILITY (not just
// owner). These are projected into data/users.capEmails and read by the rules'
// hasCap(). Owner is always isTenantAdmin (short-circuits hasCap), so this is
// only the set the owner may DELEGATE to a manager/custom role for server-side
// access to that collection. Adding a cap here + the matching firestore.rules
// block + collection delegates it. Kept tiny on purpose: money/PII collections
// (memberships, gift cards, intake) stay Owner-only by product decision.
export const DELEGATED_RULE_CAPS = ['attendance', 'marketing'];

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
//
// Tenant-aware: pass the tenant's custom-role `overlay` to honor owner-defined
// roles. With NO overlay this is the original static behavior, byte-for-byte
// (fast path) — every existing call site is unchanged.
export function roleCan(role, cap, overlay) {
  if (!overlay) {
    const r = normalizeRole(role);
    return !!r && ROLE_CAPS[r].includes(cap);
  }
  return resolveRoleCaps(role, overlay).includes(cap);
}

// Drop any cap not in the canonical CAPS list — defense in depth so a forged
// doc/payload can never smuggle an undefined privilege.
export function sanitizeCaps(caps) {
  return (Array.isArray(caps) ? caps : []).filter(c => CAPS.includes(c));
}

// Resolve a role's EFFECTIVE capabilities given an optional tenant overlay:
//   overlay = { roles?: [{ key, caps }], overrides?: { <builtInRole>: { caps } } }
//   1. a custom_* role in overlay.roles  → its caps
//   2. a built-in role (after aliasing) with an override → the override's caps
//   3. owner                              → ALWAYS the full set (never overridable)
//   4. a built-in role                    → static ROLE_CAPS
//   5. unknown                            → [] (no access)
export function resolveRoleCaps(role, overlay) {
  const raw = String(role || '').trim().toLowerCase();
  if (!raw) return [];
  const custom = overlay && Array.isArray(overlay.roles) && overlay.roles.find(r => r && r.key === raw);
  if (custom) return sanitizeCaps(custom.caps);
  const r = normalizeRole(raw);
  if (!r) return [];
  if (r === 'owner') return [...CAPS];                         // owner is sacrosanct
  const ov = overlay && overlay.overrides && overlay.overrides[r];
  if (ov && Array.isArray(ov.caps)) return sanitizeCaps(ov.caps);
  return ROLE_CAPS[r];
}

// Is `role` something the tenant can legitimately assign — a canonical role, a
// legacy alias, or a known custom_* key in the overlay? (normalizeRole stays
// strict to canonical names; custom keys validate here.)
export function roleExists(role, overlay) {
  const raw = String(role || '').trim().toLowerCase();
  if (!raw) return false;
  if (normalizeRole(raw)) return true;
  return !!(overlay && Array.isArray(overlay.roles) && overlay.roles.some(r => r && r.key === raw));
}

// True for roles that should reach the management app at all (everyone but a
// kiosk user / no-access). Overlay-aware so custom roles light up the nav.
export function isManagementRole(role, overlay) {
  const raw = String(role || '').trim().toLowerCase();
  if (raw === 'kiosk') return false;
  return resolveRoleCaps(raw, overlay).length > 0;
}

// Owner check that survives the rename (admin → owner).
export function isOwner(role) { return normalizeRole(role) === 'owner'; }

// ── UI metadata: plain-language capability groups for the Roles editor ───────
// NOT a security boundary — purely how the owner-facing toggles are organized
// and labeled. The security matrix is CAPS / ROLE_CAPS above. `danger:true`
// marks the sensitive owner-only group (assigning these warns the owner).
export const CAP_GROUPS = [
  { title: 'Front desk & checkout', caps: [
    { cap: 'pos',            label: 'Take payments / run checkout' },
    { cap: 'giftcards_sell', label: 'Sell gift cards at checkout' },
    { cap: 'refund',         label: 'Issue refunds & store credit' },
    { cap: 'walkin',         label: 'Manage the walk-in waitlist' },
  ] },
  { title: 'Calendar', caps: [
    { cap: 'schedule',     label: 'See & use the schedule' },
    { cap: 'schedule_all', label: "Edit anyone's calendar (not just their own)" },
  ] },
  { title: 'Clients & services', caps: [
    { cap: 'clients',       label: 'View & edit client profiles' },
    { cap: 'services_edit', label: 'Edit the service menu & prices' },
    { cap: 'products_edit', label: 'Manage retail products & stock' },
    { cap: 'intake',        label: 'Manage intake & waiver forms' },
    { cap: 'programs',      label: 'Manage training programs' },
  ] },
  { title: 'Money & reports', caps: [
    { cap: 'reports',          label: 'View reports, sales & receipts' },
    { cap: 'earnings_own',     label: 'See their own earnings' },
    { cap: 'earnings_all',     label: "See everyone's earnings" },
    { cap: 'giftcards_manage', label: 'Manage gift cards & promo codes' },
    { cap: 'memberships',      label: 'Manage memberships' },
  ] },
  { title: 'Team & communication', caps: [
    { cap: 'chat',       label: 'Send messages (SMS / email / in-app)' },
    { cap: 'employees',  label: 'Manage team profiles' },
    { cap: 'attendance', label: 'View clock-in / clock-out records' },
    { cap: 'meetings',   label: 'Manage internal meetings' },
    { cap: 'marketing',  label: 'Run marketing campaigns' },
  ] },
  { title: 'Owner-only (sensitive)', danger: true, caps: [
    { cap: 'hr',       label: 'Payroll & compensation' },
    { cap: 'settings', label: 'Admin settings' },
    { cap: 'users',    label: 'Manage users & roles' },
    { cap: 'billing',  label: 'Subscription & billing' },
  ] },
];
