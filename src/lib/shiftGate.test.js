import { describe, it, expect } from 'vitest';
import {
  isSalonOpenNow,
  isEntryClockedIn,
  clockedInNameSet,
  clockedInTodayNameSet,
  offClockTechNames,
  attendanceKey,
  techWorkStatus,
} from './shiftGate';

// A Wednesday at 14:30 local. storeHours keys are en-US short weekday names.
const wedAfternoon = new Date('2026-06-10T14:30:00');
const wedEvening   = new Date('2026-06-10T21:30:00');
const wedMorning   = new Date('2026-06-10T08:00:00');

const HOURS = {
  storeHours: {
    Mon: { open: '10:00', close: '19:00', closed: false },
    Wed: { open: '10:00', close: '19:00', closed: false },
    Sun: { open: '', close: '', closed: true },
  },
};

describe('isSalonOpenNow', () => {
  it('open when inside the day’s hours', () => {
    expect(isSalonOpenNow(HOURS, wedAfternoon)).toBe(true);
  });
  it('closed after close time', () => {
    expect(isSalonOpenNow(HOURS, wedEvening)).toBe(false);
  });
  it('closed before open time', () => {
    expect(isSalonOpenNow(HOURS, wedMorning)).toBe(false);
  });
  it('closed on a day flagged closed', () => {
    expect(isSalonOpenNow(HOURS, new Date('2026-06-14T14:00:00'))).toBe(false); // Sunday
  });
  it('closed (fail-open) when no hours configured at all', () => {
    expect(isSalonOpenNow({}, wedAfternoon)).toBe(false);
    expect(isSalonOpenNow(null, wedAfternoon)).toBe(false);
  });
  it('closed when the day has no entry', () => {
    expect(isSalonOpenNow(HOURS, new Date('2026-06-09T14:00:00'))).toBe(false); // Tuesday, absent
  });
  it('close boundary is exclusive, open boundary inclusive', () => {
    expect(isSalonOpenNow(HOURS, new Date('2026-06-10T10:00:00'))).toBe(true);
    expect(isSalonOpenNow(HOURS, new Date('2026-06-10T19:00:00'))).toBe(false);
  });
});

describe('isEntryClockedIn', () => {
  it('events: last "in" → clocked in', () => {
    expect(isEntryClockedIn({ events: [{ kind: 'in' }] })).toBe(true);
  });
  it('events: on break still counts as on shift', () => {
    expect(isEntryClockedIn({ events: [{ kind: 'in' }, { kind: 'break_start' }] })).toBe(true);
    expect(isEntryClockedIn({ events: [{ kind: 'in' }, { kind: 'break_start' }, { kind: 'break_end' }] })).toBe(true);
  });
  it('events: last "out" → not clocked in', () => {
    expect(isEntryClockedIn({ events: [{ kind: 'in' }, { kind: 'out' }] })).toBe(false);
  });
  it('events: clock back in after out → clocked in (flat snapshot would miss this)', () => {
    expect(isEntryClockedIn({ events: [{ kind: 'in' }, { kind: 'out' }, { kind: 'in' }], clockInAt: 'x', clockOutAt: 'y' })).toBe(true);
  });
  it('flat fallback when no events', () => {
    expect(isEntryClockedIn({ clockInAt: 'x', clockOutAt: null })).toBe(true);
    expect(isEntryClockedIn({ clockInAt: 'x', clockOutAt: 'y' })).toBe(false);
    expect(isEntryClockedIn({})).toBe(false);
  });
  it('null entry → false', () => {
    expect(isEntryClockedIn(null)).toBe(false);
  });
});

const ATT = {
  entries: [
    { employeeId: 'e1', employeeName: 'Yasmin D', events: [{ kind: 'in' }] },
    { employeeId: 'e2', employeeName: 'Tess D',   events: [{ kind: 'in' }, { kind: 'out' }] },
    { employeeId: 'e3', employeeName: 'Jen T',    clockInAt: 'x', clockOutAt: null },
  ],
};

