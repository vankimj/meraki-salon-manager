# Stripe Sandbox Testing Runbook

End-to-end verification of every Stripe-driven flow in the app before flipping
to live mode. Run through this list whenever you touch billing code, change
Stripe products, or rotate webhook secrets.

> **Sandbox = Stripe's test environment.** Cards never charge real money. Use
> the test cards listed at the bottom. Stripe used to call this "test mode";
> as of 2025 it's "sandbox" in the Dashboard nav.

## 0. One-time setup

### 0a. Stripe CLI
```bash
brew install stripe/stripe-cli/stripe
stripe login                    # opens browser, links CLI to your account
stripe config --set device_name plumenexus-dev
```

### 0b. Sandbox project secrets
Make sure the sandbox-mode secrets are set in Cloud Secret Manager:
```bash
firebase functions:secrets:set STRIPE_SECRET_KEY     # paste sk_test_... from sandbox
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET # see step 0c
```

And `functions/.env`:
```
STRIPE_PRO_PRICE_ID=price_test_...     # from sandbox Dashboard
STRIPE_STUDIO_PRICE_ID=price_test_...
STRIPE_STARTER_PRICE_ID=                # leave blank if no paid Starter
```

Root `.env`:
```
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### 0c. Webhook forwarding (local dev)
For local testing, forward Stripe events to the emulator (or staging URL):
```bash
# Terminal 1: run emulators
firebase emulators:start --only functions

