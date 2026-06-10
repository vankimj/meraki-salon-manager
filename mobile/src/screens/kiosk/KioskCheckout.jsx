import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import {
  clearCheckoutSession, updateCheckoutSession, fetchClient, fetchClientMembership,
  chargeStoredCard, claimCheckoutSession, fetchEmployees,
} from '../../lib/firestore';
import QRCode from '../../components/QRCode';
import TechAvatar from '../../components/TechAvatar';
import { computeTotals, buildTechSplit, genReceiptToken, parseReceiptContact, normalizePromo } from '../../lib/checkout';
import { completeSale } from '../../lib/completeSale';
import { recordSale, syncOfflineSales } from '../../lib/resilientSale';
import { isTerminalAvailable } from '../../lib/terminal';
import useOnline from '../../hooks/useOnline';
import CardPayButton from '../checkout/CardPayButton';
import ResendReceiptRow from '../../components/ResendReceiptRow';
import TechTipInputs from '../../components/TechTipInputs';
import useResponsive from '../../hooks/useResponsive';
import useCurrentEmployee from '../../hooks/useCurrentEmployee';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const TIP_PCTS = [0, 15, 18, 20, 25];

// The customer-facing checkout surface. Two drivers, identical UI:
//   • Front-desk kiosk — `session` comes from data/checkoutSession (Firestore);
//     finishing clears that session back to idle.
//   • On-device ("check out here") — `local` is true and the tech hands their
//     own phone/iPad to the client; finishing calls onCancel / onComplete so the
//     parent screen can pop back. No shared session, so the claim-lock is skipped.
// itemized services + tax + total, a tip selector, then Pay → Cash (tendered +
// change) or Card. On success it writes the canonical receipt (via completeSale)
// the same way every other checkout does, so Reports/Earnings stay in sync.
export default function KioskCheckout({ session, settings, email, local = false, onCancel, onComplete }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
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

  // Service revenue per tech — drives the default proportional tip split and the
  // optional per-tech tip fields (only offered when 2+ techs worked this sale).
  const techRevenue = useMemo(() => {
    const m = {};
    lines.forEach(l => { const t = l.techName || ''; m[t] = (m[t] || 0) + (Number(l.price) || 0); });
    return m;
  }, [lines]);
  const multiTech = Object.keys(techRevenue).length >= 2;

  const [tipMode, setTipMode]   = useState('pct');   // 'pct' | 'custom' | 'perTech'
  const [tipPct, setTipPct]     = useState(0);
  const [tipAmtStr, setTipAmtStr] = useState('');
  const [perTechTips, setPerTechTips] = useState({});   // { techName: '12.00' }
  const [venmoByTech, setVenmoByTech] = useState({});   // { techName: '@handle' }
  const [photoByTech, setPhotoByTech] = useState({});   // { techName: base64/url }
  const [tipMethod, setTipMethod]     = useState('card'); // card | venmo | cash
  useEffect(() => {
    let alive = true;
    fetchEmployees().then(emps => {
      if (!alive) return;
      const v = {}, p = {};
      (emps || []).forEach(e => { if (e.name) { if (e.venmo) v[e.name] = e.venmo; if (e.photo) p[e.name] = e.photo; } });
      setVenmoByTech(v); setPhotoByTech(p);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  // Walk-ins have no phone on file, so the receipt SMS/email triggers have
  // nothing to fire on. Let them opt into a texted receipt at the kiosk.
  const [receiptPhone, setReceiptPhone] = useState(session.receiptPhone || '');
  const [receiptEmail, setReceiptEmail] = useState('');
  // Restore the right screen if the kiosk reloads onto an in-flight session
  // (e.g. a cash-review that's already 'confirmed' → show the thank-you again).
  const [stage, setStage]       = useState(session?.status === 'confirmed' ? 'confirmed' : 'review'); // review | handback | cash | done | confirmed
  // Cash-review handoff from the WEB: the client reviews the bill + adds a tip
  // and taps "Is this correct?"; the WEB then collects the cash + records it.
  // The kiosk takes no payment in this mode.
  const cashReview = session?.flow === 'cashReview';
  // Logged-in staff name, for the "hand the device back to {name}" step when a
  // client picks cash on the staff's own device (local "check out on this device").
  const { techName: staffName } = useCurrentEmployee();
  const [cashStr, setCashStr]   = useState('');
  const [rcptSaved, setRcptSaved] = useState(false); // cash-review: client's receipt contact sent back to the web
  const [saving, setSaving]     = useState(false);
  const [paidMsg, setPaidMsg]   = useState('');
  const [client, setClient]     = useState(null);
  const [membership, setMembership] = useState(null); // active membership → auto discount
  const [queued, setQueued]     = useState(false);    // sale saved offline, pending sync
  const online = useOnline();
  const [paid, setPaid]         = useState(null);   // {method,opts} once money is CAPTURED — blocks any re-charge
  const [recordErr, setRecordErr] = useState('');
  // One stable id per checkout: the Stripe idempotency key (no double-charge on
  // retry/double-tap) AND the receipt doc id (no duplicate receipt on a retry).
  const [saleId] = useState(() => genReceiptToken(24));
  // Concurrency lock: if two kiosks share this session, only the one that wins
  // the claim shows pay buttons; the other shows a read-only "handled elsewhere".
  // A local (on-device) checkout never shares a session, so it always owns it.
  const [kioskId] = useState(() => genReceiptToken(12));
  const [claimState, setClaimState] = useState((local || cashReview) ? 'mine' : 'checking'); // checking | mine | other
  useEffect(() => {
    // No claim/lock for local or cash-review: cash-review takes NO payment on
    // the kiosk, and a 'confirmed' session isn't claimable (claim only accepts
    // pending/paying) — claiming it would spin on "checking" forever. Skip it.
    // The .catch also keeps a rejected/slow claim from pinning the spinner.
    if (local || cashReview) return;
    let alive = true;
    claimCheckoutSession(kioskId)
      .then(ok => { if (alive) setClaimState(ok ? 'mine' : 'other'); })
      .catch(() => { if (alive) setClaimState('mine'); });
    return () => { alive = false; };
  }, [kioskId, local]); // eslint-disable-line

  // Finish helpers: a shared session clears back to idle; a local checkout hands
  // control back to the parent (which pops to the schedule / checkout editor).
  function finishCancel() { if (local) onCancel?.(); else clearCheckoutSession().catch(() => {}); }
  function finishComplete() { if (local) onComplete?.(); else clearCheckoutSession().catch(() => {}); }

  // Pull the client to surface a "charge card on file" option when they have
  // one, and their active membership so the member discount auto-applies (the
  // customer never has to ask — same as the web checkout).
  useEffect(() => {
    let alive = true;
    if (session.clientId) {
      fetchClient(session.clientId).then(c => {
        if (!alive) return;
        setClient(c);
        // Prefill the receipt contact from the client profile (phone preferred,
        // then email) so the receipt fields aren't blank — staff/client can edit.
        setReceiptPhone(prev => prev || c?.phone || '');
        setReceiptEmail(prev => prev || c?.email || '');
      }).catch(() => {});
      fetchClientMembership(session.clientId).then(m => {
        if (alive && m && m.status === 'active' && Number(m.discountPct) > 0) setMembership(m);
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [session.clientId]);
  const savedPm = client?.paymentMethods?.find(p => p.id === client.defaultPaymentMethodId) || client?.paymentMethods?.[0] || null;
  const hasPhoneOnFile = (cart.appts || []).some(a => a.clientPhone) || !!client?.phone;
  const clientCredit = Number(client?.credit) || 0;

  // A "priced" session was sent from the tech's checkout with every adjustment
  // already applied — honor EXACTLY what they set and do NOT also auto-apply the
  // membership discount (that would double-discount). A bare hand-off (no
  // pricing) keeps the old behavior: auto-apply the member discount + any store
  // credit so the customer never has to ask.
  const priced = !!session.priced;
  const memberDiscount = membership ? { isPercent: true, value: Number(membership.discountPct) || 0 } : null;
  const sessionDiscount = (session.discType && session.discType !== 'none')
    ? { isPercent: session.discType !== 'amount', value: Number(session.discVal) || 0 }
    : null;
  const discount   = priced ? sessionDiscount : memberDiscount;
  const promo      = priced ? (session.promo || null) : null;
  const giftCard   = priced ? (session.giftCard || null) : null;
  const applyCredit = priced ? (!!session.applyCredit && clientCredit > 0) : (clientCredit > 0);
  const discountLabel = priced
    ? (session.discType === 'member' ? `★ Member (${Number(session.discVal) || 0}%)`
       : session.discType === 'amount' ? 'Discount'
       : `Discount (${Number(session.discVal) || 0}%)`)
    : `★ ${membership?.planName || 'Member'} (${membership?.discountPct}%)`;

  // Per-tech tips override the proportional split when the customer chose to tip
  // each tech separately; the sale's tip total is then their sum.
  const tipByTech = (tipMode === 'perTech')
    ? Object.keys(techRevenue).map(t => ({ techName: t, amount: Number(perTechTips[t]) || 0 }))
    : null;
  const perTechTotal = tipByTech ? tipByTech.reduce((s, t) => s + t.amount, 0) : 0;
  const tip = (tipMode === 'perTech')
    ? { custom: true, amount: perTechTotal, pct: null }
    : { custom: tipMode === 'custom', amount: Number(tipAmtStr) || 0, pct: tipMode === 'pct' ? tipPct : null };
  // The tip is added to the charge ONLY when paid by card. Venmo / cash tips go
  // straight to the tech (QR / cash in hand), so they're never part of the bill.
  const tipForCharge = tipMethod === 'card' ? tip : { custom: true, amount: 0, pct: null };
  const totalsFor = (method, tipArg) => computeTotals({
    lines, productsTotal, discount, promo: normalizePromo(promo),
    taxRate: Number(settings?.taxRate) || 0,
    ccFeePct: Number(settings?.ccFeePct) || 0, ccFeeFlat: Number(settings?.ccFeeFlat) || 0,
    method, noCardTips: !!settings?.noCardTips, tip: tipArg,
    giftCardBalance: giftCard?.balance || 0, applyGC: !!giftCard,
    clientCredit, applyCredit,
  });
  const cashTotals = useMemo(() => totalsFor('cash', tipForCharge), [lines, productsTotal, tipMode, tipPct, tipAmtStr, perTechTips, tipMethod, settings, membership, clientCredit, priced]);
  const cardTotals = useMemo(() => totalsFor('card', tipForCharge), [lines, productsTotal, tipMode, tipPct, tipAmtStr, perTechTips, tipMethod, settings, membership, clientCredit, priced]);
  // The tip amount the customer selected (drives the Venmo QR), regardless of
  // whether it's charged — so the QR shows the right amount even when off-bill.
  const selectedTipAmt = useMemo(() => totalsFor('card', tip).tipAmt || 0, [lines, productsTotal, tipMode, tipPct, tipAmtStr, perTechTips, settings, membership, clientCredit, priced]);

  // Venmo tips: customers can tip a tech directly (QR to their Venmo) instead of
  // (or on top of) a card tip. Amount prefilled from the selected tip, split per
  // tech by service revenue (or the per-tech amounts when "Tip each tech").
  const venmoTechs = Object.keys(techRevenue).filter(t => t && venmoByTech[t]);
  const totalRev   = Object.values(techRevenue).reduce((s, v) => s + v, 0);
  function venmoTipFor(t) {
    if (tipMode === 'perTech') return Number(perTechTips[t]) || 0;
    const tipAmt = selectedTipAmt || 0;
    if (!tipAmt || !totalRev) return 0;
    return Math.round(tipAmt * ((techRevenue[t] || 0) / totalRev) * 100) / 100;
  }

  // Flush any sales stranded offline whenever the checkout arms.
  useEffect(() => { syncOfflineSales().catch(() => {}); }, [session.createdAt]);

  // Keep the result (esp. change due) on screen, then auto-return.
  useEffect(() => {
    if (stage !== 'done') return;
    const id = setTimeout(() => { finishComplete(); }, 9000);
    return () => clearTimeout(id);
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Record the sale (write the receipt). Separate from the CHARGE: by the time
  // this runs the money is already captured (card charged / cash in hand), so a
  // failure here NEVER re-charges — it surfaces a retry that only re-saves.
  async function doRecord(method, opts, isRetry = false) {
    setSaving(true); setRecordErr('');
    try {
      const t = method === 'card' ? cardTotals : cashTotals;
      const changeDue = (method === 'cash' && opts.cashTendered != null)
        ? Math.max(0, (Number(opts.cashTendered) || 0) - t.total) : null;
      // A priced hand-off carries the tech's exact adjustments so the receipt +
      // side effects (gift-card debit, promo count, credit deduct/issue) match
      // what was shown; a bare hand-off only carries the auto member discount.
      const adj = priced
        ? {
            discType: (session.discType && session.discType !== 'none') ? session.discType : 'none',
            discVal: Number(session.discVal) || 0,
            promo: session.promo || null,
            giftCard: session.giftCard || null,
            issueCredit: Number(session.issueCredit) || 0,
          }
        : (membership ? { discType: 'member', discVal: Number(membership.discountPct) || 0 } : {});
      const args = {
        tab: { appts: cart.appts || [], products }, lines, products,
        totals: t, settings, email, method, saleId, skipSideEffects: isRetry,
        receiptContact: parseReceiptContact(receiptPhone),
        tipByTech,
        ...adj,
        ...opts,
      };
      // Card already charged online → record directly. Cash goes through
      // recordSale so a dropped connection just queues the receipt to sync later.
      let sideEffectErrors = []; let wasQueued = false;
      if (method === 'card') {
        const r = await completeSale(args); sideEffectErrors = r.sideEffectErrors || [];
      } else {
        const r = await recordSale(args);
        if (r.queued) wasQueued = true; else sideEffectErrors = r.result.sideEffectErrors || [];
      }
      setQueued(wasQueued);
      // Report the result back onto the shared session so the tech who sent it
      // to the front desk sees it land ("Paid $X"). The money is captured even
      // when the receipt is queued offline, so report it either way (the write
      // just queues and syncs too). Local checkouts have no shared session.
      // Fire-and-forget — never block the done screen.
      if (!local) {
        updateCheckoutSession({ status: 'paying', paid: { total: t.total, method, at: new Date().toISOString() } }).catch(() => {});
      }
      const base = method === 'cash' && changeDue != null
        ? `Paid ${money(t.total)} — change due ${money(changeDue)}`
        : `Paid ${money(t.total)} — thank you!`;
      setPaidMsg(sideEffectErrors?.length ? `${base}\n(${sideEffectErrors.join('; ')})` : base);
      setStage('done');
    } catch (e) {
      setRecordErr(e?.message || 'Could not save the receipt.');
      setSaving(false);
    }
  }

  // Called the instant payment is captured. Latches `paid` so the charge
  // buttons disappear (no double-charge), then records the sale.
  function settle(method, opts = {}) {
    if (paid) return;
    if (lines.length === 0 && products.length === 0) return; // never record an empty sale
    setPaid({ method, opts });
    if (!local) updateCheckoutSession({ status: 'paying' }).catch(() => {});
    doRecord(method, opts, false);
  }

  // Cash-review handoff: the client confirms the bill + tip; send the chosen tip
  // back so the WEB collects the cash + records the sale. No payment taken here.
  async function confirmCashReview() {
    if (saving) return;
    setSaving(true);
    try {
      // Only an "on bill" (card) tip is recorded on the cash sale. Venmo / cash
      // tips go straight to the tech (QR / hand), so the recorded tip is 0.
      await updateCheckoutSession({
        status: 'confirmed',
        confirmedTip: { amount: cashTotals.tipAmt || 0, byTech: tipMethod === 'card' ? (tipByTech || null) : null },
        confirmedAt: new Date().toISOString(),
      });
      setStage('confirmed');
    } catch (e) {
      Alert.alert('Could not confirm', e?.message || 'Please try again.');
    } finally { setSaving(false); }
  }

  // Return to the idle TipFlow once the sale is done. Primary trigger: the web
  // records the cash sale and clears the session (status→idle) → KioskScreen
  // drops to idle on its own. This is a backstop so an abandoned confirmation
  // can't pin the kiosk on the "thank you" screen forever.
  useEffect(() => {
    if (stage !== 'confirmed') return;
    const t = setTimeout(() => { clearCheckoutSession().catch(() => {}); }, 4 * 60 * 1000);
    return () => clearTimeout(t);
  }, [stage]);

  // Cash-review: the client enters where to send their receipt (phone and/or
  // email); pass both back so the WEB sends it when it records the sale.
  async function saveReceiptContact() {
    const ph = (receiptPhone || '').trim();
    const em = (receiptEmail || '').trim();
    if (!ph && !em) return;
    try {
      await updateCheckoutSession({ confirmedReceiptPhone: ph || null, confirmedReceiptEmail: em || null });
      setRcptSaved(true);
    } catch (e) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
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
        idempotencyKey: saleId,
      });
      // Only 'succeeded' means the money was actually captured; 'requires_capture'
      // is an uncaptured authorization and must NOT be recorded as a paid sale.
      if (!res || res.status !== 'succeeded') {
        throw new Error(`Card ${res?.status || 'was declined'}.`);
      }
      settle('card', { stripePaymentIntentId: res.paymentIntentId, cardBrand: savedPm.brand || null, cardLast4: savedPm.last4 || null });
    } catch (e) {
      Alert.alert('Card on file failed', e?.message || 'Please try again.');
      setSaving(false);
    }
  }

  function cancel() { finishCancel(); }

  // Another station already owns this checkout — show a read-only state (no pay
  // buttons here) so the same sale can't be charged twice.
  if (claimState === 'checking' && stage !== 'done') {
    return <View style={styles.center}><ActivityIndicator color={theme.green} size="large" /></View>;
  }
  if (claimState === 'other' && stage !== 'done') {
    return (
      <View style={styles.idle}>
        <Text style={styles.idleMark}>🧾</Text>
        <Text style={styles.idleTitle}>Checking out…</Text>
        <Text style={styles.idleSub}>This sale is being completed at another station.</Text>
      </View>
    );
  }

  if (stage === 'confirmed') {
    return (
      <ScrollView style={styles.wrap} contentContainerStyle={styles.idle}>
        <Text style={styles.doneMark}>✓</Text>
        <Text style={styles.idleTitle}>Thank you!</Text>
        <Text style={styles.idleSub}>Your total{cashTotals.tipAmt > 0 ? ' (with tip)' : ''} is confirmed. Please pay with cash at the front desk to finish.</Text>
        <Text style={[styles.idleTitle, { marginTop: 14, color: theme.green }]}>{money(cashTotals.total)}</Text>
        <View style={styles.resendBox}>
          {rcptSaved ? (
            <Text style={styles.resendLabel}>We'll send your receipt to {[receiptPhone, receiptEmail].filter(Boolean).join(' and ')}. 💚</Text>
          ) : (
            <>
              <Text style={styles.resendLabel}>Want your receipt? We'll send it here.</Text>
              <TextInput
                style={styles.receiptInput}
                value={receiptPhone}
                onChangeText={setReceiptPhone}
                keyboardType="phone-pad"
                placeholder="Phone"
                placeholderTextColor={theme.placeholder}
                maxLength={40}
              />
              <TextInput
                style={[styles.receiptInput, { marginTop: 8 }]}
                value={receiptEmail}
                onChangeText={setReceiptEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Email"
                placeholderTextColor={theme.placeholder}
                maxLength={60}
              />
              <TouchableOpacity style={[styles.okBtn, !((receiptPhone || '').trim() || (receiptEmail || '').trim()) && { opacity: 0.5 }]} onPress={saveReceiptContact} disabled={!((receiptPhone || '').trim() || (receiptEmail || '').trim())} activeOpacity={0.85}>
                <Text style={styles.okBtnText}>Send my receipt</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    );
  }

  if (stage === 'done') {
    const c = parseReceiptContact(receiptPhone);
    const receiptLine = queued ? "Saved — your receipt sends once we're back online."
      : c?.email ? `Receipt emailed to ${c.email}.`
      : c?.phone ? `Receipt texted to •••${c.phone.replace(/\D/g, '').slice(-4)}.`
      : hasPhoneOnFile ? 'A receipt is on its way.'
      : 'See you next time!';
    return (
      <View style={styles.idle}>
        <Text style={styles.doneMark}>✓</Text>
        <Text style={styles.idleTitle}>{paidMsg}</Text>
        <Text style={styles.idleSub}>{receiptLine}</Text>
        {!queued && (
          <View style={styles.resendBox}>
            <Text style={styles.resendLabel}>Want it texted or emailed?</Text>
            <ResendReceiptRow viewToken={saleId}
              defaultPhone={client?.phone || (cart.appts || []).map(a => a.clientPhone).find(Boolean) || ''}
              defaultEmail={client?.email || ''}
              defaultContact={receiptPhone} />
          </View>
        )}
        <TouchableOpacity style={styles.doneBtn} onPress={finishComplete}>
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
          {!!l.techName && <View style={{ marginRight: 10 }}><TechAvatar name={l.techName} photo={photoByTech[l.techName]} size={34} /></View>}
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
          <View style={styles.tipMethodRow}>
            <TouchableOpacity style={[styles.tipMethod, tipMethod === 'card' && styles.tipMethodOn]} onPress={() => setTipMethod('card')}>
              <Text style={[styles.tipMethodText, tipMethod === 'card' && styles.tipMethodTextOn]}>{cashReview ? '🧾 On bill' : '💳 Card'}</Text>
            </TouchableOpacity>
            {venmoTechs.length > 0 && (
              <TouchableOpacity style={[styles.tipMethod, tipMethod === 'venmo' && styles.tipMethodOn]} onPress={() => setTipMethod('venmo')}>
                <Text style={[styles.tipMethodText, tipMethod === 'venmo' && styles.tipMethodTextOn]}>💸 Venmo</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.tipMethod, tipMethod === 'cash' && styles.tipMethodOn]} onPress={() => setTipMethod('cash')}>
              <Text style={[styles.tipMethodText, tipMethod === 'cash' && styles.tipMethodTextOn]}>💵 Cash</Text>
            </TouchableOpacity>
          </View>

          {tipMethod === 'cash' ? (
            <View style={styles.tipCashNote}>
              <Text style={styles.tipCashText}>No tip added to your bill — please hand your tip in cash directly to your nail tech. Thank you! 💚</Text>
            </View>
          ) : tipMethod === 'venmo' ? null : (
            <>
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
                {multiTech && (
                  <TouchableOpacity onPress={() => setTipMode('perTech')} style={[styles.tipChip, tipMode === 'perTech' && styles.tipChipOn]}>
                    <Text style={[styles.tipChipText, tipMode === 'perTech' && styles.tipChipTextOn]}>Tip each tech</Text>
                  </TouchableOpacity>
                )}
              </View>
              {tipMode === 'perTech' && (
                <TechTipInputs techRevenue={techRevenue} values={perTechTips} photoByTech={photoByTech} onChange={(t, v) => setPerTechTips(prev => ({ ...prev, [t]: v }))} />
              )}
              {multiTech && tipMode !== 'perTech' && selectedTipAmt > 0 && (
                <Text style={styles.splitNote}>{tipMethod === 'venmo' ? 'Each tech gets their share by service amount.' : 'Split across techs by service amount. Tap "Tip each tech" to set them individually.'}</Text>
              )}
            </>
          )}

          {tipMethod === 'venmo' && venmoTechs.length > 0 && (
            <View style={styles.venmoInline}>
              <Text style={styles.venmoNote}>Scan to tip your tech directly with Venmo — this is not added to your bill.</Text>
              {venmoTechs.map(t => {
                const amt = venmoTipFor(t);
                const handle = String(venmoByTech[t] || '').replace(/^@/, '').trim();
                const url = `https://venmo.com/u/${encodeURIComponent(handle)}?txn=pay${amt > 0 ? `&amount=${amt.toFixed(2)}` : ''}&note=${encodeURIComponent('Tip — thank you!')}`;
                return (
                  <View key={t} style={styles.venmoQrItem}>
                    <View style={styles.venmoQrHead}>
                      <TechAvatar name={t} photo={photoByTech[t]} size={32} />
                      <Text style={styles.venmoQrName}>{t}</Text>
                    </View>
                    <QRCode value={url} size={180} />
                    <Text style={styles.venmoQrHandle}>@{handle}{amt > 0 ? `  ·  ${money(amt)}` : ''}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {!hasPhoneOnFile && (
            <>
              <Text style={styles.section}>Get my receipt</Text>
              <TextInput
                style={styles.receiptInput}
                value={receiptPhone}
                onChangeText={setReceiptPhone}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Phone or email (optional)"
                placeholderTextColor={theme.placeholder}
                maxLength={60}
              />
            </>
          )}
        </>
      )}

      {/* Totals */}
      <View style={styles.totals}>
        <Row styles={styles} label="Subtotal" value={money(cashTotals.subtotal)} />
        {cashTotals.discountAmount > 0 && <Row styles={styles} label={discountLabel} value={`−${money(cashTotals.discountAmount)}`} />}
        {cashTotals.promoAmount > 0 && <Row styles={styles} label={`Promo ${promo?.code || ''}`} value={`−${money(cashTotals.promoAmount)}`} />}
        {cashTotals.taxAmt > 0 && <Row styles={styles} label="Tax" value={money(cashTotals.taxAmt)} />}
        {cashTotals.gcApply > 0 && <Row styles={styles} label="Gift card" value={`−${money(cashTotals.gcApply)}`} />}
        {cashTotals.creditApply > 0 && <Row styles={styles} label="Store credit" value={`−${money(cashTotals.creditApply)}`} />}
        {cashTotals.tipAmt > 0 && <Row styles={styles} label="Tip" value={money(cashTotals.tipAmt)} />}
        <View style={styles.divider} />
        <Row styles={styles} label="Total" value={money(cashTotals.total)} big />
      </View>

      {/* Payment captured but the receipt-save failed: retry the SAVE only —
          the card is never re-charged (charge buttons are gone once paid). */}
      {paid && stage !== 'done' && (
        <View style={styles.settling}>
          {!recordErr ? (
            <>
              <ActivityIndicator color={theme.green} />
              <Text style={styles.settlingText}>Payment received — saving…</Text>
            </>
          ) : (
            <>
              <Text style={styles.settlingErr}>Payment received, but saving the receipt failed:</Text>
              <Text style={styles.settlingErrSub}>{recordErr}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => doRecord(paid.method, paid.opts, true)} disabled={saving}>
                <Text style={styles.retryBtnText}>{saving ? 'Saving…' : 'Retry saving receipt'}</Text>
              </TouchableOpacity>
              <Text style={styles.settlingNote}>The card was NOT charged again — this only re-saves the receipt.</Text>
            </>
          )}
        </View>
      )}

      {stage === 'review' && !paid && cashReview && (
        <>
          <Text style={styles.confirmHint}>Review your bill above and add a tip, then confirm. You'll pay with cash at the front desk.</Text>
          <TouchableOpacity style={[styles.okBtn, saving && { opacity: 0.6 }]} onPress={confirmCashReview} disabled={saving} activeOpacity={0.85}>
            <Text style={styles.okBtnText}>{saving ? 'One sec…' : `Is this correct? · ${money(cashTotals.total)}`}</Text>
          </TouchableOpacity>
        </>
      )}

      {stage === 'review' && !paid && !cashReview && (
        <>
          {!online && (
            <View style={styles.offlineNote}><Text style={styles.offlineText}>📴 Offline — pay with cash for now. Your receipt syncs automatically once we're back online.</Text></View>
          )}
          {online && savedPm && (
            <TouchableOpacity style={styles.cofBtn} onPress={payCardOnFile} disabled={saving} activeOpacity={0.85}>
              <Text style={styles.cofBtnText}>💳  Charge card on file · {(savedPm.brand || 'card')} •••• {savedPm.last4 || '••••'}</Text>
            </TouchableOpacity>
          )}
          {!online ? (
            <View style={styles.cardDisabled}><Text style={styles.cardDisabledText}>💳 Card — needs a live connection</Text></View>
          ) : isTerminalAvailable() ? (
            <CardPayButton
              amountCents={Math.round((cardTotals.total || 0) * 100)}
              description={clientName}
              locationId={settings?.terminalLocationId || null}
              onBehalfOf={settings?.stripeConnect?.accountId || settings?.connectAccountId || settings?.stripeAccountId || undefined}
              merchantName={settings?.salonName || 'Salon'}
              preferReader={isTablet}
              idempotencyKey={saleId}
              disabled={saving || (lines.length === 0 && products.length === 0)}
              onPaid={(piId) => settle('card', { stripePaymentIntentId: piId })}
            />
          ) : (
            <View style={styles.cardDisabled}><Text style={styles.cardDisabledText}>💳 Card — connect a reader (Stripe Terminal)</Text></View>
          )}
          <TouchableOpacity style={styles.cashBtn} onPress={() => { setCashStr(''); setStage(local ? 'handback' : 'cash'); }} disabled={saving}>
            <Text style={styles.cashBtnText}>💵 Pay with cash</Text>
          </TouchableOpacity>
        </>
      )}

      {stage === 'handback' && !paid && (
        <View style={styles.handback}>
          <Text style={styles.handbackEmoji}>🙏</Text>
          <Text style={styles.handbackTitle}>Thank you!</Text>
          <Text style={styles.handbackBody}>Please hand the device back to {staffName || 'the staff member'} to finish your cash payment.</Text>
          <TouchableOpacity style={styles.handbackBtn} onPress={() => setStage('cash')} activeOpacity={0.85}>
            <Text style={styles.handbackBtnText}>OK</Text>
          </TouchableOpacity>
        </View>
      )}

      {stage === 'cash' && !paid && (() => {
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
              <TouchableOpacity style={[styles.confirmBtn, (saving || change < 0) && { opacity: 0.5 }]} disabled={saving || change < 0} onPress={() => settle('cash', { cashTendered: tendered })}>
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
  splitNote: { fontSize: 12, color: t.textMuted, marginTop: 8, lineHeight: 17 },
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
  receiptInput: { backgroundColor: t.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 17, color: t.text, borderWidth: 1, borderColor: t.border },
  totals:   { backgroundColor: t.surface, borderRadius: 16, padding: 18, marginTop: 24, borderWidth: 1, borderColor: t.border },
  totRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  totLabel: { fontSize: 15, color: t.textMuted },
  totValue: { fontSize: 15, fontWeight: '700', color: t.text },
  totLabelBig:{ fontSize: 19, fontWeight: '800', color: t.text },
  totValueBig:{ fontSize: 24, fontWeight: '800', color: t.green },
  divider:  { height: 1, backgroundColor: t.border, marginVertical: 9 },
  offlineNote:{ marginTop: 10, backgroundColor: t.warnBg || t.surfaceAlt, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: t.warn || t.borderStrong },
  offlineText:{ fontSize: 13, color: t.text, lineHeight: 18, textAlign: 'center' },
  cardDisabled:{ marginTop: 14, borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: t.border, backgroundColor: t.surfaceAlt },
  cardDisabledText:{ color: t.textFaint, fontWeight: '700', fontSize: 14 },
  cofBtn:   { marginTop: 14, backgroundColor: t.blueSoft, borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: t.blue },
  cofBtnText:{ color: t.blue, fontWeight: '800', fontSize: 15 },
  cashBtn:  { marginTop: 12, backgroundColor: t.surface, borderRadius: 14, paddingVertical: 17, alignItems: 'center', borderWidth: 1, borderColor: t.border },
  cashBtnText:{ color: t.text, fontWeight: '800', fontSize: 16 },
  cashPane: { marginTop: 18 },
  handback:      { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  handbackEmoji: { fontSize: 56, marginBottom: 12 },
  handbackTitle: { fontSize: 26, fontWeight: '800', color: t.text, marginBottom: 8 },
  handbackBody:  { fontSize: 16, color: t.textMuted, textAlign: 'center', lineHeight: 23, marginBottom: 28 },
  handbackBtn:   { backgroundColor: t.green, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 56, alignItems: 'center' },
  handbackBtnText:{ color: '#fff', fontWeight: '800', fontSize: 17 },
  cashInputRow:{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: t.border },
  cashDollar:{ fontSize: 26, color: t.textMuted, fontWeight: '700' },
  cashInput:{ flex: 1, fontSize: 30, fontWeight: '800', color: t.text, paddingVertical: 14, marginLeft: 6 },
  change:   { fontSize: 20, fontWeight: '800', color: t.success, marginTop: 14, textAlign: 'center' },
  cashActions:{ flexDirection: 'row', gap: 12, marginTop: 20 },
  backBtn:  { paddingHorizontal: 20, paddingVertical: 16, borderRadius: 14, backgroundColor: t.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  backBtnText:{ color: t.textMuted, fontWeight: '800', fontSize: 15 },
  confirmBtn:{ flex: 1, backgroundColor: t.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  confirmBtnText:{ color: '#fff', fontWeight: '800', fontSize: 17 },
  okBtn:    { marginTop: 14, backgroundColor: t.green, borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  okBtnText:{ color: '#fff', fontWeight: '800', fontSize: 18 },
  confirmHint:{ fontSize: 13, color: t.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 19, paddingHorizontal: 8 },
  doneBtn:  { marginTop: 26, backgroundColor: t.green, borderRadius: 24, paddingVertical: 13, paddingHorizontal: 44 },
  doneBtnText:{ color: '#fff', fontWeight: '800', fontSize: 16 },
  resendBox:{ width: '100%', maxWidth: 380, marginTop: 22 },
  resendLabel:{ fontSize: 13, fontWeight: '700', color: t.textMuted, textAlign: 'center', marginBottom: 4 },
  settling: { marginTop: 18, backgroundColor: t.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: t.border, alignItems: 'center', gap: 10 },
  settlingText:{ fontSize: 16, fontWeight: '700', color: t.text },
  settlingErr: { fontSize: 15, fontWeight: '800', color: t.danger, textAlign: 'center' },
  settlingErrSub:{ fontSize: 13, color: t.textMuted, textAlign: 'center' },
  retryBtn: { marginTop: 6, backgroundColor: t.green, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28 },
  retryBtnText:{ color: '#fff', fontWeight: '800', fontSize: 15 },
  settlingNote:{ fontSize: 11.5, color: t.textFaint, textAlign: 'center', marginTop: 2 },
});
