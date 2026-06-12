// Group booking — find times where N guests can each be served by a DISTINCT
// tech within ±tolerance of a shared anchor, scanned across a date range and
// ranked. Pure (no Firebase/React) so it's fully unit-testable. The N-guest
// generalization of the 2-lane "simultaneous" check in BookingScreen.
import {
  isTechFreeAt, cartTotalDuration, techsForServices, strToMins,
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

// Try to seat all guests around one (date, anchor). Returns an assignment or null.
function matchAnchor({ date, anchor, guestsInfo, dayIdx, offsets, windowStart, windowEnd, today, nowMins }) {
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
    // Prefer landing on the anchor, then closeness, then earlier.
    pairs.sort((a, b) => Math.abs(a.start - anchor) - Math.abs(b.start - anchor) || a.start - b.start);
    return { idx: g.idx, pairs };
  });
  if (feas.some(f => f.pairs.length === 0)) return null;

  // Most-constrained guest first (MRV), then backtrack assigning DISTINCT techs.
  const order = feas.slice().sort((a, b) => a.pairs.length - b.pairs.length);
  const used = new Set();
  const chosen = new Array(order.length);
  const bt = (k) => {
    if (k === order.length) return true;
    for (const p of order[k].pairs) {
      if (used.has(p.techId)) continue;
      used.add(p.techId);
      chosen[k] = { guestIdx: order[k].idx, ...p };
      if (bt(k + 1)) return true;
      used.delete(p.techId);
    }
    return false;
  };
  if (!bt(0)) return null;

  const assignments = chosen.slice().sort((a, b) => a.guestIdx - b.guestIdx)
    .map(a => ({ guestIdx: a.guestIdx, techId: a.techId, techName: a.techName, startMins: a.start, durMins: a.dur, requestType: a.requestType }));
  return {
    date, anchorMins: anchor,
    sameStart: assignments.every(a => a.startMins === anchor),
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

  // Per-tech total busy load across the range — used to order auto-assign
  // candidates least-busy-first (fair distribution), dedup enforced by backtracking.
  const dates = datesInRange(dateRange?.start, dateRange?.end);
  const loadByTech = new Map(techs.map(t => [t.id, 0]));
  dates.forEach(d => (apptsByDate[d] || []).forEach(a => {
    if (a.status === 'cancelled' || a.status === 'no_show') return;
    const t = techs.find(x => x.id === a.techId || x.name === a.techName);
    if (t) loadByTech.set(t.id, (loadByTech.get(t.id) || 0) + 1);
  }));

  const durCache = new Map();
  const unsatisfiable = [];
  const guestsInfo = guests.map((g, idx) => {
    const services = (g.cartItems || []).map(i => i.service);
    let eligible = techsForServices(techs, services);
    if (g.pickedTechId) eligible = eligible.filter(t => t.id === g.pickedTechId);
    else eligible = eligible.slice().sort((a, b) => (loadByTech.get(a.id) || 0) - (loadByTech.get(b.id) || 0) || String(a.name).localeCompare(String(b.name)));
    if (!eligible.length) unsatisfiable.push(idx);
    const durFor = (tech) => {
      const key = `${idx}:${tech.id}`;
      if (!durCache.has(key)) durCache.set(key, cartTotalDuration(g.cartItems || [], removalDur, tech));
      return durCache.get(key);
    };
    return { idx, pinnedTechId: g.pickedTechId || null, candidateTechs: eligible, durFor };
  });
  if (unsatisfiable.length) return { slots: [], unsatisfiable };

  const offsets = buildOffsets(tolerance);
  const anchors = [];
  for (let m = windowStart; m <= windowEnd; m += slotStep) anchors.push(m);

  const viable = [];
  dates.forEach((date, dateRank) => {
    const dayIdx = buildDayIndex(apptsByDate[date] || [], techs);
    for (const anchor of anchors) {
      const slot = matchAnchor({ date, anchor, guestsInfo, dayIdx, offsets, windowStart, windowEnd, today, nowMins });
      if (slot) {
        slot._dateRank = dateRank;
        slot._preferred = preferredDate && date === preferredDate;
        viable.push(slot);
      }
    }
  });

  // Rank: preferred date first → soonest date → same-start → earlier in day.
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
