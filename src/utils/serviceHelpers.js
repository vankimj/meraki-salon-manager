import { CATEGORY_ORDER } from '../data/seedServices';

// Accepts either a number or a service object. The object form is the
// safe path — legacy service docs use `price` instead of `basePrice`
// (renamed during the service-options schema change); falling through
// to that field stops "$undefined" from rendering on un-migrated docs.
export function formatPrice(basePriceOrSvc, priceFrom) {
  const isObj = basePriceOrSvc != null && typeof basePriceOrSvc === 'object';
  const base  = isObj ? (basePriceOrSvc.basePrice ?? basePriceOrSvc.price ?? 0) : (basePriceOrSvc ?? 0);
  const from  = isObj ? !!basePriceOrSvc.priceFrom : !!priceFrom;
  return from ? `$${base}+` : `$${base}`;
}

export function formatDuration(duration, durationMin) {
  return durationMin ? `${duration}+ min` : `${duration} min`;
}

export function groupByCategory(services) {
  const map = {};
  for (const svc of services) {
    if (!map[svc.category]) map[svc.category] = [];
    map[svc.category].push(svc);
  }
  // Sort categories by canonical order, unknown categories appended alphabetically
  const known   = CATEGORY_ORDER.filter(c => map[c]);
  const unknown = Object.keys(map).filter(c => !CATEGORY_ORDER.includes(c)).sort();
  return [...known, ...unknown].map(cat => ({ category: cat, services: map[cat] }));
}

export function validateService(data) {
  const errors = {};
  if (!data.name?.trim())               errors.name     = 'Name is required';
  if (!data.category?.trim())           errors.category = 'Category is required';
  if (data.basePrice == null || data.basePrice < 0) errors.basePrice = 'Price must be 0 or more';
  if (!data.duration || data.duration < 1)          errors.duration  = 'Duration must be at least 1 min';
  return { valid: Object.keys(errors).length === 0, errors };
}

export function blankService() {
  return { name: '', category: 'Manicures', basePrice: 0, priceFrom: true, duration: 30, durationMin: false, description: '', image: '', active: true, taxable: true, sortOrder: 99, options: [], defaultRebookWeeks: 0 };
}

// Per-tech duration override: a slower (e.g. newer) tech can need more time
// for the same service. `tech.serviceDurations[svcId]` (minutes) replaces the
// service's base duration when set to a positive number; unset = base.
export function techServiceDuration(svc, tech) {
  const v = tech?.serviceDurations?.[svc?.id];
  return (typeof v === 'number' && v > 0) ? v : (svc?.duration ?? 0);
}

// Resolve effective price + duration for a service given an optional selected
// option and an optional performing tech. Options can override (price,
// duration) or just adjust (priceAdd, durationAdd) the base; the per-tech
// override sets the base duration before options apply.
export function resolveServicePricing(svc, opt, tech) {
  // Legacy services stored `price` instead of `basePrice` — fall through
  // so booking + checkout don't display $0 / NaN on un-migrated docs.
  const svcBase = svc?.basePrice ?? svc?.price ?? 0;
  const durBase = techServiceDuration(svc, tech);
  if (!opt) return { price: svcBase, duration: durBase };
  const price    = opt.price    != null ? Number(opt.price)    : svcBase + Number(opt.priceAdd    || 0);
  const duration = opt.duration != null ? Number(opt.duration) : durBase + Number(opt.durationAdd || 0);
  return { price, duration };
}

// Re-resolve the duration of each already-chosen service for the performing
// tech. Booking flows that build a service list from base durations (voice
// command, walk-in seating) call this once the tech is known so a slower
// tech's per-service override applies. Services whose name isn't found in
// `allServices` are passed through unchanged.
export function resolveBookedDurations(chosen, allServices, tech) {
  return (chosen || []).map(sv => {
    const svc = (allServices || []).find(s => s.name === sv.name);
    return svc ? { ...sv, duration: resolveServicePricing(svc, null, tech).duration } : sv;
  });
}
