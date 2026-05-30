# New Tenant Onboarding — Plume Nexus

How a new salon owner goes from "never heard of Plume Nexus" → "taking real bookings". This doc covers what's automated, what the owner clicks, and what still needs external setup before you can flip signups on.

---

## What's automated (shipped 2026-05-09)

### 1. Public signup at `/?signup`

Owner fills: salon name, owner name + email, plan tier (starter / pro / enterprise).

`createTenantOnboarding` Cloud Function:
- Generates a slug from the salon name (e.g. "Meraki Nail Studio" → `merakinailstudio`)
- Tries up to 5 numbered fallbacks if the slug collides (`merakinailstudio2`, `…3`, …)
- Creates `tenants/{slug}` (root registry doc) + `data/settings`, `data/slides`, `data/users`
- Pre-populates `staffEmails` and `adminEmails` arrays so Firestore rules pass for the owner immediately
- Emails the owner a Plume Nexus-branded welcome with a sign-in link

### 2. First-login wizard

When the owner first signs in to a new tenant (services count < 3 + flag not stamped), `<FirstLoginWizard />` auto-opens. Six steps:

1. **Welcome** — overview
2. **Brand** — name, tagline, color (writes to settings)
3. **Services** — pick from 6 templates (Nail Salon, Hair Salon, Barbershop, Spa, Lashes/Brows, Med Spa) → bulk-creates services
4. **Team** — add first 3 techs inline
5. **Hours** — per-day open/close (writes to settings.storeHours)
6. **Done** — list of next steps + opens Schedule

Each step writes to Firestore as it's saved. Closing mid-flow doesn't lose progress.

After completion (or skip), `settings._wizardCompleted: true` is stamped, so the wizard never re-opens for that tenant. Existing tenants like Meraki get the flag set on first load if they already have services.

### 3. Service templates

Source: `src/data/serviceTemplates.js`. Six industries × ~10 services each. Categories preserved.

To extend: add an entry to `SERVICE_TEMPLATES`. Schema:
```js
{ id, label, description, icon, services: [{ category, name, basePrice, duration, priceFrom, sortOrder }] }
```

### 4. Employee invites

After an admin adds an employee with email, the row in `EmployeesAdmin` shows a **📨 Invite** button. Click → calls `emailEmployeeInvite` cloud function → sends a branded "Sign in with Google" email pointing at the tenant's subdomain.

Tracked via `inviteSentAt` / `inviteSentTo` on the employee doc. Re-clicking shows **↻ Resend**.

### 5. Subdomain routing

`src/lib/tenant.js` recognizes:
- `*.plumenexus.com` → tenant = leftmost subdomain
- `*.plumenexus.app` → same
- `*.tipflow.app` → legacy alias
- Reserved subdomains (`www`, `app`, `api`) and bare apex domains → fall through to default tenant

So once DNS + Hosting wildcard is configured, `merakinailstudio.plumenexus.com` automatically loads tenant `merakinailstudio`.

---

## What still needs YOUR external setup (before opening signups)

### A. Wildcard DNS for `*.plumenexus.com`

**Status:** TODO. The frontend code already routes correctly; DNS just isn't pointed yet.

Setup steps:
1. In Cloudflare (or whatever DNS provider holds plumenexus.com), add a `CNAME` for `*` pointing at Firebase Hosting
2. In Firebase Console → Hosting → Add custom domain → `*.plumenexus.com`
3. Firebase will issue an SSL cert covering the wildcard (~24-48 hours)
4. Verify by visiting `test.plumenexus.com` — should hit Firebase Hosting and resolve tenant=`test`

Until done: every signup creates the Firestore tenant doc but the owner can't actually use the app — `meraki-salon-manager.web.app` always loads tenant `meraki`.

**Workaround for testing today:** set `VITE_TENANT_ID=newslug` in `.env.local` for a local dev build to simulate a fresh tenant.

### B. SaaS subscription billing (Stripe Connect)

**Status:** TODO. The `createTenantOnboarding` flow accepts a `plan` field but doesn't charge anything. New tenants get the app for free.

Setup steps:
1. In Stripe Dashboard, set up a **Stripe Connect** platform (vs the existing per-customer Stripe Terminal which is in-person card)
2. Add a Stripe Subscription product per plan tier ($79/mo Starter, $129/mo Pro, $299/mo Enterprise — adjust to actual pricing)
3. Add a Stripe Checkout step at the end of the signup form that subscribes the new tenant to your platform
4. Webhook listener: when subscription becomes `active`, set `tenants/{slug}.active = true`. When `past_due` or `cancelled`, freeze access.

**Existing infra to extend:** `stripeWebhook` already handles SaaS-tier transitions for the original `meraki` tenant via `metadata.type !== 'membership'` path. New work: gate signup access (Stripe Checkout in the wizard) and a **plan-tier enforcement helper** so each module can check `settings.plan` to gate Pro features (some `proOnly: true` flags exist already in `HomeScreen` MODULES — extend the gating).

### C. SES sending identity per tenant

**Status:** Path 2 SHIPPED. Path 1 deferred until first Pro-tier tenant asks.

All transactional + marketing emails go through AWS SES via the `sendEmail()` abstraction in `functions/index.js`. Every send is per-tenant attributed (SES Tenants feature) for reputation isolation + per-tenant suppression.

Two paths for the sender identity:

**Path 1: per-tenant verified sending domain (most professional, manual).**
- Each salon adds DKIM CNAMEs + SPF + DMARC for `send.theirbrand.com` in their DNS provider
- AWS SES verifies the identity (in `us-west-2`)
- Set `tenants/{id}/data/branding.fromAddress` to `"Salon Name <noreply@send.theirbrand.com>"`
- `tenantFromAddress()` reads that field and uses it as `from:`
- Manual ~20 min per tenant first time + SES identity-verification turnaround

