import { useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform, PermissionsAndroid, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getTerminalSetupStatus, setupTerminalLocation, createCardPaymentIntent } from '../../lib/firestore';
import { isTerminalAvailable } from '../../lib/terminal';
import TerminalProvider from '../../components/TerminalProvider';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Native Terminal module is only present after a rebuild; require lazily so the
// pre-rebuild JS bundle never throws (the screen then degrades to status +
// location creation, with a "update the app" note for pairing).
let SDK = null;
try { SDK = require('@stripe/stripe-terminal-react-native'); } catch { SDK = null; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ensureAndroidPermissions() {
  if (Platform.OS !== 'android') return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const wanted = [P.ACCESS_FINE_LOCATION];
  if (Platform.Version >= 31) wanted.push(P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT);
  const res = await PermissionsAndroid.requestMultiple(wanted.filter(Boolean));
  return wanted.every(p => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

// In-app Card Reader (Stripe Terminal) setup wizard:
//   1) readiness  2) auto-create the Terminal Location  3) pair the reader
//   4) test charge. Removes the Stripe-Dashboard step entirely. Admin tile.
export default function ReaderSetupScreen() {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const [status,   setStatus]   = useState(null);
  const [creating, setCreating] = useState(false);
  const [msg,      setMsg]      = useState('');

  const load = useCallback(() => {
    getTerminalSetupStatus().then(setStatus).catch(e => setStatus({ error: e?.message || 'load failed' }));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function createLocation() {
    setCreating(true); setMsg('');
    try {
      const r = await setupTerminalLocation();
      setMsg(r.created ? '✓ Created reader location' : '✓ Location ready');
      load();
    } catch (e) { setMsg(`Error: ${e?.message || 'could not create location'}`); }
    finally { setCreating(false); }
  }

  const st = status || {};
  const termBuilt = isTerminalAvailable();

  const Row = ({ ok, children }) => (
    <View style={styles.row}>
      <Text style={[styles.rowMark, { color: ok ? theme.green : theme.textMuted }]}>{ok ? '✓' : '○'}</Text>
      <Text style={styles.rowText}>{children}</Text>
    </View>
  );

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={styles.h2}>Card reader setup</Text>
      <Text style={styles.sub}>Get this iPad ready to take in-person card payments.</Text>

      {status === null ? (
        <ActivityIndicator color={theme.green} style={{ marginTop: 24 }} />
      ) : st.error ? (
        <Text style={styles.err}>Couldn’t load status: {st.error}</Text>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>1 · Readiness</Text>
            <Row ok={st.connectReady}>Stripe payments {st.connectReady ? 'connected' : '— finish onboarding (Payments tile)'}</Row>
            <Row ok={st.hasLocation}>Reader location {st.hasLocation ? 'created' : '— create below'}</Row>
            <Row ok={termBuilt}>Reader software {termBuilt ? 'installed' : '— update the app build'}</Row>
            <Text style={styles.mode}>Mode: {st.testMode ? 'TEST — simulated reader, test cards only' : 'LIVE — real cards'}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>2 · Reader location</Text>
            <Text style={styles.cardBody}>Creates the Stripe Terminal Location your reader registers to. One tap — no Stripe dashboard needed.</Text>
            <TouchableOpacity style={[styles.btn, creating && { opacity: 0.6 }]} onPress={createLocation} disabled={creating} activeOpacity={0.85}>
              <Text style={styles.btnText}>{creating ? 'Working…' : (st.hasLocation ? 'Verify location' : 'Create reader location')}</Text>
            </TouchableOpacity>
            {!!msg && <Text style={[styles.msg, { color: msg.startsWith('Error') ? theme.danger : theme.green }]}>{msg}</Text>}
          </View>

          {!termBuilt ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>3 · Pair the reader</Text>
              <Text style={styles.cardBody}>Reader pairing needs the latest app build — the card-reader software isn’t in this version yet. Update the app, then come back here.</Text>
            </View>
          ) : !st.hasLocation ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>3 · Pair the reader</Text>
              <Text style={styles.cardBody}>Create the reader location above first, then pairing unlocks.</Text>
            </View>
          ) : (
            <TerminalProvider>
              <ReaderPairing locationId={st.locationId} testMode={st.testMode} styles={styles} theme={theme} />
            </TerminalProvider>
          )}
        </>
      )}
    </ScrollView>
  );
}

// Steps 3+4 — needs the native SDK + a StripeTerminalProvider (supplied by the
// TerminalProvider wrapper above). Reuses the discover→connect→collect→confirm
// flow from CardPayButton.
function ReaderPairing({ locationId, testMode, styles, theme }) {
  const useStripeTerminal = SDK?.useStripeTerminal;
  const readersRef = useRef([]);
  const [connected, setConnected] = useState(null);
  const [phase,     setPhase]     = useState('');
  const [busy,      setBusy]      = useState(false);
  const [charged,   setCharged]   = useState('');

  const term = useStripeTerminal({
    onUpdateDiscoveredReaders: (list) => { readersRef.current = list || []; },
    onDidChangeConnectionStatus: (s) => { if (s !== 'connected') setConnected(null); },
  });

  async function waitForReader(ms = 20000) {
    const start = Date.now();
    while (Date.now() - start < ms) { if (readersRef.current.length) return readersRef.current[0]; await sleep(400); }
    return null;
  }

  async function connect() {
    if (busy) return;
    setBusy(true); setPhase(testMode ? 'Preparing test reader…' : 'Searching for reader…');
    try {
      if (!testMode) {
        const ok = await ensureAndroidPermissions();
        if (!ok) throw new Error('Bluetooth and location permission are required to connect a reader.');
      }
      readersRef.current = [];
      const { error: dErr } = await term.discoverReaders({ discoveryMethod: 'bluetoothScan', simulated: !!testMode });
      if (dErr) throw new Error(dErr.message);
      const reader = await waitForReader();
      try { await term.cancelDiscovering(); } catch {}
      if (!reader) throw new Error('No reader found. Power it on, keep it next to the iPad, and make sure Bluetooth is on.');
      setPhase('Connecting…');
      const locId = locationId || reader?.location?.id || undefined;
      const { reader: cr, error: cErr } = await term.connectReader({ discoveryMethod: 'bluetoothScan', reader, locationId: locId });
      if (cErr) throw new Error(cErr.message);
      setConnected(cr?.serialNumber || cr?.deviceType || 'Reader');
    } catch (e) {
      Alert.alert('Could not connect', e?.message || 'Try again.');
    } finally { setBusy(false); setPhase(''); }
  }

  async function runCharge() {
    if (busy) return;
    setBusy(true); setCharged(''); setPhase('Starting test charge…');
    try {
      const pi0 = await createCardPaymentIntent(100, 'Card reader test', `readertest_${Date.now()}`);
      if (!pi0?.clientSecret) throw new Error('Could not start the test charge.');
      const { paymentIntent: pi, error: rErr } = await term.retrievePaymentIntent(pi0.clientSecret);
      if (rErr) throw new Error(rErr.message);
      setPhase(testMode ? 'Simulating a tap…' : 'Present a card on the reader…');
      const { paymentIntent: pi2, error: colErr } = await term.collectPaymentMethod({ paymentIntent: pi });
      if (colErr) throw new Error(colErr.message);
      setPhase('Processing…');
      const { paymentIntent: pi3, error: conErr } = await term.confirmPaymentIntent({ paymentIntent: pi2 });
      if (conErr) throw new Error(conErr.message);
      if (pi3?.status !== 'succeeded') throw new Error(`Charge ${pi3?.status || 'did not complete'}.`);
      setCharged(testMode ? '✓ Test charge succeeded (simulated — no money moved).' : '✓ $1.00 charged successfully. Refund it from Stripe when done.');
    } catch (e) {
      Alert.alert('Test charge failed', e?.message || 'Try again.');
    } finally { setBusy(false); setPhase(''); }
  }

  function testCharge() {
    if (testMode) return runCharge();
    Alert.alert('Run a real $1.00 charge?', 'This charges a real card $1.00 to confirm the reader works end-to-end. You can refund it afterward.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Charge $1.00', onPress: runCharge },
    ]);
  }

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>3 · Pair the reader</Text>
        <Text style={styles.cardBody}>Power on your Stripe Reader M2, keep it next to this iPad with Bluetooth on, then connect.</Text>
        {connected ? <Text style={[styles.msg, { color: theme.green }]}>✓ Connected: {connected}</Text> : null}
        <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={connect} disabled={busy} activeOpacity={0.85}>
          <Text style={styles.btnText}>{busy && !charged ? (phase || 'Working…') : (connected ? 'Reconnect reader' : 'Find & connect reader')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>4 · Test charge</Text>
        <Text style={styles.cardBody}>{testMode ? 'Runs a free simulated charge to confirm the whole flow works.' : 'Runs a real $1.00 charge (refundable) to confirm the reader works.'}</Text>
        <TouchableOpacity style={[styles.btn, (busy || !connected) && { opacity: 0.5 }]} onPress={testCharge} disabled={busy || !connected} activeOpacity={0.85}>
          <Text style={styles.btnText}>{busy ? (phase || 'Working…') : (testMode ? 'Run test charge (simulated)' : 'Run $1.00 test charge')}</Text>
        </TouchableOpacity>
        {!connected ? <Text style={styles.hint}>Connect a reader first.</Text> : null}
        {!!charged && <Text style={[styles.msg, { color: theme.green }]}>{charged}</Text>}
      </View>
    </>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: t.bg },
  h2:        { fontSize: 22, fontWeight: '800', color: t.text },
  sub:       { fontSize: 14, color: t.textMuted, marginTop: 4 },
  err:       { color: t.danger, marginTop: 16, fontSize: 14 },
  card:      { backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.border, padding: 16, marginTop: 14 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: t.text, marginBottom: 8 },
  cardBody:  { fontSize: 13, color: t.textMuted, lineHeight: 19, marginBottom: 12 },
  row:       { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  rowMark:   { fontSize: 15, fontWeight: '800', width: 20 },
  rowText:   { flex: 1, fontSize: 13.5, color: t.text, lineHeight: 19 },
  mode:      { fontSize: 12, color: t.textFaint, marginTop: 8 },
  btn:       { backgroundColor: t.green, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnText:   { color: '#fff', fontWeight: '800', fontSize: 14.5 },
  msg:       { fontSize: 13, fontWeight: '700', marginTop: 10 },
  hint:      { fontSize: 12, color: t.textFaint, marginTop: 8 },
});
