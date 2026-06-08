// Clock-in "on shift" gate. Pure helpers shared by checkout + schedule edits.
//
// Business rule (decided 2026-06-08): a nail tech who isn't clocked in cannot
// run checkouts or edit their calendar *while on shift* — "on shift" = the
// salon is within its open hours right now. Off shift (salon closed) they may
// edit freely so they can plan from home. Admins/owners are always exempt.
//
// settings.storeHours shape: { Mon:{ open:'10:00', close:'19:00', closed:false }, … }
// Keys are en-US short weekday names (matches ScheduleAdmin.dayOfWeek).

function hhmmToMins(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

// Is the salon within its configured open hours right now? If no hours are
// configured at all we return false (treat as "off shift" → never block) so a
// tenant that hasn't set hours yet isn't locked out of checkout/scheduling.
export function isSalonOpenNow(settings, now = new Date()) {
  const hours = settings && settings.storeHours;
  if (!hours || typeof hours !== 'object') return false;
  const dow = now.toLocaleDateString('en-US', { weekday: 'short' }); // 'Mon'…
  const day = hours[dow];
  if (!day || day.closed) return false;
  const open  = hhmmToMins(day.open);
  const close = hhmmToMins(day.close);
  if (open == null || close == null) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= open && cur < close;
}

// A tech counts as clocked-in (on the clock) if their last attendance event is
// anything other than a clock-out — i.e. 'in', 'break_start' (on break still
// counts as on shift), or 'break_end'. Falls back to the flat clockInAt/
// clockOutAt snapshot for entries written before the event log existed.
export function isEntryClockedIn(entry) {
  if (!entry) return false;
  const events = entry.events;
  if (Array.isArray(events) && events.length) {
    const kind = events[events.length - 1] && events[events.length - 1].kind;
    return kind === 'in' || kind === 'break_start' || kind === 'break_end';
  }
  return !!(entry.clockInAt && !entry.clockOutAt);
}

function norm(s) { return String(s || '').trim().toLowerCase(); }

// Set of lowercased employee names currently clocked in, from an attendance doc
// ({ entries: [...] }). Names are how checkout/schedule reference techs.
export function clockedInNameSet(attendance) {
  const set = new Set();
  ((attendance && attendance.entries) || []).forEach(e => {
    if (isEntryClockedIn(e) && e.employeeName) set.add(norm(e.employeeName));
  });
  return set;
}

// Given the tech names credited on a sale and an attendance doc, return the
// distinct display names that are NOT clocked in (empty array = all good).
// Blank/Walk-in tech slots are ignored.
export function offClockTechNames(techNames, attendance) {
  const inSet = clockedInNameSet(attendance);
  const seen = new Set();
  const missing = [];
  (techNames || []).forEach(n => {
    const key = norm(n);
    if (!key || key === 'walk-in' || key === 'tbd' || seen.has(key)) return;
    seen.add(key);
    if (!inSet.has(key)) missing.push(String(n).trim());
  });
  return missing;
}

// Today's attendance doc id (salon-local YYYY-MM-DD).
export function attendanceKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
