import { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { subscribeCheckoutSession, clearCheckoutSession, fetchSettings, fetchClient, chargeStoredCard, fetchSlides } from '../../lib/firestore';
import { computeTotals, buildTechSplit } from '../../lib/checkout';
import { completeSale } from '../../lib/completeSale';
import { isTerminalAvailable } from '../../lib/terminal';
import CardPayButton from '../checkout/CardPayButton';
import useTenantAccess from '../../hooks/useTenantAccess';
import useResponsive from '../../hooks/useResponsive';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const TIP_PCTS = [0, 15, 18, 20, 25];

// Front-desk kiosk. Idle = a calm waiting screen; when a tech "sends to front
// desk" (writes data/checkoutSession status:pending) it takes over with a
// customer-facing checkout: itemized services + tax + total, a tip selector,
// then Pay → Cash (tendered + change) or Card (M2 reader). On success it writes
// the canonical receipt (via completeSale) and returns to idle.
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
  if (!active) return <KioskIdle styles={styles} theme={theme} onExit={() => navigation.goBack()} />;

  return (
    <KioskCheckout
      key={session.createdAt}
      session={session}
      settings={settings}
      email={email}
      styles={styles}
      theme={theme}
    />
  );
}

function KioskIdle({ styles, theme, onExit }) {
  // Cycle the TipFlow slides (headshots) as the idle screen; fall back to a
  // branded card if there are no slides.
  const [slides, setSlides] = useState(null);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchSlides().then(s => { if (alive) setSlides((s || []).filter(x => x.img)); }).catch(() => { if (alive) setSlides([]); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!slides || slides.length < 2) return;
    const id = setInterval(() => setIdx(i => (i + 1) % slides.length), 6000);
    return () => clearInterval(id);
  }, [slides]);

  // Long-press anywhere on the idle screen = staff exit out of kiosk mode.
  const exitProps = { activeOpacity: 1, onLongPress: onExit, delayLongPress: 900 };

  if (!slides || slides.length === 0) {
    return (
      <TouchableOpacity style={styles.idle} {...exitProps}>
        <Text style={styles.idleMark}>✦</Text>
        <Text style={styles.idleTitle}>Plume Nexus</Text>
        <Text style={styles.idleSub}>Welcome — please relax while we get you checked out.</Text>
      </TouchableOpacity>
    );
  }
  const s = slides[idx % slides.length];
  return (
    <TouchableOpacity style={styles.slideWrap} {...exitProps}>
      <Image source={{ uri: s.img }} style={styles.slideImg} resizeMode="cover" />
      {!!s.name && (
        <View style={styles.slideCaption}>
          <Text style={styles.slideName}>{s.name}</Text>
          {!!s.handle && <Text style={styles.slideHandle}>{s.handle}</Text>}
        </View>
      )}
    </TouchableOpacity>
  );
}

