import { describe, it, expect } from 'vitest';
import {
  addWeeks, suggestRebookDate, rebookCartFromVisit,
  hasFutureAppointment, shouldShowRebookPrompt,
} from './rebook';

describe('addWeeks', () => {
  it('adds whole weeks to a date string', () => {
    expect(addWeeks('2026-05-04', 3)).toBe('2026-05-25');
  });
  it('crosses month boundaries', () => {
    expect(addWeeks('2026-04-25', 2)).toBe('2026-05-09');
  });
  it('crosses year boundaries', () => {
    expect(addWeeks('2026-12-25', 2)).toBe('2027-01-08');
  });
  it('returns empty string for empty input', () => {
    expect(addWeeks('', 4)).toBe('');
  });
});

describe('suggestRebookDate', () => {
  it('returns null when no service has a rebook interval', () => {
    expect(suggestRebookDate('2026-05-04', [{ defaultRebookWeeks: 0 }])).toBeNull();
    expect(suggestRebookDate('2026-05-04', [{}])).toBeNull();
  });
  it('uses the longest interval among services performed', () => {
    const services = [
      { defaultRebookWeeks: 3 }, // mani
      { defaultRebookWeeks: 4 }, // pedi — wins
    ];
    expect(suggestRebookDate('2026-05-04', services)).toBe('2026-06-01');
  });
  it('returns null for missing visit date', () => {
    expect(suggestRebookDate('', [{ defaultRebookWeeks: 4 }])).toBeNull();
  });
  it('returns null for empty service list', () => {
    expect(suggestRebookDate('2026-05-04', [])).toBeNull();
  });
  it('coerces string intervals', () => {
    expect(suggestRebookDate('2026-05-04', [{ defaultRebookWeeks: '4' }])).toBe('2026-06-01');
  });
});

describe('rebookCartFromVisit', () => {
  const SVC_MANI = { id: 'mani', name: 'Manicure', basePrice: 30, duration: 30, options: [{ id: 'long', name: 'Long', price: 40, duration: 45 }] };
  const SVC_PEDI = { id: 'pedi', name: 'Pedicure', basePrice: 50, duration: 60 };
  const byId = { mani: SVC_MANI, pedi: SVC_PEDI };

  it('builds a cart with one entry per visited service', () => {
    const cart = rebookCartFromVisit([{ id: 'mani' }, { id: 'pedi' }], byId);
    expect(cart.length).toBe(2);
    expect(cart[0].service.id).toBe('mani');
    expect(cart[1].service.id).toBe('pedi');
  });
  it('preserves the option selection from the visit', () => {
    const cart = rebookCartFromVisit([{ id: 'mani', optionId: 'long' }], byId);
    expect(cart[0].option.id).toBe('long');
    expect(cart[0].option.duration).toBe(45);
  });
  it('skips removal lines (one-time, not repeated)', () => {
    const cart = rebookCartFromVisit(
      [{ id: 'mani' }, { id: 'removal', isRemoval: true }],
      byId,
    );
    expect(cart.length).toBe(1);
    expect(cart[0].service.id).toBe('mani');
  });
  it('skips services that are no longer in the catalog', () => {
    const cart = rebookCartFromVisit([{ id: 'mani' }, { id: 'old_deleted' }], byId);
    expect(cart.map(c => c.service.id)).toEqual(['mani']);
  });
  it('returns empty for empty visit', () => {
    expect(rebookCartFromVisit([], byId)).toEqual([]);
  });
  it('returns empty when no service docs are loaded', () => {
    expect(rebookCartFromVisit([{ id: 'mani' }], null)).toEqual([]);
  });
  it('every cart item has removal: false (rebook never auto-applies removal)', () => {
    const cart = rebookCartFromVisit([{ id: 'mani' }], byId);
    expect(cart[0].removal).toBe(false);
  });
  it('add-on lines (addOnOf set, NOT isRemoval) are rebookable too', () => {
    // An add-on is a real service line tagged addOnOf; it should come back on
    // rebook (unlike removal, which is one-time). It re-enters as its own line.
    const cart = rebookCartFromVisit(
      [{ id: 'mani' }, { id: 'pedi', addOnOf: 'mani' }],
      byId,
    );
    expect(cart.map(c => c.service.id)).toEqual(['mani', 'pedi']);
  });
});

describe('hasFutureAppointment', () => {
  const today = '2026-05-04';

  it('returns true when client has a non-cancelled future appt', () => {
    const appts = [{ clientId: 'c1', date: '2026-05-10', status: 'scheduled' }];
    expect(hasFutureAppointment(appts, 'c1', today)).toBe(true);
  });
  it('ignores cancelled future appts', () => {
    const appts = [{ clientId: 'c1', date: '2026-05-10', status: 'cancelled' }];
    expect(hasFutureAppointment(appts, 'c1', today)).toBe(false);
  });
  it('ignores past appts', () => {
    const appts = [{ clientId: 'c1', date: '2026-05-01', status: 'scheduled' }];
    expect(hasFutureAppointment(appts, 'c1', today)).toBe(false);
  });
  it('ignores appts for other clients', () => {
    const appts = [{ clientId: 'c2', date: '2026-05-10', status: 'scheduled' }];
    expect(hasFutureAppointment(appts, 'c1', today)).toBe(false);
  });
  it('returns false when clientId is missing (walk-in)', () => {
    expect(hasFutureAppointment([], null, today)).toBe(false);
    expect(hasFutureAppointment([], '', today)).toBe(false);
  });
  it('returns false for empty appts list', () => {
    expect(hasFutureAppointment([], 'c1', today)).toBe(false);
  });
});

describe('shouldShowRebookPrompt', () => {
  it('hides for walk-ins', () => {
    expect(shouldShowRebookPrompt({
      clientId: null, suggestedDate: '2026-06-01', futureAppts: [], fromDate: '2026-05-04',
    })).toBe(false);
  });
  it('hides when no rebook interval is set on any service', () => {
    expect(shouldShowRebookPrompt({
      clientId: 'c1', suggestedDate: null, futureAppts: [], fromDate: '2026-05-04',
    })).toBe(false);
  });
  it('hides when client already has a future appt', () => {
    expect(shouldShowRebookPrompt({
      clientId: 'c1', suggestedDate: '2026-06-01',
      futureAppts: [{ clientId: 'c1', date: '2026-05-20', status: 'scheduled' }],
      fromDate: '2026-05-04',
    })).toBe(false);
  });
  it('shows when all conditions are met', () => {
    expect(shouldShowRebookPrompt({
      clientId: 'c1', suggestedDate: '2026-06-01', futureAppts: [], fromDate: '2026-05-04',
    })).toBe(true);
  });
});
