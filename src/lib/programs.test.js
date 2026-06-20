import { describe, it, expect } from 'vitest';
import { blankProgram, newWeek, newDay, newExercise, programStats, assignProgram, cloneWeeks } from './programs';

describe('program structure helpers', () => {
  it('blankProgram has one week → one day → one exercise', () => {
    const p = blankProgram();
    const s = programStats(p);
    expect(s).toEqual({ weeks: 1, days: 1, exercises: 1 });
  });
  it('programStats counts nested totals', () => {
    const p = { weeks: [
      { days: [{ exercises: [newExercise(), newExercise()] }, { exercises: [newExercise()] }] },
      { days: [{ exercises: [] }] },
    ] };
    expect(programStats(p)).toEqual({ weeks: 2, days: 3, exercises: 3 });
  });
  it('newWeek / newDay carry sensible defaults', () => {
    expect(newWeek(2).name).toBe('Week 2');
    expect(newDay(3).name).toBe('Day 3');
  });
});

describe('assignProgram', () => {
  const template = {
    id: 'tpl1', name: '12-Week Strength', description: 'progressive',
    weeks: [{ id: 'w1', name: 'Week 1', days: [{ id: 'd1', name: 'Push', exercises: [{ id: 'e1', name: 'Bench', sets: '4' }] }] }],
  };
  const client = { id: 'c1', name: 'Sam', email: 'Sam@Example.com' };

  it('stamps client identity and lowercases the email', () => {
    const cp = assignProgram(template, client);
    expect(cp.clientId).toBe('c1');
    expect(cp.clientEmail).toBe('sam@example.com');
    expect(cp.templateId).toBe('tpl1');
    expect(cp.status).toBe('active');
    expect(cp.currentWeek).toBe(1);
  });

  it('deep-copies weeks so editing the assigned copy never mutates the template', () => {
    const cp = assignProgram(template, client);
    cp.weeks[0].days[0].exercises[0].sets = '5';
    cp.weeks[0].name = 'CHANGED';
    expect(template.weeks[0].days[0].exercises[0].sets).toBe('4'); // template untouched
    expect(template.weeks[0].name).toBe('Week 1');
  });

  it('cloneWeeks returns an independent structure', () => {
    const w = [{ days: [{ exercises: [{ name: 'Squat' }] }] }];
    const c = cloneWeeks(w);
    c[0].days[0].exercises[0].name = 'Deadlift';
    expect(w[0].days[0].exercises[0].name).toBe('Squat');
  });
});