function KioskCheckout({ session, settings, email, styles, theme }) {
  const { isTablet } = useResponsive();
  const cart = session.cart || { appts: [], products: [] };

  const lines = useMemo(() => {
    const out = [];
    (cart.appts || []).forEach((a, apptIdx) => {
      (a.services || []).forEach((s, svcIdx) => {
        out.push({ apptIdx, svcIdx, name: s.name || '—', price: Number(s.price) || 0, techName: s.techName || a.techName || '', taxable: s.taxable !== false });
      });
    });
    return out;
  }, [session.createdAt]);
  const products = cart.products || [];
  const productsTotal = products.reduce((s, it) => s + (Number(it.product?.price) || 0) * (it.qty || 1), 0);

  const [tipMode, setTipMode]   = useState('pct');   // 'pct' | 'custom'
  const [tipPct, setTipPct]     = useState(0);
  const [tipAmtStr, setTipAmtStr] = useState('');
  const [stage, setStage]       = useState('review'); // review | cash | done
  const [cashStr, setCashStr]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [paidMsg, setPaidMsg]   = useState('');
  const [client, setClient]     = useState(null);

  // Pull the client to surface a "charge card on file" option when they have one.
  useEffect(() => {
    let alive = true;
    if (session.clientId) fetchClient(session.clientId).then(c => { if (alive) setClient(c); }).catch(() => {});
    return () => { alive = false; };
  }, [session.clientId]);
  const savedPm = client?.paymentMethods?.find(p => p.id === client.defaultPaymentMethodId) || client?.paymentMethods?.[0] || null;

  const tip = { custom: tipMode === 'custom', amount: Number(tipAmtStr) || 0, pct: tipMode === 'pct' ? tipPct : null };
  const totalsFor = (method) => computeTotals({
    lines, productsTotal, discount: null, promo: null,
    taxRate: Number(settings?.taxRate) || 0,
    ccFeePct: Number(settings?.ccFeePct) || 0, ccFeeFlat: Number(settings?.ccFeeFlat) || 0,
    method, noCardTips: !!settings?.noCardTips, tip, giftCardBalance: 0, applyGC: false,
  });
  const cashTotals = useMemo(() => totalsFor('cash'), [lines, productsTotal, tipMode, tipPct, tipAmtStr, settings]);
  const cardTotals = useMemo(() => totalsFor('card'), [lines, productsTotal, tipMode, tipPct, tipAmtStr, settings]);

  // Keep the result (esp. change due) on screen, then auto-return to idle.
  useEffect(() => {
    if (stage !== 'done') return;
    const id = setTimeout(() => { clearCheckoutSession().catch(() => {}); }, 9000);
    return () => clearTimeout(id);
  }, [stage]);

  async function finish(method, opts = {}) {
    setSaving(true);
    try {
      const t = method === 'card' ? cardTotals : cashTotals;
      const { total, changeDue } = await completeSale({
        tab: { appts: cart.appts || [], products }, lines, products,
        totals: t, settings, email, method, ...opts,
      });
      // Leave the session active (so this done screen stays mounted) until the
      // auto-clear below returns the kiosk to idle — lets staff read the change.
      setPaidMsg(method === 'cash' && changeDue != null
        ? `Paid ${money(total)} — change due ${money(changeDue)}`
        : `Paid ${money(total)} — thank you!`);
      setStage('done');
    } catch (e) {
      Alert.alert('Checkout failed', e?.message || 'Please try again.');
      setSaving(false);
    }
  }

  async function payCardOnFile() {
    if (saving || !savedPm) return;
    setSaving(true);
    try {
      const res = await chargeStoredCard({
        clientId: session.clientId,
        amountCents: Math.round((cardTotals.total || 0) * 100),
        description: clientName,
        paymentMethodId: savedPm.id,
      });
      const status = res?.status;
      if (!res || (status !== 'succeeded' && status !== 'requires_capture')) {
        throw new Error(`Card ${status || 'was declined'}.`);
      }
      await finish('card', { stripePaymentIntentId: res.paymentIntentId });
    } catch (e) {
      Alert.alert('Card on file failed', e?.message || 'Please try again.');
      setSaving(false);
    }
  }

  function cancel() { clearCheckoutSession().catch(() => {}); }

  if (stage === 'done') {
    return (
      <View style={styles.idle}>
        <Text style={styles.doneMark}>✓</Text>
        <Text style={styles.idleTitle}>{paidMsg}</Text>
        <Text style={styles.idleSub}>A receipt is on its way. See you next time!</Text>
        <TouchableOpacity style={styles.doneBtn} onPress={() => clearCheckoutSession().catch(() => {})}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const clientName = session.clientName || (cart.appts?.[0]?.clientName) || 'Welcome';

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={[styles.content, isTablet && { maxWidth: 720, alignSelf: 'center', width: '100%' }]}>
      <View style={styles.headerRow}>
        <Text style={styles.hello}>Hi {clientName.split(' ')[0]} 👋</Text>
        <TouchableOpacity onPress={cancel} style={styles.cancelBtn}><Text style={styles.cancelText}>✕</Text></TouchableOpacity>
      </View>

      <Text style={styles.section}>Your visit</Text>
      {lines.map((l, i) => (
        <View key={`${l.apptIdx}-${l.svcIdx}-${i}`} style={styles.lineRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{l.name}</Text>
            <Text style={styles.lineTech}>{l.techName || '—'}</Text>
          </View>
          <Text style={styles.linePrice}>{money(l.price)}</Text>
        </View>
      ))}
      {products.map(it => (
        <View key={it.product.id} style={styles.lineRow}>
          <View style={{ flex: 1 }}><Text style={styles.lineName}>{it.product.name} × {it.qty}</Text></View>
          <Text style={styles.linePrice}>{money((it.product.price || 0) * it.qty)}</Text>
        </View>
      ))}

      {stage === 'review' && (
        <>
          <Text style={styles.section}>Add a tip?</Text>
          <View style={styles.tipRow}>
            {TIP_PCTS.map(p => {
              const on = tipMode === 'pct' && tipPct === p;
              return (
                <TouchableOpacity key={p} onPress={() => { setTipMode('pct'); setTipPct(p); }} style={[styles.tipChip, on && styles.tipChipOn]}>
                  <Text style={[styles.tipChipText, on && styles.tipChipTextOn]}>{p === 0 ? 'No tip' : `${p}%`}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity onPress={() => setTipMode('custom')} style={[styles.tipChip, tipMode === 'custom' && styles.tipChipOn]}>
              <Text style={[styles.tipChipText, tipMode === 'custom' && styles.tipChipTextOn]}>$</Text>
            </TouchableOpacity>
            {tipMode === 'custom' && (
              <TextInput style={styles.tipInput} value={tipAmtStr} onChangeText={setTipAmtStr} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={theme.placeholder} />
            )}
          </View>
        </>
      )}

      {/* Totals */}
      <View style={styles.totals}>
        <Row styles={styles} label="Subtotal" value={money(cashTotals.subtotal)} />
        {cashTotals.taxAmt > 0 && <Row styles={styles} label="Tax" value={money(cashTotals.taxAmt)} />}
        {cashTotals.tipAmt > 0 && <Row styles={styles} label="Tip" value={money(cashTotals.tipAmt)} />}
        <View style={styles.divider} />
        <Row styles={styles} label="Total" value={money(cashTotals.total)} big />
      </View>

      {stage === 'review' && (
        <>
          {savedPm && (
            <TouchableOpacity style={styles.cofBtn} onPress={payCardOnFile} disabled={saving} activeOpacity={0.85}>
              <Text style={styles.cofBtnText}>💳  Charge card on file · {(savedPm.brand || 'card')} •••• {savedPm.last4 || '••••'}</Text>
            </TouchableOpacity>
          )}
          {isTerminalAvailable() ? (
            <CardPayButton
              amountCents={Math.round((cardTotals.total || 0) * 100)}
              description={clientName}
              locationId={settings?.terminalLocationId || null}
              onBehalfOf={settings?.connectAccountId || settings?.stripeAccountId || undefined}
              merchantName={settings?.salonName || 'Salon'}
              preferReader={isTablet}
              disabled={saving || (lines.length === 0 && products.length === 0)}
              onPaid={(piId) => finish('card', { stripePaymentIntentId: piId })}
            />
          ) : (
            <View style={styles.cardDisabled}><Text style={styles.cardDisabledText}>💳 Card — connect a reader (Stripe Terminal)</Text></View>
          )}
          <TouchableOpacity style={styles.cashBtn} onPress={() => { setCashStr(''); setStage('cash'); }} disabled={saving}>
            <Text style={styles.cashBtnText}>💵 Pay with cash</Text>
          </TouchableOpacity>
        </>
      )}

      {stage === 'cash' && (() => {
        const tendered = Number(cashStr) || 0;
        const change = tendered - cashTotals.total;
        return (
          <View style={styles.cashPane}>
            <Text style={styles.section}>Cash received</Text>
            <View style={styles.cashInputRow}>
              <Text style={styles.cashDollar}>$</Text>
              <TextInput style={styles.cashInput} value={cashStr} onChangeText={setCashStr} keyboardType="decimal-pad" placeholder={cashTotals.total.toFixed(2)} placeholderTextColor={theme.placeholder} autoFocus />
            </View>
            <Text style={[styles.change, change < 0 && { color: theme.danger }]}>
              {change >= 0 ? `Change due: ${money(change)}` : `Need ${money(-change)} more`}
            </Text>
            <View style={styles.cashActions}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setStage('review')}><Text style={styles.backBtnText}>‹ Back</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, (saving || change < 0) && { opacity: 0.5 }]} disabled={saving || change < 0} onPress={() => finish('cash', { cashTendered: tendered })}>
                <Text style={styles.confirmBtnText}>{saving ? 'Saving…' : `Take ${money(cashTotals.total)}`}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })()}
    </ScrollView>
  );
}

function Row({ styles, label, value, big }) {
  return (
    <View style={styles.totRow}>
      <Text style={[styles.totLabel, big && styles.totLabelBig]}>{label}</Text>
      <Text style={[styles.totValue, big && styles.totValueBig]}>{value}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  wrap:     { flex: 1, backgroundColor: t.bg },
  content:  { padding: 22, paddingBottom: 48 },
  idle:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, padding: 40 },
  slideWrap:{ flex: 1, backgroundColor: '#000' },
  slideImg: { flex: 1, width: '100%' },
  slideCaption: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 22, paddingHorizontal: 24, backgroundColor: 'rgba(0,0,0,0.45)' },
  slideName:{ color: '#fff', fontSize: 24, fontWeight: '800' },
  slideHandle:{ color: 'rgba(255,255,255,0.85)', fontSize: 15, marginTop: 3 },
  idleMark: { fontSize: 54, color: t.green, marginBottom: 16 },
  doneMark: { fontSize: 60, color: t.success, marginBottom: 16, fontWeight: '800' },
  idleTitle:{ fontSize: 26, fontWeight: '800', color: t.text, textAlign: 'center' },
  idleSub:  { fontSize: 15, color: t.textMuted, marginTop: 10, textAlign: 'center', lineHeight: 21 },
  headerRow:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  hello:    { fontSize: 24, fontWeight: '800', color: t.text },
  cancelBtn:{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceMuted },
  cancelText:{ fontSize: 18, color: t.textMuted, fontWeight: '700' },
  section:  { fontSize: 13, fontWeight: '800', color: t.textMuted, marginTop: 22, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  lineRow:  { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 15, marginBottom: 9, borderWidth: 1, borderColor: t.border },
  lineName: { fontSize: 16, fontWeight: '700', color: t.text },
  lineTech: { fontSize: 13, color: t.textMuted, marginTop: 3 },
  linePrice:{ fontSize: 16, fontWeight: '800', color: t.text },
  tipRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 9, alignItems: 'center' },
  tipChip:  { paddingHorizontal: 20, paddingVertical: 14, borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  tipChipOn:{ backgroundColor: t.greenSoft, borderColor: t.green },
  tipChipText:{ fontSize: 16, fontWeight: '800', color: t.textMuted },
  tipChipTextOn:{ color: t.green },
  tipInput: { backgroundColor: t.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 17, color: t.text, borderWidth: 1, borderColor: t.border, minWidth: 90 },
  totals:   { backgroundColor: t.surface, borderRadius: 16, padding: 18, marginTop: 24, borderWidth: 1, borderColor: t.border },
  totRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  totLabel: { fontSize: 15, color: t.textMuted },
  totValue: { fontSize: 15, fontWeight: '700', color: t.text },
  totLabelBig:{ fontSize: 19, fontWeight: '800', color: t.text },
  totValueBig:{ fontSize: 24, fontWeight: '800', color: t.green },
  divider:  { height: 1, backgroundColor: t.border, marginVertical: 9 },
  cardDisabled:{ marginTop: 14, borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: t.border, backgroundColor: t.surfaceAlt },
  cardDisabledText:{ color: t.textFaint, fontWeight: '700', fontSize: 14 },
  cofBtn:   { marginTop: 14, backgroundColor: t.blueSoft, borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: t.blue },
  cofBtnText:{ color: t.blue, fontWeight: '800', fontSize: 15 },
  cashBtn:  { marginTop: 12, backgroundColor: t.surface, borderRadius: 14, paddingVertical: 17, alignItems: 'center', borderWidth: 1, borderColor: t.border },
  cashBtnText:{ color: t.text, fontWeight: '800', fontSize: 16 },
  cashPane: { marginTop: 18 },
  cashInputRow:{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: t.border },
  cashDollar:{ fontSize: 26, color: t.textMuted, fontWeight: '700' },
  cashInput:{ flex: 1, fontSize: 30, fontWeight: '800', color: t.text, paddingVertical: 14, marginLeft: 6 },
  change:   { fontSize: 20, fontWeight: '800', color: t.success, marginTop: 14, textAlign: 'center' },
  cashActions:{ flexDirection: 'row', gap: 12, marginTop: 20 },
  backBtn:  { paddingHorizontal: 20, paddingVertical: 16, borderRadius: 14, backgroundColor: t.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  backBtnText:{ color: t.textMuted, fontWeight: '800', fontSize: 15 },
  confirmBtn:{ flex: 1, backgroundColor: t.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  confirmBtnText:{ color: '#fff', fontWeight: '800', fontSize: 17 },
  doneBtn:  { marginTop: 26, backgroundColor: t.green, borderRadius: 24, paddingVertical: 13, paddingHorizontal: 44 },
  doneBtnText:{ color: '#fff', fontWeight: '800', fontSize: 16 },
});
