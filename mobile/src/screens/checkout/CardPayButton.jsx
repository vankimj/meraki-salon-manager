import { useRef, useState, useEffect } from 'react';
import { Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet, Platform, PermissionsAndroid } from 'react-native';
import { createCardPaymentIntent, fetchTerminalTestMode } from '../../lib/terminal';
import { useThemedStyles } from '../../theme/ThemeContext';

// Rendered ONLY when the native Terminal module is present (CheckoutScreen
// gates this behind isTerminalAvailable()), so the useStripeTerminal hook
// below is guaranteed available when this mounts.
let SDK = null;
try { SDK = require('@stripe/stripe-terminal-react-native'); } catch { SDK = null; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Android grants reader permissions at RUNTIME (iOS uses Info.plist strings the
// Terminal plugin injects). discoverReaders() fails on Android without these,
// so request them up front: fine location (required by the Terminal SDK for
// both BT and Tap to Pay) + Bluetooth scan/connect on Android 12+ (API 31) for
// the BT reader path. No-op on iOS. Returns true if everything needed is granted.
async function ensureAndroidPermissions(needsBluetooth) {
  if (Platform.OS !== 'android') return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const wanted = [P.ACCESS_FINE_LOCATION];
  if (needsBluetooth && Platform.Version >= 31) wanted.push(P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT);
  const res = await PermissionsAndroid.requestMultiple(wanted.filter(Boolean));
  return wanted.every(p => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

// In-person card capture via Stripe Terminal.
//   preferReader=true  (iPad)   → Bluetooth reader (Stripe M2 / WisePOS)
//   preferReader=false (iPhone) → Tap to Pay on iPhone (no hardware)
// Flow: connect a reader (once) → server-created card_present PaymentIntent
// → collectPaymentMethod → confirmPaymentIntent → onPaid(paymentIntentId).
export default function CardPayButton({ amountCents, description, locationId, onBehalfOf, merchantName, preferReader, disabled, onPaid, idempotencyKey }) {
  const styles = useThemedStyles(makeStyles);
  const useStripeTerminal = SDK?.useStripeTerminal;
  const readersRef   = useRef([]);
  const connectedRef = useRef(false);
  const [busy, setBusy]   = useState(false);
  const [phase, setPhase] = useState('');
  // Test/sandbox keys can't charge real NFC cards, so fall back to Stripe's
  // simulated reader (auto-approves with test card 4242) — lets Tap to Pay be
  // exercised end-to-end with no physical card. Live mode uses the real reader.
  const [simulated, setSimulated] = useState(false);
  useEffect(() => { let a = true; fetchTerminalTestMode().then(v => { if (a) setSimulated(!!v); }).catch(() => {}); return () => { a = false; }; }, []);

  const term = useStripeTerminal({
    onUpdateDiscoveredReaders: (list) => { readersRef.current = list || []; },
    onDidChangeConnectionStatus: (status) => { connectedRef.current = status === 'connected'; },
  });

  const method = preferReader ? 'bluetoothScan' : 'tapToPay';

  async function waitForReader(ms = 20000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (readersRef.current.length > 0) return readersRef.current[0];
      await sleep(400);
    }
    return null;
  }

  async function ensureConnected() {
    if (connectedRef.current) return;
    if (!locationId && !simulated) {
      throw new Error('No Terminal Location set. Create one in Stripe → Terminal → Locations and add its ID to salon settings (terminalLocationId).');
    }
    setPhase(simulated ? 'Preparing test reader…' : (method === 'tapToPay' ? 'Preparing Tap to Pay…' : 'Searching for reader…'));
    if (!simulated) {
      const granted = await ensureAndroidPermissions(method === 'bluetoothScan');
      if (!granted) {
        throw new Error('Location' + (method === 'bluetoothScan' ? ' and Bluetooth' : '') + ' permission is required to take card payments. Enable it in Settings and try again.');
      }
    }
    readersRef.current = [];
    const { error: dErr } = await term.discoverReaders({ discoveryMethod: method, simulated });
    if (dErr) throw new Error(dErr.message);
    const reader = await waitForReader();
    try { await term.cancelDiscovering(); } catch {}
    if (!reader) {
      const tapDevice = Platform.OS === 'android' ? 'an NFC-capable Android device (Android 11+)' : 'an iPhone XS or later';
      throw new Error(method === 'tapToPay'
        ? `Tap to Pay is unavailable on this device (needs ${tapDevice}).`
        : 'No card reader found. Make sure it is powered on and nearby.');
    }
    setPhase('Connecting…');
    // The simulated reader carries its own test location; fall back to it when
    // no real Terminal Location is configured (sandbox).
    const locId = locationId || reader?.location?.id || undefined;
    const params = method === 'tapToPay'
      ? { discoveryMethod: 'tapToPay', reader, locationId: locId, onBehalfOf, merchantDisplayName: merchantName }
      : { discoveryMethod: 'bluetoothScan', reader, locationId: locId };
    const { reader: cr, error: cErr } = await term.connectReader(params);
    if (cErr) throw new Error(cErr.message);
    connectedRef.current = !!cr;
  }

  async function pay() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await ensureConnected();
      setPhase('Starting payment…');
      const pi0 = await createCardPaymentIntent(amountCents, description, idempotencyKey);
      if (!pi0?.clientSecret) throw new Error('Could not start the payment.');
      const { paymentIntent: pi, error: rErr } = await term.retrievePaymentIntent(pi0.clientSecret);
      if (rErr) throw new Error(rErr.message);
      setPhase(simulated ? 'Simulating a test tap…' : (method === 'tapToPay' ? 'Ask the client to tap…' : 'Present card on the reader…'));
      const { paymentIntent: pi2, error: colErr } = await term.collectPaymentMethod({ paymentIntent: pi });
      if (colErr) throw new Error(colErr.message);
      setPhase('Processing…');
      const { paymentIntent: pi3, error: conErr } = await term.confirmPaymentIntent({ paymentIntent: pi2 });
      if (conErr) throw new Error(conErr.message);
      if (pi3?.status !== 'succeeded') throw new Error(`Payment ${pi3?.status || 'did not complete'}.`);
      const cpd = pi3?.charges?.[0]?.paymentMethodDetails?.cardPresentDetails
                || pi3?.charges?.[0]?.paymentMethodDetails?.cardPresent || null;
      const cardInfo = cpd ? { brand: cpd.brand || null, last4: cpd.last4 || null } : null;
      onPaid?.(pi3.id || pi0.paymentIntentId, cardInfo);
    } catch (e) {
      // req 1.4 — Tap to Pay needs iOS 17.6+ on older flows; surface a clear
      // "update iOS" message instead of a generic failure.
      const msg = String(e?.message || '');
      if (/osVersionNotSupported|os version|update.*ios|ios.*update/i.test(msg)) {
        Alert.alert('Update iOS to use Tap to Pay', 'Tap to Pay on iPhone needs a newer version of iOS. Update this iPhone in Settings → General → Software Update, then try again.');
      } else {
        Alert.alert('Card payment failed', msg || 'Please try again.');
      }
    } finally {
      setBusy(false);
      setPhase('');
    }
  }

  // req 5.5 wants the SF Symbol "wave.3.right.circle" on the Tap to Pay button —
  // that needs expo-symbols (native), added in the next iPhone rebuild. Until
  // then we approximate with a wave glyph + the required "Tap to Pay" copy.
  return (
    <TouchableOpacity style={[styles.btn, (busy || disabled) && { opacity: 0.6 }]} onPress={pay} disabled={busy || disabled} activeOpacity={0.85}>
      {busy ? (
        <Text style={styles.txt}>{phase || 'Working…'}</Text>
      ) : (
        <Text style={styles.txt}>{preferReader ? '💳  Card — tap / insert on reader' : '〰️  Tap to Pay'}{simulated ? '  (test)' : ''}</Text>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (t) => StyleSheet.create({
  btn: { marginTop: 10, backgroundColor: t.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  txt: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
