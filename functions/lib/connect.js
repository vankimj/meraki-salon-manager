// Stripe Connect helpers — Express + Standard support side by side.
// Pure functions so unit tests can run without spinning up firebase-functions.
//
// Architecture: two onboarding paths sharing one downstream charge code.
//   Express:  Plume programmatically creates the account, sends salon to
//             a Stripe-hosted form; no stripe.com login for the salon.
//   Standard: Salon authorises Plume via OAuth at stripe.com; salon keeps
//             their own Stripe login + full Stripe Dashboard.
// Both end with a Stripe Connected Account ID (acct_xxx) on the tenant
// doc, which chargeStoredCard already uses via on_behalf_of +
// transfer_data.destination.

const crypto = require('crypto');

const ACCOUNT_TYPES = ['express', 'standard'];

// Generate an HMAC-signed OAuth state parameter for the Standard
// Connect OAuth dance. Stripe round-trips this; verifying it on the
// callback prevents CSRF (an attacker can't forge a callback URL that
// links someone else's Stripe account to our tenant).
function buildOAuthState(tenantId, secret, nonce) {
  if (!tenantId)       throw new Error('tenantId required for state');
  if (!secret)         throw new Error('signing secret required for state');
  const _nonce = nonce || crypto.randomBytes(12).toString('hex');
  const payload = `${tenantId}:${_nonce}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
  return `${payload}:${sig}`;
}

// Verify an OAuth state token. Returns { ok: boolean, tenantId?: string }.
// Caller uses tenantId to look up the right tenant — the URL alone can't
// determine which tenant the OAuth response belongs to.
function verifyOAuthState(state, secret) {
  if (!state || typeof state !== 'string') return { ok: false };
  const parts = state.split(':');
  if (parts.length !== 3) return { ok: false };
  const [tenantId, nonce, sig] = parts;
  if (!tenantId || !nonce || !sig) return { ok: false };
  const expected = crypto.createHmac('sha256', secret).update(`${tenantId}:${nonce}`).digest('hex').slice(0, 32);
  // Constant-time comparison to avoid timing attacks.
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return { ok: false };
  return { ok: crypto.timingSafeEqual(a, b), tenantId };
}

// Extract a UI-friendly status summary from a Stripe Account object.
// Same shape used for both Express and Standard accounts (since the
// underlying Account object has the same fields). What changes between
// types is who controls these flags — Plume can dispatch salons to a
// fresh onboarding link for Express; for Standard the salon has to fix
// requirements in their own Stripe Dashboard.
function summariseAccountStatus(account) {
  if (!account || !account.id) return null;
  const reqs = account.requirements || {};
  return {
    accountId:        account.id,
    accountType:      account.type || null,
    chargesEnabled:   account.charges_enabled === true,
    payoutsEnabled:   account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    country:          account.country || null,
    defaultCurrency:  account.default_currency || null,
    email:            account.email || null,
    businessName:     (account.business_profile && account.business_profile.name) || null,
    statementDescriptor:
      (account.settings && account.settings.payments && account.settings.payments.statement_descriptor) || null,
    requirementsCurrentlyDue:  Array.isArray(reqs.currently_due)   ? reqs.currently_due.slice(0, 20)  : [],
    requirementsPastDue:       Array.isArray(reqs.past_due)        ? reqs.past_due.slice(0, 20)       : [],
    requirementsDisabledReason: reqs.disabled_reason || null,
    updatedAt: new Date().toISOString(),
  };
}

// Plain-language status banner copy for the onboarding UI. Returns
// { tone, headline, detail } so the React side just renders without
// having to know the field meanings.
function describeAccountStatus(summary) {
  if (!summary) {
    return { tone: 'idle', headline: 'Not connected yet', detail: 'Choose how you want to set up payments.' };
  }
  if (summary.chargesEnabled && summary.payoutsEnabled) {
    return {
      tone: 'success',
      headline: 'Payments are live',
      detail: `${summary.businessName || 'Your account'} can accept cards and receive payouts.`,
    };
  }
  if (summary.detailsSubmitted && !summary.chargesEnabled) {
    return {
      tone: 'pending',
      headline: 'Stripe is reviewing your account',
      detail: 'Usually completes in a few minutes; can take up to 24 hours on busy days.',
    };
  }
  if (summary.detailsSubmitted && summary.chargesEnabled && !summary.payoutsEnabled) {
    return {
      tone: 'pending',
      headline: 'Payouts pending bank verification',
      detail: 'You can accept charges already — payouts unlock once your bank account is verified.',
    };
  }
  if (summary.requirementsCurrentlyDue.length > 0) {
    return {
      tone: 'warning',
      headline: 'More info needed',
      detail: `Stripe needs: ${summary.requirementsCurrentlyDue.slice(0, 3).join(', ')}${summary.requirementsCurrentlyDue.length > 3 ? '…' : ''}`,
    };
  }
  return {
    tone: 'pending',
    headline: 'Account created, onboarding not started',
    detail: 'Click Continue setup to finish providing your business and bank details.',
  };
}

// Sanitise an account type from user input. Throws for unknown values to
// prevent silently writing an invalid `type` field on the tenant doc.
function normaliseAccountType(t) {
  if (!t) return 'express';                          // default to Express
  const lower = String(t).toLowerCase();
  if (!ACCOUNT_TYPES.includes(lower)) {
    throw new Error(`Unknown account type: ${t}. Must be one of ${ACCOUNT_TYPES.join(', ')}.`);
  }
  return lower;
}

module.exports = {
  ACCOUNT_TYPES,
  buildOAuthState,
  verifyOAuthState,
  summariseAccountStatus,
  describeAccountStatus,
  normaliseAccountType,
};
