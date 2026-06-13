import { describe, it, expect } from 'vitest';
import { findGroupSlots } from './groupBooking';

const svc  = (id, duration = 30) => ({ id, name: id, duration, basePrice: 10 });
const tech = (id, name, serviceIds = []) => ({ id, name, serviceIds });
const guest = (services, pickedTechId = null) => ({ cartItems: services.map(s => ({ service: s, option: null, removal: false })), pickedTechId });
const busy = (techId, startTime, duration, status = 'scheduled') => ({ techId, techName: techId, startTime, duration, status });

const MANI = svc('mani', 30);
const TECHS3 = [tech('t1', 'Anna'), tech('t2', 'Mia'), tech('t3', 'Zoe')];
const RANGE = { start: '2026-06-15', end: '2026-06-15' };

describe('findGroupSlots', () => {
  it('2 no-preference guests on an empty day → same-start, two distinct techs', () => {
    const { slots } = findGroupSlots({
      guests: [guest([MANI]), guest([MANI])], techs: TECHS3, apptsByDate: {}, dateRange: RANGE,
    });
    expect(slots.length).toBeGreaterThan(0);
    const top = slots[0];
    expect(top.sameStart).toBe(true);
    expect(top.assignments).toHaveLength(2);
    expect(top.assignments[0].techId).not.toBe(top.assignments[1].techId);
    expect(top.assignments.every(a => a.startMins === top.anchorMins)).toBe(true);
  });

  it('a guest booking TWO services (mani + pedi) gets one tech for the summed time', () => {
    const mani = svc('mani', 30), pedi = svc('pedi', 45);
    const { slots } = findGroupSlots({
      guests: [guest([mani, pedi]), guest([mani])], techs: TECHS3, apptsByDate: {}, dateRange: RANGE,
    });
    expect(slots.length).toBeGreaterThan(0);
    const top = slots[0];
    const a0 = top.assignments.find(a => a.guestIdx === 0);
    expect(a0.durMins).toBe(75);                                  // 30 + 45 back-to-back, one tech
    expect(top.assignments[0].techId).not.toBe(top.assignments[1].techId);
  });

  it('splits a guest across stylists when no one does all their services (nail-art specialist)', () => {
    const mani = svc('mani', 30), art = svc('art', 30);
    // t1/t2 do manicures; t3 is an art-only specialist.
    const techs = [tech('t1', 'Anna', ['mani']), tech('t2', 'Mia', ['mani']), tech('t3', 'Bea', ['art'])];
    const { slots, unsatisfiable } = findGroupSlots({
      guests: [guest([mani, art]), guest([mani])], techs, apptsByDate: {}, dateRange: RANGE,
    });
    expect(unsatisfiable).toEqual([]);
    expect(slots.length).toBeGreaterThan(0);
    const top = slots[0];
    expect(top.split).toBe(true);
    const g0 = top.assignments.filter(a => a.guestIdx === 0).sort((a, b) => a.lane - b.lane);
    expect(g0).toHaveLength(2);                                        // mani lane + art lane
    expect(g0[1].techId).toBe('t3');                                  // art by the specialist
    expect(g0[1].startMins).toBe(g0[0].startMins + g0[0].durMins);    // back-to-back
    const primaries = top.assignments.filter(a => a.lane === 0);
    expect(new Set(primaries.map(p => p.techId)).size).toBe(primaries.length); // distinct primaries
  });

  it('a service no stylist offers at all → still unsatisfiable', () => {
    const mani = svc('mani', 30), exotic = svc('exotic', 30);
    const techs = [tech('t1', 'Anna', ['mani']), tech('t2', 'Mia', ['mani'])]; // nobody does exotic
    const { slots, unsatisfiable } = findGroupSlots({
      guests: [guest([mani, exotic]), guest([mani])], techs, apptsByDate: {}, dateRange: RANGE,
    });
    expect(slots).toEqual([]);
    expect(unsatisfiable).toContain(0);
  });

  it('only ONE tech eligible for both guests → impossible (distinct techs) → no slots', () => {
    const special = svc('special', 30);
    const techs = [tech('t1', 'Anna', ['special']), tech('t2', 'Mia', ['other'])];
    const { slots } = findGroupSlots({
      guests: [guest([special]), guest([special])], techs, apptsByDate: {}, dateRange: RANGE,
    });
    expect(slots).toEqual([]);
  });

  it('staggers a guest by ±15 when their pinned tech is busy at the anchor', () => {
    // 15-min service; window 10:00–10:30 so only anchor 600 yields a co-time.
    const s15 = svc('s', 15);
    const apptsByDate = {
      '2026-06-15': [busy('t1', '10:00', 15), busy('t2', '10:15', 15)],
    };
    const { slots } = findGroupSlots({
      guests: [guest([s15], 't1'), guest([s15], 't2')], techs: [tech('t1', 'Anna'), tech('t2', 'Mia')],
      apptsByDate, dateRange: RANGE, windowStart: 600, windowEnd: 630,
    });
    expect(slots).toHaveLength(1);
    const a = Object.fromEntries(slots[0].assignments.map(x => [x.techId, x.startMins]));
    expect(a.t1).toBe(615); // pushed +15 off the 10:00 conflict
    expect(a.t2).toBe(600); // free at the anchor, blocked at +15
    expect(slots[0].sameStart).toBe(false);
  });

  it('6 guests + 6 techs on a busy day → all six distinct techs within ±15', () => {
    const techs6 = Array.from({ length: 6 }, (_, i) => tech(`t${i}`, `T${i}`));
    const apptsByDate = { '2026-06-15': [busy('t0', '09:00', 60), busy('t3', '13:00', 30)] };
    const { slots } = findGroupSlots({
      guests: Array.from({ length: 6 }, () => guest([MANI])), techs: techs6, apptsByDate, dateRange: RANGE,
    });
    expect(slots.length).toBeGreaterThan(0);
    const top = slots[0];
    expect(top.assignments).toHaveLength(6);
    expect(new Set(top.assignments.map(a => a.techId)).size).toBe(6);
    top.assignments.forEach(a => expect(Math.abs(a.startMins - top.anchorMins)).toBeLessThanOrEqual(15));
  });

  it('two guests pinned to the SAME tech → impossible → no slots', () => {
    const { slots } = findGroupSlots({
      guests: [guest([MANI], 't1'), guest([MANI], 't1')], techs: TECHS3, apptsByDate: {}, dateRange: RANGE,
    });
    expect(slots).toEqual([]);
  });

  it('a pinned guest needing +20 (beyond ±15 tolerance) cannot be seated → no slots', () => {
    const s15 = svc('s', 15);
    const apptsByDate = { '2026-06-15': [busy('t1', '10:00', 20)] }; // t1 free only at 10:20
    const { slots } = findGroupSlots({
      guests: [guest([s15], 't1'), guest([s15], 't2')], techs: [tech('t1', 'Anna'), tech('t2', 'Mia')],
      apptsByDate, dateRange: RANGE, windowStart: 600, windowEnd: 630,
    });
    expect(slots).toEqual([]);
  });

  it('ranks the preferred date above an equal slot on another date', () => {
    const range = { start: '2026-06-15', end: '2026-06-17' };
    const { slots } = findGroupSlots({
      guests: [guest([MANI]), guest([MANI])], techs: TECHS3, apptsByDate: {}, dateRange: range,
      preferredDate: '2026-06-17',
    });
    expect(slots[0].date).toBe('2026-06-17');
  });

  it('honors per-tech duration overrides in the window-fit check', () => {
    // t1 takes 90 min for mani; t1 busy 10:30–11:00 blocks a 10:00 start (would run to 11:30).
    const techs = [tech('t1', 'Anna'), tech('t2', 'Mia')];
    techs[0].serviceDurations = { mani: 90 };
    const apptsByDate = { '2026-06-15': [busy('t1', '10:30', 30)] };
    const { slots } = findGroupSlots({
      guests: [guest([MANI], 't1'), guest([MANI], 't2')], techs, apptsByDate, dateRange: RANGE,
      windowStart: 600, windowEnd: 660, // 10:00–11:00
    });
    // t1's 90-min job can't start at 10:00 (overlaps 10:30 appt) nor fit by 11:00 → no slot.
    expect(slots).toEqual([]);
  });

  it('excludes same-day starts before now + lead', () => {
    const { slots } = findGroupSlots({
      guests: [guest([MANI]), guest([MANI])], techs: TECHS3, apptsByDate: {}, dateRange: RANGE,
      today: '2026-06-15', nowMins: 630, // 10:30
    });
    expect(slots.length).toBeGreaterThan(0);
    slots.forEach(s => s.assignments.forEach(a => expect(a.startMins).toBeGreaterThanOrEqual(630)));
  });

  it('caps results per date and overall', () => {
    const { slots } = findGroupSlots({
      guests: [guest([MANI]), guest([MANI])], techs: TECHS3, apptsByDate: {}, dateRange: RANGE,
      maxPerDate: 2, maxTotal: 5,
    });
    expect(slots.length).toBeLessThanOrEqual(2); // single date, capped per-date
  });

  it('returns empty for a group of 1 (use the normal single flow)', () => {
    const { slots } = findGroupSlots({ guests: [guest([MANI])], techs: TECHS3, apptsByDate: {}, dateRange: RANGE });
    expect(slots).toEqual([]);
  });
});
