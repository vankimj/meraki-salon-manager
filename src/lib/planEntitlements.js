// Canonical SaaS plan / pack / add-on model — the single source of truth the
// app uses to decide what a tenant is entitled to. Mirrors the public pricing
// page (plumenexus/src/components/Pricing.jsx) so what we sell and what the app
// enforces never drift.
//
// Three base tiers, each a strict superset of the one below it:
//   solo     — single-chair stylist (also the Founders'-Year free tier)
//   studio   — growing salon, full team; bundles the Comms Pack
//   salonPro — unlimited staff + multi-location; bundles Operations/Marketing/AI
//
// On top of a base tier a tenant can stack Power Packs (and, for power users,
// individual atomic add-ons). A pack/atom UNLOCKS modules a lower tier wouldn't
// otherwise see — e.g. a Solo tenant who buys the Comms Pack gets Communications.
//
// The server keeps a hand-synced mirror in functions/lib/planGating.js (CommonJS
// can't import this ESM module). Keep the two in lockstep.

// Strict tier ordering. enterprise is reserved for custom contracts (no public
// price); it sits above salonPro so a rank check naturally grants it everything.
export const PLAN_RANK = { solo: 0, studio: 1, salonPro: 2, enterprise: 3 };

export const PLAN_IDS = ['solo', 'studio', 'salonPro'];

// Display metadata + pricing. monthly/annual are the per-month dollar figures
// (annual = effective monthly when billed yearly, ~14% off). These are what the
// app shows; the amount Stripe actually charges comes from the price IDs in
// functions/.env and must be kept in sync at go-live.
export const PLAN_META = {
  solo:       { label: 'Solo',      monthly: 49,  annual: 42,  color: '#2D7A5F' },
  studio:     { label: 'Studio',    monthly: 79,  annual: 68,  color: '#3D9E8A' },
  salonPro:   { label: 'Salon Pro', monthly: 149, annual: 128, color: '#3D95CE' },
  enterprise: { label: 'Enterprise', monthly: null, annual: null, color: '#6A4FA0' },
};

// Legacy plan ids (the original starter/studio/pro/enterprise model) mapped to
// the new ids. Grandfathered tenant docs predate the rename; normalizePlan maps
// them on read so old data keeps working without a migration.
export const LEGACY_PLAN_MAP = { starter: 'solo', pro: 'salonPro' };

// Map any stored plan value to a canonical new-model id. Unknown / missing →
// salonPro, preserving the historical "no plan field = full access" default for
// the bootstrap admin / Meraki tenant which predate billing.
export function normalizePlan(plan) {
  if (!plan) return 'salonPro';
  if (LEGACY_PLAN_MAP[plan]) return LEGACY_PLAN_MAP[plan];
  if (PLAN_RANK[plan] != null) return plan;
  return 'salonPro';
}

// ── Power Packs (stack on any base tier) ───────────────────────────────────
// `unlocks` = module ids this pack grants regardless of base plan. `caps` =
// non-module capability flags (consumed by feature-level gates, not the tile
// catalog). Prices are monthly add-on dollars.
export const PACKS = [
  { id: 'comms',      label: 'Comms Pack',      price: 19, unlocks: ['chat'],      caps: [] },
  { id: 'marketing',  label: 'Marketing Pack',  price: 19, unlocks: ['marketing'], caps: ['loyalty'] },
  { id: 'ai',         label: 'AI Pack',         price: 19, unlocks: [],            caps: ['aiVoice', 'aiCopy'] },
  { id: 'operations', label: 'Operations Pack', price: 29, unlocks: ['hr'],        caps: ['multiLocation'] },
  { id: 'brand',      label: 'Brand Pack',      price: 39, unlocks: [],            caps: ['whiteLabel', 'customDomain'] },
];

// ── Atomic add-ons (à-la-carte escape hatch — one feature from a pack) ──────
export const ATOMS = [
  { id: 'sms',          label: 'SMS (dedicated number + two-way)', price: 15, partOf: 'comms',      unlocks: ['chat'],      caps: [] },
  { id: 'voice',        label: 'Voice commands',                   price: 15, partOf: 'ai',         unlocks: [],            caps: ['aiVoice'] },
  { id: 'loyalty',      label: 'Loyalty + tiers',                  price: 15, partOf: 'marketing',  unlocks: ['marketing'], caps: ['loyalty'] },
  { id: 'gusto',        label: 'Gusto payroll sync',               price: 25, partOf: 'operations', unlocks: ['hr'],        caps: [] },
  { id: 'customDomain', label: 'Custom email sender domain',       price: 15, partOf: 'brand',      unlocks: [],            caps: ['customDomain'] },
];

const PACK_BY_ID = Object.fromEntries(PACKS.map(p => [p.id, p]));
const ATOM_BY_ID = Object.fromEntries(ATOMS.map(a => [a.id, a]));

// Module ids unlocked by a tenant's purchased packs + atoms (beyond their base
// tier). Pure; safe for unknown ids.
export function unlockedModulesFor(packs = [], atoms = []) {
  const out = new Set();
  for (const id of packs) (PACK_BY_ID[id]?.unlocks || []).forEach(m => out.add(m));
  for (const id of atoms) (ATOM_BY_ID[id]?.unlocks || []).forEach(m => out.add(m));
  return out;
}

// Capability flags unlocked by a tenant's purchased packs + atoms.
export function unlockedCapsFor(packs = [], atoms = []) {
  const out = new Set();
  for (const id of packs) (PACK_BY_ID[id]?.caps || []).forEach(c => out.add(c));
  for (const id of atoms) (ATOM_BY_ID[id]?.caps || []).forEach(c => out.add(c));
  return out;
}
