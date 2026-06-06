# Helcim as a Second Payment Processor — Implementation Plan

**Goal:** Let each salon owner choose **Stripe _or_ Helcim** as their card processor. Both must reach
full parity: online/web checkout, saved cards, in-person POS, memberships (recurring), refunds, and
disputes. Selection is **per-tenant**; the rest of the app should not care which processor is active.

**Date:** 2026-06-06 · **Scope decided:** Full parity + Helcim Smart Terminal hardware for in-person.

---

## 1. How Helcim differs from Stripe (this drives the whole design)

| Concern | Stripe (today) | Helcim (new) |
|---|---|---|
| Money model | **Platform model.** Plume is the platform; salons are Connect accounts. We use destination charges (`on_behalf_of` + `transfer_data`) and can take an application fee. | **Single merchant account per salon.** Money settles **directly** to the salon's own Helcim account. No platform clearing, no application fee. |
| Our revenue | Application fee on Connect charges. | **Partner profit-share**: send `partner-token` header on every request; Helcim pays us a share. Validate via response header `is-valid-partner-token: 1`. |
| Onboarding | Connect embedded onboarding / OAuth. | **Connected Account Registration**: refer merchant to `hub.helcim.com/signup/register?pt=<partner-token>&cid=<our-id>`, optional pre-fill via `POST /v2/applications/prefill`, approval → **webhook delivers the merchant's `api-token`**. |
| Web checkout | Stripe.js Elements (`@stripe/react-stripe-js`). | **HelcimPay.js**: backend `POST /v2/helcim-pay/initialize` → `checkoutToken` + `secretToken` (60-min TTL) → frontend renders modal via `appendHelcimPayIframe()` → validate result server-side with a `secretToken` hash. |
| Card API | `paymentIntents`, `setupIntents`, `paymentMethods`. | **Payment API** (`/v2/payment/purchase|preauth|capture|verify|refund|reverse`). Saved cards = **`cardToken`** returned on first charge; reuse the token for subsequent charges. Customer API holds `customerCode`. |
| In-person | Stripe Terminal SDK + **Tap to Pay on iPhone** (no extra hardware). | **Payment Hardware API** drives a **physical Helcim device** (Smart Terminal GEN1/GEN2, Card Reader GEN3). **No Tap-to-Pay, no Bluetooth mobile SDK.** Software submits a transaction → device prompts → **result returns via webhook.** |
| Recurring | Stripe Subscriptions + Prices. | **Recurring API** (payment plans + subscriptions). |
| Auth | Secret key per platform; per-tenant `acct_…`. | **`api-token` header, one per merchant** (stored per-tenant) + platform-wide `partner-token`. |
| Amounts | Integer **cents**. | Decimal **dollars** (e.g. `25.00`) — conversion needed at the boundary. |
| Idempotency | `Idempotency-Key` header. | Idempotency supported on v2 (header). |

**Consequence:** there is **no abstraction layer today** — Stripe is called directly in web, mobile,
and `functions/`. The bulk of this work is *introducing that seam*, then writing a Helcim adapter
behind it. Stripe behavior must stay byte-for-byte identical for existing tenants.

---

## 2. Target architecture — a processor-agnostic seam

### 2.1 Tenant config (Firestore)
Add to `tenants/{tenantId}/data/settings`:
```
payments: {
  processor: 'stripe' | 'helcim',        // default 'stripe' for every existing tenant
  helcim: {
    connectedAccountId: '<our cid>',      // the id we generate to track this merchant
    status: 'pending' | 'active' | 'rejected',
    merchantId, businessName,
    capabilities: { online, inPerson, recurring },
    devices: [{ id, type, label }],       // registered Smart Terminals
    updatedAt
  }
}
```
The **merchant `api-token` is a secret** — never store it in a Firestore doc readable by the client.
Store it in **GCP Secret Manager** as `HELCIM_TOKEN_<tenantId>` (or an encrypted server-only collection
the rules deny to all clients). Platform `partner-token` and partner `api-token` are platform secrets:
`HELCIM_PARTNER_TOKEN`, `HELCIM_PARTNER_API_TOKEN`.

