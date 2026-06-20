// Intake-link token: HMAC-SHA256 of (tenantId, formId, clientId, exp),
// truncated to 16 hex chars. Mirrors apptManage.js. The payload is namespaced
// with the `intake:` prefix so a token minted for one purpose (appointment
// manage) can never be replayed against another (intake) even when both share
// the same signing secret. Pinning `exp` into the payload kills replay of an
// old leaked link once it expires.
//
// The secret is passed in by the caller (the Cloud Function injects
// APPT_MANAGE_SECRET) so this module has no firebase-functions dependency and
// is unit-testable with a stub secret.

const crypto = require('crypto');

function tokenPayload(tenantId, formId, clientId, exp) {
  return `intake:${tenantId}:${formId}:${clientId}:${exp}`;
}

function buildIntakeToken(secret, tenantId, formId, clientId, exp) {
  return crypto.createHmac('sha256', secret)
    .update(tokenPayload(tenantId, formId, clientId, exp))
    .digest('hex')
    .slice(0, 16);
}

// Constant-time verify: rejects when any arg is missing, when `exp` isn't a
// finite future unix timestamp, or when the HMAC doesn't match.
function verifyIntakeToken(secret, tenantId, formId, clientId, exp, token, nowUnix) {
  if (!secret || !tenantId || !formId || !clientId || exp == null || !token) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum)) return false;
  const now = nowUnix == null ? Math.floor(Date.now() / 1000) : nowUnix;
  if (expNum <= now) return false;
  const expected = buildIntakeToken(secret, tenantId, formId, clientId, expNum);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { buildIntakeToken, verifyIntakeToken };
