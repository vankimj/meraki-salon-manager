# Cross-Tenant Access Audit

**Status:** Audit v5 (2026-05-10)
**Owner:** Jonathan VanKim
**Purpose:** Methodical review of every cloud function and access path to verify principle #10 — *founder cannot read tenant customer data without invitation*. Documents what each function does, who can call it, what data it touches, and whether it could leak data to the founder's UI.
**Cadence:** Re-run before every release that adds new functions or changes access patterns.

---

## Executive summary

**49 cloud functions audited. Findings:**

| Category | Count | Principle #10 status |
|---|---|---|
| Auth-gated tenant operations (caller must be tenant staff/admin) | 21 | ✅ Safe — caller is acting on their own tenant |
| Document triggers (fire on tenant doc change, act in same tenant) | 15 | ✅ Safe — all use `{tenantId}` wildcard (v3) |
| Scheduled / batch | 8 | ✅ **6 multi-tenant via `forEachActiveTenant` (v2). 2 still single-tenant — see below.** |
| Public unauthenticated (booking, contact form, Stripe/Twilio webhooks) | 4 | ✅ Safe — write to specific tenant identified by request |
| Platform admin chokepoint | 2 | ✅ Safe — sanitized, returns metadata only |

**Top findings:**

1. **Nothing in production violates principle #10.** The platform admin chokepoint returns sanitized metadata only; tenant-staff endpoints gate on the caller's tenant role.
2. **Scheduled-function SaaS-readiness gap closed in v2.** All 6 cron-driven scheduled functions now iterate `tenants/*` via the `forEachActiveTenant` helper instead of hardcoded `TENANT_ID`. A new tenant onboarded today will receive reminders, birthday/lapsed campaigns, and scheduled marketing sends without code changes. Per-tenant failures are isolated so one broken tenant cannot block the rest of the sweep.
3. **The platform admin chokepoint is the only intentional cross-tenant code path that returns data.** `listTenants` + `getTenantMetadata` are auth-gated to the platform admin allowlist and return only sanitized fields. They're the single audit surface to keep tight as the platform admin grows.
4. **Document triggers fully multi-tenant (v3).** All 9 doc triggers that previously bound `document:` paths to `tenants/${TENANT_ID}/...` now use the `tenants/{tenantId}/...` wildcard and read `event.params.tenantId` inside the handler. A new tenant writing to their own `appointments`, `receipts`, `campaigns`, etc. will fire the same triggers as Meraki.

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
| `chatWithSalon` | Public-website AI chatbot | Accepts tenantId (v5); 60/hr per-IP rate limit |
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

### Category B — Document triggers (15) ✅ all multi-tenant

Pattern: function fires when a Firestore doc changes. Scope determined by the doc's path. As of v3, every trigger uses the `tenants/{tenantId}/...` wildcard and reads `event.params.tenantId` to scope its work — so they fire identically for every tenant.

| Function | Triggered on | Multi-tenant |
|---|---|---|
| `sendReceiptEmail` | `tenants/{tenantId}/receipts/{rid}` create | ✅ wildcard |
| `sendMarketingCampaign` | `tenants/{tenantId}/campaigns/{cid}` create | ✅ wildcard |
| `sendReviewRequestEmail` | `tenants/{tenantId}/reviewRequests/{rid}` create | ✅ wildcard |
| `sendAccessRequestNotification` | `tenants/{tenantId}/requests/{uid}` create | ✅ wildcard |
| `notifyOnCheckIn` | `tenants/{tenantId}/appointments/{apptId}` update | ✅ wildcard |
| `sendApptNotification` | `tenants/{tenantId}/notifications/{nid}` create | ✅ wildcard |
| `sendBookingConfirmation` | `tenants/{tenantId}/appointments/{apptId}` create | ✅ wildcard |
| `sendChatNotification` | `tenants/{tenantId}/chatNotifications/{nid}` create | ✅ wildcard |
| `sendReviewReceivedNotification` | `tenants/{tenantId}/reviewReceived/{did}` create | ✅ wildcard |
| `sendSMSCampaign` | `tenants/{tenantId}/campaigns/{cid}` create | ✅ wildcard (since launch) |
| `sendGiftCardEmail` | `tenants/{tenantId}/giftCards/{cid}` create | ✅ wildcard (since launch) |
| `twilioInboundSms` | Public webhook from Twilio | Routes by phone number → single tenant |
| `stripeWebhook` | Public webhook from Stripe | Routes by Stripe account → single tenant |
| `gustoOAuthCallback` | OAuth redirect | State param contains tenant ID |
| `trackReviewClick` | Public click tracking | Token-based, single-record scope |

