import { describe, it, expect } from 'vitest';
import {
  strToMins,
  techCanDo, techsForService, techsForServices,
  cartTotalDuration, isTechFreeAt, firstFreeTech, getSlots,
  BOOKING_START, BOOKING_END, SLOT_STEP,
} from './booking';

// ── Fixtures ───────────────────────────────────────────
const SVC_MANI    = { id: 'mani',    name: 'Manicure',    basePrice: 30, duration: 30 };
const SVC_PEDI    = { id: 'pedi',    name: 'Pedicure',    basePrice: 50, duration: 60 };
const SVC_ACRYLIC = { id: 'acrylic', name: 'Acrylic Set', basePrice: 75, duration: 90 };

const TECH_ALL  = { id: 't1', name: 'All', serviceIds: [] };           // empty = can do all
const TECH_MISS = { id: 't2', name: 'NoIds' };                         // missing = can do all
const TECH_MANI = { id: 't3', name: 'ManiOnly', serviceIds: ['mani'] };
const TECH_BOTH = { id: 't4', name: 'ManiAndPedi', serviceIds: ['mani', 'pedi'] };
const TECH_PEDI = { id: 't5', name: 'PediOnly', serviceIds: ['pedi'] };

// ── strToMins ──────────────────────────────────────────
describe('strToMins', () => {
  it('parses "HH:MM"', () => expect(strToMins('09:30')).toBe(570));
  it('handles single-digit hour', () => expect(strToMins('9:00')).toBe(540));
  it('handles midnight', () => expect(strToMins('00:00')).toBe(0));
  it('returns 0 for empty input', () => expect(strToMins('')).toBe(0));
  it('returns 0 for null', () => expect(strToMins(null)).toBe(0));
});

// ── techCanDo ──────────────────────────────────────────
describe('techCanDo', () => {
  it('empty serviceIds means can do all', () => expect(techCanDo(TECH_ALL, 'mani')).toBe(true));
  it('missing serviceIds means can do all', () => expect(techCanDo(TECH_MISS, 'pedi')).toBe(true));
  it('returns true when serviceId is in the list', () => expect(techCanDo(TECH_MANI, 'mani')).toBe(true));
  it('returns false when serviceId is not in the list', () => expect(techCanDo(TECH_MANI, 'pedi')).toBe(false));
});

// ── techsForService ────────────────────────────────────
describe('techsForService', () => {
  it('returns all techs when service is null', () => {
    expect(techsForService([TECH_ALL, TECH_MANI], null)).toEqual([TECH_ALL, TECH_MANI]);
  });
  it('filters to techs who can do the service', () => {
    const result = techsForService([TECH_ALL, TECH_MANI, TECH_PEDI], SVC_MANI);
    expect(result.map(t => t.id)).toEqual(['t1', 't3']);
  });
});

// ── techsForServices (intersection) ────────────────────
describe('techsForServices', () => {
  it('returns all techs for empty service list', () => {
    expect(techsForServices([TECH_ALL, TECH_MANI], [])).toEqual([TECH_ALL, TECH_MANI]);
  });
  it('returns intersection — only techs who can do every service', () => {
    const allTechs = [TECH_ALL, TECH_MANI, TECH_BOTH, TECH_PEDI];
    const result = techsForServices(allTechs, [SVC_MANI, SVC_PEDI]);
    // ALL (can do everything) + BOTH (mani+pedi). Not MANI (no pedi), not PEDI (no mani).
    expect(result.map(t => t.id)).toEqual(['t1', 't4']);
  });
  it('returns empty when no tech covers all services', () => {
    const result = techsForServices([TECH_MANI, TECH_PEDI], [SVC_MANI, SVC_PEDI, SVC_ACRYLIC]);
    expect(result).toEqual([]);
  });
});

