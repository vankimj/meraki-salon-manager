// Pure projections of the staff users[] array into the flat allow-lists the
// Firestore security rules read. Kept free of any Firebase import so the
// security-critical mapping (who counts as staff / admin / schedule-view-only)
// is unit-testable in isolation. firestore.js re-exports these and writes them
// on every saveUsers / backfill so role + permission changes take effect at
// the rules layer immediately.

// Roles that get staff-level data access (rules' isTenantStaff). 'manager' is
// staff (owner-only writes are gated separately by adminEmails = owners). 'kiosk'
// is intentionally absent — it gets its own limited access (RBAC #8), not blanket
// staff read.
export const STAFF_ROLES = ['admin', 'manager', 'readonly', 'tech', 'scheduler'];

export function emailsByRole(users, predicate) {
  return Array.from(new Set(
    (users || [])
      .filter(u => u && u.email && predicate(u))
      .map(u => String(u.email).trim().toLowerCase())
      .filter(Boolean),
  ));
}

export function buildStaffEmails(users) {
  return emailsByRole(users, u => STAFF_ROLES.includes(u.role));
}

export function buildAdminEmails(users) {
  return emailsByRole(users, u => u.role === 'admin');
}

// Techs explicitly set to view-only schedule access. The rules' canEditSchedule()
// denies appointment writes for these emails. Only the 'tech' role can be
// view-only — admins/schedulers/readonly always retain their role's write
// behavior, and a tech with no scheduleAccess set defaults to 'edit'.
export function buildScheduleViewOnlyEmails(users) {
  return emailsByRole(users, u => u.role === 'tech' && u.scheduleAccess === 'view');
}
