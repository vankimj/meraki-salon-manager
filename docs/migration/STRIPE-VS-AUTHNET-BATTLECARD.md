# Battlecard — Stripe (Plume Nexus) vs. Authorize.Net (BuzzOps)

**Updated:** 2026-06-28. Context: Plume Nexus runs on **Stripe**; BuzzOps gyms run on **Authorize.Net**. Use this when converting a BuzzOps gym. Companion to [`MIGRATION-PLAYBOOK.md`](MIGRATION-PLAYBOOK.md).

**One-line takeaway:** Stripe and Authorize.Net are *different categories of thing* — Stripe is an all-in-one processor + gateway + vault built this decade; Authorize.Net is a 1996-era **gateway** (Visa-owned) that usually sits in front of a *separate* merchant account. For a small/mid gym the Stripe model is simpler, cheaper to start, and modern. The one place Authorize.Net's world can win is a **high-volume gym with a negotiated interchange-plus merchant account** — be honest about that. And critically: **Stripe officially imports Authorize.Net's card vault**, so the switch doesn't force members to re-enter cards.

---

## Pricing — the headline numbers (US, 2026)

| | **Stripe** (Plume Nexus) | **Authorize.Net** (BuzzOps) |
|---|---|---|
| Monthly fee | **$0** ([stripe.com/pricing](https://stripe.com/pricing)) | **$25/mo** gateway fee ([authorize.net pricing](https://www.authorize.net/sign-up/pricing.html)) |
| Setup fee | $0 | $0 (varies by reseller) |
| Card rate (online) | **2.9% + 30¢** | **All-in-One: 2.9% + 30¢**, *or* **Gateway-only: 10¢/txn + 10¢ daily batch** *on top of a separate merchant account's rate* |
| Card rate (in person) | **2.7% + 5¢** | Depends on merchant account (gateway adds 10¢/txn) |
| ACH / eCheck | 0.8%, capped $5 | eCheck 0.75% + 10¢ (+ $25/mo on the eCheck plan) |
| Recurring billing | Core subscriptions buildable on raw API; **Stripe Billing product = +0.7%** ([billing pricing](https://stripe.com/billing/pricing)) | **ARB (Automated Recurring Billing)** included with gateway — **no extra %** |
| Card vault | **Built in** (PaymentMethods) at no add-on | **CIM** (Customer Information Manager), add-on |
| Fraud tools | **Radar** (basic included; advanced +5¢/txn) | **Advanced Fraud Detection Suite** (free, basic) |
| Payout speed | ~2 business days default; **instant payout** available | Funded by the merchant account/acquirer (often slower, batch-based) |

*Honesty flags:* Authorize.Net's **CIM and ARB add-on pricing isn't published** — resellers bundle it, and it's usually a small monthly add-on; confirm on the specific gym's statement. Stripe's headline 2.9%+30¢ has **no monthly fee**, but heavy recurring use via the **Billing product** adds 0.7% (avoidable if Plume Nexus runs subscriptions on the core API instead of the Billing product — a deliberate build choice worth making).

---

## What the structural difference actually means

**Authorize.Net is a gateway, not (by itself) a processor.** In its classic and most common gym setup, the gym has a **separate merchant account** with an acquirer, and Authorize.Net is the pipe that connects the gym's software (BuzzOps) to that account. So a gym's *real* cost = `$25/mo gateway + 10¢/txn + 10¢ daily batch + whatever their merchant account charges` (often interchange-plus, e.g. ~interchange + 0.3–0.5%). That's two vendors, two statements, two support lines — and the effective rate is whatever was negotiated, which can be **opaque**.

**Stripe collapses all of that into one.** Processor, gateway, and vault are the same account: one flat published rate, one dashboard, one payout stream, no merchant-account shopping, instant self-serve onboarding. For a solo studio or a sub-~$50–80K/mo gym, this is simpler and almost always cheaper once you count the $25/mo + per-batch + dual-vendor overhead.

**Where Authorize.Net's world can genuinely win:** a **large, high-volume gym** that has negotiated a sharp **interchange-plus** merchant account can beat Stripe's flat 2.9% on raw processing, because at volume interchange-plus undercuts blended flat rates. If a BuzzOps prospect is doing serious monthly volume and brags about a low negotiated rate, **don't pretend Stripe is cheaper on pure processing — it may not be.** Pivot to the *total* story (no $25/mo + batch fees, one system, modern tooling, instant payouts, no dual-vendor reconciliation) and to Plume Nexus's product value, not the processing basis points.

---

## Where Stripe wins (lead with these)

- **One vendor, one rate, one dashboard.** No separate merchant account, no gateway-vs-acquirer split, no $25/mo, no daily batch fee.
- **Modern developer platform.** Stripe's API is the industry standard; Authorize.Net's is a 1996-era SOAP/XML-heritage gateway. For *us* this matters enormously — every payments feature we want to build (Venmo-style flows, hosted re-add links, Terminal/in-person, payment links, instant refunds with photos per the [roadmap](../competitors/competitor-landscape.md)) is first-class on Stripe and painful on Authorize.Net.
- **Built-in vault + hosted card capture.** [Setup Intents](https://docs.stripe.com/payments/save-and-reuse) / payment links let members re-add a card on a Stripe-hosted page — zero PCI burden on us, perfect for the front-desk kiosk.
- **Instant onboarding & fast payouts.** Self-serve in minutes; instant payout option. Authorize.Net onboarding runs through a merchant-account underwriting process.
- **In-person built in.** Stripe Terminal (2.7% + 5¢) unifies online + front-desk on one ledger — exactly the salon/gym counter use case.

## Where Authorize.Net wins (don't oversell against these)

- **No per-% recurring surcharge.** ARB is included; Stripe's *Billing product* adds 0.7% (mitigate by building recurring on core Stripe).
- **High-volume negotiated rates** via a separate interchange-plus merchant account can beat flat 2.9% at scale.
- **Longevity / familiarity.** Visa-owned, since 1996; some old-school gym owners trust the name and already have a working merchant account they don't want to disturb.
- **Bank/merchant-account flexibility.** It rides on whatever acquirer the gym chose, which some multi-location operators prefer.

---

## The migration angle (the part that closes it)

**Stripe officially supports importing the Authorize.Net CIM vault** — this is the single most valuable fact on this card. Per [Stripe's PAN-import docs](https://docs.stripe.com/get-started/data-migrations/pan-import) and [payment-method imports](https://docs.stripe.com/get-started/data-migrations/payment-method-imports):

1. The gym requests its **CIM card export** from Authorize.Net (gym-owned account = straightforward; see fork below).
2. Stripe coordinates the PCI-compliant, PGP-encrypted transfer and imports the cards.
3. **Stripe returns a mapping file** (old CIM customer/card IDs → new Stripe IDs) so we attach cards to the right Plume Nexus members with **no duplicate customers**.
4. Plan for a **~4-day window** where cards exist in neither vault and can't be charged — schedule the cutover around a billing date, and tag off-session charges correctly.

**The fork that decides difficulty (confirm first):** does the gym own its **own Authorize.Net account**, or is it under BuzzOps's? Authorize.Net accounts are normally the *merchant's* (BuzzOps just integrates via API keys), which is the good case — the gym controls the vault and BuzzOps can't block the export. If BuzzOps owns the account, fall back to the re-add / ghost-member wind-down in the [playbook](MIGRATION-PLAYBOOK.md).

---

## 30-second talk track

> "BuzzOps runs your payments through Authorize.Net — a gateway from 1996 that sits on top of a separate merchant account, so you're paying a $25 monthly gateway fee plus batch fees plus your processor's cut, across two vendors. Plume Nexus runs on Stripe: one account, one rate, no monthly gateway fee, instant payouts, and modern tools like tap-to-pay at the front desk and one-tap card re-entry for clients. And because Stripe can import your saved cards straight out of Authorize.Net's vault, your members on auto-pay don't have to lift a finger — we move the cards for you."

*If they have a negotiated high-volume rate:* "Then your processing basis points might already be sharp — I won't pretend to beat a negotiated interchange-plus deal. What you're really buying with us is one system instead of three, modern payments built into the software you run the floor on, and a migration we handle for you."

---

### Sources
- [Stripe — Pricing & Fees](https://stripe.com/pricing) · [Stripe Billing pricing](https://stripe.com/billing/pricing) · [Save & reuse cards (Setup Intents)](https://docs.stripe.com/payments/save-and-reuse)
- [Authorize.Net — Plans and pricing](https://www.authorize.net/sign-up/pricing.html) · [Data migration (developer center)](https://developer.authorize.net/support/data_migration.html)
- [Stripe — PAN import](https://docs.stripe.com/get-started/data-migrations/pan-import) · [Payment-method imports](https://docs.stripe.com/get-started/data-migrations/payment-method-imports) · [Import customer card numbers from another provider](https://support.stripe.com/questions/import-customer-card-numbers-from-another-payment-provider-to-stripe)
- *Flags:* Authorize.Net CIM/ARB add-on pricing not publicly itemized (reseller-bundled, 2026); high-volume interchange-plus rates are negotiated and merchant-specific.
