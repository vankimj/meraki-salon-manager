// Group booking — find times where N guests are each seated within ±tolerance
// of a shared anchor, scanned across a date range and ranked. Pure (no
// Firebase/React) so it's fully unit-testable.
//
// Each guest's services are grouped into "lanes": consecutive services one
// stylist can do stay together; we split only where no single stylist covers
// the next service (e.g. a nail-art specialist). The PRIMARY lane (lane 0) is
// seated with the group on a DISTINCT stylist; any extra lanes (specialty
// add-ons) are scheduled back-to-back afterward with a free eligible stylist.
import {
  cartTotalDuration, techsForServices, strToMins,
  BOOKING_START, BOOKING_END, SLOT_STEP,
} from './booking';

// Inclusive list of YYYY-MM-DD dates from start to end.
function datesInRange(start, end) {
  const out = [];
  if (!start || !end) return out;
  let d = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  let guard = 0;
  while (d <= last && guard++ < 400) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

// Per-tech busy intervals for one day — mirrors isTechFreeAt's rules exactly
// (skip cancelled/no_show; match techId OR techName). Returns Map(techId → [{s,e}]).
function buildDayIndex(dayAppts, techs) {
  const idx = new Map();
  for (const t of techs) {
    const ivals = (dayAppts || [])
      .filter(a => a.status !== 'cancelled' && a.status !== 'no_show' &&
        (a.techId === t.id || a.techName === t.name))
      .map(a => {
        const s = strToMins(a.startTime);
        const dur = (a.services || []).reduce((sum, sv) => sum + (Number(sv.duration) || 0), 0) || (a.duration || 60);
        return { s, e: s + dur };
      });
    idx.set(t.id, ivals);
  }
  return idx;
}

function freeIn(ivals, start, end) {
  return !(ivals || []).some(iv => iv.s < end && iv.e > start);
}

// Start offsets within ±tolerance at 15-min granularity (so ±15 → [-15,0,15]).
function buildOffsets(tolerance) {
  if (!(tolerance > 0)) return [0];
  const step = Math.min(tolerance, 15);
  const out = [];
  for (let o = -tolerance; o <= tolerance; o += step) out.push(o);
  if (!out.includes(0)) out.push(0);
  return out.sort((a, b) => Math.abs(a) - Math.abs(b));
}

// Base services (categoryExclusive) come first so a base service is done before
// an add-on like nail art (which physically goes on top).
function sortBaseFirst(items) {
  const key = it => (it && it.service && it.service.categoryExclusive === true) ? 0 : 1;
  return items.slice().sort((a, b) => key(a) - key(b));
}

// Group a guest's cart into lanes: keep services together while ONE stylist can
// do them all; start a new lane when the next service can't join (specialist).
// Returns [{ items, eligibleTechs }]. A lane with eligibleTechs=[] = a service
// no stylist can do at all (guest unsatisfiable).
export function computeLanes(items, techs) {
  const lanes = [];
  let cur = null;
  for (const item of sortBaseFirst(items)) {
    if (cur) {
      const trial = [...cur.items, item];
      const elig = techsForServices(techs, trial.map(i => i.service));
      if (elig.length) { cur.items = trial; cur.eligibleTechs = elig; continue; }
      lanes.push(cur); cur = null;
    }
    cur = { items: [item], eligibleTechs: techsForServices(techs, [item.service]) };
  }
  if (cur) lanes.push(cur);
  return lanes;
}

// Seat all guests' PRIMARY lanes around one (date, anchor) on distinct techs,
// then chain each guest's extra lanes after. Returns an assignment or null.
function matchAnchor({ date, anchor, guestsInfo, dayIdx, offsets, windowStart, windowEnd, today, nowMins, removalDur }) {
  const feas = guestsInfo.map(g => {
    const pairs = [];
    for (const tech of g.candidateTechs) {
      const dur = g.durFor(tech);
      for (const off of offsets) {
        const start = anchor + off;
        if (start < windowStart || start + dur > windowEnd) continue;
        if (date === today && nowMins != null && start < nowMins) continue;
        if (freeIn(dayIdx.get(tech.id), start, start + dur)) {
          pairs.push({ techId: tech.id, techName: tech.name, start, dur, requestType: g.pinnedTechId ? 'specific' : 'auto' });
        }
      }
    }
    pairs.sort((a, b) => Math.abs(a.start - anchor) - Math.abs(b.start - anchor) || a.start - b.start);
    return { idx: g.idx, pairs };
  });
  if (feas.some(f => f.pairs.length === 0)) return null;

  // Most-constrained guest first (MRV), then backtrack assigning DISTINCT techs
  // for the primary lanes.
  const order = feas.slice().sort((a, b) => a.pairs.length - b.pairs.length);
  const used = new Set();
  const chosen = {};
  const bt = (k) => {
    if (k === order.length) return true;
    for (const p of order[k].pairs) {
      if (used.has(p.techId)) continue;
      used.add(p.techId);
      chosen[order[k].idx] = p;
      if (bt(k + 1)) return true;
      used.delete(p.techId);
    }
    return false;
  };
  if (!bt(0)) return null;

  // Occupancy = the day's existing intervals + the primary lanes we just placed.
  const occ = new Map();
  for (const [tid, v] of dayIdx) occ.set(tid, v.slice());
  const addIv = (tid, s, e) => { if (!occ.has(tid)) occ.set(tid, []); occ.get(tid).push({ s, e }); };

  const assignments = [];
  for (const g of guestsInfo) {
    const p = chosen[g.idx];
    addIv(p.techId, p.start, p.start + p.dur);
    assignments.push({ guestIdx: g.idx, lane: 0, techId: p.techId, techName: p.techName, startMins: p.start, durMins: p.dur, requestType: p.requestType, serviceItems: g.lanes[0].items });
  }

  // Chain each guest's extra lanes back-to-back after their primary lane.
  for (const g of guestsInfo) {
    if (g.lanes.length <= 1) continue;
    let cursor = chosen[g.idx].start + chosen[g.idx].dur;
    for (let li = 1; li < g.lanes.length; li++) {
      const lane = g.lanes[li];
      let placed = null;
      for (const tech of lane.eligibleTechs) {
        const dur = cartTotalDuration(lane.items, removalDur, tech);
        if (cursor + dur > windowEnd) continue;
        if (freeIn(occ.get(tech.id), cursor, cursor + dur)) { placed = { tech, dur }; break; }
      }
      if (!placed) return null;                       // a specialty add-on can't be scheduled → slot invalid
      addIv(placed.tech.id, cursor, cursor + placed.dur);
      assignments.push({ guestIdx: g.idx, lane: li, techId: placed.tech.id, techName: placed.tech.name, startMins: cursor, durMins: placed.dur, requestType: 'auto', serviceItems: lane.items });
      cursor += placed.dur;
    }
  }

  assignments.sort((a, b) => a.guestIdx - b.guestIdx || a.lane - b.lane);
  const primaries = assignments.filter(a => a.lane === 0);
  return {
    date, anchorMins: anchor,
    sameStart: primaries.every(a => a.startMins === anchor),
    split: assignments.length > primaries.length,
    techsUsed: new Set(assignments.map(a => a.techId)).size,
    assignments,
  };
}

// Main entry. guests: [{ cartItems:[{service,option,removal}], pickedTechId|null }].
// Returns { slots: rankedSlots[], unsatisfiable: [guestIdx...] }.
export function findGroupSlots({
  guests, techs, apptsByDate, dateRange, preferredDate = null,
  tolerance = 15, slotStep = SLOT_STEP, windowStart = BOOKING_START, windowEnd = BOOKING_END,
  removalDur = 15, today = null, nowMins = null, maxPerDate = 4, maxTotal = 30,
}) {
  const empty = { slots: [], unsatisfiable: [] };
  if (!Array.isArray(guests) || guests.length < 2 || !Array.isArray(techs) || !techs.length) return empty;

  const dates = datesInRange(dateRange?.start, dateRange?.end);
  const loadByTech = new Map(techs.map(t => [t.id, 0]));
  dates.forEach(d => (apptsByDate[d] || []).forEach(a => {
    if (a.status === 'cancelled' || a.status === 'no_show') return;
    const t = techs.find(x => x.id === a.techId || x.name === a.techName);
    if (t) loadByTech.set(t.id, (loadByTech.get(t.id) || 0) + 1);
  }));
  const byLoad = (a, b) => (loadByTech.get(a.id) || 0) - (loadByTech.get(b.id) || 0) || String(a.name).localeCompare(String(b.name));

  const durCache = new Map();
  const unsatisfiable = [];
  const guestsInfo = guests.map((g, idx) => {
    const lanes = computeLanes(g.cartItems || [], techs);
    // A lane no stylist can do at all → this guest can't be served.
    if (!lanes.length || lanes.some(l => l.eligibleTechs.length === 0)) { unsatisfiable.push(idx); }
    // Order each lane's eligible stylists least-busy-first (fair); dedup of the
    // primary lane is enforced by backtracking.
    lanes.forEach(l => { l.eligibleTechs = l.eligibleTechs.slice().sort(byLoad); });
    let primary = lanes[0] ? lanes[0].eligibleTechs : [];
    if (g.pickedTechId) primary = primary.filter(t => t.id === g.pickedTechId);  // a pinned tech only constrains the primary lane
    const durFor = (tech) => {
      const key = `${idx}:${tech.id}`;
      if (!durCache.has(key)) durCache.set(key, cartTotalDuration((lanes[0] || {}).items || [], removalDur, tech));
      return durCache.get(key);
    };
    return { idx, pinnedTechId: g.pickedTechId || null, candidateTechs: primary, durFor, lanes };
  });
  if (unsatisfiable.length) return { slots: [], unsatisfiable };

  const offsets = buildOffsets(tolerance);
  const anchors = [];
  for (let m = windowStart; m <= windowEnd; m += slotStep) anchors.push(m);

  const viable = [];
  dates.forEach((date, dateRank) => {
    const dayIdx = buildDayIndex(apptsByDate[date] || [], techs);
    for (const anchor of anchors) {
      const slot = matchAnchor({ date, anchor, guestsInfo, dayIdx, offsets, windowStart, windowEnd, today, nowMins, removalDur });
      if (slot) {
        slot._dateRank = dateRank;
        slot._preferred = preferredDate && date === preferredDate;
        viable.push(slot);
      }
    }
  });

  viable.sort((a, b) =>
    (a._preferred === b._preferred ? 0 : (a._preferred ? -1 : 1)) ||
    (a._dateRank - b._dateRank) ||
    ((a.sameStart === b.sameStart) ? 0 : (a.sameStart ? -1 : 1)) ||
    (a.anchorMins - b.anchorMins));

  const perDate = {};
  const slots = [];
  for (const s of viable) {
    perDate[s.date] = (perDate[s.date] || 0);
    if (perDate[s.date] >= maxPerDate) continue;
    perDate[s.date]++;
    delete s._dateRank; delete s._preferred;
    slots.push(s);
    if (slots.length >= maxTotal) break;
  }
  return { slots, unsatisfiable: [] };
}
