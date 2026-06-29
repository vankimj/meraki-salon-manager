import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { TENANT_ID } from '../lib/tenant';

// Public "Recommended Gear" storefront. Reached at `/?gear` (optionally
// `&tid=`). Reads safe product fields via getRecommendedGear; each "Shop"
// button links to the trackAffiliateClick redirect so clicks are counted and
// the trainer keeps the third-party kickback.

const C = {
  ink: '#1a1410', muted: '#6b6258', rule: '#e2ddd2', bg: '#fbf8f1', card: '#fff',
  plum: '#6a4fa0', plumDeep: '#3f2767',
};

export default function GearStorefront() {
  const params = new URLSearchParams(window.location.search);
  // Default to the subdomain-resolved tenant so {trainer}.plumenexus.com/?gear
  // shows THAT trainer's gear, not the platform default. ?tid= still overrides.
  const tid = params.get('tid') || TENANT_ID;
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    httpsCallable(functions, 'getRecommendedGear')({ tid })
      .then(res => setData(res?.data || { items: [] }))
      .catch(e => setError(e?.message || 'Could not load recommendations.'))
      .finally(() => setLoading(false));
  }, [tid]);

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,sans-serif", padding: '32px 16px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {data?.salonName && <div style={{ fontSize: 14, fontWeight: 700, color: C.plumDeep, letterSpacing: '.02em' }}>{data.salonName}</div>}
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 30, color: C.ink, margin: '6px 0 4px' }}>Recommended Gear</h1>
          <div style={{ fontSize: 14, color: C.muted }}>Equipment and supplements I trust and use with my clients.</div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: C.muted, padding: 40 }}>Loading…</div>
        ) : error ? (
          <div style={{ textAlign: 'center', color: '#b3261e', padding: 40 }}>{error}</div>
        ) : !data.items?.length ? (
          <div style={{ textAlign: 'center', color: C.muted, padding: 40 }}>No recommendations yet — check back soon.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {data.items.map(p => (
              <div key={p.id} style={{ background: C.card, border: `1px solid ${C.rule}`, borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 6px 20px rgba(15,25,35,.05)' }}>
                {p.image ? (
                  <img src={p.image} alt={p.name} style={{ width: '100%', height: 160, objectFit: 'cover', background: C.bg }} />
                ) : (
                  <div style={{ width: '100%', height: 160, background: `linear-gradient(135deg, rgba(106,79,160,.1), rgba(61,149,206,.1))`, display: 'grid', placeItems: 'center', fontSize: 32 }}>🏋️</div>
                )}
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', flex: 1 }}>
                  {p.brand && <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{p.brand}</div>}
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, margin: '2px 0 4px' }}>{p.name}</div>
                  {p.description && <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, flex: 1 }}>{p.description}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                    {p.price > 0 && <span style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>~${p.price}</span>}
                    <a href={p.shopUrl} target="_blank" rel="noopener noreferrer sponsored"
                      style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: '#fff', background: C.plum, padding: '8px 16px', borderRadius: 999, textDecoration: 'none' }}>
                      Shop →
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 28 }}>
          As an affiliate, your trainer may earn a commission on purchases made through these links — at no extra cost to you.
        </div>
      </div>
    </div>
  );
}
