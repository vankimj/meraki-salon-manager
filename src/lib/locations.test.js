import { describe, it, expect, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./tenant', () => ({ TENANT_ID: 'test-tenant' }));

import {
  isMultiLocation, activeLocations, resolveLocation, locationTaxRate,
  setCurrentLocationId, subscribeCurrentLocation, DEFAULT_LOCATION_ID,
  appointmentInLocation,
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
