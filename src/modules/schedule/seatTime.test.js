import { describe, it, expect } from 'vitest';
import { computeNextOpening, computeSeatStart } from './seatTime';

// dow is derived from `now` the same way the helper does, so these tests are
// independent of the runner's timezone.
const dowOf = (now) => now.toLocaleDateString('en-US', { weekday: 'short' });
const M = (h, m = 0) => h * 60 + m;
const TODAY = '2026-06-15';

// Salon opens 10:00 (storeHours) but the appt window opens 09:00 (apptHours) —
// the exact config that produced the reported "defaults to 9am" bug.
function settingsFor(now, { storeOpen = '10:00', storeClose = '20:00', closed = false, apptOpen = '09:00', apptClose = '20:00' } = {}) {
  const dow = dowOf(now);
  return {
    apptHours: { open: apptOpen, close: apptClose },
    storeHours: { [dow]: closed ? { closed: true } : { open: storeOpen, close: storeClose } },
  };
}
const base = (now, extra = {}) => ({ settings: settingsFor(now), empWorkDays: {}, appts: [], now, techName: 'Yara', durationMins: 60, today: TODAY, ...extra });

describe('computeNextOpening', () => {
  it('midday with a free tech → returns now (2pm), not the 9am grid start', () => {
    const now = new Date(2026, 5, 15, 14, 0);
    expect(computeNextOpening(base(now))).toBe(M(14));
  });

  it('before salon open (9:30am, store opens 10am) → floors at 10am, never 9:30', () => {
    const now = new Date(2026, 5, 15, 9, 30);
    expect(computeNextOpening(base(now))).toBe(M(10));
  });

  it('after close (11pm) → null', () => {
    const now = new Date(2026, 5, 15, 23, 0);
    expect(computeNextOpening(base(now))).toBeNull();
  });

  it('tech off today → null', () => {
    const now = new Date(2026, 5, 15, 14, 0);
    expect(computeNextOpening(base(now, { empWorkDays: { Yara: { [dowOf(now)]: { on: false } } } }))).toBeNull();
  });

  it('salon CLOSED today → null (the bug the review caught: must not fall through to 9am)', () => {
    const now = new Date(2026, 5, 15, 14, 0);
    expect(computeNextOpening({ ...base(now), settings: settingsFor(now, { closed: true }) })).toBeNull();
  });

  it('skips a booked block → first slot after the appointment', () => {
    const now = new Date(2026, 5, 15, 10, 0);
    const appts = [{ date: TODAY, techName: 'Yara', startTime: '10:00', services: [{ duration: 60 }], status: 'scheduled' }];
    expect(computeNextOpening(base(now, { appts }))).toBe(M(11));
  });

  it('ignores cancelled / no_show / deleted appts', () => {
    const now = new Date(2026, 5, 15, 10, 0);
    const appts = [
      { date: TODAY, techName: 'Yara', startTime: '10:00', services: [{ duration: 60 }], status: 'cancelled' },
      { date: TODAY, techName: 'Yara', startTime: '10:00', services: [{ duration: 60 }], status: 'no_show' },
      { date: TODAY, techName: 'Yara', startTime: '10:00', services: [{ duration: 60 }], _deleted: true },
    ];
    expect(computeNextOpening(base(now, { appts }))).toBe(M(10));
  });

  it('rounds now up to the next 15-min step (2:07 → 2:15)', () => {
    const now = new Date(2026, 5, 15, 14, 7);
    expect(computeNextOpening(base(now))).toBe(M(14, 15));
  });

  it('"Any" tech (no techName) → next slot from now, no per-tech busy filter', () => {
    const now = new Date(2026, 5, 15, 11, 0);
    expect(computeNextOpening(base(now, { techName: '' }))).toBe(M(11));
  });

  it('storeHours missing for the day → falls back to apptHours, no crash', () => {
    const now = new Date(2026, 5, 15, 14, 0);
    const settings = { apptHours: { open: '09:00', close: '20:00' }, storeHours: {} };
    expect(computeNextOpening({ ...base(now), settings })).toBe(M(14));
  });

  it("tech's work-day window narrows availability (starts noon) → floors at 12pm", () => {
    const now = new Date(2026, 5, 15, 10, 0);
    const empWorkDays = { Yara: { [dowOf(now)]: { on: true, start: '12:00', end: '18:00' } } };
    expect(computeNextOpening(base(now, { empWorkDays }))).toBe(M(12));
  });
});

describe('computeSeatStart (seated-walk-in default time)', () => {
  it('uses the next real opening when one exists', () => {
    const now = new Date(2026, 5, 15, 14, 0);
    expect(computeSeatStart(base(now))).toBe(M(14));
  });

  it('after close → falls back to NOW (11pm), NOT a past salon-open time or 9am', () => {
    const now = new Date(2026, 5, 15, 23, 0);
    const r = computeSeatStart(base(now));
    expect(r).toBe(M(23));      // 11pm now — not 10am (past), not 9am
    expect(r).not.toBe(M(10));
    expect(r).not.toBe(M(9));
  });

  it('the exact reported case: 11:43pm → rounds up to 11:45pm (not 10am)', () => {
    const now = new Date(2026, 5, 15, 23, 43);
    expect(computeSeatStart(base(now))).toBe(M(23, 45));
  });

  it('tech off (midday) → falls back to NOW (2pm)', () => {
    const now = new Date(2026, 5, 15, 14, 0);
    expect(computeSeatStart(base(now, { empWorkDays: { Yara: { [dowOf(now)]: { on: false } } } }))).toBe(M(14));
  });

  it('before open (8am, salon opens 10am) → the OPEN time (10am, future), via next-opening', () => {
    const now = new Date(2026, 5, 15, 8, 0);
    expect(computeSeatStart(base(now))).toBe(M(10));
  });

  it('REGRESSION: never returns 9am when the salon opens at 10am', () => {
    for (const now of [new Date(2026, 5, 15, 23, 0), new Date(2026, 5, 15, 5, 0), new Date(2026, 5, 15, 14, 0)]) {
      expect(computeSeatStart(base(now))).not.toBe(M(9));
    }
  });

  it('salon closed today, midday → "now" (2pm), not 9am or a past open time', () => {
    const now = new Date(2026, 5, 15, 14, 0);
    expect(computeSeatStart({ ...base(now), settings: settingsFor(now, { closed: true }) })).toBe(M(14));
  });
});