### Category C — Scheduled / batch (6) — multi-tenant via `forEachActiveTenant` ✅

Pattern: cron-driven functions that fan out across every active tenant via the `forEachActiveTenant(label, cb, options)` helper (functions/index.js, defined just below the auth helpers). Per-tenant failures are isolated (try/catch around each `cb` call) and aggregate stats logged. Marketing sends opt into `{ skipPaused: true }` so they don't fire CTAs against a closed-for-pause booking page.

| Function | What | Multi-tenant strategy |
|---|---|---|
| `sendMeetingReminders` | Pre-meeting reminder emails (every 15m) | `forEachActiveTenant` — meetings collection per tenant |
| `sendDailyReminders` | Daily appt reminder sweep (09:00 ET) | `forEachActiveTenant` — subject line uses tenant name |
| `sendTechAppointmentReminders` | T-15min tech reminder (every 5m) | `forEachActiveTenant` — settings, employees, timeOff per tenant |
| `autoBirthdayCampaign` | Daily birthday wishes (10:00 ET) | `forEachActiveTenant` + `skipPaused` — body/subject use tenant name |
| `autoLapsedCampaign` | Win-back campaigns (Mon 11:00 ET) | `forEachActiveTenant` + `skipPaused` |
| `runScheduledCampaigns` | Marketing campaign sweep (every 1m) | `forEachActiveTenant` — race-safe per-campaign claim transaction |

