// Day-of reassignment of "no preference" appointments to clocked-in techs.
//
// When a tech clocks in, today's still-unclaimed no-preference bookings are
// re-distributed to the techs who are actually on the clock, in clock-in order
// (earliest clock-in gets first pick). This is the punctuality incentive: show
// up early → absorb more of the day's unstaffed work. A tech who never clocks
// in loses their auto-assigned bookings to teammates who did.
//
// Pure logic only (no Firebase / I/O) so it's unit-testable; the orchestrator
// in index.js does the reads, the batch write, and the push notifications.

function strToMins(str) {
  if (!str || typeof str !== 'string') return 0;
  const [h, m] = str.split(':').map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function apptDuration(a) {
  const svc = (a.services || []).reduce((s, sv) => s + (Number(sv.duration) || 0), 0);
  return svc || Number(a.duration) || 60;
}

function norm(s) { return String(s || '').trim().toLowerCase(); }

// Empty/missing serviceIds means the tech can do every service (back-compat
// default — matches src/lib/booking.js techCanDo).
function techCanDoServices(tech, services) {
  const ids = tech && tech.serviceIds;
  if (!Array.isArray(ids) || ids.length === 0) return true;
  return (services || []).every(s => ids.includes(s && s.id));
}

// Minutes-since-midnight "now" in a tz. `now` injectable for tests. Handles the
// '24' hour some Intl impls emit at midnight under hour12:false.
function nowMinutesInTz(tz, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find(p => p.type === 'hour')?.value || 0);
    const m = Number(parts.find(p => p.type === 'minute')?.value || 0);
    return (h % 24) * 60 + m;
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

// Decide which no-preference appointments to move and to whom.
//
//   appts:           every appointment doc for today ({ id, startTime, duration,
//                    services[], techId, techName, status, techRequestType }).
//   clockedInTechs:  [{ id, name, email, serviceIds, clockInAt }] — caller may
//                    pass unsorted; we order by clockInAt ascending here.
//   nowMins:         minutes-since-midnight in the tenant tz (skip past appts).
//
// Returns [{ apptId, startTime, services:[name], fromTechId, fromTechName,
//            toTechId, toTechName }] — only genuine moves (never a no-op).
//
// Pool = today's appts that are auto-assigned, still 'scheduled', start in the
// future, and whose current tech is NOT currently clocked in (so we never steal
// from a tech who showed up — we only fill unstaffed/no-show slots). Pool is
// processed in the order the bookings were created (createdAt ascending); each
// goes to the earliest-clocked-in tech who is eligible and free at that slot.
function planReassignments({ appts, clockedInTechs, nowMins }) {
  const techs = (clockedInTechs || [])
    .filter(t => t && t.id && t.name)
    .slice()
    .sort((a, b) => String(a.clockInAt || '').localeCompare(String(b.clockInAt || '')));
  if (!techs.length) return [];

  const clockedNames = new Set(techs.map(t => norm(t.name)));

  const pool = (appts || [])
    .filter(a => a && a.techRequestType === 'auto' && a.status === 'scheduled')
    .filter(a => strToMins(a.startTime) > nowMins)
    .filter(a => !clockedNames.has(norm(a.techName)))
    .sort((x, y) => String(x.createdAt || '').localeCompare(String(y.createdAt || '')));
  if (!pool.length) return [];

  const poolIds = new Set(pool.map(a => a.id));

  // Seed each clocked-in tech's busy intervals from their existing (non-pool,
  // non-cancelled) appts today, then grow it as we place pool appts.
  const busy = new Map();
  for (const t of techs) {
    const ivals = (appts || [])
      .filter(a => a && a.status !== 'cancelled' && !poolIds.has(a.id))
      .filter(a => (a.techId && a.techId === t.id) || norm(a.techName) === norm(t.name))
      .map(a => { const s = strToMins(a.startTime); return { s, e: s + apptDuration(a) }; });
    busy.set(t.id, ivals);
  }
  const free = (techId, s, e) => !(busy.get(techId) || []).some(iv => iv.s < e && iv.e > s);

  const changes = [];
  for (const a of pool) {
    const s = strToMins(a.startTime);
    const e = s + apptDuration(a);
    for (const t of techs) {
      if (!techCanDoServices(t, a.services)) continue;
      if (!free(t.id, s, e)) continue;
      busy.get(t.id).push({ s, e });
      changes.push({
        apptId:       a.id,
        startTime:    a.startTime,
        services:     (a.services || []).map(x => x && x.name).filter(Boolean),
        fromTechId:   a.techId || null,
        fromTechName: a.techName || '',
        toTechId:     t.id,
        toTechName:   t.name,
      });
      break;
    }
  }
  return changes;
}

module.exports = {
  strToMins,
  apptDuration,
  techCanDoServices,
  nowMinutesInTz,
  planReassignments,
};
