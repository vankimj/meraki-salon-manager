// Stripe Terminal / Tap to Pay — Slice 2 scaffold.
//
// The BACKEND is done + deployable: createTerminalConnectionToken (mints a
// token on the platform account) and createPaymentIntent({paymentMethodType:
// 'card_present'}) (destination-charge card-present PI, funds → the salon via
// on_behalf_of/transfer_data).
//
// The on-device READER FLOW is the hardware step and is intentionally NOT
// wired here, because it can't be written-and-verified blind:
//   1. `npx expo install @stripe/stripe-terminal-react-native` (correct version
//      + native config) — this is a NATIVE module, so a dev-client + production
//      REBUILD is required (see project_mobile_pitfalls #9).
//   2. Add the iOS Tap-to-Pay entitlement + NSLocationWhenInUse / proximity
//      reader usage strings in app.json, and register a Terminal Location in
//      the Stripe dashboard.
//   3. Wrap the checkout subtree in <StripeTerminalProvider tokenProvider={tokenProvider}>
//      and use useStripeTerminal():
//        iPad  → discoverReaders('bluetoothScan'|'internet') → connectReader(...)
//        iPhone→ connectTapToPayReader(...)   (needs the entitlement)
//      then: createCardPaymentIntent(amountCents) → collectPaymentMethod(clientSecret)
//            → confirmPaymentIntent(...) → on success, complete the sale with
//            method:'card', ccFee, stripePaymentIntentId.
//
// Everything below is safe to ship now: the SDK is loaded LAZILY so the
// current (non-rebuilt) app never crashes, and isTerminalAvailable() gates the
// Card button.

import { createTerminalConnectionToken, createCardPaymentIntent } from './firestore';

let _sdk;
function getSDK() {
  if (_sdk !== undefined) return _sdk;
  try { _sdk = require('@stripe/stripe-terminal-react-native'); }
  catch { _sdk = null; }   // native module not in this build yet
  return _sdk;
}

// True only when the native Terminal module is present (i.e. after the rebuild).
export function isTerminalAvailable() {
  return !!getSDK();
}

// The SDK calls this to authenticate with Stripe. Wire into
// <StripeTerminalProvider tokenProvider={tokenProvider} />.
export async function tokenProvider() {
  const secret = await createTerminalConnectionToken();
  if (!secret) throw new Error('Could not get a Terminal connection token (is Stripe Terminal enabled?)');
  return secret;
}

export { createCardPaymentIntent };
