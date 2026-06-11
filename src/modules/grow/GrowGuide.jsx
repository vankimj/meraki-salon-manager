// Launch & Grow (Phase 2) — guided business-setup + growth module.
// Two lenses over the same content (src/data/launchGuide.js):
//   Launch — a top-to-bottom guided sequence for a new salon
//   Audit  — surfaces only the gaps (high-risk first) for an existing salon
// Per-item status auto-derives from live config (Stripe/SMS/EIN/socials/…),
// so deep-link items self-complete; everything else is manual check-off.
// Mounted behind the `launchGrow` feature flag (ships dark).

import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import Button from '../../components/Button';
import { resizeImg } from '../../utils/helpers';
import {
  subscribeLaunchChecklist, setLaunchItemStatus, setLaunchMode,
  subscribeTenantSms, subscribeGoogleBusinessAuth, subscribeWebfrontConfig,
  growCoachSuggest, growDraftDocument, growPhotoCritique,
  patchWebfrontConfig, uploadPortfolioPhoto,
  subscribeInstagramAuth, subscribeInstagramStats, startInstagramAuth, syncInstagramNow, disconnectInstagram,
} from '../../lib/firestore';
import {
  LAUNCH_GROUPS, FLAVORS, resolveHref,
  effectiveItemStatus, groupProgress, overallProgress, auditGaps,
} from '../../data/launchGuide';

const BRAND = { green: '#2D7A5F', blue: '#3D95CE', teal: '#3D9E8A' };
const inp   = { fontFamily: 'inherit', fontSize: 13, padding: '8px 11px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', color: 'var(--pn-text)', outline: 'none', width: '100%', boxSizing: 'border-box' };
const panel = { marginTop: 10, padding: 12, border: '1px solid var(--pn-border)', borderRadius: 10, background: 'var(--pn-bg)' };

// Local-time day delta for a YYYY-MM-DD date-only string (avoids the UTC off-by-one).
function daysSince(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000);
}

export default function GrowGuide({ onOpenWizard, onOpenAdmin, onNavigate }) {
  const { isAdmin, settings, showToast } = useApp();
  const [checklist, setChecklist] = useState(null);
  const [sms, setSms]             = useState(null);
  const [googleAuth, setGoogleAuth] = useState(null);
  const [webfront, setWebfront]   = useState(null);
  const [instagramAuth, setInstagramAuth]   = useState(null);
  const [instagramStats, setInstagramStats] = useState(null);

  useEffect(() => subscribeLaunchChecklist(setChecklist), []);
  useEffect(() => subscribeTenantSms(setSms), []);
  useEffect(() => subscribeGoogleBusinessAuth(setGoogleAuth), []);
  useEffect(() => subscribeWebfrontConfig(setWebfront), []);
  useEffect(() => subscribeInstagramAuth(setInstagramAuth), []);
  useEffect(() => subscribeInstagramStats(setInstagramStats), []);

  // Owner-only (defense-in-depth; the tile is already cap-gated).
  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 13 }}>Owner access required.</div>;
  }

  const progress = checklist?.items || {};
  const mode = checklist?.mode === 'audit' ? 'audit' : 'launch';
  const ctx = {
    settings: settings || {},
    sms,
    googleAuth,
    instagramAuth,
    instagramStats,
    webfront: webfront || {},
  };
  const state = settings?.brandState || settings?.locations?.[0]?.state || '';

  const overall  = overallProgress(LAUNCH_GROUPS, progress, ctx);
  const gaps     = auditGaps(LAUNCH_GROUPS, progress, ctx);
  const highRisk = gaps.filter(g => g.risk === 'high').length;

  function markItem(id, status) {
    setLaunchItemStatus(id, { status, completedAt: status === 'done' ? new Date().toISOString() : null })
      .catch(() => showToast?.('Could not save — try again.'));
  }
  function toggleMode(next) { setLaunchMode(next).catch(() => {}); }
  function patchItem(id, patch) { setLaunchItemStatus(id, patch).catch(() => showToast?.('Could not save — try again.')); }

  function handleDeepLink(item) {
    const dl = item.deepLink;
    if (!dl) return;
    if (dl.kind === 'wizard')      onOpenWizard?.(dl.phase);
    else if (dl.kind === 'admin')  onOpenAdmin?.({ tab: dl.tab, scrollTo: dl.scrollTo });
    else if (dl.kind === 'module') onNavigate?.(dl.target);
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '8px 4px 60px' }}>
      <GrowHeader overall={overall} mode={mode} onMode={toggleMode} gaps={gaps.length} highRisk={highRisk} />

      {mode === 'audit' ? (
        <div style={{ marginTop: 16 }}>
          {gaps.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13 }}>
              🎉 No gaps found — you’re all set. Switch to Launch mode to review anything.
            </div>
          ) : gaps.map(item => (
            <LaunchItemCard key={item.id} item={item} status={item.status} entry={progress[item.id]}
              state={state} ctx={ctx} onMark={markItem} onDeepLink={handleDeepLink} patchItem={patchItem} auditMode />
          ))}
        </div>
      ) : (
        LAUNCH_GROUPS.map(group => (
          <GroupSection key={group.id} group={group} progress={progress} ctx={ctx}
            state={state} onMark={markItem} onDeepLink={handleDeepLink} patchItem={patchItem} />
        ))
      )}
    </div>
  );
}

