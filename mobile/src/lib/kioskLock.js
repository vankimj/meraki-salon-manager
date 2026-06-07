// Persisted "this device is in kiosk mode" flag. Survives an app kill/restart so
// force-quitting a kiosk can't drop someone back into the signed-in admin app
// without the admin PIN — on launch, App renders the KioskLockGate (PIN
// challenge) whenever this is set. Cleared only by a successful verifyKioskPin.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'kioskLock';
let route = null;        // null | 'Kiosk' | 'ClockKiosk'
let loaded = false;
const subs = new Set();

function notify() { subs.forEach(cb => { try { cb(route); } catch (_) {} }); }

export async function loadInitialKioskLock() {
  if (loaded) return route;
  try { route = (await AsyncStorage.getItem(KEY)) || null; } catch (_) { /* stay null */ }
  loaded = true;
  return route;
}
export function isKioskLocked() { return !!route; }
export function getKioskRoute() { return route; }
export async function setKioskLocked(r) {
  route = r || 'Kiosk';
  notify();
  try { await AsyncStorage.setItem(KEY, route); } catch (_) {}
}
export async function clearKioskLocked() {
  route = null;
  notify();
  try { await AsyncStorage.removeItem(KEY); } catch (_) {}
}
export function subscribeKioskLock(cb) { subs.add(cb); return () => subs.delete(cb); }
