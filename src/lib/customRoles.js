// Tenant custom roles + built-in overrides — the "overlay" consumed by rbac.js
// (resolveRoleCaps / roleCan / isManagementRole). Stored at one doc per tenant:
//   tenants/{tid}/data/customRoles  →  { roles: [...], overrides: {...} }
//
// Writes go through the saveCustomRoles CALLABLE (server validates every cap
// against CAPS and refuses to weaken Owner). The client NEVER writes this doc
// directly (firestore.rules: write:false) — it's a security-critical doc.
import { db, callFn } from './firebase';
import { TENANT_ID } from './tenant';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

const rolesDoc = () => doc(db, 'tenants', TENANT_ID, 'data', 'customRoles');

// Always returns the overlay shape, even for a missing/blank doc.
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
      // A denied read (e.g. logged-out/kiosk) just means "no overlay" → built-in
      // roles only. Never throw; fail closed to the static matrix.
      console.warn('[customRoles] subscribe error:', err?.code || err?.message);
      cb(normalizeCustomRoles(null));
    }
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

// roles    = [{ key, label, description, caps:[], baseRole? }]
// overrides = { <builtInRole>: { caps:[] } }   (owner/admin rejected server-side)
export async function saveCustomRoles({ roles, overrides }) {
  const res = await callFn('saveCustomRoles')({ tenantId: TENANT_ID, roles, overrides });
  return res.data;
}
