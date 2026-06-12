import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Image, FlatList, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { subscribeCheckoutSession, fetchSettings, fetchSlides } from '../../lib/firestore';
import QRCode from '../../components/QRCode';
import KioskExitButton from '../../components/KioskExitButton';
import KioskCheckout from './KioskCheckout';
import WalkinKioskScreen from './WalkinKioskScreen';
import useTenantAccess from '../../hooks/useTenantAccess';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { resolveKioskView } from '../../lib/kioskWalkin';

// Front-desk kiosk. The idle screen is configurable (Admin → Kiosk →
// settings.kioskDefaultMode): 'walkin' shows the customer walk-in sign-in,
// 'tipflow'/'checkout' show the TipFlow tech display. Whatever the idle, when a
// tech "sends to front desk" (writes data/checkoutSession status:pending) it
// takes over with the customer-facing checkout (KioskCheckout), then returns to
// the configured idle. Default mode is 'walkin'.
export default function KioskScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { email } = useTenantAccess();
  const [session, setSession]   = useState(undefined); // undefined = loading
  const [settings, setSettings] = useState(null);

  useEffect(() => { fetchSettings().then(setSettings).catch(() => setSettings({})); }, []);
  useEffect(() => subscribeCheckoutSession(setSession), []);

  // Safety net: never spin forever on the initial load. If settings/session
  // haven't arrived in 8s (slow/flaky Firestore), fall through to the idle
  // TipFlow — the realtime listener still updates session when it catches up.
  useEffect(() => {
    const t = setTimeout(() => {
      setSettings(s => (s === null ? {} : s));
      setSession(s => (s === undefined ? null : s));
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  // Kiosk lock: hide the bottom tab bar while the kiosk is focused (the header
  // is hidden + back gesture disabled in ManageStack), so a customer can't
  // navigate away. Staff exit via a long-press on the idle screen.
  useFocusEffect(useCallback(() => {
    const parent = navigation.getParent();
    parent?.setOptions({ tabBarStyle: { display: 'none' } });
    return () => parent?.setOptions({ tabBarStyle: undefined });
  }, [navigation]));

  if (session === undefined || settings === null) {
    return <View style={styles.center}><ActivityIndicator color={theme.green} size="large" /></View>;
  }
  // 'checkout' = a live session (pending/paying/confirmed) takes over; else the
  // configured idle ('walkin' → walk-in sign-in, otherwise TipFlow).
  const view = resolveKioskView(settings, session);
  return (
    <View style={{ flex: 1 }}>
      {view === 'checkout'
        ? <KioskCheckout key={session.createdAt} session={session} settings={settings} email={email} />
        : view === 'walkin'
          ? <WalkinKioskScreen />
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

// One full-screen TipFlow slide page (so the carousel can page/swipe). The
// headshot dominates: in LANDSCAPE it fills the left side (photo | tip), in
// PORTRAIT it fills the top ~3/4 (photo over tip).
function TipSlide({ slide, width, height, styles, theme }) {
  const landscape = width > height;
  const items = tipItems(slide);
  const item = items[0] || null;
  // Portrait: photo takes the top ~62% so the name + QR below have room and
  // don't get overlapped. Landscape: photo fills the left ~55%.
  const photoFrac = landscape ? 0.55 : 0.62;
  const photoStyle = landscape
    ? { width: Math.round(width * photoFrac), height }
    : { width, height: Math.round(height * photoFrac) };
  const infoStyle = landscape
    ? { width: width - Math.round(width * photoFrac), height, alignItems: 'center', justifyContent: 'center', padding: 24 }
    : { width, height: height - Math.round(height * photoFrac), alignItems: 'center', justifyContent: 'center', padding: 16 };
  const qrSize = landscape ? Math.min(220, Math.round(height * 0.34)) : Math.min(170, Math.round(height * 0.2));
  return (
    <View style={{ width, height, flexDirection: landscape ? 'row' : 'column', backgroundColor: theme.bg }}>
      {slide.img
        ? <Image source={{ uri: slide.img }} style={photoStyle} resizeMode="cover" />
        : <View style={[photoStyle, { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceAlt }]}><Text style={styles.tipPhotoMark}>✦</Text></View>}
      <View style={infoStyle}>
        {!!slide.name && <Text style={styles.tipName} numberOfLines={1}>{slide.name}</Text>}
        {item && (
          <View style={styles.tipQrBox}>
            <View style={styles.tipQr}><QRCode value={item.url} size={qrSize} /></View>
            <Text style={styles.tipQrLabel}>{item.label}</Text>
            <Text style={styles.tipHandle}>{item.handle}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function KioskIdle({ styles, theme }) {
  // Cycle the TipFlow slides as the idle screen. Keep any slide with a photo or
  // a tip/social link — a headshot alone is still a nice waiting display, and a
  // link alone still lets a client tip.
  const { width, height: winH } = useWindowDimensions();
  const [slides, setSlides] = useState(null);
  const [idx, setIdx] = useState(0);
  const [listH, setListH] = useState(0);
  const idxRef = useRef(0);
  const listRef = useRef(null);
  // Pause auto-advance briefly after a manual swipe so it doesn't yank the page.
  const lastTouchRef = useRef(0);

  useEffect(() => {
    let alive = true;
    fetchSlides()
      .then(s => { if (alive) setSlides((s || []).filter(x => x.img || x.vu || x.iu || x.fu || x.hu)); })
      .catch(() => { if (alive) setSlides([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!slides || slides.length < 2) return;
    const id = setInterval(() => {
      if (Date.now() - lastTouchRef.current < 12000) return; // recently swiped — leave it
      const next = (idxRef.current + 1) % slides.length;
      idxRef.current = next; setIdx(next);
      listRef.current?.scrollToOffset({ offset: next * width, animated: true });
    }, 8000);
    return () => clearInterval(id);
  }, [slides, width]);

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
  return (
    <View style={styles.tipFlowWrap} onLayout={e => setListH(e.nativeEvent.layout.height)}>
      <FlatList
        ref={listRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScrollBeginDrag={() => { lastTouchRef.current = Date.now(); }}
        onMomentumScrollEnd={e => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          idxRef.current = i; setIdx(i); lastTouchRef.current = Date.now();
        }}
        renderItem={({ item }) => <TipSlide slide={item} width={width} height={listH || winH} styles={styles} theme={theme} />}
      />
      {slides.length > 1 && (
        <View style={styles.dotsOverlay} pointerEvents="none">
          {slides.map((_, j) => <View key={j} style={[styles.dot, j === idx && styles.dotOn]} />)}
        </View>
      )}
    </View>
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
  tipName:  { fontSize: 30, fontWeight: '800', color: t.text, marginBottom: 14, textAlign: 'center' },
  tipQrBox: { alignItems: 'center' },
  tipQr:    { backgroundColor: '#fff', padding: 12, borderRadius: 14 },
  tipQrLabel:{ fontSize: 16, fontWeight: '800', color: t.green, marginTop: 14 },
  tipHandle:{ fontSize: 15, fontWeight: '700', color: '#3D95CE', marginTop: 4 },
  dots:     { flexDirection: 'row', gap: 7, marginTop: 22 },
  dotsOverlay: { position: 'absolute', bottom: 14, left: 0, right: 0, flexDirection: 'row', gap: 8, justifyContent: 'center' },
  dot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: t.border },
  dotOn:    { backgroundColor: t.green, width: 22 },
});
