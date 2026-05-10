// Subdomain resolution for the multi-tenant routing layer.
// Per principle #11 + plumenexus/SUBDOMAIN-CHANGE-DESIGN.md:
//
//   - The CURRENT primary subdomain lives at `tenants/{id}.subdomain`
//   - PREVIOUS subdomains live in `tenants/{id}.aliases` (kept forever)
//   - When a request hits `<sub>.plumenexus.com`:
//       1. If sub matches a tenant's primary → serve that tenant
//       2. If sub matches a tenant's alias  → 301 redirect to primary
//       3. Otherwise → not found
//
// The synchronous detectTenantId() in src/lib/tenant.js is the FAST path
// (URL subdomain == tenant id, which is true for every tenant at signup).
// This async resolver is the SLOW path that handles the alias case once
// tenants start changing their subdomains. It MUST be called at app init
// before the rest of the app loads — see the integration in src/main.jsx.
//
// For Meraki today (single-tenant), the fast path always wins. The slow
// path becomes relevant only once a tenant has changed their subdomain
// at least once.
import { db } from './firebase';
import { collection, query, where, limit, getDocs } from 'firebase/firestore';

/**
 * Resolves a URL subdomain to a tenant. Returns one of:
 *   { match: 'primary',  tenantId, primarySubdomain }   // sub IS the current primary
 *   { match: 'alias',    tenantId, primarySubdomain }   // sub is a previous alias — caller should redirect
 *   { match: 'reserved', formerTenantId }               // sub is in the 12-month cooldown after release
 *   { match: 'not-found' }                              // no tenant claims this sub
 */
export async function resolveSubdomain(sub) {
  const subdomain = String(sub || '').toLowerCase().trim();
  if (!subdomain) return { match: 'not-found' };

  // 1. Primary lookup — most common case
  const primarySnap = await getDocs(query(
    collection(db, 'tenants'),
    where('subdomain', '==', subdomain),
    limit(1),
  ));
  if (!primarySnap.empty) {
    const t = primarySnap.docs[0];
    return {
      match: 'primary',
      tenantId: t.id,
      primarySubdomain: t.data().subdomain,
    };
  }

  // 2. Alias lookup — happens when a tenant has changed their subdomain
  // at some point; old subdomain still resolves and we redirect.
  // NOTE: requires Firestore composite index on `aliases array-contains`.
  // Build the index before tenant #2 onboards.
  const aliasSnap = await getDocs(query(
    collection(db, 'tenants'),
    where('aliases', 'array-contains', subdomain),
    limit(1),
  ));
  if (!aliasSnap.empty) {
    const t = aliasSnap.docs[0];
    return {
      match: 'alias',
      tenantId: t.id,
      primarySubdomain: t.data().subdomain,
    };
  }

  // 3. Reserved-subdomain check — 12-month cooldown after a tenant
  // released this subdomain (anti-impersonation).
  const { doc, getDoc } = await import('firebase/firestore');
  const reservedSnap = await getDoc(doc(db, 'platform/reserved_subdomains', subdomain));
  if (reservedSnap.exists()) {
    return {
      match: 'reserved',
      formerTenantId: reservedSnap.data().formerTenantId,
    };
  }

  return { match: 'not-found' };
}

// Reserved-word blocklist — subdomains that conflict with platform infra
// or could impersonate the platform itself. Tenants cannot claim these.
export const RESERVED_SUBDOMAINS = new Set([
  // Platform infra
  'www', 'api', 'admin', 'app', 'auth', 'mail', 'support', 'help',
  'status', 'docs', 'blog', 'cdn', 'static', 'assets', 'console',
  // Brand impersonation
  'plumenexus', 'plume', 'nexus', 'meraki',
  // Common abuse patterns
  'test', 'demo', 'staging', 'dev', 'preview', 'beta', 'alpha',
  'login', 'signup', 'register', 'account', 'billing', 'pay',
  'security', 'privacy', 'terms', 'legal', 'tos',
  // Email-spoofing risk
  'noreply', 'postmaster', 'webmaster', 'abuse',
]);

/**
 * Validate a candidate subdomain. Returns null if valid, or a reason string.
 * Does NOT check uniqueness or reservation — those need async lookups
 * via resolveSubdomain().
 */
export function validateSubdomainFormat(sub) {
  const s = String(sub || '').trim();
  if (!s)                                     return 'Subdomain is required.';
  if (s.length < 3)                           return 'Subdomain must be at least 3 characters.';
  if (s.length > 30)                          return 'Subdomain must be 30 characters or less.';
  if (!/^[a-z0-9-]+$/.test(s))                return 'Use lowercase letters, numbers, and hyphens only.';
  if (s.startsWith('-') || s.endsWith('-'))   return 'Subdomain cannot start or end with a hyphen.';
  if (s.includes('--'))                       return 'Subdomain cannot contain consecutive hyphens.';
  if (RESERVED_SUBDOMAINS.has(s))             return `"${s}" is a reserved word. Pick something else.`;
  return null;
}
