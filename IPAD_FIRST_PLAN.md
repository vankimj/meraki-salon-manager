# Plume Nexus — iPad-First Strategy

_Drafted 2026-06-04. The thesis: make the native app the **primary staff surface** a salon runs on (iPad at the front desk, iPhone in hand), with the web demoted to client-facing + power-admin. This matches how GlossGenius / Square / Vagaro actually work (all iPad-first) and is the only path to in-person payments._

---

## 1. The reframe

Today: web = everything; mobile = a tech companion. Going forward:

| Surface | Role | Primary users |
|---|---|---|
| **iPad app** | Run the salon: schedule, checkout/POS, clients, walk-ins, day-to-day admin | Front desk, owner, techs |
| **iPhone app** | Same app, in-hand: my day, earnings, chat, quick edits | Techs, roaming owner |
| **Web** | Public **client booking page** + **marketing site/SEO**; power-admin & bulk ops; fallback | Clients (booking), owner (deep config) |

Web is **not** retired. It keeps the things a phone/tablet is genuinely worse at (SEO booking page, bulk CSV import, long-form config) and serves as a desktop fallback. Everything *staff-operational* moves app-primary.

> **iPhone is a first-class target, not an afterthought.** "iPad-first" means we *design* for the front-desk tablet, but **every feature must remain fully functional on iPhone** (it's the same Expo app, one codebase). Each screen adapts to width — iPad gets master-detail / multi-column; iPhone gets the stacked/push version. We decide the per-screen layout (and any "this is awkward on a phone" tradeoffs) feature-by-feature **when we build it**, not up front. No iPad-only features.

## 2. Why this is the right call (not just possible)

- **Proven model** — the incumbent we're replacing (GlossGenius) *is* an iPad app; so are Square Appointments and Vagaro. iPad-first is the category norm, not a risk.
- **It unlocks POS** — the web cannot take in-person card payments. The iPad can (Stripe reader). POS/checkout is already on the roadmap and stubbed (`Tap to pay — coming soon`). iPad-first = the only way to ship it.
- **Backend already shared** — same Firestore, Cloud Functions, auth, Stripe Connect. The gaps are un-ported UI, not architecture.
- **OTA updates** — Expo Updates is already configured, so JS ships instantly (no App Store review) for everything except true native changes.

## 3. The real costs (eyes open)

1. **Two front-ends forever** — every UI built twice. Mitigation: keep pushing *pure logic* into shared copies (already doing: `metrics.js`, `modules.js`, `userProjections.js`). UI stays duplicated; accept it.
2. **Form factor work** — the app is currently iPhone-portrait (`supportsTablet:false`, fixed-width tiles). iPad needs **landscape + master-detail/multi-column layouts**. Real UI effort (see Phase 0).
3. **Hardware + Stripe Terminal onboarding** — card readers, Stripe Terminal account config, per-tenant Connect payouts. External setup, not just code.
4. **Some bulk/desktop tasks stay better on web** — and that's fine; we leave them there on purpose.

---

## 4. Build order

### Phase 0 — iPad foundation (make it a real tablet app)
- Flip `app.json` `supportsTablet: true`; add iPad to the EAS build.
- Responsive layout pass: detect width; on iPad render **master-detail** (list + detail side-by-side) instead of push-navigation, multi-column grids, and a persistent side nav instead of the bottom tab bar. Schedule becomes a full-width multi-tech day grid (the screen real estate web has).
- Landscape support + keyboard shortcuts for the front desk.
- _Outcome: the existing app looks/works like a salon iPad app, not a stretched phone._

### Phase 1 — POS / Checkout  ⭐ the centerpiece
The roadmap scope: multi-tech credit split, discounts (friends & family, promo codes, gift cards), tips, future credits, refunds with photos. Build:
- **`@stripe/stripe-react-native` + Stripe Terminal SDK** — connect a reader (BBPOS/WisePOS) per the existing **Stripe Connect** setup so each salon takes their own payments.
- **Checkout flow:** start from an appointment or the tab → add services/retail → discounts/promo/gift card → **tips** → split across techs → take card (reader) / cash → write a **`receipts`** doc in the shape Reports/Earnings already read (`payment.techSplit`, `tip`, `ccFee`, method).
- **Receipts:** SMS/email receipt (the `sendReceiptSms` path already exists) + optional Bluetooth printer.
- **Refunds** with reason/photo.
- _Outcome: a salon can actually charge a client on the iPad — the thing web can never do._

### Phase 2 — Floor-critical parity (the "real holes")
Close the gaps that matter to someone running the floor (from the parity audit), leave the desktop-y ones on web:
- **Clients:** comm-preferences + **marketing opt-out** (compliance — mobile can already *send* campaigns), referrals, manual visits.
- **Services:** **taxable** flag, variants/options, descriptions/photos.
- **Employees:** compensation + service assignment (drives POS pricing + payroll).
- **Schedule:** recurring appointments, time-off **create** UI, drag-to-reschedule (easier on iPad).
- **Memberships:** Stripe actions (payment link, cancel). **Gift cards:** void + status.
- **Reports:** filters + prior-period compare (the chart/date-range/cancellations already shipped).

### Phase 3 — Round out + de-risk
- **Meetings** second pass (currently ~20%) — only if salons use it.
- Walk-in chime + fullscreen kiosk; Attendance KPIs + breaks.
- Hardware niceties: cash drawer, barcode scanner, label printer.

### Stays on web (by design)
Public booking page + SEO, marketing site, bulk CSV import, the 40-section Settings catalog deep-config, 1099/PDF generation, AI report chat. Reachable from the app via a link when needed.

---

## 5. Maintenance discipline
- **One backend, two thin UIs.** Never fork business rules — extract to a pure module and copy verbatim (the established pattern). Pricing, tax, commission, opt-in, metrics all live as pure functions.
- **Receipts are the contract.** POS writes the same `receipts` shape Reports/Earnings/HR read — build the writer once, everything downstream "just works."
- **Feature flags / plan gating** already shared via `modules.js` — POS becomes a gated module/tile like the rest.

## 6. Dependencies / external steps (yours)
- Stripe Terminal enablement on the platform Stripe account + per-tenant Connect payout config.
- Card reader hardware (one per salon).
- Apple: iPad screenshots + the in-person-payments disclosures for App Store review.
- Decide: does POS launch on **Meraki first** (dogfood) before other tenants?

## 6b. POS status (2026-06-04)
- **Slice 1 (cash) DONE + merged** — full checkout: editable prices, products, discount, promo, gift-card redeem, tips, multi-tech split, cash; writes the canonical receipt (apptIds → no double count; clientPhone → auto receipt-SMS). Money math unit-tested.
- **Slice 2 (card) — backend DONE, on-hardware remaining:**
  1. `cd functions && firebase deploy --only functions:createTerminalConnectionToken,createPaymentIntent`
  2. `cd mobile && npx expo install @stripe/stripe-terminal-react-native` → **native rebuild** (eas dev + prod). Don't hand-pin the version.
  3. app.json: iOS Tap-to-Pay entitlement + reader/location usage strings; Stripe dashboard: register a Terminal Location.
  4. Wrap checkout in `<StripeTerminalProvider tokenProvider={tokenProvider}>` (from `mobile/src/lib/terminal.js`); `useStripeTerminal()` → iPad `discoverReaders`+`connectReader`, iPhone `connectTapToPayReader`; then `createCardPaymentIntent` → `collectPaymentMethod` → `confirmPaymentIntent` → complete with `method:'card'`, `ccFee`, `stripePaymentIntentId`.

## 7. Bottom line
There's no technical reason a salon can't run entirely on the iPad app — and doing it head-on with **POS as the wedge** is how you beat GlossGenius rather than match it. The cost is committing to two front-ends; the payoff is owning the front desk *and* the payment.