function GrowHeader({ overall, mode, onMode, gaps, highRisk }) {
  const summary = mode === 'audit'
    ? `${gaps} ${gaps === 1 ? 'gap' : 'gaps'}${highRisk ? ` · ${highRisk} high-priority` : ''}`
    : `${overall.done} of ${overall.total} complete`;
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 16, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--pn-text)' }}>Launch &amp; Grow</div>
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 2 }}>Everything beyond the chairs — set up and grow your business.</div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--pn-surface-muted)', borderRadius: 9, padding: 3 }}>
          {[['launch', 'Launch'], ['audit', 'Audit']].map(([v, lbl]) => {
            const on = mode === v;
            return (
              <button key={v} onClick={() => onMode(v)}
                style={{ padding: '6px 16px', fontSize: 12, fontWeight: on ? 700 : 500, fontFamily: 'inherit', cursor: 'pointer', border: 'none', borderRadius: 7, background: on ? 'var(--pn-surface)' : 'transparent', color: on ? BRAND.green : 'var(--pn-text-muted)', boxShadow: on ? '0 1px 3px var(--pn-shadow)' : 'none' }}>
                {lbl}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 5 }}>
          <span>{summary}</span><span>{overall.pct}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 6, background: 'var(--pn-surface-muted)', overflow: 'hidden' }}>
          <div style={{ width: `${overall.pct}%`, height: '100%', background: `linear-gradient(90deg, ${BRAND.green}, ${BRAND.teal})`, transition: 'width .3s' }} />
        </div>
      </div>
    </div>
  );
}

function GroupSection({ group, progress, ctx, state, onMark, onDeepLink, patchItem }) {
  const gp = groupProgress(group, progress, ctx);
  const allDone = gp.total > 0 && gp.done === gp.total;
  const [open, setOpen] = useState(!allDone); // finished groups start collapsed
  return (
    <div style={{ marginTop: 16 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '4px 2px', textAlign: 'left' }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', fontSize: 10, color: 'var(--pn-text-faint)' }}>▶</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)' }}>{group.title}</span>
        <span style={{ fontSize: 11, color: allDone ? BRAND.green : 'var(--pn-text-faint)', fontWeight: 600 }}>{gp.done}/{gp.total}</span>
      </button>
      {open && (
        <>
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', margin: '2px 2px 10px 24px' }}>{group.blurb}</div>
          {group.items.map(item => (
            <LaunchItemCard key={item.id} item={item}
              status={effectiveItemStatus(item, progress[item.id], ctx)} entry={progress[item.id]}
              state={state} ctx={ctx} onMark={onMark} onDeepLink={onDeepLink} patchItem={patchItem} />
          ))}
        </>
      )}
    </div>
  );
}

const STATUS_PILL = {
  done:        { bg: 'var(--pn-success-bg)', fg: 'var(--pn-success)',    label: '✓ Done' },
  in_progress: { bg: 'var(--pn-info-bg)',    fg: 'var(--pn-info)',       label: 'In progress' },
  pending:     { bg: 'var(--pn-surface-muted)', fg: 'var(--pn-text-faint)', label: 'To do' },
};

