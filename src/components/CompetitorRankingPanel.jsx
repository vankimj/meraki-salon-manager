import { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { subscribeCompetitorRankings, refreshCompetitorRankings, subscribeWebfrontConfig } from '../lib/firestore';
import { logActivity } from '../lib/logger';

const RADIUS_OPTIONS = [3, 5, 10, 15, 25];
const SORT_OPTIONS = [
  { id: 'score',    label: 'Weighted score' },
  { id: 'rating',   label: 'Rating' },
  { id: 'reviews',  label: 'Review count' },
  { id: 'distance', label: 'Distance' },
];

export default function CompetitorRankingPanel() {
  const { settings, isAdmin, showToast } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [radius, setRadius] = useState(5);
  const [sort, setSort] = useState('score');
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [cacheAgeDays, setCacheAgeDays] = useState(null);
  const [webfrontCfg, setWebfrontCfg] = useState(null);

  const initialRadiusSet = useRef(false);
  useEffect(() => {
    const unsub = subscribeCompetitorRankings(d => {
      setData(d);
      // Only adopt the cached scan radius the first time we load — after
      // that, respect the user's dropdown choice so they can narrow the
      // visible list without a re-fetch.
      if (d?.radiusMiles && !initialRadiusSet.current) {
        setRadius(d.radiusMiles);
        initialRadiusSet.current = true;
      }
      setCacheAgeDays(d?.fetchedAt ? Math.floor((Date.now() - new Date(d.fetchedAt).getTime()) / 86400000) : null);
      setLoading(false);
    });
    const unsubWf = subscribeWebfrontConfig(setWebfrontCfg);
    return () => { unsub(); unsubWf(); };
  }, []);

  const ownPlaceId = (webfrontCfg?.googlePlaceId || settings?.googlePlaceId || '').trim();

  const ranked = useMemo(() => {
    if (!data?.results) return [];
    const within = data.results.filter(r => (r.distanceMiles ?? Infinity) <= radius);
    const sorted = [...within].sort((a, b) => {
      if (sort === 'rating')   return (b.rating || 0) - (a.rating || 0);
      if (sort === 'reviews')  return (b.userRatingCount || 0) - (a.userRatingCount || 0);
      if (sort === 'distance') return (a.distanceMiles || 0) - (b.distanceMiles || 0);
      return (b.score || 0) - (a.score || 0);
    });
    return sorted.map((r, i) => ({ ...r, rank: i + 1, isMeraki: r.placeId === ownPlaceId }));
  }, [data, sort, ownPlaceId, radius]);

  const cachedRadius = data?.radiusMiles ?? 0;
  const needsRefresh = radius > cachedRadius;

  const meraki = ranked.find(r => r.isMeraki);

  const stats = useMemo(() => {
    if (!ranked.length) return null;
    const totalReviews = ranked.reduce((s, r) => s + (r.userRatingCount || 0), 0);
    const ratings = ranked.filter(r => r.userRatingCount >= 5).map(r => r.rating);
    const avgRating = ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0;
    const scoreRank = [...ranked].sort((a, b) => (b.score || 0) - (a.score || 0));
    const merakiScoreRank = meraki ? scoreRank.findIndex(r => r.placeId === ownPlaceId) + 1 : null;
    return { totalCompetitors: ranked.length, totalReviews, avgRating, merakiScoreRank };
  }, [ranked, meraki, ownPlaceId]);

  const handleRefresh = async () => {
    setErr('');
    const address = (webfrontCfg?.address || settings?.address || '').trim();
    if (!address) {
      setErr('Set the salon address in Admin → Webfront → Contact Info first.');
      return;
    }
    setRefreshing(true);
    try {
      await refreshCompetitorRankings({ address, radiusMiles: radius });
      logActivity('refreshCompetitorRankings', { radius });
      showToast?.(`Refreshed: nail salons within ${radius} mi`);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const stars = (n) => '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0));

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>

      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Search radius</div>
            <select value={radius} onChange={e => setRadius(Number(e.target.value))}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #e0e0e0', background: '#fff', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' }}>
              {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} miles</option>)}
            </select>
          </div>
          {isAdmin && <ConfigureReviewsLink />}
          {isAdmin && (
            <button onClick={handleRefresh} disabled={refreshing}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: refreshing ? '#aaa' : '#2D7A5F', color: '#fff', fontSize: 13, fontWeight: 600, cursor: refreshing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {refreshing ? 'Fetching…' : data ? '↻ Refresh from Google' : 'Run first scan'}
            </button>
          )}
        </div>
        {data && (
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 10 }}>
            Showing <strong style={{ color: '#444' }}>{ranked.length}</strong> of {data.resultCount} salons (within {radius} mi) · scan covered {cachedRadius} mi · last refreshed {fmtDate(data.fetchedAt)}
            {cacheAgeDays >= 7 && <span style={{ color: '#f59e0b', marginLeft: 6 }}>· data is {cacheAgeDays} days old, consider refreshing</span>}
          </div>
        )}
        {needsRefresh && data && (
          <div style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 10px', marginTop: 8 }}>
            Selected radius ({radius} mi) is wider than the cached scan ({cachedRadius} mi). Click <strong>Refresh from Google</strong> to pull salons in the extended ring.
          </div>
        )}
        {err && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{err}</div>}
      </div>

      {!data && (
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: '#888', fontSize: 13 }}>
          No ranking data yet. {isAdmin ? 'Pick a radius and click "Run first scan".' : 'Ask an admin to run the first scan.'}
        </div>
      )}

      {data && ranked.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            <StatCard label="Meraki's rank" value={meraki ? `#${stats.merakiScoreRank}` : '—'} sub={meraki ? `of ${stats.totalCompetitors}` : 'not in results'} accent="#2D7A5F" />
            <StatCard label="Meraki rating"     value={meraki ? (meraki.rating || 0).toFixed(1) : '—'} sub={meraki ? `${meraki.userRatingCount} reviews` : ''} accent="#f59e0b" />
            <StatCard label="Area avg rating"  value={stats.avgRating ? stats.avgRating.toFixed(2) : '—'} sub="min 5 reviews" accent="#3D95CE" />
            <StatCard label="Reviews in area"   value={stats.totalReviews.toLocaleString()} sub={`across ${stats.totalCompetitors} salons`} accent="#7c3aed" />
          </div>

          {!meraki && ownPlaceId && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>Meraki's Google Place ID is set but didn't appear in Google's nail-salon results for this radius. Try a wider radius, or verify the Place ID.</span>
              <ConfigureReviewsLink />
            </div>
          )}
          {!ownPlaceId && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>Set Meraki's Google Place ID to highlight your row in the ranking.</span>
              <ConfigureReviewsLink />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em' }}>Sort by</span>
            {SORT_OPTIONS.map(o => (
              <button key={o.id} onClick={() => setSort(o.id)}
                style={{
                  padding: '4px 10px', borderRadius: 12, border: '1px solid ' + (sort === o.id ? '#2D7A5F' : '#e0e0e0'),
                  background: sort === o.id ? '#2D7A5F' : '#fff',
                  color: sort === o.id ? '#fff' : '#666',
                  fontFamily: 'inherit', fontSize: 11, fontWeight: 500, cursor: 'pointer',
                }}>{o.label}</button>
            ))}
          </div>

          <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 70px 80px 70px 70px', padding: '10px 14px', fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
              <div>#</div>
              <div>Salon</div>
              <div style={{ textAlign: 'right' }}>Rating</div>
              <div style={{ textAlign: 'right' }}>Reviews</div>
              <div style={{ textAlign: 'right' }}>Distance</div>
              <div style={{ textAlign: 'right' }}>Score</div>
            </div>
            {ranked.map((r, i) => (
              <div key={r.placeId}
                style={{
                  display: 'grid', gridTemplateColumns: '40px 1fr 70px 80px 70px 70px',
                  padding: r.isMeraki ? '14px 14px' : '10px 14px', alignItems: 'center',
                  borderBottom: i < ranked.length - 1 ? '1px solid #f5f5f5' : 'none',
                  background: r.isMeraki ? 'linear-gradient(90deg, #dcfce7 0%, #f0fdf4 60%, #f0fdf4 100%)' : 'transparent',
                  borderLeft:  r.isMeraki ? '4px solid #2D7A5F' : '4px solid transparent',
                  boxShadow: r.isMeraki ? 'inset 0 0 0 1px rgba(45,122,95,.18)' : 'none',
                  position: 'relative',
                }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: r.isMeraki ? '#2D7A5F' : (r.rank <= 3 ? '#a16207' : '#aaa') }}>
                  {r.rank <= 3 ? ['🥇','🥈','🥉'][r.rank - 1] : r.rank}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: r.isMeraki ? 14 : 13, fontWeight: r.isMeraki ? 700 : 500, color: r.isMeraki ? '#14532d' : '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.isMeraki && <span aria-hidden style={{ marginRight: 6 }}>★</span>}
                    {r.name}
                    {r.isMeraki && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginLeft: 8, padding: '2px 8px', borderRadius: 10, background: '#2D7A5F', letterSpacing: '.04em' }}>YOUR SALON</span>}
                  </div>
                  <div style={{ fontSize: 10, color: r.isMeraki ? '#2D7A5F' : '#bbb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.mapsUrl ? <a href={r.mapsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{r.address}</a> : r.address}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: r.isMeraki ? '#14532d' : '#1a1a1a' }}>{r.rating ? r.rating.toFixed(1) : '—'}</div>
                  <div style={{ fontSize: 9, color: '#f59e0b', letterSpacing: 0.5 }}>{stars(r.rating)}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 13, color: r.isMeraki ? '#14532d' : '#666', fontWeight: r.isMeraki ? 600 : 400 }}>{(r.userRatingCount || 0).toLocaleString()}</div>
                <div style={{ textAlign: 'right', fontSize: 13, color: r.isMeraki ? '#14532d' : '#666', fontWeight: r.isMeraki ? 600 : 400 }}>{r.distanceMiles?.toFixed(1)} mi</div>
                <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: r.isMeraki ? '#2D7A5F' : '#1a1a1a' }}>{(r.score || 0).toFixed(2)}</div>
              </div>
            ))}
          </div>

          <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 10, padding: '14px 16px', marginTop: 14, fontSize: 12, color: '#444', lineHeight: 1.55 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              How the weighted score works
            </div>
            <div style={{ marginBottom: 8 }}>
              <code style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, padding: '2px 8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#2D7A5F', fontWeight: 600 }}>
                score = rating × log₁₀(reviews + 1)
              </code>
            </div>
            <div style={{ marginBottom: 10 }}>
              Star ratings alone are misleading — a single 5★ review beats a 4.8 from 500 customers. Pure review count is also misleading — a popular salon with mediocre service shouldn't outrank a great one. This formula multiplies the two so a salon needs <em>both</em> quality and volume to score high. The <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, background: '#fff', padding: '1px 5px', borderRadius: 4, border: '1px solid #e0e0e0' }}>log₁₀</code> keeps review count from completely dominating: going from 10 → 100 reviews adds the same weight as going from 100 → 1,000.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 10 }}>
              <ScoreExample label="5.0 ★ · 3 reviews"     value={(5.0 * Math.log10(4)).toFixed(2)}   note="great rating, tiny sample" />
              <ScoreExample label="4.8 ★ · 400 reviews"   value={(4.8 * Math.log10(401)).toFixed(2)} note="real social proof" />
              <ScoreExample label="4.2 ★ · 2,000 reviews" value={(4.2 * Math.log10(2001)).toFixed(2)} note="volume can't fully compensate" />
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 10 }}>
              Want a different view? Use the <strong>Sort by</strong> chips above to re-rank by raw rating, review count, or distance — the underlying numbers don't change.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ConfigureReviewsLink({ label = '⚙ Google Reviews config' }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('open-admin', { detail: { tab: 'webfront', scrollTo: 'google-reviews' } }))}
      style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e0e0e0', background: '#fff', color: '#3D95CE', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
      title="Open Admin → Settings → Google Reviews"
    >
      {label}
    </button>
  );
}

function ScoreExample({ label, value, note }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: '#555', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#2D7A5F', marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#999', marginTop: 1 }}>{note}</div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
