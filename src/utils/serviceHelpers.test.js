import { describe, it, expect } from 'vitest';
import { formatPrice, formatDuration, groupByCategory, validateService, blankService, resolveServicePricing, techServiceDuration, techServicePrice, resolveBookedDurations } from './serviceHelpers';

describe('formatPrice', () => {
  it('shows + for priceFrom=true',  () => expect(formatPrice(70, true)).toBe('$70+'));
  it('shows exact for priceFrom=false', () => expect(formatPrice(25, false)).toBe('$25'));
  it('handles zero price',          () => expect(formatPrice(0, false)).toBe('$0'));
  it('handles starting from zero',  () => expect(formatPrice(0, true)).toBe('$0+'));
});

describe('formatDuration', () => {
  it('shows + for durationMin=true',  () => expect(formatDuration(60, true)).toBe('60+ min'));
  it('shows exact for durationMin=false', () => expect(formatDuration(30, false)).toBe('30 min'));
  it('handles 1 minute',             () => expect(formatDuration(1, false)).toBe('1 min'));
});

describe('groupByCategory', () => {
  const services = [
    { name: 'Gel-X',        category: 'Manicures', sortOrder: 0 },
    { name: 'Spa Pedicure', category: 'Pedicures', sortOrder: 0 },
    { name: 'Dip',          category: 'Add-ons',   sortOrder: 0 },
    { name: 'Wax',          category: 'Waxing',    sortOrder: 0 },
  ];

  it('returns groups in canonical order with unknowns last', () => {
    const groups = groupByCategory(services);
    expect(groups.map(g => g.category)).toEqual(['Manicures', 'Pedicures', 'Add-ons', 'Waxing']);
  });

  it('each group contains the right services', () => {
    const groups = groupByCategory(services);
    expect(groups[0].services[0].name).toBe('Gel-X');
    expect(groups[1].services[0].name).toBe('Spa Pedicure');
  });

  it('returns empty array for empty input', () => {
    expect(groupByCategory([])).toEqual([]);
  });

  it('handles single category', () => {
    const result = groupByCategory([{ name: 'A', category: 'Manicures', sortOrder: 0 }]);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('Manicures');
  });
});

describe('validateService', () => {
  const valid = { name: 'Gel-X', category: 'Manicures', basePrice: 70, duration: 60 };

  it('passes a valid service',              () => expect(validateService(valid).valid).toBe(true));
  it('fails when name is empty',            () => expect(validateService({ ...valid, name: '' }).valid).toBe(false));
  it('fails when category is empty',        () => expect(validateService({ ...valid, category: '' }).valid).toBe(false));
  it('fails when price is negative',        () => expect(validateService({ ...valid, basePrice: -1 }).valid).toBe(false));
  it('fails when duration is zero',         () => expect(validateService({ ...valid, duration: 0 }).valid).toBe(false));
  it('returns error keys for each failure', () => {
    const { errors } = validateService({ name: '', category: '', basePrice: -1, duration: 0 });
    expect(Object.keys(errors)).toEqual(expect.arrayContaining(['name', 'category', 'basePrice', 'duration']));
  });
  it('allows price of zero',                () => expect(validateService({ ...valid, basePrice: 0 }).valid).toBe(true));
});

describe('blankService', () => {
  it('returns an object with all required fields', () => {
    const s = blankService();
    expect(s.name).toBe('');
    expect(s.category).toBe('Manicures');
    expect(s.active).toBe(true);
    expect(typeof s.basePrice).toBe('number');
    expect(typeof s.duration).toBe('number');
  });
});

describe('techServiceDuration', () => {
  const svc = { id: 'gel', duration: 60 };
  it('falls back to service duration when no tech', () => expect(techServiceDuration(svc, null)).toBe(60));
  it('falls back when tech has no overrides', () => expect(techServiceDuration(svc, { name: 'A' })).toBe(60));
  it('falls back when tech has no override for this service', () =>
    expect(techServiceDuration(svc, { serviceDurations: { other: 90 } })).toBe(60));
  it('uses the tech override when set', () =>
    expect(techServiceDuration(svc, { serviceDurations: { gel: 75 } })).toBe(75));
  it('ignores a zero or negative override', () => {
    expect(techServiceDuration(svc, { serviceDurations: { gel: 0 } })).toBe(60);
    expect(techServiceDuration(svc, { serviceDurations: { gel: -10 } })).toBe(60);
  });
  it('returns 0 when neither service nor tech has a duration', () =>
    expect(techServiceDuration({ id: 'x' }, null)).toBe(0));
});

