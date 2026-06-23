// Server-side RBAC matrix — the SECURITY enforcement copy. MUST stay in sync
// with src/lib/rbac.js (the web/UI copy). The UI hides things; this is what
// actually blocks a forged request. CommonJS (Cloud Functions runtime).

const OWNER_ONLY = ['hr', 'settings', 'users', 'billing'];
// Caps that gate a Firestore-rules collection by capability (projected into
// data/users.capEmails, read by rules' hasCap()). Must match src/lib/rbac.js.
const DELEGATED_RULE_CAPS = ['attendance', 'marketing'];

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

// Tenant-aware capability check. overlay omitted => original static behavior
// (fast path) — every existing call site is unchanged. MUST match the web copy.
function roleCan(role, cap, overlay) {
  if (!overlay) {
    const r = normalizeRole(role);
    return !!r && ROLE_CAPS[r].includes(cap);
  }
  return resolveRoleCaps(role, overlay).includes(cap);
}

function sanitizeCaps(caps) {
  return (Array.isArray(caps) ? caps : []).filter(c => CAPS.includes(c));
}

// overlay = { roles?: [{ key, caps }], overrides?: { <builtInRole>: { caps } } }
function resolveRoleCaps(role, overlay) {
  const raw = String(role || '').trim().toLowerCase();
  if (!raw) return [];
  const custom = overlay && Array.isArray(overlay.roles) && overlay.roles.find(r => r && r.key === raw);
  if (custom) return sanitizeCaps(custom.caps);
  const r = normalizeRole(raw);
  if (!r) return [];
  if (r === 'owner') return [...CAPS];
  const ov = overlay && overlay.overrides && overlay.overrides[r];
  if (ov && Array.isArray(ov.caps)) return sanitizeCaps(ov.caps);
  return ROLE_CAPS[r];
}

function roleExists(role, overlay) {
  const raw = String(role || '').trim().toLowerCase();
  if (!raw) return false;
  if (normalizeRole(raw)) return true;
  return !!(overlay && Array.isArray(overlay.roles) && overlay.roles.some(r => r && r.key === raw));
}

module.exports = { CAPS, OWNER_ONLY, DELEGATED_RULE_CAPS, ROLES, ALIASES, ROLE_CAPS, normalizeRole, roleCan, sanitizeCaps, resolveRoleCaps, roleExists };
