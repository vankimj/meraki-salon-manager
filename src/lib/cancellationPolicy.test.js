import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POLICY,
  resolveCancellationPolicy,
  countRelevantCancellations,
  hasUsableCardOnFile,
  evaluateCancellationPolicy,
  resolveBookingCardPolicy,
  evaluateBookingCardRequirement,
  depositAmount,
} from './cancellationPolicy.js';

// Anchor "now" so date math is deterministic across CI runs.
const NOW = Date.parse('2026-06-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n) { return new Date(NOW - n * DAY).toISOString(); }

describe('resolveCancellationPolicy', () => {
  it('returns defaults when nothing is configured', () => {
    expect(resolveCancellationPolicy({})).toEqual(DEFAULT_POLICY);
    expect(resolveCancellationPolicy(null)).toEqual(DEFAULT_POLICY);
    expect(resolveCancellationPolicy(undefined)).toEqual(DEFAULT_POLICY);
  });

  it('respects stored values', () => {
    const p = resolveCancellationPolicy({
      cancellationPolicy: { enabled: true, thresholdCount: 5, windowDays: 30, countNoShows: false },
    });
    expect(p).toEqual({ enabled: true, thresholdCount: 5, windowDays: 30, countNoShows: false });
  });

  it('defaults countNoShows=true unless explicitly disabled', () => {
    expect(resolveCancellationPolicy({ cancellationPolicy: { enabled: true } }).countNoShows).toBe(true);
    expect(resolveCancellationPolicy({ cancellationPolicy: { enabled: true, countNoShows: undefined } }).countNoShows).toBe(true);
    expect(resolveCancellationPolicy({ cancellationPolicy: { enabled: true, countNoShows: false } }).countNoShows).toBe(false);
  });

  it('coerces invalid threshold / window back to defaults', () => {
    const p1 = resolveCancellationPolicy({ cancellationPolicy: { thresholdCount: -1 } });
    expect(p1.thresholdCount).toBe(DEFAULT_POLICY.thresholdCount);
    const p2 = resolveCancellationPolicy({ cancellationPolicy: { windowDays: 'lots' } });
    expect(p2.windowDays).toBe(DEFAULT_POLICY.windowDays);
    const p3 = resolveCancellationPolicy({ cancellationPolicy: { thresholdCount: 3.7, windowDays: 90.9 } });
    expect(p3.thresholdCount).toBe(3);
    expect(p3.windowDays).toBe(90);
  });
});

describe('countRelevantCancellations', () => {
  const policy = { ...DEFAULT_POLICY, enabled: true };

  it('counts client-cancellations within the window', () => {
    const appts = [
      { id: 'a', status: 'cancelled', cancelledAt: daysAgo(5)   },
      { id: 'b', status: 'cancelled', cancelledAt: daysAgo(30)  },
      { id: 'c', status: 'cancelled', cancelledAt: daysAgo(100) },  // outside 90-day window
      { id: 'd', status: 'done',      cancelledAt: daysAgo(5)   },  // not a cancel
    ];
    const result = countRelevantCancellations(appts, policy, NOW);
    expect(result.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('EXCLUDES salon-initiated cancellations', () => {
    const appts = [
      { id: 'a', status: 'cancelled', cancelledAt: daysAgo(5)  },                       // client (no cancelledBy)
      { id: 'b', status: 'cancelled', cancelledAt: daysAgo(5), cancelledBy: 'salon' },  // salon — excluded
      { id: 'c', status: 'cancelled', cancelledAt: daysAgo(5), cancelledBy: 'client_self_service' },
    ];
    const result = countRelevantCancellations(appts, policy, NOW);
    expect(result.map(r => r.id)).toEqual(['a', 'c']);
  });

  it('counts no_show when policy.countNoShows is true', () => {
    const appts = [
      { id: 'a', status: 'no_show', cancelledAt: daysAgo(10) },
      { id: 'b', status: 'no_show', date: daysAgo(10) },         // fall back to date if cancelledAt missing
    ];
    expect(countRelevantCancellations(appts, policy, NOW)).toHaveLength(2);
    const noNoShow = { ...policy, countNoShows: false };
    expect(countRelevantCancellations(appts, noNoShow, NOW)).toHaveLength(0);
  });

  it('falls back to appointment date when cancelledAt is missing', () => {
    const appts = [
      { id: 'a', status: 'cancelled', date: daysAgo(10) },         // legacy row, no cancelledAt
      { id: 'b', status: 'cancelled', date: daysAgo(200) },        // legacy row, outside window
    ];
    const result = countRelevantCancellations(appts, policy, NOW);
    expect(result.map(r => r.id)).toEqual(['a']);
  });

  it('handles null / undefined / non-array input safely', () => {
    expect(countRelevantCancellations(null, policy, NOW)).toEqual([]);
    expect(countRelevantCancellations(undefined, policy, NOW)).toEqual([]);
    expect(countRelevantCancellations('not an array', policy, NOW)).toEqual([]);
  });
});

describe('hasUsableCardOnFile', () => {
  it('returns false for clients with no paymentMethods', () => {
    expect(hasUsableCardOnFile({}, NOW)).toBe(false);
    expect(hasUsableCardOnFile({ paymentMethods: [] }, NOW)).toBe(false);
    expect(hasUsableCardOnFile(null, NOW)).toBe(false);
  });

  it('returns true for a non-expired card', () => {
    const client = { paymentMethods: [{ id: 'pm_1', expMonth: 12, expYear: 2027 }] };
    expect(hasUsableCardOnFile(client, NOW)).toBe(true);
  });

  it('returns false when ALL cards are expired', () => {
    const client = { paymentMethods: [
      { id: 'pm_1', expMonth: 1, expYear: 2025 },
      { id: 'pm_2', expMonth: 5, expYear: 2026 },   // May 2026, NOW is June 2026
    ] };
    expect(hasUsableCardOnFile(client, NOW)).toBe(false);
  });

  it('returns true when ANY card is non-expired', () => {
    const client = { paymentMethods: [
      { id: 'pm_1', expMonth: 1, expYear: 2025 },   // expired
      { id: 'pm_2', expMonth: 6, expYear: 2026 },   // June 2026, NOW is June 2026 → still valid
      { id: 'pm_3', expMonth: 12, expYear: 2030 },  // future
    ] };
    expect(hasUsableCardOnFile(client, NOW)).toBe(true);
  });

  it('treats missing exp as usable (conservative — assume the card works)', () => {
    const client = { paymentMethods: [{ id: 'pm_1' }] };
    expect(hasUsableCardOnFile(client, NOW)).toBe(true);
  });

  it('ignores entries missing an id (defensive)', () => {
    const client = { paymentMethods: [{ brand: 'visa' }] };
    expect(hasUsableCardOnFile(client, NOW)).toBe(false);
  });
});

describe('evaluateCancellationPolicy', () => {
  const settingsOn  = { cancellationPolicy: { enabled: true, thresholdCount: 3, windowDays: 90 } };
  const settingsOff = { cancellationPolicy: { enabled: false } };

  function appts(n) {
    return Array.from({ length: n }, (_, i) => ({
      id: `c${i}`, status: 'cancelled', cancelledAt: daysAgo(10 + i),
    }));
  }

  it('policy disabled → never required', () => {
    const result = evaluateCancellationPolicy(appts(10), settingsOff, {}, NOW);
    expect(result.required).toBe(false);
    expect(result.reason).toBe('policy_disabled');
  });

  it('under threshold → not required', () => {
    const result = evaluateCancellationPolicy(appts(2), settingsOn, {}, NOW);
    expect(result.required).toBe(false);
    expect(result.reason).toBe('under_threshold');
    expect(result.cancellationCount).toBe(2);
    expect(result.message).toContain('2 cancellations in the last 90 days');
  });

  it('threshold met + no card → REQUIRED', () => {
    const result = evaluateCancellationPolicy(appts(3), settingsOn, {}, NOW);
    expect(result.required).toBe(true);
    expect(result.reason).toBe('threshold_met_no_card');
    expect(result.cancellationCount).toBe(3);
    expect(result.message).toContain('A card on file is required');
  });

  it('threshold met + card on file → NOT required (gate satisfied)', () => {
    const client = { paymentMethods: [{ id: 'pm_x', expMonth: 12, expYear: 2030 }] };
    const result = evaluateCancellationPolicy(appts(5), settingsOn, client, NOW);
    expect(result.required).toBe(false);
    expect(result.reason).toBe('threshold_met_card_on_file');
    expect(result.cancellationCount).toBe(5);
  });

  it('admin override = false (exempt) → never required, even if many cancellations', () => {
    const client = { cardRequiredOverride: false, cardRequiredOverrideReason: 'VIP' };
    const result = evaluateCancellationPolicy(appts(50), settingsOn, client, NOW);
    expect(result.required).toBe(false);
    expect(result.reason).toBe('override_exempt');
    expect(result.overrideApplied).toBe('exempt');
    expect(result.message).toContain('VIP');
  });

  it('admin override = true (force) → required even if zero cancellations', () => {
    const client = { cardRequiredOverride: true, cardRequiredOverrideReason: 'history of disputes' };
    const result = evaluateCancellationPolicy([], settingsOn, client, NOW);
    expect(result.required).toBe(true);
    expect(result.reason).toBe('override_force');
    expect(result.overrideApplied).toBe('force');
    expect(result.message).toContain('history of disputes');
  });

  it('admin override = true (force) + card on file → NOT required (override is satisfied)', () => {
    const client = {
      cardRequiredOverride: true,
      paymentMethods: [{ id: 'pm_x', expMonth: 12, expYear: 2030 }],
    };
    const result = evaluateCancellationPolicy([], settingsOn, client, NOW);
    expect(result.required).toBe(false);
    expect(result.reason).toBe('override_force_satisfied');
  });

  it('respects custom threshold + window', () => {
    const settings = { cancellationPolicy: { enabled: true, thresholdCount: 1, windowDays: 7 } };
    const appts = [
      { status: 'cancelled', cancelledAt: daysAgo(3) },
      { status: 'cancelled', cancelledAt: daysAgo(30) },  // outside 7-day window
    ];
    const result = evaluateCancellationPolicy(appts, settings, {}, NOW);
    expect(result.required).toBe(true);
    expect(result.cancellationCount).toBe(1);
    expect(result.windowDays).toBe(7);
    expect(result.thresholdCount).toBe(1);
  });

  it('returns counts even when not required (for UI display)', () => {
    const result = evaluateCancellationPolicy(appts(2), settingsOn, {}, NOW);
    expect(result.cancellationCount).toBe(2);
    expect(result.thresholdCount).toBe(3);
    expect(result.windowDays).toBe(90);
  });
});

describe('resolveBookingCardPolicy', () => {
  it('defaults to all-off / store / 0%', () => {
    const p = resolveBookingCardPolicy({});
    expect(p).toEqual({ firstTimeRequireCard: false, allBookingsRequireCard: false, depositMode: 'store', depositPct: 0 });
  });
  it('clamps depositPct to 0–100 and validates mode', () => {
    expect(resolveBookingCardPolicy({ bookingCardPolicy: { depositPct: 250 } }).depositPct).toBe(100);
    expect(resolveBookingCardPolicy({ bookingCardPolicy: { depositPct: -5 } }).depositPct).toBe(0);
    expect(resolveBookingCardPolicy({ bookingCardPolicy: { depositMode: 'bogus' } }).depositMode).toBe('store');
    expect(resolveBookingCardPolicy({ bookingCardPolicy: { depositMode: 'charge' } }).depositMode).toBe('charge');
  });
});

describe('evaluateBookingCardRequirement', () => {
  const firstTimeOnly = { bookingCardPolicy: { firstTimeRequireCard: true, depositMode: 'store', depositPct: 25 } };
  const allBookings   = { bookingCardPolicy: { allBookingsRequireCard: true } };

  it('does nothing when policy is off', () => {
    expect(evaluateBookingCardRequirement({}, { isFirstTime: true, hasCard: false }).required).toBe(false);
  });
  it('first-time policy requires a card for first-timers without a card', () => {
    const r = evaluateBookingCardRequirement(firstTimeOnly, { isFirstTime: true, hasCard: false });
    expect(r.triggered).toBe(true);
    expect(r.required).toBe(true);
    expect(r.depositMode).toBe('store');
    expect(r.depositPct).toBe(25);
  });
  it('first-time policy does NOT trigger for returning clients', () => {
    expect(evaluateBookingCardRequirement(firstTimeOnly, { isFirstTime: false, hasCard: false }).triggered).toBe(false);
  });
  it('triggered but satisfied when a card is already on file', () => {
    const r = evaluateBookingCardRequirement(firstTimeOnly, { isFirstTime: true, hasCard: true });
    expect(r.triggered).toBe(true);
    expect(r.required).toBe(false);
  });
  it('all-bookings policy requires a card for everyone without one', () => {
    expect(evaluateBookingCardRequirement(allBookings, { isFirstTime: false, hasCard: false }).required).toBe(true);
    expect(evaluateBookingCardRequirement(allBookings, { isFirstTime: false, hasCard: true }).required).toBe(false);
  });
});

describe('depositAmount', () => {
  it('computes a rounded-to-cents percentage of the total', () => {
    expect(depositAmount(100, 25)).toBe(25);
    expect(depositAmount(80, 50)).toBe(40);
    expect(depositAmount(33.33, 10)).toBeCloseTo(3.33, 2);
    expect(depositAmount(0, 25)).toBe(0);
    expect(depositAmount(100, 0)).toBe(0);
  });
});
