// Plan/module gating for in-app plan changes. Server mirror of
// src/lib/modules.js + src/lib/planEntitlements.js (kept in sync by hand —
// functions is CommonJS and can't import the ESM client catalog). Pure +
// dependency-free so it unit-tests cleanly; the Firestore/Stripe wiring lives
// in index.js.

const SAAS_PLAN_RANK = { solo: 0, studio: 1, salonPro: 2, enterprise: 3 };

// Legacy plan ids → new ids (grandfathered tenant docs predate the rename).
const LEGACY_PLAN_MAP = { starter: 'solo', pro: 'salonPro' };

// Map any stored plan to a canonical id. Unknown/missing → salonPro (preserves
// the historical "no plan field = full access" default for predates-billing docs).
function normalizePlan(plan) {
  if (!plan) return 'salonPro';
  if (LEGACY_PLAN_MAP[plan]) return LEGACY_PLAN_MAP[plan];
  if (SAAS_PLAN_RANK[plan] != null) return plan;
  return 'salonPro';
}

// Base tier each module belongs to. Mirrors MODULES[].plan in src/lib/modules.js.
const MODULE_MIN_PLAN = {
  schedule: 'solo', clients: 'solo', services: 'solo', employees: 'solo', walkin: 'solo',
  reports: 'solo', receipts: 'solo', earnings: 'solo', giftcards: 'solo',
  chat: 'studio', attendance: 'studio', meetings: 'studio', products: 'studio',
  marketing: 'salonPro', hr: 'salonPro', memberships: 'salonPro',
};

const MODULE_LABELS = {
  chat: 'Communications', attendance: 'Attendance', meetings: 'Meetings', products: 'Products',
  marketing: 'Marketing', hr: 'HR', memberships: 'Memberships',
};

// Power Packs / atomic add-ons that unlock a higher-tier module on a lower base.
// Mirrors planEntitlements.js. Used so a module kept alive by a purchased pack
// isn't counted as "lost" on a base-tier downgrade.
const PACK_UNLOCKS = { comms: ['chat'], marketing: ['marketing'], ai: [], operations: ['hr'], brand: [] };
const ATOM_UNLOCKS = { sms: ['chat'], voice: [], loyalty: ['marketing'], gusto: ['hr'], customDomain: [] };

function unlockedModulesFor(packs = [], atoms = []) {
  const out = new Set();
  for (const id of packs) (PACK_UNLOCKS[id] || []).forEach(m => out.add(m));
  for (const id of atoms) (ATOM_UNLOCKS[id] || []).forEach(m => out.add(m));
  return out;
}

// A membership is "still billing" (blocks teardown) in any non-terminal,
// non-tombstoned state. Only 'cancelled' is terminal.
const MEMBERSHIP_BLOCKING_STATUSES = ['active', 'past_due', 'paused', 'trialing'];

function isBlockingMembership(data) {
  return !!data
    && data._deleted !== true
    && MEMBERSHIP_BLOCKING_STATUSES.includes(String(data.status || '').toLowerCase());
}

// Module ids a downgrade currentPlan → targetPlan would remove. A module kept by
// a purchased pack/atom (in `unlocked`) is not lost.
function modulesLostOnDowngrade(currentPlan, targetPlan, unlocked = new Set()) {
  const cur = normalizePlan(currentPlan);
  const tgt = normalizePlan(targetPlan);
  if (SAAS_PLAN_RANK[tgt] >= SAAS_PLAN_RANK[cur]) return [];
  return Object.entries(MODULE_MIN_PLAN)
    .filter(([id, p]) => SAAS_PLAN_RANK[p] <= SAAS_PLAN_RANK[cur] && SAAS_PLAN_RANK[p] > SAAS_PLAN_RANK[tgt] && !unlocked.has(id))
    .map(([id]) => id);
}

// Pure readiness check for a downgrade. Memberships block on still-billing
// count (the money-critical teardown); every other dropped module blocks
// until it's been turned off (present in disabledModules).
function buildDowngradeBlockers(currentPlan, targetPlan, { disabledModules = [], activeMembershipCount = 0, packs = [], atomicAddOns = [] } = {}) {
  const unlocked = unlockedModulesFor(packs, atomicAddOns);
  const lost = modulesLostOnDowngrade(currentPlan, targetPlan, unlocked);
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
  SAAS_PLAN_RANK, LEGACY_PLAN_MAP, normalizePlan, MODULE_MIN_PLAN, MODULE_LABELS,
  PACK_UNLOCKS, ATOM_UNLOCKS, unlockedModulesFor, MEMBERSHIP_BLOCKING_STATUSES,
  isBlockingMembership, modulesLostOnDowngrade, buildDowngradeBlockers,
};
