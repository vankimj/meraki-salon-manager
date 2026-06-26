import { db, doc, getDoc, getDocs, setDoc, addDoc, collection, query, orderBy, limit, serverTimestamp, fns, httpsCallable } from './firebase.js';
import { auth } from './firebase.js';

// Per principle #10 (founder access by invitation only), the platform admin
// must NOT read tenant data directly via the client SDK. Two cloud functions
// are the single chokepoint: listTenants + getTenantMetadata. Both server-side
// gated to platform admins; both return only sanitized fields.
const _listTenants          = httpsCallable(fns, 'listTenants');
const _getTenantMetadata    = httpsCallable(fns, 'getTenantMetadata');
const _deleteTenant         = httpsCallable(fns, 'deleteTenant');
const _setTenantSandboxMode = httpsCallable(fns, 'setTenantSandboxMode');
const _setTenantServiceControls = httpsCallable(fns, 'setTenantServiceControls');

// Flip a tenant's sandboxMode flag. When true, SMS provisioning + sending
// are fully mocked (no Twilio calls, no real charges). New tenants default
// to sandboxMode=true; platform admin flips to false to put the tenant on
// real Twilio. Audit-logged + rate-limited server-side.
export async function setTenantSandboxMode(tenantId, sandbox) {
  const res = await _setTenantSandboxMode({ tenantId, sandbox: Boolean(sandbox) });
  return res.data;
}

// Generalized per-tenant service controls. Pass only what you're changing:
//   sandbox: { sms?, email?, stripe? }  (booleans — true = sandboxed)
//   caps:    { smsPerDay?, emailPerDay?, maxChargeCents? }
// Platform-admin only, audit-logged + rate-limited server-side.
export async function setTenantServiceControls(tenantId, { sandbox, caps } = {}) {
  const res = await _setTenantServiceControls({ tenantId, sandbox, caps });
  return res.data;
}

// Hard-delete a tenant (recursive subtree drop + slug 12-month
// reservation + Auth domain removal + Twilio TFN release where
// applicable). Server gate requires confirm = `YES-DELETE-${tid}-
// IRREVERSIBLE` — we mint that here so the caller only passes tid.
export async function hardDeleteTenant(tenantId) {
  const res = await _deleteTenant({
    tenantId,
    mode:    'hard',
    confirm: `YES-DELETE-${tenantId}-IRREVERSIBLE`,
  });
  return res.data;
}

// Soft delete — flip active=false + set deletedAt. Reversible via
// updateTenantRecord({active:true}). Server still requires bootstrap-
// admin auth.
export async function softDeleteTenant(tenantId) {
  const res = await _deleteTenant({ tenantId, mode: 'soft' });
  return res.data;
}

// ── Tenant list / metadata via the chokepoint functions ─────────
export async function fetchTenants() {
  const res = await _listTenants();
  return res.data?.tenants || [];
}

export async function fetchTenantMetadata(tenantId) {
  const res = await _getTenantMetadata({ tenantId });
  return res.data;
}

// Convenience helper for the list page — derives the same fields as
// the old fetchTenantStats() but from the metadata returned by listTenants
// (so we don't need a per-tenant function call just to render the table).
export function deriveTenantStats(tenant) {
  return {
    provisioned: true, // listTenants only returns provisioned tenants from registry
    userCount:   null, // not in list payload — fetched on detail page
    apptCount:   null,
    apptCountIsApprox: false,
    settings:    {},
  };
}

// Activity for the list view also lives in the per-tenant metadata, so the
// list page either calls metadata for each row OR (better) shows last activity
// only on the detail page. For now, returns null on list — detail loads it.
export function statusFromActivity(lastIso) {
  if (!lastIso) return 'never';
  const days = (Date.now() - new Date(lastIso).getTime()) / 86400000;
  if (days < 7)  return 'active';
  if (days < 30) return 'idle';
  if (days < 90) return 'at-risk';
  return 'dormant';
}

// ── Mutations on the registry (root tenants/{id} doc) ────────────
// These write only metadata fields the platform admin legitimately controls
// (name, ownerEmail, plan, packs, active flag). They do NOT touch tenant
// customer data.
//
// Subdomain schema (per principle #11 + SUBDOMAIN-CHANGE-DESIGN.md):
//   subdomain               — the CURRENT primary subdomain (matches doc id at signup)
//   aliases                 — every previous subdomain, kept forever for 301 redirects
//   subdomainChangedAt      — null at create; ISO timestamp on each change
//   subdomainChangeCount    — 0 at create; +1 on each change (cap of 5)
// The doc id itself never changes — only `subdomain` does.
export async function createTenantRecord(id, data) {
  const slug = String(id).toLowerCase().trim();
  await setDoc(doc(db, 'tenants', slug), {
    ...data,
    subdomain:            slug,
    aliases:              [],
    subdomainChangedAt:   null,
    subdomainChangeCount: 0,
    createdAt:            new Date().toISOString(),
  });
  await audit('tenant_created', slug, { name: data.name, ownerEmail: data.ownerEmail, subdomain: slug });
}

export async function updateTenantRecord(id, data) {
  await setDoc(doc(db, 'tenants', id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
  await audit('tenant_updated', id, data);
}

// Provisioning sub-docs (data/users, data/settings, data/slides) IS a write
// into the tenant's namespace — but it only writes empty starter docs, never
// reads anything. Justification: this is necessary to make a tenant's account
// usable when the platform admin onboards them. The owner email passed in
// becomes the only entry in the new users array, so the owner has admin
// access from minute one.
export async function provisionTenantDocs(tenantId, ownerEmail) {
  const settingsRef = doc(db, 'tenants', tenantId, 'data', 'settings');
  const existing    = await getDoc(settingsRef);
  if (existing.exists()) return false;
  const now = new Date().toISOString();
  await Promise.all([
    setDoc(settingsRef, { timeoutMin: 5, createdAt: now }),
    setDoc(doc(db, 'tenants', tenantId, 'data', 'slides'), { slides: [], def: 0, cur: 0 }),
    setDoc(doc(db, 'tenants', tenantId, 'data', 'users'), {
      users: ownerEmail
        ? [{ email: ownerEmail, role: 'admin', uid: '', addedAt: now }]
        : [],
    }),
  ]);
  await audit('tenant_provisioned', tenantId, { ownerEmail });
  return true;
}

// ── Audit log ────────────────────────────────────────────────────
// Every privileged platform-admin action lands here. Append-only at rules
// layer (no updates, no deletes).
export async function audit(action, target, details = {}) {
  try {
    await addDoc(collection(db, 'platform', 'audit_log', 'entries'), {
      action,
      target: target || null,
      details,
      actor: auth.currentUser?.email || 'unknown',
      actorUid: auth.currentUser?.uid || null,
      at: serverTimestamp(),
    });
  } catch (e) {
    console.warn('[audit] write failed:', e?.message);
  }
}

export async function fetchRecentAuditEntries(n = 50) {
  try {
    const snap = await getDocs(query(
      collection(db, 'platform', 'audit_log', 'entries'),
      orderBy('at', 'desc'),
      limit(n),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[audit] read failed:', e?.message);
    return [];
  }
}
