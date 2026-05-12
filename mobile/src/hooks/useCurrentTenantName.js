import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getCurrentTenant, subscribeTenant } from '../lib/currentTenant';

// Display name of the currently-selected tenant. Reads from
// `tenants/{id}.name` (the registry doc), which is publicly readable.
// Caches results in a module-scoped map so each screen's header
// doesn't refetch the same tenant doc — this hook can mount many
// times across the tab navigator without thrashing Firestore.
const cache = new Map();

export default function useCurrentTenantName() {
  const [name, setName] = useState(() => cache.get(getCurrentTenant()) || null);
  const [tenantId, setTenantId] = useState(getCurrentTenant());

  useEffect(() => subscribeTenant((id) => {
    setTenantId(id);
    setName(cache.get(id) || null);
  }), []);

  useEffect(() => {
    if (!tenantId || cache.has(tenantId)) return;
    let cancelled = false;
    getDoc(doc(db, 'tenants', tenantId))
      .then(snap => {
        const display = snap.exists() ? (snap.data().name || tenantId) : tenantId;
        cache.set(tenantId, display);
        if (!cancelled) setName(display);
      })
      .catch(() => {
        cache.set(tenantId, tenantId);
        if (!cancelled) setName(tenantId);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  return name;
}
