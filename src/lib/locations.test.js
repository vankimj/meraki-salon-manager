import { describe, it, expect, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./tenant', () => ({ TENANT_ID: 'test-tenant' }));

import {
  isMultiLocation, activeLocations, resolveLocation, locationTaxRate,
  setCurrentLocationId, subscribeCurrentLocation, DEFAULT_LOCATION_ID,
  appointmentInLocation, employeeInLocation, rosterDocId,
} from './locations';

const single = { list: [{ id: 'main', name: 'Main', isPrimary: true, active: true, taxRate: 7.5 }], defaultLocationId: 'main' };
const multi = {
  list: [
    { id: 'main', name: 'Downtown', isPrimary: true, active: true, taxRate: 7.5 },
    { id: 'north', name: 'Northside', active: true, taxRate: 8.0 },
    { id: 'old',   name: 'Closed One', active: false, taxRate: 9.0 },
  ],
  defaultLocationId: 'main',
};

describe('isMultiLocation', () => {
  it('false for a single active location', () => expect(isMultiLocation(single)).toBe(false));
  it('true for >1 active', () => expect(isMultiLocation(multi)).toBe(true));
  it('ignores inactive when counting', () =>
    expect(isMultiLocation({ list: [{ id: 'a', active: true }, { id: 'b', active: false }] })).toBe(false));
  it('false for empty/missing', () => { expect(isMultiLocation(null)).toBe(false); expect(isMultiLocation({ list: [] })).toBe(false); });
});

describe('activeLocations', () => {
  it('drops inactive and puts primary first', () => {
    const out = activeLocations(multi).map(l => l.id);
    expect(out).toEqual(['main', 'north']); // 'old' inactive dropped; primary first
  });
});

describe('resolveLocation', () => {
  it('finds by id', () => expect(resolveLocation(multi, 'north').name).toBe('Northside'));
  it('falls back to default when id missing', () => expect(resolveLocation(multi, 'nope').id).toBe('main'));
  it('falls back to first active when no default match', () =>
    expect(resolveLocation({ list: [{ id: 'x', active: true }] }, 'zzz').id).toBe('x'));
  it('returns null for empty', () => expect(resolveLocation({ list: [] }, 'a')).toBe(null));
});

describe('locationTaxRate', () => {
  it('uses the per-location rate when set', () => expect(locationTaxRate(multi, 'north', 5)).toBe(8.0));
  it('falls back to tenant rate when location has no override', () =>
    expect(locationTaxRate({ list: [{ id: 'a', active: true }] }, 'a', 6.25)).toBe(6.25));
  it('honors a 0 location rate (tax-free location) only if explicitly 0', () =>
    expect(locationTaxRate({ list: [{ id: 'a', active: true, taxRate: 0 }] }, 'a', 6.25)).toBe(0));
  it('falls back when location missing entirely', () => expect(locationTaxRate({ list: [] }, 'x', 7)).toBe(7));
  it('ignores a negative/garbage rate', () =>
    expect(locationTaxRate({ list: [{ id: 'a', active: true, taxRate: -3 }] }, 'a', 7)).toBe(7));
});

describe('appointmentInLocation', () => {
  it('matches same location', () => expect(appointmentInLocation({ locationId: 'north' }, 'north')).toBe(true));
  it('excludes a different location', () => expect(appointmentInLocation({ locationId: 'north' }, 'main')).toBe(false));
  it('untagged (legacy) appt shows at EVERY location', () => {
    expect(appointmentInLocation({}, 'main')).toBe(true);
    expect(appointmentInLocation({ locationId: '' }, 'north')).toBe(true);
    expect(appointmentInLocation(null, 'main')).toBe(true);
  });
});

describe('employeeInLocation', () => {
  it('matches when the location is in the employee list', () =>
    expect(employeeInLocation({ locationIds: ['main', 'north'] }, 'north')).toBe(true));
  it('excludes when not in the list', () =>
    expect(employeeInLocation({ locationIds: ['main'] }, 'north')).toBe(false));
  it('unassigned employee (no/empty locationIds) works EVERYWHERE', () => {
    expect(employeeInLocation({}, 'main')).toBe(true);
    expect(employeeInLocation({ locationIds: [] }, 'north')).toBe(true);
    expect(employeeInLocation(null, 'main')).toBe(true);
  });
});

describe('rosterDocId', () => {
  it('keeps the LEGACY date-only key for main / no location', () => {
    expect(rosterDocId('2026-06-15')).toBe('2026-06-15');
    expect(rosterDocId('2026-06-15', 'main')).toBe('2026-06-15');
    expect(rosterDocId('2026-06-15', DEFAULT_LOCATION_ID)).toBe('2026-06-15');
  });
  it('suffixes other locations so each site has its own daily rotation', () => {
    expect(rosterDocId('2026-06-15', 'north')).toBe('2026-06-15_north');
  });
  it('strips path-injection chars from the location segment (no extra path segments)', () => {
    expect(rosterDocId('2026-06-15', 'x/clients/VICTIM')).toBe('2026-06-15_xclientsVICTIM');
    expect(rosterDocId('2026-06-15', '../../evil')).toBe('2026-06-15_evil');
    expect(rosterDocId('2026-06-15', 12345)).toBe('2026-06-15'); // non-string → legacy key
  });
});

describe('current-location subscribers', () => {
  it('notifies on set and unsubscribes cleanly', () => {
    const seen = [];
    const off = subscribeCurrentLocation(id => seen.push(id));
    setCurrentLocationId('north');
    setCurrentLocationId('main');
    off();
    setCurrentLocationId('north'); // after unsubscribe — not seen
    expect(seen).toEqual(['north', 'main']);
  });
  it('coerces empty to the default id', () => {
    let last;
    const off = subscribeCurrentLocation(id => { last = id; });
    setCurrentLocationId('');
    off();
    expect(last).toBe(DEFAULT_LOCATION_ID);
  });
});
