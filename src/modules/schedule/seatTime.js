// Pure scheduling-time helpers, extracted from ScheduleAdmin so the
// "next opening" / seated-walk-in default-time logic can be unit-tested
// without rendering the whole module. All inputs (including `now`) are passed
// explicitly so tests can pin the clock.

function strToMins(str) {
  if (!str) return 0;
  const [h, m] = String(str).split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function dowOf(now) {
  return now.toLocaleDateString('en-US', { weekday: 'short' });
}

// First open slot (minutes since midnight) today for `techName` — or, for an
// unset tech, the next open slot from `now` within appt hours. Floors at the
// salon's PUBLIC open time so a seated walk-in never lands on a pre-open slot
// (the apptHours scheduling window can legitimately start earlier than the
// storefront opens — e.g. 9am vs 10am). Returns null when the tech is off, the
// salon is closed today, or nothing fits before close.
export function computeNextOpening({
  settings = {}, empWorkDays = {}, appts = [], now, techName = '', durationMins = 60, today,
}) {
  const dow = dowOf(now);
  const wd = techName ? empWorkDays?.[techName]?.[dow] : null;
  if (wd && wd.on === false) return null;
  const store = settings.storeHours?.[dow] || {};
  if (store.closed) return null;                       // salon closed today → no in-hours slot
  const apptOpen  = strToMins(settings.apptHours?.open  || '09:00');
  const apptClose = strToMins(settings.apptHours?.close || '20:00');
  const dayFloor  = store.open ? Math.max(apptOpen, strToMins(store.open)) : apptOpen;
  const techOpen  = Math.max(dayFloor, wd?.start ? strToMins(wd.start) : dayFloor);
  const techClose = Math.min(apptClose, wd?.end   ? strToMins(wd.end)   : apptClose);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const norm = s => String(s || '').trim().toLowerCase();
  const busy = (techName ? appts.filter(a => a.date === today && norm(a.techName) === norm(techName)
      && a.status !== 'cancelled' && a.status !== 'no_show' && a._deleted !== true) : [])
    .map(a => {
      const s = strToMins(a.startTime || '00:00');
      const occ = (Array.isArray(a.services) ? a.services.reduce((sum, sv) => sum + (Number(sv.duration) || 0), 0) : 0) || (Number(a.duration) || 60);
      return { s, e: s + occ };
    });
  const STEP = 15;
  let m = Math.max(techOpen, nowMins);
  if (m % STEP !== 0) m += STEP - (m % STEP);
  for (; m + durationMins <= techClose; m += STEP) {
    if (!busy.some(b => b.s < m + durationMins && b.e > m)) return m;
  }
  return null;
}

// Default start time (minutes since midnight) for a SEATED walk-in.
//
// A walk-in is being seated NOW, so:
//   • the tech's next real opening (>= now, in-hours) when one exists — e.g.
//     before open it returns the open time, mid-shift the next free slot; OR
//   • when none is left today (after close, fully booked, tech off, or salon
//     closed) → the CURRENT time, rounded up to the next 15-min step.
//
// We deliberately do NOT fall back to the salon's open time: after hours that
// is in the PAST (e.g. 10:00 AM when it's 11:43 PM). And never the bare 9am
// grid fallback blankAppt uses when startMins is null.
export function computeSeatStart({
  settings = {}, empWorkDays = {}, appts = [], now, techName = '', durationMins = 60, today,
}) {
  const m = computeNextOpening({ settings, empWorkDays, appts, now, techName, durationMins, today });
  if (m != null) return m;
  const STEP = 15;
  let nowMins = now.getHours() * 60 + now.getMinutes();
  if (nowMins % STEP !== 0) nowMins += STEP - (nowMins % STEP);
  return Math.min(nowMins, 24 * 60 - 1);   // guard against rounding past midnight
}
