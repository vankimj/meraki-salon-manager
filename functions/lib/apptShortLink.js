// Short-link service for the appointment-manage URL. SMS reminders now embed
// `${tenantBaseUrl}/m/${code}`, where `code` is a ~12-char URL-safe random
// handle stored at `platform/apptShortLinks/${code}` with the full
// {tenantId, apptId, exp, token}. The shortLinkRedirect Cloud Function
// resolves the handle and 302s the browser to the canonical
// `?manage=...&tid=...&exp=...&t=...` URL on the same host.
//
// Why a handle instead of HMAC-encoding the params? Together they're ~80
// chars; even base64-packed they push the SMS body past one segment for a
// branded subdomain. The Firestore handle round-trips down to ~12 chars.
//
// `db` is injected so the module is unit-testable with a fake Firestore.

const crypto = require('crypto');

const COLLECTION = 'platform/apptShortLinks';

// 9 random bytes → 12 base64url chars. ~72 bits of entropy; brute-forcing a
// working handle is infeasible, and the embedded apptManageToken is
// independently HMAC-bound so even a guessed handle still requires a valid
// signature to mutate the appointment.
function generateShortCode() {
  return crypto.randomBytes(9).toString('base64url');
}

async function mintShortLink(db, { tenantId, apptId, exp, token }, codeFn = generateShortCode) {
  if (!db || !tenantId || !apptId || !exp || !token) return null;
  const code = codeFn();
  try {
    await db.doc(`${COLLECTION}/${code}`).set({
      tenantId,
      apptId,
      exp:        Number(exp),
      token:      String(token),
      createdAt:  new Date().toISOString(),
    });
    return code;
  } catch (e) {
    console.warn('[mintShortLink] write failed:', e?.message);
    return null;
  }
}

async function lookupShortLink(db, code) {
  if (!db || !code) return null;
  try {
    const snap = await db.doc(`${COLLECTION}/${code}`).get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    if (!d.tenantId || !d.apptId || !d.exp || !d.token) return null;
    return d;
  } catch (e) {
    console.warn(`[lookupShortLink] ${code} read failed:`, e?.message);
    return null;
  }
}

module.exports = { COLLECTION, generateShortCode, mintShortLink, lookupShortLink };
