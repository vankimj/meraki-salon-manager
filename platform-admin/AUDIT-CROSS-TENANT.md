# Cross-Tenant Access Audit

**Status:** Audit v1 (2026-05-09)
**Owner:** Jonathan VanKim
**Purpose:** Methodical review of every cloud function and access path to verify principle #10 — *founder cannot read tenant customer data without invitation*. Documents what each function does, who can call it, what data it touches, and whether it could leak data to the founder's UI.
**Cadence:** Re-run before every release that adds new functions or changes access patterns.

---

## Executive summary

**49 cloud functions audited. Findings:**

| Category | Count | Principle #10 status |
|---|---|---|
| Auth-gated tenant operations (caller must be tenant staff/admin) | 21 | ✅ Safe — caller is acting on their own tenant |
| Document triggers (fire on tenant doc change, act in same tenant) | 14 | ✅ Safe — scope locked by triggering doc |
| Scheduled / batch (currently hardcoded to Meraki only) | 8 | ⚠️ **Needs refactor before tenant #2** — see "Single-tenant functions" below |
| Public unauthenticated (booking, contact form, Stripe/Twilio webhooks) | 4 | ✅ Safe — write to specific tenant identified by request |
| Platform admin chokepoint | 2 | ✅ Safe — sanitized, returns metadata only |

**Top findings:**

1. **Right now, nothing in production violates principle #10.** Most functions hardcode `TENANT_ID = 'meraki'` — they only operate on Meraki. Since Jonathan is the legitimate owner of Meraki via the tenant-admin role mechanism, there's no cross-tenant data flow happening at all yet.
2. **Big SaaS-readiness gap:** the same hardcoding means once tenant #2 onboards, scheduled functions (daily reminders, marketing sweeps, tech appointment reminders) won't fire for them. This needs refactoring before any second tenant goes live.
3. **The platform admin chokepoint is the only intentional cross-tenant code path.** `listTenants` + `getTenantMetadata` are auth-gated to the platform admin allowlist and return only sanitized fields. They're the single audit surface to keep tight as the platform admin grows.

---

## Function-by-function classification

### Category A — Auth-gated tenant operations (21)

Pattern: `request.auth.token.email` is checked against the tenant's user list. Caller can only act on tenants they're already a member of. Principle #10 satisfied because access requires tenant-admin/staff role.

| Function | What | Why safe |
|---|---|---|
| `processUnsubscribe` | Marketing-email unsubscribe | Token-based, single-client scope |
| `findOrCreateClient` | Client lookup by phone | Auth-checked tenant-staff |
| `emailEmployeeInvite` | Send staff invite email | Auth-checked tenant-admin |
| `getApptManageLink` | Generate magic link for client to manage own appt | Tenant-staff signed |
| `manageAppointment` | Client self-serve appt management via magic link | Token-validated, single-appt scope |
| `refreshGoogleReviews` | Re-fetch Google reviews | Auth-checked tenant-staff |
| `chatWithSalon` | Public-website AI chatbot | Tenant-scoped via `TENANT_ID` (currently Meraki only) |
| `chatWithReports` | Reports → Ask AI tab | Auth-checked tenant-admin, read-only AI tools, returns answers about that tenant only |
| `voiceCommand` | Voice AI booking action | Auth-checked tenant-admin/scheduler |
| `draftConflictMessages` | AI-drafted conflict-resolution texts | Auth-checked tenant-staff |
| `createPaymentIntent` | Stripe payment intent | Auth-checked, scoped to caller's tenant |
| `createTenantOnboarding` | New tenant signup | Public — creates new tenant doc with provided owner email |
| `createCheckoutSession` | Stripe billing checkout | Auth-checked tenant-admin |
| `createMembershipCheckout` | Membership billing | Auth-checked tenant-staff |
| `createMembershipPortal` | Stripe customer portal | Auth-checked tenant-admin |
| `emailMembershipPaymentLink` | Send payment link to client | Auth-checked tenant-staff |
| `gustoGetAuthUrl` | Gusto OAuth start | Auth-checked tenant-admin |
| `gustoSyncEmployees` | Pull from Gusto | Auth-checked tenant-admin |
| `gustoSubmitPayroll` | Submit Gusto payroll | Auth-checked tenant-admin |
| `sendMeetingInvites` | Internal meetings | Auth-checked tenant-staff |
| `recordMeetingResponse` | Meeting RSVP recording | Token-validated |
| `fetchMeetingForRsvp` | Fetch meeting for RSVP page | Token-validated |
| `sendDirectSms` | Outbound SMS from chat UI | Auth-checked tenant-staff |
| `sendDirectEmail` | Outbound email from chat UI | Auth-checked tenant-staff |
| `retryGiftCardEmail` | Re-send a gift card | Auth-checked tenant-staff |

