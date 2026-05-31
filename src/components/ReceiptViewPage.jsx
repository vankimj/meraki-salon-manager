import { useState, useEffect, useMemo } from 'react';
import { callFn } from '../lib/firebase';

function extractToken() {
  const path = window.location.pathname || '';
  const m = path.match(/^\/r\/([A-Za-z0-9_-]{16,128})\/?$/);
  if (m) return m[1];
  const params = new URLSearchParams(window.location.search);
  const q = params.get('r') || params.get('token');
  return q && /^[A-Za-z0-9_-]{16,128}$/.test(q) ? q : null;
}

function fmtMoney(n) { return `$${Number(n || 0).toFixed(2)}`; }
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const dt = new Date();
  dt.setHours(h, m || 0);
  return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ReceiptViewPage() {
  const token = useMemo(extractToken, []);
  const [data,    setData]    = useState(null);
  const [err,     setErr]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setErr('invalid_link'); setLoading(false); return; }
    const params = new URLSearchParams(window.location.search);
    const source = params.get('src') || 'web';
    const prefilledRate = Number(params.get('rate'));
    const prefilledTech = String(params.get('tech') || '').trim();

    callFn('getReceiptByToken')({ token })
      .then(res => setData(res.data))
      .catch(e => setErr(e?.code === 'not-found' ? 'not_found' : 'load_failed'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <PageShell><div style={{ textAlign: 'center', padding: 48, color: '#888' }}>Loading…</div></PageShell>;
  }
  if (err === 'invalid_link' || err === 'not_found') {
    return <PageShell><Message title="Receipt not found"
      body="The link may be expired or mistyped. Reach out to the salon if you need a copy." /></PageShell>;
  }
  if (err) {
    return <PageShell><Message title="Something went wrong"
      body="Please try again in a moment." /></PageShell>;
  }
  if (!data) return null;

  return (
    <PageShell brandColor="#2D7A5F">
      <ReceiptCard data={data} />
      <RatingSection data={data} token={token} />
      <div style={{ textAlign: 'center', padding: '16px 0 32px', color: '#bbb', fontSize: 11 }}>
        Powered by Plume Nexus
      </div>
    </PageShell>
  );
}