function LaunchItemCard({ item, status, entry, state, ctx, onMark, onDeepLink, patchItem, auditMode }) {
  const [open, setOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const pill = STATUS_PILL[status] || STATUS_PILL.pending;
  const done = status === 'done';
  const risk = item.risk === 'high'
    ? { bg: '#fef2f2', fg: '#b91c1c', label: 'High priority' }
    : item.risk === 'med' ? { bg: '#fffbeb', fg: '#b45309', label: 'Important' } : null;

  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: '14px 16px', marginBottom: 10, marginLeft: auditMode ? 0 : 24, opacity: done ? 0.72 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)', textDecoration: done ? 'line-through' : 'none' }}>{item.title}</span>
            {risk && !done && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: risk.bg, color: risk.fg }}>{risk.label}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--pn-text-muted)', marginTop: 4, lineHeight: 1.5 }}>{item.why}</div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: pill.bg, color: pill.fg, whiteSpace: 'nowrap' }}>{pill.label}</span>
      </div>

      {item.steps?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setOpen(o => !o)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: BRAND.blue, padding: 0, fontWeight: 600 }}>
            {open ? 'Hide steps ▴' : 'How to ▾'}
          </button>
          {open && (
            <ol style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--pn-text)', lineHeight: 1.6 }}>
              {item.steps.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}
            </ol>
          )}
          {open && item.tip && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--pn-text-muted)', background: 'var(--pn-surface-muted)', borderRadius: 8, padding: '8px 10px' }}>💡 {item.tip}</div>
          )}
        </div>
      )}

      {item.capture && <CaptureForm item={item} ctx={ctx} />}
      {item.id === 'instagram-monitor' && <InstagramPanel ctx={ctx} item={item} entry={entry} patchItem={patchItem} />}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {item.links?.length > 0 && <ExternalLinks links={item.links} state={state} />}
        {item.deepLink && !item.capture && (
          <Button variant="primary" onClick={() => onDeepLink(item)}>Open →</Button>
        )}
        {item.ai && (
          <Button variant="secondary" onClick={() => setAiOpen(true)} style={{ borderColor: '#c4b5fd', color: '#7c3aed' }}>
            ✨ {item.ai.label}
          </Button>
        )}
        <div style={{ flex: 1 }} />
        {done
          ? <Button variant="ghost" onClick={() => onMark(item.id, 'pending')}>Undo</Button>
          : <Button variant="secondary" onClick={() => onMark(item.id, 'done')}>Mark done</Button>}
      </div>
      {aiOpen && <AiCoachModal ai={item.ai} onClose={() => setAiOpen(false)} />}
    </div>
  );
}

function ExternalLinks({ links, state }) {
  return links.map((link, i) => (
    <a key={i} href={resolveHref(link, { state })} target="_blank" rel="noopener noreferrer"
      style={{ fontSize: 12, fontWeight: 600, color: BRAND.blue, textDecoration: 'none', border: '1px solid var(--pn-border)', borderRadius: 6, padding: '5px 10px', background: 'var(--pn-surface)' }}>
      {link.label} ↗
    </a>
  ));
}

// ── Capture forms — inline data entry that bootstraps the software ─────────
function CaptureForm({ item, ctx }) {
  const k = item.capture?.kind;
  if (k === 'ein')       return <CaptureEin />;
  if (k === 'socials')   return <CaptureSocials ctx={ctx} />;
  if (k === 'portfolio') return <PhotoStudio ctx={ctx} />;
  return null;
}

function CaptureEin() {
  const { settings, updateSettings, showToast } = useApp();
  const [ein, setEin] = useState(settings?.ein || '');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await updateSettings({ ...settings, ein: ein.trim() || null }); showToast?.('EIN saved'); }
    catch { showToast?.('Could not save'); }
    finally { setSaving(false); }
  }
  return (
    <div style={panel}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={ein} onChange={e => setEin(e.target.value)} placeholder="XX-XXXXXXX" style={inp} />
        <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
}