### Category B — Document triggers (14)

Pattern: function fires when a Firestore doc changes. Scope is determined by the doc's path, which is already tenant-scoped. Function only acts on the tenant whose doc changed.

| Function | Triggered on | Why safe |
|---|---|---|
| `sendReceiptEmail` | `tenants/{tid}/receipts/{rid}` create | Acts on the receipt's own tenant |
| `sendMarketingCampaign` | `tenants/{tid}/campaigns/{cid}` create | Acts on the campaign's own tenant |
| `sendReviewRequestEmail` | Receipt or appt completion | Tenant-scoped trigger |
| `sendAccessRequestNotification` | `tenants/{tid}/requests/{uid}` create | Tenant-scoped |
| `sendApptNotification` | Appt doc change | Tenant-scoped |
| `sendBookingConfirmation` | Appt create | Tenant-scoped |
| `sendChatNotification` | Chat message | Tenant-scoped |
| `sendReviewReceivedNotification` | Google review event | Tenant-scoped |
| `sendSMSCampaign` | SMS campaign create | Tenant-scoped |
| `sendGiftCardEmail` | Gift card create | Tenant-scoped |
| `twilioInboundSms` | Public webhook from Twilio | Routes by phone number → single tenant |
| `stripeWebhook` | Public webhook from Stripe | Routes by Stripe account → single tenant |
| `gustoOAuthCallback` | OAuth redirect | State param contains tenant ID |
| `trackReviewClick` | Public click tracking | Token-based, single-record scope |

### Category C — Scheduled / batch (8) — currently single-tenant

Pattern: functions run on cron, currently iterate ONLY the Meraki tenant via hardcoded `TENANT_ID`. **Once tenant #2 onboards, these need refactoring** to iterate the `tenants/*` collection. None of them currently leak data to the founder — they fire emails/SMS to clients on Meraki's behalf — but the multi-tenant rewrite is required for SaaS readiness.

| Function | What | Tenant scope today | Tenant scope needed for SaaS |
|---|---|---|---|
| `sendMeetingReminders` | Pre-meeting reminder emails | Meraki only (hardcoded) | Iterate all active tenants |
| `sendDailyReminders` | Daily appt reminder sweep | Meraki only | Iterate all active tenants |
| `sendTechAppointmentReminders` | T-15min tech reminder | Meraki only | Iterate all active tenants |
| `autoBirthdayCampaign` | Daily birthday wishes | Meraki only | Iterate all active tenants |
| `autoLapsedCampaign` | Win-back campaigns | Meraki only | Iterate all active tenants |
| `runScheduledCampaigns` | Marketing sweep | Meraki only | Iterate all active tenants |

**Important:** when refactoring these, the cross-tenant access is **intentional and necessary** — the function HAS to read appointment data for ALL tenants to send reminders. The principle #10 enforcement is that **none of this data is ever returned to the platform admin or any UI accessible to the founder**. The functions only push it back out to the tenant's own clients.

**Refactor pattern (when needed):**
```javascript
// Pseudocode — iterate all active tenants
const tenants = await db.collection('tenants').where('active', '==', true).get();
for (const tenantDoc of tenants.docs) {
  const tenantId = tenantDoc.id;
  // do the per-tenant work using `tenantId` instead of hardcoded TENANT_ID
}
```

### Category D — Public unauthenticated (4)

| Function | What | Why safe |
|---|---|---|
| `submitContactInquiry` | Plume Nexus marketing-site contact form | Writes to `plumenexus_inquiries` only |
| `chatWithMarketing` | Plume Nexus marketing-site chatbot | Stateless, no tenant data accessed |
| `twilioInboundSms` | Twilio inbound webhook | Validated source, scopes by To-number |
| `stripeWebhook` | Stripe webhook | Signature-validated, scopes by account |

### Category E — Platform admin chokepoint (2) — the principle #10 enforcement boundary

