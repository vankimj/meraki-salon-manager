# Migration Plan — Tenant Plan Schema

**Status:** Draft v1 (2026-05-09)
**Owner:** Jonathan VanKim
**Purpose:** Move tenant records from the legacy `starter / pro / enterprise` plan model to the new `solo / studio / salonPro` + Power Packs + atomic add-ons hybrid pricing.

**Why now:** The platform admin's tenant list + detail UI, the chatbot system prompt, and the marketing pricing page all reference the new plan model. Existing tenant records in Firestore still carry the legacy values. Until we migrate, the platform admin will show "starter (legacy)" badges on every existing tenant and the salon-app code paths that read `t.plan` may misbehave on tenants that already got migrated.

**Goal:** A clean, reversible cut-over that makes both the data and every code path that reads it consistent — without breaking the live salon app.

---

## Schema before / after

### Before (current)
```
tenants/{id}
  name:        string
  ownerEmail:  string
  plan:        'starter' | 'pro' | 'enterprise'
  active:      boolean
  createdAt:   ISO date
```

### After (target)
```
tenants/{id}
  name:        string
  ownerEmail:  string
  plan:        'solo' | 'studio' | 'salonPro'
  packs:       string[]   // any of: 'comms' | 'marketing' | 'ai' | 'operations' | 'brand'
  atomicAddOns: string[]  // any of: 'sms' | 'voice' | 'loyalty' | 'gusto' | 'customDomain'
  foundersMember: boolean // true if signed up before FOUNDERS_YEAR_END_ISO
  active:      boolean
  createdAt:   ISO date
  legacyPlan?: string     // preserves original plan value for audit
  migratedAt?: ISO date   // when this tenant was migrated
```

---

## Mapping rules (legacy → new)

The legacy plans don't perfectly map to the new ones — they were a different mental model. Best-effort defaults:

| Legacy plan | New plan | Default packs | Notes |
|---|---|---|---|
| `starter`    | `solo`     | `[]`         | Closest equivalent — single-location, basic features |
| `pro`        | `studio`   | `[]`         | Multi-staff salon, no advanced add-ons by default |
| `enterprise` | `salonPro` | `['operations']` | Pre-bundle Operations Pack since enterprise typically needed payroll/multi-loc |
| (missing)    | `solo`     | `[]`         | Default for any tenant with no plan field |

**Founders' Member flag default:**
- All tenants created BEFORE the Founders' Year end date (`2027-06-30`) → `foundersMember: true`
- Tenants created AFTER → `foundersMember: false`
- Override per-tenant via the platform admin UI

---

## Migration approach — three phases

### Phase 1 — Make the code dual-aware (no data changes yet)

**Goal:** All code paths that read `t.plan` should accept BOTH legacy and new values gracefully. This unblocks deploying the platform admin without breaking anything.

**Specific code changes needed:**

| File | Change |
|---|---|
| `platform-admin/src/components/TenantList.jsx` | Already done — `PlanChip` renders both legacy values (with "legacy" outline) and new values |
| `platform-admin/src/components/TenantDetail.jsx` | Already done — surfaces "Legacy plan — see migration plan" warning |
| `src/modules/admin/Admin.jsx` (salon app) | Audit any `t.plan === 'pro'` style checks and add new-plan equivalents (or use a helper that maps both) |
| `src/lib/planEntitlements.js` (new file?) | Centralized helper: `getEntitlements(tenant) → { canVoice, canMultiLocation, hasGusto, ... }`. Reads BOTH legacy plan AND new plan + packs, returns unified entitlements |
| Cloud Function entitlement checks | Same helper used server-side |

**Estimated effort:** 2-4 hours.

**Validation:** After Phase 1 ships, every existing tenant continues working unchanged. Platform admin shows the "legacy" badge on legacy plans but doesn't break.

### Phase 2 — Run the migration script (data update)

**Goal:** Convert every existing tenant's legacy plan field to the new schema, preserving audit trail.

**Where the script lives:** `scripts/migrate-tenant-plans.js` — Node script that uses the Firebase Admin SDK to bulk-update tenant docs.

**Script outline:**

