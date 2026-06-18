// Server mirror of src/data/verticals.js (CommonJS — functions can't import the
// ESM client module). Only the bits the markOnboardingPhase seed-hook needs:
// the per-vertical recurring membership-plan templates. Keep in sync with the
// client module's `membershipPlans`.

const VERTICAL_MEMBERSHIP_PLANS = {
  nails: [],
  personalTraining: [
    { name: 'Unlimited Monthly',   price: 199, billingPeriod: 'monthly', description: 'Unlimited 1-on-1 sessions, billed monthly', active: true },
    { name: '4 Sessions / Month',  price: 240, billingPeriod: 'monthly', description: 'Four 1-on-1 sessions each month',           active: true },
    { name: 'Small-Group Monthly', price: 99,  billingPeriod: 'monthly', description: '8 small-group sessions per month',          active: true },
  ],
};

// Known registry verticals. Anything else (hair/both/other and legacy) clamps
// to 'nails' — the default — so those tenants keep NO vertical field and behave
// exactly as before.
const KNOWN_VERTICALS = Object.keys(VERTICAL_MEMBERSHIP_PLANS);

function normalizeVertical(verticalKey) {
  return KNOWN_VERTICALS.includes(verticalKey) ? verticalKey : 'nails';
}

function membershipPlansForVertical(verticalKey) {
  return VERTICAL_MEMBERSHIP_PLANS[verticalKey] || [];
}

module.exports = { VERTICAL_MEMBERSHIP_PLANS, KNOWN_VERTICALS, normalizeVertical, membershipPlansForVertical };