# Terminal 2: forward events
stripe listen --forward-to http://localhost:5001/plumenexus-prod/us-central1/stripeWebhook
# → prints a NEW webhook signing secret like whsec_xxx
# Copy that secret and set STRIPE_WEBHOOK_SECRET to it for local runs.
```

For staging/prod, set up the webhook endpoint in Stripe Dashboard →
Developers → Webhooks pointing at the deployed `stripeWebhook` URL.

### 0d. Customer Portal config
Stripe Dashboard → Settings → Billing → Customer Portal → enable. Required:
- Update payment method ✓
- Cancel subscription ✓
- View invoice history ✓
- **Subscriptions → Plans → add both Studio and Pro as switchable products**
  ← without this, plan-switch UI won't appear to customers even though the
  webhook is wired

## 1. SaaS subscription flows

### 1.1 New tenant signup creates 14-day trial
1. Open `/?signup` in the app
2. Fill in salon name + email → create salon
3. **Check Firestore** `tenants/{id}`:
   - `plan: 'pro'`
   - `trialEndsAt: <ISO date 14 days from now>`
4. **Check Firestore** `tenants/{id}/data/settings`:
   - `plan: 'pro'`
   - `trialEndsAt: <same ISO>`
5. **Check UI** Admin → Settings → Plan & Billing: yellow banner reading
   "14 days left in your Pro trial"

### 1.2 Trial expires without upgrade → UI downgrades to starter
1. As admin, manually set `trialEndsAt` to a past date in Firestore Console
2. Refresh the app
3. **Check UI** Home screen shows ONLY Starter modules (schedule, clients,
   services, employees, walk-in). Reports, Marketing, HR, etc. all hidden.
4. **Check UI** Admin → Plan & Billing shows "Starter" as current plan

### 1.3 Upgrade during trial → Stripe Checkout → plan flips
1. In Admin → Plan & Billing, click "Choose Pro"
2. Stripe Checkout opens; use card `4242 4242 4242 4242`, any future expiry,
   any CVC, any ZIP
3. Click Subscribe → redirects back to `/?stripe=success`
4. **Check Firestore** `tenants/{id}/data/settings`:
   - `plan: 'pro'`
   - `stripeSubscriptionId: 'sub_...'`
   - `trialEndsAt` field is **deleted** (no longer present)
5. **Check UI** Admin → Plan & Billing: trial banner gone, "Pro" badge shown,
   "Manage billing" button appears
6. **Check Stripe Dashboard** → Customers → see the new customer with active
   sub on Pro price

### 1.4 Manage Billing → Customer Portal opens
1. Click "Manage billing →"
2. Stripe-hosted Customer Portal loads with tenant's email
3. **Check** it shows the current subscription, payment method, and an
   option to switch plans (only if 0d was configured)

### 1.5 Plan switch in Portal (Studio ↔ Pro)
1. In Portal, click "Update subscription" → pick the other tier → confirm
2. Stripe fires `customer.subscription.updated` with new price.id
3. **Check Firestore** within ~5 sec:
   - `tenants/{id}/data/settings.plan` matches the new tier
   - `subscriptionStatus: 'active'`
4. **Check UI** refresh app → new tier's modules visible

### 1.6 Cancel-at-period-end via Portal
1. In Portal, click "Cancel subscription" → confirm
2. Stripe fires `customer.subscription.updated` with `cancel_at_period_end=true`
3. **Check Firestore**:
   - `cancelAtPeriodEnd: true`
   - `currentPeriodEnd: <ISO>` (when access ends)
   - `plan` STILL the paid tier (access continues until period end)
4. **Check UI** Admin → Plan & Billing: red banner "Your subscription is set
   to cancel on {date}"

### 1.7 Reactivate before period end
1. In Portal, click "Renew subscription" / "Reactivate"
2. Stripe fires another `customer.subscription.updated` with
   `cancel_at_period_end=false`
3. **Check Firestore** `cancelAtPeriodEnd: false`
4. **Check UI** red cancel banner is gone

### 1.8 Final cancellation (period ends)
Trigger via CLI (fast-forward; real-world this happens at period end):
```bash
stripe trigger customer.subscription.deleted
```
Or in Stripe Dashboard, cancel the subscription immediately (not at period
end) for a specific customer.

1. **Check Firestore**:
   - `plan: 'starter'`
   - `stripeSubscriptionId` deleted
   - `subscriptionStatus`, `cancelAtPeriodEnd`, `currentPeriodEnd` all
     deleted
2. **Check UI** modules collapse back to Starter set

### 1.9 Payment fails → past_due banner
```bash
stripe trigger customer.subscription.updated --add subscription:status=past_due
# Or: in Dashboard, edit a subscription's status to past_due
```
**Check Firestore** `subscriptionStatus: 'past_due'`, plan unchanged (grace
period). **Check UI** orange banner: "Payment past due. Update your card via
Manage billing to avoid losing access."

### 1.10 Repeated failures → final delete
After Stripe's retry schedule exhausts (~21 days in prod, configurable in
Dashboard → Subscriptions settings), Stripe fires `subscription.deleted` and
the flow becomes identical to 1.8.

## 2. Refund flows (the new code)

### 2.1 Full SaaS refund
1. In Stripe Dashboard, find an active subscription's latest invoice
2. Click the charge → "Refund payment" → full amount → submit
3. Stripe fires `charge.refunded`
4. **Check Firestore** `tenants/{tid}/refunds/{re_xxx}`:
   - `chargeId`, `invoiceId`, `paymentIntentId` all populated
   - `amount === amountRefunded` (full refund)
   - `isFullRefund: true`
   - `reason: 'requested_by_customer'` (or whatever you picked)
5. **Check email** owner gets "Refund processed" email — check Cloud Logs of
   `sendEmail` or AWS SES Console (us-west-2) → Reputation/Sending stats
6. **Check UI** plan is unchanged (refund without cancellation = keep access)

### 2.2 Partial SaaS refund
1. Same as 2.1 but enter a partial amount (e.g. $10 of $49)
2. **Check Firestore** refund doc has `isFullRefund: false`, `amountRefunded
   < amount`
3. **Check email** subject + body say "Partial refund"

### 2.3 Refund a membership invoice
1. As admin, generate a membership Checkout for a client + have client pay
2. In Stripe Dashboard, refund the resulting charge
3. **Check Firestore** `tenants/{tid}/memberships/{memId}/refunds/{re_xxx}`:
   - Record nested under membership, not under billing
4. **Check email** sent to the **client's** email (not the owner)
5. Subject is generic: "Your refund has been processed"

### 2.4 Multiple refunds on one charge (idempotency)
1. After a partial refund, refund another partial amount
2. Stripe fires another `charge.refunded` with a NEW refund id at
   `refunds.data[0]`
3. **Check Firestore** a NEW doc appears at `.../refunds/{re_new_id}` —
   the previous refund doc stays untouched (each refund event keys to its
   own refundId)

### 2.5 Refund event retry idempotency
The webhook returns 200 even on internal errors. If Stripe retries delivery
of the same event, the refund doc id stays the same and is written twice
with identical content (verified by the `is idempotent` unit test in
`functions/lib/billing.test.js`).

## 2bis. Chargeback / dispute flows

Disputes have a fixed (~7-21 day) evidence window. Missing it = automatic
loss + funds permanently withdrawn. Both the platform owner (who responds in
Stripe Dashboard) AND the tenant owner (who has context) get alerted.

`PLATFORM_OWNER_EMAIL` in `functions/.env` controls the platform alert
destination. Falls back to `jvankim@gmail.com` if unset.

### 2bis.1 SaaS subscription dispute (created)
Stripe CLI can simulate this end-to-end:
```bash
# Trigger a real chargeable + then disputable charge in sandbox
stripe trigger charge.dispute.created
```
This creates a fresh PaymentIntent, charges a test card with the disputable
number `4000 0000 0000 0259` under the hood, and fires the dispute event.

**Or do it manually for an existing subscription:**
1. Make a real test charge via Stripe Checkout in the app (use card
   `4000 0000 0000 0259` — succeeds initially, then disputable)
2. Open the charge in Stripe Dashboard → "Dispute payment" (or wait for
   simulated dispute to fire)

Verify after `charge.dispute.created` fires:
1. **Firestore** `tenants/{tid}/disputes/{disputeId}`:
   - `disputeId`, `chargeId`, `amount`, `reason`, `status: 'needs_response'`
   - `evidenceDueBy: <ISO>` (the deadline!)
2. **Platform owner email** (`PLATFORM_OWNER_EMAIL`): subject starts with
   `⚠ Chargeback dispute opened`, shows red deadline box, links to
   `dashboard.stripe.com/disputes/{id}`
3. **Tenant owner email**: subject `Action needed: chargeback dispute on
   your salon`, asks them to send context if SaaS (or
   receipts/photos/conversations if membership)

### 2bis.2 Membership dispute (created)
Same as 2bis.1 but charge is on a membership subscription. **Tenant owner
gets the alert, NOT the client** (the client filed the dispute — emailing
them about their own dispute would be bizarre). Record lands at the same
flat `tenants/{tid}/disputes/{disputeId}` location with `isMembership:
true`, `membershipId`, and `clientName` populated so the in-app UI can
render context.

### 2bis.2b In-app UI verification
After any dispute fires:
1. Open Admin → Settings → scroll to "⚠ Chargebacks" section (only renders
   when at least one dispute exists)
2. Open disputes show red border (urgent if <= 3 days left), deadline
   countdown, "Submit evidence →" button → Stripe Dashboard
3. Closed disputes appear in "History" sub-list with won/lost outcome chip
4. Membership disputes show a blue MEMBER badge + the client's name

### 2bis.3 Dispute won
After you submit evidence in Stripe Dashboard and Stripe sides with you:
```bash
stripe trigger charge.dispute.closed --add dispute:status=won
```
Or in Dashboard, accept a dispute that's marked won.

Verify:
1. **Firestore** dispute doc updated with `status: 'won'` (merge — earlier
   fields preserved)
2. **Both emails** sent with subject `✓ Dispute won — {tenant name}`, green
   styling, "Stripe sided with you" copy

### 2bis.4 Dispute lost
Either don't submit evidence (Stripe auto-loses after deadline) or accept
liability in Dashboard.
```bash
stripe trigger charge.dispute.closed --add dispute:status=lost
```

Verify:
1. **Firestore** dispute doc updated with `status: 'lost'`
2. **Both emails** sent with subject `✗ Dispute lost`, red styling, "funds
   have been withdrawn" copy

### 2bis.5 Dispute on a one-time charge (no tenant context)
Hypothetical — if we ever sell one-time products, a dispute on a non-
subscription charge would have no tenant linkage. The handler still emails
the platform owner so they don't miss it. Verified by the `still alerts
platform even when no subscription` test in `billing.test.js`.

## 2ter. Card-on-file flows (SetupIntent + off-session charges)

Stores client cards via Stripe Elements + SetupIntent → tokenized in the
browser, only the `pm_xxx` token + display metadata (brand, last4, exp) ever
touches our servers. PCI scope stays at SAQ A.

### 2ter.1 Add a card via the client modal
1. Open any client in the Clients module
2. Click the new **Cards** tab
3. Click **+ Add a card on file**
4. Stripe Elements card input appears — enter test card `4242 4242 4242 4242`,
   any future expiry, any 3-digit CVC, any ZIP
5. Click **Save card** → frontend calls `createSetupIntent` → Stripe.js
   confirms → frontend calls `savePaymentMethod`
6. **Check Firestore** `tenants/{tid}/clients/{cid}`:
   - `stripeCustomerId: 'cus_...'` (created if missing)
   - `paymentMethods: [{ id, brand, last4, expMonth, expYear, funding, country, addedAt }]`
   - `defaultPaymentMethodId: 'pm_...'` (first card is auto-defaulted)
7. **Check UI** card appears in the Cards tab list with brand badge + last 4

### 2ter.2 Add a card from an international country
Use card `4000 0082 6000 0000` (UK-issued Visa) instead.
1. Save it the same way
2. **Check Firestore** the saved card has `country: 'GB'`
3. **Check UI** an orange "Intl +1.5%" badge appears next to the card —
   warns the salon about Stripe's international surcharge so they can
   factor it into their pricing

### 2ter.3 Make a non-default card the default
1. Save 2 cards
2. The second one shows the **Default** badge (auto-assigned)
3. Click **Make default** on the first card
4. **Check Firestore** `defaultPaymentMethodId` updates to the first card's id
5. **Check UI** default badge moves

### 2ter.4 Delete a card
1. Click **Remove** next to any card
2. Confirm the prompt
3. **Check Firestore** the card is removed from `paymentMethods` array;
   if it was the default, the next card becomes default (or null if last)
4. **Check Stripe Dashboard** the PaymentMethod is detached from the Customer

### 2ter.5 Test a card that requires 3D Secure (authentication)
Use card `4000 0025 0000 3155` — triggers SCA challenge.
1. Save it via Add card flow
2. Stripe.js renders a 3DS modal — click **Complete authentication**
3. **Check Firestore** card saves normally (the SetupIntent.usage is
   'off_session' which pre-authorizes future charges without re-prompt)

### 2ter.6 Off-session charge (no-show fee or repeat charge)
This is the payoff — charging a saved card without the cardholder present.

**Prerequisite**: tenant must have completed Stripe Connect onboarding
(`tenants/{tid}.stripeConnectAccountId` set). Until Connect is wired,
`chargeStoredCard` returns a `failed-precondition` error — by design,
to prevent funds landing in Plume's main balance (money-transmitter risk).

When Connect is wired, test via the Functions emulator console:
```js
await functions.httpsCallable('chargeStoredCard')({
  tenantId: 'meraki',
  clientId: 'client_jane',
  amount:   2500,             // $25.00 no-show fee in cents
  description: 'No-show fee for 2026-06-15 appointment',
  statementDescriptorSuffix: 'NOSHOW',
});
```
**Check Firestore + Stripe Dashboard:**
- PaymentIntent succeeds with `on_behalf_of` set to salon's connected account
- Funds route to salon (less optional `application_fee_amount` for Plume)
- Cardholder's statement shows **salon's name** + `NOSHOW` suffix

### 2ter.7 Off-session charge with declined card
Use card `4000 0000 0000 0341` — attaches successfully but declines on charge.
1. Save it via Add card flow (succeeds)
2. Call `chargeStoredCard` — Stripe returns a `card_declined` error
3. **Check return value** `{ stripeCode: 'card_declined', declineCode: '...' }`
4. **Check UI** (when wired into POS) — surfaces the decline reason to staff

### 2ter.8 Off-session charge requiring re-authentication
Use card `4000 0025 0000 3155` (3DS card).
1. Save the card with SCA (works on-session)
2. Call `chargeStoredCard` — Stripe returns `authentication_required` because
   the issuer wants fresh auth for this off-session charge
3. **Check** Cloud Function returns `failed-precondition` with
   `stripeCode: 'authentication_required'` — UI should prompt admin to
   re-collect the card with the cardholder present

## 3. Membership flows (Stripe-driven client subscriptions)

### 3.1 Generate Checkout + client pays
1. Admin → Memberships → create plan → assign client → "Generate Checkout"
2. Member receives email with payment link
3. Open the link → pay with `4242...` test card
4. Stripe fires `checkout.session.completed`
5. **Check Firestore** `tenants/{tid}/memberships/{memId}`:
   - `status: 'active'`
   - `stripeSubscriptionId`, `stripeCustomerId`, `paidAt` all set

### 3.2 Member uses Manage Portal
1. Admin views the membership → click "Manage Portal" → opens Stripe
   Customer Portal scoped to the client
2. **Check** client can cancel and update card

### 3.3 Failed membership payment
```bash
stripe trigger invoice.payment_failed
```
- Targets membership subs via `invoice.subscription_details.metadata.type ==
  'membership'`
- **Check Firestore** membership `status: 'past_due'`

### 3.4 Member cancels subscription
1. Client cancels in their Customer Portal (or admin cancels in Dashboard)
2. `customer.subscription.deleted` fires
3. **Check Firestore** membership `status: 'cancelled'`, `cancelledAt` set

## 4. CLI helper

To rapidly fire individual events with sane payloads, see
`scripts/stripe-sandbox-test.sh`. It wraps `stripe trigger` and pauses
between events for verification.

```bash
./scripts/stripe-sandbox-test.sh                # interactive walkthrough
./scripts/stripe-sandbox-test.sh refund-saas    # single scenario
./scripts/stripe-sandbox-test.sh --list         # list all scenarios
```

## 5. Test card numbers

| Card                  | Behavior                              |
|-----------------------|---------------------------------------|
| `4242 4242 4242 4242` | Succeed (Visa)                        |
| `5555 5555 5555 4444` | Succeed (Mastercard)                  |
| `4000 0000 0000 0341` | Attached but charge fails             |
| `4000 0000 0000 9995` | Insufficient funds                    |
| `4000 0025 0000 3155` | Requires 3DS authentication           |
| `4000 0000 0000 0259` | Disputable (use for chargeback tests) |
| `4000 0000 0000 0119` | Refund fails                          |

Any future expiry, any 3-digit CVC, any 5-digit ZIP.

## 6. Where to verify writes

| What            | Where                                                       |
|-----------------|-------------------------------------------------------------|
| Plan changes    | Firestore Console → `tenants/{id}/data/settings.plan`       |
| Subscription ID | Same doc, `stripeSubscriptionId`                            |
| Trial state     | Same doc, `trialEndsAt`                                     |
| Refunds (SaaS)  | `tenants/{id}/refunds/{refundId}`                           |
| Refunds (memb)  | `tenants/{id}/memberships/{memId}/refunds/{refundId}`       |
| Disputes (all)  | `tenants/{id}/disputes/{disputeId}` (membership ones have `isMembership: true`) |
| Saved cards     | `tenants/{id}/clients/{cid}.paymentMethods[]` (display metadata only — PAN lives in Stripe) |
| Client Stripe Customer | `tenants/{id}/clients/{cid}.stripeCustomerId`         |
| Default card    | `tenants/{id}/clients/{cid}.defaultPaymentMethodId`         |
| Cancellation    | Same settings doc, `cancelAtPeriodEnd` + `currentPeriodEnd` |
| Payment status  | Same doc, `subscriptionStatus`                              |
| Email delivery  | AWS SES Console (us-west-2) → Reputation/Sending stats + Cloud Logs of `sendEmail` calls |
| Webhook events  | `stripe events list --limit 20` or Stripe Dashboard → Logs  |

## 7. When something goes wrong

Webhook not firing locally:
- Check the `stripe listen` terminal — it prints each event in real time
- Check the function logs: `firebase functions:log --only stripeWebhook`
- Verify the signing secret matches: `stripe listen` prints a fresh `whsec_`
  on each invocation that must match `STRIPE_WEBHOOK_SECRET`

Plan not flipping after Checkout:
- Look for the event in `stripe events list` — was it delivered?
- Check function logs for the `[stripeWebhook]` log line
- Verify `metadata.tenantId` is on the Subscription:
  `stripe subscriptions retrieve sub_xxx`

Refund email not arriving:
- AWS SES Console / `sesEventWebhook` Cloud Logs → check if it bounced or was suppressed (per-tenant suppression at `tenants/{id}/suppression/{hash}`)
- Check `tenants/{tid}/emailSuppression/{email}` — global or per-tenant
  suppression silently drops sends
- Run the relevant Vitest test in `functions/lib/billing.test.js` to confirm
  the handler logic is correct independent of mail delivery
