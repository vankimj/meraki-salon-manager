import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { subscribeCheckoutSession, fetchSettings, fetchSlides } from '../../lib/firestore';
import QRCode from '../../components/QRCode';
import KioskExitButton from '../../components/KioskExitButton';
import KioskCheckout from './KioskCheckout';
import useTenantAccess from '../../hooks/useTenantAccess';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Front-desk kiosk. Idle = TipFlow: a rotating display of each tech with a
// Venmo (or social) QR so a waiting client can tip directly. When a tech "sends
// to front desk" (writes data/checkoutSession status:pending) it takes over with
// the customer-facing checkout (KioskCheckout), then returns to the TipFlow idle.
export default function KioskScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { email } = useTenantAccess();
  const [session, setSession]   = useState(undefined); // undefined = loading
  const [settings, setSettings] = useState(null);

  useEffect(() => { fetchSettings().then(setSettings).catch(() => setSettings({})); }, []);
  useEffect(() => subscribeCheckoutSession(setSession), []);

  // Kiosk lock: hide the bottom tab bar while the kiosk is focused (the header
  // is hidden + back gesture disabled in ManageStack), so a customer can't
  // navigate away. Staff exit via a long-press on the idle screen.
  useFocusEffect(useCallback(() => {
    const parent = navigation.getParent();
    parent?.setOptions({ tabBarStyle: { display: 'none' } });
    return () => parent?.setOptions({ tabBarStyle: undefined });
  }, [navigation]));

  const active = session && (session.status === 'pending' || session.status === 'paying');

  if (session === undefined || settings === null) {
    return <View style={styles.center}><ActivityIndicator color={theme.green} size="large" /></View>;
  }
  return (
    <View style={{ flex: 1 }}>
      {active
        ? <KioskCheckout key={session.createdAt} session={session} settings={settings} email={email} />
        : <KioskIdle styles={styles} theme={theme} />}
      <View style={styles.kioskExit}><KioskExitButton onExit={() => navigation.goBack()} /></View>
    </View>
  );
}

// Build the tip / link targets for a TipFlow slide, Venmo first so the idle
// screen leads with "Scan to tip". Mirrors the web QRPanel link set.
function tipItems(slide) {
  const r = [];
  if (slide.vu) r.push({ url: `https://venmo.com/u/${slide.vu}`,   handle: `@${slide.vu}`, label: 'Scan to tip 💸', venmo: true });
  if (slide.iu) r.push({ url: `https://instagram.com/${slide.iu}`, handle: `@${slide.iu}`, label: 'Follow on Instagram' });
  if (slide.fu) r.push({ url: `https://facebook.com/${slide.fu}`,  handle: `@${slide.fu}`, label: 'Find us on Facebook' });
  if (slide.hu) r.push({ url: slide.hu, handle: slide.hu.replace(/^https?:\/\//, '').replace(/\/$/, ''), label: 'Visit website' });
  return r;
}

function KioskIdle({ styles, theme }) {
  // Cycle the TipFlow slides as the idle screen. Keep any slide with a photo or
  // a tip/social link — a headshot alone is still a nice waiting display, and a
  // link alone still lets a client tip.
  const [slides, setSlides] = useState(null);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchSlides()
      .then(s => { if (alive) setSlides((s || []).filter(x => x.img || x.vu || x.iu || x.fu || x.hu)); })
      .catch(() => { if (alive) setSlides([]); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!slides || slides.length < 2) return;
    const id = setInterval(() => setIdx(i => (i + 1) % slides.length), 8000);
    return () => clearInterval(id);
  }, [slides]);

  // Exit is via the admin-PIN KioskExitButton overlay (rendered by KioskScreen).
  if (!slides || slides.length === 0) {
    return (
      <View style={styles.idle}>
        <Text style={styles.idleMark}>✦</Text>
        <Text style={styles.idleTitle}>Plume Nexus</Text>
        <Text style={styles.idleSub}>Welcome — please relax while we get you checked out.</Text>
      </View>
    );
  }
  const s = slides[idx % slides.length];
  const items = tipItems(s);
  const item = items[0] || null;
  return (
    <ScrollView style={styles.tipFlowWrap} contentContainerStyle={styles.tipFlowContent}>
      <View style={styles.tipCard}>
        {s.img
          ? <Image source={{ uri: s.img }} style={styles.tipPhoto} resizeMode="cover" />
          : <View style={[styles.tipPhoto, styles.tipPhotoEmpty]}><Text style={styles.tipPhotoMark}>✦</Text></View>}
        {!!s.name && <Text style={styles.tipName}>{s.name}</Text>}
        {item && (
          <View style={styles.tipQrBox}>
            <View style={styles.tipQr}><QRCode value={item.url} size={188} /></View>
            <Text style={styles.tipQrLabel}>{item.label}</Text>
            <Text style={styles.tipHandle}>{item.handle}</Text>
          </View>
        )}
      </View>
      {slides.length > 1 && (
        <View style={styles.dots}>
          {slides.map((_, j) => <View key={j} style={[styles.dot, j === (idx % slides.length) && styles.dotOn]} />)}
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  idle:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, padding: 40 },
  idleMark: { fontSize: 54, color: t.green, marginBottom: 16 },
  idleTitle:{ fontSize: 26, fontWeight: '800', color: t.text, textAlign: 'center' },
  idleSub:  { fontSize: 15, color: t.textMuted, marginTop: 10, textAlign: 'center', lineHeight: 21 },
  kioskExit:{ position: 'absolute', top: 12, right: 12, zIndex: 50 },
  tipFlowWrap:   { flex: 1, backgroundColor: t.bg },
  tipFlowContent:{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  tipCard:  { width: '100%', maxWidth: 460, alignItems: 'center', backgroundColor: t.surface, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: t.border },
  tipPhoto: { width: 200, height: 240, borderRadius: 18, backgroundColor: t.surfaceAlt },
  tipPhotoEmpty:{ alignItems: 'center', justifyContent: 'center' },
  tipPhotoMark:{ fontSize: 56, color: t.green },
  tipName:  { fontSize: 26, fontWeight: '800', color: t.text, marginTop: 18, textAlign: 'center' },
  tipQrBox: { alignItems: 'center', marginTop: 18 },
  tipQr:    { backgroundColor: '#fff', padding: 12, borderRadius: 14 },
  tipQrLabel:{ fontSize: 16, fontWeight: '800', color: t.green, marginTop: 14 },
  tipHandle:{ fontSize: 15, fontWeight: '700', color: '#3D95CE', marginTop: 4 },
  dots:     { flexDirection: 'row', gap: 7, marginTop: 22 },
  dot:      { width: 7, height: 7, borderRadius: 4, backgroundColor: t.border },
  dotOn:    { backgroundColor: t.green },
});
