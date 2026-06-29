// Pure, testable helpers for the trainer product marketplace (the `store`
// module). Extracted from functions/index.js so the destination-charge
// shaping can be unit-tested without the firebase-functions runtime.
//
// The store sells a tenant's own products (one-time or recurring) through
// Stripe Checkout, routing funds to the TENANT's connected account via
// destination charges. Plume's optional cut rides as the application fee
// (default 0 — trainer keeps 100%). This mirrors the money-transmitter
// safeguard in billing.js: we never settle store money on the platform
// account, so a missing connect account is a hard throw, not a silent
// fallback.

// Clamp a platform-fee percentage to a sane [0,100] range. Non-numeric or
// missing → 0 (the default: trainer keeps everything).
function clampFeePercent(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

// Plume's cut for a single charge, in cents. Pure so both the checkout
// builder and the pre-created order doc agree on the number.
function computeApplicationFeeCents(amountCents, pct) {
  const amt = Math.round(Number(amountCents) || 0);
  if (!(amt > 0)) return 0;
  return Math.round((amt * clampFeePercent(pct)) / 100);
}

// Build the params object for stripe.checkout.sessions.create() for a store
// purchase. Centralised so every store charge — one-time or recurring —
// carries the destination-charge routing + on_behalf_of + store_product
// metadata, and so a future charge path can't forget the connect-account
// safeguard.
//
// Required:
//   product          — { id, name, price (dollars), billingType, interval }
//   priceId          — pre-created Stripe Price id (lazy-created upstream)
//   customerId       — cus_xxx the buyer is attached to
//   connectAccountId — acct_xxx of the tenant's Stripe Connect account.
//                      REQUIRED — never settle store funds on the platform
//                      account (money-transmitter risk).
//   tenantId         — for audit + webhook routing
//   storeOrderId     — pre-created order doc id, echoed in metadata so the
//                      webhook can flip the right order to paid/active
//   successUrl/cancelUrl — Checkout redirect targets (server-built; never
//                      caller-supplied open-redirect)
//
// Optional:
//   platformFeePercent — Plume's cut (default 0); clamped [0,100]
//   clientId           — salon client id when the buyer is a known client
function buildStoreCheckoutSessionParams({
  product, priceId, customerId, connectAccountId,
  platformFeePercent, tenantId, storeOrderId, clientId,
  successUrl, cancelUrl,
}) {
  if (!product)          throw new Error('product required');
  if (!priceId)          throw new Error('priceId required');
  if (!customerId)       throw new Error('customerId required');
  if (!connectAccountId) throw new Error('connectAccountId required — refusing to route store funds to platform account (money-transmitter risk)');
  if (!tenantId)         throw new Error('tenantId required for audit');
  if (!storeOrderId)     throw new Error('storeOrderId required for webhook routing');
  if (!successUrl || !cancelUrl) throw new Error('successUrl and cancelUrl required');

  const recurring = product.billingType === 'recurring';
  const pct       = clampFeePercent(platformFeePercent);
  const amount    = Math.round((Number(product.price) || 0) * 100);
  if (!(amount > 0)) throw new Error('product price must be a positive amount');

  // Metadata is mirrored onto BOTH the session and the resulting
  // PaymentIntent/Subscription so webhook events for either route back to
  // the same store order. `type` is the strict router key in stripeWebhook.
  const metadata = {
    type:         'store_product',
    tenantId,
    productId:    String(product.id || ''),
    storeOrderId: String(storeOrderId),
    clientId:     clientId || '',
    mode:         recurring ? 'subscription' : 'payment',
  };

  const base = {
    customer:    customerId,
    line_items:  [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url:  cancelUrl,
    metadata,
  };

  if (recurring) {
    // Subscription destination charge: funds settle on the connected
    // account, the connected account is merchant of record (on_behalf_of),
    // and Plume's cut rides as application_fee_percent. Omit the fee key
    // entirely when 0 so the invoice carries no fee line.
    const subData = {
      metadata,
      on_behalf_of:  connectAccountId,
      transfer_data: { destination: connectAccountId },
    };
    if (pct > 0) subData.application_fee_percent = pct;
    return { ...base, mode: 'subscription', subscription_data: subData };
  }

  // One-time destination charge.
  const piData = {
    on_behalf_of:  connectAccountId,
    transfer_data: { destination: connectAccountId },
    metadata,
  };
  const fee = computeApplicationFeeCents(amount, pct);
  // Never let the fee meet or exceed the charge — Stripe rejects it and it
  // would mean the trainer nets nothing.
  if (fee > 0 && fee < amount) piData.application_fee_amount = fee;
  return { ...base, mode: 'payment', payment_intent_data: piData };
}

// Map a Stripe subscription status to the store order's status vocabulary.
// Mirrors the membership webhook branch so the two stay legible together.
function storeOrderStatusForSub(stripeStatus) {
  switch (stripeStatus) {
    case 'active':   return 'active';
    case 'trialing': return 'active';
    case 'past_due': return 'past_due';
    case 'unpaid':   return 'past_due';
    case 'canceled': return 'cancelled';
    case 'paused':   return 'paused';
    default:         return stripeStatus || 'active';
  }
}

module.exports = {
  clampFeePercent,
  computeApplicationFeeCents,
  buildStoreCheckoutSessionParams,
  storeOrderStatusForSub,
};
