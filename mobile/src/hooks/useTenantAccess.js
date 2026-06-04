import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, callFn, ALLOWED_EMAILS } from '../lib/firebase';
import { getCurrentTenant, subscribeTenant } from '../lib/currentTenant';
import useMyTenants from './useMyTenants';

// Resolves the signed-in user's access in the CURRENT tenant — the
// mobile equivalent of the web AppContext role flags
// (src/context/AppContext.jsx:616-631).
//
// Two sources, combined:
//   - useMyTenants() → coarse per-tenant role ('admin' | 'staff') + plan.
//   - getMyTenantRole callable → granular role ('admin' | 'readonly' |
//     'tech' | 'scheduler'), techName, scheduleAccess ('edit' | 'view').
//
// Returns:
//   { isAdmin, role, techName, scheduleAccess, plan, canEditSchedule,
//     email, loading }
//
// canEditSchedule mirrors the web's canEditSchedule rule predicate — an
// admin always can; a tech/scheduler can unless they're view-only. This
// gates the appointment Delete button (and the rules enforce the same).
export default function useTenantAccess() {
  const { tenants, current } = useMyTenants();
  const [granular, setGranular] = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function refetch() {
      const user = auth.currentUser;
      if (!user?.email) { setGranular(null); setLoading(false); return; }
      setLoading(true);
      try {
        const res = await callFn('getMyTenantRole')({ tenantId: getCurrentTenant() });
        if (!cancelled) setGranular(res?.data || null);
      } catch {
        if (!cancelled) setGranular(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const unsubAuth   = onAuthStateChanged(auth, () => refetch());
    const unsubTenant = subscribeTenant(() => refetch());
    return () => { cancelled = true; unsubAuth(); unsubTenant(); };
  }, []);

  const email   = (auth.currentUser?.email || '').toLowerCase();
  const coarse  = tenants.find(t => t.id === current);
  const role    = granular?.role || null;
  const isAdmin =
    role === 'admin' ||
    coarse?.role === 'admin' ||
    ALLOWED_EMAILS.includes(email);
  const techName       = granular?.techName || null;
  const scheduleAccess = granular?.scheduleAccess || 'edit';
  const plan           = coarse?.plan || null;
  const canEditSchedule =
    isAdmin || ((role === 'tech' || role === 'scheduler') && scheduleAccess !== 'view');

  return { isAdmin, role, techName, scheduleAccess, plan, canEditSchedule, email, loading };
}
