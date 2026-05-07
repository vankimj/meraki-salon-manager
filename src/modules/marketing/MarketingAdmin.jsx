import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchClients, fetchAppointmentsByRange, fetchCampaigns, createCampaign, deleteCampaign,
         fetchEmployees, fetchServices, fetchPromoCodes,
         fetchCampaignTemplates, saveCampaignTemplate, deleteCampaignTemplate,
         fetchReviewReceived } from '../../lib/firestore';
import { logActivity } from '../../lib/logger';
import GoogleReviewsPanel from '../../components/GoogleReviewsPanel';

// ── Built-in templates ─────────────────────────────────
const BUILTIN_TEMPLATES = [
  {
    id: '_reengagement',
    name: 'Re-engagement',
    icon: '💅',
    subject: "We miss you, {firstName}! Come see us 💅",
    body: "Hi {firstName},\n\nIt's been a while since your last visit, and we'd love to see you again!\n\nWe have exciting new styles and services to share. Book your appointment today and let us pamper you.\n\nWe hope to see you soon!\n— The Meraki Team",
  },
  {
    id: '_birthday',
    name: 'Birthday Treat',
    icon: '🎂',
    subject: "Happy Birthday, {firstName}! 🎂 A gift from Meraki",
    body: "Hi {firstName},\n\nHappy Birthday! 🎉 We hope your special day is as fabulous as you are.\n\nAs a birthday gift from us to you, we'd love to treat you to something special. Come celebrate with us this month!\n\nWith love,\n— The Meraki Team",
  },
  {
    id: '_referral',
    name: 'Referral Ask',
    icon: '💕',
    subject: "Love your nails? Share the love, {firstName}! 💕",
    body: "Hi {firstName},\n\nWe're so grateful to have amazing clients like you! If you've been happy with your experience at Meraki, we'd love for you to spread the word.\n\nRefer a friend to Meraki and help us grow our family. Your support means the world to us!\n\nThank you for being amazing,\n— The Meraki Team",
  },
  {
    id: '_flash',
    name: 'Flash Sale',
    icon: '⚡',
    subject: "⚡ Limited time offer just for you, {firstName}!",
    body: "Hi {firstName},\n\nFor a limited time only, we have a special offer just for you!\n\nSpots are filling up fast — book now before this deal is gone.\n\nDon't miss out!\n— The Meraki Team",
  },
  {
    id: '_newservice',
    name: 'New Service',
    icon: '🌟',
    subject: "🌟 Exciting news from Meraki, {firstName}!",
    body: "Hi {firstName},\n\nWe have exciting news — we've just added new services to our menu and we think you're going to love them!\n\nBe among the first to try something new. Book your appointment now.\n\nCan't wait to see you!\n— The Meraki Team",
  },
  {
    id: '_seasonal',
    name: 'Seasonal',
    icon: '✨',
    subject: "✨ Treat yourself this season, {firstName}!",
    body: "Hi {firstName},\n\nThe season is here, and there's no better time to treat yourself!\n\nCome visit us at Meraki and let us take care of you. Book your appointment today — our schedule fills up fast!\n\nSee you soon,\n— The Meraki Team",
  },
  {
    id: '_loyalty',
    name: 'Loyalty Thanks',
    icon: '🙏',
    subject: "A heartfelt thank you, {firstName} 🙏",
    body: "Hi {firstName},\n\nWe just wanted to take a moment to say thank you. Your loyalty means everything to us and we're so grateful to have you as part of the Meraki family.\n\nAs a small token of our appreciation, we have something special for you.\n\nWith gratitude,\n— The Meraki Team",
  },
];

const SEGMENTS = [
  { id: 'all',          label: 'All clients',          desc: 'Everyone with an email address' },
  { id: 'test_subjects',label: 'Test subjects',        desc: 'Clients flagged as test subjects on their profile' },
  { id: 'lapsed',       label: 'Lapsed clients',       desc: 'No appointment in the last N days' },
  { id: 'new_clients',  label: 'New clients',          desc: 'First visit within the last N days' },
  { id: 'top_clients',  label: 'Top clients',          desc: 'Clients with at least N visits' },
  { id: 'no_review',    label: 'Never reviewed',       desc: 'Clients who have never left a review' },
  { id: 'birthday',     label: 'Birthday this month',  desc: "Clients whose birthday falls this month" },
  { id: 'tech',         label: "Tech's clients",       desc: 'Clients who visited a specific nail tech' },
  { id: 'service',      label: 'Clients by service',   desc: 'Clients who received a specific service' },
];

function fmtNum(n) { return Number(n || 0).toLocaleString(); }

