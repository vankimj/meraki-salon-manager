import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

// Public product shop. Reached at `/?store` (optionally `&tid=`). Reads safe
// product fields via getPublicStore; "Buy" collects an email and mints a
// Stripe Checkout session via createStoreCheckoutForClient (destination
// charge → the trainer's connected account). Stripe redirects back to
// `?store=success` / `?store=cancel`, which this page renders as a banner.

const C = {
  ink: '#1a1410', muted: '#6b6258', rule: '#e2ddd2', bg: '#fbf8f1', card: '#fff',
  plum: '#6a4fa0', plumDeep: '#3f2767',
};

const priceLabel = (p) =>
  p.billingType === 'recurring'
    ? `$${p.price}/${p.interval === 'year' ? 'yr' : 'mo'}`
    : `$${p.price}`;

export default function ProductShop() {
  const params = new URLSearchParams(window.location.search);
  const tid = params.get('tid') || undefined;
  const outcome = params.get('store'); // '' | 'success' | 'cancel'
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [buying, setBuying]   = useState(null); // product being purchased

  useEffect(() => {
    httpsCallable(functions, 'getPublicStore')({ tid })
      .then(res => setData(res?.data || { items: [], storeEnabled: false }))
      .catch(e => setError(e?.message || 'Could not load the shop.'))
      .finally(() => setLoading(false));
  }, [tid]);

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,sans-serif", padding: '32px 16px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {data?.salonName && <div style={{ fontSize: 14, fontWeight: 700, color: C.plumDeep, letterSpacing: '.02em' }}>{data.salonName}</div>}
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 30, color: C.ink, margin: '6px 0 4px' }}>Shop</h1>
          <div style={{ fontSize: 14, color: C.muted }}>Products and supplements, straight from your trainer.</div>
        </div>

        {outcome === 'success' && (
          <Banner tone="success">Thanks! Your order is confirmed — a receipt is on its way to your email.</Banner>
        )}
        {outcome === 'cancel' && (
          <Banner tone="muted">Checkout cancelled. Nothing was charged — pick back up any time.</Banner>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', color: C.muted, padding: 40 }}>Loading…</div>
        ) : error ? (
          <div style={{ textAlign: 'center', color: '#b3261e', padding: 40 }}>{error}</div>
        ) : !data.storeEnabled ? (
          <div style={{ textAlign: 'center', color: C.muted, padding: 40 }}>Shop coming soon — check back shortly.</div>
        ) : !data.items?.length ? (
          <div style={{ textAlign: 'center', color: C.muted, padding: 40 }}>No products yet — check back soon.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {data.items.map(p => (
              <div key={p.id} style={{ background: C.card, border: `1px solid ${C.rule}`, borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 6px 20px rgba(15,25,35,.05)' }}>
                {p.image ? (
                  <img src={p.image} alt={p.name} style={{ width: '100%', height: 160, objectFit: 'cover', background: C.bg }} />
                ) : (
                  <div style={{ width: '100%', height: 160, background: 'linear-gradient(135deg, rgba(106,79,160,.1), rgba(61,149,206,.1))', display: 'grid', placeItems: 'center', fontSize: 32 }}>🛍️</div>
                )}
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, margin: '2px 0 4px' }}>{p.name}</div>
                  {p.description && <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, flex: 1 }}>{p.description}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{priceLabel(p)}</span>
                    {p.soldOut ? (
                      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: C.muted }}>Sold out</span>
                    ) : (
                      <button onClick={() => setBuying(p)}
                        style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: '#fff', background: C.plum, padding: '8px 16px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                        {p.billingType === 'recurring' ? 'Subscribe' : 'Buy'} →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 28 }}>
          Secure checkout by Stripe. Payments go directly to your trainer.
        </div>
      </div>

      {buying && <BuyModal product={buying} tid={tid} onClose={() => setBuying(null)} />}
    </div>
  );
}

function BuyModal({ product, tid, onClose }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  async function checkout() {
    setErr('');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr('Enter a valid email'); return; }
    setBusy(true);
    try {
      const res = await httpsCallable(functions, 'createStoreCheckoutForClient')({
        tid, productId: product.id, email: email.trim().toLowerCase(),
      });
      const url = res?.data?.url;
      if (!url) throw new Error('No checkout URL returned');
      window.location.href = url; // hand off to Stripe Checkout
    } catch (e) {
      setErr(e?.message || 'Could not start checkout');
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 380, boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.rule}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{product.name}</div>
          <div style={{ fontSize: 13, color: C.muted }}>{priceLabel(product)}{product.billingType === 'recurring' ? ' · cancel anytime' : ''}</div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>Your email</div>
          <input autoFocus type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && checkout()}
            placeholder="you@example.com"
            style={{ width: '100%', fontFamily: 'inherit', fontSize: 14, padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.rule}`, outline: 'none', boxSizing: 'border-box', marginBottom: 4 }} />
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>We’ll send your receipt here. Card details are entered securely on Stripe.</div>
          {err && <div style={{ fontSize: 12, color: '#b3261e', marginBottom: 10 }}>{err}</div>}
          <button onClick={checkout} disabled={busy}
            style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: busy ? '#b9add6' : C.plum, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {busy ? 'Starting checkout…' : 'Continue to payment →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, children }) {
  const success = tone === 'success';
  return (
    <div style={{ background: success ? '#ecfdf3' : '#f4f1ea', border: `1px solid ${success ? '#a6f4c5' : C.rule}`, color: success ? '#067647' : C.muted, borderRadius: 12, padding: '12px 16px', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
      {children}
    </div>
  );
}
