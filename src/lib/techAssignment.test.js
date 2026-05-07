import { describe, it, expect } from 'vitest';
import { pickTech, startOfWeek, endOfWeek } from './techAssignment';

const T1 = { id: 't1', name: 'Audriana' };
const T2 = { id: 't2', name: 'Beth' };
const T3 = { id: 't3', name: 'Cara' };

describe('startOfWeek / endOfWeek', () => {
  it('Sun–Sat week containing the given date', () => {
    expect(startOfWeek('2026-05-04')).toBe('2026-05-03'); // Mon → Sun May 3
    expect(endOfWeek('2026-05-04')).toBe('2026-05-09');   // Mon → Sat May 9
  });
  it('handles a Sunday correctly', () => {
    expect(startOfWeek('2026-05-03')).toBe('2026-05-03');
    expect(endOfWeek('2026-05-03')).toBe('2026-05-09');
  });
  it('handles a Saturday correctly', () => {
    expect(startOfWeek('2026-05-09')).toBe('2026-05-03');
    expect(endOfWeek('2026-05-09')).toBe('2026-05-09');
  });
});

describe('pickTech — common cases', () => {
  it('returns null when no free techs', () => {
    const r = pickTech({ method: 'leastBusyDay', freeTechs: [] });
    expect(r.tech).toBeNull();
  });
  it('returns the only free tech without consulting method', () => {
    const r = pickTech({ method: 'random', freeTechs: [T1] });
    expect(r.tech).toBe(T1);
  });
});

describe('pickTech — leastBusyDay', () => {
  it('picks the tech with fewest day appts', () => {
    const dayAppts = [
      { techId: 't1', status: 'scheduled' }, { techId: 't1', status: 'done' },
      { techId: 't2', status: 'done' },
    ];
    const r = pickTech({ method: 'leastBusyDay', freeTechs: [T1, T2], dayAppts });
    expect(r.tech).toBe(T2); // t2 has 1, t1 has 2
  });
  it('ignores cancelled appointments', () => {
    const dayAppts = [
      { techId: 't1', status: 'scheduled' },
      { techId: 't2', status: 'cancelled' },
      { techId: 't2', status: 'cancelled' },
    ];
    const r = pickTech({ method: 'leastBusyDay', freeTechs: [T1, T2], dayAppts });
    expect(r.tech).toBe(T2); // t2 has 0 active, t1 has 1
  });
  it('breaks ties alphabetically', () => {
    const r = pickTech({ method: 'leastBusyDay', freeTechs: [T2, T1], dayAppts: [] });
    expect(r.tech).toBe(T1); // Audriana < Beth
  });
});

describe('pickTech — leastBusyWeek', () => {
  it('picks the tech with fewest week appts', () => {
    const weekAppts = [
      { techId: 't1' }, { techId: 't1' }, { techId: 't1' },
      { techId: 't2' },
    ];
    const r = pickTech({ method: 'leastBusyWeek', freeTechs: [T1, T2], weekAppts });
    expect(r.tech).toBe(T2);
  });
});

describe('pickTech — lowestRevenueWeek', () => {
  it('picks the tech with lowest service revenue this week', () => {
    const weekAppts = [
      { techId: 't1', services: [{ price: 100 }] },
      { techId: 't1', services: [{ price: 50 }] },
      { techId: 't2', services: [{ price: 30 }] },
    ];
    const r = pickTech({ method: 'lowestRevenueWeek', freeTechs: [T1, T2], weekAppts });
    expect(r.tech).toBe(T2); // t2: $30, t1: $150
  });
});

describe('pickTech — roundRobin', () => {
  it('cycles through techs alphabetically and increments the index', () => {
    const r1 = pickTech({ method: 'roundRobin', freeTechs: [T2, T1, T3], roundRobinIndex: 0 });
    expect(r1.tech.name).toBe('Audriana'); // index 0 of sorted
    expect(r1.nextRoundRobinIndex).toBe(1);

    const r2 = pickTech({ method: 'roundRobin', freeTechs: [T2, T1, T3], roundRobinIndex: 1 });
    expect(r2.tech.name).toBe('Beth');
    expect(r2.nextRoundRobinIndex).toBe(2);
  });
  it('wraps around safely for indices beyond the tech count', () => {
    const r = pickTech({ method: 'roundRobin', freeTechs: [T1, T2], roundRobinIndex: 5 });
    expect(r.tech.name).toBe('Beth'); // 5 % 2 = 1
  });
});

describe('pickTech — random', () => {
  it('always returns a tech from the free list', () => {
    for (let i = 0; i < 20; i++) {
      const r = pickTech({ method: 'random', freeTechs: [T1, T2, T3] });
      expect([T1, T2, T3]).toContain(r.tech);
    }
  });
});

describe('pickTech — turnQueue', () => {
  it('picks the rostered tech with fewest turns', () => {
    const turnRoster = [
      { techName: 'Audriana', turnsTaken: 3, clockInAt: '09:00' },
      { techName: 'Beth',     turnsTaken: 1, clockInAt: '09:00' },
    ];
    const r = pickTech({ method: 'turnQueue', freeTechs: [T1, T2], turnRoster });
    expect(r.tech.name).toBe('Beth');
  });
  it('breaks ties by earlier clock-in', () => {
    const turnRoster = [
      { techName: 'Audriana', turnsTaken: 2, clockInAt: '10:00' },
      { techName: 'Beth',     turnsTaken: 2, clockInAt: '09:00' },
    ];
    const r = pickTech({ method: 'turnQueue', freeTechs: [T1, T2], turnRoster });
    expect(r.tech.name).toBe('Beth');
  });
  it('falls back to leastBusyDay when no free tech is in the roster', () => {
    const turnRoster = [{ techName: 'Other', turnsTaken: 0, clockInAt: '09:00' }];
    const dayAppts = [{ techId: 't2' }];
    const r = pickTech({ method: 'turnQueue', freeTechs: [T1, T2], dayAppts, turnRoster });
    expect(r.tech).toBe(T1); // T2 has 1 appt, T1 has 0
  });
  it('degrades to leastBusyDay when roster is null (future-dated booking)', () => {
    const dayAppts = [{ techId: 't1' }];
    const r = pickTech({ method: 'turnQueue', freeTechs: [T1, T2], dayAppts, turnRoster: null });
    expect(r.tech).toBe(T2);
  });
});

describe('pickTech — does not increment roundRobinIndex for non-roundRobin methods', () => {
  it('leastBusyDay leaves the index alone', () => {
    const r = pickTech({
      method: 'leastBusyDay', freeTechs: [T1, T2],
      dayAppts: [], roundRobinIndex: 7,
    });
    expect(r.nextRoundRobinIndex).toBe(7);
  });
});