function PageShell({ children }) {
  return (
    <div style={{
      minHeight: '100dvh', background: '#f4f5f7',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '16px 12px',
    }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

function Message({ title, body }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#888' }}>{body}</div>
    </div>
  );
}

function ReceiptCard({ data }) {
  const services        = data.services || [];
  const retailProducts  = data.retailProducts || [];
  const p               = data.payment || {};
  const techShown       = data.techName || 'Your technician';

  return (
    <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.06)', marginBottom: 16 }}>
      <div style={{ background: 'linear-gradient(135deg, #2D7A5F, #3D95CE)', padding: '20px 24px' }}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>{data.salonName || 'Your salon'}</div>
        <div style={{ color: 'rgba(255,255,255,.75)', fontSize: 12, marginTop: 2 }}>Receipt</div>
      </div>

      <div style={{ padding: 24 }}>
        <p style={{ fontSize: 15, color: '#222', margin: '0 0 4px', fontWeight: 600 }}>
          Hi {data.clientFirstName || 'there'}!
        </p>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 20px' }}>
          Thanks for visiting {data.salonName || 'us'}. Here's your receipt.
        </p>

        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 12, color: '#555' }}>
          <div>📅 {fmtDate(data.date)}{data.startTime ? ` at ${fmtTime(data.startTime)}` : ''}</div>
          <div style={{ marginTop: 4 }}>👩‍💼 {techShown}</div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e8e8e8' }}>
              <th style={{ textAlign: 'left', fontSize: 11, color: '#aaa', paddingBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Service</th>
              <th style={{ textAlign: 'right', fontSize: 11, color: '#aaa', paddingBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Price</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s, i) => (
              <tr key={i}>
                <td style={{ padding: '6px 0', color: '#333', fontSize: 13 }}>
                  {s.name}
                  {s.techName && s.techName !== techShown ? <span style={{ color: '#aaa' }}> ({s.techName})</span> : null}
                </td>
                <td style={{ textAlign: 'right', padding: '6px 0', color: '#333', fontSize: 13 }}>{fmtMoney(s.price)}</td>
              </tr>
            ))}
            {retailProducts.length > 0 && (
              <>
                <tr><td colSpan={2} style={{ padding: '8px 0 4px', fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', borderTop: '1px solid #f0f0f0' }}>Retail Products</td></tr>
                {retailProducts.map((rp, i) => (
                  <tr key={`rp-${i}`}>
                    <td style={{ padding: '6px 0', color: '#333', fontSize: 13 }}>{rp.name}{rp.qty > 1 ? ` ×${rp.qty}` : ''}</td>
                    <td style={{ textAlign: 'right', padding: '6px 0', color: '#333', fontSize: 13 }}>{fmtMoney(rp.price * (rp.qty || 1))}</td>
                  </tr>
                ))}
              </>
            )}
            {(p.discountAmount > 0 || p.promoAmount > 0 || (p.giftCard && p.giftCard.applied > 0) || p.creditApplied > 0 || p.tip > 0) && (
              <tr><td colSpan={2} style={{ padding: '6px 0', borderTop: '1px solid #f0f0f0' }} /></tr>
            )}
            {p.discountAmount > 0 && <SummaryRow label="Discount" value={`-${fmtMoney(p.discountAmount)}`} color="#ef4444" />}
            {p.promoAmount > 0    && <SummaryRow label={`Promo${p.promoCode ? ` (${p.promoCode})` : ''}`} value={`-${fmtMoney(p.promoAmount)}`} color="#ef4444" />}
            {p.giftCard?.applied > 0 && <SummaryRow label="Gift card" value={`-${fmtMoney(p.giftCard.applied)}`} color="#ef4444" />}
            {p.creditApplied > 0  && <SummaryRow label="Store credit" value={`-${fmtMoney(p.creditApplied)}`} color="#ef4444" />}
            {p.tip > 0            && <SummaryRow label="Tip" value={fmtMoney(p.tip)} color="#555" />}
            <tr style={{ borderTop: '1px solid #e8e8e8' }}>
              <td style={{ padding: '10px 0 0', fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>Total</td>
              <td style={{ textAlign: 'right', padding: '10px 0 0', fontSize: 14, fontWeight: 700, color: '#2D7A5F' }}>{fmtMoney(p.total)}</td>
            </tr>
            {p.method && (
              <tr><td colSpan={2} style={{ fontSize: 11, color: '#aaa', paddingTop: 3 }}>Paid via {p.method}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, color }) {
  return (
    <tr>
      <td style={{ padding: '4px 0', fontSize: 12, color: '#888' }}>{label}</td>
      <td style={{ textAlign: 'right', fontSize: 12, color }}>{value}</td>
    </tr>
  );
}

function RatingSection({ data, token }) {
  // Build the unique tech list from services — one rating widget per tech.
  const techs = useMemo(() => {
    const set = new Set();
    (data.services || []).forEach(s => { if (s.techName) set.add(s.techName); });
    if (set.size === 0 && data.techName) {
      data.techName.split(',').map(t => t.trim()).filter(Boolean).forEach(t => set.add(t));
    }
    return Array.from(set);
  }, [data]);

  // Seed from `existingRatings` so a returning visitor sees their prior pick.
  const seeded = {};
  (data.existingRatings || []).forEach(r => { seeded[r.techName] = { rating: r.rating, comment: r.comment || '' }; });
  const [picks, setPicks]       = useState(seeded);
  const [submitting, setSubmit] = useState(false);
  const [result, setResult]     = useState(null);
  const [commentDraft, setCD]   = useState('');

  // Auto-submit from an email-link star tap (e.g., /r/{token}?rate=5&tech=Yasmin&src=email).
  // Seeds the picked star immediately, then submits in the background. We only
  // surface the post-rate result UI (Google CTA or thank-you) when the receipt
  // is single-tech — multi-tech receipts must keep the rating widget visible
  // so the visitor can rate the remaining techs before we hide the form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefilledRate = Number(params.get('rate'));
    const prefilledTech = String(params.get('tech') || '').trim();
    const source        = params.get('src') || 'web';
    if (!(prefilledRate >= 1 && prefilledRate <= 5) || !prefilledTech) return;
    if (!techs.includes(prefilledTech)) return;
    if (seeded[prefilledTech]?.rating) return; // already rated previously
    setPicks(prev => ({ ...prev, [prefilledTech]: { rating: prefilledRate, comment: '' } }));
    callFn('submitServiceRating')({
      token, source,
      ratings: [{ techName: prefilledTech, rating: prefilledRate }],
    }).then(res => {
      if (techs.length === 1) setResult(res.data);
    }).catch(() => { /* user can still re-submit via the button */ });
  }, [techs.length]);

  const threshold = Number(data.reviewRoutingThreshold) || 4;
  const highest   = Math.max(0, ...Object.values(picks).map(p => Number(p.rating) || 0));
  const allRated  = techs.length > 0 && techs.every(t => picks[t]?.rating);
  const goPublic  = highest >= threshold;

  function setRating(tech, rating) {
    setPicks(prev => ({ ...prev, [tech]: { ...(prev[tech] || {}), rating } }));
    setResult(null);
  }

  async function submit() {
    setSubmit(true);
    try {
      const params = new URLSearchParams(window.location.search);
      const source = params.get('src') || 'web';
      const res = await callFn('submitServiceRating')({
        token, source,
        ratings: techs
          .filter(t => picks[t]?.rating)
          .map(t => ({ techName: t, rating: picks[t].rating, comment: !goPublic ? (commentDraft || '').trim() || null : null })),
      });
      setResult(res.data);
    } catch (e) {
      setResult({ error: e?.message || 'submit_failed' });
    } finally {
      setSubmit(false);
    }
  }

  if (techs.length === 0) return null;

  // Reject any URL that isn't http(s) (server-side safeUrl already does this,
  // but React won't block javascript:/data: URIs in href, so we re-check
  // before rendering as defense-in-depth).
  const httpReviewUrl =
    typeof result?.googleReviewUrl === 'string' && /^https?:\/\//i.test(result.googleReviewUrl)
      ? result.googleReviewUrl : null;

  // Post-submit: route to Google review (high rating) or thank-you (low rating).
  if (result && !result.error) {
    if (result.routeToGoogle && httpReviewUrl) {
      return (
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⭐</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginBottom: 6 }}>Thanks {data.clientFirstName || ''}!</div>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 18 }}>Would you share your experience on Google? It takes 30 seconds and means the world to us.</div>
          <a href={httpReviewUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-block', background: '#2D7A5F', color: '#fff', fontSize: 14, fontWeight: 700, padding: '12px 28px', borderRadius: 10, textDecoration: 'none' }}>
            ⭐ Leave a Google Review
          </a>
        </div>
      );
    }
    return (
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>Thanks for letting us know.</div>
        <div style={{ fontSize: 13, color: '#888' }}>Your feedback goes straight to the salon owner. We'll do better next time.</div>
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>How was your visit?</div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 18 }}>Tap a star for each technician.</div>

      {techs.map(tech => (
        <div key={tech} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#444', marginBottom: 6 }}>{tech}</div>
          <StarRow value={picks[tech]?.rating || 0} onChange={v => setRating(tech, v)} />
        </div>
      ))}

      {allRated && !goPublic && (
        <textarea
          value={commentDraft}
          onChange={e => setCD(e.target.value.slice(0, 1000))}
          placeholder="What could we have done better? (optional)"
          rows={3}
          style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8, border: '1px solid #d8d8d8', fontSize: 13, fontFamily: 'inherit', marginTop: 4, marginBottom: 12, resize: 'vertical' }}
        />
      )}

      {result?.error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>Submit failed. Please try again.</div>
      )}

      <button
        onClick={submit}
        disabled={!allRated || submitting}
        style={{
          width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
          background: allRated && !submitting ? '#2D7A5F' : '#cdd5d2',
          color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
          cursor: allRated && !submitting ? 'pointer' : 'default',
        }}>
        {submitting ? 'Sending…' : (allRated ? (goPublic ? 'Submit rating →' : 'Send feedback') : 'Tap a star for each tech')}
      </button>
    </div>
  );
}

function StarRow({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={() => onChange(n)}
          aria-label={`Rate ${n} star${n === 1 ? '' : 's'}`}
          style={{
            flex: 1, padding: '10px 0', fontSize: 26, lineHeight: 1,
            border: '1px solid ' + (n <= value ? '#f5b400' : '#e8e8e8'),
            background: n <= value ? '#fffbe6' : '#fff',
            color: n <= value ? '#f5b400' : '#ccc',
            borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
          }}>
          {n <= value ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}