**Path 2: shared SES identity (zero per-tenant work, LIVE).**
- All tenants send from the shared verified identity `send.plumenexus.com`
- Display name in the From header carries the salon brand: `"Meraki Nail Studio <noreply@send.plumenexus.com>"`
- `Reply-To:` set to the tenant's contact email so customer replies route to the salon
- Standard SaaS pattern (Klaviyo, Postmark, Mailchimp all do this)

**Status:** Path 2 is the default at `provisionTenant`. Path 1 is reserved as a Pro-tier perk; self-serve verification flow not built yet.

### D. Twilio per-tenant SMS

**Status:** Same situation as email. Single shared number today.

For a multi-tenant SaaS, options:
- **Shared SMS pool** — all tenants send from your one Twilio number, prefix with salon name in body. Cheap, fastest to ship, but inbound SMS routing gets complicated (when "Sarah" replies, which tenant does the message belong to?)
- **Per-tenant Twilio subaccounts** — each tenant gets their own Twilio number provisioned via Twilio API. Better but requires tenant onboarding to include Twilio account creation + A2P 10DLC registration (2-6 weeks per tenant for compliance approval).

**Recommendation:** ship without SMS for first 5-10 tenants; add Twilio subaccount provisioning to the wizard after that.

### E. Stripe Terminal per tenant (Tap to Pay)

**Status:** External per-tenant setup. Not blocked on you.

Each tenant who wants in-person card payments must:
1. Activate Stripe Terminal under their own Stripe account (you can't do this for them — Apple's Tap to Pay entitlement is per-merchant)
2. Apply for the Apple "Tap to Pay on iPhone" entitlement via Stripe → 2-6 week wait
3. Add their Stripe API key to their tenant settings

The mobile app code (when Capacitor ships) already routes payments via per-tenant Stripe Connection Tokens, so no platform-level work needed.

### F. Plan-tier feature gating

**Status:** Partial. `HomeScreen.jsx` MODULES has `proOnly: true` on the Marketing tile. No other gates exist.

Decide which features are Pro/Enterprise-only and gate them. Pattern to follow:

```jsx
const isPro = !settings?.plan || settings.plan === 'pro' || settings.plan === 'enterprise';
{isPro ? <MarketingAdmin /> : <UpgradeCTA />}
```

Suggested tier breakdown:
- **Starter ($79/mo):** Schedule, Clients, Services, Employees, Reports (basic), Walk-in Kiosk
- **Pro ($129/mo):** + Marketing, Memberships, AI chatbot in Reports, Voice command, AI conflict resolution
- **Enterprise ($299/mo):** + Multi-location, custom branding (Path 1 email), SSO, dedicated CSM

Apply gates via a small `useFeature(name)` hook reading `settings.plan`.

---

## Tested in this session

| Test | Result |
|---|---|
| Build passes | ✅ |
| All 209 unit tests pass | ✅ |
| `emailEmployeeInvite` rejects unauthenticated callers | ✅ (returns `UNAUTHENTICATED`) |
| `tenant.js` subdomain logic — node simulation of 6 hostnames | ✅ all correct (incl. www/apex fallback to meraki) |
| `SERVICE_TEMPLATES` exports 6 industries | ✅ |
| `createTenantOnboarding` returns proper plumenexus.com URL | ✅ (code verified) |
| Cloud Functions deployed | ✅ (createTenantOnboarding updated, emailEmployeeInvite created) |
| Frontend hosting deployed | ✅ |

## Cannot test from this session — requires browser / external

| Test | Why I can't | What you can do |
|---|---|---|
| First-login wizard renders + accepts input | Browser-only | Log in as an admin in a tenant where `services.length < 3` and `_wizardCompleted` is unset. (Quickest: temporarily delete services in the existing meraki tenant via admin UI, or set `_wizardCompleted: false` in Firestore.) |
| Service template imports correctly | Needs DB writes from the wizard UI | Run the wizard with the "Nail Salon" template — verify 9 services appear in Services module |
| Wizard auto-detects empty tenant | Needs a freshly-created tenant + sign-in flow | Use the `?signup` form to create a test tenant under a different email, then sign in as that user |
| Employee invite email lands in inbox | AWS SES send path | Add an employee with your real personal email, click 📨 Invite, check inbox + spam |
| Subdomain `merakinailstudio.plumenexus.com` resolves | Wildcard DNS not yet configured (item A) | Set up wildcard DNS first |
| Stripe Connect subscription billing | Item B not built | After building B, test with Stripe test cards 4242 |
| Plan-tier enforcement | Not implemented (item F) | After implementing, sign in to a `plan: 'starter'` tenant and verify Pro tiles are gated |

## Recommended next steps (prioritized)

1. **Wildcard DNS** (item A) — single biggest blocker; ~30 min once you decide on the domain
2. ~~**Path 2 shared-domain email** (item C)~~ — **DONE.** `send.plumenexus.com` verified in SES us-west-2; tenants default to that identity via `branding.fromAddress`.
3. **Stripe Connect SaaS billing** (item B) — needs design + ~3-5 days build. Until then, signups are technically free
4. **Plan-tier enforcement** (item F) — ~1 day; trivial pattern, just needs to be applied
5. **Path 1 per-tenant email** (item C) — only for tenants asking for it; build later as Pro upgrade

Once items 1-4 are done, signups are open for business. Items 5 + D (Twilio) + E (Stripe Terminal) are tenant-by-tenant external setup, not platform blockers.
