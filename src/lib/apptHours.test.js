import { describe, it, expect } from 'vitest';
import { toMins, storeWindow, techApptWindow, buildTechApptHours, daySpanFromTechHours } from './apptHours';

const settings = { storeHours: { Mon: { open: '10:00', close: '18:00' }, Sun: { closed: true } } };

describe('storeWindow', () => {
  it('reads per-day store hours', () => {
    expect(storeWindow(settings, 'Mon')).toEqual({ closed: false, open: 600, close: 1080 });
  });
  it('flags closed days + defaults missing days to 9-18', () => {
    expect(storeWindow(settings, 'Sun').closed).toBe(true);
    expect(storeWindow(settings, 'Tue')).toEqual({ closed: false, open: 540, close: 1080 });
  });
});

describe('techApptWindow', () => {
  it('NOT extended → store hours, ignoring any apptHours', () => {
    const emp = { extendedHoursAllowed: false, apptHours: { open: '07:00', close: '22:00' } };
    expect(techApptWindow(emp, settings, 'Mon')).toEqual({ open: 600, close: 1080 });
  });
  it('extended but apptHours unset → defaults to store hours (no extension)', () => {
    expect(techApptWindow({ extendedHoursAllowed: true }, settings, 'Mon')).toEqual({ open: 600, close: 1080 });
    expect(techApptWindow({ extendedHoursAllowed: true, apptHours: {} }, settings, 'Mon')).toEqual({ open: 600, close: 1080 });
  });
  it('extended + apptHours widens beyond store hours', () => {
    const emp = { extendedHoursAllowed: true, apptHours: { open: '08:00', close: '20:00' } };
    expect(techApptWindow(emp, settings, 'Mon')).toEqual({ open: 480, close: 1200 });
  });
  it('never narrows store hours (a tighter apptHours is clamped out)', () => {
    const emp = { extendedHoursAllowed: true, apptHours: { open: '11:00', close: '16:00' } };
    expect(techApptWindow(emp, settings, 'Mon')).toEqual({ open: 600, close: 1080 });
  });
  it('one side set, other falls back to store', () => {
    const emp = { extendedHoursAllowed: true, apptHours: { close: '21:00' } };
    expect(techApptWindow(emp, settings, 'Mon')).toEqual({ open: 600, close: 1260 });
  });
  it('legacy salon-wide apptHours fills in for an extended tech with no per-tech window', () => {
    const emp = { extendedHoursAllowed: true };
    expect(techApptWindow(emp, settings, 'Mon', { open: '08:00', close: '20:00' })).toEqual({ open: 480, close: 1200 });
  });
  it('per-tech apptHours overrides the legacy fallback', () => {
    const emp = { extendedHoursAllowed: true, apptHours: { open: '07:00', close: '19:00' } };
    expect(techApptWindow(emp, settings, 'Mon', { open: '08:00', close: '20:00' })).toEqual({ open: 420, close: 1140 });
  });
});

describe('buildTechApptHours + daySpanFromTechHours', () => {
  const emps = [
    { name: 'Ana',  extendedHoursAllowed: false },
    { name: 'Mara', extendedHoursAllowed: true, apptHours: { open: '08:00', close: '20:00' } },
  ];
  it('maps each tech to their window', () => {
    const m = buildTechApptHours(emps, settings, 'Mon');
    expect(m.Ana).toEqual({ open: 600, close: 1080 });
    expect(m.Mara).toEqual({ open: 480, close: 1200 });
  });
  it('day span = widest across techs, floored by walk-in/store span', () => {
    const m = buildTechApptHours(emps, settings, 'Mon');
    expect(daySpanFromTechHours(m, 600, 1080)).toEqual({ open: 480, close: 1200 });
  });
  it('day span never narrower than the walk-in span', () => {
    const m = buildTechApptHours([{ name: 'Ana', extendedHoursAllowed: false }], settings, 'Mon');
    expect(daySpanFromTechHours(m, 600, 1080)).toEqual({ open: 600, close: 1080 });
  });
});
