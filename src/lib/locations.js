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

// Sprint 1 ships single-location only — every caller resolves to 'main'.
// Sprint 6 will replace this with a context-based current-location-id
// driven by the top-bar location switcher (stored in localStorage).
export function currentLocationId() {
  return DEFAULT_LOCATION_ID;
}
