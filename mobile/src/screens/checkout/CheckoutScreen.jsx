import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal, FlatList,
} from 'react-native';
import { getCurrentTab, clearTab } from '../../lib/currentTab';
import {
  fetchSettings, fetchPromoByCode, fetchGiftCardByCode, fetchGiftCardsByContact, updateAppointment,
  updateGiftCard, savePromoCode, fetchProducts, saveProduct, createReceipt, fetchClient, fetchClientMembership,
  setCheckoutSession, subscribeCheckoutSession, fetchAttendance, fetchEmployees, fetchServices,
} from '../../lib/firestore';
import KioskCheckout from '../kiosk/KioskCheckout';
import { isSalonOpenNow, offClockTechNames, attendanceKey } from '../../lib/shiftGate';
import { computeTotals, buildTechSplit, normalizePromo, genReceiptToken, parseReceiptContact } from '../../lib/checkout';
import { resolveLoyaltyConfig } from '../../lib/loyalty';
import { completeSale } from '../../lib/completeSale';
import { defaultWalkIn } from '../../lib/metrics';
import { recordSale, syncOfflineSales } from '../../lib/resilientSale';
import { isTerminalAvailable } from '../../lib/terminal';
import CardPayButton from './CardPayButton';
import ResendReceiptRow from '../../components/ResendReceiptRow';
import TechTipInputs from '../../components/TechTipInputs';
import QRCode from '../../components/QRCode';
import TechAvatar from '../../components/TechAvatar';
import useTenantAccess from '../../hooks/useTenantAccess';
import useResponsive from '../../hooks/useResponsive';
import useOnline from '../../hooks/useOnline';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const TIP_PCTS = [15, 18, 20, 25];

