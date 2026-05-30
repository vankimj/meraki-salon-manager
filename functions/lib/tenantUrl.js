// Resolves a tenant's public customer-facing base URL — the host that
// reminders, magic-links, and self-service appointment URLs point at.
// Pattern: `https://${tenant.subdomain || tenantId}.plumenexus.com`,
// matching the existing reads at functions/index.js:1585/6914 and the
// writes in createTenantOnboarding (subdomain field on the tenant doc).
//
// In-process cache (5-min TTL) keeps the SMS-reminder cron's hundreds of
// token mints from hammering Firestore for the same lookup. `db` is
// injected so this module is unit-testable with a fake Firestore.

const _baseUrlCache = new Map();
const TTL_MS = 5 * 60 * 1000;

async function tenantBaseUrl(db, tenantId) {
  if (!tenantId) return null;
  const cached = _baseUrlCache.get(tenantId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.url;
  let subdomain = tenantId;
  try {
    const snap = await db.doc(`tenants/${tenantId}`).get();
    if (snap.exists) {
      const sd = String(snap.data().subdomain || '').trim();
      if (sd) subdomain = sd;
    }
  } catch (e) {
    console.warn(`[tenantBaseUrl] ${tenantId} read failed:`, e?.message);
  }
  const url = `https://${subdomain}.plumenexus.com`;
  _baseUrlCache.set(tenantId, { url, at: Date.now() });
  return url;
}

// Test hook: drop the cache so lifecycle tests aren't served stale entries.
function _resetTenantUrlCache() {
  _baseUrlCache.clear();
}

module.exports = { tenantBaseUrl, _resetTenantUrlCache };
