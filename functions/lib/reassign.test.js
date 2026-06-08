import { describe, it, expect } from 'vitest';
import {
  strToMins, apptDuration, techCanDoServices, nowMinutesInTz, planReassignments,
} from './reassign.js';

const svc = (id, duration) => ({ id, name: id, duration, price: 10 });
// createdAt drives processing order; startTime drives the slot.
let seq = 0;
const appt = (over = {}) => ({
  id: `a${++seq}`,
  date: '2026-06-10',
  startTime: '10:00',
  status: 'scheduled',
  techRequestType: 'auto',
  techName: 'TBD',
  techId: null,
  services: [svc('mani', 60)],
  createdAt: `2026-06-01T00:00:0${seq}.000Z`,
  ...over,
});
const tech = (id, name, clockInAt, serviceIds = []) => ({ id, name, email: `${id}@x.com`, serviceIds, clockInAt });

describe('strToMins / apptDuration', () => {
  it('parses HH:MM', () => {
    expect(strToMins('09:30')).toBe(570);
    expect(strToMins('00:00')).toBe(0);
    expect(strToMins('')).toBe(0);
  });
  it('sums service durations, falls back to duration then 60', () => {
    expect(apptDuration({ services: [svc('a', 30), svc('b', 45)] })).toBe(75);
    expect(apptDuration({ services: [], duration: 50 })).toBe(50);
    expect(apptDuration({})).toBe(60);
  });
});

describe('techCanDoServices', () => {
  it('empty serviceIds = can do all', () => {
    expect(techCanDoServices({ serviceIds: [] }, [svc('x', 30)])).toBe(true);
    expect(techCanDoServices({}, [svc('x', 30)])).toBe(true);
  });
  it('must cover every service', () => {
    expect(techCanDoServices({ serviceIds: ['mani'] }, [svc('mani', 30)])).toBe(true);
    expect(techCanDoServices({ serviceIds: ['mani'] }, [svc('mani', 30), svc('pedi', 30)])).toBe(false);
  });
});

describe('nowMinutesInTz', () => {
  it('computes minutes since midnight in a tz', () => {
    // 2026-06-10T14:30:00Z is 10:30 in America/New_York (EDT, -4) → 630.
    expect(nowMinutesInTz('America/New_York', new Date('2026-06-10T14:30:00Z'))).toBe(630);
  });
});

describe('planReassignments', () => {
  it('no clocked-in techs → no changes', () => {
    expect(planReassignments({ appts: [appt()], clockedInTechs: [], nowMins: 0 })).toEqual([]);
  });

  it('assigns an unstaffed future appt to the only clocked-in tech', () => {
    seq = 0;
    const a = appt({ techName: 'TBD' });
    const r = planReassignments({ appts: [a], clockedInTechs: [tech('t1', 'Yasmin', '2026-06-10T13:00:00Z')], nowMins: 540 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ apptId: a.id, toTechId: 't1', toTechName: 'Yasmin', fromTechName: 'TBD' });
  });

  it('earliest clock-in gets first pick; conflicts overflow to the next tech', () => {
    seq = 0;
    // Two appts at the SAME time → one tech can only take one; the other goes
    // to the next-earliest clocked-in tech.
    const a1 = appt({ startTime: '10:00', createdAt: '2026-06-01T00:00:01Z' });
    const a2 = appt({ startTime: '10:00', createdAt: '2026-06-01T00:00:02Z' });
    const techs = [tech('t2', 'Beth', '2026-06-10T13:10:00Z'), tech('t1', 'Ana', '2026-06-10T13:00:00Z')];
    const r = planReassignments({ appts: [a1, a2], clockedInTechs: techs, nowMins: 540 });
    expect(r).toHaveLength(2);
    // a1 (created first) → Ana (earliest clock-in); a2 → Beth (next).
    expect(r.find(c => c.apptId === a1.id).toTechName).toBe('Ana');
    expect(r.find(c => c.apptId === a2.id).toTechName).toBe('Beth');
  });

  it('one tech accumulates non-overlapping appts (first-clocked-in keeps picking)', () => {
    seq = 0;
    const a1 = appt({ startTime: '10:00' });
    const a2 = appt({ startTime: '11:30' }); // 60-min appts don't overlap
    const techs = [tech('t1', 'Ana', '2026-06-10T13:00:00Z'), tech('t2', 'Beth', '2026-06-10T13:30:00Z')];
    const r = planReassignments({ appts: [a1, a2], clockedInTechs: techs, nowMins: 540 });
    expect(r.map(c => c.toTechName)).toEqual(['Ana', 'Ana']);
  });

  it('respects eligibility (serviceIds)', () => {
    seq = 0;
    const a = appt({ services: [svc('pedi', 60)] });
    const techs = [
      tech('t1', 'Ana', '2026-06-10T13:00:00Z', ['mani']),  // can't do pedi
      tech('t2', 'Beth', '2026-06-10T13:30:00Z', ['pedi']), // can
    ];
    const r = planReassignments({ appts: [a], clockedInTechs: techs, nowMins: 540 });
    expect(r).toHaveLength(1);
    expect(r[0].toTechName).toBe('Beth');
  });

  it('does NOT move appts whose current tech is already clocked in', () => {
    seq = 0;
    const a = appt({ techName: 'Ana', techId: 't1' });
    const r = planReassignments({ appts: [a], clockedInTechs: [tech('t1', 'Ana', '2026-06-10T13:00:00Z')], nowMins: 540 });
    expect(r).toEqual([]);
  });

  it('skips specific-request, non-scheduled, and past appts', () => {
    seq = 0;
    const specific = appt({ techRequestType: 'specific', techName: 'X' });
    const done     = appt({ status: 'done', techName: 'X' });
    const past     = appt({ startTime: '08:00', techName: 'X' }); // before nowMins=540 (09:00)
    const r = planReassignments({
      appts: [specific, done, past],
      clockedInTechs: [tech('t1', 'Ana', '2026-06-10T13:00:00Z')],
      nowMins: 540,
    });
    expect(r).toEqual([]);
  });

  it('existing scheduled appts on a clocked-in tech block that slot', () => {
    seq = 0;
    // Ana already has a real booking 10:00–11:00; the pool appt at 10:00 must
    // overflow to Beth.
    const existing = appt({ techName: 'Ana', techId: 't1', techRequestType: 'specific', startTime: '10:00' });
    const poolAppt = appt({ startTime: '10:00', techName: 'TBD' });
    const techs = [tech('t1', 'Ana', '2026-06-10T13:00:00Z'), tech('t2', 'Beth', '2026-06-10T13:30:00Z')];
    const r = planReassignments({ appts: [existing, poolAppt], clockedInTechs: techs, nowMins: 540 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ apptId: poolAppt.id, toTechName: 'Beth' });
  });

  it('leaves an appt unassigned when no clocked-in tech is free/eligible', () => {
    seq = 0;
    const a = appt({ services: [svc('pedi', 60)] });
    const r = planReassignments({ appts: [a], clockedInTechs: [tech('t1', 'Ana', '2026-06-10T13:00:00Z', ['mani'])], nowMins: 540 });
    expect(r).toEqual([]);
  });
});