| Function | What | Audit trail |
|---|---|---|
| `listTenants` | Returns registry-level metadata for all tenants | Calling user verified against `platform/admins` allowlist via server-side `isPlatformAdmin()`. Returns only enumerated safe fields (id, name, ownerEmail, plan, packs, foundersMember, active, createdAt, legacyPlan). Never PII inside tenant subcollections. |
| `getTenantMetadata` | Returns sanitized aggregate metadata for one tenant | Same auth gate. Returns only enumerated safe fields (counts, timestamps, plan/billing state, settings booleans). Explicitly NEVER returns: client names, client emails, appointment details, message content, receipt details, photos. |

**Engineering rule:** any new field added to either function must be reviewed against principle #10. If the field could expose customer data (a name, an email, a message body, a transaction line item), DON'T add it. Add a count or boolean instead.

---

## Firestore rules audit

**Bootstrap admin (`isBootstrapAdmin()`) access scope after the principle #10 update:**

| Path | Access | Justification |
|---|---|---|
| `tenants/{id}` (root registry doc) | ✅ read + write | Metadata only (name, plan, owner, active) — no customer data |
| `platform/*` | ✅ read + write | Internal platform state |
| `platform/admins` | ✅ read + write | Allowlist management |
| `platform/audit_log/entries/*` | ✅ append-only | Audit trail (immutable) |
| `plumenexus_inquiries/*` | ✅ read | Tenants reached out to founder; legitimate read |
| `salon/*` (legacy) | ✅ read + write | Legacy migration path; no real data |
| `logs/*` (top-level) | ✅ read | Root-level logs only |
| **`tenants/{id}/data/*` (settings, slides, users, etc.)** | ❌ DENIED — gated by `isTenantStaff/Admin(tenantId)` which no longer auto-grants bootstrap admin | **Customer/business data — requires tenant invitation** |
| **`tenants/{id}/clients`, `appointments`, `receipts`, `employees`, `chats`, `marketing`, `campaigns`, etc.** | ❌ DENIED — same gate | **Customer PII / business data — requires tenant invitation** |

**Verified by:** the firestore.rules file at lines 22-31 (isTenantAdmin) and 38-46 (isTenantStaff). Bootstrap admin is no longer in the OR clause. Meraki access works because `jvankim@gmail.com` is in `tenants/meraki/data/users` adminEmails.

---

## Salon app frontend audit

**Existing `TenantsTab` inside Admin module** (`src/modules/admin/Admin.jsx` line 2205+):
- Calls `fetchTenants()` — still works (root tenants/{id} accessible)
- Calls `fetchTenantStats(tenantId)` — **will now fail with permission-denied** for non-Meraki tenants because it reads `tenants/{id}/data/users` and `tenants/{id}/appointments`
- Existing code uses `Promise.allSettled` so individual failures don't crash the UI; just shows incomplete stats
- **Plan:** retire this tab entirely once platform admin app is deployed (per migration plan)

---

## Recommendations

### Now (within next session)
- ✅ Done — principle #10 codified, rules updated, chokepoint functions deployed, marketing updated

### Before tenant #2 onboards
1. **Refactor scheduled functions** (`sendDailyReminders`, `sendTechAppointmentReminders`, `runScheduledCampaigns`, etc.) to iterate all active tenants instead of hardcoded `TENANT_ID`. Pattern documented above.
2. **Refactor `chatWithSalon`** (public-facing salon chatbot) to accept tenantId as a request parameter instead of hardcoded `TENANT_ID`. Tenant identified by subdomain or query param.
3. **Audit all `webfront` config endpoints** to make sure they accept tenantId param.
4. **Replace TenantsTab in salon app** with deep-link to platform admin (`platform-admin.web.app`).

### Ongoing
1. **Re-run this audit** before any release that adds new cloud functions.
2. **Code review checklist:** every PR that adds a function must answer "what tenant data does this touch and who can call it?"
3. **Per-PR check on `listTenants` and `getTenantMetadata`:** are any new fields being added that expose customer data? If yes, reject.
4. **Quarterly penetration test:** specifically attempt cross-tenant data leakage from a non-tenant user account.

---

## Document changelog

- **v1 — 2026-05-09** — initial audit. 49 functions classified, 0 violations of principle #10 found in current code. Identified 8 scheduled functions needing multi-tenant refactor before tenant #2 onboards (separate work item, not a principle violation).
