// Self-healing update check. A service worker registered before our network-first
// config can get stuck serving a stale bundle that reloads alone won't fix. On
// startup we fetch /version.json (cache-busted, bypassing the SW), and if the
// running build's baked-in sha doesn't match the server's, we unregister every
// service worker, delete all caches, and reload once — guaranteeing the user lands
// on the current build without manually clearing site data.

import { BUILD_SHA } from './version';

export async function selfHealIfStale() {
  if (typeof window === 'undefined' || BUILD_SHA === 'dev') return;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { sha } = await res.json();
    if (!sha || sha === BUILD_SHA) return;   // up to date

    // Stale bundle loaded. Heal toward `sha` exactly once (guard against loops if
    // a reload somehow doesn't pick up the new build).
    const flag = `pn_healed_${sha}`;
    try { if (sessionStorage.getItem(flag)) return; sessionStorage.setItem(flag, '1'); } catch (_) { /* private mode */ }

    console.warn(`[selfHeal] stale build ${BUILD_SHA} → ${sha}; clearing caches + reloading.`);
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister().catch(() => {})));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => {})));
    }
    window.location.reload();
  } catch (_) { /* offline / fetch blocked — leave the app as-is */ }
}
