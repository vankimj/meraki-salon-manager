import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { subscribeGoogleReviews, subscribeWebfrontConfig, fetchEmployees, refreshGoogleReviewsCache,
         subscribeGoogleBusinessAuth, subscribeGoogleReviewsLog, syncGoogleBusinessReviews } from '../lib/firestore';
import { logActivity } from '../lib/logger';
import { ConfigureReviewsLink } from './CompetitorRankingPanel';

const SORT_OPTIONS = [
  { id: 'date-desc',    label: 'Newest first' },
  { id: 'date-asc',     label: 'Oldest first' },
  { id: 'rating-desc',  label: 'Highest rated' },
  { id: 'rating-asc',   label: 'Lowest rated' },
  { id: 'mentions',     label: 'Mentions a tech' },
];

export default function PublicReviewsPanel() {
  const { settings, isAdmin, showToast } = useApp();
  const [data, setData]           = useState(null);
  const [webfrontCfg, setWfCfg]   = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [sort, setSort]           = useState('date-desc');
  const [filterTech, setFilter]   = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr]             = useState('');
  const [gbpAuth, setGbpAuth]     = useState(null);
  const [fullReviews, setFullReviews] = useState(null);

  useEffect(() => {
    const unsubR = subscribeGoogleReviews(d => { setData(d); setLoading(false); });
    const unsubW = subscribeWebfrontConfig(setWfCfg);
    const unsubG = subscribeGoogleBusinessAuth(setGbpAuth);
    const unsubL = subscribeGoogleReviewsLog(setFullReviews);
    fetchEmployees().then(es => setEmployees(es || [])).catch(() => setEmployees([]));
    return () => { unsubR(); unsubW(); unsubG(); unsubL(); };
  }, []);

  // Use the full Business Profile sync when available, otherwise fall back
  // to the 5-review Places API cache so unconfigured tenants still see something.
  const useFullSource = !!(gbpAuth && fullReviews && fullReviews.length > 0);
  const sourceReviews = useFullSource
    ? fullReviews
    : (data?.reviews || []).map((r, i) => ({ ...r, id: `places-${i}` }));

  // Build per-tech regex matchers from name + social handles.
  const matchers = useMemo(() => {
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return employees
      .filter(e => !e.archived && (e.name || '').trim())
      .map(e => {
        const tokens = new Set();
        const name = e.name.trim();
        tokens.add(name);
        const parts = name.split(/\s+/);
        if (parts[0]) tokens.add(parts[0]);                          // first name
        // First + last initial w/ optional period: "Yasmin D" or "Yasmin D."
        if (parts.length >= 2) tokens.add(`${parts[0]} ${parts[1][0]}`);
        // Social handles
        ['instagram', 'tiktok', 'facebook', 'venmo'].forEach(f => {
          const h = String(e[f] || '').replace(/^@/, '').trim();
          if (h && h.length >= 3) tokens.add(h);
        });
        const list = [...tokens].filter(Boolean).sort((a, b) => b.length - a.length); // longest first to win ties
        const re = list.length ? new RegExp(`\\b(${list.map(escape).join('|')})\\b`, 'i') : null;
        return { id: e.id, name, re };
      });
  }, [employees]);

  const enriched = useMemo(() => {
    const reviews = sourceReviews;
    return reviews.map((r, i) => {
      const text = r.text || '';
      const mentioned = [];
      const tokenHits = new Set();
      matchers.forEach(m => {
        if (!m.re) return;
        const gre = new RegExp(m.re.source, 'gi');
        let hit;
        let matchedHere = false;
        while ((hit = gre.exec(text)) !== null) {
          tokenHits.add(hit[0]);
          matchedHere = true;
        }
        if (matchedHere) mentioned.push(m);
      });
      return {
        ...r,
        idx: i,
        mentions:    mentioned.map(m => m.name),
        mentionIds:  mentioned.map(m => m.id),
        matchedText: [...tokenHits],
        ts: r.publishTime ? new Date(r.publishTime).getTime() : null,
      };
    });
  }, [sourceReviews, matchers]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (filterTech === '__any__') list = list.filter(r => r.mentions.length > 0);
    else if (filterTech) list = list.filter(r => r.mentionIds.includes(filterTech));
    const cmp = {
      'date-desc':   (a, b) => (b.ts ?? 0) - (a.ts ?? 0),
      'date-asc':    (a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity),
      'rating-desc': (a, b) => (b.rating || 0) - (a.rating || 0),
      'rating-asc':  (a, b) => (a.rating || 0) - (b.rating || 0),
      'mentions':    (a, b) => b.mentions.length - a.mentions.length,
    }[sort];
    return [...list].sort(cmp);
  }, [enriched, filterTech, sort]);

  const stats = useMemo(() => {
    const list = enriched;
    if (!list.length) return null;
    const sum = list.reduce((s, r) => s + (r.rating || 0), 0);
    const avg = sum / list.length;
    const withMentions = list.filter(r => r.mentions.length > 0).length;
    const techCounts = {};
    list.forEach(r => r.mentions.forEach(n => { techCounts[n] = (techCounts[n] || 0) + 1; }));
    const topTech = Object.entries(techCounts).sort((a, b) => b[1] - a[1])[0];
    return { count: list.length, avg, withMentions, topTech };
  }, [enriched]);

  const handleRefresh = async () => {
    setErr('');
    setRefreshing(true);
    try {
      if (gbpAuth) {
        const result = await syncGoogleBusinessReviews();
        logActivity('syncGoogleBusinessReviews', { count: result?.written });
        showToast?.(`Synced ${result?.written || 0} reviews via Business Profile`);
      } else {
        const placeId = (webfrontCfg?.googlePlaceId || settings?.googlePlaceId || '').trim();
        if (!placeId) {
          setErr('Set the Google Place ID in Admin → Webfront → ⭐ Google Reviews first, or connect Business Profile for the full review history.');
          return;
        }
        const result = await refreshGoogleReviewsCache(placeId);
        logActivity('refreshPublicReviews', { count: result?.count });
        showToast?.(`Refreshed ${result?.count || 0} reviews (Places API cap)`);
      }
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const fmtDate = (iso, rel) => {
    if (iso) return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return rel || '—';
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>Loading…</div>;

  const totalOnGoogle = data?.userRatingCount || 0;
  const pulled = useFullSource ? fullReviews.length : (data?.reviews?.length || 0);
  const hidden = useFullSource ? 0 : Math.max(0, totalOnGoogle - pulled);

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>

      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em' }}>Public Google Reviews</div>
            {useFullSource ? (
              <div style={{ fontSize: 11, color: '#15803d', marginTop: 4 }}>
                ✓ Business Profile · {pulled} reviews · last synced {gbpAuth?.lastSyncAt ? new Date(gbpAuth.lastSyncAt).toLocaleString() : 'never'}
              </div>
            ) : data?.refreshedAt && (
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                Last refreshed {new Date(data.refreshedAt).toLocaleString()} · pulled {pulled} of {totalOnGoogle} reviews (Places API cap)
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <ConfigureReviewsLink />
            {isAdmin && (
              <button onClick={handleRefresh} disabled={refreshing}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: refreshing ? '#aaa' : '#2D7A5F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: refreshing ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                {refreshing ? 'Fetching…' : '↻ Refresh from Google'}
              </button>
            )}
          </div>
        </div>
        {err && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{err}</div>}
        {hidden > 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', marginTop: 10, fontSize: 11, color: '#92400e', lineHeight: 1.5 }}>
            <strong>{hidden} more reviews exist on Google but Google's Places API caps public access at 5.</strong> Pulling all {totalOnGoogle} would require connecting your Google Business Profile (separate OAuth integration — ask if you want this set up).
          </div>
        )}
      </div>

      {!data?.reviews?.length ? (
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: '#888', fontSize: 13 }}>
          No reviews cached yet. {isAdmin ? 'Click "Refresh from Google" to pull.' : 'Ask an admin to pull reviews.'}
        </div>
      ) : (
        <>
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
              <Stat label="Reviews loaded"   value={stats.count}                                accent="#2D7A5F" />
              <Stat label="Avg rating"       value={`${stats.avg.toFixed(1)}★`}                 accent="#f59e0b" />
              <Stat label="Mention a tech"   value={`${stats.withMentions} / ${stats.count}`}   accent="#3D95CE" />
              <Stat label="Most mentioned"   value={stats.topTech ? stats.topTech[0] : '—'}     sub={stats.topTech ? `${stats.topTech[1]}×` : ''} accent="#7c3aed" />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em' }}>Sort</span>
              <select value={sort} onChange={e => setSort(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e0e0e0', background: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer' }}>
                {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em' }}>Filter</span>
              <select value={filterTech} onChange={e => setFilter(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e0e0e0', background: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', minWidth: 180 }}>
                <option value="">All reviews</option>
                <option value="__any__">Any tech mentioned</option>
                <option disabled>──────────</option>
                {employees.filter(e => !e.archived && e.name).map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>
              Showing {filtered.length} of {enriched.length}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((r) => (
              <div key={r.idx} style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {r.photoUrl
                    ? <img src={r.photoUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
                    : <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#888', fontSize: 13, fontWeight: 600 }}>{(r.name || '?').slice(0, 1)}</div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                      {r.authorUrl ? (
                        <a href={r.authorUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', textDecoration: 'none' }}>{r.name}</a>
                      ) : (
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{r.name}</span>
                      )}
                      <span style={{ color: '#f59e0b', fontSize: 11, letterSpacing: 1 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                      <span style={{ fontSize: 11, color: '#aaa' }}>· {fmtDate(r.publishTime, r.date)}</span>
                    </div>
                    {r.mentions.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, marginBottom: 6 }}>
                        {r.mentions.map((n, i) => (
                          <span key={i} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#dcfce7', color: '#14532d', letterSpacing: '.03em' }}>👋 {n}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: '#444', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                      {r.matchedText.length > 0 ? highlight(r.text, r.matchedText) : r.text}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '30px 20px', textAlign: 'center', color: '#888', fontSize: 13 }}>
                No reviews match this filter.
              </div>
            )}
          </div>

          <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 10, padding: '12px 14px', marginTop: 14, fontSize: 11, color: '#666', lineHeight: 1.55 }}>
            <strong style={{ color: '#444' }}>How tech detection works:</strong> we scan each review's text for each tech's full name, first name, first + last initial, and any Instagram / TikTok / Venmo / Facebook handle stored on their employee record. To improve coverage for a tech who's mentioned by a nickname (e.g. "Sammy" for "Samantha"), add the nickname as their display name or stash the alias in their Instagram handle.
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function highlight(text, tokens) {
  if (!tokens.length || !text) return text;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sorted = [...tokens].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${sorted.map(escape).join('|')})`, 'gi');
  const lowerSet = new Set(tokens.map(t => t.toLowerCase()));
  const parts = text.split(re);
  return parts.map((p, i) => lowerSet.has((p || '').toLowerCase())
    ? <mark key={i} style={{ background: '#fef3c7', color: '#78350f', padding: '0 2px', borderRadius: 3 }}>{p}</mark>
    : <span key={i}>{p}</span>
  );
}
