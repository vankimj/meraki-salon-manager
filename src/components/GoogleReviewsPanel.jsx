import { useState, useEffect, useMemo } from 'react';
import { fetchReviewReceived, fetchReviewRequests } from '../lib/firestore';
import { ConfigureReviewsLink } from './CompetitorRankingPanel';

// Reusable Google Reviews dashboard panel.
// Shows received reviews, requests sent, conversion rate, and a per-tech leaderboard.
export default function GoogleReviewsPanel() {
  const [received, setReceived] = useState(null);
  const [requests, setRequests] = useState(null);

  useEffect(() => {
    Promise.all([
      fetchReviewReceived().then(setReceived),
      fetchReviewRequests(500).then(setRequests),
    ]).catch(() => { setReceived([]); setRequests([]); });
  }, []);

  const loading = received === null || requests === null;

  const stats = useMemo(() => {
    if (loading) return null;
    const totalReceived  = received.length;
    const totalRequested = requests.filter(r => r.sent).length;
    const conversion     = totalRequested > 0 ? Math.round((totalReceived / totalRequested) * 100) : null;
    const byTech = {};
    received.forEach(r => {
      const t = r.techName || 'Unknown';
      if (!byTech[t]) byTech[t] = { name: t, count: 0, totalRating: 0 };
      byTech[t].count++;
      byTech[t].totalRating += Number(r.rating || 5);
    });
    const leaderboard = Object.values(byTech)
      .map(t => ({ ...t, avg: t.totalRating / t.count }))
      .sort((a, b) => b.count - a.count);
    return { totalReceived, totalRequested, conversion, leaderboard };
  }, [received, requests, loading]);

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>Loading…</div>;

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const stars   = n => '★'.repeat(Math.round(n || 5)) + '☆'.repeat(5 - Math.round(n || 5));

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <ConfigureReviewsLink />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Reviews received</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#2D7A5F' }}>{stats.totalReceived}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Requests sent</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#3D95CE' }}>{stats.totalRequested}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Conversion rate</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: stats.conversion >= 20 ? '#16a34a' : '#f59e0b' }}>
            {stats.conversion !== null ? `${stats.conversion}%` : '—'}
          </div>
          {stats.totalRequested > 0 && (
            <div style={{ fontSize: 11, color: '#bbb', marginTop: 3 }}>{stats.totalReceived} of {stats.totalRequested} requests led to a review</div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>

        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 14 }}>By tech</div>
          {stats.leaderboard.length === 0 ? (
            <div style={{ fontSize: 13, color: '#bbb', textAlign: 'center', padding: '20px 0' }}>No reviews yet</div>
          ) : stats.leaderboard.map((t, i) => (
            <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < stats.leaderboard.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: i === 0 ? '#fef9c3' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: i === 0 ? '#a16207' : '#888', flexShrink: 0 }}>
                {i === 0 ? '🥇' : i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                <div style={{ fontSize: 10, color: '#f59e0b', letterSpacing: 1 }}>{stars(t.avg)}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#2D7A5F' }}>{t.count}</div>
                <div style={{ fontSize: 10, color: '#bbb' }}>{t.avg.toFixed(1)} avg</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 14 }}>Recent reviews</div>
          {received.length === 0 ? (
            <div style={{ fontSize: 13, color: '#bbb', textAlign: 'center', padding: '20px 0' }}>No reviews recorded yet</div>
          ) : received.slice(0, 8).map((r, i) => (
            <div key={r.id} style={{ padding: '8px 0', borderBottom: i < Math.min(received.length, 8) - 1 ? '1px solid #f5f5f5' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{r.clientName || 'Client'}</div>
                  {r.techName && <div style={{ fontSize: 11, color: '#2D7A5F' }}>with {r.techName}</div>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: '#f59e0b', letterSpacing: 1 }}>{stars(r.rating || 5)}</div>
                  <div style={{ fontSize: 10, color: '#bbb', marginTop: 1 }}>{fmtDate(r.confirmedAt || r.createdAt)}</div>
                </div>
              </div>
              {r.text && <div style={{ fontSize: 11, color: '#888', marginTop: 3, fontStyle: 'italic', lineHeight: 1.4 }}>"{r.text.slice(0, 80)}{r.text.length > 80 ? '…' : ''}"</div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 18px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 14 }}>Review requests sent</div>
        {requests.filter(r => r.sent).length === 0 ? (
          <div style={{ fontSize: 13, color: '#bbb', textAlign: 'center', padding: '20px 0' }}>No requests sent yet. Use the "Request Review" button after checkout.</div>
        ) : (
          <div>
            {requests.filter(r => r.sent).slice(0, 20).map((r, i, arr) => {
              const gotReview = received.some(rv => rv.clientId === r.clientId);
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < arr.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{r.clientName || 'Client'}</div>
                    <div style={{ fontSize: 11, color: '#bbb' }}>{fmtDate(r.sentAt || r.createdAt)}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, letterSpacing: '.04em', textTransform: 'uppercase', flexShrink: 0,
                    background: gotReview ? '#f0fdf4' : '#f8f9fa', color: gotReview ? '#16a34a' : '#aaa' }}>
                    {gotReview ? '✓ Reviewed' : 'Pending'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
