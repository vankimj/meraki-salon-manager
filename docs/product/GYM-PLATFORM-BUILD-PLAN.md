# Plume Nexus — fitness platform build plan

**Drafted:** 2026-06-28. Reads alongside the competitor + migration docs in [`docs/competitors`](../competitors/) and [`docs/migration`](../migration/). This captures the full role-based vision, fills the gaps, answers the NFC/hardware questions, and proposes a build sequence that matches the [boutique-first strategy](../competitors/BUZZOPS-SWITCHING-STRATEGY.md).

---

## 0. The organizing principle: one platform, a spectrum of personas

Don't build "gym software." Build a **modular platform with a single spine** (auth/roles, clients, scheduling, payments, comms, reporting) and **toggle modules by tenant type.** The same product must scale from a solo trainer in a spare bedroom to a 24/7 multi-location gym — turning facility modules (door access, kiosk, front desk, staff payroll) **off** for the small end and **on** as they grow. This modularity *is* the competitive position: BuzzOps can't shrink down to a solo trainer; Trainerize/TrueCoach can't grow up to a gym; Vagaro/Mindbody force their payments and marketplace on you. Plume spans the range.

### Tenant personas (build the spine for all five)
| Persona | Needs | Does NOT need | Competes with |
|---|---|---|---|
| **Solo home-based PT** *(new — entry tier)* | Clients, scheduling, programming, Stripe payments, recurring product sales, comms, progress tracking, a public booking page | Door access, kiosk, front desk, staff/payroll | Trainerize, TrueCoach, Everfit, PT Enhance |
| **Solo PT in a commercial gym** | Above + maybe their own gym-access credential (from the gym's system) | Owning the facility stack | Same coaching tools |
| **Boutique / appointment studio** *(beachhead)* | Above + multi-trainer scheduling, simple POS, memberships/packages, optional staffed check-in | 24/7 unstaffed access | Vagaro, Mindbody, BuzzOps (overkill) |
| **Class-based studio** | Above + class scheduling w/ capacity & waitlist, member app, check-in | — | Mindbody, Glofox, BuzzOps |
| **24/7 / multi-location gym** | Everything + door access control, member app, full HR/payroll, multi-location | — | **BuzzOps**, Mindbody, ABC Ignite |

The solo home-based PT is both the **easiest to build** (it's your existing appointment/client DNA minus the facility) and the **right first customer** per strategy. Land those, climb the ladder.

---

## 1. Functions by role

Your list is in **plain text**; my additions ("what you're missing") are marked **`+`**.

### Gym Owner
- HR, payroll, credit-card processing, taxes, security, memberships, marketing, manage trainer pay, reports on everything
- **`+` Membership lifecycle & compliance:** signup, freeze/hold, upgrade/downgrade, cancellation, family/corporate plans, prepaid packages, day passes/drop-ins — **with legally-compliant self-serve cancellation** (FTC click-to-cancel + state auto-renewal laws; see §5).
- **`+` Contracts, waivers & e-sign:** liability waivers and membership agreements with digital signature, stored per member. **Non-negotiable for a gym** — don't launch the facility tier without it.
- **`+` Lead/CRM & sales pipeline:** trials, tours, lead capture, trial→member conversion, follow-up automation. This is a core BuzzOps strength and a [standing gap](../competitors/competitor-landscape.md) of ours.
- **`+` Billing operations:** failed-payment dunning/retries, card-account-updater for expiring cards, proration, refunds (with photos per roadmap), credits.
- **`+` Revenue analytics that gym owners actually run on:** MRR, churn, retention, LTV, ARPU, attendance/utilization, no-show rate, payroll-to-revenue — beyond generic reports.
- **`+` Tax breadth:** sales tax on retail (Stripe Tax), **1099-NEC for contractor trainers** vs. **W-2 payroll tax** for staff (Gusto integration is on roadmap) — the contractor/employee split is a legal landmine, see §5.
- **`+` Multi-location / franchise:** roll-up reporting, per-location staff & pricing (already a roadmap theme).
- **`+` Role-based permissions (RBAC) & audit log:** you have `role` + `logActivity` already; extend to the new roles below.
- **`+` Inventory** for retail/supplements; **gift cards, promo codes, referral program.**
- **`+` Communications compliance:** TCPA (SMS consent) + CAN-SPAM (email) baked into marketing tools.

### Front Desk
- Appointments & scheduling, automated reminders, check-in kiosk (PIN or QR off the app — **NFC: see §4**), ad-hoc sales of memberships / one-off entries / product sales
- **`+` Smart check-in:** at scan, validate membership status (active / frozen / expired / **balance due**), capacity for classes, guest passes — not just "open door."
- **`+` Full POS:** retail + memberships + packages + day passes, split tender, tips, receipts, returns.
- **`+` Member servicing at the desk:** look up account, update payment method, collect outstanding balance, sell/renew, book a trainer session on a member's behalf.
- **`+` Waitlist management** for full classes; **incident/visitor log.**

### Customers (Members)
- Door access via NFC / QR / PIN (**§4**), mobile app that tracks everything, trainer schedule access with full scheduling, progress reports (weight, body measurements, etc.), buy products from their favorite trainer **including recurring**
- **`+` Self-service membership management:** join/upgrade/freeze/**cancel** in-app, update card, view invoices/receipts/billing history (cancellation must be as easy as signup — §5).
- **`+` Digital waiver signing** at signup; **`+` class booking + waitlist + capacity visibility.**
- **`+` Workout experience:** assigned program, log workouts, watch exercise videos, see history/PRs — this is where Trainerize/TrueCoach out-feature us today; it's a [build gap](../competitors/competitor-landscape.md).
- **`+` Richer progress:** body-fat, photos, attendance streaks, goals; **wearable/health-app sync** (Apple Health, Google Fit, MyFitnessPal) — a recurring competitor pain point (Trainerize's MFP sync breaks).
- **`+` Engagement:** push notifications, challenges/leaderboards/rewards (gamification — a differentiator Enhance Tech leans on), referrals, share achievements.
- **`+` Household/family accounts** (and minors handling — §5).

### Staff (non-trainer employees)
- Gym access to start their day, clock-in kiosk, reminders (app/web), work schedules
- **`+` Time & attendance → payroll:** timesheets feeding payroll, overtime, breaks.
- **`+` Scheduling ops:** shift swaps, availability, time-off requests, open/close checklists/tasks.
- **`+` Self-service:** pay stubs, document storage with **expiry tracking** (CPR/first-aid/certifications), announcements/internal comms, onboarding.

### Personal Trainers
- Manage all clients, add/remove client photos, update profiles, create custom workout programs, 2-way client comms, upload workout videos, sell affiliated products (Plume takes a cut) incl. **recurring** (e.g. protein powder bi-weekly/monthly) with **discounts for recurring**, own schedule with clients, show earnings, own PIN + kiosk check-in + NFC + door unlock
- **`+` Program builder depth:** templates, periodization, an **exercise/video library** (our acknowledged gap — the bar is TrueCoach's 3,000+ videos), optional AI program-gen.
- **`+` Intake & assessment forms**, session/package tracking (sessions remaining auto-decrement), automated check-ins/habit tracking.
- **`+` Nutrition/macro plans** (optional, where competitors are thin).
- **`+` Their own lead pipeline & booking page** (esp. for the solo home-based PT — that *is* their storefront).
- **`+` Trainer storefront / marketplace mechanics:** product catalog, **recurring subscriptions**, discounts, commission split with the Plume cut, **payouts** — all of this is **Stripe Connect** (see §3). This recurring-affiliate-income engine is a genuine wedge no coaching tool offers well.
- **`+` Reviews/testimonials, credential display, 1099 tax docs.**

---

## 2. Cross-cutting platform capabilities (the spine)

These aren't a role — they're what every role sits on, and several are net-new vs. today's salon app:

- **Identity & roles for everyone.** Today auth is Google-only for admins ([`firebase.js`](../../src/lib/firebase.js)). You need **member, trainer, and staff auth** (email magic-link is already on roadmap) with RBAC across owner / front-desk / staff / trainer / member.
- **Payments architecture.** Stripe core (have) + **subscriptions/recurring** (memberships + trainer products) + **Stripe Connect** for trainer payouts and the platform cut + **Stripe Tax** + dunning. (Optional **Authorize.Net adapter** as a migration accelerator — see [battlecard](../migration/STRIPE-VS-AUTHNET-BATTLECARD.md).)
- **Notifications infra.** Push (mobile), SMS (Twilio — roadmap), email, in-app — one service, consent-aware.
- **Native mobile app.** Currently web/kiosk only; members and trainers expect native (iOS/Android). Biggest single build — likely React Native to reuse skills. This is the gating dependency for the member-app and door-credential features.
- **Reporting/analytics engine** feeding owner + trainer dashboards.
- **Reliability/offline.** Door access and kiosk **must work when the internet is down** — this is why you integrate a hardened access vendor rather than rolling your own (see §4).
- **Multi-tenant** (you have it) with per-tenant **module toggles** by persona (§0).

---

## 3. Trainer marketplace & recurring product sales (Stripe Connect)

You emphasized this, and it's a real differentiator, so it gets its own note. The mechanics:

- Each trainer is a **Stripe Connect connected account**. Customer pays → funds split: trainer gets their share, **Plume Nexus automatically takes its platform cut** (`application_fee`).
- **Recurring products** (protein powder monthly, coaching retainer) = Stripe **subscriptions** on the connected account; **discounts for recurring** = coupons/price tiers.
- Trainer **earnings dashboard** reads Connect balance/payouts; **payouts** handled by Stripe.
- Tax: Stripe issues/【supports】 **1099-K**; you handle trainer **1099-NEC** for commission income.
- This is the "affiliate income" pillar from the [landscape strategy](../competitors/competitor-landscape.md) — coaching tools don't do it, gym platforms don't do it. Lead with it.

---

## 4. Door access & NFC — the technical answer + hardware

**Short version: do not build your own door/NFC stack. Integrate an access-control vendor with an open API, and use QR as the universal in-app credential.** Here's the reasoning, current as of 2026.

### Can the app do NFC to unlock a door?
Partially, and it's lopsided by platform:
- **Android:** yes — Android exposes **Host Card Emulation (HCE)**, so the app can emulate a credential to an NFC reader. Workable.
- **iPhone (US):** effectively **no** for app-native NFC card emulation. Apple only opened **NFC HCE to third-party apps in the EEA** (under the EU Digital Markets Act, iOS 17.4+), and has **not** extended app-level NFC-antenna access to other regions including the US ([Apple HCE entitlement docs](https://developer.apple.com/support/hce-transactions-in-apps/), [analysis](https://paceap.com/apple-opening-the-nfc-se-on-iphones-isnt-as-revolutionary-as-we-think/)). On US iPhones, "tap to enter" works through **Apple Wallet passes**, which require going through an access-control vendor that's an Apple partner — not something you build directly.

**Conclusion:** NFC-from-phone is not a reliable cross-platform credential you can build yourself in the US. So:
- **Universal in-app credential = QR code.** Works identically on every iPhone and Android, scanned by a reader/kiosk camera. Make this the default.
- **Tap-to-enter (NFC/Wallet)** = inherit it from the access vendor (Apple/Google Wallet + Android HCE) where supported, as an upgrade — not a from-scratch build.
- **PIN keypad** = fallback / no-phone option. **Physical NFC fob/key card** = universal, cheap, for members who won't use the app.

### Recommended architecture
**Plume Nexus is the system of record** (who's a member, is it active/frozen/expired). **The access vendor is the enforcement layer** (actually unlocks, works offline). Sync over their API/webhooks: membership goes active → provision credential; frozen/expired/cancelled → revoke instantly. This also keeps you out of the safety-critical, offline-reliability business.

### Hardware to integrate (all have open APIs; all support mobile + QR + PIN + fob)
- **[Kisi](https://www.getkisi.com/industry/gym)** — strong fit: *Reader Pro* (mobile, **Apple Wallet**, fob, card), *Terminal Pro* (**QR** entry), *Intercom Pro*; explicitly **syncs with gym software so access updates on signup/renewal/cancellation**. Best-documented API for a SaaS integration. Good default recommendation.
- **[Brivo](https://www.brivo.com/resources/faq/)** — cloud access with an **open API** (manage users, subscribe to events, control devices), **Apple & Google Wallet**, plus card/fob/PIN/mobile. Enterprise-grade, multi-location.
- **Avigilon Alta (formerly Openpath)** — cards, fobs, **PINs**, smart devices, digital passes; widely integrated by other gym platforms.
- **Gym-specific** (e.g. **GymMaster** hardware, **Gantner**, **ABC Ignite**) — turnkey for gyms but more closed; better as a fallback than an integration target.

### Kiosk hardware (check-in / clock-in)
- An **iPad or Android tablet** + secure stand (you already have a kiosk UX in TipFlow). Camera handles **QR scan**; on-screen **PIN**. Add an inexpensive **USB/Bluetooth NFC reader** (e.g. an ACR122U-class reader) if you want to read physical fobs at the desk. Android tablets can additionally do NFC natively.
- Door hardware itself (electric strike / maglock + controller) comes from the access vendor, not you.

---

## 5. Compliance landmines (design these in, don't bolt on)

- **Cancellation / auto-renewal law.** FTC "click-to-cancel" + state auto-renewal statutes require cancel to be **as easy as signup**. Gyms are a top enforcement target. The ghost-member [wind-down idea](../migration/MIGRATION-PLAYBOOK.md) is fine *only* if cancellation stays easy. (Not legal advice — confirm per state.)
- **Liability waivers / e-sign** — required before anyone trains; store signed copies.
- **Contractor vs. employee** — trainers as 1099 vs. W-2 changes payroll, taxes, and scheduling control. Misclassification is costly. Decide per tenant.
- **Payment-data / PCI** — Stripe carries the PCI burden; don't ever store raw cards (see [migration playbook](../migration/MIGRATION-PLAYBOOK.md)).
- **SMS/email consent** — TCPA/CAN-SPAM in marketing.
- **Minors** — under-18 members and under-13 (COPPA) need guardian consent flows.
- **Health/fitness data** — generally not HIPAA for a gym, but body metrics/photos are sensitive; treat with care and clear consent.

---

## 6. Proposed build sequence (match the go-to-market)

Sequenced so each phase **lands a real customer persona** before building the next — avoids a 3-year platform with no users.

**Phase 1 — Solo PT (home-based or in-gym). *Your first customers.***
Spine: member/trainer auth, client management, scheduling + reminders, Stripe payments, **trainer storefront w/ recurring products (Connect)**, 2-way comms, basic progress tracking, public booking page. *No facility modules.* → Directly competes with Trainerize/TrueCoach on flat pricing + recurring income, which they lack.

**Phase 2 — Program & member experience.**
Program builder + exercise/video library (close the [coaching gap](../competitors/competitor-landscape.md)), workout logging, richer progress + wearable sync, **native mobile app** (members + trainers). → Now credible against the coaching tools and ready for studios.

**Phase 3 — Boutique / class studio.**
Multi-trainer scheduling, simple POS, **memberships/packages + waivers + compliant cancellation**, class scheduling w/ capacity & waitlist, staffed check-in kiosk (QR/PIN). → Wins the [beachhead](../competitors/BUZZOPS-SWITCHING-STRATEGY.md) studios; enables BuzzOps switchers.

**Phase 4 — Full gym / multi-location.**
**Door access-control integration** (Kisi/Brivo), full HR/payroll (Gusto), staff time-tracking & clock-in, CRM/lead pipeline, multi-location roll-ups, advanced analytics. → Now you can take 24/7 gyms head-on.

Door access and full HR are deliberately **last** — they're the heaviest, and you shouldn't build them until a paying gym is pulling for them. Everything before is reachable from your current salon/appointment foundation.

---

## 7. What I'd still pin down (open questions for you)
1. **Mobile app stack** — React Native (reuse your React skills) vs. native? Gates Phases 2–4.
2. **Solo-PT pricing** — does it fit the proposed flat $29/$59/$129, and how does the trainer-product **platform cut** interact with subscription price?
3. **Access vendor** — commit to one integration first (I'd default to **Kisi**) rather than supporting several.
4. **Trainer classification default** — 1099 vs W-2 assumptions shape payroll scope.

---

### Sources
- [`competitor-landscape.md`](../competitors/competitor-landscape.md), [`FINDINGS.md`](../competitors/FINDINGS.md), [`BUZZOPS-SWITCHING-STRATEGY.md`](../competitors/BUZZOPS-SWITCHING-STRATEGY.md), [`STRIPE-VS-AUTHNET-BATTLECARD.md`](../migration/STRIPE-VS-AUTHNET-BATTLECARD.md) — internal
- NFC: [Apple HCE transactions (EEA-only) — Apple Developer](https://developer.apple.com/support/hce-transactions-in-apps/) · [Apple opening NFC analysis — PACE](https://paceap.com/apple-opening-the-nfc-se-on-iphones-isnt-as-revolutionary-as-we-think/)
- Access hardware: [Kisi — gym access](https://www.getkisi.com/industry/gym) · [Brivo FAQ / open API](https://www.brivo.com/resources/faq/) · [Top gym access systems 2026 — WodGuru](https://wod.guru/blog/gym-access-control-system/)
