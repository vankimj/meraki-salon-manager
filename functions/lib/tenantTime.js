// Per-tenant reminder-time helpers. The reminder cron runs every hour
// (UTC); each tenant has a `reminderHour` (0-23) and `timezone` (IANA) in
// `data/settings`. The cron asks `currentHourInTimezone(now, tz)` for each
// tenant and only sends when it matches their `reminderHour`. Defaults
// preserve the legacy "9 AM Eastern" behavior so tenants who haven't set
// anything see no change.

const DEFAULT_REMINDER_HOUR = 9;
const DEFAULT_BIRTHDAY_HOUR = 10;
const DEFAULT_LAPSED_HOUR   = 11;
const DEFAULT_TIMEZONE      = 'America/New_York';

// Returns the hour (0-23) of `date` interpreted in IANA timezone `tz`.
// Uses Intl.DateTimeFormat for cross-runtime correctness (Cloud Functions
// run in UTC, where bare Date methods give the wrong hour).
function currentHourInTimezone(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour:     'numeric',
    hour12:   false,
    timeZone: tz || DEFAULT_TIMEZONE,
  });
  // Intl returns "24" for midnight under some Node versions; normalize.
  const h = parseInt(fmt.format(date), 10);
  return Number.isFinite(h) ? (h % 24) : 0;
}

// Internal helper. Validates a 0–23 hour, returning the default for anything
// missing, NaN, fractional-out-of-range, or otherwise unusable.
function _validHour(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const floored = Math.floor(n);
  if (floored < 0 || floored > 23) return fallback;
  return floored;
}

// Resolves the daily-reminder-hour the cron should compare against. Accepts
// `settings.reminderHour` (number 0-23) and clamps to that range. Anything
// missing, NaN, or out of range falls back to 9 AM.
function resolveReminderHour(settings) {
  return _validHour(settings?.reminderHour, DEFAULT_REMINDER_HOUR);
}

function resolveBirthdayHour(settings) {
  return _validHour(settings?.birthdayHour, DEFAULT_BIRTHDAY_HOUR);
}

function resolveLapsedHour(settings) {
  return _validHour(settings?.lapsedHour, DEFAULT_LAPSED_HOUR);
}

function resolveTimezone(settings) {
  const tz = (settings?.timezone || '').toString().trim();
  return tz || DEFAULT_TIMEZONE;
}

// Convenience: returns true when "now" in the tenant's timezone matches
// the tenant's configured reminder hour. The cron just calls this per-tenant.
function shouldSendRemindersNow(now, settings) {
  const tz   = resolveTimezone(settings);
  const want = resolveReminderHour(settings);
  return currentHourInTimezone(now, tz) === want;
}

// Same shape as shouldSendRemindersNow but also gates on day-of-week.
// `dayOfWeek` is 0-6 (Sunday=0). Used by autoLapsedCampaign which fires
// once a week on a specific day at a specific hour, in the tenant's TZ.
function shouldFireDayHourNow(now, tz, dayOfWeek, hour) {
  const zone = tz || DEFAULT_TIMEZONE;
  // Day-of-week in zone — Intl exposes weekday=narrow|short|long; we need
  // the integer, so parse the long form against a fixed map.
  const wd = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: zone }).format(now);
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  if (DOW[wd] !== dayOfWeek) return false;
  return currentHourInTimezone(now, zone) === hour;
}

// Returns the unix-seconds instant for `appt.date + appt.startTime`
// interpreted as wall-clock time in `tz`. Used wherever code needs the
// REAL moment the appointment happens (cancellation-policy comparisons,
// token expiry, etc.) — bare `new Date('${date}T${time}:00')` interprets
// as server-local (UTC in Cloud Functions) and is off by the tz offset.
//
// Approach: build the target wall-clock as if UTC, ask Intl what the tz
// would show for that instant, take the delta as the offset, and shift.
// Handles DST correctly within one hour (the offset is computed at the
// rough target instant, not a fixed value).
function apptInstantUnix(appt, tz) {
  const date = appt && appt.date;
  const time = (appt && appt.startTime) || '00:00';
  if (!date) return null;
  const [y, mo, d]  = String(date).split('-').map(Number);
  const [h, mn]     = String(time).split(':').map(Number);
  if (![y, mo, d].every(Number.isFinite)) return null;
  const asUtcMs = Date.UTC(y, mo - 1, d, h || 0, mn || 0);
  const zone = tz || DEFAULT_TIMEZONE;
  const fmt = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: zone,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(asUtcMs)).map(p => [p.type, p.value]));
  const wallUtcMs = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute),
  );
  const offsetMs = wallUtcMs - asUtcMs;
  return Math.floor((asUtcMs - offsetMs) / 1000);
}

// Token expiry: 24h after the appointment's real start instant in `tz`.
// Covers late confirms and absorbs DST ambiguity. Falls back to 0 (treated
// as expired) on a malformed appt.
function apptExpUnix(appt, tz) {
  const start = apptInstantUnix(appt, tz);
  return start == null ? 0 : start + 24 * 3600;
}

// Cached lookup of a tenant's configured timezone. Mirrors tenantBaseUrl's
// 5-min in-process cache so callers (apptManageUrl, apptExpUnix users in
// the per-appt loop, manageAppointment policy compares) can stop reading
// settings hot per call.
const _tenantTzCache = new Map();
const _TZ_TTL_MS = 5 * 60 * 1000;
async function tenantTimezone(db, tenantId) {
  if (!tenantId) return DEFAULT_TIMEZONE;
  const cached = _tenantTzCache.get(tenantId);
  if (cached && Date.now() - cached.at < _TZ_TTL_MS) return cached.tz;
  let tz = DEFAULT_TIMEZONE;
  try {
    const snap = await db.doc(`tenants/${tenantId}/data/settings`).get();
    if (snap.exists) tz = resolveTimezone(snap.data());
  } catch (e) {
    console.warn(`[tenantTimezone] ${tenantId} read failed:`, e?.message);
  }
  _tenantTzCache.set(tenantId, { tz, at: Date.now() });
  return tz;
}
function _resetTenantTzCache() { _tenantTzCache.clear(); }

module.exports = {
  DEFAULT_REMINDER_HOUR,
  DEFAULT_BIRTHDAY_HOUR,
  DEFAULT_LAPSED_HOUR,
  DEFAULT_TIMEZONE,
  currentHourInTimezone,
  resolveReminderHour,
  resolveBirthdayHour,
  resolveLapsedHour,
  resolveTimezone,
  shouldSendRemindersNow,
  shouldFireDayHourNow,
  apptInstantUnix,
  apptExpUnix,
  tenantTimezone,
  _resetTenantTzCache,
};
