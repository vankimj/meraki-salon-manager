// Reconstruct how a given day's walk-in rotation accumulated, from the real
// data — for the "Replay the day" audit (show a tech exactly how the logic
// played out). Mirrors recomputeTodayTurns: a completed appointment credits its
// tech (+1 in count mode, or the summed per-service turnValue in value mode),
// in chronological order. Pure; no I/O.

import { buildTurnValueMap, turnValueForLineName } from './turnValue';

function svcNamesOf(appt) {
  return (Array.isArray(appt.services) ? appt.services : [])
    .map(s => s && (s.name || s.customName)).filter(Boolean);
}

// Best-available "when was this credited" timestamp for ordering.
function eventTime(a) {
  return a._turnsCredited || a._turnCredited
    || (a.date && a.startTime ? `${a.date}T${a.startTime}` : '')
    || a.checkedOutAt || a.updatedAt || a.createdAt || '';
}

export function buildDayReplay({ appointments = [], services = [], roster = [], turnMode = 'count', date = null } = {}) {
  const clockInByName = {};
  (Array.isArray(roster) ? roster : []).forEach(r => { if (r && r.techName) clockInByName[r.techName] = r.clockInAt || null; });

  // Only completed work counts toward turns.
  const counted = (Array.isArray(appointments) ? appointments : []).filter(a =>
    a && a.techName && a.status === 'done' && (!date || a.date === date));

  const valueMap = turnMode === 'value' ? buildTurnValueMap(services) : null;

  const events = counted.map(a => {
    const names = svcNamesOf(a);
    const credit = turnMode === 'value'
      ? (Array.isArray(a.services) ? a.services : []).reduce((s, sv) => s + turnValueForLineName(sv && (sv.name || sv.customName), valueMap), 0)
      : 1;
    const isWalkIn = a.source === 'walkin_kiosk' || a.source === 'walkin' || a.walkIn === true;
    return {
      time:     eventTime(a),
      startTime: a.startTime || '',
      techName: a.techName,
      services: names,
      client:   a.clientName || (isWalkIn ? 'Walk-in' : 'Client'),
      credit,
      kind:     isWalkIn ? 'walkin' : (a.source === 'online_booking' ? 'online' : 'appt'),
      requested: !!(a.techRequestType && a.techRequestType !== 'auto') || !!a.requestedTechName,
    };
  }).sort((x, y) => String(x.time).localeCompare(String(y.time)));

  // Tech order: clock-in order from roster, then any extra tech seen in appts.
  const names = [];
  (Array.isArray(roster) ? roster : []).slice()
    .sort((a, b) => String(a.clockInAt || '').localeCompare(String(b.clockInAt || '')))
    .forEach(r => { if (r && r.techName && !names.includes(r.techName)) names.push(r.techName); });
  events.forEach(e => { if (!names.includes(e.techName)) names.push(e.techName); });

  // Per-step running totals (cumulative[0] = all zero; cumulative[i] = after event i-1).
  const totals = Object.fromEntries(names.map(n => [n, 0]));
  const cumulative = [{ ...totals }];
  events.forEach(e => { totals[e.techName] = (totals[e.techName] || 0) + e.credit; cumulative.push({ ...totals }); });

  return {
    turnMode,
    date,
    techs: names.map(n => ({ name: n, clockInAt: clockInByName[n] || null })),
    events,
    cumulative,
    finals: { ...totals },
    isEmpty: events.length === 0,
  };
}
