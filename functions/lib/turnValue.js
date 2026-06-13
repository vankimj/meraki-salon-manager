// CommonJS twin of src/lib/turnValue.js — keep in sync. Used by the
// creditTurnsOnReceipt Cloud Function trigger to value a checked-out ticket in
// 'value' (Mango) mode.

const DEFAULT_TURN_VALUE = 1;
const TURN_MODES = ['count', 'value'];

function resolveTurnMode(settings) {
  return settings && settings.walkinTurnMode === 'value' ? 'value' : 'count';
}

function resolveTurnValue(service) {
  if (!service || service.turnValue == null) return DEFAULT_TURN_VALUE;
  const v = Number(service.turnValue);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_TURN_VALUE;
}

function sumTurnValue(services) {
  if (!Array.isArray(services)) return 0;
  return services.reduce((acc, s) => acc + resolveTurnValue(s), 0);
}

function buildTurnValueMap(services) {
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

function turnValueForLineName(name, valueMap) {
  if (!name) return DEFAULT_TURN_VALUE;
  const key = String(name).trim().toLowerCase();
  if (valueMap[key] != null) return valueMap[key];
  const base = key.split(' — ')[0];
  if (valueMap[base] != null) return valueMap[base];
  return DEFAULT_TURN_VALUE;
}

module.exports = {
  DEFAULT_TURN_VALUE,
  TURN_MODES,
  resolveTurnMode,
  resolveTurnValue,
  sumTurnValue,
  buildTurnValueMap,
  turnValueForLineName,
};
