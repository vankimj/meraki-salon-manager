# Subdomain Change — Design Spec

**Status:** Spec v1 (2026-05-09)
**Owner:** Jonathan VanKim
**Purpose:** Define how tenants change their subdomain (e.g. `sarahsbb.plumenexus.com` → `sarahsbeautybar.plumenexus.com`) without breaking the half-dozen places their old URL still lives in the wild.
**Why this matters now:** This decision shapes the tenant schema. The `aliases` array MUST exist before the first tenant signs up — retrofitting it after data exists is painful. Build the schema right from day one even though the UI feature ships later.

---

## The principle (binding)

**Tenants can change their subdomain. Every previous subdomain stays live as a 301 redirect to the current primary, forever.**

This is the Slack / Notion / Discord pattern. The reason it's *forever* (not "30-day grace period"):

| Where the old URL lives | When it gets seen |
|---|---|
| Business cards already printed | For years |
| QR codes on tipping kiosk / booking flyers | Until physically replaced |
| Past receipts emailed to clients | When old clients dig through their inbox |
| SMS appointment confirmations from months ago | Same |
| Marketing campaigns already sent | Same |
| Booking widgets embedded on tenant's own website | Until they update their HTML |
| Google search results | Months — Google needs time to recrawl |
| Bookmarks clients never update | Forever |

A "30-day grace period" model silently breaks all of these after the grace expires. Permanent redirect avoids the entire class of problem.

---

## Schema

### Tenant doc (`tenants/{id}`)

| Field | Type | Notes |
|---|---|---|
| `id` (doc ID) | string | The tenant's stable internal ID. **Never changes**, even when subdomain changes. UUID-style or human-readable; doesn't matter as long as it's stable. |
| `subdomain` | string | The CURRENT primary subdomain. The one in the URL bar after a fresh sign-in. |
| `aliases` | string[] | Every previous subdomain, append-only. Used for lookup + redirect. |
| `subdomainChangedAt` | ISO date | Timestamp of last subdomain change. Used to enforce 90-day cooldown. |
| `subdomainChangeCount` | number | Total lifetime changes. Used to enforce 5-alias cap. |

Example tenant after two changes:
```json
{
  "id":                    "tenant_abc123",
  "name":                  "Sarah's Beauty Bar",
  "subdomain":             "sarahsbeautybar",
  "aliases":               ["sarahsbb", "sarahbb"],
  "subdomainChangedAt":    "2026-08-15T10:30:00Z",
  "subdomainChangeCount":  2
}
```

### Reserved-subdomains collection (`platform/reserved_subdomains/{subdomain}`)

When a tenant releases an alias (extreme edge case — e.g. account deletion), the released subdomain stays reserved for **12 months** to prevent impersonation. Lives in `platform/reserved_subdomains/{subdomain}` with `reservedUntil: ISO date`.

| Field | Type | Notes |
|---|---|---|
| `formerTenantId` | string | The tenant that previously owned this subdomain |
| `releasedAt` | ISO date | When the reservation started |
| `reservedUntil` | ISO date | `releasedAt + 12 months`. After this, subdomain becomes claimable again |

---

## Lookup logic (subdomain → tenant)

When a request hits `<subdomain>.plumenexus.com`, the routing layer must:

1. **Check primary lookup:** any tenant where `tenants/*.subdomain == <requested>`. Found → serve tenant content.
2. **Check alias lookup:** any tenant where `<requested>` is in `tenants/*.aliases`. Found → 301 redirect to `https://<tenant.subdomain>.plumenexus.com<request.path><request.query>`.
3. **Check reserved lookup:** doc exists at `platform/reserved_subdomains/<requested>`. Found → serve a "this subdomain is reserved" page (NOT a 404, NOT an attacker-friendly "not found").
4. **Otherwise:** serve the marketing site (apex behavior) or a "subdomain not found" page.

**Implementation note:** queries by array-membership (`array-contains`) need a Firestore composite index. Build it before tenant #2.

---

## Constraints

| Constraint | Value | Why |
|---|---|---|
| Min time between changes | **90 days** | Prevents abuse and regret churn. Changing twice in a week probably means the first one was a mistake; force the tenant to live with it briefly. |
| Max lifetime aliases per tenant | **5** | Covers realistic rebrand scenarios (marriage, ownership transfer, name change, market repositioning, one mistake). More than 5 = something abnormal happening. |
| Alias reservation after release | **12 months** | Anti-impersonation. Prevents an attacker from taking over an old subdomain and phishing the tenant's clients via still-cached links. |
| Reserved word blocklist | `www`, `api`, `admin`, `app`, `auth`, `mail`, `support`, `help`, `status`, `docs`, `blog`, `cdn`, `static`, `assets`, `meraki`, `plumenexus`, etc. | Prevents tenants from claiming subdomains that conflict with platform infrastructure or impersonate the platform itself. |

---

## UX flow (Settings → Domain)

### Current state panel

```
┌─────────────────────────────────────────────────┐
│  Your salon URL                                 │
│  https://sarahsbeautybar.plumenexus.com         │
│                                                 │
│  Previous URLs (still working as redirects):    │
│  • https://sarahsbb.plumenexus.com  (since 2025-08-15) │
│  • https://sarahbb.plumenexus.com   (since 2024-03-10) │
│                                                 │
│  [ Change my URL ]                              │
└─────────────────────────────────────────────────┘
```

### Change-URL flow

When tenant clicks "Change my URL":

