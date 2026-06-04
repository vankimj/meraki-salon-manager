import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal, FlatList,
} from 'react-native';
import { getCurrentTab, clearTab } from '../../lib/currentTab';
import {
  fetchSettings, fetchPromoByCode, fetchGiftCardByCode, updateAppointment,
  updateGiftCard, savePromoCode, fetchProducts, saveProduct, createReceipt, fetchClient,
} from '../../lib/firestore';
import { computeTotals, buildTechSplit, normalizePromo, genReceiptToken } from '../../lib/checkout';
import { isTerminalAvailable } from '../../lib/terminal';
import CardPayButton from './CardPayButton';
import useTenantAccess from '../../hooks/useTenantAccess';
import useResponsive from '../../hooks/useResponsive';

const GREEN = '#2D7A5F', BLUE = '#3D95CE';
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const TIP_PCTS = [15, 18, 20, 25];

// POS checkout (Slice 1 = cash). Card capture (Stripe Terminal / Tap to Pay)
// is Slice 2 — the Card button is present but disabled. Writes the same
// receipt shape (done appt + payment) the web does, so Reports/Earnings update.
export default function CheckoutScreen({ navigation }) {
  const { email } = useTenantAccess();
  const { isTablet } = useResponsive();
  const pageMax = isTablet ? 920 : undefined;
  const [settings, setSettings] = useState(null);
  const [tab] = useState(() => getCurrentTab());

  // Flatten appt services into editable lines.
  const lines0 = useMemo(() => {
    const out = [];
    (tab.appts || []).forEach((a, apptIdx) => {
      (a.services || []).forEach((s, svcIdx) => {
        out.push({ apptIdx, svcIdx, name: s.name || '—', price: Number(s.price) || 0, techName: s.techName || a.techName || '', taxable: s.taxable !== false });
      });
    });
    return out;
  }, [tab]);

  const [prices, setPrices] = useState(() => lines0.map(l => String(l.price)));
  const [discType, setDiscType]   = useState('none');   // none | percent | amount
  const [discVal, setDiscVal]     = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promo, setPromo]         = useState(null);
  const [gcCode, setGcCode]       = useState('');
  const [giftCard, setGiftCard]   = useState(null);
  const [tipMode, setTipMode]     = useState('none');   // none | pct | custom
  const [tipPct, setTipPct]       = useState(null);
  const [tipAmtStr, setTipAmtStr] = useState('');
  const [products, setProducts]   = useState([]);    // [{ product, qty }]
  const [allProducts, setAllProducts] = useState(null);
  const [showPicker, setShowPicker]   = useState(false);
  const [saving, setSaving]       = useState(false);

  useEffect(() => { fetchSettings().then(setSettings).catch(() => setSettings({})); }, []);

  const lines = lines0.map((l, i) => ({ ...l, price: Number(prices[i]) || 0 }));
  const productsTotal = products.reduce((s, it) => s + (Number(it.product.price) || 0) * it.qty, 0);

  async function openPicker() {
    if (!allProducts) {
      const p = await fetchProducts().catch(() => []);
      setAllProducts(p.filter(x => x.active !== false && (x.stock || 0) > 0));
    }
    setShowPicker(true);
  }
  function addProduct(p) {
    setProducts(prev => {
      const ex = prev.find(it => it.product.id === p.id);
      if (ex) return prev.map(it => it.product.id === p.id ? { ...it, qty: it.qty + 1 } : it);
      return [...prev, { product: p, qty: 1 }];
    });
    setShowPicker(false);
  }
  function removeProduct(id) { setProducts(prev => prev.filter(it => it.product.id !== id)); }

  const totals = useMemo(() => computeTotals({
    lines, productsTotal,
    discount: discType === 'none' ? null : { isPercent: discType === 'percent', value: Number(discVal) || 0 },
    promo: normalizePromo(promo),
    taxRate: Number(settings?.taxRate) || 0,
    ccFeePct: Number(settings?.ccFeePct) || 0,
    ccFeeFlat: Number(settings?.ccFeeFlat) || 0,
    method: 'cash',
    noCardTips: !!settings?.noCardTips,
    tip: { custom: tipMode === 'custom', amount: Number(tipAmtStr) || 0, pct: tipMode === 'pct' ? tipPct : null },
    giftCardBalance: giftCard?.balance || 0, applyGC: !!giftCard,
  }), [JSON.stringify(prices), productsTotal, discType, discVal, promo, giftCard, tipMode, tipPct, tipAmtStr, settings]);

  // Card total can differ from cash when the salon passes the card fee to the
  // client (ccFeePct/Flat) or suppresses tips on card (noCardTips). The card
  // button must charge this amount, not the cash total.
  const cardTotals = useMemo(() => computeTotals({
    lines, productsTotal,
    discount: discType === 'none' ? null : { isPercent: discType === 'percent', value: Number(discVal) || 0 },
    promo: normalizePromo(promo),
    taxRate: Number(settings?.taxRate) || 0,
    ccFeePct: Number(settings?.ccFeePct) || 0,
    ccFeeFlat: Number(settings?.ccFeeFlat) || 0,
    method: 'card',
    noCardTips: !!settings?.noCardTips,
    tip: { custom: tipMode === 'custom', amount: Number(tipAmtStr) || 0, pct: tipMode === 'pct' ? tipPct : null },
    giftCardBalance: giftCard?.balance || 0, applyGC: !!giftCard,
  }), [JSON.stringify(prices), productsTotal, discType, discVal, promo, giftCard, tipMode, tipPct, tipAmtStr, settings]);

  const split = buildTechSplit(lines, totals.tipAmt);

  async function applyPromo() {
    const p = await fetchPromoByCode(promoCode).catch(() => null);
    if (!p) { Alert.alert('Promo not found'); return; }
    if (p.active === false) { Alert.alert('Promo inactive'); return; }
    setPromo(p);
  }
  async function applyGiftCard() {
    const g = await fetchGiftCardByCode(gcCode).catch(() => null);
    if (!g) { Alert.alert('Gift card not found'); return; }
    if ((g.balance || 0) <= 0) { Alert.alert('Gift card has no balance'); return; }
    setGiftCard(g);
  }

  function confirmCash() {
    if (lines.length === 0 && products.length === 0) { Alert.alert('Empty', 'Nothing to check out.'); return; }
    Alert.alert('Take cash payment?', `Total ${money(totals.total)} in cash.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: `Charge ${money(totals.total)}`, onPress: () => complete({ method: 'cash' }) },
    ]);
  }

  async function complete({ method = 'cash', stripePaymentIntentId = null } = {}) {
    setSaving(true);
    try {
      const card = method === 'card';
      const t = card ? cardTotals : totals;
      const sp = buildTechSplit(lines, t.tipAmt);
      const retailProducts = products.length > 0
        ? products.map(it => ({ id: it.product.id, name: it.product.name, price: it.product.price, qty: it.qty }))
        : null;
      const payment = {
        retailProducts,
        subtotal: t.subtotal,
        discountType: discType === 'none' ? null : discType,
        discountValue: Number(discVal) || 0,
        discountAmount: t.discountAmount,
        promoCode: promo ? promo.code : null,
        promoAmount: t.promoAmount,
        tax: t.taxAmt, taxRate: Number(settings?.taxRate) || 0,
        giftCard: giftCard && t.gcApply > 0 ? { code: giftCard.code, id: giftCard.id, applied: t.gcApply } : null,
        creditApplied: t.creditApply,
        charged: t.charged, tip: t.tipAmt, total: t.total,
        method, ccFee: t.ccFee,
        ccFeePct: Number(settings?.ccFeePct) || 0, ccFeeFlat: Number(settings?.ccFeeFlat) || 0,
        stripePaymentIntentId: stripePaymentIntentId || null,
        techSplit: sp,
        apptIds: (tab.appts || []).map(a => a.id),
        paidAt: new Date().toISOString(), paidBy: email || null,
      };

      // Reconstruct each appt's services with edited prices; mark done + attach payment.
      for (let apptIdx = 0; apptIdx < (tab.appts || []).length; apptIdx++) {
        const a = tab.appts[apptIdx];
        const svc = (a.services || []).map((s, svcIdx) => {
          const li = lines.findIndex(l => l.apptIdx === apptIdx && l.svcIdx === svcIdx);
          return { ...s, price: li >= 0 ? lines[li].price : (Number(s.price) || 0), techName: li >= 0 ? lines[li].techName : s.techName };
        });
        const apptSubtotal = svc.reduce((s, x) => s + (Number(x.price) || 0), 0);
        await updateAppointment(a.id, { services: svc, status: 'done', payment: { ...payment, amountForThisAppt: apptSubtotal } });
      }

      // Side effects: gift-card balance, promo usage.
      if (giftCard && t.gcApply > 0) {
        await updateGiftCard(giftCard.id, { balance: Math.max((giftCard.balance || 0) - t.gcApply, 0) });
      }
      if (promo) {
        const newCount = (promo.usedCount || 0) + 1;
        const maxHit = promo.maxUses && newCount >= promo.maxUses;
        await savePromoCode(promo.id, { usedCount: newCount, ...((promo.singleUse || maxHit) ? { active: false } : {}) });
      }
      // Retail stock decrement.
      for (const it of products) {
        await saveProduct(it.product.id, { stock: Math.max(0, (Number(it.product.stock) || 0) - it.qty) }).catch(() => {});
      }

      // Canonical receipt — it carries apptIds (so Reports counts it once, not
      // double with the done appts) AND its clientPhone fires sendReceiptSms.
      const primaryAppt = (tab.appts || [])[0] || null;
      const clientNames = Array.from(new Set((tab.appts || []).map(a => a.clientName || 'Walk-in').filter(Boolean)));
      const allServices = lines.map(l => ({ name: l.name, price: l.price, techName: l.techName }));
      let clientEmail = null;
      try { if (primaryAppt?.clientId) clientEmail = (await fetchClient(primaryAppt.clientId))?.email || null; } catch {}
      await createReceipt({
        clientId:    primaryAppt?.clientId || null,
        clientName:  clientNames.join(' + ') || 'Walk-in',
        clientPhone: primaryAppt?.clientPhone || null,
        clientEmail,
        viewToken:   genReceiptToken(22),
        techName:    sp ? sp.map(s => s.techName).join(', ') : (allServices[0]?.techName || ''),
        date:        primaryAppt?.date || new Date().toISOString().slice(0, 10),
        startTime:   primaryAppt?.startTime || '',
        services:    allServices,
        retailProducts,
        payment,
        apptIds:     (tab.appts || []).map(a => a.id),
      });

      await clearTab();
      Alert.alert('Paid', `${money(t.total)} collected (${card ? 'card' : 'cash'}).`, [{ text: 'Done', onPress: () => navigation.goBack() }]);
    } catch (e) {
      Alert.alert('Checkout failed', e?.message || 'Please try again.');
    } finally { setSaving(false); }
  }

  if (settings === null) return <View style={styles.center}><ActivityIndicator color={GREEN} /></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: pageMax, width: '100%', alignSelf: 'center' }}>
      <View style={isTablet ? styles.twoCol : null}>
      <View style={isTablet ? styles.colLeft : styles.colFull}>
      <Text style={styles.section}>Items</Text>
      {lines0.length === 0 && <Text style={styles.muted}>Tab is empty.</Text>}
      {lines0.map((l, i) => (
        <View key={`${l.apptIdx}-${l.svcIdx}`} style={styles.lineRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{l.name}</Text>
            <Text style={styles.lineTech}>{l.techName || '—'}</Text>
          </View>
          <View style={styles.priceWrap}>
            <Text style={styles.dollar}>$</Text>
            <TextInput style={styles.priceInput} value={prices[i]} onChangeText={v => setPrices(p => p.map((x, j) => j === i ? v : x))} keyboardType="decimal-pad" />
          </View>
        </View>
      ))}

      <Text style={styles.section}>Products</Text>
      {products.map(it => (
        <View key={it.product.id} style={styles.lineRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{it.product.name} × {it.qty}</Text>
            <Text style={styles.lineTech}>{money(it.product.price)} ea</Text>
          </View>
          <Text style={styles.lineName}>{money(it.product.price * it.qty)}</Text>
          <TouchableOpacity onPress={() => removeProduct(it.product.id)} style={{ marginLeft: 10 }}><Text style={{ color: '#c0392b', fontSize: 16, fontWeight: '700' }}>✕</Text></TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={styles.addProdBtn} onPress={openPicker}><Text style={styles.addProdText}>＋ Add product</Text></TouchableOpacity>

      <Text style={styles.section}>Discount</Text>
      <View style={styles.chips}>
        {[['none', 'None'], ['percent', '% off'], ['amount', '$ off']].map(([id, lbl]) => (
          <TouchableOpacity key={id} onPress={() => setDiscType(id)} style={[styles.chip, discType === id && styles.chipOn]}>
            <Text style={[styles.chipText, discType === id && styles.chipTextOn]}>{lbl}</Text>
          </TouchableOpacity>
        ))}
        {discType !== 'none' && (
          <TextInput style={styles.smallInput} value={discVal} onChangeText={setDiscVal} keyboardType="decimal-pad" placeholder={discType === 'percent' ? '10' : '5'} placeholderTextColor="#bbb" />
        )}
      </View>

      <Text style={styles.section}>Promo code</Text>
      <View style={styles.applyRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={promoCode} onChangeText={setPromoCode} autoCapitalize="characters" placeholder="PROMO" placeholderTextColor="#bbb" editable={!promo} />
        {promo
          ? <TouchableOpacity onPress={() => { setPromo(null); setPromoCode(''); }} style={styles.clearBtn}><Text style={styles.clearText}>✕ {money(totals.promoAmount)}</Text></TouchableOpacity>
          : <TouchableOpacity onPress={applyPromo} style={styles.applyBtn}><Text style={styles.applyText}>Apply</Text></TouchableOpacity>}
      </View>

      <Text style={styles.section}>Gift card</Text>
      <View style={styles.applyRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={gcCode} onChangeText={setGcCode} autoCapitalize="characters" placeholder="GC-XXXX" placeholderTextColor="#bbb" editable={!giftCard} />
        {giftCard
          ? <TouchableOpacity onPress={() => { setGiftCard(null); setGcCode(''); }} style={styles.clearBtn}><Text style={styles.clearText}>✕ -{money(totals.gcApply)}</Text></TouchableOpacity>
          : <TouchableOpacity onPress={applyGiftCard} style={styles.applyBtn}><Text style={styles.applyText}>Apply</Text></TouchableOpacity>}
      </View>

      <Text style={styles.section}>Tip</Text>
      <View style={styles.chips}>
        <TouchableOpacity onPress={() => { setTipMode('none'); setTipPct(null); }} style={[styles.chip, tipMode === 'none' && styles.chipOn]}><Text style={[styles.chipText, tipMode === 'none' && styles.chipTextOn]}>None</Text></TouchableOpacity>
        {TIP_PCTS.map(p => (
          <TouchableOpacity key={p} onPress={() => { setTipMode('pct'); setTipPct(p); }} style={[styles.chip, tipMode === 'pct' && tipPct === p && styles.chipOn]}>
            <Text style={[styles.chipText, tipMode === 'pct' && tipPct === p && styles.chipTextOn]}>{p}%</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={() => setTipMode('custom')} style={[styles.chip, tipMode === 'custom' && styles.chipOn]}><Text style={[styles.chipText, tipMode === 'custom' && styles.chipTextOn]}>$</Text></TouchableOpacity>
        {tipMode === 'custom' && <TextInput style={styles.smallInput} value={tipAmtStr} onChangeText={setTipAmtStr} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#bbb" />}
      </View>

      </View>
      <View style={isTablet ? styles.colRight : styles.colFull}>
      {/* Totals */}
      <View style={[styles.totals, isTablet && { marginTop: 0 }]}>
        <Row label="Subtotal" value={money(totals.subtotal)} />
        {totals.discountAmount > 0 && <Row label="Discount" value={`-${money(totals.discountAmount)}`} />}
        {totals.promoAmount > 0 && <Row label={`Promo ${promo?.code || ''}`} value={`-${money(totals.promoAmount)}`} />}
        {totals.taxAmt > 0 && <Row label="Tax" value={money(totals.taxAmt)} />}
        {totals.tipAmt > 0 && <Row label="Tip" value={money(totals.tipAmt)} />}
        {totals.gcApply > 0 && <Row label="Gift card" value={`-${money(totals.gcApply)}`} />}
        <View style={styles.divider} />
        <Row label="Total" value={money(totals.total)} big />
      </View>

      {split && (
        <View style={styles.splitBox}>
          <Text style={styles.splitTitle}>Split</Text>
          {split.map(s => <Text key={s.techName} style={styles.splitRow}>{s.techName || '—'}: {money(s.revenue)}{s.tipShare ? ` + ${money(s.tipShare)} tip` : ''}</Text>)}
        </View>
      )}

      <TouchableOpacity style={[styles.payBtn, saving && { opacity: 0.6 }]} onPress={confirmCash} disabled={saving}>
        <Text style={styles.payText}>{saving ? 'Processing…' : `Take cash · ${money(totals.total)}`}</Text>
      </TouchableOpacity>
      {isTerminalAvailable() ? (
        <CardPayButton
          amountCents={Math.round((cardTotals.total || 0) * 100)}
          description={(tab.appts?.[0]?.clientName) || 'Walk-in'}
          locationId={settings?.terminalLocationId || null}
          onBehalfOf={settings?.connectAccountId || settings?.stripeAccountId || undefined}
          merchantName={settings?.salonName || settings?.name || 'Salon'}
          preferReader={isTablet}
          disabled={saving || (lines.length === 0 && products.length === 0)}
          onPaid={(piId) => complete({ method: 'card', stripePaymentIntentId: piId })}
        />
      ) : (
        <View style={styles.cardBtn}><Text style={styles.cardText}>💳 Card — available after the Terminal rebuild</Text></View>
      )}
      </View>
      </View>

      <Modal visible={showPicker} animationType="slide" transparent onRequestClose={() => setShowPicker(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add product</Text>
            <FlatList
              data={allProducts || []}
              keyExtractor={(p) => p.id}
              style={{ maxHeight: 380 }}
              ListEmptyComponent={<Text style={styles.muted}>No products in stock.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pickRow} onPress={() => addProduct(item)}>
                  <Text style={styles.pickName}>{item.name}</Text>
                  <Text style={styles.pickPrice}>{money(item.price)} · {item.stock} left</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity onPress={() => setShowPicker(false)} style={{ alignItems: 'center', paddingVertical: 12 }}><Text style={{ color: '#888', fontWeight: '600' }}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Row({ label, value, big }) {
  return (
    <View style={styles.totRow}>
      <Text style={[styles.totLabel, big && styles.totLabelBig]}>{label}</Text>
      <Text style={[styles.totValue, big && styles.totValueBig]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: '#f5f7fa' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  twoCol:    { flexDirection: 'row', gap: 22, alignItems: 'flex-start' },
  colLeft:   { flex: 1.5 },
  colRight:  { flex: 1 },
  colFull:   { width: '100%' },
  section:   { fontSize: 13, fontWeight: '800', color: '#1a1a1a', marginTop: 20, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  muted:     { color: '#999', fontSize: 13 },
  lineRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#ececec' },
  lineName:  { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  lineTech:  { fontSize: 12, color: '#8a8a8a', marginTop: 2 },
  priceWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f6f7f9', borderRadius: 8, paddingHorizontal: 8, borderWidth: 1, borderColor: '#ececec' },
  dollar:    { fontSize: 15, color: '#888' },
  priceInput:{ width: 64, fontSize: 15, fontWeight: '700', color: '#1a1a1a', paddingVertical: 8, textAlign: 'right' },
  chips:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip:      { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e6e8' },
  chipOn:    { backgroundColor: '#eef5f2', borderColor: GREEN },
  chipText:  { fontSize: 13, color: '#666', fontWeight: '700' },
  chipTextOn:{ color: GREEN },
  smallInput:{ backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, borderWidth: 1, borderColor: '#ececec', minWidth: 70 },
  applyRow:  { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input:     { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: '#1a1a1a', borderWidth: 1, borderColor: '#ececec' },
  applyBtn:  { backgroundColor: BLUE, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  applyText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  clearBtn:  { backgroundColor: '#eef5f2', borderWidth: 1, borderColor: GREEN, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  clearText: { color: GREEN, fontWeight: '800', fontSize: 13 },
  totals:    { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginTop: 22, borderWidth: 1, borderColor: '#ececec' },
  totRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totLabel:  { fontSize: 14, color: '#666' },
  totValue:  { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  totLabelBig:{ fontSize: 17, fontWeight: '800', color: '#1a1a1a' },
  totValueBig:{ fontSize: 20, fontWeight: '800', color: GREEN },
  divider:   { height: 1, backgroundColor: '#eee', marginVertical: 8 },
  splitBox:  { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#ececec' },
  splitTitle:{ fontSize: 12, fontWeight: '800', color: '#888', textTransform: 'uppercase', marginBottom: 6 },
  splitRow:  { fontSize: 13.5, color: '#1a1a1a', marginTop: 3 },
  payBtn:    { marginTop: 22, backgroundColor: GREEN, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  payText:   { color: '#fff', fontWeight: '800', fontSize: 16 },
  cardBtn:   { marginTop: 10, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e3e6e8', backgroundColor: '#fafafa' },
  cardText:  { color: '#aaa', fontWeight: '700', fontSize: 13 },
  addProdBtn:{ borderWidth: 1, borderColor: '#d8d8d8', borderStyle: 'dashed', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  addProdText:{ color: '#666', fontWeight: '700', fontSize: 14 },
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:     { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 28 },
  sheetTitle:{ fontSize: 18, fontWeight: '800', color: '#1a1a1a', marginBottom: 10 },
  pickRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  pickName:  { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  pickPrice: { fontSize: 13, color: '#888' },
});
