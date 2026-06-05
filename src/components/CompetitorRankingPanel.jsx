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

  // Bayesian / IMDb-style weighted rating:
  //   score = (v / (v + m)) · R + (m / (v + m)) · C
  // where R is the salon's rating, v its review count, m the "minimum
  // established" review count, and C the area average. Salons with few
  // reviews get pulled toward C, so a 5★ with 3 reviews can't beat a 4.8
  // with 174. Industry standard for "best of" lists.
  const BAYESIAN_M = 50;
  const { areaAvg, scored } = useMemo(() => {
    if (!data?.results) return { areaAvg: 0, scored: [] };
    const within = data.results.filter(r => (r.distanceMiles ?? Infinity) <= radius);
    const trusted = within.filter(r => (r.userRatingCount || 0) >= 5 && r.rating > 0);
    const C = trusted.length ? trusted.reduce((s, r) => s + r.rating, 0) / trusted.length : 4.3;
    const withScore = within.map(r => {
      const v = r.userRatingCount || 0;
      const R = r.rating || 0;
      const score = v > 0 ? (v / (v + BAYESIAN_M)) * R + (BAYESIAN_M / (v + BAYESIAN_M)) * C : 0;
      return { ...r, score };
    });
    return { areaAvg: C, scored: withScore };
  }, [data, radius]);

  const ranked = useMemo(() => {
    const sorted = [...scored].sort((a, b) => {
      if (sort === 'rating')   return (b.rating || 0) - (a.rating || 0);
      if (sort === 'reviews')  return (b.userRatingCount || 0) - (a.userRatingCount || 0);
      if (sort === 'distance') return (a.distanceMiles || 0) - (b.distanceMiles || 0);
      return (b.score || 0) - (a.score || 0);
    });
    return sorted.map((r, i) => ({ ...r, rank: i + 1, isMeraki: r.placeId === ownPlaceId }));
  }, [scored, sort, ownPlaceId]);

  const cachedRadius = data?.radiusMiles ?? 0;
  const needsRefresh = radius > cachedRadius;

  const meraki = ranked.find(r => r.isMeraki);

  const stats = useMemo(() => {
    if (!ranked.length) return null;
    const totalReviews = ranked.reduce((s, r) => s + (r.userRatingCount || 0), 0);
    const scoreRank = [...ranked].sort((a, b) => (b.score || 0) - (a.score || 0));
    const merakiScoreRank = meraki ? scoreRank.findIndex(r => r.placeId === ownPlaceId) + 1 : null;
    return { totalCompetitors: ranked.length, totalReviews, avgRating: areaAvg, merakiScoreRank };
  }, [ranked, meraki, ownPlaceId, areaAvg]);

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

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: 'var(--pn-text-faint)', fontSize: 14 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>

      <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Search radius</div>
            <select value={radius} onChange={e => setRadius(Number(e.target.value))}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' }}>
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
          <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 10 }}>
            Showing <strong style={{ color: 'var(--pn-text-muted)' }}>{ranked.length}</strong> of {data.resultCount} salons (within {radius} mi) · scan covered {cachedRadius} mi · last refreshed {fmtDate(data.fetchedAt)}
            {cacheAgeDays >= 7 && <span style={{ color: '#f59e0b', marginLeft: 6 }}>· data is {cacheAgeDays} days old, consider refreshing</span>}
          </div>
        )}
        {needsRefresh && data && (
          <div style={{ fontSize: 11, color: 'var(--pn-warning)', background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 10px', marginTop: 8 }}>
            Selected radius ({radius} mi) is wider than the cached scan ({cachedRadius} mi). Click <strong>Refresh from Google</strong> to pull salons in the extended ring.
          </div>
        )}
        {err && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{err}</div>}
      </div>

      {!data && (
        <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13 }}>
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
            <div style={{ background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--pn-warning)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>Meraki's Google Place ID is set but didn't appear in Google's nail-salon results for this radius. Try a wider radius, or verify the Place ID.</span>
              <ConfigureReviewsLink />
            </div>
          )}
          {!ownPlaceId && (
            <div style={{ background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--pn-warning)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>Set Meraki's Google Place ID to highlight your row in the ranking.</span>
              <ConfigureReviewsLink />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Sort by</span>
            {SORT_OPTIONS.map(o => (
              <button key={o.id} onClick={() => setSort(o.id)}
                style={{
                  padding: '4px 10px', borderRadius: 12, border: '1px solid ' + (sort === o.id ? '#2D7A5F' : 'var(--pn-border)'),
                  background: sort === o.id ? '#2D7A5F' : 'var(--pn-surface)',
                  color: sort === o.id ? '#fff' : 'var(--pn-text-muted)',
                  fontFamily: 'inherit', fontSize: 11, fontWeight: 500, cursor: 'pointer',
                }}>{o.label}</button>
            ))}
          </div>

          <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 70px 80px 70px 70px', padding: '10px 14px', fontSize: 10, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid var(--pn-border)', background: 'var(--pn-bg)' }}>
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
                  borderBottom: i < ranked.length - 1 ? '1px solid var(--pn-border)' : 'none',
                  background: r.isMeraki ? 'linear-gradient(90deg, #dcfce7 0%, #f0fdf4 60%, #f0fdf4 100%)' : 'transparent',
                  borderLeft:  r.isMeraki ? '4px solid #2D7A5F' : '4px solid transparent',
                  boxShadow: r.isMeraki ? 'inset 0 0 0 1px rgba(45,122,95,.18)' : 'none',
                  position: 'relative',
                }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: r.isMeraki ? '#2D7A5F' : (r.rank <= 3 ? '#a16207' : 'var(--pn-text-faint)') }}>
                  {r.rank <= 3 ? ['🥇','🥈','🥉'][r.rank - 1] : r.rank}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: r.isMeraki ? 14 : 13, fontWeight: r.isMeraki ? 700 : 500, color: r.isMeraki ? '#14532d' : 'var(--pn-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.isMeraki && <span aria-hidden style={{ marginRight: 6 }}>★</span>}
                    {r.name}
                    {r.isMeraki && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginLeft: 8, padding: '2px 8px', borderRadius: 10, background: '#2D7A5F', letterSpacing: '.04em' }}>YOUR SALON</span>}
                  </div>
                  <div style={{ fontSize: 10, color: r.isMeraki ? '#2D7A5F' : 'var(--pn-text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.mapsUrl ? <a href={r.mapsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{r.address}</a> : r.address}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: r.isMeraki ? '#14532d' : 'var(--pn-text)' }}>{r.rating ? r.rating.toFixed(1) : '—'}</div>
                  <div style={{ fontSize: 9, color: '#f59e0b', letterSpacing: 0.5 }}>{stars(r.rating)}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 13, color: r.isMeraki ? '#14532d' : 'var(--pn-text-muted)', fontWeight: r.isMeraki ? 600 : 400 }}>{(r.userRatingCount || 0).toLocaleString()}</div>
                <div style={{ textAlign: 'right', fontSize: 13, color: r.isMeraki ? '#14532d' : 'var(--pn-text-muted)', fontWeight: r.isMeraki ? 600 : 400 }}>{r.distanceMiles?.toFixed(1)} mi</div>
                <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: r.isMeraki ? '#2D7A5F' : 'var(--pn-text)' }}>{(r.score || 0).toFixed(2)}</div>
              </div>
            ))}
          </div>

          <div style={{ background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: '14px 16px', marginTop: 14, fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.55 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              How the weighted score works (Bayesian)
            </div>
            <div style={{ marginBottom: 8 }}>
              <code style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 6, padding: '2px 8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#2D7A5F', fontWeight: 600 }}>
                score = (v/(v+m)) · R + (m/(v+m)) · C
              </code>
            </div>
            <div style={{ marginBottom: 10 }}>
              Same approach IMDb's Top 250 and Yelp's "Best of" use. Each salon's rating <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, background: 'var(--pn-surface)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--pn-border)' }}>R</code> with <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, background: 'var(--pn-surface)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--pn-border)' }}>v</code> reviews is blended with the area's overall average <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, background: 'var(--pn-surface)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--pn-border)' }}>C</code> (currently <strong>{areaAvg.toFixed(2)}★</strong>) using <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, background: 'var(--pn-surface)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--pn-border)' }}>m={BAYESIAN_M}</code> as the "established review count" threshold. Low-review shops get pulled toward the area average so a 5★ with 3 reviews can't outrank a 4.8 with 174. As a salon's review count grows past <em>m</em>, the score converges on its true rating.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 10 }}>
              <ScoreExample label="5.0 ★ · 3 reviews"     value={bayesianFmt(5.0,    3, areaAvg)}  note="rating pulled to area avg" />
              <ScoreExample label="4.8 ★ · 174 reviews"   value={bayesianFmt(4.8,  174, areaAvg)}  note="rating mostly trusted" />
              <ScoreExample label="4.1 ★ · 634 reviews"   value={bayesianFmt(4.1,  634, areaAvg)}  note="lots of reviews — rating dominates" />
            </div>
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 10 }}>
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
      style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', color: '#3D95CE', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
      title="Open Admin → Settings → Google Reviews"
    >
      {label}
    </button>
  );
}

function bayesianFmt(R, v, C) {
  const m = 50;
  if (!v) return '—';
  return ((v / (v + m)) * R + (m / (v + m)) * C).toFixed(2);
}

function ScoreExample({ label, value, note }) {
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#2D7A5F', marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 1 }}>{note}</div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