### 2.2 Backend adapter interface (`functions/lib/payments/`)
Create a thin interface both processors implement; refactor existing Stripe code to sit behind it.
```
functions/lib/payments/
  index.js          // getProcessor(tenantId) -> reads settings.payments.processor, returns adapter
  types.js          // JSDoc typedefs for the normalized request/response shapes
  stripeAdapter.js  // wraps current functions/lib/billing.js + connect.js (NO behavior change)
  helcimAdapter.js  // new: calls api.helcim.com/v2, injects partner-token, $ <-> cents, hash-validate
  money.js          // centsToDecimal / decimalToCents helpers
```
Interface methods (normalized shapes, processor-neutral):
- `initOnlineCheckout({ tenantId, amountCents, currency, clientId, description })` → `{ token, provider }`
  (Stripe → PaymentIntent client_secret; Helcim → HelcimPay checkoutToken)
- `confirmOnlineResult({ tenantId, payload })` → `{ transactionId, cardToken?, last4, brand, status }`
  (Helcim: verify `secretToken` hash here)
- `chargeSavedCard({ tenantId, clientId, amountCents, savedRef, idempotencyKey })`
- `saveCard / listCards / deleteCard({ tenantId, clientId, ... })`
- `refund({ tenantId, transactionRef, amountCents })`
- `startInPersonCharge({ tenantId, deviceId, amountCents, idempotencyKey })` → returns pending; result via webhook
- `createSubscription / cancelSubscription({ tenantId, ... })` (memberships)
- `onboardingStart({ tenantId }) / onboardingStatus({ tenantId })`
- `verifyWebhook(req) / handleWebhookEvent(event)`

Existing callables (`createPaymentIntent`, `chargeStoredCard`, `createSetupIntent`, etc.) become **thin
routers**: resolve the tenant's processor, delegate to the adapter. Their request/response contracts to
the client stay stable so web/mobile changes are minimal.

**Card-on-file mapping (Stripe ↔ Helcim) — normalize behind `saveCard`/`chargeSavedCard`:**

| Concept | Stripe | Helcim | Notes |
|---|---|---|---|
| Stored-card reference (`savedRef`) | `paymentMethodId` (`pm_…`) | **`cardToken`** | the opaque vault handle the adapter persists |
| Customer record | `customerId` (`cus_…`) | **`customerCode`** | store both as `client.<processor>CustomerRef` |
| Save card w/o charging | `createSetupIntent` ($0) | **$0 Verify** txn → `cardToken` | the "add card on file" button |
| Save card during a sale | PaymentIntent + `setup_future_usage` | any Purchase/Preauth/HelcimPay → `cardToken` | every HelcimPay checkout returns one |
| Charge on file, off-session | `off_session: true` PaymentIntent | **Purchase with `cardToken`** (merchant-initiated) | no card present |
| Card metadata (brand/last4/exp) | `paymentMethods[]` array | card object on the txn/customer | keep existing `client.paymentMethods[]` shape |

Existing data model (`client.paymentMethods[]`, `defaultPaymentMethodId`, `stripeCustomerId`) is reused
as-is; for Helcim, `defaultPaymentMethodId` holds a `cardToken` and the customer ref is a `customerCode`.
**Caveat:** stored-card charges are card-not-present → they bill at Helcim's **online** rate (~2.49% + 25¢),
not the in-person rate (same as Stripe off-session). Capture cardholder store-and-charge **consent** on the
Helcim path too (network requirement — already done for Stripe).

### 2.3 Client (web) abstraction
- A small `usePaymentProcessor()` hook reads `settings.payments.processor`.
- `CheckoutModal.jsx` branches: Stripe path = current `<Elements>`; Helcim path = load **HelcimPay.js**
  script, call the (already processor-routed) `initOnlineCheckout` callable, `appendHelcimPayIframe()`,
  await the modal's result event, hand payload back to `confirmOnlineResult`.
- `SavedCardsTab.jsx` similarly branches capture UI; the stored card list shape (`{brand,last4,exp…}`)
  is already processor-neutral — keep it, populate from `cardToken` metadata for Helcim.
