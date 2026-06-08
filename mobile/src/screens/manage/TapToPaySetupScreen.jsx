import { useState, useRef, useEffect } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Alert } from 'react-native';
import { fetchSettings } from '../../lib/firestore';
import useTenantAccess from '../../hooks/useTenantAccess';
import Icon from '../../components/Icon';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Native Terminal SDK (present only in a rebuilt binary). Lazy-required so the
// pre-rebuild bundle / Android never crash.
let SDK = null;
try { SDK = require('@stripe/stripe-terminal-react-native'); } catch { SDK = null; }

// Tap to Pay setup / enablement (req §3 Enabling + §4 Educating). iPhone-only.
// Enabling = connecting a Tap-to-Pay reader once, which triggers Apple's on-device
// Terms & Conditions + merchant onboarding. Admin-gated (3.8/3.8.1). The awareness
// + education copy/imagery MUST be Apple-approved assets from the Tap to Pay
// Marketing Toolkit — the [TTP-ASSET] blocks are where they drop in.
export default function TapToPaySetupScreen() {
  const { isAdmin } = useTenantAccess();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [settings, setSettings] = useState(null);
  useEffect(() => { fetchSettings().then(setSettings).catch(() => setSettings({})); }, []);

  if (Platform.OS !== 'ios') {
    return (
      <View style={styles.center}>
        <Icon name="phone" size={48} color={theme.textFaint} />
        <Text style={styles.gateTitle}>Tap to Pay runs on iPhone</Text>
        <Text style={styles.gateBody}>Tap to Pay on iPhone requires an iPhone XS or later. Open the iPhone app to set it up; this device can use a connected card reader instead.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      {/* Awareness moment — req 3.1/3.2. [TTP-ASSET] To use Apple's approved
          splash, just replace mobile/assets/ttp/splash.png (same filename) with
          the Marketing-Toolkit image — no code change. Hint shows in dev only. */}
      <Image source={require('../../../assets/ttp/splash.png')} style={styles.splash} resizeMode="cover" />
      {__DEV__ && <Text style={styles.assetHint}>Placeholder — replace mobile/assets/ttp/splash.png with Apple's approved splash</Text>}

      <Text style={styles.title}>Accept payments with just your iPhone</Text>
      <Text style={styles.sub}>Take contactless cards, Apple Pay, and digital wallets right on your iPhone — no extra hardware or reader needed.</Text>

      {/* Enable section — hook lives in EnableTapToPay so it's never called
          conditionally; rendered only when the native SDK is in the build. */}
      {SDK
        ? <EnableTapToPay isAdmin={isAdmin} settings={settings} />
        : (
          <TouchableOpacity style={styles.primary} onPress={() => Alert.alert('Update the app', 'Tap to Pay needs the latest iPhone build. Install it, then return here to set up.')}>
            <Text style={styles.primaryText}>Set up Tap to Pay</Text>
          </TouchableOpacity>
        )}

      {/* Merchant education — req §4. [TTP-ASSET] use the Apple-approved education
          content (or ProximityReaderDiscovery on iOS 18+). */}
      <Text style={styles.section}>How it works</Text>
      <Edu title="Accept a contactless card" body="At checkout, choose Tap to Pay, then have your customer hold their card or phone near the top of your iPhone." />
      <Edu title="Apple Pay & digital wallets" body="Customers can pay with Apple Pay, Google Pay, and other wallets the same way — a tap near the top of the iPhone." />
      <Edu title="Find this again anytime" body="You can re-open this guide and re-enable Tap to Pay from Manage → Admin → Settings." />

      <Text style={styles.foot}>Setup, Terms & Conditions, and verification are handled securely by Apple and Stripe on your device.</Text>
    </ScrollView>
  );
}

// Only mounted when the native SDK exists, so the hook is always called.
function EnableTapToPay({ isAdmin, settings }) {
  const styles = useThemedStyles(makeStyles);
  const [phase, setPhase] = useState('');   // '', 'initializing', 'connecting', 'ready'
  const [busy, setBusy]   = useState(false);
  const readersRef = useRef([]);
  const term = SDK.useStripeTerminal({
    onUpdateDiscoveredReaders: (list) => { readersRef.current = list || []; },
  });

  async function enable() {
    if (!isAdmin) { Alert.alert('Admins only', 'Only an admin can accept the Tap to Pay Terms & Conditions. Ask your salon owner/admin to enable it.'); return; }
    const locationId = settings?.terminalLocationId || null;
    if (!locationId) { Alert.alert('Set a Terminal Location', 'Add your Stripe Terminal Location ID in Admin → Settings first.'); return; }
    setBusy(true); setPhase('initializing');
    try {
      readersRef.current = [];
      const { error: dErr } = await term.discoverReaders({ discoveryMethod: 'tapToPay', simulated: false });
      if (dErr) throw new Error(dErr.message);
      const start = Date.now();
      while (Date.now() - start < 20000 && readersRef.current.length === 0) { await new Promise(r => setTimeout(r, 400)); }
      const reader = readersRef.current[0];
      try { await term.cancelDiscovering?.(); } catch {}
      if (!reader) throw new Error('Tap to Pay is unavailable on this device (needs iPhone XS or later).');
      setPhase('connecting');
      const { error: cErr } = await term.connectReader({ discoveryMethod: 'tapToPay', reader, locationId, merchantDisplayName: settings?.salonName || 'Salon' });
      if (cErr) throw new Error(cErr.message);
      setPhase('ready');
    } catch (e) {
      setPhase('');
      Alert.alert('Could not enable Tap to Pay', e?.message || 'Please try again on a supported iPhone.');
    } finally { setBusy(false); }
  }

  if (phase === 'ready') {
    return <View style={[styles.statusCard, styles.statusOk]}><Text style={styles.statusOkText}>✓ Tap to Pay is ready on this iPhone.</Text></View>;
  }
  return (
    <>
      {!isAdmin && (
        <View style={styles.statusCard}><Text style={styles.statusText}>Only an admin can enable Tap to Pay. Ask your salon owner or an admin to set it up.</Text></View>
      )}
      <TouchableOpacity style={[styles.primary, (busy || !isAdmin) && { opacity: 0.6 }]} onPress={enable} disabled={busy || !isAdmin}>
        {busy
          ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator color="#fff" /><Text style={styles.primaryText}>{phase === 'connecting' ? 'Setting up…' : 'Initializing…'}</Text></View>
          : <Text style={styles.primaryText}>Set up Tap to Pay</Text>}
      </TouchableOpacity>
      {busy && <Text style={styles.progressNote}>Preparing Tap to Pay on iPhone — this can take a moment the first time.</Text>}
    </>
  );
}

function Edu({ title, body }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.eduCard}>
      <Text style={styles.eduTitle}>{title}</Text>
      <Text style={styles.eduBody}>{body}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  content: { padding: 18, paddingBottom: 36, maxWidth: 640, width: '100%', alignSelf: 'center' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, padding: 32 },
  gateTitle:{ fontSize: 18, fontWeight: '800', color: t.text, marginTop: 14, textAlign: 'center' },
  gateBody:{ fontSize: 14, color: t.textMuted, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  splash:  { width: '100%', aspectRatio: 5 / 3, borderRadius: 16, backgroundColor: t.surfaceAlt, marginBottom: 8 },
  assetHint:{ fontSize: 12, color: t.textFaint, marginBottom: 14, textAlign: 'center' },
  title:   { fontSize: 22, fontWeight: '800', color: t.text },
  sub:     { fontSize: 14, color: t.textMuted, marginTop: 8, lineHeight: 20, marginBottom: 18 },
  statusCard:{ backgroundColor: t.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.border, marginBottom: 12 },
  statusText:{ fontSize: 14, color: t.textMuted, lineHeight: 20 },
  statusOk:{ backgroundColor: t.greenSoft, borderColor: t.green },
  statusOkText:{ fontSize: 15, fontWeight: '700', color: t.green },
  primary: { backgroundColor: t.green, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  primaryText:{ color: '#fff', fontWeight: '800', fontSize: 15 },
  progressNote:{ fontSize: 12, color: t.textMuted, textAlign: 'center', marginTop: 10 },
  section: { fontSize: 13, fontWeight: '800', color: t.text, marginTop: 24, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  eduCard: { backgroundColor: t.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.border, marginBottom: 10 },
  eduTitle:{ fontSize: 15, fontWeight: '700', color: t.text },
  eduBody: { fontSize: 13, color: t.textMuted, marginTop: 4, lineHeight: 19 },
  foot:    { fontSize: 12, color: t.textFaint, marginTop: 18, lineHeight: 17, textAlign: 'center' },
});
