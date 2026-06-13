// Value-weighted turn rotation (Mango-style). Each service carries a `turnValue`
// (points). When the rotation is in 'value' mode, a tech's turn count is
// credited the summed turnValue of the services on a checked-out ticket, instead
// of a flat +1. Whoever has the lowest accumulated value is "next up".
//
// A service with no turnValue set counts as DEFAULT_TURN_VALUE (1.0), so turning
// the feature on without configuring every service behaves exactly like the old
// headcount system until the owner tunes values.

export const DEFAULT_TURN_VALUE = 1;

export const TURN_MODES = ['count', 'value'];

// The rotation mode for the tenant. 'count' = legacy flat +1 per ticket.
// 'value' = sum of per-service turnValue, credited at checkout.
export function resolveTurnMode(settings) {
  return settings && settings.walkinTurnMode === 'value' ? 'value' : 'count';
}

// One service's turn value — its configured turnValue, else the default.
export function resolveTurnValue(service) {
  if (!service || service.turnValue == null) return DEFAULT_TURN_VALUE;
  const v = Number(service.turnValue);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_TURN_VALUE;
}

// Sum the turn value of a list of service-ish objects (anything with turnValue).
export function sumTurnValue(services) {
  if (!Array.isArray(services)) return 0;
  return services.reduce((acc, s) => acc + resolveTurnValue(s), 0);
}

// Build a name → turnValue map from the services collection, so a checked-out
// receipt (whose lines carry service NAMES, not ids) can be valued. Includes the
// base name AND each option-inclusive name ("Gel Manicure — Long") so option
// lines resolve too; unmatched lines fall back to DEFAULT_TURN_VALUE downstream.
export function buildTurnValueMap(services) {
  const map = {};
  (Array.isArray(services) ? services : []).forEach(s => {
    if (!s || !s.name) return;
    const tv = resolveTurnValue(s);
    const base = String(s.name).trim().toLowerCase();
    map[base] = tv;
    (s.options || []).forEach(o => {
      if (o && o.name) map[`${base} — ${String(o.name).trim().toLowerCase()}`] = tv;
    });
  });
  return map;
}

// Value a single receipt line by its name against the map (fallback = default).
export function turnValueForLineName(name, valueMap) {
  if (!name) return DEFAULT_TURN_VALUE;
  const key = String(name).trim().toLowerCase();
  if (valueMap[key] != null) return valueMap[key];
  // "Gel Manicure — Long" → try the base "gel manicure"
  const base = key.split(' — ')[0];
  if (valueMap[base] != null) return valueMap[base];
  return DEFAULT_TURN_VALUE;
}
