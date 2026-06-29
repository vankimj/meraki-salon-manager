// Server-side RBAC matrix — the SECURITY enforcement copy. MUST stay in sync
// with src/lib/rbac.js (the web/UI copy). The UI hides things; this is what
// actually blocks a forged request. CommonJS (Cloud Functions runtime).

const OWNER_ONLY = ['hr', 'settings', 'users', 'billing'];

const CAPS = [
  'pos', 'refund',
  'schedule', 'schedule_all',
  'clients',
  'services_edit',
  'reports',
  'earnings_own', 'earnings_all',
  'giftcards_manage', 'giftcards_sell',
  'products_edit',
  'employees',
  'attendance',
  'meetings',
  'marketing',
  'memberships',
  'store',
  'intake',
  'programs',
  'chat',
  'walkin',
  'hr', 'settings', 'users', 'billing',
];

const ROLE_CAPS = {
  owner:     [...CAPS],
  manager:   CAPS.filter(c => !OWNER_ONLY.includes(c)),
  staff:     ['pos', 'schedule', 'clients', 'earnings_own', 'chat', 'programs'],
  scheduler: ['pos', 'schedule', 'schedule_all', 'clients', 'giftcards_sell', 'walkin', 'chat'],
  kiosk:     [],
  readonly:  ['schedule', 'clients', 'reports'],
};

const ALIASES = { admin: 'owner', tech: 'staff', front_desk: 'scheduler' };
const ROLES = Object.keys(ROLE_CAPS);

function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (!r) return null;
  if (ALIASES[r]) return ALIASES[r];
  return ROLES.includes(r) ? r : null;
}

function roleCan(role, cap) {
  const r = normalizeRole(role);
  if (!r) return false;
  return ROLE_CAPS[r].includes(cap);
}

module.exports = { CAPS, ROLE_CAPS, normalizeRole, roleCan };