// ── cartTotalDuration ──────────────────────────────────
describe('cartTotalDuration', () => {
  it('sums service durations for a single-service cart', () => {
    const cart = [{ service: SVC_MANI, option: null, removal: false }];
    expect(cartTotalDuration(cart)).toBe(30);
  });
  it('sums service durations for a multi-service cart', () => {
    const cart = [
      { service: SVC_MANI, option: null, removal: false },
      { service: SVC_PEDI, option: null, removal: false },
    ];
    expect(cartTotalDuration(cart)).toBe(90);
  });
  it('adds removal time when item has removal flag', () => {
    const cart = [{ service: SVC_MANI, option: null, removal: true }];
    expect(cartTotalDuration(cart)).toBe(45); // 30 + 15 default removal
  });
  it('honors a custom removal duration', () => {
    const cart = [{ service: SVC_MANI, option: null, removal: true }];
    expect(cartTotalDuration(cart, 20)).toBe(50);
  });
  it('falls back to 60 min default when service has no duration', () => {
    const cart = [{ service: { id: 'x', basePrice: 10 }, option: null, removal: false }];
    expect(cartTotalDuration(cart)).toBe(60);
  });
  it('handles option-overridden duration', () => {
    const opt = { id: 'long', name: 'Long', duration: 75 };
    const cart = [{ service: SVC_MANI, option: opt, removal: false }];
    expect(cartTotalDuration(cart)).toBe(75);
  });
  it('applies a per-tech duration override when a tech is passed', () => {
    const slowTech = { id: 't', serviceDurations: { mani: 45 } }; // 30 → 45
    const cart = [{ service: SVC_MANI, option: null, removal: false }];
    expect(cartTotalDuration(cart, 15, slowTech)).toBe(45);
  });
  it('ignores overrides for services not in the cart', () => {
    const tech = { id: 't', serviceDurations: { pedi: 80 } };
    const cart = [{ service: SVC_MANI, option: null, removal: false }];
    expect(cartTotalDuration(cart, 15, tech)).toBe(30); // mani unaffected
  });
  it('adds removal on top of a per-tech overridden service', () => {
    const slowTech = { id: 't', serviceDurations: { mani: 45 } };
    const cart = [{ service: SVC_MANI, option: null, removal: true }];
    expect(cartTotalDuration(cart, 15, slowTech)).toBe(60); // 45 + 15 removal
  });
  it('sums per-tech overrides across a multi-service cart', () => {
    const slowTech = { id: 't', serviceDurations: { mani: 45, pedi: 75 } };
    const cart = [
      { service: SVC_MANI, option: null, removal: false },
      { service: SVC_PEDI, option: null, removal: false },
    ];
    expect(cartTotalDuration(cart, 15, slowTech)).toBe(120); // 45 + 75
  });
});

