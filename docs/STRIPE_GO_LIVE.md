# Stripe go-live runbook (test sandbox → live)

Status: **NOT executed yet.** The whole Stripe stack is built and verified in a
**sandbox** account; this is the checklist to take it live when ready.

## The fact that shapes everything
We built in a Stripe **sandbox** (`acct_1TRaMCHUT1APR56U`, `pk_test_`/`sk_test_`).
A sandbox is a **separate account** from the real **live** Plume Nexus LLC
account — it does **not** "flip to live." So **nothing carries over**: prices,
coupon, webhook, portal config, and Meraki's Connect account must all be
**recreated in the live account, live mode**. Most of it is API-able (same as
the sandbox build) once the live secret key is in hand.

⚠️ Live = **real money**: Meraki gets really charged for the Plume sub; client
card payments are real; Meraki must **re-onboard Connect with a real SSN/bank**
(the sandbox Connect account `acct_1TePXY1b9lx0AWT8` is throwaway). A real SSN
usually verifies instantly — no ID-doc tail like the test SSN forced.

Not a blocker: the wedged BQ export extensions are a *recovery* layer only
(PITR + soft-delete/Trash still cover go-live). See `project_bq_extensions_wedged`.

---

## Step 0 — Prerequisites (manual, verify on the LIVE account)
- Live account activated / KYC complete (charges enabled in *live*): https://dashboard.stripe.com/account/status
- Connect enabled + **Platform Agreement signed in live mode**: https://dashboard.stripe.com/settings/connect
  (the "Go live → Confirm integration choices" step — likely done only on the sandbox; confirm live)

## Steps 1–5 — Recreate config in LIVE (API-able; mirror these sandbox values)

| Thing | Sandbox value (to mirror in live) |
|---|---|
| Pro price $149/mo | `price_1TeHc1HUT1APR56UNovOWH6j` |
| Studio price $49/mo | `price_1TeHc1HUT1APR56UTFlOmdWo` |
| Starter price $19/mo | `price_1TeHc1HUT1APR56UvdrrTtld` |
| Starter coupon (100% off, 6mo repeating) | id `STARTER6FREE` |
| Webhook endpoint URL | `https://stripewebhook-valbwuybdq-uc.a.run.app` |
| Portal config (cancel/card/invoices, switching OFF) | sandbox `bpc_1TeIF4HUT1APR56U9UsfMvIu` |

1. **Products + Prices** (live) → new live `price_…` IDs. https://dashboard.stripe.com/products
2. **Coupon** `STARTER6FREE` (percent_off 100, duration repeating, duration_in_months 6). https://dashboard.stripe.com/coupons
3. **Webhook** at the function URL above, these **9 events** → copy live signing secret. https://dashboard.stripe.com/webhooks
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`,
   `account.updated`, `account.application.deauthorized`
4. **Customer Portal**: cancel / payment-method / invoices ON, **subscription_update OFF** (plan changes are in-app). https://dashboard.stripe.com/settings/billing/portal
   - Note: `subscription_update.products` won't persist via the raw API on this platform — but we keep switching OFF, so N/A.
5. **Connect** (live): register OAuth redirect URI `<PUBLIC_APP_URL>/?connect=oauth-callback`, grab live `ca_…` client ID, upload Express branding. https://dashboard.stripe.com/settings/connect

## Steps 6–12 — Swap keys + config (DANGER — audit the pair)
Where each value lives:
- `STRIPE_SECRET_KEY` → **Secret Manager** (`firebase functions:secrets:set STRIPE_SECRET_KEY`)
- `STRIPE_WEBHOOK_SECRET` → **Secret Manager**
- `VITE_STRIPE_PUBLISHABLE_KEY` → **root `.env`** (baked into the JS bundle at build time)
- `STRIPE_PRO_PRICE_ID` / `STRIPE_STUDIO_PRICE_ID` / `STRIPE_STARTER_PRICE_ID` / `STRIPE_STARTER_COUPON_ID` / `STRIPE_CONNECT_CLIENT_ID` → **`functions/.env`**

6. Secret Manager `STRIPE_SECRET_KEY` → `sk_live_…`
7. Root `.env` `VITE_STRIPE_PUBLISHABLE_KEY` → `pk_live_…` (**same account** as the secret)
8. `functions/.env` price IDs → live; `STRIPE_STARTER_COUPON_ID` (live coupon id); `STRIPE_CONNECT_CLIENT_ID` → live `ca_…`
9. Secret Manager `STRIPE_WEBHOOK_SECRET` → live signing secret
10. **AUDIT** (the trap that bit us 2026-06-03): `pk` + `sk` + `price_…` + `ca_…` must all be from the **same live account**. Quick check:
    ```
    grep VITE_STRIPE_PUBLISHABLE_KEY .env | cut -c1-40
    firebase functions:secrets:access STRIPE_SECRET_KEY | cut -c1-40   # compare after the version prefix
    SK=$(firebase functions:secrets:access STRIPE_SECRET_KEY); curl -s https://api.stripe.com/v1/account -u "$SK:" | grep '"id"'
    curl -s https://api.stripe.com/v1/prices/<live_price> -u "$SK:"     # must resolve, not "No such price"
    ```

## Steps 13–15 — Deploy + verify
13. **Rebuild + deploy BOTH**: `firebase deploy --only functions` AND `npm run build && firebase deploy --only hosting:app` (publishable key is build-time-baked — hosting MUST rebuild). Prod deploy must be from `main` (repo guard).
14. Webhook reachable (same URL, new secret): a forged-signature POST should return `400 "No signatures found"`.
15. Smoke-test with a **real** card (no test cards in live) — small charge + refund — and re-onboard Meraki's Connect with real details.

---

## Who does what
- **I can (via API, with the live secret key)**: create prices/coupon/webhook/portal-config; update `functions/.env`; set Secret Manager secrets; deploy. (Hits the harness approval gate for Stripe writes + secret sets.)
- **You must**: provide live `pk_live_`/`sk_live_` (never fabricated — paste or temp-file); confirm Step 0; do Dashboard-only bits (Connect/Express branding; portal products if the API quirk recurs).

## Staging recommendation
Consider phasing: **SaaS billing live first** (steps 1–4, 6–9 minus Connect), then **Connect live** (step 5 + Meraki real re-onboard) when a salon is actually ready to take cards. Lowers blast radius.

## Reference (sandbox, already done — for parity)
- Sandbox account `acct_1TRaMCHUT1APR56U`; webhook `we_1TeIAnHUT1APR56UOxFm6tnC`; portal `bpc_1TeIF4HUT1APR56U9UsfMvIu`; Meraki sandbox Connect `acct_1TePXY1b9lx0AWT8` (Standard, live+verified in sandbox, $84 test charge routed correctly).
- See memory `stripe-billing-model` for the full sandbox state + gotchas.
