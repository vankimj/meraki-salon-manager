// Cancellation-history policy: after N cancellations in M days, require a
// card on file before the client can book again. Tenant-configurable.
//
// Schema on tenants/{tid}/data/settings:
//   cancellationPolicy: {
//     enabled: false,           // opt-in; default off
//     thresholdCount: 3,        // # of recent cancels that triggers the gate
//     windowDays: 90,           // sliding window (in days) for counting
//     countNoShows: true,       // also count `no_show` status as a cancel
//   }
//
// Schema on tenants/{tid}/clients/{cid}:
//   cardRequiredOverride: true | false | undefined
//     true      — explicit override: ALWAYS require a card (admin escalation)
//     false     — explicit override: NEVER require a card (admin trust pass)
//     undefined — use policy
//   cardRequiredOverrideReason: string (audit / display)
//
// What counts as a "client-caused cancellation":
//   - status === 'cancelled' AND cancelledBy !== 'salon'
//     (cancellations the salon initiated — tech called in sick, weather, etc. —
//      should never punish the client. cancelledBy is set on new cancels;
//      legacy rows without it are conservatively counted, which is fine because
//      admins can grant a per-client override.)
//   - status === 'no_show' (always counts, regardless of cancelledBy)
//
// A client who already has a saved card on file passes the gate automatically
// — the policy is "require a card", and they have one.

export const DEFAULT_POLICY = Object.freeze({
  enabled:        false,
  thresholdCount: 3,
  windowDays:     90,
  countNoShows:   true,
});

// Merge stored policy with defaults so callers can rely on every field
// being present even when the tenant has only set some of them.
export function resolveCancellationPolicy(settings) {
  const stored = settings?.cancellationPolicy || {};
  return {
    enabled:        stored.enabled === true,
    thresholdCount: Number.isFinite(stored.thresholdCount) && stored.thresholdCount > 0
      ? Math.floor(stored.thresholdCount)
      : DEFAULT_POLICY.thresholdCount,
    windowDays:     Number.isFinite(stored.windowDays) && stored.windowDays > 0
      ? Math.floor(stored.windowDays)
      : DEFAULT_POLICY.windowDays,
    countNoShows:   stored.countNoShows !== false,  // default true unless explicitly disabled
  };
}

// Return the cancellation/no-show appointments from `appointments` that fall
// within the policy window and are attributed to the CLIENT (not the salon).
// Pure — no I/O, no clock dependency beyond `now`.
export function countRelevantCancellations(appointments, policy, now = Date.now()) {
  if (!Array.isArray(appointments)) return [];
  const cutoff = now - policy.windowDays * 24 * 60 * 60 * 1000;
  return appointments.filter(a => {
    if (!a) return false;
    const isCancel  = a.status === 'cancelled' && a.cancelledBy !== 'salon';
    const isNoShow  = a.status === 'no_show' && policy.countNoShows;
    if (!isCancel && !isNoShow) return false;
    // Prefer cancelledAt (precise event time); fall back to the appointment
    // date (legacy rows). Either way, must be within window.
    const t = a.cancelledAt || a.date;
    if (!t) return false;
    const ms = new Date(t).getTime();
    if (!Number.isFinite(ms)) return false;
    return ms >= cutoff;
  });
}

// True iff the client has at least one usable PaymentMethod on file (any
// non-expired card). This is what the policy is gating on — "do they have
// a card or do we need to collect one."
export function hasUsableCardOnFile(client, now = Date.now()) {
  const pms = client?.paymentMethods;
  if (!Array.isArray(pms) || pms.length === 0) return false;
  const d = new Date(now);
  const nowYear  = d.getUTCFullYear();
  const nowMonth = d.getUTCMonth() + 1;   // 1-12 to match Stripe's exp_month
  return pms.some(pm => {
    if (!pm || !pm.id) return false;
    const y = Number(pm.expYear), m = Number(pm.expMonth);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return true;  // assume usable if unknown
    return y > nowYear || (y === nowYear && m >= nowMonth);
  });
}

// Main policy evaluator. Returns a structured verdict + supporting numbers
// so the UI can render either a "OK to book" badge or a "card required"
// blocking message with explanation.
//
// Return shape:
//   {
//     required:        boolean   — gate result
//     reason:          string    — short machine-readable code
//     message:         string    — human-readable explanation for UI
//     policyEnabled:   boolean
//     thresholdCount:  number
//     windowDays:      number
//     cancellationCount: number  — # of countable cancels in window
//     hasCard:         boolean
//     overrideApplied: 'force' | 'exempt' | null
//   }
export function evaluateCancellationPolicy(appointments, settings, client, now = Date.now()) {
  const policy = resolveCancellationPolicy(settings);
  const hasCard = hasUsableCardOnFile(client, now);
  const cancels = countRelevantCancellations(appointments, policy, now);
  const cancellationCount = cancels.length;

  const out = {
    required:          false,
    reason:            'ok',
    message:           '',
    policyEnabled:     policy.enabled,
    thresholdCount:    policy.thresholdCount,
    windowDays:        policy.windowDays,
    cancellationCount,
    hasCard,
    overrideApplied:   null,
  };

  // Explicit admin force-on
  if (client?.cardRequiredOverride === true) {
    out.overrideApplied = 'force';
    if (hasCard) {
      out.required = false;
      out.reason   = 'override_force_satisfied';
      out.message  = 'Card-required override is set, and this client already has a card on file.';
    } else {
      out.required = true;
      out.reason   = 'override_force';
      out.message  = `Admin has marked this client as card-required${client?.cardRequiredOverrideReason ? `: "${client.cardRequiredOverrideReason}"` : ''}.`;
    }
    return out;
  }

  // Explicit admin trust pass
  if (client?.cardRequiredOverride === false) {
    out.overrideApplied = 'exempt';
    out.required = false;
    out.reason   = 'override_exempt';
    out.message  = `Admin has exempted this client from the card-required policy${client?.cardRequiredOverrideReason ? `: "${client.cardRequiredOverrideReason}"` : ''}.`;
    return out;
  }

  // Policy disabled at the tenant level
  if (!policy.enabled) {
    out.required = false;
    out.reason   = 'policy_disabled';
    out.message  = 'Cancellation-history policy is disabled for this tenant.';
    return out;
  }

  // Under threshold
  if (cancellationCount < policy.thresholdCount) {
    out.required = false;
    out.reason   = 'under_threshold';
    out.message  = `${cancellationCount} cancellation${cancellationCount === 1 ? '' : 's'} in the last ${policy.windowDays} days (threshold: ${policy.thresholdCount}).`;
    return out;
  }

  // Threshold met but they already have a card — gate passes
  if (hasCard) {
    out.required = false;
    out.reason   = 'threshold_met_card_on_file';
    out.message  = `${cancellationCount} cancellations in the last ${policy.windowDays} days, but a card is already on file.`;
    return out;
  }

  // Threshold met, no card → gate
  out.required = true;
  out.reason   = 'threshold_met_no_card';
  out.message  = `${cancellationCount} cancellations in the last ${policy.windowDays} days. A card on file is required before booking again.`;
  return out;
}
