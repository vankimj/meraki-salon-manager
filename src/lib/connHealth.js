// Lightweight connection/latency monitor. Periodically times a real Firestore
// server round-trip (a tiny doc read, cache bypassed) so we can show whether the
// app is slow because of the network / Firestore vs. the app itself.
//
// Cost: one small server read every ~20s while the tab is visible (~180/hr) —
// negligible. Pauses when the tab is hidden so background tabs cost nothing.

import { doc, getDocFromServer } from 'firebase/firestore';
import { db } from './firebase';
import { TENANT_ID } from './tenant';

const SLOW_MS = 1200;   // > this = "slow"
const BAD_MS  = 3000;   // > this = "very slow"
const INTERVAL = 20000;

let state = { latencyMs: null, status: 'unknown', at: 0 }; // unknown | good | slow | bad | offline | error
const subs = new Set();
let timer = null;

function set(next) {
  state = next;
  subs.forEach(cb => { try { cb(state); } catch { /* noop */ } });
}

export function getConnHealth() { return state; }

export function subscribeConnHealth(cb) {
  subs.add(cb);
  try { cb(state); } catch { /* noop */ }
  return () => subs.delete(cb);
}

export async function pingConn() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    set({ latencyMs: null, status: 'offline', at: Date.now() });
    return state;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  try {
    // Ping slugs/{tenant}: tiny, PUBLICLY readable (so it works on logged-out
    // pages like the /r/{token} receipt + ratings page — settings is staff-only,
    // which made the ping report a false "conn err" there). Server read = true RTT.
    await getDocFromServer(doc(db, 'slugs', TENANT_ID));
    const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    const status = ms > BAD_MS ? 'bad' : ms > SLOW_MS ? 'slow' : 'good';
    set({ latencyMs: ms, status, at: Date.now() });
    if (status !== 'good') console.warn(`[conn] Firestore round-trip ${ms}ms (${status})`);
  } catch (e) {
    set({ latencyMs: null, status: 'error', at: Date.now() });
    console.warn('[conn] ping failed:', e?.code || e?.message);
  }
  return state;
}

export function startConnHealth() {
  if (typeof window === 'undefined' || timer) return;
  const tick = () => { if (!document.hidden) pingConn(); };
  pingConn();
  timer = setInterval(tick, INTERVAL);
  // Re-check immediately when coming back online / refocusing the tab.
  window.addEventListener('online',  pingConn);
  window.addEventListener('offline', () => set({ latencyMs: null, status: 'offline', at: Date.now() }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pingConn(); });
}
