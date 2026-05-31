// Cross-tenant index of "which salon most recently messaged this client",
// used to route INBOUND replies that arrive on the shared Plume Nexus TFN
// (which serves multiple tenants and therefore can't be reverse-resolved
// via the TFN→tenant registry alone).
//
// Doc shape: `clientSalonIndex/{e164Phone}` →
//   { tenantId, clientId?, lastOutboundAt }
// Top-level collection (doc paths must have even segment count; 2 segments is
// fine — same pattern as smsTfnRegistry). Phone is normalized E.164 (with
// leading "+") so writes from sendSms and reads from the inbound webhook
// match exactly.
//
// Write trigger: every successful outbound sendSms call where (tenantId,
// clientPhone) are both known. Cheap — 1 doc.set per send, merged.
//
// Read trigger: twilioInboundSms when the To-number is the shared TFN.
// In-process cache (5 min) keeps hot inbound paths from re-reading on
// every Twilio request.
//
// Privacy note: this is a cross-tenant lookup table — only the inbound
// webhook (admin SDK) needs to read it. Firestore security rules should
// deny all client-side access to /clientSalonIndex/{*}.

function indexRef(db, phone) {
  return db.doc(`clientSalonIndex/${phone}`);
}

async function setClientLastSalon(db, phone, tenantId, clientId = null) {
  if (!phone || !tenantId) return;
  if (tenantId === '__shared__') return; // guard against sentinel pollution
  try {
    await indexRef(db, phone).set({
      tenantId,
      clientId,
      lastOutboundAt: new Date().toISOString(),
    }, { merge: true });
  } catch (e) {
    // Best-effort: index write failure must not break the underlying SMS
    // send. Worst case is one inbound reply gets misrouted.
    console.warn(`[clientSalonIndex.set] phone=${phone} tenant=${tenantId} failed:`, e?.message);
  }
}

const _indexCache = new Map();
const TTL_MS = 5 * 60 * 1000;

async function lookupClientLastSalon(db, phone) {
  if (!phone) return null;
  const cached = _indexCache.get(phone);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.entry;
  try {
    const snap = await indexRef(db, phone).get();
    const entry = snap.exists ? {
      tenantId:       snap.data().tenantId || null,
      clientId:       snap.data().clientId || null,
      lastOutboundAt: snap.data().lastOutboundAt || null,
    } : null;
    _indexCache.set(phone, { entry, at: Date.now() });
    return entry;
  } catch (e) {
    console.warn(`[clientSalonIndex.lookup] phone=${phone} read failed:`, e?.message);
    return null;
  }
}

// Test hook so lifecycle tests don't get served stale cache entries.
function _resetClientSalonCache() {
  _indexCache.clear();
}

module.exports = {
  indexRef,
  setClientLastSalon,
  lookupClientLastSalon,
  _resetClientSalonCache,
};
