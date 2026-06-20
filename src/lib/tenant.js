// Tenant detection — synchronous fast-path + async resolveTenant() that's
// awaited in main.jsx before the React tree mounts.
//
// Resolution order:
//   1. Build-time env override (VITE_TENANT_ID) — pinned via .env.production
//   2. ?tenant=foo URL param OR sessionStorage override (test-only)
//   3. plumenexus.com subdomain → slugs/{slug} Firestore lookup (async)
//        - primary  → set TENANT_ID, render app
//        - alias    → 301 redirect to primary's URL
//        - reserved → render TenantNotFound (reason: reserved)
//        - missing  → render TenantNotFound (reason: unknown)
//   4. plumenexus-prod.web.app, localhost → fallback to 'merakinailstudio'
//
// The `slugs/{slug}` collection is the SaaS lookup layer:
//   - Public-readable, so anonymous visitors can resolve before sign-in.
//   - Doc id = the URL subdomain. Doc body = { tenantId, kind, primarySlug? }.
//   - kind: 'primary' (live), 'alias' (301 to primarySlug), 'reserved' (no tenant).
//   - Written transactionally by provisionTenant + the platform-admin Change-URL flow.
//   - Tenant root docs (`tenants/{tenantId}`) stay restricted to bootstrap admin.
//     The slugs collection is the ONLY thing the world can read pre-login.
//
// Why slugs/ instead of `where('subdomain','==',slug)` on tenants:
//   - Pre-sign-in unauthenticated query against tenants/ would expose plan,
//     ownerEmail, billing state. slugs/ exposes only the indirection.
//   - getDoc by id is O(1), no composite index needed for alias support.

import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

const SAAS_ROOTS = ['.plumenexus.com', '.plumenexus.app', '.tipflow.app'];
// Was 'meraki' originally; that tenant was deleted 2026-05-14 and its slug is
// reserved until 2027-05-14 to prevent reuse (see slugs/meraki). The current
// Meraki tenant lives at this UUID with subdomain 'merakinailstudio'. This
// fallback only matters for non-SaaS hosts (.web.app, localhost); .web.app
// redirects to the SaaS subdomain in src/main.jsx, so real production traffic
// never lands here.
const LEGACY_FALLBACK_TENANT = 'tf46226a93a1b546b';

// Format gate for any caller-supplied tenant id (query param / sessionStorage).
function isValidTenantId(s) {
  return typeof s === 'string' && /^[a-z0-9-]{1,64}$/.test(s);
}

// Synchronous boot-time guess — used to seed TENANT_ID before resolveTenant()
// completes, so any early Firestore read against `tenants/${TENANT_ID}/...`
// doesn't hit a TENANT_ID=null window. Real value lands after resolveTenant.
function bootGuess() {
  if (import.meta.env.VITE_TENANT_ID) return import.meta.env.VITE_TENANT_ID;
  if (typeof window === 'undefined') return LEGACY_FALLBACK_TENANT;
  try {
    const qs = new URLSearchParams(window.location.search);
    const fromUrl = qs.get('tenant');
    if (fromUrl && isValidTenantId(fromUrl)) return fromUrl;
    const fromSession = sessionStorage.getItem('plumenexus_tenant_override');
    if (fromSession && isValidTenantId(fromSession)) return fromSession;
  } catch { /* sessionStorage unavailable */ }
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname.startsWith('127.')) return LEGACY_FALLBACK_TENANT;
  for (const root of SAAS_ROOTS) {
    if (hostname.endsWith(root)) {
      const sub = hostname.slice(0, hostname.length - root.length);
      if (!sub || sub === 'www' || sub === 'app' || sub === 'api') {
        console.warn(`[tenant] reserved/blank subdomain on ${hostname} — using LEGACY_FALLBACK_TENANT`);
        return LEGACY_FALLBACK_TENANT;
      }
      return sub;
    }
  }
  // Anything else (e.g. plumenexus-prod.web.app, custom domain, dev host).
  // src/main.jsx redirects .web.app to the SaaS subdomain before render, so
  // this should never be hit in production — log so we notice if it ever is.
  console.warn(`[tenant] no SaaS root matched for ${hostname} — using LEGACY_FALLBACK_TENANT`);
  return LEGACY_FALLBACK_TENANT;
}

// Mutable: starts as the boot guess, gets overwritten by resolveTenant().
// `export let` is intentional — consumers that import TENANT_ID synchronously
// before resolveTenant completes will see the guess; afterward, the live
// value. For unauthenticated pre-login surfaces the guess is correct.
export let TENANT_ID = bootGuess();

// Set internally by resolveTenant() so URL alias 301s and "not found" pages
// can be rendered after async lookup.
let resolveState = { status: 'pending', reason: null };

