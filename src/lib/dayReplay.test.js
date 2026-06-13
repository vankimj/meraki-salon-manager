import { describe, it, expect } from 'vitest';
import { buildDayReplay } from './dayReplay';

const services = [
  { name: 'Full set', turnValue: 2 },
  { name: 'Polish change', turnValue: 0.5 },
  { name: 'Gel manicure', turnValue: 1.5 },
];
const roster = [
  { techName: 'Anna', clockInAt: '2026-06-13T08:55:00Z' },
  { techName: 'Bao', clockInAt: '2026-06-13T09:05:00Z' },
];
const appts = [
  { techName: 'Anna', status: 'done', date: '2026-06-13', startTime: '09:10', services: [{ name: 'Full set' }], source: 'walkin_kiosk', clientName: 'Pat' },
  { techName: 'Bao', status: 'done', date: '2026-06-13', startTime: '09:30', services: [{ name: 'Polish change' }], clientName: 'Sam' },
  { techName: 'Anna', status: 'done', date: '2026-06-13', startTime: '10:00', services: [{ name: 'Gel manicure' }], techRequestType: 'requested', clientName: 'Lee' },
  { techName: 'Bao', status: 'cancelled', date: '2026-06-13', startTime: '11:00', services: [{ name: 'Full set' }] },           // excluded
  { techName: 'Anna', status: 'done', date: '2026-06-12', startTime: '09:00', services: [{ name: 'Full set' }] },               // other day, excluded
];

describe('buildDayReplay — count mode', () => {
  const r = buildDayReplay({ appointments: appts, services, roster, turnMode: 'count', date: '2026-06-13' });
  it('counts only done appts on the date, +1 each', () => {
    expect(r.events.length).toBe(3);
    expect(r.finals).toEqual({ Anna: 2, Bao: 1 });
  });
  it('orders chronologically and tracks cumulative', () => {
    expect(r.events.map(e => e.startTime)).toEqual(['09:10', '09:30', '10:00']);
    expect(r.cumulative[0]).toEqual({ Anna: 0, Bao: 0 });
    expect(r.cumulative[3]).toEqual({ Anna: 2, Bao: 1 });
  });
  it('keeps clock-in order and flags walk-in / requested', () => {
    expect(r.techs.map(t => t.name)).toEqual(['Anna', 'Bao']);
    expect(r.events[0].kind).toBe('walkin');
    expect(r.events[2].requested).toBe(true);
  });
});

describe('buildDayReplay — value mode', () => {
  const r = buildDayReplay({ appointments: appts, services, roster, turnMode: 'value', date: '2026-06-13' });
  it('credits per-service turn value', () => {
    // Anna: full(2) + gel(1.5) = 3.5 ; Bao: polish(0.5)
    expect(r.finals).toEqual({ Anna: 3.5, Bao: 0.5 });
    expect(r.events[0].credit).toBe(2);
    expect(r.events[1].credit).toBe(0.5);
  });
});

describe('buildDayReplay — empty', () => {
  it('flags an empty day', () => {
    const r = buildDayReplay({ appointments: [], services, roster, turnMode: 'count', date: '2026-06-13' });
    expect(r.isEmpty).toBe(true);
    expect(r.techs.map(t => t.name)).toEqual(['Anna', 'Bao']);
  });
});
