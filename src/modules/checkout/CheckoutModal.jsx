import { useState, useEffect } from 'react';
import { saveAppointment, fetchClient, saveClient, redeemLoyaltyPoints,
         fetchGiftCardByCode, fetchGiftCardsByContact, updateGiftCard, createGiftCard,
         fetchPromoByCode, savePromoCode, createReceipt,
         fetchProducts, saveProduct, createReviewRequest,
         fetchClientMembership, fetchAttendance,
         setCheckoutSession, subscribeCheckoutSession, clearCheckoutSession, getCheckoutSession } from '../../lib/firestore';
import { resolveLoyaltyConfig, redeemableLoyalty } from '../../lib/loyalty';
import { buildKioskHandoff, kioskHandoffAvailable, genSessionToken } from '../../lib/kioskHandoff';
import { isSalonOpenNow, offClockTechNames, attendanceKey } from '../../lib/shiftGate';
import { logActivity } from '../../lib/logger';
import { subscribeLocations, currentLocationId, locationTaxRate } from '../../lib/locations';
import { applyTurnCredit } from '../../lib/turnCredit';
import { resolveTurnMode } from '../../lib/turnValue';
import { defaultWalkIn } from '../reports/metrics';
import { useApp } from '../../context/AppContext';
import { escapeHtml, genUrlSafeToken } from '../../utils/helpers';
import { TENANT_ID } from '../../lib/tenant';
import RebookPrompt from './RebookPrompt';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { callFn } from '../../lib/firebase';

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

const PAYMENT_METHODS = [
  { id: 'cash',  label: 'Cash',  icon: '💵' },
  { id: 'card',  label: 'Card',  icon: '💳' },
];

const DISCOUNT_TYPES = [
  { id: null,      label: 'None'  },
  { id: 'member',  label: 'Member',isPercent: true,  hint: '%', default: 10 },
  { id: 'ff',      label: 'F&F',   isPercent: true,  hint: '%', default: 20 },
  { id: 'percent', label: '% Off', isPercent: true,  hint: '%', default: 10 },
  { id: 'fixed',   label: '$ Off', isPercent: false, hint: '$', default: 5  },
];

const QUICK_TIP_PCTS = [15, 18, 20, 25];

export default function CheckoutModal(props) {
  return (
    <Elements stripe={stripePromise}>
      <CheckoutInner {...props} />
    </Elements>
  );
}