**Important:** the cross-tenant iteration is **intentional and necessary** — these functions HAVE to read appointment/client data for ALL tenants to send reminders on each tenant's behalf. The principle #10 enforcement is that **none of this data is ever returned to the platform admin or any UI accessible to the founder**. The functions only push it back out to each tenant's own clients (via AWS SES / Twilio with the tenant's own from-address / sending number).

**`forEachActiveTenant` semantics:**
- Iterates `db.collection('tenants').get()` (no `where`, so legacy tenants without an `active` field are still included)
- Skips when `tenant.active === false` (reserved for admin-suspended tenants)
- Optional `{ skipPaused: true }` — also skips when `data/settings.pause.until` is today or in the future (used by birthday/lapsed marketing only)
- Per-tenant try/catch — a broken tenant logs and continues; the rest of the sweep still runs
- Logs `[label] tenants=N ran=N skipped=N failed=N` at the end for Cloud Logs visibility

**Branding:** the `from:` address for emails is per-tenant via `tenantFromAddress(db, tenantId)`, which reads `tenants/{id}/data/branding.fromAddress` (BYO override) or falls back to `${tenantName} <noreply@send.plumenexus.com>` on the shared AWS SES identity. Fixed in v4 (2026-05-10).

### Category C-bis — Single-tenant scheduled (1)

| Function | What | Refactor priority |
|---|---|---|
| `generateAnnual1099s` | January 30 annual 1099 generation from `payrollRuns` | **Low** — runs once per year, easy to convert to `forEachActiveTenant` before the next cycle. Doesn't violate principle #10; just won't generate forms for non-Meraki tenants until refactored. |

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
1. ✅ **Done (v2 — 2026-05-09)** — 6 cron-driven scheduled functions refactored to iterate all active tenants via `forEachActiveTenant`.
2. ✅ **Done (v3 — 2026-05-10)** — 9 document triggers refactored to use `tenants/{tenantId}/...` wildcard paths and `event.params.tenantId`. Includes `notifyOnCheckIn` (added in the v2 PII hardening pass) which the v2 audit had missed. `buildReminderHtml` helper updated to take `tenantId` as a parameter so its `apptManageUrl` call resolves to the correct tenant.
3. ✅ **Done (v5 — 2026-05-10)** — `chatWithSalon`, `chatWithReports`, `voiceCommand`, `draftConflictMessages`, `createPaymentIntent`, and `refreshGoogleReviews` all accept `tenantId` from request data (validated `[a-z0-9-]{1,64}`), fall back to `TENANT_ID` for legacy callers, and gate auth/staff/admin checks against the supplied id. `chatWithSalon` got an IP-rate-limit (60/hr) since it's public + bills Anthropic per call. Frontend salon-app callers (CheckoutModal, ScheduleAdmin, VoiceAssistant, ReportsAdmin, SalonWebfront, Admin) now pass `tenantId: TENANT_ID` from the subdomain-resolved constant in `src/lib/tenant.js`.
4. **Audit all `webfront` config endpoints** — frontend `fetchWebfrontConfig`/`fetchGoogleReviews` are already multi-tenant via the subdomain-resolved `tenantDoc()` helper (no changes needed). Cloud-function `refreshGoogleReviews` swept up under #3 above.
5. **Replace TenantsTab in salon app** with deep-link to platform admin (`platform-admin.web.app`).
6. ✅ **Done (v4 — 2026-05-10; SES cutover 2026-05-17)** — `RESEND_FROM` env var removed in favor of `tenantFromAddress(db, tenantId)` helper. Default sender is `${tenantName} <noreply@send.plumenexus.com>`; per-tenant override via `tenants/{id}/data/branding.fromAddress`. The two platform-level emails — onboarding welcome and `submitContactInquiry` admin notification — explicitly hardcode `Plume Nexus <noreply@send.plumenexus.com>` since they're not tenant-bound. **Prerequisite met:** `send.plumenexus.com` verified in AWS SES us-west-2 on 2026-05-17.

### Ongoing
1. **Re-run this audit** before any release that adds new cloud functions.
2. **Code review checklist:** every PR that adds a function must answer "what tenant data does this touch and who can call it?"
3. **Per-PR check on `listTenants` and `getTenantMetadata`:** are any new fields being added that expose customer data? If yes, reject.
4. **Quarterly penetration test:** specifically attempt cross-tenant data leakage from a non-tenant user account.

---

## Document changelog

- **v5 — 2026-05-10** — 6 callables refactored to accept `tenantId` as a request param: `chatWithSalon`, `chatWithReports`, `voiceCommand`, `draftConflictMessages`, `createPaymentIntent`, `refreshGoogleReviews`. Each validates the id format and gates `requireTenantStaff`/`requireTenantAdmin` against the supplied id rather than the hardcoded constant. `chatWithSalon` adds a 60/hr per-IP rate limit since it's public + bills Anthropic. Frontend salon-app surfaces (booking page chat, reports AI, voice assistant, conflict-message drafter, POS Stripe checkout, webfront-tab Google reviews refresh) updated to pass `tenantId: TENANT_ID` from the subdomain-resolved constant. The branding fallbacks (booking URL, salon name in system prompts) prefer per-tenant data and only fall back to Meraki defaults when the legacy `tid || TENANT_ID` path triggers.
- **v4 — 2026-05-10** — `RESEND_FROM` env var replaced by `tenantFromAddress(db, tenantId)` helper that resolves to either `tenants/{id}.fromAddress` (BYO override) or the shared `${tenantName} <noreply@plumenexus.com>`. ~25 send-sites refactored. In-process per-tenantId cache (Map) avoids one Firestore read per outbound email. Two platform sends (onboarding welcome, contact-inquiry notification) bypass the helper and hardcode the platform identity since they're not tenant-bound. Discovered + fixed a quiet regression: `tenants/meraki` document didn't exist (Meraki predates the SaaS tenant-doc schema); `forEachActiveTenant` uses `.get()` on the tenants collection, which excludes implicit parents — so the v2 scheduled-function fan-out had been silently no-op for Meraki for ~24 hours. New script `scripts/set-meraki-from-address.cjs` creates / heals the Meraki registry doc with name, ownerEmail, fromAddress, active, subdomain, aliases.
- **v3 — 2026-05-10** — All 9 remaining document triggers refactored to `tenants/{tenantId}/...` wildcard paths with `event.params.tenantId` reads. Includes `notifyOnCheckIn` (which the v2 audit didn't flag — it was added during the v2 PII hardening pass and inherited the same hardcoded path). Twilio + Stripe billing + Gusto `defineString`/`defineSecret` declarations moved to top-of-file so scheduled-function `secrets:` arrays don't hit the const temporal-dead-zone at module load.
- **v2 — 2026-05-09** — 6 of the 8 scheduled functions refactored to iterate all active tenants via the new `forEachActiveTenant(label, cb, options)` helper in functions/index.js. Birthday + lapsed campaigns opt into `{ skipPaused: true }`. `generateAnnual1099s` deferred (annual cadence, low priority). Document triggers (8 in Category B) still bind their `document:` paths to `${TENANT_ID}` and need a separate refactor — added to "Before tenant #2 onboards" recommendations.
- **v1 — 2026-05-09** — initial audit. 49 functions classified, 0 violations of principle #10 found in current code. Identified 8 scheduled functions needing multi-tenant refactor before tenant #2 onboards (separate work item, not a principle violation).
