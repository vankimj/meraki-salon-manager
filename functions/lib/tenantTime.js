// Per-tenant reminder-time helpers. The reminder cron runs every hour
// (UTC); each tenant has a `reminderHour` (0-23) and `timezone` (IANA) in
// `data/settings`. The cron asks `currentHourInTimezone(now, tz)` for each
// tenant and only sends when it matches their `reminderHour`. Defaults
// preserve the legacy "9 AM Eastern" behavior so tenants who haven't set
// anything see no change.

const DEFAULT_REMINDER_HOUR = 9;
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

// Resolves the reminder-hour the cron should compare against. Accepts
// `settings.reminderHour` (number 0-23) and clamps to that range. Anything
// missing, NaN, or out of range falls back to 9 AM.
function resolveReminderHour(settings) {
  const raw = settings?.reminderHour;
  if (raw == null || raw === '') return DEFAULT_REMINDER_HOUR;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_REMINDER_HOUR;
  const floored = Math.floor(n);
  if (floored < 0 || floored > 23) return DEFAULT_REMINDER_HOUR;
  return floored;
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

module.exports = {
  DEFAULT_REMINDER_HOUR,
  DEFAULT_TIMEZONE,
  currentHourInTimezone,
  resolveReminderHour,
  resolveTimezone,
  shouldSendRemindersNow,
};
