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
  depositMode:    'authorize',  // 'authorize' (card hold) | 'charge' (upfront)
  depositPct:     0,            // 0 = card-on-file only (no deposit/hold)
});

// Merge stored policy with defaults so callers can rely on every field
// being present even when the tenant has only set some of them.
export function resolveCancellationPolicy(settings) {
  const stored = settings?.cancellationPolicy || {};
  const pct = Number(stored.depositPct);
  return {
    enabled:        stored.enabled === true,
    thresholdCount: Number.isFinite(stored.thresholdCount) && stored.thresholdCount > 0
      ? Math.floor(stored.thresholdCount)
      : DEFAULT_POLICY.thresholdCount,
    windowDays:     Number.isFinite(stored.windowDays) && stored.windowDays > 0
      ? Math.floor(stored.windowDays)
      : DEFAULT_POLICY.windowDays,
    countNoShows:   stored.countNoShows !== false,  // default true unless explicitly disabled
    depositMode:    stored.depositMode === 'charge' ? 'charge' : 'authorize',
    depositPct:     Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0,
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
    thresholdMet:      false,
    depositMode:       policy.depositMode,
    depositPct:        policy.depositPct,
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

  // Threshold met.
  out.thresholdMet = true;
  const depositLabel = policy.depositPct > 0
    ? `a ${policy.depositPct}% ${policy.depositMode === 'charge' ? 'deposit' : 'card hold'}`
    : 'a card on file';

  // Already has a card — no NEW card must be collected. The gate still places a
  // deposit/hold on the existing card when one is configured (thresholdMet +
  // depositPct), so a repeat no-show pays even with a card on file.
  if (hasCard) {
    out.required = false;
    out.reason   = 'threshold_met_card_on_file';
    out.message  = `${cancellationCount} cancellations in the last ${policy.windowDays} days; a card is on file${policy.depositPct > 0 ? ` and ${depositLabel} applies` : ''}.`;
    return out;
  }

  // Threshold met, no card → must collect one (and place the deposit/hold if configured).
  out.required = true;
  out.reason   = policy.depositPct > 0 ? 'cancellation_deposit' : 'threshold_met_no_card';
  out.message  = `${cancellationCount} cancellations in the last ${policy.windowDays} days. ${depositLabel.charAt(0).toUpperCase() + depositLabel.slice(1)} is required before booking again.`;
  return out;
}

// ── Booking-time card requirement ──────────────────────────────────────────
// Independent of the cancellation-history policy above. Lets a tenant require
// a card on file at booking time for:
//   - first-time clients only, and/or
//   - every online booking.
// The configured percentage is the deposit amount, interpreted per depositMode:
//   'store'     — save the card only; charge depositPct% of the total ONLY on a
//                 late-cancel / no-show (default; nothing charged at booking).
//   'authorize' — place a Stripe auth hold for depositPct% at booking; capture
//                 on no-show, release otherwise.
//   'charge'    — charge depositPct% as a deposit at booking, credited at checkout.
//
// Schema on tenants/{tid}/data/settings:
//   bookingCardPolicy: {
//     firstTimeRequireCard:   false,
//     allBookingsRequireCard: false,
//     depositMode:            'store' | 'authorize' | 'charge',
//     depositPct:             0,        // 0–100
//   }
export const DEPOSIT_MODES = Object.freeze(['store', 'authorize', 'charge']);

export const DEFAULT_BOOKING_CARD_POLICY = Object.freeze({
  firstTimeRequireCard:   false,
  allBookingsRequireCard: false,
  depositMode:            'store',
  depositPct:             0,
  // Group bookings (2+ people) can require a card / hold / deposit independently.
  groupRequireCard:       false,
  groupDepositMode:       'store',
  groupDepositPct:        0,
});

export function resolveBookingCardPolicy(settings) {
  const s = settings?.bookingCardPolicy || {};
  const pct = Number(s.depositPct);
  const gpct = Number(s.groupDepositPct);
  return {
    firstTimeRequireCard:   s.firstTimeRequireCard   === true,
    allBookingsRequireCard: s.allBookingsRequireCard === true,
    depositMode:            DEPOSIT_MODES.includes(s.depositMode) ? s.depositMode : 'store',
    depositPct:             Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0,
    groupRequireCard:       s.groupRequireCard === true,
    groupDepositMode:       DEPOSIT_MODES.includes(s.groupDepositMode) ? s.groupDepositMode : 'store',
    groupDepositPct:        Number.isFinite(gpct) ? Math.min(100, Math.max(0, gpct)) : 0,
  };
}

// Decide whether a card must be collected for THIS booking.
//   ctx = { isFirstTime: boolean, hasCard: boolean, isGroup: boolean }
// Returns { triggered, required, depositMode, depositPct }.
//   triggered — the policy applies to this booking
//   required  — a card must be collected now (triggered AND no card on file)
// When multiple rules fire, the STRONGEST deposit (highest %, non-store) wins.
export function evaluateBookingCardRequirement(settings, ctx = {}) {
  const p = resolveBookingCardPolicy(settings);
  const isFirstTime = ctx.isFirstTime === true;
  const hasCard     = ctx.hasCard === true;
  const isGroup     = ctx.isGroup === true;
  const bookingTrig = p.allBookingsRequireCard || (p.firstTimeRequireCard && isFirstTime);
  const groupTrig   = isGroup && p.groupRequireCard;
  const triggered   = bookingTrig || groupTrig;

  // When multiple rules fire, the STRONGEST deposit wins: charge > authorize >
  // store (more money secured at booking time), and within the same mode the
  // higher percentage. Note `store` still carries its percentage — it's the
  // amount charged later on a no-show.
  const RANK = { store: 0, authorize: 1, charge: 2 };
  let depositMode = 'store', depositPct = 0;
  const consider = (mode, pct) => {
    if (RANK[mode] > RANK[depositMode] || (RANK[mode] === RANK[depositMode] && pct > depositPct)) {
      depositMode = mode; depositPct = pct;
    }
  };
  if (bookingTrig) consider(p.depositMode, p.depositPct);
  if (groupTrig)   consider(p.groupDepositMode, p.groupDepositPct);

  return {
    triggered,
    required:    triggered && !hasCard,
    depositMode,
    depositPct,
  };
}

// Dollar amount of the deposit for a given appointment total, rounded to cents.
export function depositAmount(total, depositPct) {
  const t = Number(total) || 0;
  const pct = Number(depositPct) || 0;
  return Math.round(t * pct) / 100;
}
