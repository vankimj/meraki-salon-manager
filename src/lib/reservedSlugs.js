// Slugs that NO tenant can claim as their plumenexus.com subdomain.
//
// Sources:
//   - Platform infrastructure (admin, api, www, etc.) — needed for our own
//     subdomains
//   - Brand defense (plume, plumenexus, plumeapp) — anti-impersonation
//   - Common-attack vectors (auth, login, signup, oauth) — phishing risk
//   - Reserved DNS / IANA names (mail, ftp, smtp) — confusing
//   - Profanity / abuse terms — light list; comprehensive filtering belongs
//     in a content-moderation pass at signup, not here. This list catches
//     the obvious ones that would damage Plume Nexus's brand if a tenant
//     squatted them.
//
// Used by:
//   - Cloud Function `provisionTenant` for server-side enforcement
//   - signup UI for live availability feedback
//   - Migration: pre-seeded into platform/reservedSlugs Firestore doc on
//     first run so admin-side audit tooling sees one source of truth
//
// To add: edit this list, deploy, re-run scripts/sync-reserved-slugs.cjs to
// mirror into Firestore.

export const RESERVED_SLUGS = [
  // ── Platform infrastructure ─────────────────────────────────────────
  'admin', 'api', 'app', 'apps', 'auth', 'cdn', 'cloud', 'console', 'core',
  'dashboard', 'data', 'db', 'demo', 'dev', 'docs', 'email', 'files',
  'go', 'help', 'host', 'hosting', 'images', 'img', 'ingest', 'jobs',
  'login', 'logout', 'logs', 'mail', 'manage', 'monitor', 'oauth', 'pay',
  'platform', 'preview', 'prod', 'public', 'queue', 'redirect', 'register',
  'reports', 'root', 'secure', 'security', 'signin', 'signup', 'sms',
  'sso', 'staff', 'stage', 'staging', 'static', 'stats', 'status', 'store',
  'studio', 'support', 'sys', 'system', 'test', 'tests', 'try', 'use',
  'user', 'users', 'webhook', 'webhooks', 'webfront', 'wp', 'www', 'www2',
  'www3',

  // ── Common DNS / RFC ────────────────────────────────────────────────
  'autodiscover', 'autoconfig', 'cpanel', 'ftp', 'ftps', 'imap', 'mx',
  'mx1', 'mx2', 'ns', 'ns1', 'ns2', 'ns3', 'pop', 'pop3', 'sftp', 'smtp',
  'srv', 'vpn', 'webmail',

  // ── Brand defense ───────────────────────────────────────────────────
  'plume', 'plumenexus', 'plumeapp', 'plumeapps', 'plume-nexus', 'plumenex',
  'meraki', 'merakinails', 'merakinailstudio',
  'tipflow', 'tipflowapp', 'gloss', 'glossgenius',

  // ── Routes we may want for the marketing or product site ────────────
  'about', 'blog', 'careers', 'community', 'contact', 'cookies', 'faq',
  'feedback', 'forum', 'home', 'jobs', 'legal', 'news', 'partners',
  'press', 'pricing', 'privacy', 'product', 'roadmap', 'sales', 'shop',
  'terms', 'tos', 'why',

  // ── Auth / billing / accounts ───────────────────────────────────────
  'accounts', 'billing', 'checkout', 'invoice', 'invoices', 'paid',
  'payment', 'payments', 'refund', 'refunds', 'subscription',
  'subscriptions',

  // ── Abuse / impersonation risk ──────────────────────────────────────
  'abuse', 'admin1', 'administrator', 'attack', 'bank', 'bot', 'cash',
  'cheat', 'free', 'fraud', 'gift', 'gov', 'hack', 'irs', 'official',
  'phish', 'phishing', 'police', 'porn', 'porno', 'reward', 'rewards',
  'scam', 'sex', 'spam', 'tax', 'taxes',

  // ── Squatting bait ──────────────────────────────────────────────────
  'a', 'aa', 'ab', 'abc', 'an', 'ap', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
  'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v',
  'w', 'x', 'y', 'z',
  'no', 'null', 'undefined', 'void', 'none', 'nil',
  'me', 'my', 'us', 'we', 'you',

  // ── Generic salon-business words (to prevent squatting market terms) ─
  'salon', 'salons', 'spa', 'spas', 'nails', 'beauty', 'studio', 'studios',
  'hair', 'barber', 'barbers',
];

const RESERVED_SET = new Set(RESERVED_SLUGS);

export function isReservedSlug(slug) {
  return RESERVED_SET.has(String(slug || '').toLowerCase().trim());
}

// Slug format constraint: lowercase, alphanumeric + hyphens, 3-30 chars.
// Matches the rule in [[SUBDOMAIN-CHANGE-DESIGN]] step "Live availability check".
const SLUG_FORMAT_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

export function isValidSlugFormat(slug) {
  return SLUG_FORMAT_RE.test(String(slug || '').trim());
}

export function slugErrors(slug) {
  const s = String(slug || '').trim();
  if (!s)                      return 'Required';
  if (s.length < 3)            return 'Min 3 characters';
  if (s.length > 30)           return 'Max 30 characters';
  if (!isValidSlugFormat(s))   return 'Lowercase letters, numbers, hyphens (no leading/trailing hyphen)';
  if (isReservedSlug(s))       return 'Reserved — pick another';
  return null;
}
