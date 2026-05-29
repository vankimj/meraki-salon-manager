// Pure helpers shared by the online booking flow + admin scheduler.
// Extracted from BookingScreen so they can be unit-tested without rendering.
import { resolveServicePricing } from '../utils/serviceHelpers';

export const BOOKING_START = 9 * 60;   // 9:00 — salon-wide window
export const BOOKING_END   = 20 * 60;  // 20:00
export const SLOT_STEP     = 30;       // minutes between candidate start slots

// "HH:MM" → total minutes since midnight.
export function strToMins(str) {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

// Empty/missing serviceIds means "can do all" (back-compat default).
export function techCanDo(tech, serviceId) {
  if (!tech.serviceIds || tech.serviceIds.length === 0) return true;
  return tech.serviceIds.includes(serviceId);
}

export function techsForService(techs, service) {
  if (!service) return techs;
  return techs.filter(t => techCanDo(t, service.id));
}

// Intersection: only techs who can perform every selected service.
export function techsForServices(techs, services) {
  if (!services?.length) return techs;
  return techs.filter(t => services.every(s => techCanDo(t, s.id)));
}

// Sums service durations + per-item removal time for a multi-service cart.
// Pass `tech` to honor that tech's per-service duration overrides.
export function cartTotalDuration(cart, removalDur = 15, tech) {
  return cart.reduce((s, item) => {
    const d = resolveServicePricing(item.service, item.option, tech).duration || 60;
    return s + d + (item.removal ? removalDur : 0);
  }, 0);
}

// True iff the tech has no overlapping appointment for the given window.
export function isTechFreeAt(tech, slotMins, durationMins, appts) {
  const relevant = appts.filter(a => a.techId === tech.id || a.techName === tech.name);
  const end = slotMins + durationMins;
  return !relevant.some(a => {
    const aStart = strToMins(a.startTime);
    const aDur = (a.services || []).reduce((s, sv) => s + (Number(sv.duration) || 0), 0) || (a.duration || 60);
    return aStart < end && (aStart + aDur) > slotMins;
  });
}

export function firstFreeTech(techs, slotMins, durationMins, appts) {
  return techs.find(t => isTechFreeAt(t, slotMins, durationMins, appts)) || null;
}

// All candidate start slots in the booking window that fit `dur` minutes.
export function getSlots(dur) {
  const slots = [];
  for (let m = BOOKING_START; m + dur <= BOOKING_END; m += SLOT_STEP) slots.push(m);
  return slots;
}
