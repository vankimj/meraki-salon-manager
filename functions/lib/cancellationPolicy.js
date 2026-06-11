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
  const pct = Number(stored.depositPct);
  return {
    enabled:        stored.enabled === true,
    thresholdCount: Number.isFinite(stored.thresholdCount) && stored.thresholdCount > 0
      ? Math.floor(stored.thresholdCount)
      : DEFAULT_POLICY.thresholdCount,
    windowDays:     Number.isFinite(stored.windowDays) && stored.windowDays > 0
      ? Math.floor(stored.windowDays)
      : DEFAULT_POLICY.windowDays,
    countNoShows:   stored.countNoShows !== false,
    depositMode:    stored.depositMode === 'charge' ? 'charge' : 'authorize',
    depositPct:     Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0,
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
    thresholdMet: false,
    depositMode: policy.depositMode,
    depositPct: policy.depositPct,
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
  out.thresholdMet = true;
  if (hasCard) {
    // No NEW card needed; the gate still places a deposit/hold on the existing
    // card when one is configured (thresholdMet + depositPct > 0).
    out.reason = 'threshold_met_card_on_file';
    return out;
  }
  out.required = true;
  out.reason = policy.depositPct > 0 ? 'cancellation_deposit' : 'threshold_met_no_card';
  return out;
}

// ── Booking-time card requirement (twin of src/lib/cancellationPolicy.js) ──
const DEPOSIT_MODES = Object.freeze(['store', 'authorize', 'charge']);

const DEFAULT_BOOKING_CARD_POLICY = Object.freeze({
  firstTimeRequireCard:   false,
  allBookingsRequireCard: false,
  depositMode:            'store',
  depositPct:             0,
});

function resolveBookingCardPolicy(settings) {
  const s = (settings && settings.bookingCardPolicy) || {};
  const pct = Number(s.depositPct);
  return {
    firstTimeRequireCard:   s.firstTimeRequireCard   === true,
    allBookingsRequireCard: s.allBookingsRequireCard === true,
    depositMode:            DEPOSIT_MODES.includes(s.depositMode) ? s.depositMode : 'store',
    depositPct:             Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0,
  };
}

function evaluateBookingCardRequirement(settings, ctx) {
  const p = resolveBookingCardPolicy(settings);
  const isFirstTime = ctx && ctx.isFirstTime === true;
  const hasCard     = ctx && ctx.hasCard === true;
  const triggered = p.allBookingsRequireCard || (p.firstTimeRequireCard && isFirstTime);
  return {
    triggered,
    required:    triggered && !hasCard,
    depositMode: p.depositMode,
    depositPct:  p.depositPct,
  };
}

function depositAmount(total, depositPct) {
  const t = Number(total) || 0;
  const pct = Number(depositPct) || 0;
  return Math.round(t * pct) / 100;
}

module.exports = {
  DEFAULT_POLICY,
  resolveCancellationPolicy,
  countRelevantCancellations,
  hasUsableCardOnFile,
  evaluateCancellationPolicy,
  DEPOSIT_MODES,
  DEFAULT_BOOKING_CARD_POLICY,
  resolveBookingCardPolicy,
  evaluateBookingCardRequirement,
  depositAmount,
};
