// Multi-location helpers. Sprint 1 of the onboarding wizard work.
//
// Decision (2026-05-13): Model B — one tenant, many locations under it.
// Single-location tenants (Meraki at launch) have one entry with
// id='main'. Records carry `locationId`; helpers default to 'main' so
// existing single-location code keeps working unchanged.
//
// Multi-location UI surfaces (location switcher, per-location queue,
// per-location TipFlow) light up later sprints when list.length >= 2.
import { db } from './firebase';
import { TENANT_ID } from './tenant';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';

export const DEFAULT_LOCATION_ID = 'main';

// Shape on tenants/{tid}/data/locations:
//   {
//     list: [{ id, name, address, phone, hours, taxRate, isPrimary, active }],
//     defaultLocationId,
//   }
const locationsDoc = () => doc(db, 'tenants', TENANT_ID, 'data', 'locations');

function normalize(data) {
  if (!data || !Array.isArray(data.list) || data.list.length === 0) {
    return {
      list:              [{ id: DEFAULT_LOCATION_ID, name: 'Main', isPrimary: true, active: true }],
      defaultLocationId: DEFAULT_LOCATION_ID,
    };
  }
  return {
    list:              data.list,
    defaultLocationId: data.defaultLocationId || data.list.find(l => l.isPrimary)?.id || data.list[0].id,
  };
}

export async function getLocations() {
  const snap = await getDoc(locationsDoc());
  return normalize(snap.exists() ? snap.data() : null);
}

export function subscribeLocations(cb) {
  return onSnapshot(
    locationsDoc(),
    s => cb(normalize(s.exists() ? s.data() : null)),
    err => {
      console.warn('[locations] subscribe error:', err?.code || err?.message);
      cb(normalize(null));
    }
  );
}

export async function saveLocations(state) {
  await setDoc(locationsDoc(), {
    list:              Array.isArray(state.list) ? state.list : [],
    defaultLocationId: state.defaultLocationId || DEFAULT_LOCATION_ID,
    updatedAt:         new Date().toISOString(),
  }, { merge: true });
}

export function isMultiLocation(state) {
  return Array.isArray(state?.list) && state.list.filter(l => l.active !== false).length > 1;
}

// Active locations, primary first then by name — the order the switcher shows.
export function activeLocations(state) {
  return (state?.list || [])
    .filter(l => l.active !== false)
    .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || (a.name || '').localeCompare(b.name || ''));
}

// Resolve a location entry by id, falling back to the default/primary then the
// first active one. Pure — safe to unit-test.
export function resolveLocation(state, locationId) {
  const list = state?.list || [];
  return list.find(l => l.id === locationId)
    || list.find(l => l.id === (state?.defaultLocationId || DEFAULT_LOCATION_ID))
    || activeLocations(state)[0]
    || null;
}

// Per-location tax rate, falling back to the tenant-wide rate when a location
// has no explicit override. Pure. `fallbackRate` is settings.taxRate.
export function locationTaxRate(state, locationId, fallbackRate = 0) {
  const loc = resolveLocation(state, locationId);
  const r = loc?.taxRate;
  return (typeof r === 'number' && isFinite(r) && r >= 0) ? r : (Number(fallbackRate) || 0);
}

// ── Current-location context ────────────────────────────────────────────────
// Stored per tenant in localStorage so a refresh keeps the switcher's choice.
// Single-location tenants always resolve to DEFAULT_LOCATION_ID. The setter
// notifies subscribers so the switcher + dependent views re-render live.
const CUR_KEY = () => `pn:currentLocation:${TENANT_ID}`;
const curSubs = new Set();

export function currentLocationId() {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(CUR_KEY()) : null;
    return v || DEFAULT_LOCATION_ID;
  } catch (_) {
    return DEFAULT_LOCATION_ID;
  }
}

export function setCurrentLocationId(id) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(CUR_KEY(), id || DEFAULT_LOCATION_ID); } catch (_) {}
  curSubs.forEach(cb => { try { cb(id || DEFAULT_LOCATION_ID); } catch (_) {} });
}

export function subscribeCurrentLocation(cb) {
  curSubs.add(cb);
  return () => curSubs.delete(cb);
}
