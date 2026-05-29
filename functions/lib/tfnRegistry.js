// TFN ↔ tenant registry. Inbound SMS webhooks arrive with `To = <tenant TFN>`
// and no tenant context, so we need a fast TFN→tenantId lookup to route the
// message to the right tenant's chat thread / STOP-handler / etc.
//
// Doc shape: `platform/smsTfnRegistry/{e164Phone}` →
//   { tenantId, sandbox?: boolean, registeredAt }
// One doc per TFN; the phone is the document id (E.164 with leading "+", a
// legal Firestore id — "/" is the only forbidden character).
//
// `db` is injected into every call so this module stays free of firebase-admin
// initialization and is unit-testable against a fake Firestore.

function tfnRegistryRef(db, phone) {
  return db.doc(`platform/smsTfnRegistry/${phone}`);
}

async function registerTfnForTenant(db, phone, tenantId, sandbox = false) {
  if (!phone || !tenantId) return;
  try {
    await tfnRegistryRef(db, phone).set({
      tenantId, sandbox, registeredAt: new Date().toISOString(),
    }, { merge: true });
  } catch (e) {
    console.error(`[registerTfnForTenant] tenant=${tenantId} phone=${phone} write failed:`, e?.message);
  }
}

async function unregisterTfn(db, phone) {
  if (!phone) return;
  try {
    await tfnRegistryRef(db, phone).delete();
  } catch (e) {
    console.warn(`[unregisterTfn] phone=${phone} delete failed (likely already gone):`, e?.message);
  }
}

// Lookup tenantId by TFN. Returns null when no registry entry exists.
// Cached in-process for 5 min to keep inbound webhook latency low — note this
// means an unregister isn't observed until the cache expires, an acceptable
// stale-routing window since releases are rare and no SMS flows to a released
// number.
const _tfnLookupCache = new Map();
async function findTenantByTfn(db, phone) {
  if (!phone) return null;
  const cached = _tfnLookupCache.get(phone);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.tenantId;
  try {
    const snap = await tfnRegistryRef(db, phone).get();
    const tenantId = snap.exists ? (snap.data().tenantId || null) : null;
    _tfnLookupCache.set(phone, { tenantId, at: Date.now() });
    return tenantId;
  } catch (e) {
    console.warn(`[findTenantByTfn] phone=${phone} read failed:`, e?.message);
    return null;
  }
}

// Test hook: drop the in-process lookup cache so lifecycle tests aren't served
// a stale entry from a previous assertion.
function _resetTfnCache() {
  _tfnLookupCache.clear();
}

module.exports = {
  tfnRegistryRef,
  registerTfnForTenant,
  unregisterTfn,
  findTenantByTfn,
  _resetTfnCache,
};