**Step 1: Big warning dialog**
```
┌─────────────────────────────────────────────────┐
│  ⚠ Changing your salon URL                      │
│                                                 │
│  Your current URL is sarahsbeautybar.plumenexus.com │
│  Your old URL will keep working forever as a    │
│  redirect — but you'll need to update places    │
│  YOU control yourself:                          │
│                                                 │
│   ☐  Google Business Profile booking link       │
│   ☐  Business cards / printed materials with    │
│      QR codes                                   │
│   ☐  Embedded booking widget on your website    │
│   ☐  Instagram / Facebook bio link              │
│   ☐  Email signatures your staff use            │
│                                                 │
│  We'll email you a printable checklist after.   │
│                                                 │
│  Note: you can change this at most once every   │
│  90 days, and at most 5 times total.            │
│                                                 │
│  [ Continue ]   [ Cancel ]                      │
└─────────────────────────────────────────────────┘
```

**Step 2: Pick the new subdomain**
```
┌─────────────────────────────────────────────────┐
│  Pick your new salon URL                        │
│                                                 │
│  https:// [____________] .plumenexus.com        │
│                                                 │
│  ✓ Available · 4 changes remaining              │
│                                                 │
│  [ Confirm change ]                             │
└─────────────────────────────────────────────────┘
```

Live availability check:
- Lowercase, alphanumeric + hyphens only, 3-30 chars
- Not in reserved-word blocklist
- Not currently in use by another tenant (primary or alias)
- Not in `platform/reserved_subdomains` collection

**Step 3: Confirmation + email**
```
┌─────────────────────────────────────────────────┐
│  ✓ Your URL is now sarahsbeautybar.plumenexus.com │
│                                                 │
│  Your old URL (sarahsbb.plumenexus.com) is      │
│  redirecting now and forever.                   │
│                                                 │
│  We've emailed you the update checklist.        │
└─────────────────────────────────────────────────┘
```

In-app banner for 30 days after change: *"Your old URL still works (redirects automatically). Don't forget to update your Google Business Profile, business cards, and Instagram bio when you can."*

---

## Cloud function: `changeSubdomain`

```javascript
// pseudocode
exports.changeSubdomain = onCall(async (request) => {
  // Auth: must be tenant admin of the tenant being changed
  if (!isTenantAdmin(request.auth, tenantId)) throw 'permission-denied';

  const { tenantId, newSubdomain } = request.data;
  const newSub = String(newSubdomain).toLowerCase().trim();

  // Validation
  if (!/^[a-z0-9-]{3,30}$/.test(newSub))            throw 'invalid format';
  if (RESERVED_WORDS.includes(newSub))              throw 'reserved word';
  if (await subdomainInUse(newSub))                 throw 'already taken';
  if (await subdomainInReserved(newSub))            throw 'recently released; available later';

  // Constraint checks
  const tenant = await getTenant(tenantId);
  if (tenant.subdomainChangeCount >= 5)             throw 'max changes reached';
  if (daysSince(tenant.subdomainChangedAt) < 90)    throw 'must wait 90 days between changes';

  // The change
  const oldSubdomain = tenant.subdomain;
  await updateTenant(tenantId, {
    subdomain:            newSub,
    aliases:              [...(tenant.aliases || []), oldSubdomain],
    subdomainChangedAt:   new Date().toISOString(),
    subdomainChangeCount: (tenant.subdomainChangeCount || 0) + 1,
  });

  // Audit log
  await audit('subdomain_changed', tenantId, { from: oldSubdomain, to: newSub });

  // Email the tenant the checklist
  await emailSubdomainChangeChecklist(tenant.ownerEmail, oldSubdomain, newSub);

  return { ok: true, newUrl: `https://${newSub}.plumenexus.com` };
});
```

---

## Same pattern for custom domains

Custom domains (`yoursalon.com` → tenant's Plume Nexus instance) follow the identical pattern:

| Field | Type | Notes |
|---|---|---|
| `customDomain` | string \| null | Current primary custom domain |
| `customDomainAliases` | string[] | Every previous custom domain, append-only |

Lookup logic checks primary AND aliases for both subdomain and custom domain on every request. Aliases of either kind redirect to the current primary subdomain (or current primary custom domain if one is set).

---

## Edge cases

### Tenant cancels account
- Tenant doc remains for 90 days post-cancellation (per principle #8 grace period)
- During that time: subdomain still resolves (so they can re-activate cleanly)
- After 90 days hard-delete: all aliases get added to `platform/reserved_subdomains` with `reservedUntil = now + 12 months`

### Tenant transfers ownership
- Subdomain stays the same (new owner inherits the URL)
- Owner-email updated on the tenant doc
- No new alias added — this isn't a subdomain change

### Tenant rebrands
- Standard subdomain change flow
- Old subdomain redirects forever
- Probably the most common reason for using this feature

### Two tenants want the same subdomain
- First-come-first-served at primary level
- If the tenant who has it changes away from it, the released subdomain enters the 12-month reservation
- After 12 months, available to the next claimant

### Tenant tries to claim a subdomain that's an alias of another tenant
- Blocked at the validation step. Aliases are owned by their tenant, even though they're not the primary.

---

## What MUST be true before tenant #2 signs up

- [ ] Tenant doc schema includes `subdomain`, `aliases`, `subdomainChangedAt`, `subdomainChangeCount` fields
- [ ] Subdomain routing layer checks primary OR aliases on every request
- [ ] Reserved-words blocklist documented
- [ ] `platform/reserved_subdomains` collection exists in firestore.rules

What can wait:
- Self-serve "Change my URL" UI (can be a support-only feature for first 6-12 months — Jonathan does it manually via platform admin)
- Email checklist template (can be drafted later)
- 30-day in-app banner (UX polish)

---

## Document changelog

- **v1 — 2026-05-09** — initial spec, written alongside principle #11 codification.
