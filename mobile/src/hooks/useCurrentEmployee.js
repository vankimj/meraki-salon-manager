import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { fetchEmployeeByEmail } from '../lib/firestore';
import { getCurrentTenant, subscribeTenant } from '../lib/currentTenant';
import { dedupe } from '../lib/inflight';

// Looks up the signed-in user's employee record (by email) so screens
// can scope to "my appointments", "my earnings", etc. Returns null while
// loading or when the user isn't an employee in the current tenant.
//
// Refreshes when:
//   - auth state changes (sign-in / sign-out)
//   - the current tenant changes (multi-tenant salon switcher)
export default function useCurrentEmployee() {
  const [emp, setEmp] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function refetch() {
      const user = auth.currentUser;
      if (cancelled) return;
      if (!user?.email) {
        setEmp(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const e = await dedupe(`emp:${getCurrentTenant()}:${user.email.toLowerCase()}`, () => fetchEmployeeByEmail(user.email));
        if (!cancelled) setEmp(e);
      } catch (err) {
        console.warn('[useCurrentEmployee] lookup failed:', err?.message);
        if (!cancelled) setEmp(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const unsubAuth   = onAuthStateChanged(auth, () => refetch());
    const unsubTenant = subscribeTenant(() => refetch());
    return () => { cancelled = true; unsubAuth(); unsubTenant(); };
  }, []);

  return { employee: emp, techName: emp?.name || null, loading };
}
