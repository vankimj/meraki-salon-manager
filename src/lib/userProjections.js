// Pure projections of the staff users[] array into the flat allow-lists the
// Firestore security rules read. Imports only the pure rbac matrix (no Firebase)
// so the security-critical mapping (who counts as staff / admin / schedule-view-
// only) is unit-testable in isolation. firestore.js re-exports these and writes
// them on every saveUsers / backfill so role + permission changes take effect at
// the rules layer immediately.
import { resolveRoleCaps, normalizeRole } from './rbac';

// Legacy built-in staff role names — kept for reference/tests. The live
// predicate below is capability-based so custom roles are covered too.
export const STAFF_ROLES = ['admin', 'manager', 'readonly', 'tech', 'scheduler'];

export function emailsByRole(users, predicate) {
  return Array.from(new Set(
    (users || [])
      .filter(u => u && u.email && predicate(u))
      .map(u => String(u.email).trim().toLowerCase())
      .filter(Boolean),
  ));
}

// Staff = any role that resolves to ≥1 capability (kiosk → 0 caps, pending/
// denied → unknown → 0 caps, so they're excluded). With no overlay this is
// byte-identical to the old STAFF_ROLES list; with an overlay it includes
// custom roles. `overlay` = tenant customRoles ({ roles, overrides }) or null.
export function buildStaffEmails(users, overlay) {
  return emailsByRole(users, u => resolveRoleCaps(u.role, overlay).length > 0);
}

// Admin = owner (after alias) OR any role whose resolved caps include an
// Admin (rules' isTenantAdmin) = the built-in Owner role ONLY (owner/admin
// alias). Owner-only capabilities (hr/settings/users/billing) are NOT
// delegatable to custom roles or built-in overrides (saveCustomRoles strips
// them), so no custom role can ever become a tenant admin — closing the
// privilege-escalation path where a non-owner mints an admin-equivalent role.
// `overlay` is accepted for signature symmetry but intentionally unused.
export function buildAdminEmails(users, overlay) { // eslint-disable-line no-unused-vars
  return emailsByRole(users, u => normalizeRole(u.role) === 'owner');
}

// Techs explicitly set to view-only schedule access. The rules' canEditSchedule()
// denies appointment writes for these emails. Only the 'tech' role can be
// view-only — admins/schedulers/readonly always retain their role's write
// behavior, and a tech with no scheduleAccess set defaults to 'edit'.
export function buildScheduleViewOnlyEmails(users) {
  return emailsByRole(users, u => u.role === 'tech' && u.scheduleAccess === 'view');
}