describe('clockedInNameSet', () => {
  it('only includes currently-on-the-clock techs, lowercased', () => {
    const s = clockedInNameSet(ATT);
    expect(s.has('yasmin d')).toBe(true);
    expect(s.has('jen t')).toBe(true);
    expect(s.has('tess d')).toBe(false);
  });
  it('empty doc → empty set', () => {
    expect(clockedInNameSet({ entries: [] }).size).toBe(0);
    expect(clockedInNameSet(null).size).toBe(0);
  });
});

describe('offClockTechNames', () => {
  it('flags credited techs who are not clocked in (display-cased, deduped)', () => {
    const missing = offClockTechNames(['Yasmin D', 'Tess D', 'Tess D'], ATT);
    expect(missing).toEqual(['Tess D']);
  });
  it('all clocked in → empty', () => {
    expect(offClockTechNames(['Yasmin D', 'Jen T'], ATT)).toEqual([]);
  });
  it('ignores blank / Walk-in / TBD slots', () => {
    expect(offClockTechNames(['', 'Walk-in', 'TBD'], ATT)).toEqual([]);
  });
  it('case-insensitive match', () => {
    expect(offClockTechNames(['yasmin d'], ATT)).toEqual([]);
  });
});

describe('attendanceKey', () => {
  it('formats salon-local YYYY-MM-DD', () => {
    expect(attendanceKey(new Date('2026-06-08T09:05:00'))).toBe('2026-06-08');
    expect(attendanceKey(new Date('2026-01-03T23:59:00'))).toBe('2026-01-03');
  });
});

describe('clockedInTodayNameSet', () => {
  it('includes anyone with an entry today, even after clock-out', () => {
    const att = { entries: [
      { employeeName: 'Yasmin D', events: [{ kind: 'in' }, { kind: 'out' }] }, // clocked out
      { employeeName: 'Ana P',    events: [{ kind: 'in' }] },                   // still in
    ] };
    const today = clockedInTodayNameSet(att);
    expect(today.has('yasmin d')).toBe(true);   // worked today (now off)
    expect(today.has('ana p')).toBe(true);
    // ...but only Ana P is currently on the clock:
    expect(clockedInNameSet(att).has('yasmin d')).toBe(false);
    expect(clockedInNameSet(att).has('ana p')).toBe(true);
  });
});

describe('techWorkStatus', () => {
  it('clock-based salon (no shift config): clocked in now ⇒ working today + now', () => {
    expect(techWorkStatus({ isToday: true, clockedInToday: true, clockedInNow: true, hasShift: false }))
      .toEqual({ today: true, now: true });
  });
  it('clocked in earlier but now out ⇒ working today, not now', () => {
    expect(techWorkStatus({ isToday: true, clockedInToday: true, clockedInNow: false, hasShift: false }))
      .toEqual({ today: true, now: false });
  });
  it('no clock-in and no shift ⇒ unknown ⇒ off (so the filter/split can narrow)', () => {
    expect(techWorkStatus({ isToday: true, clockedInToday: false, hasShift: false }))
      .toEqual({ today: false, now: false });
  });
  it('shift-based salon: scheduled + within window ⇒ working now', () => {
    expect(techWorkStatus({ isToday: true, hasShift: true, shiftOnToday: true, withinShiftNow: true }))
      .toEqual({ today: true, now: true });
  });
  it('shift marks today off ⇒ not working', () => {
    expect(techWorkStatus({ isToday: true, hasShift: true, shiftOnToday: false }))
      .toEqual({ today: false, now: false });
  });
  it('all-day time off ⇒ off even if a shift exists', () => {
    expect(techWorkStatus({ isToday: true, hasShift: true, shiftOnToday: true, withinShiftNow: true, allDayOff: true }))
      .toEqual({ today: false, now: false });
  });
  it('a clock-in overrides time off (they showed up)', () => {
    expect(techWorkStatus({ isToday: true, clockedInToday: true, clockedInNow: true, allDayOff: true }))
      .toEqual({ today: true, now: true });
  });
  it('blocked right now ⇒ working today but not "now"', () => {
    expect(techWorkStatus({ isToday: true, hasShift: true, shiftOnToday: true, withinShiftNow: true, blockedNow: true }))
      .toEqual({ today: true, now: false });
  });
});
