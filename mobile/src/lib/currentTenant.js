// Currently-selected tenant for this mobile app session.
//
// Replaces the old hardcoded `TENANT_ID = 'meraki'` in firebase.js. The
// id is read at call time by tenantCol/tenantDoc helpers in firestore.js
// so every query runs against whichever salon the user is currently
// scoped to. Persisted in AsyncStorage so it survives app restarts.
//
// Subscription model: screens that need to re-fetch when the tenant
// changes can subscribe() and get notified. The initial load from
// AsyncStorage is synchronous-ish via `loadInitial()` which must be
// awaited once at app startup (in App.jsx) before any data fetches run.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'currentTenantId';
const FALLBACK = 'merakinailstudio';   // default tenant if storage is empty

let current = FALLBACK;
let loaded = false;
const subscribers = new Set();

// Call once at app startup BEFORE any Firestore queries fire. Reads the
// last-selected tenant from AsyncStorage. Without this, the first burst
// of queries would all hit the fallback tenant.
export async function loadInitialTenant() {
  if (loaded) return current;
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) current = stored;
  } catch (_) { /* AsyncStorage failed — stay on fallback */ }
  loaded = true;
  return current;
}

export function getCurrentTenant() { return current; }

export async function setCurrentTenant(id) {
  if (!id || typeof id !== 'string') return;
  if (id === current) return;
  current = id;
  try { await AsyncStorage.setItem(STORAGE_KEY, id); } catch (_) {}
  subscribers.forEach(cb => { try { cb(id); } catch (_) {} });
}

// Subscribe to tenant changes. Returns an unsubscribe function. Useful
// for screens that need to refetch when the user picks a different
// salon mid-session.
export function subscribeTenant(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// Sign-out path: clear in-memory + storage so the next sign-in starts
// from the picker rather than auto-routing to the previous tenant.
export async function clearCurrentTenant() {
  current = FALLBACK;
  loaded = false;
  try { await AsyncStorage.removeItem(STORAGE_KEY); } catch (_) {}
  subscribers.forEach(cb => { try { cb(FALLBACK); } catch (_) {} });
}
