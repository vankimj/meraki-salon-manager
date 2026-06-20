import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { callFn } from '../lib/firebase';
import { TENANT_ID } from '../lib/tenant';
import { fetchWebfrontConfig } from '../lib/firestore';

// Public, unauthenticated "Buy a Gift Card" page (`/gift`). The card is created
// server-side AFTER payment succeeds (createGiftCardPurchaseIntent → confirm →
// finalizeGiftCardPurchase); the browser never writes a giftCards doc. On
// success the existing sendGiftCardEmail trigger emails the code to the
// recipient.

const giftStripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

const GREEN = '#2D7A5F';
const PRESETS = [25, 50, 75, 100, 150, 200];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function GiftCardPurchaseScreen() {
  const [webCfg, setWebCfg] = useState(null);
  useEffect(() => { fetchWebfrontConfig().then(setWebCfg).catch(() => setWebCfg({})); }, []);
  const salonName = webCfg?.salonName || 'Our Salon';

  return (
    <div style={{ minHeight: '100dvh', width: '100vw', background: 'linear-gradient(160deg,#f3f7f5 0%,#eef2f6 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 16px 48px', boxSizing: 'border-box', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>🎁</div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: GREEN }}>{salonName}</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#1a2b25', margin: '4px 0 0' }}>Gift Card</h1>
          <p style={{ fontSize: 13.5, color: '#5b6b64', margin: '8px 0 0', lineHeight: 1.5 }}>
            Send a digital gift card by email — they’ll get a code to redeem on any service.
          </p>
        </div>

        <div style={{ background: '#fff', borderRadius: 20, padding: '22px 20px', boxShadow: '0 16px 44px rgba(20,40,33,.12)', border: '1px solid #e6ece9' }}>
          {giftStripePromise ? (
            <Elements stripe={giftStripePromise}>
              <GiftCardForm salonName={salonName} />
            </Elements>
          ) : (
            <div style={{ fontSize: 13, color: '#b00', textAlign: 'center', padding: 12 }}>
              Online gift-card purchase isn’t available right now. Please contact {salonName} directly.
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', fontSize: 11.5, color: '#8a978f', marginTop: 16 }}>
          Payments are securely processed by Stripe. The code is emailed to the recipient immediately after purchase.
        </div>
      </div>
    </div>
  );
}

function GiftCardForm({ salonName }) {
  const stripe = useStripe();
  const elements = useElements();

  const [amount, setAmount]   = useState(50);
  const [custom, setCustom]   = useState('');
  const [recipientName, setRecipientName]   = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage]               = useState('');
  const [purchaserName, setPurchaserName]   = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const [done, setDone]   = useState(null); // { recipientEmail }

  const effAmount = custom !== '' ? Math.round(Number(custom) || 0) : amount;
  const amountValid = effAmount >= 5 && effAmount <= 1000;
  const canSubmit = stripe && !busy && amountValid && EMAIL_RE.test(recipientEmail.trim());

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!stripe || !elements) return;
    setError('');
    if (!amountValid) { setError('Choose an amount between $5 and $1,000.'); return; }
    if (!EMAIL_RE.test(recipientEmail.trim())) { setError('Enter a valid recipient email — that’s where the code is sent.'); return; }
    setBusy(true);
    try {
      const { data } = await callFn('createGiftCardPurchaseIntent')({
        tenantId: TENANT_ID,
        amountCents: effAmount * 100,
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        purchaserName: purchaserName.trim(),
        purchaserEmail: purchaserEmail.trim(),
        message: message.trim(),
      });
      const clientSecret = data?.clientSecret;
      const paymentIntentId = data?.paymentIntentId;
      if (!clientSecret) throw new Error('Could not start the purchase. Please try again.');

      const { paymentIntent, error: stripeErr } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: elements.getElement(CardElement),
          billing_details: {
            name:  purchaserName.trim() || undefined,
            email: (purchaserEmail.trim() || recipientEmail.trim()) || undefined,
          },
        },
      });
      if (stripeErr) throw new Error(stripeErr.message || 'Your card was declined.');
      if (paymentIntent?.status !== 'succeeded') throw new Error('Payment did not complete. You were not charged.');

      // Server verifies the charge + mints the card (which emails the code).
      await callFn('finalizeGiftCardPurchase')({ tenantId: TENANT_ID, paymentIntentId }).catch(() => {});
      setDone({ recipientEmail: recipientEmail.trim() });
    } catch (err) {
      setError(err?.message || 'Something went wrong. If you were charged, contact the salon.');
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center', padding: '10px 4px' }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#1a2b25', marginBottom: 6 }}>Payment received!</div>
        <div style={{ fontSize: 13.5, color: '#4f5f58', lineHeight: 1.55 }}>
          A ${effAmount} {salonName} gift card is on its way to <strong>{done.recipientEmail}</strong>. The email includes the redemption code — it can be used right away.
        </div>
      </div>
    );
  }

  const label = { fontSize: 11, fontWeight: 700, color: '#5b6b64', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', margin: '14px 0 5px' };
  const inp   = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14, borderRadius: 10, border: '1px solid #d8e0db', fontFamily: 'inherit', background: '#fcfdfc' };

  return (
    <form onSubmit={handleSubmit}>
      {/* Amount */}
      <label style={{ ...label, marginTop: 0 }}>Amount</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 7, marginBottom: 8 }}>
        {PRESETS.map(v => {
          const on = custom === '' && amount === v;
          return (
            <button type="button" key={v}
              onClick={() => { setAmount(v); setCustom(''); }}
              style={{ padding: '11px 0', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                border: on ? `2px solid ${GREEN}` : '1px solid #d8e0db', background: on ? '#eaf4ef' : '#fff', color: on ? GREEN : '#33403a' }}>
              ${v}
            </button>
          );
        })}
      </div>
      <input type="number" min={5} max={1000} inputMode="numeric" value={custom}
        onChange={e => setCustom(e.target.value)} placeholder="Or enter a custom amount ($5–$1,000)"
        style={{ ...inp, borderColor: custom !== '' ? GREEN : '#d8e0db' }} />

      <label style={label}>Recipient name</label>
      <input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Who’s it for?" style={inp} />

      <label style={label}>Recipient email <span style={{ color: GREEN }}>*</span></label>
      <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} placeholder="name@email.com — the code is sent here" style={inp} />

      <label style={label}>Message (optional)</label>
      <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2} maxLength={200} placeholder="Happy birthday! 💅" style={{ ...inp, resize: 'vertical' }} />

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>Your name</label>
          <input value={purchaserName} onChange={e => setPurchaserName(e.target.value)} placeholder="From" style={inp} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>Your email</label>
          <input type="email" value={purchaserEmail} onChange={e => setPurchaserEmail(e.target.value)} placeholder="For your receipt" style={inp} />
        </div>
      </div>

      <label style={label}>Card</label>
      <div style={{ border: '1px solid #d8e0db', borderRadius: 10, padding: '13px 12px', background: '#fcfdfc' }}>
        <CardElement options={{ style: { base: { fontSize: '15px', color: '#1a1a1a', '::placeholder': { color: '#9aa8a1' } } } }} />
      </div>

      {error && <div style={{ fontSize: 12.5, color: '#b00', margin: '12px 0 0', lineHeight: 1.45 }}>{error}</div>}

      <button type="submit" disabled={!canSubmit}
        style={{ width: '100%', marginTop: 16, padding: '14px', borderRadius: 12, border: 'none',
          background: canSubmit ? GREEN : '#b9c7c0', color: '#fff', fontSize: 15.5, fontWeight: 800,
          cursor: canSubmit ? 'pointer' : 'default', fontFamily: 'inherit', letterSpacing: '.01em' }}>
        {busy ? 'Processing…' : `Pay $${amountValid ? effAmount : '—'} & send gift card`}
      </button>
    </form>
  );
}