// POS checkout (Slice 1 = cash). Card capture (Stripe Terminal / Tap to Pay)
// is Slice 2 — the Card button is present but disabled. Writes the same
// receipt shape (done appt + payment) the web does, so Reports/Earnings update.
export default function CheckoutScreen({ navigation }) {
  const { email, isAdmin } = useTenantAccess();
  const { isTablet } = useResponsive();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const pageMax = isTablet ? 920 : undefined;
  const [settings, setSettings] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [svcPriceById, setSvcPriceById] = useState(null); // catalog id → basePrice fallback
  const [tab] = useState(() => getCurrentTab());

  // Catalog price fallback: appointments created before the basePrice fix stored
  // service price=0, so default any 0-priced line to the catalog's basePrice
  // (staff can still edit). Keyed by service id.
  useEffect(() => {
    fetchServices()
      .then(list => { const m = {}; (list || []).forEach(s => { if (s.id) m[s.id] = Number(s.basePrice ?? s.price ?? 0) || 0; }); setSvcPriceById(m); })
      .catch(() => setSvcPriceById({}));
  }, []);

  // Flatten appt services into editable lines.
  const lines0 = useMemo(() => {
    const out = [];
    const cat = svcPriceById || {};
    (tab.appts || []).forEach((a, apptIdx) => {
      (a.services || []).forEach((s, svcIdx) => {
        const price = (Number(s.price) || 0) || (s.id ? (cat[s.id] || 0) : 0);
        out.push({ apptIdx, svcIdx, name: s.name || '—', price, techName: s.techName || a.techName || '', taxable: s.taxable !== false });
      });
    });
    return out;
  }, [tab, svcPriceById]);

  const [prices, setPrices] = useState(() => lines0.map(l => String(l.price)));
  // The price inputs are seeded from lines0 at mount (before the catalog loads),
  // so re-seed them once the basePrice fallback resolves — otherwise 0-priced
  // appts would still show $0 in the editable fields. Runs once on catalog load.
  useEffect(() => { if (svcPriceById) setPrices(lines0.map(l => String(l.price))); }, [svcPriceById]); // eslint-disable-line react-hooks/exhaustive-deps
  const [discType, setDiscType]   = useState('none');   // none | percent | amount | member
  const [discVal, setDiscVal]     = useState('');
  const [membership, setMembership] = useState(null);   // primary client's active membership
  const [clientCredit, setClientCredit] = useState(0);  // primary client's store-credit balance
  const [clientEmailOnFile, setClientEmailOnFile] = useState(''); // for the receipt email field
  const [applyCredit, setApplyCredit] = useState(false);
  const [clientPoints, setClientPoints] = useState(0); // primary client's loyalty balance
  const [applyLoyalty, setApplyLoyalty] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promo, setPromo]         = useState(null);
  const [gcCode, setGcCode]       = useState('');
  const [gcSearchOpen, setGcSearchOpen] = useState(false);
  const [gcQ, setGcQ]             = useState('');
  const [gcResults, setGcResults] = useState(null);
  const [gcSearching, setGcSearching] = useState(false);
  const [giftCard, setGiftCard]   = useState(null);
  const [tipMode, setTipMode]     = useState('none');   // none | pct | custom | perTech
  const [tipPct, setTipPct]       = useState(null);
  const [tipAmtStr, setTipAmtStr] = useState('');
  const [perTechTips, setPerTechTips] = useState({});   // { techName: '12.00' }
  const [tipMethod, setTipMethod] = useState('card');   // card | venmo | cash
  const [venmoByTech, setVenmoByTech] = useState({});   // { techName: '@handle' }
  const [photoByTech, setPhotoByTech] = useState({});   // { techName: base64/url }
  const [products, setProducts]   = useState([]);    // [{ product, qty }]
  const [allProducts, setAllProducts] = useState(null);
  const [showPicker, setShowPicker]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [localSession, setLocalSession] = useState(null); // non-null → run the customer-facing checkout on THIS device
  const [sent, setSent]           = useState(null);   // {summary, sessionId} → "sent to front desk" live-status screen
  const [paid, setPaid]           = useState(null);   // {method,opts} once money is CAPTURED — blocks re-charge
  const [done, setDone]           = useState(null);   // {total,method,queued,note} once the receipt is written
  const [recordErr, setRecordErr] = useState('');
  const [saleId]                  = useState(() => genReceiptToken(24)); // idempotency key + receipt id
  const [receiptPhone, setReceiptPhone] = useState(''); // walk-ins: capture a number for the texted receipt
  const hasPhoneOnFile = (tab.appts || []).some(a => a.clientPhone);
  // Walk-in vs scheduled — same-day-booked defaults to walk-in; staff can flip.
  const hasServiceVisit = (tab.appts || []).length > 0;
  const [isWalkIn, setIsWalkIn] = useState(() => {
    const a = (tab.appts || [])[0];
    return hasServiceVisit && defaultWalkIn(a?.createdAt, a?.date);
  });

  const online = useOnline();

  useEffect(() => { fetchSettings().then(setSettings).catch(() => setSettings({})); }, []);
  // Clock-in gate: load today's attendance so we can block checkout while the
  // salon is open if any credited tech isn't clocked in (admins exempt).
  useEffect(() => { fetchAttendance(attendanceKey()).then(setAttendance).catch(() => setAttendance({ entries: [] })); }, []);
  // Venmo handles + photos per tech — drives the Venmo tip QR (off-bill tips).
  useEffect(() => {
    fetchEmployees().then(emps => {
      const v = {}, p = {};
      (emps || []).forEach(e => { if (e.name) { if (e.venmo) v[e.name] = e.venmo; if (e.photo) p[e.name] = e.photo; } });
      setVenmoByTech(v); setPhotoByTech(p);
    }).catch(() => {});
  }, []);
  // Sync anything stranded offline whenever checkout opens online.
  useEffect(() => { syncOfflineSales().catch(() => {}); }, []);

  // Auto-apply the primary client's active membership discount once, the same
  // way the web checkout does — members shouldn't have to be discounted by
  // hand. Only takes over when no discount is set yet (never clobbers a manual
  // one); staff can still switch it off via the discount chips.
  const primaryClientId = (tab.appts || []).map(a => a.clientId).find(Boolean) || null;
  useEffect(() => {
    if (!primaryClientId) return;
    let alive = true;
    fetchClientMembership(primaryClientId).then(m => {
      if (!alive || !m || m.status !== 'active' || !(Number(m.discountPct) > 0)) return;
      setMembership(m);
      setDiscType(prev => (prev === 'none' ? 'member' : prev));
      setDiscVal(prev => (prev === '' ? String(m.discountPct) : prev));
    }).catch(() => {});
    fetchClient(primaryClientId).then(c => { if (alive) { setClientCredit(Number(c?.credit) || 0); setClientPoints(Number(c?.loyaltyPoints) || 0); setClientEmailOnFile(c?.email || ''); } }).catch(() => {});
    return () => { alive = false; };
  }, [primaryClientId]);

  const lines = useMemo(() => lines0.map((l, i) => ({ ...l, price: Number(prices[i]) || 0 })), [lines0, prices]);
  const productsTotal = products.reduce((s, it) => s + (Number(it.product.price) || 0) * it.qty, 0);

  // Clock-in gate: while the salon is open, every tech credited on this sale
  // must be clocked in. Admins exempt; off-shift (closed) no gate. We only block
  // once attendance + settings have loaded so we never block during the fetch.
  const offClock = (!isAdmin && settings && attendance && isSalonOpenNow(settings))
    ? offClockTechNames(lines.map(l => l.techName), attendance)
    : [];
  const gateBlocked = offClock.length > 0;

  // Service revenue per tech → the optional per-tech tip fields (2+ techs only).
  const techRevenue = useMemo(() => {
    const m = {};
    lines.forEach(l => { const t = l.techName || ''; m[t] = (m[t] || 0) + (Number(l.price) || 0); });
    return m;
  }, [lines]);
  const multiTech = Object.keys(techRevenue).length >= 2;
  const tipByTech = (tipMode === 'perTech')
    ? Object.keys(techRevenue).map(t => ({ techName: t, amount: Number(perTechTips[t]) || 0 }))
    : null;
  const tipObj = (tipMode === 'perTech')
    ? { custom: true, amount: (tipByTech || []).reduce((s, t) => s + t.amount, 0), pct: null }
    : { custom: tipMode === 'custom', amount: Number(tipAmtStr) || 0, pct: tipMode === 'pct' ? tipPct : null };
  // The tip is added to the charge ONLY when paid by card. Venmo / cash tips go
  // straight to the tech (QR / cash in hand), so they're never part of the bill
  // or the recorded commission split.
  const tipForCharge   = tipMethod === 'card' ? tipObj : { custom: true, amount: 0, pct: null };
  const chargedTipByTech = tipMethod === 'card' ? tipByTech : null;

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

  const loyaltyCfg = resolveLoyaltyConfig(settings);
  const loyaltyOn  = loyaltyCfg.enabled;
  const totals = useMemo(() => computeTotals({
    lines, productsTotal,
    discount: discType === 'none' ? null : { isPercent: discType !== 'amount', value: Number(discVal) || 0 },
    promo: normalizePromo(promo),
    taxRate: Number(settings?.taxRate) || 0,
    ccFeePct: Number(settings?.ccFeePct) || 0,
    ccFeeFlat: Number(settings?.ccFeeFlat) || 0,
    method: 'cash',
    noCardTips: !!settings?.noCardTips,
    tip: tipForCharge,
    giftCardBalance: giftCard?.balance || 0, applyGC: !!giftCard,
    clientCredit, applyCredit: applyCredit && clientCredit > 0,
    clientPoints, applyLoyalty: applyLoyalty && loyaltyOn, loyaltyConfig: loyaltyCfg,
  }), [lines, productsTotal, discType, discVal, promo, giftCard, tipMode, tipPct, tipAmtStr, perTechTips, tipMethod, settings, clientCredit, applyCredit, clientPoints, applyLoyalty, loyaltyOn]);

  // Card total can differ from cash when the salon passes the card fee to the
  // client (ccFeePct/Flat) or suppresses tips on card (noCardTips). The card
  // button must charge this amount, not the cash total.
  const cardTotals = useMemo(() => computeTotals({
    lines, productsTotal,
    discount: discType === 'none' ? null : { isPercent: discType !== 'amount', value: Number(discVal) || 0 },
    promo: normalizePromo(promo),
    taxRate: Number(settings?.taxRate) || 0,
    ccFeePct: Number(settings?.ccFeePct) || 0,
    ccFeeFlat: Number(settings?.ccFeeFlat) || 0,
    method: 'card',
    noCardTips: !!settings?.noCardTips,
    tip: tipForCharge,
    giftCardBalance: giftCard?.balance || 0, applyGC: !!giftCard,
    clientCredit, applyCredit: applyCredit && clientCredit > 0,
    clientPoints, applyLoyalty: applyLoyalty && loyaltyOn, loyaltyConfig: loyaltyCfg,
  }), [lines, productsTotal, discType, discVal, promo, giftCard, tipMode, tipPct, tipAmtStr, perTechTips, tipMethod, settings, clientCredit, applyCredit, clientPoints, applyLoyalty, loyaltyOn]);

  const split = buildTechSplit(lines, totals.tipAmt, chargedTipByTech);

  // The tip the customer selected (drives the Venmo QR), regardless of whether
  // it's charged — so the QR shows the right amount even when the tip is off-bill.
  const selectedTipAmt = useMemo(() => computeTotals({
    lines, productsTotal,
    discount: discType === 'none' ? null : { isPercent: discType !== 'amount', value: Number(discVal) || 0 },
    promo: normalizePromo(promo), taxRate: Number(settings?.taxRate) || 0,
    ccFeePct: 0, ccFeeFlat: 0, method: 'cash', noCardTips: false, tip: tipObj,
    giftCardBalance: 0, applyGC: false, clientCredit: 0, applyCredit: false,
  }).tipAmt || 0, [lines, productsTotal, discType, discVal, promo, tipMode, tipPct, tipAmtStr, perTechTips, settings]);

  // Venmo tips: client tips a tech directly (QR to their Venmo), split per tech by
  // service revenue (or the per-tech amounts when "Per tech"). Off the bill.
  const venmoTechs = Object.keys(techRevenue).filter(t => t && venmoByTech[t]);
  const totalRev   = Object.values(techRevenue).reduce((s, v) => s + v, 0);
  function venmoTipFor(t) {
    if (tipMode === 'perTech') return Number(perTechTips[t]) || 0;
    const tipAmt = selectedTipAmt || 0;
    if (!tipAmt || !totalRev) return 0;
    return Math.round(tipAmt * ((techRevenue[t] || 0) / totalRev) * 100) / 100;
  }

  async function applyPromo() {
    const p = await fetchPromoByCode(promoCode).catch(() => null);
    if (!p) { Alert.alert('Promo not found'); return; }
    if (p.active === false) { Alert.alert('Promo inactive'); return; }
    setPromo(p);
  }
  function applyFoundGiftCard(g) {
    if (!g) { Alert.alert('Gift card not found'); return; }
    if ((g.balance || 0) <= 0) { Alert.alert('Gift card has no balance'); return; }
    setGiftCard(g); setGcCode(g.code || '');
    setGcSearchOpen(false); setGcQ(''); setGcResults(null);
  }
  async function applyGiftCard() {
    applyFoundGiftCard(await fetchGiftCardByCode(gcCode).catch(() => null));
  }
  async function searchGiftCards() {
    const q = gcQ.trim();
    if (q.length < 2) return;
    setGcSearching(true);
    try { setGcResults(await fetchGiftCardsByContact(q)); }
    catch { setGcResults([]); }
    finally { setGcSearching(false); }
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
  async function doRecord({ method, stripePaymentIntentId = null, cardBrand = null, cardLast4 = null }, isRetry = false) {
    setSaving(true); setRecordErr('');
    try {
      const card = method === 'card';
      const t = card ? cardTotals : totals;
      const args = {
        tab, lines, products, totals: t, settings, email,
        method, stripePaymentIntentId, cardBrand, cardLast4, discType, discVal, promo, giftCard,
        saleId, skipSideEffects: isRetry, tipByTech: chargedTipByTech,
        receiptContact: parseReceiptContact(receiptPhone),
        walkIn: hasServiceVisit ? isWalkIn : false,
      };
      // Card was already charged online — record it directly (retry UI handles a
      // failure). Cash/credit goes through recordSale so it survives no network.
      if (card) {
        const r = await completeSale(args);
        await clearTab();
        setSaving(false);
        setDone({ total: r.total, method: 'card', queued: false, note: r.sideEffectErrors?.length ? r.sideEffectErrors.join('; ') : '' });
      } else {
        const r = await recordSale(args);
        await clearTab();
        setSaving(false);
        if (r.queued) setDone({ total: t.total, method, queued: true, note: '' });
        else setDone({ total: r.result.total, method, queued: false, note: r.result.sideEffectErrors?.length ? r.result.sideEffectErrors.join('; ') : '' });
      }
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
    if (gateBlocked) {
      Alert.alert('Clock in required', `${offClock.join(', ')} ${offClock.length > 1 ? 'are' : 'is'} not clocked in. They must clock in at the Time Clock before checkout.`);
      return;
    }
    setPaid({ method, opts });
    doRecord({ method, ...opts }, false);
  }

  // Build the FULLY-PRICED hand-off the customer-facing checkout (front-desk
  // kiosk OR this device) consumes. The edited line prices are baked into the
  // cart and every adjustment the tech set (discount / promo / gift card / store
  // credit) rides along as `priced: true`, so the checkout honors them exactly
  // instead of re-deriving from raw service prices. The tip is left off on
  // purpose — the customer chooses it. A `sessionId` lets the tech's "sent"
  // screen recognize when this exact hand-off is paid at the kiosk.
  function buildHandoff() {
    const appts = (tab.appts || []).map((a, apptIdx) => ({
      ...a,
      services: (a.services || []).map((s, svcIdx) => {
        const li = lines0.findIndex(l => l.apptIdx === apptIdx && l.svcIdx === svcIdx);
        return li >= 0 ? { ...s, price: Number(prices[li]) || 0, techName: lines[li].techName } : s;
      }),
    }));
    const clientName = Array.from(new Set((tab.appts || []).map(a => a.clientName || 'Walk-in').filter(Boolean))).join(' + ') || 'Walk-in';
    const sessionId = genReceiptToken(16);
    // A pre-tip snapshot of the bill for the tech's "sent" summary — also the
    // source of the resolved store-credit $ baked into the hand-off (the kiosk
    // identity can't read the client to derive it; see kioskHandoff.js header).
    const summaryTotals = computeTotals({
      lines, productsTotal,
      discount: discType === 'none' ? null : { isPercent: discType !== 'amount', value: Number(discVal) || 0 },
      promo: normalizePromo(promo), taxRate: Number(settings?.taxRate) || 0,
      ccFeePct: 0, ccFeeFlat: 0, method: 'cash', noCardTips: false,
      tip: { custom: true, amount: 0, pct: null },
      giftCardBalance: giftCard?.balance || 0, applyGC: !!giftCard,
      clientCredit, applyCredit: applyCredit && clientCredit > 0,
      clientPoints, applyLoyalty: applyLoyalty && loyaltyOn, loyaltyConfig: loyaltyCfg,
    });
    const creditApplied = Math.max(0, Number(summaryTotals.creditApply) || 0);
    const payload = {
      sessionId,
      cart: { appts, products },
      priced: true,
      clientId: primaryClientId || null,
      clientName,
      createdBy: email || null,
      discType,
      discVal: Number(discVal) || 0,
      promo: promo || null,
      giftCard: giftCard || null,
      applyCredit: !!applyCredit,
      creditApplied,
      receiptPhone: receiptPhone || null,
    };
    const discountLabel = discType === 'member' ? `★ Member (${Number(discVal) || 0}%)`
      : discType === 'amount' ? 'Discount'
      : discType === 'percent' ? `Discount (${Number(discVal) || 0}%)` : null;
    const summary = {
      clientName,
      lines: lines.map(l => ({ name: l.name, price: l.price, techName: l.techName })),
      products: products.map(it => ({ name: it.product.name, qty: it.qty, price: (Number(it.product.price) || 0) * it.qty })),
      totals: summaryTotals, discountLabel, promoCode: promo?.code || null,
    };
    return { payload, summary, sessionId };
  }

  function preflight(verb) {
    if (paid) return false;
    if (lines.length === 0 && products.length === 0) { Alert.alert('Empty', `Nothing to ${verb}.`); return false; }
    if (gateBlocked) {
      Alert.alert('Clock in required', `${offClock.join(', ')} ${offClock.length > 1 ? 'are' : 'is'} not clocked in. They must clock in at the Time Clock before checkout.`);
      return false;
    }
    return true;
  }

  // Send the hand-off to the shared front-desk kiosk, then show the tech a live
  // billing summary that updates to "Paid" once the client finishes at the kiosk.
  async function sendToFrontDesk() {
    if (!preflight('send')) return;
    setSaving(true);
    try {
      const { payload, summary, sessionId } = buildHandoff();
      await setCheckoutSession(payload);
      await clearTab();
      setSaving(false);
      setSent({ summary, sessionId });
    } catch (e) {
      setSaving(false);
      Alert.alert("Couldn't send", e?.message || 'Try again.');
    }
  }

  // Run the same customer-facing checkout on THIS device — for techs who'd
  // rather hand the client their own phone/iPad than walk them to the front
  // desk. No shared session is written; the sale records identically.
  function checkoutHere() {
    if (!preflight('check out')) return;
    const { payload } = buildHandoff();
    setLocalSession({ status: 'pending', createdAt: payload.sessionId, ...payload });
  }

  if (settings === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  // Run the customer-facing checkout right here on the tech's device.
  if (localSession) {
    return (
      <KioskCheckout
        session={localSession}
        settings={settings}
        email={email}
        local
        onCancel={() => setLocalSession(null)}
        onComplete={() => { clearTab().catch(() => {}); navigation.goBack(); }}
      />
    );
  }

  // After "Send to front desk": show what was sent + live payment status.
  if (sent) {
    return <SentStatus sent={sent} styles={styles} theme={theme} onDone={() => navigation.goBack()} />;
  }

  if (done) {
    return (
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: pageMax, width: '100%', alignSelf: 'center' }}>
        <View style={styles.donePanel}>
          <Text style={styles.doneMark}>✓</Text>
          <Text style={styles.doneTitle}>{money(done.total)} collected</Text>
          <Text style={styles.doneSub}>{done.queued ? "Saved — the receipt sends once you're back online." : `Paid by ${done.method}.`}</Text>
          {!!done.note && <Text style={styles.doneNote}>{done.note}</Text>}
          {!done.queued && (
            <>
              <Text style={styles.doneSection}>Text or email the receipt</Text>
              <ResendReceiptRow viewToken={saleId}
                defaultPhone={(tab.appts || []).map(a => a.clientPhone).find(Boolean) || ''}
                defaultEmail={clientEmailOnFile}
                defaultContact={receiptPhone} />
            </>
          )}
          <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

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
        {[
          ['none', 'None'],
          ...(membership ? [['member', `★ ${membership.planName || 'Member'} ${membership.discountPct}%`]] : []),
          ['percent', '% off'],
          ['amount', '$ off'],
        ].map(([id, lbl]) => (
          <TouchableOpacity key={id} onPress={() => { setDiscType(id); if (id === 'member') setDiscVal(String(membership.discountPct)); }} style={[styles.chip, discType === id && styles.chipOn]}>
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
          : <>
              <TouchableOpacity onPress={() => { setGcSearchOpen(true); setGcQ(''); setGcResults(null); }} style={styles.findBtn}><Text style={styles.findText}>Find</Text></TouchableOpacity>
              <TouchableOpacity onPress={applyGiftCard} style={styles.applyBtn}><Text style={styles.applyText}>Apply</Text></TouchableOpacity>
            </>}
      </View>

      <Modal visible={gcSearchOpen} transparent animationType="slide" onRequestClose={() => setGcSearchOpen(false)}>
        <View style={styles.gcBackdrop}>
          <View style={styles.gcSheet}>
            <View style={styles.gcHead}>
              <Text style={styles.gcTitle}>Find a gift card</Text>
              <TouchableOpacity onPress={() => setGcSearchOpen(false)}><Text style={styles.gcClose}>✕</Text></TouchableOpacity>
            </View>
            <Text style={styles.gcSub}>Search by recipient name, phone, or email.</Text>
            <View style={styles.applyRow}>
              <TextInput style={[styles.input, { flex: 1 }]} value={gcQ} onChangeText={setGcQ} placeholder="Name, phone, or email" placeholderTextColor={theme.placeholder} autoCapitalize="none" onSubmitEditing={searchGiftCards} returnKeyType="search" />
              <TouchableOpacity onPress={searchGiftCards} style={styles.applyBtn}><Text style={styles.applyText}>{gcSearching ? '…' : 'Search'}</Text></TouchableOpacity>
            </View>
            {gcResults !== null && (gcResults.length === 0 ? (
              <Text style={styles.gcEmpty}>No matching gift cards with a balance.</Text>
            ) : (
              <FlatList
                data={gcResults}
                keyExtractor={(g) => g.id}
                style={{ maxHeight: 340, marginTop: 8 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.gcResult} onPress={() => applyFoundGiftCard(item)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.gcResultName} numberOfLines={1}>{item.recipientName || item.code}</Text>
                      <Text style={styles.gcResultSub} numberOfLines={1}>{item.code}{item.recipientPhone ? ` · ${item.recipientPhone}` : ''}{item.recipientEmail ? ` · ${item.recipientEmail}` : ''}</Text>
                    </View>
                    <Text style={styles.gcResultBal}>{money(item.balance)}</Text>
                  </TouchableOpacity>
                )}
              />
            ))}
          </View>
        </View>
      </Modal>

      {clientCredit > 0 && (
        <TouchableOpacity activeOpacity={0.7} onPress={() => setApplyCredit(v => !v)} style={[styles.creditRow, applyCredit && styles.creditRowOn]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.creditLabel}>Apply store credit</Text>
            <Text style={styles.creditSub}>{money(clientCredit)} available{applyCredit && totals.creditApply > 0 ? ` · using ${money(totals.creditApply)}` : ''}</Text>
          </View>
          <View style={[styles.toggle, applyCredit && styles.toggleOn]}><View style={[styles.knob, applyCredit && styles.knobOn]} /></View>
        </TouchableOpacity>
      )}

      {loyaltyOn && clientPoints >= loyaltyCfg.minRedeemPoints && (
        <TouchableOpacity activeOpacity={0.7} onPress={() => setApplyLoyalty(v => !v)} style={[styles.creditRow, applyLoyalty && styles.creditRowOn]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.creditLabel}>⭐ Redeem loyalty points</Text>
            <Text style={styles.creditSub}>{clientPoints} pts available{applyLoyalty && totals.loyaltyApply > 0 ? ` · using ${totals.loyaltyPts} pts (${money(totals.loyaltyApply)})` : ''}</Text>
          </View>
          <View style={[styles.toggle, applyLoyalty && styles.toggleOn]}><View style={[styles.knob, applyLoyalty && styles.knobOn]} /></View>
        </TouchableOpacity>
      )}


      {hasServiceVisit && (
        <TouchableOpacity style={styles.walkInRow} onPress={() => setIsWalkIn(v => !v)} activeOpacity={0.7}>
          <View style={[styles.walkInBox, isWalkIn && { backgroundColor: theme.green, borderColor: theme.green }]}>
            {isWalkIn && <Text style={styles.walkInCheck}>✓</Text>}
          </View>
          <Text style={styles.walkInLabel}>Walk-in</Text>
          <Text style={styles.walkInHint}>{isWalkIn ? 'Counts as a walk-in' : 'Counts as scheduled'}</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.section}>Send receipt to</Text>
      {hasPhoneOnFile && (
        <Text style={styles.muted}>Sends to the contact on file — enter a phone or email below to send it somewhere else.</Text>
      )}
      <TextInput style={styles.input} value={receiptPhone} onChangeText={setReceiptPhone} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder={hasPhoneOnFile ? 'Different phone or email (optional)' : 'Phone or email (optional)'} placeholderTextColor={theme.placeholder} maxLength={60} />

      {/* Tip + final payment happen on the customer-facing checkout
          ("Check out on this device" or front desk), not on this staff screen. */}

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
        {totals.creditApply > 0 && <Row label="Store credit" value={`-${money(totals.creditApply)}`} />}
        {totals.loyaltyApply > 0 && <Row label={`Loyalty (${totals.loyaltyPts} pts)`} value={`-${money(totals.loyaltyApply)}`} />}
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
          {!online && (
            <View style={styles.offlineNote}>
              <Text style={styles.offlineText}>📴 Offline — take cash or store credit now; the receipt syncs automatically when you're back online. Card needs a live connection.</Text>
            </View>
          )}
          {gateBlocked && (
            <View style={styles.gateNote}>
              <Text style={styles.gateText}>🔒 {offClock.join(', ')} {offClock.length > 1 ? 'are' : 'is'} not clocked in. They must clock in at the Time Clock before checkout.</Text>
            </View>
          )}
          {/* Payment happens on the customer-facing checkout. Staff either hands
              this device to the client, or sends it to the front-desk kiosk. */}
          <TouchableOpacity style={[styles.hereBtn, (saving || gateBlocked) && { opacity: 0.6 }]} onPress={checkoutHere} disabled={saving || gateBlocked} activeOpacity={0.85}>
            <Text style={styles.hereBtnText}>📱  Check out on this device</Text>
            <Text style={styles.hereBtnSub}>Hand the client your device to tip &amp; pay (card or cash)</Text>
          </TouchableOpacity>
          {online && (
            <TouchableOpacity style={[styles.deskBtn, (saving || gateBlocked) && { opacity: 0.6 }]} onPress={sendToFrontDesk} disabled={saving || gateBlocked} activeOpacity={0.85}>
              <Text style={styles.deskBtnText}>🏪  Send to front desk</Text>
              <Text style={styles.deskBtnSub}>Client tips + pays at the kiosk — this exact total &amp; all discounts carry over</Text>
            </TouchableOpacity>
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

// Shown to the tech after "Send to front desk": the bill they sent (pre-tip)
// plus a live status that flips to "Paid" the moment the client finishes at the
// kiosk. Watches the shared session and only reacts to OUR hand-off (sessionId).
function SentStatus({ sent, styles, theme, onDone }) {
  const { summary, sessionId } = sent;
  const t = summary.totals;
  const [info, setInfo] = useState({ kind: 'waiting' }); // waiting | paying | paid | canceled | superseded
  useEffect(() => {
    let latched = false;
    const unsub = subscribeCheckoutSession((doc) => {
      if (latched) return;
      if (!doc) { setInfo({ kind: 'canceled' }); return; }
      if (doc.paid && doc.sessionId === sessionId) { latched = true; setInfo({ kind: 'paid', paid: doc.paid }); return; }
      if (doc.sessionId !== sessionId) { setInfo({ kind: 'superseded' }); return; }
      if (doc.status === 'paying') { setInfo({ kind: 'paying' }); return; }
      if (doc.status === 'idle') { setInfo({ kind: 'canceled' }); return; }
      setInfo({ kind: 'waiting' });
    });
    return unsub;
  }, [sessionId]);

  const banner = {
    waiting:    { mark: '⏳', title: 'Waiting at the front desk', sub: 'The client adds a tip and pays at the kiosk.', color: theme.blue, bg: theme.blueSoft },
    paying:     { mark: '💳', title: 'Client is paying…', sub: 'Payment in progress at the kiosk.', color: theme.blue, bg: theme.blueSoft },
    paid:       { mark: '✓', title: `Paid ${money(info.paid?.total)}`, sub: `Completed at the front desk${info.paid?.method ? ` · ${info.paid.method}` : ''}.`, color: theme.success, bg: theme.greenSoft },
    canceled:   { mark: '✕', title: 'Canceled at the front desk', sub: 'The checkout was cleared without payment.', color: theme.danger, bg: theme.surfaceAlt },
    superseded: { mark: '↪', title: 'Taken over at the front desk', sub: 'Another checkout is now active at the kiosk.', color: theme.textMuted, bg: theme.surfaceAlt },
  }[info.kind];

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
      <View style={[styles.sentBanner, { backgroundColor: banner.bg, borderColor: banner.color }]}>
        {info.kind === 'waiting' || info.kind === 'paying'
          ? <ActivityIndicator color={banner.color} style={{ marginBottom: 6 }} />
          : <Text style={[styles.sentMark, { color: banner.color }]}>{banner.mark}</Text>}
        <Text style={[styles.sentTitle, { color: banner.color }]}>{banner.title}</Text>
        <Text style={styles.sentSub}>{banner.sub}</Text>
      </View>

      <Text style={styles.section}>Sent for {summary.clientName}</Text>
      {summary.lines.map((l, i) => (
        <View key={`l${i}`} style={styles.lineRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{l.name}</Text>
            <Text style={styles.lineTech}>{l.techName || '—'}</Text>
          </View>
          <Text style={styles.lineName}>{money(l.price)}</Text>
        </View>
      ))}
      {summary.products.map((p, i) => (
        <View key={`p${i}`} style={styles.lineRow}>
          <View style={{ flex: 1 }}><Text style={styles.lineName}>{p.name} × {p.qty}</Text></View>
          <Text style={styles.lineName}>{money(p.price)}</Text>
        </View>
      ))}

      <View style={styles.totals}>
        <Row label="Subtotal" value={money(t.subtotal)} />
        {t.discountAmount > 0 && <Row label={summary.discountLabel || 'Discount'} value={`-${money(t.discountAmount)}`} />}
        {t.promoAmount > 0 && <Row label={`Promo ${summary.promoCode || ''}`} value={`-${money(t.promoAmount)}`} />}
        {t.taxAmt > 0 && <Row label="Tax" value={money(t.taxAmt)} />}
        {t.gcApply > 0 && <Row label="Gift card" value={`-${money(t.gcApply)}`} />}
        {t.creditApply > 0 && <Row label="Store credit" value={`-${money(t.creditApply)}`} />}
        {t.loyaltyApply > 0 && <Row label={`Loyalty (${t.loyaltyPts} pts)`} value={`-${money(t.loyaltyApply)}`} />}
        <View style={styles.divider} />
        <Row label="Total before tip" value={money(t.total)} big />
      </View>
      <Text style={styles.muted}>The client adds their tip at the kiosk, so the final total may be higher.</Text>

      <TouchableOpacity style={styles.doneBtn} onPress={onDone} activeOpacity={0.85}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </ScrollView>
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
  walkInRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, paddingVertical: 4 },
  walkInBox:   { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: t.border, alignItems: 'center', justifyContent: 'center' },
  walkInCheck: { color: '#fff', fontSize: 14, fontWeight: '800' },
  walkInLabel: { fontSize: 15, fontWeight: '700', color: t.text },
  walkInHint:  { fontSize: 12, color: t.textFaint, flex: 1, textAlign: 'right' },
  tipMethodRow:  { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 10 },
  tipMethod:     { flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: t.border, alignItems: 'center', backgroundColor: t.surface },
  tipMethodOn:   { backgroundColor: t.greenSoft, borderColor: t.green },
  tipMethodText: { fontSize: 14, fontWeight: '800', color: t.textMuted },
  tipMethodTextOn:{ color: t.green },
  tipCashNote:   { backgroundColor: t.greenSoft, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.green, marginBottom: 6 },
  tipCashText:   { fontSize: 14, fontWeight: '600', color: t.green, lineHeight: 20 },
  venmoInline:   { marginTop: 12, alignItems: 'center', gap: 16 },
  venmoNote:     { fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 18 },
  venmoQrItem:   { alignItems: 'center', backgroundColor: t.surfaceAlt, borderRadius: 16, padding: 16, width: '100%' },
  venmoQrHead:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  venmoQrName:   { fontSize: 16, fontWeight: '800', color: t.text },
  venmoQrHandle: { fontSize: 15, fontWeight: '700', color: '#3D95CE', marginTop: 12 },
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
  findBtn:   { backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  findText:  { color: t.text, fontWeight: '800', fontSize: 14 },
  gcBackdrop:{ flex: 1, backgroundColor: t.overlay, justifyContent: 'flex-end' },
  gcSheet:   { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 28 },
  gcHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gcTitle:   { fontSize: 18, fontWeight: '800', color: t.text },
  gcClose:   { fontSize: 20, color: t.textMuted, paddingHorizontal: 6 },
  gcSub:     { fontSize: 13, color: t.textMuted, marginTop: 2, marginBottom: 12 },
  gcEmpty:   { fontSize: 14, color: t.textFaint, paddingVertical: 16, textAlign: 'center' },
  gcResult:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.border },
  gcResultName:{ fontSize: 15, fontWeight: '700', color: t.text },
  gcResultSub: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  gcResultBal: { fontSize: 16, fontWeight: '800', color: t.green },
  clearBtn:  { backgroundColor: t.greenSoft, borderWidth: 1, borderColor: t.green, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  clearText: { color: t.green, fontWeight: '800', fontSize: 13 },
  offlineNote:{ backgroundColor: t.warnBg || t.surfaceAlt, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.warn || t.borderStrong },
  offlineText:{ fontSize: 12.5, color: t.text, lineHeight: 18 },
  gateNote:  { backgroundColor: t.warnBg || t.surfaceAlt, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.warn || t.borderStrong },
  gateText:  { fontSize: 12.5, color: t.text, lineHeight: 18, fontWeight: '600' },
  creditRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, backgroundColor: t.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.border },
  creditRowOn:{ borderColor: t.green, backgroundColor: t.greenSoft },
  creditLabel:{ fontSize: 14, fontWeight: '700', color: t.text },
  creditSub:  { fontSize: 12, color: t.textMuted, marginTop: 2 },
  toggle:     { width: 44, height: 26, borderRadius: 13, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.border, padding: 2, justifyContent: 'center' },
  toggleOn:   { backgroundColor: t.green, borderColor: t.green },
  knob:       { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  knobOn:     { alignSelf: 'flex-end' },
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
  deskBtn:   { marginTop: 12, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14, alignItems: 'center', borderWidth: 1, borderColor: t.blue, backgroundColor: t.blueSoft },
  deskBtnText:{ color: t.blue, fontWeight: '800', fontSize: 15 },
  deskBtnSub:{ color: t.textMuted, fontWeight: '600', fontSize: 11.5, marginTop: 3, textAlign: 'center' },
  hereBtn:   { marginTop: 12, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14, alignItems: 'center', borderWidth: 1, borderColor: t.border, backgroundColor: t.surface },
  hereBtnText:{ color: t.text, fontWeight: '800', fontSize: 15 },
  hereBtnSub:{ color: t.textMuted, fontWeight: '600', fontSize: 11.5, marginTop: 3, textAlign: 'center' },
  sentBanner:{ alignItems: 'center', borderRadius: 16, padding: 22, borderWidth: 1, marginTop: 8 },
  sentMark:  { fontSize: 46, fontWeight: '800', marginBottom: 4 },
  sentTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  sentSub:   { fontSize: 13.5, color: t.textMuted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
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
  donePanel: { backgroundColor: t.surface, borderRadius: 16, padding: 24, marginTop: 24, borderWidth: 1, borderColor: t.border, alignItems: 'center' },
  doneMark:  { fontSize: 54, color: t.success, fontWeight: '800', marginBottom: 8 },
  doneTitle: { fontSize: 24, fontWeight: '800', color: t.text, textAlign: 'center' },
  doneSub:   { fontSize: 14, color: t.textMuted, marginTop: 6, textAlign: 'center' },
  doneNote:  { fontSize: 12.5, color: t.danger, marginTop: 8, textAlign: 'center' },
  doneSection:{ fontSize: 13, fontWeight: '800', color: t.text, marginTop: 22, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3, alignSelf: 'flex-start' },
  doneBtn:   { marginTop: 22, backgroundColor: t.green, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 44, alignSelf: 'stretch', alignItems: 'center' },
  doneBtnText:{ color: '#fff', fontWeight: '800', fontSize: 16 },
});