describe('techServicePrice', () => {
  const svc = { id: 'gel', basePrice: 50 };
  it('falls back to base price when no tech', () => expect(techServicePrice(svc, null)).toBe(50));
  it('falls back when tech has no overrides', () => expect(techServicePrice(svc, { name: 'A' })).toBe(50));
  it('falls back when tech has no override for this service', () =>
    expect(techServicePrice(svc, { servicePrices: { other: 80 } })).toBe(50));
  it('uses the tech override when set (senior tech charges more)', () =>
    expect(techServicePrice(svc, { servicePrices: { gel: 65 } })).toBe(65));
  it('honors a $0 override (comped/free)', () =>
    expect(techServicePrice(svc, { servicePrices: { gel: 0 } })).toBe(0));
  it('ignores a negative override', () =>
    expect(techServicePrice(svc, { servicePrices: { gel: -5 } })).toBe(50));
  it('reads legacy price field when no basePrice', () =>
    expect(techServicePrice({ id: 'x', price: 32 }, null)).toBe(32));
});

describe('resolveServicePricing with per-tech price', () => {
  const svc = { id: 'gel', basePrice: 50, duration: 60 };
  const seniorTech = { servicePrices: { gel: 65 } };

  it('uses base price when no tech', () =>
    expect(resolveServicePricing(svc, null).price).toBe(50));
  it('applies the tech price override as the base', () =>
    expect(resolveServicePricing(svc, null, seniorTech).price).toBe(65));
  it('adds priceAdd on top of the tech override', () => {
    const opt = { id: 'len', priceAdd: 10 };
    expect(resolveServicePricing(svc, opt, seniorTech).price).toBe(75); // 65 + 10
  });
  it('an absolute option price still wins over the tech override', () => {
    const opt = { id: 'fixed', price: 90 };
    expect(resolveServicePricing(svc, opt, seniorTech).price).toBe(90);
  });
  it('combines per-tech price and per-tech duration overrides', () => {
    const tech = { servicePrices: { gel: 65 }, serviceDurations: { gel: 75 } };
    const r = resolveServicePricing(svc, null, tech);
    expect(r).toEqual({ price: 65, duration: 75 });
  });
});

describe('resolveServicePricing with per-tech duration', () => {
  const svc = { id: 'gel', basePrice: 70, duration: 60 };
  const slowTech = { serviceDurations: { gel: 75 } };

  it('uses base duration when no tech', () =>
    expect(resolveServicePricing(svc, null).duration).toBe(60));
  it('applies the tech override as the base duration', () =>
    expect(resolveServicePricing(svc, null, slowTech).duration).toBe(75));
  it('keeps price unaffected by the duration override', () =>
    expect(resolveServicePricing(svc, null, slowTech).price).toBe(70));
  it('adds durationAdd on top of the tech override', () => {
    const opt = { id: 'len', durationAdd: 15 };
    expect(resolveServicePricing(svc, opt, slowTech).duration).toBe(90); // 75 + 15
  });
  it('an absolute option duration still wins over the tech override', () => {
    const opt = { id: 'fixed', duration: 100 };
    expect(resolveServicePricing(svc, opt, slowTech).duration).toBe(100);
  });
});

describe('resolveBookedDurations', () => {
  const allServices = [
    { id: 'gel',  name: 'Gel Manicure', basePrice: 70, duration: 60 },
    { id: 'pedi', name: 'Spa Pedicure', basePrice: 55, duration: 45 },
  ];
  const slowTech = { name: 'Ana', serviceDurations: { gel: 75 } };

  it('applies the per-tech override to a matched service', () => {
    const out = resolveBookedDurations([{ name: 'Gel Manicure', duration: 60, price: 70 }], allServices, slowTech);
    expect(out[0].duration).toBe(75);
  });
  it('keeps base duration for services the tech has no override for', () => {
    const out = resolveBookedDurations([{ name: 'Spa Pedicure', duration: 45, price: 55 }], allServices, slowTech);
    expect(out[0].duration).toBe(45);
  });
  it('uses base duration when no tech is supplied', () => {
    const out = resolveBookedDurations([{ name: 'Gel Manicure', duration: 60 }], allServices, null);
    expect(out[0].duration).toBe(60);
  });
  it('passes through a service whose name is not in the catalog', () => {
    const custom = { name: 'Custom thing', duration: 30, price: 20 };
    expect(resolveBookedDurations([custom], allServices, slowTech)).toEqual([custom]);
  });
  it('preserves other fields (price, name) while updating duration', () => {
    const out = resolveBookedDurations([{ name: 'Gel Manicure', duration: 60, price: 70 }], allServices, slowTech);
    expect(out[0]).toEqual({ name: 'Gel Manicure', duration: 75, price: 70 });
  });
  it('resolves each item in a multi-service list independently', () => {
    const out = resolveBookedDurations(
      [{ name: 'Gel Manicure', duration: 60 }, { name: 'Spa Pedicure', duration: 45 }],
      allServices, slowTech,
    );
    expect(out.map(s => s.duration)).toEqual([75, 45]);
  });
  it('handles empty/missing input', () => {
    expect(resolveBookedDurations([], allServices, slowTech)).toEqual([]);
    expect(resolveBookedDurations(undefined, allServices, slowTech)).toEqual([]);
  });
});
