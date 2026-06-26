// Pure helpers for the per-tenant service sandbox + configurable caps. No
// Firestore here so they're unit-testable; index.js wraps them with the doc
// reads (tenantSandboxFlag / getTenantCaps).

const DEFAULT_TENANT_CAPS = Object.freeze({ smsPerDay: 500, emailPerDay: 1000, maxChargeCents: 500000 });

// Effective per-service sandbox state from loaded tenant-registry data.
//   field = 'sandboxMode' | 'emailSandboxMode' | 'stripeSandboxMode'
// Explicit per-service flag wins; UNSET → inherit the master SMS sandboxMode.
// MIGRATION-SAFE: existing live tenants (sandboxMode:false, no per-service field
// yet) stay live for email + Stripe instead of being silently sandboxed. A
// missing tenant doc is treated as sandboxed (fail-safe).
function effectiveSandbox(t, field) {
  if (!t) return true;
  if (t[field] === false) return false;
  if (t[field] === true)  return true;
  return t.sandboxMode !== false;
}

// Merge a tenant's caps over the platform defaults. Non-finite/missing → default.
function effectiveCaps(t) {
  const c = (t && typeof t.caps === 'object' && t.caps) || {};
  return {
    smsPerDay:      Number.isFinite(c.smsPerDay)      ? c.smsPerDay      : DEFAULT_TENANT_CAPS.smsPerDay,
    emailPerDay:    Number.isFinite(c.emailPerDay)    ? c.emailPerDay    : DEFAULT_TENANT_CAPS.emailPerDay,
    maxChargeCents: Number.isFinite(c.maxChargeCents) ? c.maxChargeCents : DEFAULT_TENANT_CAPS.maxChargeCents,
  };
}

module.exports = { DEFAULT_TENANT_CAPS, effectiveSandbox, effectiveCaps };
