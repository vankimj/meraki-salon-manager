// Per-device user preferences. Theme + auto-logout aren't tenant-specific
// or account-specific (they're how YOU like the app on THIS phone), so
// they live in AsyncStorage with no tenant/email scoping.
//
// Notification preferences are per-employee (cross-device, shared with
// web's tech-reminder system) and live on the Firestore employee doc —
// not in this module.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  theme:        'userPref:theme',          // 'light' | 'dark' | 'system'
  autoLogoutMin:'userPref:autoLogoutMin',  // 0 (off) | 5 | 15 | 30 | 60
};

const DEFAULTS = {
  theme:        'system',
  autoLogoutMin: 0,                         // off by default — opt-in
};

const cache = { ...DEFAULTS };
let loaded = false;
const subscribers = new Set();
function notify() { subscribers.forEach(cb => { try { cb(cache); } catch (_) {} }); }

export async function loadInitialPrefs() {
  if (loaded) return cache;
  try {
    const [t, a] = await Promise.all([
      AsyncStorage.getItem(KEYS.theme),
      AsyncStorage.getItem(KEYS.autoLogoutMin),
    ]);
    if (t) cache.theme = t;
    if (a !== null) cache.autoLogoutMin = Number(a) || 0;
  } catch (_) {}
  loaded = true;
  notify();
  return cache;
}

export function getPrefs() { return cache; }

export async function setTheme(v) {
  cache.theme = v;
  try { await AsyncStorage.setItem(KEYS.theme, v); } catch (_) {}
  notify();
}

export async function setAutoLogoutMin(v) {
  const n = Number(v) || 0;
  cache.autoLogoutMin = n;
  try { await AsyncStorage.setItem(KEYS.autoLogoutMin, String(n)); } catch (_) {}
  notify();
}

export function subscribePrefs(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
