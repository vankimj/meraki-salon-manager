// Appointment-manage token: HMAC-SHA256 of (tenantId, apptId, exp), truncated
// to 16 hex chars. Pinning `exp` into the HMAC payload means a leaked SMS
// from months ago can't be replayed once the appointment has passed.
//
// The Cloud Functions secret (`APPT_MANAGE_SECRET`) is injected into every
// call so this module stays free of firebase-functions imports and is
// unit-testable with a stub secret.

const crypto = require('crypto');

// `apptExpUnix` lives in ./tenantTime.js — it's TZ-aware (needs the tenant's
// configured timezone to compute the real moment of the appointment) so it
// belongs with the rest of the tenant-time helpers, not in the HMAC module.

function tokenPayload(tenantId, apptId, exp) {
  return `appt:${tenantId}:${apptId}:${exp}`;
}

function buildApptManageToken(secret, tenantId, apptId, exp) {
  return crypto.createHmac('sha256', secret)
    .update(tokenPayload(tenantId, apptId, exp))
    .digest('hex')
    .slice(0, 16);
}

// Constant-time verify: rejects when any arg is missing, when `exp` isn't a
// finite future unix timestamp, or when the HMAC doesn't match.
function verifyApptManageToken(secret, tenantId, apptId, exp, token, nowUnix) {
  if (!secret || !tenantId || !apptId || exp == null || !token) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum)) return false;
  const now = nowUnix == null ? Math.floor(Date.now() / 1000) : nowUnix;
  if (expNum <= now) return false;
  const expected = buildApptManageToken(secret, tenantId, apptId, expNum);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { buildApptManageToken, verifyApptManageToken };
