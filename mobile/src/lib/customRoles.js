// Tenant custom-role overlay consumed by rbac.js (resolveRoleCaps / roleCan).
// Mobile twin of web src/lib/customRoles.js — same shape, but the doc ref is
// built from getCurrentTenant() (mobile is multi-tenant) instead of TENANT_ID.
//   tenants/{tid}/data/customRoles  →  { roles: [...], overrides: {...} }
// The client NEVER writes this doc (firestore.rules: write:false); it's managed
// via the saveCustomRoles callable on web. Mobile only READS it so role edits
// project correctly into staffEmails/capEmails.
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { getCurrentTenant } from './currentTenant';

const rolesDoc = () => doc(db, 'tenants', getCurrentTenant(), 'data', 'customRoles');

// Always returns the overlay shape, even for a missing/blank/denied doc.
export function normalizeCustomRoles(data) {
  return {
    roles:     Array.isArray(data && data.roles) ? data.roles : [],
    overrides: (data && typeof data.overrides === 'object' && data.overrides) || {},
  };
}

export function subscribeCustomRoles(cb) {
  return onSnapshot(
    rolesDoc(),
    s => cb(normalizeCustomRoles(s.exists() ? s.data() : null)),
    err => {
      // A denied read just means "no overlay" → built-in roles only. Never
      // throw; fail closed to the static matrix.
      console.warn('[customRoles] subscribe error:', err?.code || err?.message);
      cb(normalizeCustomRoles(null));
    },
  );
}

export async function getCustomRoles() {
  try {
    const snap = await getDoc(rolesDoc());
    return normalizeCustomRoles(snap.exists() ? snap.data() : null);
  } catch {
    return normalizeCustomRoles(null);
  }
}
