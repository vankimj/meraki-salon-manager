// Light/dark color mode for the staff/management app. Per-device (localStorage),
// independent of the per-tenant brand theme. 'system' follows the OS via
// matchMedia; 'light'/'dark' force it. Applies the resolved value to
// <html data-theme="…">, which index.css's --pn-* tokens key off of.

const KEY = 'pn-color-mode';
const MODES = new Set(['system', 'light', 'dark']);

let mode = 'system';
try { const v = localStorage.getItem(KEY); if (v && MODES.has(v)) mode = v; } catch (_) {}

const mql = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

const subs = new Set();

export function resolvedScheme() {
  if (mode === 'system') return mql && mql.matches ? 'dark' : 'light';
  return mode;
}

function apply() {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolvedScheme());
}

export function getColorMode() { return mode; }

export function setColorMode(next) {
  if (!MODES.has(next)) return;
  mode = next;
  try { localStorage.setItem(KEY, next); } catch (_) {}
  apply();
  subs.forEach(cb => { try { cb(mode); } catch (_) {} });
}

export function subscribeColorMode(cb) { subs.add(cb); return () => subs.delete(cb); }

// React to OS changes while on 'system'.
if (mql) {
  const onChange = () => { if (mode === 'system') { apply(); subs.forEach(cb => { try { cb(mode); } catch (_) {} }); } };
  try { mql.addEventListener('change', onChange); } catch (_) { try { mql.addListener(onChange); } catch (_) {} }
}

// Apply immediately on import so the first paint is correct (no flash).
apply();