function CheckoutInner({ appts: apptsProp, appt, walkInClient = null, initialProducts = null, initialGcSales = null, onComplete, onClose, techs = [] }) {
  const { settings, isOnline, isAdmin, showToast, gUser, hasFeature } = useApp();
  // Tax follows the location the sale is rung up at (the current-location
  // switcher); falls back to the tenant-wide rate for single-location tenants
  // or a location with no override. While locations load, the fallback applies.
  const [locState, setLocState] = useState(null);
  useEffect(() => subscribeLocations(setLocState), []);
  const taxRate    = locationTaxRate(locState, currentLocationId(), settings.taxRate ?? 0);
  const ccFeePct   = Number(settings.ccFeePct ?? 0);
  const ccFeeFlat  = Number(settings.ccFeeFlat ?? 0);
  const noCardTips = !!settings.noCardTips;
  // Cards can only be taken once the salon's Stripe Connect account can accept
  // charges (createPaymentIntent routes funds there and refuses otherwise).
  const connectReady = !!settings?.stripeConnect?.chargesEnabled;
  // Backward-compat: if a single `appt` prop is passed, normalize to an array.
  const appts = apptsProp || (appt ? [appt] : []);
  const isWalkInRetail = appts.length === 0;

  // Flatten every appt's services into a single array of editable lines so the
  // existing per-row UI keeps working. Each entry remembers which appt + svc
  // index it belongs to, so we can rebuild the per-appt services arrays at save time.
  // Memo via initial useState — these don't need to be recomputed mid-checkout.
  const [serviceLines] = useState(() => {
    const lines = [];
    appts.forEach((a, ai) => {
      (a.services || []).forEach((s, si) => {
        lines.push({
          apptIdx: ai, svcIdx: si,
          name: s.name,
          defaultPrice: s.price,
          defaultTech: s.techName || a.techName || '',
          // Default to taxable when the flag isn't on the service entry
          // (legacy data from before the per-service taxable toggle).
          taxable: s.taxable !== false,
        });
      });
    });
    return lines;
  });

  // Primary client for receipt/credit lookups: the first non-walk-in client encountered.
  const primaryAppt = appts[0] || null;
  const primaryClient = isWalkInRetail
    ? walkInClient
    : { id: primaryAppt?.clientId, name: primaryAppt?.clientName, email: null };

  // Walk-in vs scheduled — defaulted from the appointment's booking lead time
  // (booked the same day it happens = walk-in), staff can flip it. Stamped on
  // the receipt so Reports can count walk-ins. Retail-only sales aren't visits.
  const hasServiceVisit = appts.length > 0;
  const [isWalkIn, setIsWalkIn] = useState(() =>
    hasServiceVisit && defaultWalkIn(primaryAppt?.createdAt, primaryAppt?.date));

  const stripe   = useStripe();
  const elements = useElements();
  const [prices,       setPrices]       = useState(serviceLines.map(l => String(l.defaultPrice ?? '')));
  const [techNames,    setTechNames]    = useState(serviceLines.map(l => l.defaultTech));
  const [discountType, setDiscountType] = useState(null);
  const [discountValue,setDiscountValue]= useState('');
  const [promoInput,   setPromoInput]   = useState('');
  const [promo,        setPromo]        = useState(null);
  const [promoErr,     setPromoErr]     = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [gcInput,      setGcInput]      = useState('');
  const [giftCard,     setGiftCard]     = useState(null);
  const [gcErr,        setGcErr]        = useState('');
  const [gcLoading,    setGcLoading]    = useState(false);
  const [applyGC,      setApplyGC]      = useState(true);
  const [gcSearchOpen, setGcSearchOpen] = useState(false);
  const [gcQ,          setGcQ]          = useState('');
  const [gcResults,    setGcResults]    = useState(null);
  const [gcSearching,  setGcSearching]  = useState(false);
  const [clientCredit, setClientCredit] = useState(0);
  const [clientPoints, setClientPoints] = useState(0);
  const [applyLoyalty, setApplyLoyalty] = useState(false);
  const [savedPm,      setSavedPm]      = useState(null);   // client's card on file (Stripe pm), if any
  const [saleId]       = useState(() => genUrlSafeToken(24)); // stable idempotency key for a card-on-file charge
  const [membership,   setMembership]   = useState(null);   // active membership for primaryClient (or null)
  const [memberDiscountApplied, setMemberDiscountApplied] = useState(false);
  const [applyCredit,  setApplyCredit]  = useState(false);
  const [tip,          setTip]          = useState('');     // dollar amount when customTip is on
  const [tipPct,       setTipPct]       = useState(null);    // selected percentage (null = none)
  const [customTip,    setCustomTip]    = useState(false);
  const [perTechMode,  setPerTechMode]  = useState(false);  // tip each tech individually (multi-tech only)
  const [perTechTips,  setPerTechTips]  = useState({});     // { techName: '12.00' }
  const [method,       setMethod]       = useState(() => {
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    return (offline || !settings?.stripeConnect?.chargesEnabled) ? 'cash' : 'card';
  });
  const [cartItems,    setCartItems]    = useState(() => Array.isArray(initialProducts) ? initialProducts : []);
  const [allProducts,  setAllProducts]  = useState(null);
  const [showPicker,   setShowPicker]   = useState(false);
  // [{ id, code, amount, recipientName, recipientEmail, recipientPhone?, purchaserName?, purchaserPhone?, note? }]
  // Seeded from initialGcSales when a gift-card purchase is sent here from the
  // Gift Cards admin (the card is created only after this sale is paid).
  const [gcSales,      setGcSales]      = useState(() => Array.isArray(initialGcSales) ? initialGcSales : []);
  const [showGcSale,   setShowGcSale]   = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [receipt,      setReceipt]      = useState(null);
  const [cardError,    setCardError]    = useState('');
  const [gateError,    setGateError]    = useState('');
  const [keyedCard,    setKeyedCard]    = useState(false);   // card: type here instead of kiosk handoff
  const [cashHere,     setCashHere]     = useState(false);   // cash: take it here instead of the kiosk
  const [sent,         setSent]         = useState(null);    // { sessionId, total, flow } while waiting at the kiosk
  const [cashConfirmed,setCashConfirmed]= useState(false);   // kiosk confirmed the cash bill+tip → finalize on web
  const [kioskReceiptPhone, setKioskReceiptPhone] = useState(null); // receipt contact the client typed at the kiosk
  const [kioskReceiptEmail, setKioskReceiptEmail] = useState(null);

  useEffect(() => {
    if (primaryClient?.id) {
      fetchClient(primaryClient.id).then(c => {
        const cr = Number(c?.credit) || 0;
        setClientCredit(cr);
        if (cr > 0) setApplyCredit(true);
        setClientPoints(Number(c?.loyaltyPoints) || 0);
        setSavedPm(c?.paymentMethods?.find(p => p.id === c.defaultPaymentMethodId) || c?.paymentMethods?.[0] || null);
      }).catch(() => {});
      fetchClientMembership(primaryClient.id).then(m => {
        setMembership(m);
        // Auto-apply the member discount once when the modal opens.
        if (m && m.status === 'active' && Number(m.discountPct) > 0 && !memberDiscountApplied) {
          setDiscountType('member');
          setDiscountValue(String(m.discountPct));
          setMemberDiscountApplied(true);
        }
      }).catch(() => {});
    }
  }, [primaryClient?.id]); // eslint-disable-line

  // When a cash-review sale records on the web (receipt shown), clear the kiosk
  // session so the iPad returns to its idle TipFlow from the "pay at front desk"
  // screen. Only for the kiosk-confirmed path — never touch an unrelated session.
  useEffect(() => {
    if (receipt && cashConfirmed) clearCheckoutSession().catch(() => {});
  }, [receipt]); // eslint-disable-line

  // While finalizing a cash-review sale, keep listening for the receipt contact
  // the client types at the kiosk, so complete() can send the receipt there.
  useEffect(() => {
    if (!cashConfirmed) return;
    const unsub = subscribeCheckoutSession((d) => {
      if (d && d.confirmedReceiptPhone) setKioskReceiptPhone(d.confirmedReceiptPhone);
      if (d && d.confirmedReceiptEmail) setKioskReceiptEmail(d.confirmedReceiptEmail);
    });
    return () => { try { unsub && unsub(); } catch { /* noop */ } };
  }, [cashConfirmed]);

  // ── Math ───────────────────────────────────────────────
  const productsTotal = cartItems.reduce((s, item) => s + (item.product.price || 0) * item.qty, 0);
  const gcSalesTotal  = gcSales.reduce((s, g) => s + (Number(g.amount) || 0), 0);
  const subtotal = prices.reduce((s, p) => s + (Number(p) || 0), 0) + productsTotal + gcSalesTotal;

  const discountDef    = DISCOUNT_TYPES.find(d => d.id === discountType);
  const discountAmount = (() => {
    if (!discountType || !discountValue) return 0;
    const v = Number(discountValue) || 0;
    return discountDef.isPercent
      ? Math.round(subtotal * v / 100 * 100) / 100
      : Math.min(v, subtotal);
  })();

  const promoAmount = (() => {
    if (!promo) return 0;
    return promo.type === 'percent'
      ? Math.round(subtotal * (promo.value || 0) / 100 * 100) / 100
      : Math.min(promo.value || 0, subtotal);
  })();

  const afterDiscounts = Math.max(subtotal - discountAmount - promoAmount, 0);

  // Tax — computed on the post-discount taxable base.
  // Services and retail products are taxable by default; gift card sales
  // and any service explicitly flagged taxable:false (e.g. cancellation
  // fees, no-show fees) are not.
  const nonTaxableServiceTotal = serviceLines.reduce((s, line, i) =>
    line.taxable === false ? s + (Number(prices[i]) || 0) : s, 0);
  const taxableSubtotal  = Math.max(subtotal - gcSalesTotal - nonTaxableServiceTotal, 0);
  const taxableShare     = subtotal > 0 ? taxableSubtotal / subtotal : 0;
  const taxableAfterDisc = Math.max(taxableSubtotal - (discountAmount + promoAmount) * taxableShare, 0);
  const taxAmt           = Math.round(taxableAfterDisc * taxRate) / 100;

  // Service revenue per tech → default proportional tip split + the optional
  // per-tech tip fields (2+ techs only).
  const techRevenue = (() => {
    const m = {};
    serviceLines.forEach((line, i) => { const t = techNames[i] || line.techName || ''; m[t] = (m[t] || 0) + (Number(prices[i]) || 0); });
    return m;
  })();
  const multiTech = Object.keys(techRevenue).length > 1;
  const tipByTech = perTechMode
    ? Object.keys(techRevenue).map(t => ({ techName: t, amount: Number(perTechTips[t]) || 0 }))
    : null;

  const billBeforeTip  = afterDiscounts + taxAmt;
  const tipsDisabled   = method === 'card' && noCardTips;
  const tipAmt         = tipsDisabled ? 0
    : perTechMode
      ? Math.round((tipByTech || []).reduce((s, t) => s + t.amount, 0) * 100) / 100
    : customTip
      ? (Number(tip) || 0)
      : (tipPct ? Math.round(subtotal * tipPct) / 100 : 0);
  const gcApply        = giftCard && applyGC ? Math.min(giftCard.balance, billBeforeTip) : 0;
  const creditApply    = applyCredit && clientCredit > 0
    ? Math.min(clientCredit, billBeforeTip - gcApply)
    : 0;
  // Loyalty redemption — gated on the Marketing-Pack `loyalty` cap + the salon
  // enabling it. Redeems whole points against what's left after gift card/credit.
  const loyCfg         = resolveLoyaltyConfig(settings);
  const loyaltyOn      = !!hasFeature?.('loyalty') && loyCfg.enabled;
  const loyaltyPreview = loyaltyOn
    ? redeemableLoyalty(loyCfg, clientPoints, billBeforeTip - gcApply - creditApply)
    : { redeemPts: 0, dollars: 0 };
  const loyaltyPts     = applyLoyalty ? loyaltyPreview.redeemPts : 0;
  const loyaltyApply   = applyLoyalty ? loyaltyPreview.dollars   : 0;
  const charged        = Math.max(billBeforeTip - gcApply - creditApply - loyaltyApply, 0);
  const total          = charged + tipAmt;
  const ccFee          = method === 'card' && total > 0
    ? Math.round((total * ccFeePct / 100 + ccFeeFlat) * 100) / 100
    : 0;

  // Card on web is taken at the front-desk kiosk (the iPad/M2 reader) — the web
  // can't run the Bluetooth reader. Default to the kiosk handoff; keep keyed
  // entry as a fallback (and force it when promo/gift cards are present, which
  // don't round-trip to the kiosk yet).
  const kioskAvail   = kioskHandoffAvailable({ promo, giftCard, gcSales });
  const cardViaKiosk = method === 'card' && kioskAvail && !keyedCard;
  // Cash also routes through the kiosk so the client reviews the bill + adds a
  // tip; the kiosk confirms and the WEB collects the cash + records the sale.
  const cashViaKiosk = method === 'cash' && kioskAvail && !cashHere;
  const viaKiosk     = cardViaKiosk || cashViaKiosk;

  // ── Product cart ───────────────────────────────────────
  async function openProductPicker() {
    if (!allProducts) {
      const prods = await fetchProducts().catch(() => []);
      setAllProducts(prods.filter(p => p.active !== false && (p.stock || 0) > 0));
    }
    setShowPicker(true);
  }

  function addToCart(product) {
    setCartItems(items => {
      const existing = items.find(i => i.product.id === product.id);
      if (existing) return items.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      return [...items, { product, qty: 1 }];
    });
  }

  function setCartQty(productId, qty) {
    if (qty < 1) { setCartItems(items => items.filter(i => i.product.id !== productId)); return; }
    setCartItems(items => items.map(i => i.product.id === productId ? { ...i, qty } : i));
  }

  // ── Actions ────────────────────────────────────────────
  function pickDiscount(id) {
    const def = DISCOUNT_TYPES.find(d => d.id === id);
    setDiscountType(id);
    setDiscountValue(id && def.default ? String(def.default) : '');
  }

  function pickTipPct(pct) { setTipPct(pct); setCustomTip(false); setTip(''); setPerTechMode(false); }
  function pickCustomTip()  { setCustomTip(true); setTipPct(null); setTip(''); setPerTechMode(false); }
  function pickPerTech()    { setPerTechMode(true); setCustomTip(false); setTipPct(null); setTip(''); }

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code) return;
    setPromoLoading(true); setPromoErr(''); setPromo(null);
    try {
      const p = await fetchPromoByCode(code);
      if (!p)         { setPromoErr('Code not found.'); return; }
      if (!p.active)  { setPromoErr('Code is no longer active.'); return; }
      const today = new Date().toISOString().slice(0, 10);
      if (p.startDate && today < p.startDate) { setPromoErr('Code is not yet active.'); return; }
      if (p.endDate   && today > p.endDate)   { setPromoErr('Code has expired.'); return; }
      if (p.maxUses   && (p.usedCount || 0) >= p.maxUses) { setPromoErr('Code has reached its maximum uses.'); return; }
      if (p.singleUse && p.usedAt)    { setPromoErr('Code has already been used.'); return; }
      // Personalized codes are bound to a specific client. Block anyone
      // else from redeeming, even if the code is otherwise valid.
      if (p.clientId && p.clientId !== primaryClient?.id) {
        setPromoErr('This code is reserved for a different client.');
        return;
      }
      setPromo(p);
    } catch { setPromoErr('Lookup failed.'); }
    finally  { setPromoLoading(false); }
  }

  function applyFoundGiftCard(gc) {
    if (!gc)             { setGcErr('Gift card not found.'); return; }
    if (gc.balance <= 0) { setGcErr('Gift card has no remaining balance.'); return; }
    setGiftCard(gc); setApplyGC(true); setGcInput(gc.code || ''); setGcErr('');
    setGcSearchOpen(false); setGcQ(''); setGcResults(null);
  }
  async function applyGiftCard() {
    const code = gcInput.trim();
    if (!code) return;
    setGcLoading(true); setGcErr(''); setGiftCard(null);
    try { applyFoundGiftCard(await fetchGiftCardByCode(code)); }
    catch { setGcErr('Lookup failed.'); }
    finally  { setGcLoading(false); }
  }
  async function searchGiftCards() {
    const q = gcQ.trim();
    if (q.length < 2) return;
    setGcSearching(true);
    try { setGcResults(await fetchGiftCardsByContact(q)); }
    catch { setGcResults([]); }
    finally { setGcSearching(false); }
  }

  // Hand a sale off to the front-desk kiosk. flow='card' → the iPad takes the
  // card on the M2 and records the sale. flow='cashReview' → the iPad shows the
  // bill + tip + "Is this correct?", then the WEB finalizes the cash sale.
  async function sendToKiosk(flow = 'card') {
    if (saving) return;
    setSaving(true); setGateError('');
    if (!isAdmin && isSalonOpenNow(settings)) {
      try {
        const att = await fetchAttendance(attendanceKey());
        const missing = offClockTechNames(techNames, att);
        if (missing.length) {
          const msg = `Not clocked in: ${missing.join(', ')}. ${missing.length > 1 ? 'These techs' : 'This tech'} must clock in at the Time Clock before checkout.`;
          setGateError(msg); showToast && showToast(msg, 6000); setSaving(false); return;
        }
      } catch { /* fail open — workflow nudge, not security */ }
    }
    try {
      const sessionId = genSessionToken(16);
      const payload = buildKioskHandoff({
        appts, serviceLines, prices, techNames, cartItems,
        discountAmount, applyCredit, creditApplied: creditApply, primaryClient,
        createdBy: gUser?.email || null, sessionId, flow,
      });
      await setCheckoutSession(payload);
      setSaving(false);
      setSent({ sessionId, total, flow });
    } catch (e) {
      setSaving(false);
      showToast && showToast('Could not send to the kiosk: ' + (e?.message || 'try again'));
    }
  }

  // Kiosk confirmed the cash bill + tip → apply that tip to the web's totals so
  // complete() records it, then show the "collect the cash" finalize screen.
  function handleCashConfirmed(confirmedTip) {
    const amt = Math.max(0, Number(confirmedTip?.amount) || 0);
    const byTech = Array.isArray(confirmedTip?.byTech) ? confirmedTip.byTech : null;
    if (byTech && byTech.length > 1) {
      setPerTechMode(true);
      const m = {};
      byTech.forEach(t => { if (t && t.techName != null) m[t.techName] = String(Number(t.amount) || 0); });
      setPerTechTips(m);
    } else {
      setPerTechMode(false);
      setCustomTip(true);
      setTip(String(amt));
    }
    setSent(null);
    setCashConfirmed(true);
  }

  async function complete(opts = {}) {
    setSaving(true);
    setCardError('');
    setGateError('');

    // Clock-in gate: while the salon is open ("on shift"), every tech credited
    // on this sale must be clocked in before the sale can be rung up. Admins are
    // exempt; off-shift (salon closed) the gate doesn't apply. Workflow guard,
    // not a security boundary — the server still authorizes the writes.
    if (!isAdmin && isSalonOpenNow(settings)) {
      try {
        const att = await fetchAttendance(attendanceKey());
        const missing = offClockTechNames(techNames, att);
        if (missing.length) {
          const msg = `Not clocked in: ${missing.join(', ')}. ${missing.length > 1 ? 'These techs' : 'This tech'} must clock in at the Time Clock before checkout.`;
          setGateError(msg);
          showToast && showToast(msg, 6000);
          setSaving(false);
          return;
        }
      } catch {
        // If attendance can't be read, fail open rather than block a paying
        // customer at the register — the gate is a workflow nudge, not security.
      }
    }

    let stripePaymentIntentId = null;

    // Build a friendly description for Stripe + the receipt header.
    const clientNames = isWalkInRetail
      ? [walkInClient?.name || 'Walk-in retail']
      : Array.from(new Set(appts.map(a => a.clientName || 'Walk-in').filter(Boolean)));
    const combinedClientLabel = clientNames.join(' + ');

    if (method === 'card' && charged > 0 && opts.onFile && savedPm) {
      // Charge the client's card on file (off-session) instead of a keyed/kiosk card.
      try {
        const res = await callFn('chargeStoredCard')({
          tenantId: TENANT_ID, clientId: primaryClient?.id, amount: Math.round(total * 100),
          description: combinedClientLabel, paymentMethodId: savedPm.id, idempotencyKey: saleId,
        });
        if (res.data?.status !== 'succeeded') {
          setCardError(`Card on file ${res.data?.status || 'declined'}.`); setSaving(false); return;
        }
        stripePaymentIntentId = res.data.paymentIntentId;
      } catch (e) {
        setCardError(e?.message || 'Card on file failed.'); setSaving(false); return;
      }
    } else if (method === 'card' && charged > 0 && stripe && elements) {
      try {
        const res = await callFn('createPaymentIntent')({
          tenantId: TENANT_ID,
          amountCents: Math.round(total * 100),
          description: combinedClientLabel,
        });
        const { error: stripeErr, paymentIntent } = await stripe.confirmCardPayment(
          res.data.clientSecret,
          { payment_method: { card: elements.getElement(CardElement) } }
        );
        if (stripeErr) {
          setCardError(stripeErr.message || 'Card declined.');
          setSaving(false);
          return;
        }
        stripePaymentIntentId = paymentIntent.id;
      } catch (e) {
        setCardError(e?.message || 'Card processing failed.');
        setSaving(false);
        return;
      }
    }

    try {
      // Reconstruct each appointment's services array with edited prices/techs.
      // Per-appt subtotal is each service's edited price summed, used for revenue split.
      const updatedByAppt = appts.map((a, ai) => {
        const svc = (a.services || []).map((s, si) => {
          const flatIdx = serviceLines.findIndex(l => l.apptIdx === ai && l.svcIdx === si);
          return {
            ...s,
            price: Number(prices[flatIdx]) || 0,
            techName: techNames[flatIdx] || a.techName || '',
          };
        });
        return { appt: a, services: svc };
      });

      // Flat list of all updated service lines for receipt + tech split.
      const allUpdatedServices = updatedByAppt.flatMap(g => g.services);

      // Per-tech revenue split across all appts.
      const splitMap = {};
      allUpdatedServices.forEach(s => {
        const t = s.techName || '';
        if (!splitMap[t]) splitMap[t] = { revenue: 0, services: [] };
        splitMap[t].revenue += s.price;
        splitMap[t].services.push(s.name || '—');
      });
      const splitEntries = Object.entries(splitMap);
      const totalServiceRev = splitEntries.reduce((s, [, d]) => s + d.revenue, 0);
      let techSplit = null;
      if (splitEntries.length > 1) {
        if (perTechMode) {
          // Customer tipped each tech a specific amount — use verbatim.
          const m = {};
          (tipByTech || []).forEach(t => { const k = t.techName || ''; m[k] = (m[k] || 0) + (Number(t.amount) || 0); });
          techSplit = splitEntries.map(([techName, d]) => {
            const tipShare = Math.round((m[techName] || 0) * 100) / 100;
            return { techName, revenue: d.revenue, services: d.services, tipShare, tip: tipShare };
          });
        } else {
          // Default: allocate tip across techs by service-revenue ratio.
          // Last entry absorbs any rounding remainder so shares sum exactly to tipAmt.
          let tipAllocated = 0;
          techSplit = splitEntries.map(([techName, d], i) => {
            const ratio = totalServiceRev > 0 ? d.revenue / totalServiceRev : 1 / splitEntries.length;
            let tipShare;
            if (i === splitEntries.length - 1) tipShare = Math.round((tipAmt - tipAllocated) * 100) / 100;
            else { tipShare = Math.round(ratio * tipAmt * 100) / 100; tipAllocated += tipShare; }
            return { techName, revenue: d.revenue, services: d.services, tipShare, tip: tipShare };
          });
        }
      }

      const retailProducts = cartItems.length > 0
        ? cartItems.map(i => ({ id: i.product.id, name: i.product.name, price: i.product.price, qty: i.qty }))
        : null;

      // Persist any sold gift cards as real records so the codes work for redemption.
      // The buyer is whoever is being checked out — stamp them on each card so it's
      // findable later by purchaser as well as recipient.
      const buyerName  = combinedClientLabel && !/^walk-?in/i.test(combinedClientLabel) ? combinedClientLabel : null;
      const buyerPhone = walkInClient?.phone?.trim() || primaryAppt?.clientPhone || null;
      const giftCardsSold = [];
      for (const g of gcSales) {
        try {
          const id = await createGiftCard({
            code: g.code.toUpperCase(),
            balance: g.amount,
            // Write both initialBalance (admin-issued shape, drives the list's
            // balance bar) and originalAmount so cards are identical regardless
            // of whether they were sold at the POS or from the Gift Cards admin.
            initialBalance: g.amount,
            originalAmount: g.amount,
            recipientName:  g.recipientName || null,
            recipientEmail: g.recipientEmail || null,
            recipientPhone: g.recipientPhone || null,
            issuedTo:       g.recipientName || null,
            // Prefer the gift sale's own purchaser fields (the admin form
            // collects them); fall back to the client being checked out.
            purchaserName:  g.purchaserName || buyerName,
            purchaserPhone: g.purchaserPhone || buyerPhone,
            note:           g.note || null,
            soldAt: new Date().toISOString(),
            soldVia: 'checkout',
            active: true,
            voided: false,
          });
          giftCardsSold.push({ id, code: g.code.toUpperCase(), amount: g.amount, recipientName: g.recipientName || null, recipientEmail: g.recipientEmail || null });
        } catch (e) {
          console.warn('[Checkout] gift card create failed:', e);
        }
      }

      const payment = {
        subtotal,
        discountType:   discountType || null,
        discountValue:  Number(discountValue) || 0,
        discountAmount,
        promoCode:      promo ? promo.code : null,
        promoAmount,
        tax:            taxAmt,
        taxRate,
        giftCard:       giftCard && applyGC && gcApply > 0
          ? { code: giftCard.code, id: giftCard.id, applied: gcApply }
          : null,
        creditApplied:  creditApply,
        loyaltyRedeemed: loyaltyApply,
        loyaltyPointsUsed: loyaltyPts,
        charged,
        tip:            tipAmt,
        total,
        method,
        ccFee,
        ccFeePct,
        ccFeeFlat,
        techSplit,
        retailProducts,
        giftCardsSold:  giftCardsSold.length > 0 ? giftCardsSold : null,
        gcSalesTotal,
        apptIds:        appts.map(a => a.id),
        paidAt:         new Date().toISOString(),
        ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
      };

      // Save each appointment marked done with its share of the payment.
      // amountForThisAppt = sum of its updated service prices, so revenue reports per-appt stay accurate.
      for (const g of updatedByAppt) {
        const apptSubtotal = g.services.reduce((s, sv) => s + (sv.price || 0), 0);
        const { id, createdAt, ...data } = g.appt;
        const wasNotDone = g.appt.status !== 'done';
        await saveAppointment(id, {
          ...data,
          services: g.services,
          status: 'done',
          payment: { ...payment, amountForThisAppt: apptSubtotal },
        });
        // Turn credit: +1 for every completed appt (Mango POS model).
        // applyTurnCredit checks the _turnCredited flag so walk-ins seated
        // via the queue's 🎯 Next button don't double-count.
        if (wasNotDone) {
          applyTurnCredit({ ...g.appt, id, status: 'done' }, resolveTurnMode(settings)).then(applied => {
            if (applied) logActivity('turn_credit', `${g.appt.techName} +1 via checkout (${g.appt.clientName || 'walk-in'})`);
          });
        }
      }

      const techLabel = techSplit ? techSplit.map(t => t.techName).join(', ') : (allUpdatedServices[0]?.techName || 'unknown');
      logActivity('checkout_complete',
        `${combinedClientLabel}${appts.length > 1 ? ` (${appts.length} appts)` : ''}${retailProducts ? ` · ${retailProducts.length} product${retailProducts.length > 1 ? 's' : ''}` : ''} · ${techLabel} · $${total.toFixed(2)} via ${method}${discountAmount > 0 ? ` · discount -$${discountAmount.toFixed(2)}` : ''}${promoAmount > 0 ? ` · promo ${promo?.code}` : ''}${gcApply > 0 ? ` · GC -$${gcApply.toFixed(2)}` : ''}${tipAmt > 0 ? ` · tip $${tipAmt.toFixed(2)}` : ''}`);

      // Side effects (single application across the whole bill)
      if (giftCard && applyGC && gcApply > 0) {
        await updateGiftCard(giftCard.id, { balance: Math.max(giftCard.balance - gcApply, 0) });
      }
      if (promo) {
        const newCount = (promo.usedCount || 0) + 1;
        const maxHit   = promo.maxUses && newCount >= promo.maxUses;
        await savePromoCode(promo.id, {
          ...promo,
          usedCount: newCount,
          ...(promo.singleUse || maxHit ? { active: false } : {}),
          ...(promo.singleUse ? { usedAt: new Date().toISOString() } : {}),
        });
      }
      if (cartItems.length > 0) {
        await Promise.all(cartItems.map(async item => {
          const newStock = Math.max(0, (item.product.stock || 0) - item.qty);
          await saveProduct(item.product.id, { ...item.product, stock: newStock }).catch(() => {});
        }));
      }

      // Client-side bookkeeping (credit + receipt email) for the primary client.
      let clientEmail = walkInClient?.email?.trim() || '';
      let clientPhoneOnFile = '';
      if (primaryClient?.id) {
        const c = await fetchClient(primaryClient.id);
        if (c) {
          clientEmail = c.email?.trim() || clientEmail;
          clientPhoneOnFile = (c.phone || '').trim();
          if (creditApply > 0) {
            const newCredit = Math.max((c.credit || 0) - creditApply, 0);
            const { id: cid, createdAt: cc, ...cd } = c;
            await saveClient(cid, { ...cd, credit: newCredit });
          }
          // Loyalty redemption — atomic decrement (own helper), separate from the
          // credit read-modify-write so it can't be clobbered by the earn trigger.
          if (loyaltyPts > 0) {
            await redeemLoyaltyPoints(primaryClient.id, loyaltyPts, saleId).catch(() => {});
          }
        }
      }
      // clientPhone: walk-in tmpPhone OR primary appt's stored phone OR the
      // client record's phone (the appt doesn't always carry it).
      // Drives sendReceiptSms + the receipt screen's prefilled phone field.
      let clientPhone = walkInClient?.phone?.trim() || primaryAppt?.clientPhone || clientPhoneOnFile || null;

      // Cash-review handoff: the client typed where to send their receipt at the
      // kiosk (phone and/or email) — honor both so it sends to each.
      if (kioskReceiptPhone) { const digits = String(kioskReceiptPhone).replace(/[^\d+]/g, ''); if (digits) clientPhone = digits; }
      if (kioskReceiptEmail) { const em = String(kioskReceiptEmail).trim(); if (em.includes('@')) clientEmail = em; }

      // Opaque view token for the hosted /r/{token} receipt page.
      // 22 chars URL-safe ≈ 130 bits; computationally infeasible to guess.
      const viewToken = genUrlSafeToken(22);

      // Always create a receipt — it's the canonical transaction record for
      // Reports. Without it, cash walk-ins without an email would vanish.
      createReceipt({
        clientId:    primaryClient?.id || null,
        clientName:  combinedClientLabel,
        clientEmail: clientEmail || null,
        clientPhone,
        viewToken,
        techName:    techSplit ? techSplit.map(t => t.techName).join(', ') : (allUpdatedServices[0]?.techName || ''),
        date:        primaryAppt?.date || new Date().toISOString().slice(0, 10),
        startTime:   primaryAppt?.startTime || '',
        services:    allUpdatedServices.map(s => ({ name: s.name, price: s.price, techName: s.techName })),
        retailProducts,
        giftCardsSold: giftCardsSold.length > 0 ? giftCardsSold : null,
        walkIn:      hasServiceVisit ? isWalkIn : false,
        apptIds:     payment.apptIds,
        payment,
        locationId:  primaryAppt?.locationId || currentLocationId(),
      }).catch(() => {});

      // For rebook: collect each visit-service with its original id + option,
      // deduped — drives the auto-rebook prompt on the receipt screen.
      const seenSvcKeys = new Set();
      const visitServices = [];
      appts.forEach(a => {
        (a.services || []).forEach(s => {
          if (s.isRemoval || s.id === 'removal') return;
          const key = `${s.id || ''}:${s.optionId || ''}`;
          if (seenSvcKeys.has(key)) return;
          seenSvcKeys.add(key);
          visitServices.push({ id: s.id, optionId: s.optionId || null });
        });
      });

      setReceipt({
        client:         combinedClientLabel,
        clientId:       primaryClient?.id || null,
        clientPhone:    clientPhone || '',
        clientEmail,
        viewToken,
        tech:           techSplit ? techSplit.map(t => t.techName).join(', ') : (allUpdatedServices[0]?.techName || ''),
        primaryTechName: allUpdatedServices[0]?.techName || (techSplit?.[0]?.techName) || '',
        date:           primaryAppt?.date || new Date().toISOString().slice(0, 10),
        services:       allUpdatedServices.map(s => ({ name: s.name, price: s.price, techName: s.techName })),
        visitServices,
        retailProducts,
        payment,
      });
    } catch (e) {
      console.error('[Checkout] save failed:', e);
    } finally {
      setSaving(false);
    }
  }

  // ── Receipt screen ─────────────────────────────────────
  if (receipt) return <ReceiptScreen receipt={receipt} onDone={onComplete} />;
  if (cashConfirmed) return (
    <CashFinalize
      total={total}
      tipAmt={tipAmt}
      saving={saving}
      gateError={gateError}
      onComplete={complete}
      onCancel={() => {
        clearCheckoutSession().catch(() => {});
        setCashConfirmed(false); setCustomTip(false); setTip(''); setPerTechMode(false); setPerTechTips({});
      }}
    />
  );
  if (sent) return (
    <KioskWaiting
      sessionId={sent.sessionId}
      total={sent.total}
      flow={sent.flow}
      onPaid={() => { onComplete?.(); }}
      onCashConfirmed={handleCashConfirmed}
      onCancel={() => { clearCheckoutSession().catch(() => {}); setSent(null); }}
    />
  );

  // ── Render ─────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 480, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderRadius: '16px 16px 0 0', background: 'linear-gradient(135deg,#2D7A5F 0%,#3D95CE 100%)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isWalkInRetail
                ? (walkInClient?.name || 'Walk-in retail')
                : appts.length > 1
                  ? `${primaryAppt?.clientName || 'Walk-in'} + ${appts.length - 1} more`
                  : (primaryAppt?.clientName || 'Walk-in')}
              {membership?.status === 'active' && (
                <span title={`${membership.planName} — ${membership.discountPct}% off`}
                  style={{ marginLeft: 6, fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,.22)', color: '#fff', fontWeight: 700, letterSpacing: '.05em', verticalAlign: 'middle' }}>
                  ★ MEMBER
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.75)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isWalkInRetail
                ? 'Retail sale'
                : appts.length > 1
                  ? `${appts.length} appointments`
                  : `${primaryAppt?.techName || ''} · ${primaryAppt?.date ? new Date(primaryAppt.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}`}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.15)', cursor: 'pointer', fontSize: 16, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 8 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

          {/* Walk-in vs scheduled — defaulted by booking lead time, overridable */}
          {hasServiceVisit && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 12, borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', cursor: 'pointer' }}>
              <input type="checkbox" checked={isWalkIn} onChange={e => setIsWalkIn(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>Walk-in</span>
              <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', flex: 1, textAlign: 'right' }}>
                {isWalkIn ? 'Counts as a walk-in' : 'Counts as a scheduled visit'}
              </span>
            </label>
          )}

          {/* Services — single flat list when one appt, grouped per-appt when multiple */}
          {!isWalkInRetail && (
            <Section title={techs.length > 1 ? 'Services & Techs' : 'Services'}>
              {appts.map((a, ai) => {
                const apptLines = serviceLines
                  .map((l, flatIdx) => ({ ...l, flatIdx }))
                  .filter(l => l.apptIdx === ai);
                if (apptLines.length === 0) return null;
                const showHeader = appts.length > 1;
                return (
                  <div key={a.id || ai} style={{ marginBottom: showHeader ? 10 : 0 }}>
                    {showHeader && (
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4, paddingTop: ai > 0 ? 6 : 0 }}>
                        {a.clientName || 'Walk-in'}
                        <span style={{ marginLeft: 6, color: 'var(--pn-text-faint)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· {a.techName || 'TBD'}</span>
                      </div>
                    )}
                    {apptLines.map((l, lidx) => (
                      <div key={l.flatIdx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 0', borderBottom: lidx < apptLines.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
                        <span style={{ fontSize: 13, color: 'var(--pn-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name || '—'}</span>
                        {techs.length > 1 && (
                          <select
                            value={techNames[l.flatIdx] || ''}
                            onChange={e => setTechNames(n => n.map((v, idx) => idx === l.flatIdx ? e.target.value : v))}
                            style={{ fontFamily: 'inherit', fontSize: 11, border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '3px 4px', background: 'var(--pn-bg)', color: 'var(--pn-text-muted)', maxWidth: 90, flexShrink: 0 }}
                          >
                            {techs.map(t => <option key={t} value={t}>{t.split(' ')[0]}</option>)}
                          </select>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>$</span>
                          <input type="number" min={0} value={prices[l.flatIdx]}
                            onChange={e => setPrices(p => p.map((v, idx) => idx === l.flatIdx ? e.target.value : v))}
                            style={{ width: 68, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '4px 6px', fontSize: 13, textAlign: 'right', background: 'var(--pn-bg)', color: 'var(--pn-text)' }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              <SummaryRow label="Services subtotal" value={`$${(subtotal - productsTotal).toFixed(2)}`} bold />
            </Section>
          )}

          {/* Retail Products — persistent section with inline + Add CTA */}
          <Section
            title="Retail / Add-ons"
            action={
              <button onClick={openProductPicker}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--tm-accent, #3D95CE)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '.02em' }}>
                + Add product
              </button>
            }
          >
            {cartItems.length > 0 ? (
              <div>
                {cartItems.map(item => (
                  <div key={item.product.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--pn-border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--pn-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.product.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => setCartQty(item.product.id, item.qty - 1)} style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 14, color: 'var(--pn-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>−</button>
                      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: 'center' }}>{item.qty}</span>
                      <button onClick={() => setCartQty(item.product.id, item.qty + 1)} disabled={item.qty >= (item.product.stock || 0)} style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', cursor: item.qty < (item.product.stock || 0) ? 'pointer' : 'default', fontSize: 14, color: item.qty < (item.product.stock || 0) ? 'var(--pn-text-muted)' : 'var(--pn-text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>+</button>
                    </div>
                    <span style={{ fontSize: 13, color: 'var(--pn-text-muted)', width: 56, textAlign: 'right', flexShrink: 0 }}>${(item.product.price * item.qty).toFixed(2)}</span>
                    <button onClick={() => setCartQty(item.product.id, 0)} style={{ fontSize: 15, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--pn-text-faint)', padding: '0 2px', flexShrink: 0 }}>×</button>
                  </div>
                ))}
                <SummaryRow label="Products total" value={`$${productsTotal.toFixed(2)}`} />
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', padding: '4px 2px', lineHeight: 1.5 }}>
                Selling polish, lotion, or a gift card? Tap <strong style={{ color: 'var(--pn-text-muted)' }}>+ Add product</strong> to include it on this bill.
              </div>
            )}
          </Section>

          {/* Gift Card Sales — non-taxable line items */}
          <Section
            title="Sell a gift card"
            action={
              <button onClick={() => setShowGcSale(true)}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '.02em' }}>
                + Sell gift card
              </button>
            }
          >
            {gcSales.length > 0 ? (
              <div>
                {gcSales.map(g => (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--pn-border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--pn-text)', flex: 1, minWidth: 0 }}>
                      🎁 Gift card <span style={{ color: '#7c3aed', fontWeight: 700, fontFamily: 'monospace' }}>{g.code}</span>
                      {g.recipientName && <span style={{ color: 'var(--pn-text-muted)', fontSize: 11 }}> · for {g.recipientName}</span>}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--pn-text-muted)', width: 70, textAlign: 'right', flexShrink: 0, fontWeight: 600 }}>${g.amount.toFixed(2)}</span>
                    <button onClick={() => setGcSales(s => s.filter(x => x.id !== g.id))} style={{ fontSize: 15, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--pn-text-faint)', padding: '0 2px', flexShrink: 0 }}>×</button>
                  </div>
                ))}
                <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 4, fontStyle: 'italic' }}>Gift cards are not taxed. Codes are auto-generated and emailed to the recipient on completion.</div>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', padding: '4px 2px', lineHeight: 1.5 }}>
                Selling a gift card? Tap <strong style={{ color: 'var(--pn-text-muted)' }}>+ Sell gift card</strong>. They're non-taxable and credited to the salon (no tech).
              </div>
            )}
          </Section>

          {showGcSale && (
            <GiftCardSaleModal
              onClose={() => setShowGcSale(false)}
              onAdd={g => { setGcSales(s => [...s, g]); setShowGcSale(false); }}
            />
          )}

          {showPicker && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 400 }}
              onClick={e => { if (e.target === e.currentTarget) setShowPicker(false); }}>
              <div style={{ background: 'var(--pn-surface)', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 480, maxHeight: '60vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Add Retail Product</span>
                  <button onClick={() => setShowPicker(false)} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', cursor: 'pointer', fontSize: 16, color: 'var(--pn-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {!allProducts
                    ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 13 }}>Loading…</div>
                    : allProducts.length === 0
                      ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 13 }}>No products in stock. Add some in the Products module.</div>
                      : allProducts.map((p, i) => {
                          const inCart = cartItems.find(c => c.product.id === p.id);
                          return (
                            <div key={p.id} onClick={() => { addToCart(p); setShowPicker(false); }}
                              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: i < allProducts.length - 1 ? '1px solid var(--pn-border)' : 'none', cursor: 'pointer' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--pn-bg)'}
                              onMouseLeave={e => e.currentTarget.style.background = ''}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>{p.name}</div>
                                {p.brand && <div style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{p.brand}</div>}
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#2D7A5F' }}>${(p.price || 0).toFixed(2)}</div>
                                <div style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>{p.stock} in stock{inCart ? ` · ${inCart.qty} added` : ''}</div>
                              </div>
                            </div>
                          );
                        })
                  }
                </div>
              </div>
            </div>
          )}

          {/* Discount */}
          <Section title="Discount">
            <div style={{ display: 'flex', gap: 6, marginBottom: discountType ? 10 : 0 }}>
              {DISCOUNT_TYPES.map(d => (
                <button key={String(d.id)} onClick={() => pickDiscount(d.id)}
                  style={{ flex: 1, padding: '7px 4px', fontSize: 11, fontWeight: 600, borderRadius: 8, border: `1.5px solid ${discountType === d.id ? '#3D95CE' : 'var(--pn-border)'}`, background: discountType === d.id ? 'var(--pn-info-bg)' : 'var(--pn-bg)', color: discountType === d.id ? 'var(--pn-info)' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {d.label}
                </button>
              ))}
            </div>
            {discountType && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min={0} value={discountValue}
                  onChange={e => setDiscountValue(e.target.value)}
                  placeholder={discountDef?.hint}
                  style={{ flex: 1, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--pn-bg)' }}
                />
                {discountAmount > 0 && <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600, flexShrink: 0 }}>−${discountAmount.toFixed(2)}</span>}
              </div>
            )}
          </Section>

          {/* Promo / Gift Card / Store Credit — tucked behind "More options"
              when the curatedHome flag is on (auto-opens if one is applied). */}
          <MoreOptions enabled={!!hasFeature?.('curatedHome')} openByDefault={!!(promo || giftCard || creditApply > 0 || clientCredit > 0)}>
          {/* Promo code */}
          <Section title="Promo Code">
            {promo ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--pn-success-bg)', borderRadius: 8, border: '1px solid #bbf7d0', padding: '8px 12px' }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-success)' }}>{promo.code}</span>
                  <span style={{ fontSize: 11, color: 'var(--pn-success)', marginLeft: 8 }}>
                    {promo.type === 'percent' ? `${promo.value}% off` : `$${promo.value} off`}
                    {promoAmount > 0 && ` · −$${promoAmount.toFixed(2)}`}
                  </span>
                </div>
                <button onClick={() => { setPromo(null); setPromoInput(''); }} style={{ fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--pn-text-faint)', padding: '0 4px' }}>×</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={promoInput} onChange={e => { setPromoInput(e.target.value); setPromoErr(''); }}
                  onKeyDown={e => e.key === 'Enter' && applyPromo()}
                  placeholder="Enter code…"
                  style={{ flex: 1, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--pn-bg)', textTransform: 'uppercase' }}
                />
                <button onClick={applyPromo} disabled={promoLoading || !promoInput.trim()}
                  style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#3D95CE', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: (!promoInput.trim() || promoLoading) ? .5 : 1 }}>
                  {promoLoading ? '…' : 'Apply'}
                </button>
              </div>
            )}
            {promoErr && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{promoErr}</div>}
          </Section>

          {/* Gift card */}
          <Section title="Gift Card">
            {giftCard ? (
              <div style={{ background: 'var(--pn-success-bg)', borderRadius: 8, border: '1px solid #bbf7d0', padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: gcApply > 0 ? 6 : 0 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-success)' }}>{giftCard.code}</span>
                    <span style={{ fontSize: 11, color: 'var(--pn-success)', marginLeft: 8 }}>Balance: ${giftCard.balance.toFixed(2)}</span>
                  </div>
                  <button onClick={() => { setGiftCard(null); setGcInput(''); }} style={{ fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--pn-text-faint)', padding: '0 4px' }}>×</button>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pn-text-muted)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={applyGC} onChange={e => setApplyGC(e.target.checked)} />
                  Apply ${gcApply > 0 ? gcApply.toFixed(2) : giftCard.balance.toFixed(2)} to this order
                </label>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={gcInput} onChange={e => { setGcInput(e.target.value); setGcErr(''); }}
                    onKeyDown={e => e.key === 'Enter' && applyGiftCard()}
                    placeholder="Gift card code…"
                    style={{ flex: 1, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--pn-bg)', textTransform: 'uppercase' }}
                  />
                  <button onClick={applyGiftCard} disabled={gcLoading || !gcInput.trim()}
                    style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#3D95CE', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: (!gcInput.trim() || gcLoading) ? .5 : 1 }}>
                    {gcLoading ? '…' : 'Apply'}
                  </button>
                  <button onClick={() => { setGcSearchOpen(o => !o); setGcResults(null); setGcQ(''); }}
                    style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                    Find
                  </button>
                </div>
                {gcSearchOpen && (
                  <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--pn-border)', borderRadius: 8, background: 'var(--pn-bg)' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={gcQ} onChange={e => setGcQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchGiftCards()}
                        placeholder="Recipient name, phone, or email…"
                        style={{ flex: 1, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--pn-surface)' }} />
                      <button onClick={searchGiftCards} disabled={gcSearching || gcQ.trim().length < 2}
                        style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#3D95CE', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: (gcSearching || gcQ.trim().length < 2) ? .5 : 1 }}>
                        {gcSearching ? '…' : 'Search'}
                      </button>
                    </div>
                    {gcResults !== null && (gcResults.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginTop: 8 }}>No matching gift cards with a balance.</div>
                    ) : (
                      <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                        {gcResults.map(g => (
                          <button key={g.id} onClick={() => applyFoundGiftCard(g)}
                            style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', border: 'none', borderBottom: '1px solid var(--pn-border)', background: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--pn-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.recipientName || g.code}</span>
                              <span style={{ display: 'block', fontSize: 11, color: 'var(--pn-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.code}{g.recipientPhone ? ` · ${g.recipientPhone}` : ''}{g.recipientEmail ? ` · ${g.recipientEmail}` : ''}</span>
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-success)' }}>${(Number(g.balance) || 0).toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {gcErr && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{gcErr}</div>}
          </Section>

          {/* Client credit */}
          {(clientCredit > 0 || creditApply > 0) && (
            <Section title="Store Credit">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={applyCredit} onChange={e => setApplyCredit(e.target.checked)} />
                <span style={{ color: 'var(--pn-text)' }}>
                  Apply ${Math.min(clientCredit, afterDiscounts - gcApply).toFixed(2)} credit
                  <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginLeft: 6 }}>(balance: ${clientCredit.toFixed(2)})</span>
                </span>
              </label>
            </Section>
          )}

          {/* Loyalty points */}
          {loyaltyOn && clientPoints >= loyCfg.minRedeemPoints && loyaltyPreview.redeemPts > 0 && (
            <Section title="Loyalty Points">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={applyLoyalty} onChange={e => setApplyLoyalty(e.target.checked)} />
                <span style={{ color: 'var(--pn-text)' }}>
                  Redeem {loyaltyPreview.redeemPts} points <strong>(−${loyaltyPreview.dollars.toFixed(2)})</strong>
                  <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginLeft: 6 }}>(balance: {clientPoints} pts)</span>
                </span>
              </label>
            </Section>
          )}
          </MoreOptions>

          {/* Tip is collected on the customer-facing checkout (the front-desk
              kiosk for card; cash tips are handed to the tech directly), so the
              web checkout no longer shows a tip section. */}

          {/* Payment method */}
          <Section title="Payment Method">
            {!isOnline && (
              <div style={{ background: 'var(--pn-warning-bg)', border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--pn-warning)', marginBottom: 10, lineHeight: 1.4 }}>
                <strong>Offline mode.</strong> Card payments need a live connection. Take cash or store credit now — receipt will sync when you're back online.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginBottom: method === 'card' && stripePromise ? 10 : 0 }}>
              {PAYMENT_METHODS.map(m => {
                const isCardOffline   = !isOnline && m.id === 'card';
                const isCardNotSetUp  = m.id === 'card' && isOnline && !connectReady;
                const isCardDisabled  = isCardOffline || isCardNotSetUp;
                return (
                  <button key={m.id} onClick={() => { if (!isCardDisabled) { setMethod(m.id); setCardError(''); } }}
                    disabled={isCardDisabled}
                    title={isCardOffline ? 'Card requires a live network — try cash or store credit'
                         : isCardNotSetUp ? 'Set up payments first: Admin → Settings → Payments'
                         : undefined}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '10px 6px', borderRadius: 10, border: `1.5px solid ${method === m.id ? '#3D95CE' : 'var(--pn-border)'}`, background: isCardDisabled ? 'var(--pn-surface-alt)' : (method === m.id ? 'var(--pn-info-bg)' : 'var(--pn-bg)'), cursor: isCardDisabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: isCardDisabled ? .5 : 1 }}>
                    <span style={{ fontSize: 20 }}>{m.icon}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: method === m.id ? 'var(--pn-info)' : 'var(--pn-text-muted)' }}>{m.label}</span>
                  </button>
                );
              })}
            </div>
            {isOnline && !connectReady && (
              <div style={{ fontSize: 11, color: 'var(--pn-warning)', background: 'var(--pn-warning-bg)', border: '1px solid #fed7aa', borderRadius: 8, padding: '7px 10px', marginBottom: 8 }}>
                Card payments are off until Stripe is set up — <strong>Admin → Settings → Payments</strong>. Cash & other methods still work.
              </div>
            )}
            {method === 'card' && savedPm && (
              <div style={{ marginBottom: 10, border: '1px solid var(--pn-success)', borderRadius: 10, padding: '12px 14px', background: 'var(--pn-success-bg)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--pn-text)' }}>💳 Card on file · {(savedPm.brand || 'card')} •••• {savedPm.last4 || '••••'}</div>
                {!tipsDisabled && (
                  <>
                    <div style={{ fontSize: 11.5, color: 'var(--pn-text-muted)', margin: '8px 0 6px' }}>Add a tip (charged off-session, so set it now):</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {[0, 15, 18, 20, 25].map(p => {
                        const on = p === 0 ? (!tipPct && !customTip) : (tipPct === p && !customTip);
                        return (
                          <button key={p} onClick={() => (p === 0 ? pickTipPct(null) : pickTipPct(p))}
                            style={{ flex: '1 0 auto', padding: '7px 10px', borderRadius: 8, border: `1px solid ${on ? 'var(--pn-success)' : 'var(--pn-border-strong)'}`, background: on ? 'var(--pn-success)' : 'var(--pn-bg)', color: on ? '#fff' : 'var(--pn-text)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                            {p === 0 ? 'No tip' : `${p}%`}
                          </button>
                        );
                      })}
                      <button onClick={pickCustomTip}
                        style={{ flex: '1 0 auto', padding: '7px 10px', borderRadius: 8, border: `1px solid ${customTip ? 'var(--pn-success)' : 'var(--pn-border-strong)'}`, background: customTip ? 'var(--pn-success)' : 'var(--pn-bg)', color: customTip ? '#fff' : 'var(--pn-text)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        Custom
                      </button>
                    </div>
                    {customTip && (
                      <input value={tip} onChange={e => setTip(e.target.value)} placeholder="Tip amount $" inputMode="decimal"
                        style={{ width: '100%', marginTop: 8, padding: '9px 11px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', color: 'var(--pn-text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    )}
                  </>
                )}
                <button onClick={() => complete({ onFile: true })} disabled={saving}
                  style={{ width: '100%', marginTop: 10, padding: '12px', borderRadius: 10, border: 'none', background: saving ? 'var(--pn-surface-muted)' : 'var(--pn-success)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                  {saving ? 'Charging…' : `Charge $${total.toFixed(2)}${tipAmt > 0 ? ` (incl. $${tipAmt.toFixed(2)} tip)` : ''}`}
                </button>
              </div>
            )}
            {method === 'card' && cardViaKiosk && (
              <div style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', background: 'var(--pn-info-bg)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-info)' }}>🏪 The client pays by card at the front-desk kiosk</div>
                <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                  Tap “Send to front-desk kiosk” below — the iPad reader takes the card and the client adds a tip there. This exact total &amp; all discounts carry over.
                </div>
                <button onClick={() => setKeyedCard(true)}
                  style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, color: 'var(--pn-info)', fontSize: 12, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Type the card here instead
                </button>
              </div>
            )}
            {method === 'card' && !cardViaKiosk && stripePromise && charged > 0 && (
              <div>
                {!kioskAvail && (
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginBottom: 6 }}>
                    Promo / gift-card sales are taken here (they don’t hand off to the kiosk yet).
                  </div>
                )}
                <div style={{ border: '1px solid var(--pn-border-strong)', borderRadius: 10, padding: '11px 12px', background: 'var(--pn-bg)' }}>
                  {(() => {
                    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                    return <CardElement options={{ style: { base: { fontSize: '14px', fontFamily: '-apple-system, sans-serif', color: isDark ? '#f1f3f5' : '#1a1a1a', '::placeholder': { color: isDark ? '#8e97a3' : '#aaa' } }, invalid: { color: '#ef4444' } } }} />;
                  })()}
                </div>
                {cardError && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>{cardError}</div>}
                {kioskAvail && keyedCard && (
                  <button onClick={() => setKeyedCard(false)}
                    style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, color: 'var(--pn-info)', fontSize: 12, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}>
                    ← Send to the front-desk kiosk instead
                  </button>
                )}
              </div>
            )}
            {method === 'cash' && cashViaKiosk && (
              <div style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', background: 'var(--pn-info-bg)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-info)' }}>🏪 The client reviews the bill &amp; adds a tip at the kiosk</div>
                <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                  Tap “Send to front-desk kiosk” below. The client confirms the bill and picks a tip; then you collect the cash and tap Complete here.
                </div>
                <button onClick={() => setCashHere(true)}
                  style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, color: 'var(--pn-info)', fontSize: 12, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Take cash here instead
                </button>
              </div>
            )}
            {method === 'cash' && !cashViaKiosk && (
              <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.4 }}>
                Completing the cash sale here. {kioskAvail && (
                  <button onClick={() => setCashHere(false)}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--pn-info)', fontSize: 12, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Send to the kiosk for a tip instead
                  </button>
                )}
              </div>
            )}
          </Section>

          {/* Total summary */}
          <div style={{ background: 'var(--pn-bg)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
            <SummaryRow label="Subtotal" value={`$${subtotal}`} />
            {discountAmount > 0 && <SummaryRow label={discountType === 'member' ? `Member${membership?.planName ? ` (${membership.planName})` : ''}` : discountType === 'ff' ? 'Friends & Family' : 'Discount'} value={`−$${discountAmount.toFixed(2)}`} valueColor="#22c55e" />}
            {promoAmount > 0    && <SummaryRow label={`Promo: ${promo.code}`} value={`−$${promoAmount.toFixed(2)}`} valueColor="#22c55e" />}
            {taxAmt > 0         && <SummaryRow label={`Tax (${taxRate}%)`} value={`+$${taxAmt.toFixed(2)}`} />}
            {gcApply > 0        && <SummaryRow label={`Gift Card: ${giftCard.code}`} value={`−$${gcApply.toFixed(2)}`} valueColor="#22c55e" />}
            {creditApply > 0    && <SummaryRow label="Store Credit" value={`−$${creditApply.toFixed(2)}`} valueColor="#22c55e" />}
            {loyaltyApply > 0   && <SummaryRow label={`Loyalty (${loyaltyPts} pts)`} value={`−$${loyaltyApply.toFixed(2)}`} valueColor="#22c55e" />}
            {tipAmt > 0         && <SummaryRow label="Tip" value={`+$${tipAmt.toFixed(2)}`} />}
            <div style={{ borderTop: '1px solid var(--pn-border)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)' }}>Total</span>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#2D7A5F' }}>${total.toFixed(2)}</span>
            </div>
            {ccFee > 0 && (
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--pn-text-faint)', textAlign: 'right', fontStyle: 'italic' }}>
                Card processing fee: ~${ccFee.toFixed(2)} (recorded for reports, not added to charge)
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--pn-border)', flexShrink: 0 }}>
          {gateError && (
            <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 600, color: '#b45309', background: 'var(--pn-warning-bg)', border: '1px solid #fcd34d', borderRadius: 10, padding: '8px 12px' }}>
              🔒 {gateError}
            </div>
          )}
          <button onClick={viaKiosk ? () => sendToKiosk(cashViaKiosk ? 'cashReview' : 'card') : complete} disabled={saving}
            style={{ width: '100%', background: saving ? 'var(--pn-surface-muted)' : 'linear-gradient(135deg,#2D7A5F 0%,#3D95CE 100%)', color: '#fff', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Processing…' : viaKiosk ? `🏪 Send to front-desk kiosk · $${total.toFixed(2)}` : `Complete Checkout · $${total.toFixed(2)}`}
          </button>
        </div>

      </div>
    </div>
  );
}

// ── Waiting for the front-desk kiosk ───────────────────────────────────
// flow 'card' → wait for the kiosk to take the card (paid). flow 'cashReview'
// → wait for the client to confirm the bill + tip (status:'confirmed'), then
// hand the tip back so the web finalizes the cash sale.
function KioskWaiting({ sessionId, total, flow, onPaid, onCashConfirmed, onCancel }) {
  const isCash = flow === 'cashReview';
  const [stage, setStage]       = useState('waiting'); // waiting | paying | paid | gone
  const [paidInfo, setPaidInfo] = useState(null);
  const [checking, setChecking] = useState(false);

  // Apply a session snapshot — used by BOTH the realtime listener and the manual
  // "check now" fallback, so a missed realtime update can't strand the sale.
  function processSnap(d) {
    if (!d) return;
    // A different handoff replaced ours (another sale sent to the kiosk).
    if (d.sessionId && d.sessionId !== sessionId) {
      if (d.status !== 'idle') setStage('gone');
      return;
    }
    if (isCash) {
      if (d.status === 'confirmed') onCashConfirmed?.(d.confirmedTip || { amount: 0 });
      return;
    }
    if (d.paid) { setPaidInfo(d.paid); setStage('paid'); return; }
    if (d.status === 'paying') setStage('paying');
  }

  async function checkNow() {
    setChecking(true);
    try { processSnap(await getCheckoutSession()); } catch { /* noop */ }
    setChecking(false);
  }

  useEffect(() => {
    const unsub = subscribeCheckoutSession(processSnap);
    return () => { try { unsub && unsub(); } catch { /* noop */ } };
  }, [sessionId]); // eslint-disable-line

  useEffect(() => {
    if (stage !== 'paid') return;
    const t = setTimeout(() => onPaid?.(paidInfo), 1600);
    return () => clearTimeout(t);
  }, [stage]); // eslint-disable-line

  const paidTotal = paidInfo?.total != null ? paidInfo.total : total;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '92%', maxWidth: 380, padding: '30px 24px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        {stage === 'paid' ? (
          <>
            <div style={{ fontSize: 46, color: '#2D7A5F', marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--pn-text)' }}>${Number(paidTotal || 0).toFixed(2)} paid</div>
            <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginTop: 6 }}>Paid at the kiosk{paidInfo?.method ? ` by ${paidInfo.method}` : ''}. The receipt was sent from there.</div>
          </>
        ) : stage === 'gone' ? (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>↪️</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--pn-text)' }}>Taken over by another checkout</div>
            <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginTop: 6 }}>A newer sale was sent to the kiosk, so this one was replaced.</div>
            <button onClick={onCancel}
              style={{ marginTop: 18, width: '100%', padding: '12px', borderRadius: 12, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-text-muted)' }}>
              Close
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🏪</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--pn-text)' }}>{stage === 'paying' ? 'Taking payment…' : 'Sent to the front-desk kiosk'}</div>
            <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginTop: 8, lineHeight: 1.5 }}>
              {isCash
                ? 'Waiting for the client to review the bill and add a tip at the kiosk, then you’ll collect the cash here. Make sure an iPad is open in kiosk mode.'
                : stage === 'paying'
                  ? 'The client is paying at the kiosk — hang tight.'
                  : `Waiting for the client to pay $${Number(total || 0).toFixed(2)} at the kiosk (tap/insert on the reader). Make sure an iPad is open in kiosk mode.`}
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: 'var(--pn-text-faint)' }}>● ● ● {isCash ? 'waiting for the client to confirm…' : 'listening for payment…'}</div>
            <button onClick={checkNow} disabled={checking}
              style={{ marginTop: 16, width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#2D7A5F 0%,#3D95CE 100%)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: checking ? 'default' : 'pointer', fontFamily: 'inherit', opacity: checking ? .6 : 1 }}>
              {checking ? 'Checking…' : (isCash ? 'Already confirmed at the kiosk? Check now' : 'Already paid at the kiosk? Check now')}
            </button>
            <button onClick={onCancel} disabled={stage === 'paying'}
              style={{ marginTop: 8, width: '100%', padding: '12px', borderRadius: 12, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', fontSize: 14, fontWeight: 600, cursor: stage === 'paying' ? 'default' : 'pointer', fontFamily: 'inherit', color: 'var(--pn-text-muted)', opacity: stage === 'paying' ? .5 : 1 }}>
              Cancel &amp; take it back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Cash finalize: the kiosk confirmed the bill + tip; collect the cash ────
function CashFinalize({ total, tipAmt, saving, gateError, onComplete, onCancel }) {
  const due = Number(total || 0);
  const [tenderedStr, setTenderedStr] = useState('');
  const tendered = Number(tenderedStr) || 0;
  const change = tendered - due;
  // Quick bills: exact, then the next round denominations above the total.
  const quick = Array.from(new Set([
    Math.ceil(due / 5) * 5, Math.ceil(due / 10) * 10, Math.ceil(due / 20) * 20, 50, 100,
  ].filter(v => v >= due))).sort((a, b) => a - b).slice(0, 4);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '92%', maxWidth: 380, padding: '28px 24px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>💵</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--pn-text)' }}>Client confirmed — collect the cash</div>
        <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginTop: 6 }}>They reviewed the bill and chose a tip at the kiosk.</div>
        <div style={{ marginTop: 16, background: 'var(--pn-bg)', borderRadius: 12, padding: '14px 16px' }}>
          {tipAmt > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 6 }}>
              <span>Tip</span><span>+${Number(tipAmt).toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)' }}>Total due</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#2D7A5F' }}>${due.toFixed(2)}</span>
          </div>
        </div>
        {/* Cash calculator: tendered → change due (an aid; not required to complete) */}
        <div style={{ marginTop: 12, textAlign: 'left' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Cash received</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {quick.map(v => (
              <button key={v} onClick={() => setTenderedStr(String(v))}
                style={{ flex: '1 0 auto', minWidth: 56, padding: '8px 6px', borderRadius: 8, border: `1.5px solid ${tendered === v ? '#2D7A5F' : 'var(--pn-border)'}`, background: tendered === v ? 'var(--pn-success-bg)' : 'var(--pn-bg)', color: tendered === v ? 'var(--pn-success)' : 'var(--pn-text-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                ${v}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, color: 'var(--pn-text-faint)' }}>$</span>
            <input type="number" min={0} inputMode="decimal" value={tenderedStr} onChange={e => setTenderedStr(e.target.value)} placeholder="Amount tendered"
              style={{ flex: 1, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '9px 11px', fontSize: 14, background: 'var(--pn-bg)' }} />
          </div>
          {tenderedStr !== '' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 14, fontWeight: 700, color: change < 0 ? '#ef4444' : 'var(--pn-text)' }}>
              <span>{change < 0 ? 'Still owed' : 'Change due'}</span>
              <span>${Math.abs(change).toFixed(2)}</span>
            </div>
          )}
        </div>
        {gateError && (
          <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: '#b45309', background: 'var(--pn-warning-bg)', border: '1px solid #fcd34d', borderRadius: 10, padding: '8px 12px' }}>🔒 {gateError}</div>
        )}
        <button onClick={onComplete} disabled={saving}
          style={{ marginTop: 16, width: '100%', background: saving ? 'var(--pn-surface-muted)' : 'linear-gradient(135deg,#2D7A5F 0%,#3D95CE 100%)', color: '#fff', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {saving ? 'Recording…' : `Cash received · Complete $${Number(total || 0).toFixed(2)}`}
        </button>
        <button onClick={onCancel} disabled={saving}
          style={{ marginTop: 8, width: '100%', padding: '11px', borderRadius: 12, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', color: 'var(--pn-text-muted)', opacity: saving ? .5 : 1 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Receipt ────────────────────────────────────────────
function ReceiptScreen({ receipt, onDone }) {
  const { settings, showToast } = useApp();
  const { client, clientId, clientPhone, clientEmail, tech, primaryTechName, date, services, visitServices, retailProducts, payment: p } = receipt;
  const [reviewSent,    setReviewSent]    = useState(false);
  const [reviewSending, setReviewSending] = useState(false);
  const canReview = clientId && clientEmail && settings?.googleReviewUrl;

  // SMS receipt resend — fires the same body as the auto-send trigger,
  // optionally to a different number. Disabled if no phone on the receipt.
  const [smsSent,    setSmsSent]    = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsPhone,   setSmsPhone]   = useState(clientPhone || '');
  // Email twin — prefilled from the client profile so staff usually just tap Send.
  const [emailSent,    setEmailSent]    = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailAddr,    setEmailAddr]    = useState(clientEmail || '');

  async function sendTextReceipt() {
    if (!receipt._receiptId && !receipt.viewToken) {
      showToast('Receipt still saving — try again in a moment.');
      return;
    }
    setSmsSending(true);
    try {
      // Look up the receipt by viewToken (just-created docs may not have
      // surfaced their id back to the client). Use the same callable.
      const res = await callFn('resendReceiptSms')({
        tenantId: TENANT_ID,
        receiptId: receipt._receiptId || null,
        viewToken: receipt.viewToken,
        phone: smsPhone || clientPhone,
      });
      if (res.data?.ok || res.data?.sandboxed) {
        setSmsSent(true);
        showToast(res.data?.sandboxed ? 'Sent (sandbox)' : 'Receipt texted!');
      } else {
        showToast('Couldn’t send: ' + (res.data?.error || 'unknown error'));
      }
    } catch (e) {
      showToast('Send failed: ' + (e?.message || 'unknown error'));
    } finally {
      setSmsSending(false);
    }
  }

  async function sendEmailReceipt() {
    if (!receipt._receiptId && !receipt.viewToken) {
      showToast('Receipt still saving — try again in a moment.');
      return;
    }
    const addr = (emailAddr || clientEmail || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) { showToast('Enter a valid email address.'); return; }
    setEmailSending(true);
    try {
      const res = await callFn('resendReceiptEmail')({
        tenantId: TENANT_ID,
        receiptId: receipt._receiptId || null,
        viewToken: receipt.viewToken,
        email: addr,
      });
      if (res.data?.ok || res.data?.sandboxed) {
        setEmailSent(true);
        showToast('Receipt emailed!');
      } else {
        showToast('Couldn’t send: ' + (res.data?.error || 'unknown error'));
      }
    } catch (e) {
      showToast('Send failed: ' + (e?.message || 'unknown error'));
    } finally {
      setEmailSending(false);
    }
  }

  async function sendReviewRequest() {
    setReviewSending(true);
    try {
      await createReviewRequest({ clientId, clientName: client, clientEmail, googleReviewUrl: settings.googleReviewUrl });
      setReviewSent(true);
      showToast('Review request sent!');
    } catch { showToast('Failed to send review request.'); }
    finally { setReviewSending(false); }
  }
  const isMultiTech = p.techSplit && p.techSplit.length > 1;
  const fmtDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const methodLabel = { card: 'Credit / Debit Card', cash: 'Cash', venmo: 'Venmo', zelle: 'Zelle', check: 'Check' }[p.method] || p.method;

  function handlePrint() {
    // Receipt is rendered into a same-origin popup via document.write, so
    // every interpolated string MUST be HTML-escaped — `client`, `tech`,
    // service/product names, and `promoCode` flow in from public booking
    // input or imported CSVs and could otherwise execute as script in the
    // admin's session.
    const w = window.open('', '_blank', 'width=400,height=650');
    w.document.write(`
      <html><head><title>Receipt — ${escapeHtml(client)}</title>
      <style>
        body { font-family: 'Helvetica Neue', sans-serif; max-width: 340px; margin: 30px auto; color: #1a1a1a; }
        h2 { font-size: 22px; font-weight: 700; margin: 0 0 2px; }
        .sub { font-size: 13px; color: #888; margin: 0 0 18px; }
        hr { border: none; border-top: 1px solid #e8e8e8; margin: 14px 0; }
        .row { display: flex; justify-content: space-between; font-size: 13px; margin: 6px 0; }
        .row.total { font-weight: 700; font-size: 15px; margin-top: 10px; }
        .footer { text-align: center; font-size: 12px; color: #aaa; margin-top: 24px; }
      </style></head><body>
      <h2>${escapeHtml(settings?.salonName || 'Plume Nexus')}</h2>
      <p class="sub">${escapeHtml(fmtDate)} &nbsp;·&nbsp; ${escapeHtml(tech)}</p>
      <hr>
      ${services.map(s => `<div class="row"><span>${escapeHtml(s.name || '—')}</span><span>$${(Number(s.price) || 0).toFixed(2)}</span></div>`).join('')}
      <hr>
      ${p.discountAmount > 0 ? `<div class="row"><span>Discount</span><span>-$${p.discountAmount.toFixed(2)}</span></div>` : ''}
      ${p.promoAmount    > 0 ? `<div class="row"><span>Promo (${escapeHtml(p.promoCode)})</span><span>-$${p.promoAmount.toFixed(2)}</span></div>` : ''}
      ${p.giftCard       ? `<div class="row"><span>Gift card</span><span>-$${p.giftCard.applied.toFixed(2)}</span></div>` : ''}
      ${p.creditApplied  > 0 ? `<div class="row"><span>Credit applied</span><span>-$${p.creditApplied.toFixed(2)}</span></div>` : ''}
      ${p.tip            > 0 ? `<div class="row"><span>Tip</span><span>$${p.tip.toFixed(2)}</span></div>` : ''}
      <div class="row total"><span>Total</span><span>$${p.total.toFixed(2)}</span></div>
      <hr>
      <div class="row"><span>Paid via</span><span>${escapeHtml(methodLabel)}</span></div>
      <div class="footer">Thank you, ${escapeHtml(client)}! We appreciate your visit 💅</div>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 400, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', padding: '18px 20px', textAlign: 'center', color: '#fff', flexShrink: 0 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Payment Complete</div>
          <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>{client} · {tech}</div>
        </div>

        {/* Receipt body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          <RebookPrompt
            clientId={clientId}
            clientName={client}
            clientPhone={clientPhone}
            clientEmail={clientEmail}
            techName={primaryTechName || tech}
            visitDate={date}
            visitServices={visitServices}
          />
          <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginBottom: 12 }}>{fmtDate}</div>

          {isMultiTech ? (
            p.techSplit.map(split => (
              <div key={split.techName} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{split.techName}</div>
                {services.filter(s => s.techName === split.techName).map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--pn-border)' }}>
                    <span style={{ color: 'var(--pn-text)' }}>{s.name || '—'}</span>
                    <span style={{ fontWeight: 500 }}>${s.price.toFixed(2)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--pn-text-faint)', padding: '3px 0' }}>
                  <span>subtotal</span><span>${split.revenue.toFixed(2)}</span>
                </div>
              </div>
            ))
          ) : (
            services.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--pn-border)' }}>
                <span style={{ color: 'var(--pn-text)' }}>{s.name || '—'}</span>
                <span style={{ fontWeight: 500 }}>${s.price.toFixed(2)}</span>
              </div>
            ))
          )}

          {retailProducts?.length > 0 && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--pn-border)', paddingTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Retail Products</div>
              {retailProducts.map((rp, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--pn-border)' }}>
                  <span style={{ color: 'var(--pn-text)' }}>{rp.name}{rp.qty > 1 ? ` ×${rp.qty}` : ''}</span>
                  <span style={{ fontWeight: 500 }}>${(rp.price * rp.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 12, paddingTop: 4 }}>
            {p.discountAmount > 0 && <RRow label={`Discount`}      value={`-$${p.discountAmount.toFixed(2)}`} color="#ef4444" />}
            {p.promoAmount    > 0 && <RRow label={`Promo (${p.promoCode})`} value={`-$${p.promoAmount.toFixed(2)}`} color="#ef4444" />}
            {p.giftCard           && <RRow label="Gift card"        value={`-$${p.giftCard.applied.toFixed(2)}`} color="#ef4444" />}
            {p.creditApplied > 0  && <RRow label="Credit applied"  value={`-$${p.creditApplied.toFixed(2)}`} color="#ef4444" />}
            {p.tip           > 0  && <RRow label="Tip"             value={`$${p.tip.toFixed(2)}`} />}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 6px', borderTop: '2px solid var(--pn-text)', marginTop: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>Total</span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>${p.total.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--pn-text-muted)', paddingBottom: 4 }}>
              <span>Paid via</span><span>{methodLabel}</span>
            </div>
          </div>

          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--pn-text-faint)', marginTop: 16 }}>
            Thank you, {client}! We appreciate your visit 💅
          </div>
        </div>

        {/* Send the receipt — phone + email, prefilled from the client profile. */}
        <div style={{ padding: '10px 18px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Send the receipt</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input value={smsPhone} onChange={e => { setSmsPhone(e.target.value); setSmsSent(false); }} placeholder="Phone (e.g., 614-555-0123)" inputMode="tel"
              style={{ flex: 1, padding: '9px 11px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', fontSize: 13, fontFamily: 'inherit', background: 'var(--pn-bg)' }} />
            <button onClick={!smsSending && smsPhone.trim() ? sendTextReceipt : undefined} disabled={smsSending || !smsPhone.trim()}
              style={{ minWidth: 84, padding: '9px 12px', borderRadius: 8, border: `1px solid ${smsSent ? '#bbf7d0' : '#bfdbfe'}`, background: smsSent ? 'var(--pn-success-bg)' : 'var(--pn-info-bg)', fontSize: 12, fontWeight: 700, cursor: (smsSending || !smsPhone.trim()) ? 'default' : 'pointer', fontFamily: 'inherit', color: smsSent ? 'var(--pn-success)' : 'var(--pn-info)', opacity: smsPhone.trim() ? 1 : .5 }}>
              {smsSent ? '✓ Texted' : smsSending ? 'Sending…' : '💬 Text'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={emailAddr} onChange={e => { setEmailAddr(e.target.value); setEmailSent(false); }} placeholder="Email" inputMode="email" autoCapitalize="none" autoCorrect="off"
              style={{ flex: 1, padding: '9px 11px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', fontSize: 13, fontFamily: 'inherit', background: 'var(--pn-bg)' }} />
            <button onClick={!emailSending && emailAddr.trim() ? sendEmailReceipt : undefined} disabled={emailSending || !emailAddr.trim()}
              style={{ minWidth: 84, padding: '9px 12px', borderRadius: 8, border: `1px solid ${emailSent ? '#bbf7d0' : '#bfdbfe'}`, background: emailSent ? 'var(--pn-success-bg)' : 'var(--pn-info-bg)', fontSize: 12, fontWeight: 700, cursor: (emailSending || !emailAddr.trim()) ? 'default' : 'pointer', fontFamily: 'inherit', color: emailSent ? 'var(--pn-success)' : 'var(--pn-info)', opacity: emailAddr.trim() ? 1 : .5 }}>
              {emailSent ? '✓ Emailed' : emailSending ? 'Sending…' : '✉️ Email'}
            </button>
          </div>
        </div>

        {/* Footer buttons */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--pn-border)', flexShrink: 0, flexWrap: 'wrap' }}>
          <button onClick={handlePrint}
            style={{ flex: 1, minWidth: 70, padding: '10px 0', borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-text-muted)' }}>
            🖨 Print
          </button>
          {canReview && (
            <button onClick={!reviewSent && !reviewSending ? sendReviewRequest : undefined}
              style={{ flex: 1, minWidth: 70, padding: '10px 0', borderRadius: 10, border: `1px solid ${reviewSent ? '#bbf7d0' : '#fde68a'}`, background: reviewSent ? 'var(--pn-success-bg)' : 'var(--pn-warning-bg)', fontSize: 12, fontWeight: 600, cursor: reviewSent || reviewSending ? 'default' : 'pointer', fontFamily: 'inherit', color: reviewSent ? 'var(--pn-success)' : 'var(--pn-warning)' }}>
              {reviewSent ? '✓ Sent!' : reviewSending ? 'Sending…' : '⭐ Review'}
            </button>
          )}
          <button onClick={onDone}
            style={{ flex: 2, minWidth: 100, padding: '10px 0', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', color: '#fff' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function RRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: 'var(--pn-text-muted)' }}>
      <span>{label}</span><span style={{ color: color || 'var(--pn-text)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// Collapses optional money tools (promo / gift card / store credit) behind a
// single "More options" toggle. When `enabled` is false it renders its children
// inline (today's layout) so the change ships dark behind the curatedHome flag.
// Auto-opens once any of those is applied.
function MoreOptions({ enabled, openByDefault, children }) {
  const [open, setOpen] = useState(!!openByDefault);
  useEffect(() => { if (openByDefault) setOpen(true); }, [openByDefault]);
  if (!enabled) return <>{children}</>;
  return (
    <div style={{ marginBottom: 14 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', boxSizing: 'border-box', background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--pn-text-muted)' }}>
        <span>More options · promo, gift card, credit</span>
        <span style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', fontSize: 11 }}>▾</span>
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

function Section({ title, action, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function SummaryRow({ label, value, valueColor, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--pn-text-muted)', fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ fontSize: bold ? 14 : 13, fontWeight: bold ? 700 : 500, color: valueColor || (bold ? 'var(--pn-text)' : 'var(--pn-text)') }}>{value}</span>
    </div>
  );
}

// Generate a random alphanumeric gift card code, e.g. MERAKI-A4F7K2
function generateGcCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return `MK-${s}`;
}

function GiftCardSaleModal({ onClose, onAdd }) {
  const [amount, setAmount] = useState('');
  const [name,   setName]   = useState('');
  const [email,  setEmail]  = useState('');
  // Email is required because gift cards auto-email the recipient with
  // their code on issuance. Without an email the recipient never gets
  // the code (it'd only live on the receipt). Basic email-format check.
  const validEmail = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email.trim());
  const valid = Number(amount) > 0 && validEmail;

  function add() {
    if (!valid) return;
    onAdd({
      id: `gc_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      code: generateGcCode(),
      amount: Number(amount),
      recipientName: name.trim(),
      recipientEmail: email.trim(),
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, padding: '20px 22px', width: '92%', maxWidth: 380, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4 }}>🎁 Sell gift card</div>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 14 }}>A unique code is generated automatically. The recipient email is required — we email the gift card code to them on purchase.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 14, color: 'var(--pn-text-faint)' }}>$</span>
          <input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount" autoFocus
            onKeyDown={e => e.key === 'Enter' && valid && add()}
            style={{ flex: 1, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '10px 12px', fontSize: 13, background: 'var(--pn-bg)' }}
          />
        </div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Recipient name (optional)"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', fontSize: 13, fontFamily: 'inherit', marginBottom: 8, background: 'var(--pn-bg)' }} />
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Recipient email *" inputMode="email"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: `1px solid ${email && !validEmail ? '#ef4444' : 'var(--pn-border-strong)'}`, fontSize: 13, fontFamily: 'inherit', marginBottom: 4, background: 'var(--pn-bg)' }} />
        {email && !validEmail && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8 }}>Enter a valid email — we'll send the code here.</div>}
        {(!email || validEmail) && <div style={{ height: 10 }} />}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={add} disabled={!valid}
            style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: valid ? '#7c3aed' : 'var(--pn-surface-muted)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'inherit' }}>
            Add to ticket →
          </button>
        </div>
      </div>
    </div>
  );
}

// Shows how a multi-tech tip will be split across techs by service-revenue ratio.
// Hidden when there's only one tech (or no tip / no services).
function TipSplitPreview({ tipAmt, serviceLines, prices, techNames }) {
  if (!tipAmt || tipAmt <= 0 || !serviceLines?.length) return null;
  const byTech = {};
  serviceLines.forEach((line, idx) => {
    const t = techNames[idx] || line.techName || '—';
    const p = Number(prices[idx]) || 0;
    if (!byTech[t]) byTech[t] = 0;
    byTech[t] += p;
  });
  const techs = Object.entries(byTech);
  if (techs.length <= 1) return null;
  const totalSvc = techs.reduce((s, [, rev]) => s + rev, 0);
  // Allocate by ratio; last tech absorbs rounding remainder.
  let allocated = 0;
  const shares = techs.map(([name, rev], i) => {
    const ratio = totalSvc > 0 ? rev / totalSvc : 1 / techs.length;
    let share;
    if (i === techs.length - 1) share = Math.round((tipAmt - allocated) * 100) / 100;
    else { share = Math.round(ratio * tipAmt * 100) / 100; allocated += share; }
    return { name, rev, ratio, share };
  });
  return (
    <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--pn-bg)', borderRadius: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', marginBottom: 6, letterSpacing: '.04em' }}>SPLIT BY SERVICE REVENUE</div>
      {shares.map(s => (
        <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '3px 0' }}>
          <span style={{ color: 'var(--pn-text)', fontWeight: 500 }}>{s.name} <span style={{ color: 'var(--pn-text-faint)', fontWeight: 400 }}>· {(s.ratio * 100).toFixed(0)}% of services</span></span>
          <span style={{ fontWeight: 700, color: '#2D7A5F' }}>${s.share.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
