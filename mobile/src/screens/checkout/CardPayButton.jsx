import { useRef, useState } from 'react';
import { Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { createCardPaymentIntent } from '../../lib/terminal';
import { useThemedStyles } from '../../theme/ThemeContext';

// Rendered ONLY when the native Terminal module is present (CheckoutScreen
// gates this behind isTerminalAvailable()), so the useStripeTerminal hook
// below is guaranteed available when this mounts.
let SDK = null;
try { SDK = require('@stripe/stripe-terminal-react-native'); } catch { SDK = null; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// In-person card capture via Stripe Terminal.
//   preferReader=true  (iPad)   → Bluetooth reader (Stripe M2 / WisePOS)
//   preferReader=false (iPhone) → Tap to Pay on iPhone (no hardware)
// Flow: connect a reader (once) → server-created card_present PaymentIntent
// → collectPaymentMethod → confirmPaymentIntent → onPaid(paymentIntentId).
export default function CardPayButton({ amountCents, description, locationId, onBehalfOf, merchantName, preferReader, disabled, onPaid }) {
  const styles = useThemedStyles(makeStyles);
  const useStripeTerminal = SDK?.useStripeTerminal;
  const readersRef   = useRef([]);
  const connectedRef = useRef(false);
  const [busy, setBusy]   = useState(false);
  const [phase, setPhase] = useState('');

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
    if (!locationId) {
      throw new Error('No Terminal Location set. Create one in Stripe → Terminal → Locations and add its ID to salon settings (terminalLocationId).');
    }
    setPhase(method === 'tapToPay' ? 'Preparing Tap to Pay…' : 'Searching for reader…');
    readersRef.current = [];
    const { error: dErr } = await term.discoverReaders({ discoveryMethod: method });
    if (dErr) throw new Error(dErr.message);
    const reader = await waitForReader();
    try { await term.cancelDiscovering(); } catch {}
    if (!reader) {
      throw new Error(method === 'tapToPay'
        ? 'Tap to Pay is unavailable on this device (needs an iPhone XS or later).'
        : 'No card reader found. Make sure it is powered on and nearby.');
    }
    setPhase('Connecting…');
    const params = method === 'tapToPay'
      ? { discoveryMethod: 'tapToPay', reader, locationId, onBehalfOf, merchantDisplayName: merchantName }
      : { discoveryMethod: 'bluetoothScan', reader, locationId };
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
      const pi0 = await createCardPaymentIntent(amountCents, description);
      if (!pi0?.clientSecret) throw new Error('Could not start the payment.');
      const { paymentIntent: pi, error: rErr } = await term.retrievePaymentIntent(pi0.clientSecret);
      if (rErr) throw new Error(rErr.message);
      setPhase(method === 'tapToPay' ? 'Ask the client to tap…' : 'Present card on the reader…');
      const { paymentIntent: pi2, error: colErr } = await term.collectPaymentMethod({ paymentIntent: pi });
      if (colErr) throw new Error(colErr.message);
      setPhase('Processing…');
      const { paymentIntent: pi3, error: conErr } = await term.confirmPaymentIntent({ paymentIntent: pi2 });
      if (conErr) throw new Error(conErr.message);
      if (pi3?.status !== 'succeeded') throw new Error(`Payment ${pi3?.status || 'did not complete'}.`);
      onPaid?.(pi3.id || pi0.paymentIntentId);
    } catch (e) {
      Alert.alert('Card payment failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
      setPhase('');
    }
  }

  return (
    <TouchableOpacity style={[styles.btn, (busy || disabled) && { opacity: 0.6 }]} onPress={pay} disabled={busy || disabled} activeOpacity={0.85}>
      {busy ? (
        <Text style={styles.txt}>{phase || 'Working…'}</Text>
      ) : (
        <Text style={styles.txt}>💳  {preferReader ? 'Card — tap / insert on reader' : 'Card — Tap to Pay'}</Text>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (t) => StyleSheet.create({
  btn: { marginTop: 10, backgroundColor: t.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  txt: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