// Whether THIS tenant is flagged live/production, read from the public
// slugs/{slug} doc at boot (default false = pre-production). The env banner
// reads this synchronously — it renders outside the app context on every
// surface (incl. the logged-out booking page), so the flag must resolve at the
// tenant layer, not from authenticated settings. Hosts that don't do a slug
// lookup (localhost, *.web.app, ?tenant= overrides, preview channels) stay
// false → pre-production banner, which is the safe default.
let _isProductionTenant = false;
export function isProductionTenant() {
  return _isProductionTenant;
}

export function getTenantResolveState() {
  return resolveState;
}

export function currentSubdomain() {
  if (typeof window === 'undefined') return TENANT_ID;
  const { hostname } = window.location;
  for (const root of SAAS_ROOTS) {
    if (hostname.endsWith(root)) {
      const sub = hostname.slice(0, hostname.length - root.length);
      return (sub && sub !== 'www' && sub !== 'app' && sub !== 'api') ? sub : TENANT_ID;
    }
  }
  return TENANT_ID;
}

function hostnameSubdomain(hostname) {
  for (const root of SAAS_ROOTS) {
    if (hostname.endsWith(root)) {
      const sub = hostname.slice(0, hostname.length - root.length);
      if (!sub || sub === 'www' || sub === 'app' || sub === 'api') return null;
      return sub;
    }
  }
  return null;
}

// Called by main.jsx before React renders. Returns when:
//   - Resolution complete (TENANT_ID set, render app)
//   - Tenant not found (caller should render TenantNotFound based on getTenantResolveState)
//   - Alias detected (function performs 301-style replace; never returns)
export async function resolveTenant() {
  // Env / URL-param / sessionStorage / legacy-host paths short-circuit — the
  // boot guess already captured them and there's no slug lookup to do.
  if (import.meta.env.VITE_TENANT_ID) { resolveState = { status: 'ok' }; return; }
  if (typeof window === 'undefined')  { resolveState = { status: 'ok' }; return; }

  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname.startsWith('127.')) {
    resolveState = { status: 'ok' };
    return;
  }
  // ?tenant=foo or sessionStorage override → caller chose the tenant id
  // explicitly; skip the slug lookup.
  try {
    const qs = new URLSearchParams(window.location.search);
    const fromUrl = qs.get('tenant');
    const fromSession = sessionStorage.getItem('plumenexus_tenant_override');
    if ((fromUrl && isValidTenantId(fromUrl)) || (fromSession && isValidTenantId(fromSession))) {
      resolveState = { status: 'ok' };
      return;
    }
  } catch { /* sessionStorage unavailable */ }

  const sub = hostnameSubdomain(hostname);
  if (!sub) {
    // Not on a SaaS domain (e.g. plumenexus-prod.web.app). Fall back
    // to the legacy tenant. No lookup needed.
    resolveState = { status: 'ok' };
    return;
  }

  // Hard cap on the slug lookup so a hung Firestore call (seen in some
  // WebKit / restrictive-cookie environments) doesn't trap Boot in
  // `status: 'loading'` forever — that renders null and looks like a
  // blank page. After the timeout, fall through to notFound. Worst case
  // a real tenant briefly sees the not-found page and a reload fixes it,
  // which is strictly better than a blank screen.
  try {
    const snap = await Promise.race([
      getDoc(doc(db, 'slugs', sub)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slug lookup timeout')), 5000)),
    ]);
    if (!snap.exists()) {
      TENANT_ID = LEGACY_FALLBACK_TENANT;
      resolveState = { status: 'notFound', reason: 'unknown', slug: sub };
      return;
    }
    const data = snap.data() || {};
    if (data.kind === 'primary' && isValidTenantId(data.tenantId)) {
      TENANT_ID = data.tenantId;
      _isProductionTenant = data.isProduction === true;
      resolveState = { status: 'ok' };
      return;
    }
    if (data.kind === 'alias' && typeof data.primarySlug === 'string') {
      const target = `https://${data.primarySlug}${SAAS_ROOTS[0]}${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.replace(target);
      return; // navigation in flight — never resolves
    }
    if (data.kind === 'reserved') {
      resolveState = { status: 'notFound', reason: 'reserved', slug: sub };
      return;
    }
    resolveState = { status: 'notFound', reason: 'malformed', slug: sub };
  } catch (e) {
    console.warn('[tenant] resolveTenant failed:', e?.code || e?.message);
    // Network / Firestore error / timeout — show TenantNotFound rather
    // than a blank page so the user has clear CTAs to recover.
    resolveState = { status: 'notFound', reason: 'unknown', slug: sub };
  }
}