```javascript
// scripts/migrate-tenant-plans.js
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const FOUNDERS_YEAR_END = '2027-06-30';

const PLAN_MAP = {
  starter:    { plan: 'solo',     packs: [] },
  pro:        { plan: 'studio',   packs: [] },
  enterprise: { plan: 'salonPro', packs: ['operations'] },
};

async function main() {
  initializeApp({ projectId: 'plumenexus-prod' });
  const db = getFirestore();
  const snap = await db.collection('tenants').get();

  let migrated = 0, skipped = 0;
  const batch = db.batch();

  for (const doc of snap.docs) {
    const t = doc.data();
    const legacyPlan = t.plan;

    // Skip if already on new schema
    if (legacyPlan && ['solo', 'studio', 'salonPro'].includes(legacyPlan)) {
      skipped += 1;
      continue;
    }

    const mapping = PLAN_MAP[legacyPlan] || PLAN_MAP.starter;
    const foundersMember = !t.createdAt || t.createdAt < FOUNDERS_YEAR_END;

    batch.update(doc.ref, {
      legacyPlan,
      plan:           mapping.plan,
      packs:          mapping.packs,
      atomicAddOns:   [],
      foundersMember,
      migratedAt:     new Date().toISOString(),
    });
    migrated += 1;
  }

  if (migrated > 0) await batch.commit();
  console.log(`Migrated: ${migrated}, Skipped: ${skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

**Run it:**
```bash
# Dry-run first (add a flag to script)
node scripts/migrate-tenant-plans.js --dry-run

# Actually run
node scripts/migrate-tenant-plans.js
```

**Estimated effort:** 1 hour to write + test, 5 minutes to run against current production (you only have 1 tenant — Meraki — and a small number of test tenants if any).

**Validation:** After running, query Firestore to confirm every tenant has the new fields. Check the platform admin UI — every "legacy" badge should be gone.

### Phase 3 — Retire legacy code paths (cleanup)

**Goal:** Once Phase 2 has run AND we've waited a few days to confirm nothing's broken, remove the legacy-plan handling from the codebase.

**Specific code changes:**
- Remove `PlanChip`'s LEGACY rendering branch
- Remove the dual-aware logic added in Phase 1 (`getEntitlements` becomes single-source-of-truth on new schema)
- Simplify any `if (t.plan === 'pro' || t.plan === 'studio')` style checks to just `if (t.plan === 'studio')`
- Optionally delete `legacyPlan` field from tenant docs (or keep it forever as audit trail — recommended to keep)

**Estimated effort:** 1-2 hours.

**Validation:** Full salon app + platform admin smoke test. Check that no tenant inadvertently lost access to a feature they had under legacy.

---

## Rollback plan

If anything goes wrong during Phase 2 (data migration):

1. **The legacyPlan field is preserved.** Re-running the migration is idempotent (skips tenants already on new schema).
2. **Reverse migration script:** A second script that maps `solo → starter`, `studio → pro`, `salonPro → enterprise`, and clears `packs/atomicAddOns/foundersMember`. Available as `scripts/migrate-tenant-plans.js --revert`.
3. **Per-tenant manual override:** From the platform admin, you can edit any tenant's plan field directly to fix individual broken cases.

If anything goes wrong during Phase 3 (code cleanup):
- Revert the deploy with `npm run rollback:prod`
- The data is unchanged; only code paths revert

---

## Order of operations (recommended sequence)

| Step | What | When |
|---|---|---|
| 1 | Build platform admin (Phase 1 partial — UI dual-aware) | ✅ Done |
| 2 | Add `getEntitlements` helper to salon app (Phase 1 complete) | TODO before deploying platform admin |
| 3 | Write + dry-run migration script | TODO |
| 4 | Run migration script in production (small dataset — minutes) | TODO |
| 5 | Verify in platform admin: zero legacy badges remaining | TODO |
| 6 | Wait 7 days, monitor for any user reports | TODO |
| 7 | Deploy Phase 3 cleanup (code path simplification) | TODO |

**Do not deploy the platform admin to production until step 2 is complete.** Otherwise legacy-plan tenants might confuse the entitlement system in the salon app when you start manually changing their plans from the platform admin.

---

## Open questions

- **Do we keep legacy plan values as a record forever?** Recommendation: yes, write to `legacyPlan` field and leave it indefinitely. It's a few bytes per tenant and might be useful for billing reconciliation if anyone asks "what did I sign up under?"
- **What's the first thing each migrated tenant gets?** Default packs are empty in the migration. Owner can opt into packs via their own settings. Optional: send a one-time email to legacy tenants explaining the new model and offering 30 days of any pack free as a "thank you for being early."
- **Subdomain migration:** `tipflow.app` references in old tenant docs (if any) need to be renamed to `plumenexus.com`. Check for `subdomain` or `webfrontUrl` fields. Likely a separate migration.

---

## Done definition

- [ ] All code paths read both legacy + new plan values gracefully (Phase 1)
- [ ] Migration script written, dry-run validated, run in production (Phase 2)
- [ ] Platform admin shows zero "legacy" badges (Phase 2)
- [ ] Code paths simplified to handle only new schema (Phase 3)
- [ ] Salon app + platform admin smoke-tested end-to-end
- [ ] This document marked complete and archived

---

## Document changelog

- **v1 — 2026-05-09** — initial draft, written alongside platform-admin scaffolding