- Connect onboarding UI (`ConnectEmbedded.jsx`, `Phase3Money.jsx`) gets a sibling Helcim path:
  a "Connect Helcim" button → `onboardingStart` → redirect to the Helcim registration URL; status
  card driven by `onboardingStatus`.

### 2.4 Mobile abstraction
- `mobile/src/lib/payments.js` — wraps the card-charge entry points so `CheckoutScreen`/`KioskScreen`
  don't import Stripe Terminal directly.
- **In-person on Helcim:** `CardPayButton` branches. Stripe tenant → existing Terminal/Tap-to-Pay flow.
  Helcim tenant → call `startInPersonCharge` (Payment Hardware API) targeting the salon's registered
  Smart Terminal; **poll/subscribe for the webhook-driven result** (Firestore doc the webhook writes,
  which the app already listens to) instead of an in-SDK confirm. Device picker sourced from
  `settings.payments.helcim.devices`.
- No Helcim native module is required (it's REST + hardware), which **avoids an EAS native rebuild** —
  a real advantage given the mobile-pitfalls history.

### 2.5 Webhooks
- New callable/HTTP endpoint `helcimWebhook` (sibling to `stripeWebhook`). Handles: connected-account
  approval (store `api-token` → Secret Manager, flip status to active), card-transaction result
  (in-person + async), terminal-cancel, recurring/subscription status, refund, dispute.
- Normalize Helcim events into the **same internal records** Stripe writes today (receipts, refunds,
  disputes collections) so Reports/Trash/integrity-scanner keep working unchanged.

---

## 3. Phased delivery

Each phase is a PR with tests; ship behind a feature flag (`settings.payments.processor` defaults to
`stripe`, so no existing tenant is affected until explicitly switched).

**Phase 0 — Seam + Stripe refactor (no behavior change).**
Introduce `functions/lib/payments/` with `stripeAdapter` wrapping today's logic; convert the existing
callables to routers; add `usePaymentProcessor()` + `mobile/src/lib/payments.js`. Prove parity with the
existing test suite — **zero functional change.** This is the riskiest-to-get-wrong, lowest-visible-value
phase; do it carefully and verify Stripe still works end-to-end before touching Helcim.

**Phase 1 — Helcim plumbing + secrets + onboarding.**
`helcimAdapter` skeleton, money helpers, partner-token injection, Secret Manager wiring, the
`hub.helcim.com` registration redirect, `/v2/applications/prefill`, and `helcimWebhook` handling
connected-account approval (capture `api-token`). Admin UI: "Choose your processor" + "Connect Helcim".

**Phase 2 — Online checkout + saved cards (Helcim).**
HelcimPay.js init/confirm with `secretToken` hash validation; `cardToken` vault for saved cards;
refunds. Web `CheckoutModal` + `SavedCardsTab` Helcim branches.

**Phase 3 — In-person (Helcim Smart Terminal).**
Payment Hardware API charge initiation, device registration/listing, webhook-driven result handling,
mobile `CardPayButton` Helcim branch + device picker.

**Phase 4 — Recurring memberships (Helcim).**
Recurring API subscriptions for salon memberships; map to existing membership records, refunds,
dispute handling parity.

**Phase 5 — Hardening.**
Disputes/chargebacks parity, idempotency + retry audit, reconciliation of partner profit-share,
reporting/cost-dashboard instrumentation, security review, E2E (Playwright web + mobile sim).

---

## 4. Security & correctness checklist (gate before any Helcim tenant goes live)
- [ ] Merchant `api-token` lives **only** in Secret Manager / server-only store; Firestore rules deny
      client reads. Never logged. (Memory: *UI gates are not security boundaries*, *security-first*.)
- [ ] HelcimPay.js result **always** re-validated server-side via `secretToken` hash before trusting
      a payment (never trust the client-reported success).
- [ ] `helcimWebhook` verifies authenticity before acting; idempotent on event id.
- [ ] `$`↔cents conversion centralized and unit-tested (off-by-100 bugs are catastrophic for money).
- [ ] Idempotency keys on every charge/refund; replays don't double-charge.
- [ ] Integration tests hit the Helcim **sandbox** (force-redeploy + curl the live function), not just
      mocks. (Memory: *mocking hides integration bugs*, *walk the flow before claiming ready*.)
- [ ] E2E spec for the onboarding redirect + result callback. (Memory: *e2e for external-redirect flows*.)
- [ ] Tenant-settable URLs / fields from Helcim run through `safeUrl()`.
- [ ] Reports, Trash/soft-delete, and nightly integrity scanner verified against Helcim-shaped records.

## 5. Open questions / risks to confirm before building
1. **Partner program eligibility & sandbox access** — need a Helcim partner account, `partner-token`,
   partner `api-token`, and sandbox credentials. (Action: apply to Helcim Integration Partner Program.)
2. **In-person hardware** — owners must buy Helcim hardware (cheapest: **Card Reader $199**;
   **Smart Terminal $349**, or $32/mo for 1yr; + ~$7/mo data after 2026-04-01 if not on Wi-Fi).
   Clarify device provisioning and the exact Payment Hardware API request/response + webhook contract
   against a real device. **Confirm the $199 Card Reader is drivable by the software-initiated Hardware
   API** (it may be intended for Helcim's own app, with API-initiated charges requiring the Smart
   Terminal) — this changes the salon's true hardware floor for our integration.
3. **Recurring API capabilities** — confirm it supports the membership models we offer (proration,
   cancel-at-period-end) at parity with Stripe Subscriptions.
4. **Disputes** — confirm Helcim exposes dispute/chargeback webhooks comparable to Stripe's
   `charge.dispute.*` so our alerting parity holds.
5. **Our take-rate** — partner profit-share replaces application fees; confirm the economics and how
   it's reported, since the per-transaction platform margin model differs from Stripe Connect.

---

## 6. Payments economics, hardware & business decisions

### 6.1 In-person hardware is processor-locked (no shared readers)
Card readers are **encryption-key-injected (P2PE/DUKPT) and certified to a single processor's stack** —
the card data is encrypted *to that processor* the moment it's read. Consequences:
- A **Stripe reader will not work with Helcim**, and a **Helcim terminal will not work with Stripe.** Not
  a setting — the hardware is cryptographically bound. (Even when both use the same BBPOS/PAX/Ingenico
  chassis underneath, each unit is key-locked to its own processor.)
- **Tap to Pay** (phone-as-reader, no hardware) is also processor-specific software, and **Helcim does not
  offer it at all** — only Stripe tenants get it.
- Therefore **in-person is inherently processor-bound**: a Stripe salon checks out on Stripe readers /
  Tap-to-Pay; a Helcim salon checks out on a Helcim Smart Terminal. No shared path; switching processors
  means switching hardware. The mobile POS branches on processor (Phase 3) — there is no unified reader flow.

### 6.2 The application-fee mechanics (Stripe)
- Your charges are **destination charges with `on_behalf_of`** → the **salon is merchant of record**, and
  **the platform's balance is debited for the Stripe processing fee** (not the salon).
- `application_fee_amount` is the slice that stays with the platform. **Because the platform eats the
  Stripe fee, the application fee must first cover that fee before any of it is profit.**
- **Current code defaults `application_fee_amount: 0`** ([billing.js:768](functions/lib/billing.js#L768),
  [:800](functions/lib/billing.js#L800)) → at 0, the platform **absorbs the full Stripe fee** on every
  card sale. The code comment ("Plume takes no processing markup") is misleading: 0 ≠ neutral here, it = loss.
- **To profit competitively you need BOTH levers:** (1) negotiate Stripe down to interchange-plus/volume
  pricing to lower your *cost*, then (2) set an application fee between your new cost and the competitive
  market rate (~2.6% benchmark, set by GlossGenius). The spread is your margin.

### 6.3 Worked model — $30,000/mo salon, ~500 in-person txns ($60 avg ticket)
Rates: Stripe Terminal std 2.7%+5¢ (≈$835); Stripe negotiated IC+ ≈2.3%+5¢ (≈$715); Helcim in-person
≈1.93%+8¢ (≈$619); GlossGenius benchmark 2.6% (≈$780). Helcim profit-share % is undisclosed — the
$48–80 below is **illustrative** (30–50% of Helcim's ~$160/mo margin).

| Scenario | Salon pays /mo | Plume nets /mo | Plume cost / risk | Salon vs GG ($780) |
|---|---:|---:|---|---|
| Stripe std, app fee = 0 *(current code)* | $0 | **−$835** | eats 100% of fees | salon pays $0, you bleed |
| Stripe std, app fee = cost *(break-even)* | $835 | $0 | none | +$55 worse |
| Stripe negotiated IC+, charge salon 2.6% | $780 | **~$65** | must negotiate; in fund flow | same as GG |
| Stripe negotiated IC+, charge salon 2.7% | $810 | **~$95** | same | +$30 worse |
| **Helcim** | **$619** | **~$48–80** | **none — not in fund flow** | **−$161 cheaper** |

Numbers scale linearly with volume. Interactive version: `payments-economics-calculator.html` (repo root).

### 6.4 Legality (not legal advice — confirm with a payments attorney)
- The model (SaaS + per-transaction application fee + second processor) is **conventional and legal**;
  it's what competitors do and what Stripe explicitly supports as a platform revenue model.
- **Stays on the safe side of money-transmission** *only while* using **destination charges + `on_behalf_of`**
  (salon is MoR, funds ride Stripe's licenses) and **never custodying salon funds**. The
  `connectAccountId`-required guard ([billing.js:756](functions/lib/billing.js#L756)) enforces this — keep it.
- **Must disclose** the platform fee in the salon-facing Terms of Service (required by Stripe's platform
  terms; the salon sees it on their dashboard regardless).
- **Customer surcharging is a different regime** (network rules + state law) — not in scope today; treat as
  a separate compliance project if ever built.
- **Helcim is lower regulatory surface for us**: salon owns its own merchant account, money settles directly
  to them, we never sit in the fund flow; profit-share is an ordinary referral payment from Helcim.

### 6.5 Decisions to make
- [ ] **Fix the zero-fee bleed:** decide Stripe posture — (a) keep absorbing fees as a perk, (b) set app
      fee = Stripe cost so the salon bears processing (net-zero to us), or (c) hold until IC+ pricing, then
      monetize. **This is urgent and independent of Helcim.**
- [ ] **Negotiate Stripe interchange-plus** once volume supports it (precondition to profiting on Stripe).
- [ ] **Steering policy:** small/new tenants → Helcim (cheaper for them, passive revenue for us, no fund-flow
      risk); higher-volume tenants → Stripe IC+ (we control margin + Tap-to-Pay).
- [ ] **Draft the merchant-ToS fee-disclosure clause** and have counsel review it + entity posture.
- [ ] **Add a platform-fee config field** (currently `application_fee_amount` is plumbed but never set by UI).

### 6.6 Salon-owner battle card
Full Stripe-vs-Helcim positioning (owner POV) lives in `STRIPE_VS_HELCIM_BATTLECARD.md` — source copy
for the future in-app "choose your processor" screen. Headline trade: **Helcim = lower but variable
fees, no Tap-to-Pay, requires a terminal; Stripe = predictable flat fees + Tap-to-Pay, costs more.**

---

## 7. Key reference docs
- Payment API — https://devdocs.helcim.com/docs/payment-api
- HelcimPay.js (init + integrate) — https://devdocs.helcim.com/docs/overview-of-helcimpayjs
- Connected Account Registration — https://devdocs.helcim.com/docs/connected-account-registrations
- Programmatic Revenue Share (partner-token) — https://devdocs.helcim.com/docs/programmatic-revenue-share
- Payment Hardware / Smart Terminal API — https://devdocs.helcim.com/docs/overview-of-payment-hardware-api
- Recurring API — https://devdocs.helcim.com/docs/overview-of-helcim-api
- Integration Partner Program — https://devdocs.helcim.com/docs/integration-partner-program
