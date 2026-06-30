// Per-tech appointment-only hours.
//
// Each employee can have their own appointment window (`emp.apptHours = {open,
// close}`) that — only when `emp.extendedHoursAllowed` is on — lets them be
// booked OUTSIDE public store hours (an admin-only "appointment-only" extension).
// It defaults to the day's store hours (= no extension), and is never narrower
// than store hours. This replaces the old salon-wide `settings.apptHours`.
//
// Pure (no React/Firestore) so it's shared by the web grid, the seat-time
// helpers, and the Cloud Functions, and unit-tested in apptHours.test.js.

export function toMins(s) {
  if (!s) return null;
  const [h, m] = String(s).split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

const DEFAULT_OPEN = 540;   // 09:00
const DEFAULT_CLOSE = 1080; // 18:00

// Public store hours (minutes) for a day-of-week key (e.g. 'Mon').
export function storeWindow(settings, dow) {
  const d = (settings && settings.storeHours && settings.storeHours[dow]) || {};
  return {
    closed: !!d.closed,
    open:  d.open  != null && d.open  !== '' ? toMins(d.open)  : DEFAULT_OPEN,
    close: d.close != null && d.close !== '' ? toMins(d.close) : DEFAULT_CLOSE,
  };
}

// The bookable APPOINTMENT window (minutes) for a tech on a day-of-week:
//   • not extended-allowed → store hours.
//   • extended-allowed     → the tech's apptHours, falling back to store hours
//     for any unset side; clamped so it can only widen (never narrow) store hours.
// `legacyApptHours` (the retired salon-wide settings.apptHours) is used only as a
// migration fallback for an extended tech who hasn't been given a per-tech window
// yet, so existing extended techs don't silently lose their extension.
export function techApptWindow(emp, settings, dow, legacyApptHours) {
  const store = storeWindow(settings, dow);
  if (!emp || !emp.extendedHoursAllowed) return { open: store.open, close: store.close };
  const ah = emp.apptHours || {};
  const legacy = legacyApptHours || {};
  const openSrc  = (ah.open  != null && ah.open  !== '') ? ah.open  : legacy.open;
  const closeSrc = (ah.close != null && ah.close !== '') ? ah.close : legacy.close;
  const open  = openSrc  ? toMins(openSrc)  : store.open;
  const close = closeSrc ? toMins(closeSrc) : store.close;
  return { open: Math.min(open, store.open), close: Math.max(close, store.close) };
}

// Build a { techName: {open, close} } map for one day from employee records —
// the shape the grid + seat-time consume.
export function buildTechApptHours(employees, settings, dow, legacyApptHours) {
  const map = {};
  (employees || []).forEach(e => {
    if (!e || !e.name) return;
    map[e.name] = techApptWindow(e, settings, dow, legacyApptHours);
  });
  return map;
}

// Earliest open / latest close across a set of techs (for the grid's time axis),
// floored/capped by the walk-in (store) span so the grid always covers store hours.
export function daySpanFromTechHours(techHoursMap, walkInOpen, walkInClose) {
  let open = walkInOpen, close = walkInClose;
  Object.values(techHoursMap || {}).forEach(w => {
    if (w.open  < open)  open  = w.open;
    if (w.close > close) close = w.close;
  });
  return { open, close };
}