function CaptureSocials({ ctx }) {
  const { showToast } = useApp();
  const wf = ctx.webfront || {};
  const [ig, setIg] = useState(wf.instagram || '');
  const [fb, setFb] = useState(wf.facebook || '');
  const [tt, setTt] = useState(wf.tiktok || '');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await patchWebfrontConfig({ instagram: ig.trim(), facebook: fb.trim(), tiktok: tt.trim() }); showToast?.('Social links saved'); }
    catch { showToast?.('Could not save'); }
    finally { setSaving(false); }
  }
  return (
    <div style={panel}>
      <div style={{ display: 'grid', gap: 6 }}>
        <input value={ig} onChange={e => setIg(e.target.value)} placeholder="Instagram @handle" style={inp} />
        <input value={fb} onChange={e => setFb(e.target.value)} placeholder="Facebook page" style={inp} />
        <input value={tt} onChange={e => setTt(e.target.value)} placeholder="TikTok @handle" style={inp} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
}

function PhotoStudio({ ctx }) {
  const { showToast } = useApp();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [crit, setCrit] = useState(null); // { url, loading, text, err }
  const photos = ctx.webfront?.portfolioUploads || [];

  async function onFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const urls = [];
      for (const f of files) { const u = await uploadPortfolioPhoto(f); if (u) urls.push(u); }
      if (urls.length) await patchWebfrontConfig({ portfolioUploads: [...photos, ...urls] });
      showToast?.(`Added ${urls.length} photo${urls.length === 1 ? '' : 's'}`);
    } catch { showToast?.('Upload failed'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function critique(url) {
    const reqUrl = url;
    setCrit({ url, loading: true });
    try {
      const dataUrl = await resizeImg(url, 1200, 1200, 0.82);
      const b64 = String(dataUrl).split(',')[1] || '';
      const res = await growPhotoCritique({ imageData: b64, mediaType: 'image/jpeg', kind: 'work' });
      setCrit(c => (c && c.url === reqUrl ? { url: reqUrl, text: res?.review || '' } : c)); // ignore stale resolutions
    } catch (e) {
      const msg = /fetch|network|load|cors/i.test(e?.message || '') ? 'Could not load this image to review it (check Storage CORS).' : (e?.message || 'Could not critique this photo.');
      setCrit(c => (c && c.url === reqUrl ? { url: reqUrl, err: msg } : c));
    }
  }

  return (
    <div style={panel}>
      <input ref={fileRef} type="file" accept="image/*" multiple onChange={onFiles} style={{ display: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="primary" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? 'Uploading…' : '+ Add photos'}</Button>
        <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{photos.length} on your site · tap ✨ for AI feedback</span>
      </div>
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {photos.slice(0, 12).map((url, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--pn-border)' }} />
              <button onClick={() => critique(url)} title="AI critique"
                style={{ position: 'absolute', bottom: 2, right: 2, border: 'none', borderRadius: 6, background: 'rgba(124,58,237,.92)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 5px', cursor: 'pointer', fontFamily: 'inherit' }}>✨</button>
            </div>
          ))}
        </div>
      )}
      {crit && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--pn-text)', background: 'var(--pn-surface-muted)', borderRadius: 8, padding: '10px 12px' }}>
          {crit.loading ? 'Reviewing your photo… ✨' : crit.err ? <span style={{ color: '#ef4444' }}>{crit.err}</span> : <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, lineHeight: 1.5 }}>{crit.text}</pre>}
        </div>
      )}
    </div>
  );
}