function buildPreviewHtml(bodyText, promoCode, promoLabel, ctaText, ctaUrl) {
  const bodyHtml = (bodyText || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\{firstName\}/gi, 'there')
    .replace(/\n/g, '<br>');
  const promoBlock = promoCode ? `
    <div style="margin:20px 0;background:#f0faf6;border:2px dashed #2D7A5F;border-radius:10px;padding:16px;text-align:center;">
      <div style="font-size:11px;color:#2D7A5F;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;">Your Exclusive Promo Code</div>
      <div style="font-size:26px;font-weight:800;color:#1a1a1a;letter-spacing:.12em;font-family:monospace,sans-serif;">${promoCode}</div>
      ${promoLabel ? `<div style="font-size:12px;color:#888;margin-top:6px;">${promoLabel}</div>` : ''}
    </div>` : '';
  const ctaBlock = ctaUrl ? `
    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${ctaUrl}" style="display:inline-block;background:#2D7A5F;color:#fff;font-size:14px;font-weight:700;padding:13px 32px;border-radius:10px;text-decoration:none;letter-spacing:.01em;">${ctaText || 'Book Your Appointment'} →</a>
    </div>` : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Message from the team</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:14px;line-height:1.75;color:#333;margin:0;">${bodyHtml}</p>
      ${promoBlock}
      ${ctaBlock}
    </div>
    <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
      <p style="font-size:10px;color:#ccc;margin:4px 0 0;">You're receiving this as a valued client. Reply to this email to unsubscribe.</p>
    </div>
  </div></body></html>`;
}

// ── Main view ──────────────────────────────────────────
export default function MarketingAdmin() {
  const { showToast, isAdmin, settings, updateSettings } = useApp();
  const [campaigns, setCampaigns] = useState(null);
  const [modal,     setModal]     = useState(false);  // false | true | campaign-object (clone)
  const [tab,       setTab]       = useState('campaigns');

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function load() {
    try { setCampaigns(await fetchCampaigns()); }
    catch { setCampaigns([]); }
  }

  async function handleSend(data) {
    try {
      await createCampaign(data);
      logActivity('marketing_campaign_sent', `${data.name} — ${data.recipientCount} recipients`);
      showToast(`Campaign queued — sending to ${data.recipientCount} clients`);
      setModal(false);
      load();
    } catch (e) { showToast('Failed: ' + e.message, 3000); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this campaign? This cannot be undone.')) return;
    try {
      await deleteCampaign(id);
      setCampaigns(cs => cs.filter(c => c.id !== id));
      logActivity('marketing_campaign_deleted', id);
      showToast('Campaign deleted');
    } catch (e) { showToast('Delete failed: ' + e.message, 3000); }
  }

  const totalSent    = (campaigns || []).reduce((s, c) => s + (c.sentCount || 0), 0);
  const thisMonth    = (campaigns || []).filter(c => c.createdAt?.slice(0, 7) === new Date().toISOString().slice(0, 7)).length;
  const autoActive   = [settings?.autoBirthday, settings?.autoLapsed].filter(Boolean).length;

  if (!campaigns) return <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>Loading…</div>;

  const TABS = [
    { id: 'campaigns',  label: 'Campaigns' },
    { id: 'automations', label: 'Automations' },
    { id: 'reviews',    label: 'Google Reviews' },
  ];

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', paddingBottom: 32 }}>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e8e8e8' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
            background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t.id ? '#1a1a1a' : '#888',
            borderBottom: tab === t.id ? '2px solid #2D7A5F' : '2px solid transparent',
            marginBottom: -1, transition: 'color .15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'reviews' ? (
        <GoogleReviewsPanel />
      ) : tab === 'automations' ? (
        <AutomationsPanel settings={settings} updateSettings={updateSettings} isAdmin={isAdmin} showToast={showToast} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            <StatCard label="Campaigns run"   value={campaigns.length}  accent="#2D7A5F" />
            <StatCard label="Messages sent"    value={fmtNum(totalSent)} accent="#3D95CE" />
            <StatCard label="This month"      value={thisMonth}         accent="#7c3aed" />
            <StatCard label="Automations on"  value={`${autoActive} / 2`} accent={autoActive ? '#f59e0b' : '#ccc'}
              sub={autoActive === 0 ? 'Enable in Automations tab' : autoActive === 1 ? '1 active' : 'Birthday + Lapsed'} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            {isAdmin && (
              <button onClick={() => setModal(true)}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#2D7A5F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                + New Campaign
              </button>
            )}
          </div>

          {campaigns.length === 0
            ? <Empty>No campaigns yet. Click "New Campaign" to start reaching clients.</Empty>
            : (
              <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, overflow: 'hidden' }}>
                {campaigns.map((c, i) => (
                  <CampaignRow key={c.id} campaign={c} last={i === campaigns.length - 1}
                    onDelete={() => handleDelete(c.id)}
                    onClone={() => setModal(c)} />
                ))}
              </div>
            )
          }
        </>
      )}

      {modal && (
        <CampaignModal
          prefill={typeof modal === 'object' ? modal : null}
          onSend={handleSend}
          onClose={() => setModal(false)} />
      )}
    </div>
  );
}

// ── Automations panel ──────────────────────────────────
// Birthday + lapsed-client emails. Settings live on the same tenant settings
// doc the rest of the app uses, so flipping a toggle here updates the
// Cloud-Function-driven schedule immediately on next save.
function AutomationsPanel({ settings, updateSettings, isAdmin, showToast }) {
  const [autoBirthday,   setAutoBirthday]   = useState(!!settings?.autoBirthday);
  const [autoLapsed,     setAutoLapsed]     = useState(!!settings?.autoLapsed);
  const [autoLapsedDays, setAutoLapsedDays] = useState(settings?.autoLapsedDays || 60);
  const [saving,         setSaving]         = useState(false);

  const rows = [
    { key: 'birthday', label: 'Birthday emails', val: autoBirthday, set: setAutoBirthday,
      desc: 'Sends a happy birthday email at 10am on each client\'s birthday.' },
    { key: 'lapsed',   label: 'Lapsed client emails', val: autoLapsed, set: setAutoLapsed,
      desc: `Sends a "we miss you" re-engagement email every Monday to clients with no visit in the last ${autoLapsedDays} days.` },
  ];

  async function save() {
    setSaving(true);
    try {
      await updateSettings({ ...settings, autoBirthday, autoLapsed, autoLapsedDays });
      showToast('Automations updated');
    } catch (e) { showToast('Save failed: ' + e.message, 3000); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, overflow: 'hidden' }}>
      {rows.map((r, i) => (
        <div key={r.key} style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: i === 0 ? 'none' : '1px solid #f0f0f0' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: '#333', fontWeight: 500 }}>{r.label}</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2, lineHeight: 1.5 }}>{r.desc}</div>
          </div>
          <button onClick={() => isAdmin && r.set(v => !v)} disabled={!isAdmin}
            style={{
              width: 44, height: 24, borderRadius: 12, border: 'none',
              cursor: isAdmin ? 'pointer' : 'not-allowed', padding: 0,
              background: r.val ? '#2D7A5F' : '#d1d5db', position: 'relative',
              transition: 'background .2s', flexShrink: 0, opacity: isAdmin ? 1 : .6,
            }}>
            <div style={{
              position: 'absolute', top: 3, left: r.val ? 22 : 2, width: 18, height: 18,
              borderRadius: '50%', background: '#fff', transition: 'left .2s',
              boxShadow: '0 1px 3px rgba(0,0,0,.2)',
            }} />
          </button>
        </div>
      ))}
      {autoLapsed && (
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid #f0f0f0' }}>
          <span style={{ fontSize: 12, color: '#555' }}>Lapse threshold:</span>
          <input type="number" min={14} max={365} value={autoLapsedDays}
            disabled={!isAdmin}
            onChange={e => setAutoLapsedDays(Math.max(14, Number(e.target.value)))}
            style={{ width: 80, textAlign: 'center', fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '6px 10px', fontSize: 13 }} />
          <span style={{ fontSize: 12, color: '#aaa' }}>days</span>
        </div>
      )}
      {isAdmin && (
        <div style={{ padding: '10px 16px 14px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={save} disabled={saving}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: saving ? '#aaa' : '#2D7A5F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Saving…' : 'Save Automations'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Campaign row ───────────────────────────────────────
function CampaignRow({ campaign: c, last, onDelete, onClone }) {
  const [expanded, setExpanded] = useState(false);
  const STATUS = {
    pending: { bg: '#fffbeb', fg: '#92400e', label: 'Queued'  },
    sending: { bg: '#eff6ff', fg: '#1d4ed8', label: 'Sending' },
    done:    { bg: '#f0fdf4', fg: '#16a34a', label: 'Sent'    },
    failed:  { bg: '#fef2f2', fg: '#ef4444', label: 'Failed'  },
  };
  const s        = STATUS[c.status] || STATUS.pending;
  const segLabel = SEGMENTS.find(x => x.id === c.segmentType)?.label || c.segmentType || '—';
  const date     = new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid #f0f0f0' }}>
      <div onClick={() => setExpanded(x => !x)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: '#e8f4ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{c.channel === 'sms' ? '💬' : '📣'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{c.name}</span>
            {c.channel === 'sms' && (
              <span style={{ fontSize: 10, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 6, padding: '1px 7px', fontWeight: 600 }}>SMS</span>
            )}
            {c.promoCode && (
              <span style={{ fontSize: 10, background: '#f0faf6', color: '#2D7A5F', border: '1px solid #c6e8d5', borderRadius: 6, padding: '1px 7px', fontWeight: 700, fontFamily: 'monospace' }}>{c.promoCode}</span>
            )}
            {c.ctaUrl && (
              <span style={{ fontSize: 10, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 6, padding: '1px 7px', fontWeight: 600 }}>CTA</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#888' }}>
            {segLabel}
            {c.segmentParams?.techName    ? ` · ${c.segmentParams.techName}`    : ''}
            {c.segmentParams?.serviceName ? ` · ${c.segmentParams.serviceName}` : ''}
            {c.segmentParams?.days        ? ` (${c.segmentParams.days}d lapse)` : ''}
            {' · '}{c.recipientCount || 0} recipients
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.fg, letterSpacing: '.04em', textTransform: 'uppercase' }}>{s.label}</span>
          {c.status === 'done' && (
            <div style={{ fontSize: 10, color: '#aaa', marginTop: 3 }}>
              ✓ {c.sentCount || 0} sent{c.failCount > 0 ? ` · ${c.failCount} failed` : ''}
            </div>
          )}
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>{date}</div>
        </div>
        <span style={{ fontSize: 10, color: '#bbb', marginLeft: 4 }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 14px 64px', borderTop: '1px solid #f8f8f8' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>{c.subject}</div>
          <div style={{ fontSize: 12, color: '#888', whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 120, overflowY: 'auto', background: '#f8f9fa', borderRadius: 6, padding: '8px 10px', marginBottom: 10 }}>{c.body}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={e => { e.stopPropagation(); onClone(); }}
              style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', color: '#555', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              ⧉ Duplicate
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(); }}
              style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              🗑 Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Campaign modal ─────────────────────────────────────
function CampaignModal({ onSend, onClose, prefill = null }) {
  const { showToast, settings } = useApp();
  const [channel,     setChannel]     = useState(prefill?.channel || 'email');
  const [name,        setName]        = useState(prefill ? `${prefill.name} (copy)` : '');
  const [segType,     setSegType]     = useState(prefill?.segmentType || 'all');
  const [lapDays,     setLapDays]     = useState(prefill?.segmentParams?.days || 60);
  const [techSel,     setTechSel]     = useState(prefill?.segmentParams?.techName || '');
  const [serviceSel,  setServiceSel]  = useState(prefill?.segmentParams?.serviceName || '');
  const [promoSel,    setPromoSel]    = useState('');
  const [subject,     setSubject]     = useState(prefill?.subject || '');
  const [body,        setBody]        = useState(prefill?.body || '');
  const [smsBody,     setSmsBody]     = useState(prefill?.smsBody || '');
  const [addCta,      setAddCta]      = useState(!!(prefill?.ctaUrl));
  const [ctaText,     setCtaText]     = useState(prefill?.ctaText || 'Book Your Appointment');
  const [ctaUrl,      setCtaUrl]      = useState(prefill?.ctaUrl || settings?.bookingUrl || '');
  const [showPreview, setShowPreview] = useState(false);
  const [savingTpl,   setSavingTpl]   = useState(false);
  const [tplName,     setTplName]     = useState('');
  const [activeTemplate, setActiveTemplate] = useState(null);

  const [clients,       setClients]       = useState(null);
  const [employees,     setEmployees]     = useState([]);
  const [services,      setServices]      = useState([]);
  const [promos,        setPromos]        = useState([]);
  const [savedTpls,     setSavedTpls]     = useState([]);
  const [recentAppts,   setRecentAppts]   = useState(null);
  const [allAppts,      setAllAppts]      = useState(null);
  const [reviewedIds,   setReviewedIds]   = useState(null);
  const [sending,       setSending]       = useState(false);
  const [minVisits,     setMinVisits]     = useState(5);
  const [newDays,       setNewDays]       = useState(30);
  const [showRecipients,setShowRecipients]= useState(false);

  useEffect(() => {
    fetchClients().then(setClients).catch(() => setClients([]));
    fetchEmployees().then(emps => setEmployees(emps.filter(e => e.active !== false))).catch(() => {});
    fetchServices().then(setServices).catch(() => {});
    fetchPromoCodes().then(ps => setPromos(ps.filter(p => p.active))).catch(() => {});
    fetchCampaignTemplates().then(setSavedTpls).catch(() => {});
  }, []);

  useEffect(() => {
    if (segType !== 'lapsed') { setRecentAppts(null); return; }
    const end   = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - lapDays * 86400000).toISOString().slice(0, 10);
    setRecentAppts(null);
    fetchAppointmentsByRange(start, end)
      .then(appts => setRecentAppts(appts.filter(a => a.status !== 'cancelled')))
      .catch(() => setRecentAppts([]));
  }, [segType, lapDays]); // eslint-disable-line

  useEffect(() => {
    if (!['tech','service','new_clients','top_clients'].includes(segType)) { setAllAppts(null); return; }
    const end   = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    setAllAppts(null);
    fetchAppointmentsByRange(start, end)
      .then(appts => setAllAppts(appts.filter(a => a.status !== 'cancelled')))
      .catch(() => setAllAppts([]));
  }, [segType]); // eslint-disable-line

  useEffect(() => {
    if (segType !== 'no_review') { setReviewedIds(null); return; }
    setReviewedIds(null);
    fetchReviewReceived().then(recs => setReviewedIds(new Set(recs.map(r => r.clientId).filter(Boolean)))).catch(() => setReviewedIds(new Set()));
  }, [segType]); // eslint-disable-line

  const recipients = useMemo(() => {
    if (!clients) return null;
    const withContact = channel === 'sms'
      ? clients.filter(c => c.phone && !c.marketingOptOut)
      : clients.filter(c => c.email && !c.marketingOptOut);
    if (segType === 'all') return withContact;
    if (segType === 'test_subjects') return withContact.filter(c => c.testSubject);
    if (segType === 'birthday') {
      const mm = new Date().toISOString().slice(5, 7);
      return withContact.filter(c => c.birthday && c.birthday.slice(5, 7) === mm);
    }
    if (segType === 'lapsed') {
      if (recentAppts === null) return null;
      const activeIds = new Set(recentAppts.map(a => a.clientId).filter(Boolean));
      return withContact.filter(c => !activeIds.has(c.id));
    }
    if (segType === 'tech') {
      if (allAppts === null || !techSel) return null;
      const ids = new Set(allAppts.filter(a => a.techName === techSel && a.clientId).map(a => a.clientId));
      return withContact.filter(c => ids.has(c.id));
    }
    if (segType === 'service') {
      if (allAppts === null || !serviceSel) return null;
      const ids = new Set(
        allAppts.filter(a => a.clientId && (a.services || []).some(s => s.name === serviceSel)).map(a => a.clientId)
      );
      return withContact.filter(c => ids.has(c.id));
    }
    if (segType === 'new_clients') {
      if (allAppts === null) return null;
      const cutoff = new Date(Date.now() - newDays * 86400000).toISOString().slice(0, 10);
      const firstVisit = {};
      allAppts.forEach(a => {
        if (!a.clientId || !a.date) return;
        if (!firstVisit[a.clientId] || a.date < firstVisit[a.clientId]) firstVisit[a.clientId] = a.date;
      });
      return withContact.filter(c => firstVisit[c.id] && firstVisit[c.id] >= cutoff);
    }
    if (segType === 'top_clients') {
      if (allAppts === null) return null;
      const visitCount = {};
      allAppts.forEach(a => { if (a.clientId) visitCount[a.clientId] = (visitCount[a.clientId] || 0) + 1; });
      return withContact.filter(c => (visitCount[c.id] || 0) >= minVisits);
    }
    if (segType === 'no_review') {
      if (reviewedIds === null) return null;
      return withContact.filter(c => !reviewedIds.has(c.id));
    }
    return withContact;
  }, [clients, channel, segType, lapDays, recentAppts, techSel, serviceSel, allAppts, newDays, minVisits, reviewedIds]);

  function applyTemplate(tpl) {
    setSubject(tpl.subject);
    setBody(tpl.body);
    setActiveTemplate(tpl.id);
    setSavingTpl(false);
  }

  async function handleSaveTemplate() {
    const n = tplName.trim() || name.trim();
    if (!n || !subject.trim() || !body.trim()) return;
    try {
      const doc = await saveCampaignTemplate({ name: n, subject: subject.trim(), body: body.trim() });
      const newTpl = { id: doc.id, name: n, subject: subject.trim(), body: body.trim() };
      setSavedTpls(prev => [newTpl, ...prev]);
      setActiveTemplate(doc.id);
      setTplName('');
      setSavingTpl(false);
      logActivity('template_saved', n);
      showToast('Template saved!');
    } catch { showToast('Failed to save template', 3000); }
  }

  async function handleDeleteTemplate(tpl, e) {
    e.stopPropagation();
    if (!confirm(`Delete template "${tpl.name}"?`)) return;
    try {
      await deleteCampaignTemplate(tpl.id);
      setSavedTpls(prev => prev.filter(t => t.id !== tpl.id));
      if (activeTemplate === tpl.id) setActiveTemplate(null);
      showToast('Template deleted');
    } catch { showToast('Failed to delete', 3000); }
  }

  const selectedPromo = promos.find(p => p.id === promoSel) || null;
  const promoLabel    = selectedPromo
    ? (selectedPromo.type === 'percent' ? `${selectedPromo.value}% off` : `$${selectedPromo.value} off`)
    : null;

  const needsSelection = (segType === 'tech' && !techSel) || (segType === 'service' && !serviceSel);
  const loading        = !clients ||
    (segType === 'lapsed'      && recentAppts === null) ||
    (['tech','service','new_clients','top_clients'].includes(segType) && allAppts === null) ||
    (segType === 'no_review'   && reviewedIds === null);

  const canSend = !sending && !loading && !needsSelection &&
    !!name.trim() && (recipients?.length ?? 0) > 0 &&
    (channel === 'sms' ? !!smsBody.trim() : (!!subject.trim() && !!body.trim()));

  async function submit() {
    if (!canSend) return;
    setSending(true);
    const segmentParams = {};
    if (segType === 'lapsed')       segmentParams.days        = lapDays;
    if (segType === 'tech')         segmentParams.techName    = techSel;
    if (segType === 'service')      segmentParams.serviceName = serviceSel;
    if (segType === 'new_clients')  segmentParams.days        = newDays;
    if (segType === 'top_clients')  segmentParams.minVisits   = minVisits;
    await onSend({
      name: name.trim(), channel,
      subject:    channel === 'email' ? subject.trim() : null,
      body:       channel === 'email' ? body.trim()    : null,
      smsBody:    channel === 'sms'   ? smsBody.trim() : null,
      segmentType: segType, segmentParams,
      promoCode:  channel === 'email' && selectedPromo?.code  ? selectedPromo.code  : null,
      promoLabel: channel === 'email' && promoLabel           ? promoLabel           : null,
      ctaText:    channel === 'email' && addCta && ctaText.trim() ? ctaText.trim() : null,
      ctaUrl:     channel === 'email' && addCta && ctaUrl.trim()  ? ctaUrl.trim()  : null,
      recipients: recipients.map(c => ({ clientId: c.id, name: c.name, email: c.email || null, phone: c.phone || null })),
      recipientCount: recipients.length,
      status: 'pending', sentCount: 0, failCount: 0,
    });
    setSending(false);
  }

  const allTemplates = [...BUILTIN_TEMPLATES, ...savedTpls];
  const optedOutCount = clients ? clients.filter(c => c.marketingOptOut).length : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '94%', maxWidth: 560, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>New Campaign</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #e8e8e8', background: '#fafafa', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* ── Template picker (email only) ── */}
          {channel === 'email' && <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              Templates
              <span style={{ fontSize: 10, fontWeight: 400, color: '#ccc', marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>
                {savedTpls.length > 0 ? `${BUILTIN_TEMPLATES.length} built-in · ${savedTpls.length} saved` : `${BUILTIN_TEMPLATES.length} built-in`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
              {allTemplates.map(tpl => {
                const active  = activeTemplate === tpl.id;
                const builtin = tpl.id.startsWith('_');
                return (
                  <div key={tpl.id} onClick={() => applyTemplate(tpl)}
                    style={{ flexShrink: 0, width: 110, padding: '10px 10px 8px', borderRadius: 10, border: `1.5px solid ${active ? '#2D7A5F' : '#e0e0e0'}`, background: active ? '#f0faf6' : '#fafafa', cursor: 'pointer', position: 'relative' }}>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{tpl.icon || '📄'}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: active ? '#2D7A5F' : '#333', lineHeight: 1.3 }}>{tpl.name}</div>
                    {!builtin && (
                      <button
                        onClick={e => handleDeleteTemplate(tpl, e)}
                        title="Delete template"
                        style={{ position: 'absolute', top: 5, right: 5, width: 16, height: 16, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.08)', color: '#aaa', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}>
                        ×
                      </button>
                    )}
                    {!builtin && (
                      <div style={{ fontSize: 9, color: '#bbb', marginTop: 3 }}>saved</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>}

          {/* ── Channel toggle ── */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            {[{ id: 'email', label: '✉️ Email' }, { id: 'sms', label: '💬 SMS' }].map(ch => (
              <button key={ch.id} onClick={() => setChannel(ch.id)}
                style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `1.5px solid ${channel === ch.id ? '#2D7A5F' : '#e0e0e0'}`, background: channel === ch.id ? '#f0faf6' : '#fafafa', color: channel === ch.id ? '#2D7A5F' : '#888', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}>
                {ch.label}
              </button>
            ))}
          </div>

          <F label="Campaign name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Summer Promo, Re-engagement" style={inp} />
          </F>

          <F label="Audience">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SEGMENTS.map(s => (
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${segType === s.id ? '#2D7A5F' : '#e0e0e0'}`, background: segType === s.id ? '#f0faf6' : '#fff', cursor: 'pointer' }}>
                  <input type="radio" name="seg" value={s.id} checked={segType === s.id} onChange={() => { setSegType(s.id); setTechSel(''); setServiceSel(''); setShowRecipients(false); }} style={{ accentColor: '#2D7A5F', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: '#aaa' }}>{s.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </F>

          {segType === 'lapsed' && (
            <F label="Lapsed after (days)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min={1} max={730} value={lapDays}
                  onChange={e => setLapDays(Math.max(1, Number(e.target.value)))}
                  style={{ ...inp, width: 90 }} />
                <span style={{ fontSize: 12, color: '#888' }}>days without a visit</span>
              </div>
            </F>
          )}

          {segType === 'tech' && (
            <F label="Tech">
              <select value={techSel} onChange={e => setTechSel(e.target.value)} style={inp}>
                <option value="">Select a tech…</option>
                {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select>
            </F>
          )}

          {segType === 'service' && (
            <F label="Service">
              <select value={serviceSel} onChange={e => setServiceSel(e.target.value)} style={inp}>
                <option value="">Select a service…</option>
                {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </F>
          )}

          {segType === 'new_clients' && (
            <F label="First visit within (days)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min={1} max={365} value={newDays}
                  onChange={e => setNewDays(Math.max(1, Number(e.target.value)))}
                  style={{ ...inp, width: 90 }} />
                <span style={{ fontSize: 12, color: '#888' }}>days ago</span>
              </div>
            </F>
          )}

          {segType === 'top_clients' && (
            <F label="Minimum visits (last year)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min={1} max={100} value={minVisits}
                  onChange={e => setMinVisits(Math.max(1, Number(e.target.value)))}
                  style={{ ...inp, width: 90 }} />
                <span style={{ fontSize: 12, color: '#888' }}>or more visits</span>
              </div>
            </F>
          )}

          {/* Audience preview */}
          <div style={{ marginBottom: 14 }}>
            <div style={{
              background: (loading || needsSelection) ? '#f8f9fa' : recipients?.length ? '#f0faf6' : '#fef2f2',
              border: `1px solid ${(loading || needsSelection) ? '#e8e8e8' : recipients?.length ? '#c6e8d5' : '#fca5a5'}`,
              borderRadius: showRecipients ? '8px 8px 0 0' : 8, padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              {loading ? (
                <span style={{ fontSize: 12, color: '#aaa' }}>Computing audience…</span>
              ) : needsSelection ? (
                <span style={{ fontSize: 12, color: '#aaa' }}>
                  {segType === 'tech' ? 'Select a tech to preview audience.' : 'Select a service to preview audience.'}
                </span>
              ) : !recipients?.length ? (
                <span style={{ fontSize: 12, color: '#ef4444' }}>No matching clients with an email address.</span>
              ) : (
                <>
                  <span style={{ fontSize: 22 }}>👥</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13 }}>
                      <strong style={{ color: '#2D7A5F' }}>{recipients.length}</strong>
                      <span style={{ color: '#555', marginLeft: 5 }}>recipients</span>
                      {optedOutCount > 0 && <span style={{ color: '#bbb', fontSize: 11, marginLeft: 8 }}>· {optedOutCount} opted out</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                      {recipients.slice(0, 4).map(c => c.name?.split(' ')[0]).join(', ')}
                      {recipients.length > 4 ? ` +${recipients.length - 4} more` : ''}
                    </div>
                  </div>
                  <button onClick={() => setShowRecipients(v => !v)}
                    style={{ fontSize: 11, color: '#3D95CE', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                    {showRecipients ? 'Hide list ▲' : 'See list ▼'}
                  </button>
                </>
              )}
            </div>
            {showRecipients && recipients?.length > 0 && (
              <div style={{ border: '1px solid #c6e8d5', borderTop: 'none', borderRadius: '0 0 8px 8px', maxHeight: 180, overflowY: 'auto', background: '#fff' }}>
                {recipients.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderBottom: i < recipients.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                    <span style={{ fontSize: 12, color: '#333', flex: 1 }}>{c.name}</span>
                    <span style={{ fontSize: 11, color: '#bbb' }}>{channel === 'sms' ? (c.phone || '—') : (c.email || '—')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {channel === 'email' && (
            <>
              <F label="Subject line">
                <input value={subject} onChange={e => { setSubject(e.target.value); setActiveTemplate(null); }} placeholder="e.g. 🎉 A special offer just for you!" style={inp} />
              </F>

              <F label="Message body">
                <textarea value={body} onChange={e => { setBody(e.target.value); setActiveTemplate(null); }} rows={7}
                  style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 5 }}>
                  <div style={{ fontSize: 10, color: '#aaa' }}>
                    Use <code style={{ background: '#f0f0f0', borderRadius: 3, padding: '1px 4px' }}>{'{firstName}'}</code> to personalize.
                  </div>
                  {!savingTpl ? (
                    <button onClick={() => { setSavingTpl(true); setTplName(name.trim()); }}
                      style={{ fontSize: 11, color: '#3D95CE', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 0' }}>
                      💾 Save as template
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        value={tplName}
                        onChange={e => setTplName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveTemplate(); if (e.key === 'Escape') setSavingTpl(false); }}
                        placeholder="Template name…"
                        autoFocus
                        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #3D95CE', outline: 'none', fontFamily: 'inherit', width: 140 }}
                      />
                      <button onClick={handleSaveTemplate} disabled={!tplName.trim()}
                        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none', background: tplName.trim() ? '#3D95CE' : '#d0d0d0', color: '#fff', cursor: tplName.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                        Save
                      </button>
                      <button onClick={() => setSavingTpl(false)}
                        style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #e0e0e0', background: '#fafafa', color: '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </F>

              <F label="Attach promo code (optional)">
                <select value={promoSel} onChange={e => setPromoSel(e.target.value)} style={inp}>
                  <option value="">— None —</option>
                  {promos.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.type === 'percent' ? `${p.value}% off` : `$${p.value} off`}
                      {p.endDate ? ` · expires ${p.endDate}` : ''}
                    </option>
                  ))}
                </select>
                {selectedPromo && (
                  <div style={{ fontSize: 11, color: '#2D7A5F', marginTop: 5, padding: '6px 10px', background: '#f0faf6', borderRadius: 6, border: '1px solid #c6e8d5' }}>
                    <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>{selectedPromo.code}</strong> · {promoLabel} will appear as a highlighted block in the email.
                  </div>
                )}
              </F>

              <F label="Book now button (optional)">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: addCta ? 10 : 0 }}>
                  <div onClick={() => setAddCta(v => !v)}
                    style={{ width: 36, height: 20, borderRadius: 10, background: addCta ? '#2D7A5F' : '#d1d5db', position: 'relative', transition: 'background .2s', flexShrink: 0, cursor: 'pointer' }}>
                    <div style={{ position: 'absolute', top: 2, left: addCta ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                  </div>
                  <span style={{ fontSize: 12, color: '#555' }}>Add a "Book Now" button to the email</span>
                </label>
                {addCta && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={ctaText} onChange={e => setCtaText(e.target.value)} placeholder="Button label"
                      style={{ ...inp, flex: 1 }} />
                    <input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} placeholder="https://…"
                      style={{ ...inp, flex: 2 }} />
                  </div>
                )}
              </F>
            </>
          )}

          {channel === 'sms' && (
            <F label="Text message">
              <textarea value={smsBody} onChange={e => setSmsBody(e.target.value.slice(0, 320))} rows={4}
                placeholder="Hi {firstName}, come visit us at Meraki! Book at meraki.tipflow.app"
                style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 5 }}>
                <div style={{ fontSize: 10, color: '#aaa' }}>
                  Use <code style={{ background: '#f0f0f0', borderRadius: 3, padding: '1px 4px' }}>{'{firstName}'}</code> to personalize.
                </div>
                <span style={{ fontSize: 10, color: smsBody.length > 160 ? '#f59e0b' : '#bbb' }}>
                  {smsBody.length}/160{smsBody.length > 160 ? ' (2 SMS)' : ''}
                </span>
              </div>
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, color: '#92400e' }}>
                Requires Twilio configured. Clients must have a phone number on file.
              </div>
            </F>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {channel === 'email' && (
              <button onClick={() => setShowPreview(true)} disabled={!subject.trim() && !body.trim()}
                style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid #d0d0d0', background: '#fafafa', color: '#555', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                👁 Preview
              </button>
            )}
            <button onClick={submit} disabled={!canSend}
              style={{ flex: channel === 'email' ? 2 : 1, padding: 11, borderRadius: 10, border: 'none', background: canSend ? '#2D7A5F' : '#d0d0d0', color: '#fff', fontSize: 13, fontWeight: 600, cursor: canSend ? 'pointer' : 'default', fontFamily: 'inherit' }}>
              {sending ? 'Queuing…' : loading ? 'Loading…' : needsSelection ? 'Select audience' : `Send to ${recipients?.length ?? 0} clients`}
            </button>
          </div>
        </div>
      </div>

      {showPreview && (
        <PreviewModal
          subject={subject}
          body={body}
          promoCode={selectedPromo?.code || null}
          promoLabel={promoLabel}
          ctaText={addCta ? ctaText : null}
          ctaUrl={addCta ? ctaUrl : null}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}

// ── Email preview modal ────────────────────────────────
function PreviewModal({ subject, body, promoCode, promoLabel, ctaText, ctaUrl, onClose }) {
  const html = buildPreviewHtml(body, promoCode, promoLabel, ctaText, ctaUrl);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '94%', maxWidth: 540, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Email Preview</div>
            {subject && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Subject: {subject}</div>}
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #e8e8e8', background: '#fafafa', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: '#f4f4f4' }}>
          <iframe title="Email preview" srcDoc={html} style={{ width: '100%', minHeight: 480, border: 'none', display: 'block' }} sandbox="allow-same-origin" />
        </div>
        <div style={{ padding: '10px 18px', borderTop: '1px solid #f0f0f0', textAlign: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: '#bbb' }}>"{'{firstName}'}" shown as "there" for preview</span>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, sub }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent || '#1a1a1a' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#bbb', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ textAlign: 'center', padding: '48px 0', color: '#bbb', fontSize: 13 }}>{children}</div>;
}

function F({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

const inp = { width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '9px 12px', fontSize: 13, background: '#fafafa', outline: 'none' };
