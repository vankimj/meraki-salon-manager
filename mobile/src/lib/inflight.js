// Collapse concurrent identical async calls into ONE shared in-flight promise.
// There is no result caching: the moment the promise settles its slot is freed,
// so the next call re-fetches fresh data. This purely de-dupes the startup
// "thundering herd" — when many mounted hooks fire the same Cloud Function at
// once (e.g. several components each calling useTenantAccess), they now share a
// single request instead of N. Because nothing is cached past the in-flight
// window, it can't serve stale roles/access.
const inflight = new Map();

export function dedupe(key, loader) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = Promise.resolve()
    .then(loader)
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}
