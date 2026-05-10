import { db, doc, getDoc } from './firebase.js';

// Hardcoded fallback. Authoritative list lives in Firestore at platform/admins.
// Both layers required: this gates the UI; Firestore rules gate actual data.
const FALLBACK_ADMINS = ['jvankim@gmail.com'];

let _cachedAllowlist = null;
let _cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000;

export async function fetchAllowlist() {
  const now = Date.now();
  if (_cachedAllowlist && (now - _cachedAt) < CACHE_MS) return _cachedAllowlist;
  try {
    const snap = await getDoc(doc(db, 'platform', 'admins'));
    if (snap.exists()) {
      const list = (snap.data().emails || []).map(e => String(e).toLowerCase().trim());
      _cachedAllowlist = list.length > 0 ? list : FALLBACK_ADMINS;
    } else {
      _cachedAllowlist = FALLBACK_ADMINS;
    }
  } catch (e) {
    console.warn('[auth] could not fetch allowlist, using fallback:', e?.message);
    _cachedAllowlist = FALLBACK_ADMINS;
  }
  _cachedAt = now;
  return _cachedAllowlist;
}

export async function isPlatformAdmin(user) {
  if (!user?.email) return false;
  const list = await fetchAllowlist();
  return list.includes(user.email.toLowerCase().trim());
}
