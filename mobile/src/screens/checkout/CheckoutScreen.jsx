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
import { completeSale } from '../../lib/completeSale';
import { isTerminalAvailable } from '../../lib/terminal';
import CardPayButton from './CardPayButton';
import useTenantAccess from '../../hooks/useTenantAccess';
import useResponsive from '../../hooks/useResponsive';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const TIP_PCTS = [15, 18, 20, 25];

// POS checkout (Slice 1 = cash). Card capture (Stripe Terminal / Tap to Pay)
// is Slice 2 — the Card button is present but disabled. Writes the same
// receipt shape (done appt + payment) the web does, so Reports/Earnings update.
export default function CheckoutScreen({ navigation }) {
  const { email } = useTenantAccess();
  const { isTablet } = useResponsive();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
  const [paid, setPaid]           = useState(null);   // {method,opts} once money is CAPTURED — blocks re-charge
  const [recordErr, setRecordErr] = useState('');
  const [saleId]                  = useState(() => genReceiptToken(24)); // idempotency key + receipt id

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
      { text: `Charge ${money(totals.total)}`, onPress: () => settle('cash') },
    ]);
  }

  // Record the sale. Separate from the CHARGE: by the time this runs the money
  // is captured, so a failure here only ever re-SAVES (idempotent via saleId),
  // never re-charges. `isRetry` skips the once-only side effects.
  async function doRecord({ method, stripePaymentIntentId = null }, isRetry = false) {
    setSaving(true); setRecordErr('');
    try {
      const card = method === 'card';
      const t = card ? cardTotals : totals;
      const { total, sideEffectErrors } = await completeSale({
        tab, lines, products, totals: t, settings, email,
        method, stripePaymentIntentId, discType, discVal, promo, giftCard,
        saleId, skipSideEffects: isRetry,
      });
      await clearTab();
      const extra = sideEffectErrors?.length ? `\n(${sideEffectErrors.join('; ')})` : '';
      Alert.alert('Paid', `${money(total)} collected (${card ? 'card' : 'cash'}).${extra}`, [{ text: 'Done', onPress: () => navigation.goBack() }]);
    } catch (e) {
      setRecordErr(e?.message || 'Could not save the receipt.');
      setSaving(false);
    }
  }

  // Latches `paid` the instant payment is captured so the charge buttons
  // disappear (no double-charge), then records the sale.
  function settle(method, opts = {}) {
    if (paid) return;
    if (lines.length === 0 && products.length === 0) { Alert.alert('Empty', 'Nothing to check out.'); return; }
    setPaid({ method, opts });
    doRecord({ method, ...opts }, false);
  }

  if (settings === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

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
          <TouchableOpacity onPress={() => removeProduct(it.product.id)} style={{ marginLeft: 10 }}><Text style={{ color: theme.danger, fontSize: 16, fontWeight: '700' }}>✕</Text></TouchableOpacity>
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
          <TextInput style={styles.smallInput} value={discVal} onChangeText={setDiscVal} keyboardType="decimal-pad" placeholder={discType === 'percent' ? '10' : '5'} placeholderTextColor={theme.placeholder} />
        )}
      </View>

      <Text style={styles.section}>Promo code</Text>
      <View style={styles.applyRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={promoCode} onChangeText={setPromoCode} autoCapitalize="characters" placeholder="PROMO" placeholderTextColor={theme.placeholder} editable={!promo} />
        {promo
          ? <TouchableOpacity onPress={() => { setPromo(null); setPromoCode(''); }} style={styles.clearBtn}><Text style={styles.clearText}>✕ {money(totals.promoAmount)}</Text></TouchableOpacity>
          : <TouchableOpacity onPress={applyPromo} style={styles.applyBtn}><Text style={styles.applyText}>Apply</Text></TouchableOpacity>}
      </View>

      <Text style={styles.section}>Gift card</Text>
      <View style={styles.applyRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={gcCode} onChangeText={setGcCode} autoCapitalize="characters" placeholder="GC-XXXX" placeholderTextColor={theme.placeholder} editable={!giftCard} />
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
        {tipMode === 'custom' && <TextInput style={styles.smallInput} value={tipAmtStr} onChangeText={setTipAmtStr} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={theme.placeholder} />}
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

      {paid ? (
        <View style={styles.settling}>
          {!recordErr ? (
            <Text style={styles.settlingText}>Payment received — saving…</Text>
          ) : (
            <>
              <Text style={styles.settlingErr}>Payment received, but saving the receipt failed:</Text>
              <Text style={styles.settlingSub}>{recordErr}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => doRecord({ method: paid.method, ...paid.opts }, true)} disabled={saving}>
                <Text style={styles.retryText}>{saving ? 'Saving…' : 'Retry saving receipt'}</Text>
              </TouchableOpacity>
              <Text style={styles.settlingNote}>The card was NOT charged again — this only re-saves the receipt.</Text>
            </>
          )}
        </View>
      ) : (
        <>
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
              idempotencyKey={saleId}
              disabled={saving || (lines.length === 0 && products.length === 0)}
              onPaid={(piId) => settle('card', { stripePaymentIntentId: piId })}
            />
          ) : (
            <View style={styles.cardBtn}><Text style={styles.cardText}>💳 Card — available after the Terminal rebuild</Text></View>
          )}
        </>
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
            <TouchableOpacity onPress={() => setShowPicker(false)} style={{ alignItems: 'center', paddingVertical: 12 }}><Text style={{ color: theme.textMuted, fontWeight: '600' }}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Row({ label, value, big }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.totRow}>
      <Text style={[styles.totLabel, big && styles.totLabelBig]}>{label}</Text>
      <Text style={[styles.totValue, big && styles.totValueBig]}>{value}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: t.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  twoCol:    { flexDirection: 'row', gap: 22, alignItems: 'flex-start' },
  colLeft:   { flex: 1.5 },
  colRight:  { flex: 1 },
  colFull:   { width: '100%' },
  section:   { fontSize: 13, fontWeight: '800', color: t.text, marginTop: 20, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  muted:     { color: t.textFaint, fontSize: 13 },
  lineRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: t.border },
  lineName:  { fontSize: 15, fontWeight: '700', color: t.text },
  lineTech:  { fontSize: 12, color: t.textMuted, marginTop: 2 },
  priceWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surfaceAlt, borderRadius: 8, paddingHorizontal: 8, borderWidth: 1, borderColor: t.border },
  dollar:    { fontSize: 15, color: t.textMuted },
  priceInput:{ width: 64, fontSize: 15, fontWeight: '700', color: t.text, paddingVertical: 8, textAlign: 'right' },
  chips:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip:      { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  chipOn:    { backgroundColor: t.greenSoft, borderColor: t.green },
  chipText:  { fontSize: 13, color: t.textMuted, fontWeight: '700' },
  chipTextOn:{ color: t.green },
  smallInput:{ backgroundColor: t.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, borderWidth: 1, borderColor: t.border, minWidth: 70 },
  applyRow:  { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input:     { backgroundColor: t.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  applyBtn:  { backgroundColor: t.blue, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  applyText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  clearBtn:  { backgroundColor: t.greenSoft, borderWidth: 1, borderColor: t.green, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  clearText: { color: t.green, fontWeight: '800', fontSize: 13 },
  totals:    { backgroundColor: t.surface, borderRadius: 14, padding: 16, marginTop: 22, borderWidth: 1, borderColor: t.border },
  totRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totLabel:  { fontSize: 14, color: t.textMuted },
  totValue:  { fontSize: 14, fontWeight: '700', color: t.text },
  totLabelBig:{ fontSize: 17, fontWeight: '800', color: t.text },
  totValueBig:{ fontSize: 20, fontWeight: '800', color: t.green },
  divider:   { height: 1, backgroundColor: t.border, marginVertical: 8 },
  splitBox:  { backgroundColor: t.surface, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: t.border },
  splitTitle:{ fontSize: 12, fontWeight: '800', color: t.textMuted, textTransform: 'uppercase', marginBottom: 6 },
  splitRow:  { fontSize: 13.5, color: t.text, marginTop: 3 },
  payBtn:    { marginTop: 22, backgroundColor: t.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  payText:   { color: '#fff', fontWeight: '800', fontSize: 16 },
  cardBtn:   { marginTop: 10, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: t.border, backgroundColor: t.surfaceAlt },
  cardText:  { color: t.textFaint, fontWeight: '700', fontSize: 13 },
  settling:  { marginTop: 22, backgroundColor: t.surface, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: t.border, alignItems: 'center', gap: 8 },
  settlingText:{ fontSize: 15, fontWeight: '700', color: t.text },
  settlingErr: { fontSize: 14, fontWeight: '800', color: t.danger, textAlign: 'center' },
  settlingSub: { fontSize: 12.5, color: t.textMuted, textAlign: 'center' },
  retryBtn:  { marginTop: 6, backgroundColor: t.green, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 26 },
  retryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  settlingNote:{ fontSize: 11, color: t.textFaint, textAlign: 'center' },
  addProdBtn:{ borderWidth: 1, borderColor: t.borderStrong, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  addProdText:{ color: t.textMuted, fontWeight: '700', fontSize: 14 },
  backdrop:  { flex: 1, backgroundColor: t.overlay, justifyContent: 'flex-end' },
  sheet:     { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 28 },
  sheetTitle:{ fontSize: 18, fontWeight: '800', color: t.text, marginBottom: 10 },
  pickRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: t.border },
  pickName:  { fontSize: 15, fontWeight: '600', color: t.text },
  pickPrice: { fontSize: 13, color: t.textMuted },
});
