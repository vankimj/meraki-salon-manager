// Builds the data/checkoutSession payload the web checkout writes for the
// front-desk kiosk (iPad) to pick up and take a card on the M2 reader.
//
// The shape MUST match what the mobile KioskCheckout reads (see
// mobile/.../KioskCheckout.jsx + CheckoutScreen.buildHandoff). Three deliberate
// choices keep web↔kiosk money correct:
//   1. Discount is precomputed to a fixed $ amount (discType:'amount') — the web
//      and mobile encode discount TYPES differently ('ff'/'fixed' vs
//      'percent'/'amount'), so sending a literal $ sidesteps the mismatch.
//   2. Store credit is ALSO precomputed to a fixed $ (creditApplied) for the same
//      reason: the dedicated kiosk identity can't read the client to derive the
//      balance, so it would charge the un-credited bill while the server applied
//      the credit → "Captured ≠ bill" and a captured-but-unsaved sale. Sending
//      the resolved $ lets the kiosk charge the right amount; the server still
//      clamps it to the client's real balance.
//   3. The caller must gate OUT promo / gift-card / gift-card-sale carts — their
//      object shapes + usage side-effects don't round-trip cleanly yet. See
//      kioskHandoffAvailable().

export function genSessionToken(len = 16) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const g = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (g && g.getRandomValues) {
    const buf = new Uint8Array(len);
    g.getRandomValues(buf);
    for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  } else {
    for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// A kiosk handoff is only safe when the cart has no promo, no redeemed gift
// card, and no gift-card SALE (selling a gift card). Those need shape/side-effect
// handling the kiosk doesn't do for web-originated sessions yet — fall back to
// keyed card entry for them.
export function kioskHandoffAvailable({ promo, giftCard, gcSales }) {
  if (promo) return false;
  if (giftCard) return false;
  if (Array.isArray(gcSales) && gcSales.length > 0) return false;
  return true;
}

export function buildKioskHandoff({
  appts = [],
  serviceLines = [],
  prices = [],
  techNames = [],
  cartItems = [],
  discountAmount = 0,
  applyCredit = false,
  creditApplied = 0,
  primaryClient = null,
  createdBy = null,
  receiptPhone = null,
  sessionId,
  // 'card' = kiosk takes the card on the M2 + records the sale.
  // 'cashReview' = kiosk shows the bill + tip + "Is this correct?", then the WEB
  // finalizes the cash sale (the desk collects the cash).
  flow = 'card',
}) {
  const apptsPayload = appts.map((a, ai) => ({
    id: a.id || null,                 // lets recordKioskSale mark the appt done + dedup in Reports
    date: a.date || null,
    startTime: a.startTime || null,
    clientName: a.clientName || 'Walk-in',
    clientId: a.clientId || null,
    clientPhone: a.clientPhone || null,
    techName: a.techName || '',
    services: (a.services || []).map((s, si) => {
      const li = serviceLines.findIndex(l => l.apptIdx === ai && l.svcIdx === si);
      const price = li >= 0 ? (Number(prices[li]) || 0) : (Number(s.price) || 0);
      const techName = li >= 0 ? (techNames[li] || a.techName || '') : (s.techName || a.techName || '');
      return {
        name: s.name || '—',
        price,
        techName,
        taxable: s.taxable !== false,
        id: s.id || null,
        duration: s.duration || null,
      };
    }),
  }));

  const products = (cartItems || []).map(it => ({
    product: {
      id: it.product?.id || null,
      name: it.product?.name || '—',
      price: Number(it.product?.price) || 0,
      taxable: it.product?.taxable !== false,
    },
    qty: it.qty || 1,
  }));

  const disc = Math.max(0, Number(discountAmount) || 0);
  const credit = Math.max(0, Number(creditApplied) || 0);

  return {
    sessionId,
    flow: flow === 'cashReview' ? 'cashReview' : 'card',
    cart: { appts: apptsPayload, products },
    priced: true,
    clientId: primaryClient?.id || null,
    clientName: primaryClient?.name || apptsPayload[0]?.clientName || 'Walk-in',
    createdBy: createdBy || null,
    // Fixed-$ discount — see file header (#1).
    discType: disc > 0 ? 'amount' : 'none',
    discVal: disc,
    promo: null,
    giftCard: null,
    // Fixed-$ store credit — see file header (#2). applyCredit stays as the
    // server's gate to even consult the balance; creditApplied is the $ to apply
    // (the server clamps it to the client's real balance).
    applyCredit: !!applyCredit,
    creditApplied: credit,
    receiptPhone: receiptPhone || null,
    status: 'pending',
  };
}
