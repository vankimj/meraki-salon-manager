// CommonJS twin of src/lib/cancellationPolicy.js for use inside Cloud
// Functions. Keep the two files in sync — they share the same threshold +
// override semantics so server-side enforcement matches what the admin UI
// preview shows.

const DEFAULT_POLICY = Object.freeze({
  enabled:        false,
  thresholdCount: 3,
  windowDays:     90,
  countNoShows:   true,
});

function resolveCancellationPolicy(settings) {
  const stored = (settings && settings.cancellationPolicy) || {};
  return {
    enabled:        stored.enabled === true,
    thresholdCount: Number.isFinite(stored.thresholdCount) && stored.thresholdCount > 0
      ? Math.floor(stored.thresholdCount)
      : DEFAULT_POLICY.thresholdCount,
    windowDays:     Number.isFinite(stored.windowDays) && stored.windowDays > 0
      ? Math.floor(stored.windowDays)
      : DEFAULT_POLICY.windowDays,
    countNoShows:   stored.countNoShows !== false,
  };
}

function countRelevantCancellations(appointments, policy, now) {
  if (!Array.isArray(appointments)) return [];
  const _now = now || Date.now();
  const cutoff = _now - policy.windowDays * 24 * 60 * 60 * 1000;
  return appointments.filter(a => {
    if (!a) return false;
    const isCancel = a.status === 'cancelled' && a.cancelledBy !== 'salon';
    const isNoShow = a.status === 'no_show' && policy.countNoShows;
    if (!isCancel && !isNoShow) return false;
    const t = a.cancelledAt || a.date;
    if (!t) return false;
    const ms = new Date(t).getTime();
    if (!Number.isFinite(ms)) return false;
    return ms >= cutoff;
  });
}

function hasUsableCardOnFile(client, now) {
  const pms = client && client.paymentMethods;
  if (!Array.isArray(pms) || pms.length === 0) return false;
  const d = new Date(now || Date.now());
  const nowYear  = d.getUTCFullYear();
  const nowMonth = d.getUTCMonth() + 1;
  return pms.some(pm => {
    if (!pm || !pm.id) return false;
    const y = Number(pm.expYear), m = Number(pm.expMonth);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return true;
    return y > nowYear || (y === nowYear && m >= nowMonth);
  });
}

function evaluateCancellationPolicy(appointments, settings, client, now) {
  const policy = resolveCancellationPolicy(settings);
  const hasCard = hasUsableCardOnFile(client, now);
  const cancels = countRelevantCancellations(appointments, policy, now);
  const cancellationCount = cancels.length;

  const out = {
    required: false,
    reason: 'ok',
    cancellationCount,
    thresholdCount: policy.thresholdCount,
    windowDays: policy.windowDays,
    hasCard,
    overrideApplied: null,
  };

  if (client && client.cardRequiredOverride === true) {
    out.overrideApplied = 'force';
    out.required = !hasCard;
    out.reason   = hasCard ? 'override_force_satisfied' : 'override_force';
    return out;
  }
  if (client && client.cardRequiredOverride === false) {
    out.overrideApplied = 'exempt';
    out.reason = 'override_exempt';
    return out;
  }
  if (!policy.enabled) {
    out.reason = 'policy_disabled';
    return out;
  }
  if (cancellationCount < policy.thresholdCount) {
    out.reason = 'under_threshold';
    return out;
  }
  if (hasCard) {
    out.reason = 'threshold_met_card_on_file';
    return out;
  }
  out.required = true;
  out.reason = 'threshold_met_no_card';
  return out;
}

module.exports = {
  DEFAULT_POLICY,
  resolveCancellationPolicy,
  countRelevantCancellations,
  hasUsableCardOnFile,
  evaluateCancellationPolicy,
};