// ── Instagram: live cadence when connected, manual tracker otherwise ───────
function InstagramPanel({ ctx, item, entry, patchItem }) {
  const { showToast } = useApp();
  const auth = ctx.instagramAuth;
  const stats = ctx.instagramStats;
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onMsg(e) { if (e.data?.type === 'instagram-auth') showToast?.(e.data.ok ? '✓ Instagram connected' : '✗ Connect failed'); }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [showToast]);

  function connect() {
    startInstagramAuth().then(({ authUrl }) => {
      const w = window.open(authUrl, 'ig-auth', 'width=560,height=720');
      if (!w) showToast?.('Popup blocked — allow popups and try again.');
    }).catch(e => {
      showToast?.(/not available|not configured/i.test(e?.message || '')
        ? 'Instagram auto-connect is coming soon — use the manual tracker below.'
        : (e?.message || 'Could not start connect.'));
    });
  }
  async function refresh() { setBusy(true); try { await syncInstagramNow(); showToast?.('Refreshed'); } catch { showToast?.('Refresh failed'); } finally { setBusy(false); } }
  async function disconnect() {
    if (!window.confirm("Disconnect Instagram? You'll need to reconnect via Instagram (Meta consent + page link) to resume cadence tracking.")) return;
    setBusy(true); try { await disconnectInstagram(); showToast?.('Disconnected'); } catch { /* noop */ } finally { setBusy(false); }
  }

  if (auth) {
    const stale = stats?.daysSinceLastPost != null && stats.daysSinceLastPost > 7;
    return (
      <div style={panel}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)' }}>@{auth.username || 'connected'}</div>
        {stats ? (
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 4 }}>
            {stats.posts7d} this week · {stats.avgPerWeek}/wk avg · last post {stats.daysSinceLastPost != null ? `${stats.daysSinceLastPost}d ago` : '—'}
            <div style={{ marginTop: 4, color: stale ? '#b45309' : BRAND.green }}>
              {stale ? `You haven't posted in ${stats.daysSinceLastPost} days — aim for ~3/week. Try “Get post ideas” above.` : 'Nice cadence — keep it up!'}
            </div>
          </div>
        ) : <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginTop: 4 }}>No stats yet — Refresh to pull your latest posts.</div>}
        {auth.lastSyncError && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: '#b45309', background: '#fffbeb', borderRadius: 8, padding: '7px 10px' }}>
            ⚠ Couldn’t refresh recently — your connection may have expired.{' '}
            <button onClick={connect} style={{ background: 'none', border: 'none', color: '#7c3aed', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Reconnect</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Button variant="secondary" disabled={busy} onClick={refresh}>Refresh</Button>
          <Button variant="ghost" disabled={busy} onClick={disconnect}>Disconnect</Button>
        </div>
      </div>
    );
  }

  const last = entry?.lastPostedAt;
  const daysAgo = last ? daysSince(last) : null;
  return (
    <div style={panel}>
      <div style={{ fontSize: 11.5, color: 'var(--pn-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
        First, in the Instagram app set your account to <strong>Business</strong> or <strong>Creator</strong> (Settings → Account type) and link it to a <strong>Facebook Page</strong> — then connect here. You’ll authorize in a Meta popup; we never see your password.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={connect} style={{ background: '#7c3aed' }}>Connect Instagram</Button>
        <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>or track it manually:</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>Last posted</label>
        <input type="date" value={last ? String(last).slice(0, 10) : ''} onChange={e => patchItem(item.id, { lastPostedAt: e.target.value || null })} style={{ ...inp, width: 'auto' }} />
      </div>
      {daysAgo != null && (
        <div style={{ fontSize: 12, marginTop: 6, color: daysAgo > 7 ? '#b45309' : BRAND.green }}>
          {daysAgo > 7 ? `${daysAgo} days since your last post — time to post! Use “Get post ideas” above.` : `Posted ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago — great cadence.`}
        </div>
      )}
    </div>
  );
}

// AI coach result modal — calls the suggest/draft callable, shows the output
// with copy-to-clipboard. Legal drafts carry a server-injected disclaimer.
function AiCoachModal({ ai, onClose }) {
  const [loading, setLoading] = useState(true);
  const [text, setText]       = useState('');
  const [err, setErr]         = useState('');
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = ai.fn === 'draft' ? await growDraftDocument(ai.kind) : await growCoachSuggest(ai.kind);
        if (alive) setText(res?.text || '');
      } catch (e) {
        if (alive) setErr(e?.message || 'Could not generate — try again.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [ai.fn, ai.kind]);

  function copy() {
    navigator.clipboard?.writeText(text)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 12px 48px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)' }}>✨ {ai.label}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--pn-text-faint)' }}>×</button>
        </div>
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          {loading
            ? <div style={{ textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13, padding: 30 }}>Writing… ✨</div>
            : err
              ? <div style={{ color: '#ef4444', fontSize: 13 }}>{err}</div>
              : <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: 'var(--pn-text)', lineHeight: 1.6, margin: 0 }}>{text}</pre>}
        </div>
        {!loading && !err && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>AI draft — review before using.</span>
            <Button variant="primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