// ── isTechFreeAt ───────────────────────────────────────
describe('isTechFreeAt', () => {
  const tech = { id: 't1', name: 'Yasmin' };

  it('returns true when no appts on the day', () => {
    expect(isTechFreeAt(tech, 600, 60, [])).toBe(true);
  });
  it('returns true when other techs are booked but not this one', () => {
    const appts = [{ techId: 't9', techName: 'Other', startTime: '10:00', duration: 60 }];
    expect(isTechFreeAt(tech, 600, 60, appts)).toBe(true);
  });
  it('returns false when this tech has an exact-overlap appt', () => {
    const appts = [{ techId: 't1', startTime: '10:00', duration: 60 }];
    expect(isTechFreeAt(tech, 600, 60, appts)).toBe(false);
  });
  it('returns false when the proposed window starts inside an existing appt', () => {
    const appts = [{ techId: 't1', startTime: '10:00', duration: 90 }]; // 10:00–11:30
    expect(isTechFreeAt(tech, 660, 30, appts)).toBe(false); // 11:00–11:30 overlaps
  });
  it('returns false when the proposed window ends inside an existing appt', () => {
    const appts = [{ techId: 't1', startTime: '11:00', duration: 60 }]; // 11:00–12:00
    expect(isTechFreeAt(tech, 600, 90, appts)).toBe(false); // 10:00–11:30 overlaps
  });
  it('returns true when proposed window ends exactly at an existing appt start', () => {
    const appts = [{ techId: 't1', startTime: '11:00', duration: 60 }];
    expect(isTechFreeAt(tech, 600, 60, appts)).toBe(true); // 10:00–11:00 is OK
  });
  it('returns true when proposed window starts exactly at an existing appt end', () => {
    const appts = [{ techId: 't1', startTime: '10:00', duration: 60 }];
    expect(isTechFreeAt(tech, 660, 60, appts)).toBe(true); // 11:00–12:00 is OK
  });
  it('uses sum of services[].duration when present (multi-service appt)', () => {
    const appts = [{
      techId: 't1', startTime: '10:00',
      services: [{ duration: 30 }, { duration: 30 }, { duration: 15 }], // 75 min
    }];
    expect(isTechFreeAt(tech, 660, 30, appts)).toBe(false); // 11:00–11:30 inside 10:00–11:15
    expect(isTechFreeAt(tech, 690, 30, appts)).toBe(true);  // 11:30–12:00 after 11:15
  });
  it('matches by techName when techId is missing', () => {
    const appts = [{ techName: 'Yasmin', startTime: '10:00', duration: 60 }];
    expect(isTechFreeAt(tech, 600, 60, appts)).toBe(false);
  });
  it('treats a no-show as free — the slot is rebookable', () => {
    const appts = [{ techId: 't1', startTime: '10:00', duration: 60, status: 'no_show' }];
    expect(isTechFreeAt(tech, 600, 60, appts)).toBe(true);
  });
  it('treats a cancelled appt as free', () => {
    const appts = [{ techId: 't1', startTime: '10:00', duration: 60, status: 'cancelled' }];
    expect(isTechFreeAt(tech, 600, 60, appts)).toBe(true);
  });
  it('still blocks for a scheduled (or done/in-progress) appt', () => {
    expect(isTechFreeAt(tech, 600, 60, [{ techId: 't1', startTime: '10:00', duration: 60, status: 'scheduled' }])).toBe(false);
    expect(isTechFreeAt(tech, 600, 60, [{ techId: 't1', startTime: '10:00', duration: 60, status: 'in-progress' }])).toBe(false);
  });
  it('ignores non-overlapping appointments earlier in the day', () => {
    const appts = [{ techId: 't1', startTime: '09:00', duration: 60 }]; // 9–10
    expect(isTechFreeAt(tech, 600, 60, appts)).toBe(true); // 10–11 OK
  });
});

// ── firstFreeTech ──────────────────────────────────────
describe('firstFreeTech', () => {
  const t1 = { id: 't1', name: 'A' };
  const t2 = { id: 't2', name: 'B' };

  it('returns the first tech with no conflict', () => {
    const appts = [{ techId: 't1', startTime: '10:00', duration: 60 }];
    expect(firstFreeTech([t1, t2], 600, 60, appts)?.id).toBe('t2');
  });
  it('returns null when all techs are busy', () => {
    const appts = [
      { techId: 't1', startTime: '10:00', duration: 60 },
      { techId: 't2', startTime: '10:00', duration: 60 },
    ];
    expect(firstFreeTech([t1, t2], 600, 60, appts)).toBeNull();
  });
  it('returns null for empty tech list', () => {
    expect(firstFreeTech([], 600, 60, [])).toBeNull();
  });
});

// ── getSlots ───────────────────────────────────────────
describe('getSlots', () => {
  it('produces a 30-min stride starting at BOOKING_START', () => {
    const slots = getSlots(60);
    expect(slots[0]).toBe(BOOKING_START);
    expect(slots[1]).toBe(BOOKING_START + SLOT_STEP);
  });
  it('respects BOOKING_END — last slot + duration <= end', () => {
    const dur = 60;
    const slots = getSlots(dur);
    const last = slots[slots.length - 1];
    expect(last + dur).toBeLessThanOrEqual(BOOKING_END);
  });
  it('returns an empty array if duration exceeds the booking window', () => {
    expect(getSlots(BOOKING_END - BOOKING_START + 30)).toEqual([]);
  });
  it('produces fewer slots for longer durations', () => {
    expect(getSlots(120).length).toBeLessThan(getSlots(30).length);
  });
});
