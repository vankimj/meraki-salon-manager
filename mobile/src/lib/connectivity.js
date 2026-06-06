// Connectivity probe for the offline-tolerant POS. The Firebase JS SDK on
// React Native uses a memory cache (its persistent cache needs IndexedDB,
// absent in RN), and `await setDoc()` hangs offline instead of rejecting — so
// we cannot rely on Firestore to tell us we're offline. Instead we probe a
// tiny no-content endpoint with a short timeout. `generate_204` returns an
// empty 204 quickly when reachable and throws (abort / network error) when
// not, giving a reliable yes/no BEFORE we decide to write vs. queue a sale.
export async function checkOnline(timeoutMs = 3500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    await fetch('https://clients3.google.com/generate_204', { method: 'GET', cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    return true;
  } catch (_) {
    return false;
  }
}
