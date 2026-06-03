// Plan/module gating for in-app plan changes. Server mirror of
// src/lib/modules.js (kept in sync by hand — functions is CommonJS and can't
// import the ESM client catalog). Pure + dependency-free so it unit-tests
// cleanly; the Firestore/Stripe wiring lives in index.js.

const SAAS_PLAN_RANK = { starter: 0, studio: 1, pro: 2, enterprise: 3 };

const MODULE_MIN_PLAN = {
  schedule: 'starter', clients: 'starter', services: 'starter', employees: 'starter', walkin: 'starter',
  reports: 'studio', earnings: 'studio', attendance: 'studio', giftcards: 'studio', meetings: 'studio', products: 'studio',
  chat: 'pro', marketing: 'pro', hr: 'pro', memberships: 'pro',
};

const MODULE_LABELS = {
  reports: 'Reports', earnings: 'Earnings', attendance: 'Attendance', giftcards: 'Gift Cards',
  meetings: 'Meetings', products: 'Products', chat: 'Communications', marketing: 'Marketing',
  hr: 'HR', memberships: 'Memberships',
};

// A membership is "still billing" (blocks teardown) in any non-terminal,
// non-tombstoned state. Only 'cancelled' is terminal.
const MEMBERSHIP_BLOCKING_STATUSES = ['active', 'past_due', 'paused', 'trialing'];

function isBlockingMembership(data) {
  return !!data
    && data._deleted !== true
    && MEMBERSHIP_BLOCKING_STATUSES.includes(String(data.status || '').toLowerCase());
}

// Module ids a downgrade currentPlan → targetPlan would remove.
function modulesLostOnDowngrade(currentPlan, targetPlan) {
  if (SAAS_PLAN_RANK[targetPlan] >= SAAS_PLAN_RANK[currentPlan]) return [];
  return Object.entries(MODULE_MIN_PLAN)
    .filter(([, p]) => SAAS_PLAN_RANK[p] <= SAAS_PLAN_RANK[currentPlan] && SAAS_PLAN_RANK[p] > SAAS_PLAN_RANK[targetPlan])
    .map(([id]) => id);
}

// Pure readiness check for a downgrade. Memberships block on still-billing
// count (the money-critical teardown); every other dropped module blocks
// until it's been turned off (present in disabledModules).
function buildDowngradeBlockers(currentPlan, targetPlan, { disabledModules = [], activeMembershipCount = 0 } = {}) {
  const lost = modulesLostOnDowngrade(currentPlan, targetPlan);
  const disabled = new Set(disabledModules);
  const blockers = [];
  for (const id of lost) {
    if (id === 'memberships') {
      if (activeMembershipCount > 0) {
        blockers.push({
          moduleId: id, label: 'Memberships', count: activeMembershipCount,
          reason: `${activeMembershipCount} active membership${activeMembershipCount === 1 ? '' : 's'} still billing — cancel ${activeMembershipCount === 1 ? 'it' : 'them'} first`,
        });
      }
    } else if (!disabled.has(id)) {
      blockers.push({ moduleId: id, label: MODULE_LABELS[id] || id, reason: 'Turn this module off before downgrading' });
    }
  }
  return { lost, blockers };
}

module.exports = {
  SAAS_PLAN_RANK, MODULE_MIN_PLAN, MODULE_LABELS, MEMBERSHIP_BLOCKING_STATUSES,
  isBlockingMembership, modulesLostOnDowngrade, buildDowngradeBlockers,
};
