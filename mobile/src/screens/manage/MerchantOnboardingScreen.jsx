import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { getStripeConnectStatus, createExpressAccount, createAccountOnboardingLink, createExpressLoginLink } from '../../lib/firestore';
import useTenantAccess from '../../hooks/useTenantAccess';
import Icon from '../../components/Icon';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Merchant onboarding (Stripe Connect KYC) — cross-platform. Becoming a
// payment-accepting merchant is the prerequisite for any card flow (including
// Tap to Pay). Wraps the existing Connect backend; opens Stripe's hosted KYC in
// a browser and re-checks status on return. The Tap-to-Pay CTA only shows on iOS.
export default function MerchantOnboardingScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [state, setState] = useState(null);   // { connected, status }
  const [busy, setBusy]   = useState(false);

  const load = useCallback(async () => {
    try { setState(await getStripeConnectStatus()); }
    catch (e) { setState({ connected: false, error: e?.message }); }
  }, []);
  // Re-check on focus so returning from the Stripe browser refreshes status.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const st = state?.status || {};
  const active    = !!(st.charges_enabled ?? st.chargesEnabled);
  const submitted = !!(st.details_submitted ?? st.detailsSubmitted);
  const connected = !!state?.connected;

  async function startOnboarding() {
    if (!isAdmin) { Alert.alert('Admins only', 'Ask your salon owner/admin to set up payments.'); return; }
    setBusy(true);
    try {
      if (!connected) await createExpressAccount();
      const { url } = await createAccountOnboardingLink();
      if (!url) throw new Error('Could not start onboarding.');
      await WebBrowser.openBrowserAsync(url);
      await load();   // refresh after they return
    } catch (e) { Alert.alert("Couldn't start setup", e?.message || 'Please try again.'); }
    finally { setBusy(false); }
  }
  async function managePayments() {
    setBusy(true);
    try { const { url } = await createExpressLoginLink(); if (url) await WebBrowser.openBrowserAsync(url); }
    catch (e) { Alert.alert("Couldn't open dashboard", e?.message || 'Please try again.'); }
    finally { setBusy(false); }
  }

  if (state === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={[styles.badge, active ? styles.badgeOk : styles.badgePend]}>
          <Icon name="dollar" size={28} color={active ? theme.green : theme.textMuted} />
        </View>
        <Text style={styles.title}>{active ? 'Payments active' : connected ? 'Finish your payment setup' : 'Set up payments'}</Text>
        <Text style={styles.sub}>
          {active
            ? 'You can accept card payments. On iPhone, you can also use Tap to Pay.'
            : connected
              ? 'Your application is in progress. Finish the remaining steps to start accepting cards.'
              : 'Verify your business with Stripe to accept credit and debit cards in person and online.'}
        </Text>
      </View>

      {/* Progress steps */}
      <View style={styles.steps}>
        <Step n="1" label="Business details & verification (KYC)" done={submitted} />
        <Step n="2" label="Payouts enabled" done={active} />
        <Step n="3" label="Accept your first payment" done={false} />
      </View>

      {!active ? (
        <TouchableOpacity style={[styles.primary, busy && { opacity: 0.6 }]} onPress={startOnboarding} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{connected ? 'Continue setup' : 'Set up payments with Stripe'}</Text>}
        </TouchableOpacity>
      ) : (
        <>
          {Platform.OS === 'ios' && (
            <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate('TapToPaySetup')}>
              <Text style={styles.primaryText}>Set up Tap to Pay on iPhone</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.secondary, busy && { opacity: 0.6 }]} onPress={managePayments} disabled={busy}>
            <Text style={styles.secondaryText}>Manage payments & payouts</Text>
          </TouchableOpacity>
        </>
      )}

      {Platform.OS !== 'ios' && active && (
        <Text style={styles.note}>Tap to Pay runs on iPhone (XS or newer). Use the iPhone app to accept contactless cards directly on the device; this device can use a connected card reader.</Text>
      )}
      <Text style={styles.note}>Verification is handled securely by Stripe. You can return any time to finish or update your details.</Text>
    </ScrollView>
  );
}

function Step({ n, label, done }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.step}>
      <View style={[styles.stepDot, done && styles.stepDotDone]}><Text style={[styles.stepNum, done && styles.stepNumDone]}>{done ? '✓' : n}</Text></View>
      <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>{label}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  content: { padding: 18, paddingBottom: 36, maxWidth: 640, width: '100%', alignSelf: 'center' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  hero:    { alignItems: 'center', paddingVertical: 8, marginBottom: 8 },
  badge:   { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  badgeOk: { backgroundColor: t.greenSoft },
  badgePend:{ backgroundColor: t.surfaceAlt },
  title:   { fontSize: 22, fontWeight: '800', color: t.text, textAlign: 'center' },
  sub:     { fontSize: 14, color: t.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  steps:   { backgroundColor: t.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: t.border, marginTop: 18, marginBottom: 18 },
  step:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  stepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  stepDotDone:{ backgroundColor: t.green },
  stepNum: { fontSize: 13, fontWeight: '800', color: t.textMuted },
  stepNumDone:{ color: '#fff' },
  stepLabel:{ flex: 1, fontSize: 14, color: t.text },
  stepLabelDone:{ color: t.textMuted },
  primary: { backgroundColor: t.green, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  primaryText:{ color: '#fff', fontWeight: '800', fontSize: 15 },
  secondary:{ backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  secondaryText:{ color: t.text, fontWeight: '700', fontSize: 15 },
  note:    { fontSize: 12, color: t.textFaint, marginTop: 14, lineHeight: 17, textAlign: 'center' },
});
