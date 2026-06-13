import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import TrashButton from '../../components/TrashButton';
import { fetchClients, fetchAppointmentsByRange, subscribeToCampaigns, createCampaign, deleteCampaign, cancelCampaign,
         fetchEmployees, fetchServices, fetchPromoCodes,
         fetchCampaignTemplates, saveCampaignTemplate, deleteCampaignTemplate,
         fetchReviewReceived,
         subscribeTenantRegistry, subscribeSandboxSmsLog, purgeSandboxSmsLog } from '../../lib/firestore';
import { logActivity } from '../../lib/logger';
import GoogleReviewsPanel from '../../components/GoogleReviewsPanel';
import CompetitorRankingPanel from '../../components/CompetitorRankingPanel';
import PublicReviewsPanel from '../../components/PublicReviewsPanel';

// ── Built-in templates ─────────────────────────────────
const BUILTIN_TEMPLATES = [
  {
    id: '_reengagement',
    name: 'Re-engagement',
    icon: '💅',
    subject: "We miss you, {firstName}! Come see us 💅",
    body: "Hi {firstName},\n\nIt's been a while since your last visit, and we'd love to see you again!\n\nWe have exciting new styles and services to share. Book your appointment today and let us pamper you.\n\nWe hope to see you soon!\n— The Meraki Team",
    smsBody: "Hey {firstName} — it's been a while! Come back to Meraki: {bookingLink} Reply STOP to opt out.",
  },
  {
    id: '_birthday',
    name: 'Birthday Treat',
    icon: '🎂',
    subject: "Happy Birthday, {firstName}! 🎂 A gift from Meraki",
    body: "Hi {firstName},\n\nHappy Birthday! 🎉 We hope your special day is as fabulous as you are.\n\nAs a birthday gift from us to you, we'd love to treat you to something special. Come celebrate with us this month!\n\nWith love,\n— The Meraki Team",
    smsBody: "Happy birthday, {firstName}! 🎂 A little treat is waiting for you at Meraki — book this month: {bookingLink} Reply STOP to opt out.",
  },
  {
    id: '_referral',
    name: 'Referral Ask',
    icon: '💕',
    subject: "Love your nails? Share the love, {firstName}! 💕",
    body: "Hi {firstName},\n\nWe're so grateful to have amazing clients like you! If you've been happy with your experience at Meraki, we'd love for you to spread the word.\n\nRefer a friend to Meraki and help us grow our family. Your support means the world to us!\n\nThank you for being amazing,\n— The Meraki Team",
    smsBody: "{firstName}, refer a friend to Meraki and we'll thank you both with a little something 💕 Send them: {bookingLink} Reply STOP to opt out.",
  },
  {
    id: '_flash',
    name: 'Flash Sale',
    icon: '⚡',
    subject: "⚡ Limited time offer just for you, {firstName}!",
    body: "Hi {firstName},\n\nFor a limited time only, we have a special offer just for you!\n\nSpots are filling up fast — book now before this deal is gone.\n\nDon't miss out!\n— The Meraki Team",
    smsBody: "{firstName}, ⚡ flash deal at Meraki today — limited spots. Book now: {bookingLink} Reply STOP to opt out.",
  },
  {
    id: '_newservice',
    name: 'New Service',
    icon: '🌟',
    subject: "🌟 Exciting news from Meraki, {firstName}!",
    body: "Hi {firstName},\n\nWe have exciting news — we've just added new services to our menu and we think you're going to love them!\n\nBe among the first to try something new. Book your appointment now.\n\nCan't wait to see you!\n— The Meraki Team",
    smsBody: "{firstName}, we just added new services at Meraki 🌟 Be one of the first to try: {bookingLink} Reply STOP to opt out.",
  },
  {
    id: '_seasonal',
    name: 'Seasonal',
    icon: '✨',
    subject: "✨ Treat yourself this season, {firstName}!",
    body: "Hi {firstName},\n\nThe season is here, and there's no better time to treat yourself!\n\nCome visit us at Meraki and let us take care of you. Book your appointment today — our schedule fills up fast!\n\nSee you soon,\n— The Meraki Team",
    smsBody: "{firstName}, treat yourself this season ✨ Our schedule's filling fast — book at Meraki: {bookingLink} Reply STOP to opt out.",
  },
  {
    id: '_loyalty',
    name: 'Loyalty Thanks',
    icon: '🙏',
    subject: "A heartfelt thank you, {firstName} 🙏",
    body: "Hi {firstName},\n\nWe just wanted to take a moment to say thank you. Your loyalty means everything to us and we're so grateful to have you as part of the Meraki family.\n\nAs a small token of our appreciation, we have something special for you.\n\nWith gratitude,\n— The Meraki Team",
    smsBody: "Thank you, {firstName} 🙏 Your loyalty means everything. A little something is waiting for you at Meraki: {bookingLink} Reply STOP to opt out.",
  },
  // Operational / time-sensitive templates. Pair with the "Today's remaining"
  // or "Appointments on a date" audiences for tactical day-of messaging.
  // These are SMS-only by design — the email/body pair is empty so the email
  // template picker filters them out (channelTemplates filter requires both
  // subject+body for email, smsBody for SMS).
  {
    id: '_closing_early',
    name: 'Closing early',
    icon: '⏰',
    subject: '',
    body: '',
    smsBody: "Hi {firstName}, we unfortunately have to close early today and won't be able to keep your appointment. So sorry for the trouble — please reply or call us to find a new time that works. Reply STOP to opt out.",
  },
  {
    id: '_running_behind',
    name: 'Running behind',
    icon: '⏰',
    subject: '',
    body: '',
    smsBody: "Hi {firstName}, just a quick heads-up — we're running about 15 minutes behind today. We'll get you in as close to your appointment time as possible. Thanks for your patience! Reply STOP to opt out.",
  },
  {
    id: '_day_before',
    name: 'Day-before reminder',
    icon: '📅',
    subject: "See you tomorrow at Meraki, {firstName}!",
    body: "Hi {firstName},\n\nJust a friendly reminder that you have an appointment with us at Meraki tomorrow. We're looking forward to seeing you!\n\nIf anything's changed, please let us know as soon as you can so we can free up the slot.\n\nSee you then,\n— The Meraki Team",
    smsBody: "Hi {firstName}, friendly reminder you have an appointment at Meraki tomorrow! Reply Y to confirm or call us if anything's changed. See you then! Reply STOP to opt out.",
  },
];

// SMS pricing (US, Twilio standard rate). Used for cost estimate in the modal.
const SMS_RATE_PER_SEGMENT = 0.0079;
// SMS segment math: GSM-7 fits 160 chars/segment when single-segment; multi-
// part SMS uses 153/segment. UCS-2 (any non-GSM char like emoji) is 70 / 67.
function smsSegmentInfo(text) {
  const t = text || '';
  // Cheap "is GSM-7" check — emoji and many curly quotes force UCS-2.
  // Twilio is the source of truth at send time; this is only for preview.
  const isUcs2 = /[^\x00-\x7F -ÿ€]/.test(t) || /[‘’“”…–—]/.test(t);
  const len = [...t].length;
  if (len === 0) return { length: 0, segments: 0, encoding: 'GSM-7' };
  const single = isUcs2 ? 70 : 160;
  const multi  = isUcs2 ? 67 : 153;
  const segments = len <= single ? 1 : Math.ceil(len / multi);
  return { length: len, segments, encoding: isUcs2 ? 'UCS-2' : 'GSM-7' };
}

const SEGMENTS = [
  { id: 'all',                   label: 'All clients',           desc: 'Everyone with an email address' },
  { id: 'test_subjects',         label: 'Test subjects',         desc: 'Clients flagged as test subjects on their profile' },
  { id: 'appts_today_remaining', label: "Today's remaining",     desc: 'Clients with appointments still ahead today (current time onward) — for "running 15 min behind" or "closing early"' },
  { id: 'appts_on_date',         label: 'Appointments on a date', desc: 'Clients with bookings on a specific date — for day-before reminders, day-of nudges' },
  { id: 'lapsed',                label: 'Lapsed clients',        desc: 'No appointment in the last N days' },
  { id: 'new_clients',           label: 'New clients',           desc: 'First visit within the last N days' },
  { id: 'top_clients',           label: 'Top clients',           desc: 'Clients with at least N visits' },
  { id: 'no_review',             label: 'Never reviewed',        desc: 'Clients who have never left a review' },
  { id: 'birthday',              label: 'Birthday this month',   desc: "Clients whose birthday falls this month" },
  { id: 'tech',                  label: "Tech's clients",        desc: 'Clients who visited a specific nail tech' },
  { id: 'service',               label: 'Clients by service',    desc: 'Clients who received a specific service' },
];

function fmtNum(n) { return Number(n || 0).toLocaleString(); }

function buildPreviewHtml(bodyText, promoCode, promoLabel, ctaText, ctaUrl, brand) {
  const salonName  = brand?.salonName  || 'your salon';
  const footerLine = brand?.footerLine || salonName;
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
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">${salonName}</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Message from the team</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:14px;line-height:1.75;color:#333;margin:0;">${bodyHtml}</p>
      ${promoBlock}
      ${ctaBlock}
    </div>
    <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">${footerLine}</p>
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

  // Live subscription — when sendSMSCampaign updates status pending → sent
  // and writes sentCount/failCount/failures, the list reflects it without
  // a manual reload.
  useEffect(() => {
    const unsub = subscribeToCampaigns(setCampaigns);
    return unsub;
  }, []);

  async function handleSend(data) {
    try {
      await createCampaign(data);
      logActivity('marketing_campaign_sent', `${data.name} — ${data.recipientCount} recipients`);
      showToast(`Campaign queued — sending to ${data.recipientCount} clients`);
      setModal(false);
    } catch (e) { showToast('Failed: ' + e.message, 3000); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this campaign? This cannot be undone.')) return;
    try {
      await deleteCampaign(id);
      logActivity('marketing_campaign_deleted', id);
      showToast('Campaign deleted');
    } catch (e) { showToast('Delete failed: ' + e.message, 3000); }
  }

  async function handleCancel(id) {
    if (!confirm('Cancel this campaign? In-flight sends stop at the next checkpoint (~1–2s); scheduled ones simply won\'t fire.')) return;
    try {
      await cancelCampaign(id);
      logActivity('marketing_campaign_cancelled', id);
      showToast('Cancellation requested');
    } catch (e) { showToast('Cancel failed: ' + e.message, 3000); }
  }

  // Retry resends the campaign to recipients that didn't get a successful
  // attempt last time — failed ones plus anything that was queued at
  // cancellation. Creates a NEW campaign rather than mutating the original
  // so history is preserved.
  async function handleRetry(c) {
    const attempted = Array.isArray(c.attempts) ? c.attempts : [];
    // Successful-send identity differs by channel: SMS uses phone, email
    // uses email. Build a key set on whichever the attempt carried.
    const sentKeys = new Set();
    attempted.forEach(a => {
      if (a.status !== 'sent') return;
      if (a.phone) sentKeys.add('p:' + a.phone);
      if (a.email) sentKeys.add('e:' + a.email);
    });
    const remaining = (c.recipients || []).filter(r => {
      if (r.phone && sentKeys.has('p:' + r.phone)) return false;
      if (r.email && sentKeys.has('e:' + r.email)) return false;
      return true;
    });
    if (remaining.length === 0) { showToast('Nothing to retry — every recipient already received a successful send.', 3500); return; }
    const proceed = window.confirm(`Retry will create a new campaign and send to the ${remaining.length} recipient${remaining.length !== 1 ? 's' : ''} that didn't get a successful delivery (failed or queued at cancellation).\n\nThe original campaign stays as-is. Continue?`);
    if (!proceed) return;
    try {
      await createCampaign({
        name: `${c.name} (retry)`,
        channel: c.channel,
        subject: c.subject || null,
        body:    c.body    || null,
        smsBody: c.smsBody || null,
        segmentType: c.segmentType,
        segmentParams: c.segmentParams || {},
        promoCode:  c.promoCode  || null,
        promoLabel: c.promoLabel || null,
        ctaText:    c.ctaText    || null,
        ctaUrl:     c.ctaUrl     || null,
        recipients: remaining,
        recipientCount: remaining.length,
        status: 'pending',
        scheduleAt: null,
        sentCount: 0, failCount: 0,
        retryOf: c.id,
      });
      logActivity('marketing_campaign_retried', `${c.name} → ${remaining.length} recipients`);
      showToast(`Retrying ${remaining.length} recipient${remaining.length !== 1 ? 's' : ''}`, 3000);
    } catch (e) { showToast('Retry failed: ' + e.message, 3000); }
  }

  const totalSent    = (campaigns || []).reduce((s, c) => s + (c.sentCount || 0), 0);
  const thisMonth    = (campaigns || []).filter(c => c.createdAt?.slice(0, 7) === new Date().toISOString().slice(0, 7)).length;
  const autoActive   = [settings?.autoBirthday, settings?.autoLapsed].filter(Boolean).length;

  if (!campaigns) return <div style={{ textAlign: 'center', padding: 80, color: 'var(--pn-text-faint)', fontSize: 14 }}>Loading…</div>;

  const TABS = [
    { id: 'campaigns',     label: 'Campaigns' },
    { id: 'automations',   label: 'Automations' },
    { id: 'reviews',       label: 'Google Reviews' },
    { id: 'publicreviews', label: 'Public Reviews' },
    { id: 'ranking',       label: 'Local Ranking' },
    { id: 'testmode',      label: '🧪 SMS Test Mode' },
  ];

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', paddingBottom: 32 }}>

      <div className="scroll-x" style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--pn-border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
            background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t.id ? 'var(--pn-text)' : 'var(--pn-text-muted)',
            borderBottom: tab === t.id ? '2px solid #2D7A5F' : '2px solid transparent',
            marginBottom: -1, transition: 'color .15s', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'reviews' ? (
        <GoogleReviewsPanel />
      ) : tab === 'publicreviews' ? (
        <PublicReviewsPanel />
      ) : tab === 'ranking' ? (
        <CompetitorRankingPanel />
      ) : tab === 'automations' ? (
        <AutomationsPanel settings={settings} updateSettings={updateSettings} isAdmin={isAdmin} showToast={showToast} />
      ) : tab === 'testmode' ? (
        <SmsTestModePanel settings={settings} updateSettings={updateSettings} isAdmin={isAdmin} showToast={showToast} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            <StatCard label="Campaigns run"   value={campaigns.length}  accent="#2D7A5F" />
            <StatCard label="Messages sent"    value={fmtNum(totalSent)} accent="#3D95CE" />
            <StatCard label="This month"      value={thisMonth}         accent="#7c3aed" />
            <StatCard label="Automations on"  value={`${autoActive} / 2`} accent={autoActive ? '#f59e0b' : 'var(--pn-text-faint)'}
              sub={autoActive === 0 ? 'Enable in Automations tab' : autoActive === 1 ? '1 active' : 'Birthday + Lapsed'} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <TrashButton collections={['campaigns']} scope="Marketing" />
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
              <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden' }}>
                {campaigns.map((c, i) => (
                  <CampaignRow key={c.id} campaign={c} last={i === campaigns.length - 1}
                    onDelete={() => handleDelete(c.id)}
                    onCancel={() => handleCancel(c.id)}
                    onRetry={()  => handleRetry(c)}
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
// SMS Test Mode — owner-controlled sandbox for previewing campaigns +
// other outbound SMS without dispatching real messages or spending
// money. Toggle writes settings.smsTestMode; the Cloud Functions side
// (isSandboxTenant) ORs it with the platform-admin sandboxMode flag,
// so either one being true routes every send to sandboxSmsLog.
// Panel also surfaces the live inbox so the owner can inspect each
// fake send (body, recipient, kind).
function SmsTestModePanel({ settings, updateSettings, isAdmin, showToast }) {
  const [tenantInfo, setTenantInfo] = useState(null);
  const [log, setLog]               = useState(null);
  const [busy, setBusy]             = useState(false);

  useEffect(() => subscribeTenantRegistry(setTenantInfo), []);
  useEffect(() => subscribeSandboxSmsLog(setLog, 200), []);

  const platformSandbox = Boolean(tenantInfo?.sandboxMode);
  const ownerTestMode   = Boolean(settings?.smsTestMode);
  const effective       = platformSandbox || ownerTestMode;

  async function toggleTestMode() {
    if (!isAdmin) { showToast('Admin only'); return; }
    setBusy(true);
    try {
      await updateSettings({ ...settings, smsTestMode: !ownerTestMode });
      logActivity(ownerTestMode ? 'sms_test_mode_off' : 'sms_test_mode_on', '');
      showToast(ownerTestMode ? 'Test mode OFF — sends use real Twilio' : 'Test mode ON — sends route to inbox');
    } catch (e) { showToast('Failed: ' + e.message, 3000); }
    finally { setBusy(false); }
  }

  async function handlePurge() {
    if (!log?.length) return;
    if (!confirm(`Purge all ${log.length} sandbox inbox entries? This can't be undone.`)) return;
    setBusy(true);
    try {
      const n = await purgeSandboxSmsLog();
      showToast(`Purged ${n} entries`);
    } catch (e) { showToast('Purge failed: ' + e.message, 3000); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {/* Status banner */}
      <div style={{
        padding: '14px 16px', marginBottom: 18,
        background: effective ? 'var(--pn-warning-bg)' : 'var(--pn-success-bg)',
        border: `1px solid ${effective ? '#fcd34d' : '#bbf7d0'}`,
        borderRadius: 10,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: effective ? 'var(--pn-warning)' : 'var(--pn-success)', marginBottom: 4 }}>
          {effective ? '🧪 SMS Test Mode is ON' : '✓ SMS is in Production'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.55 }}>
          {effective
            ? 'All outbound SMS — campaigns, booking confirms, tech reminders, direct messages — route to the inbox below instead of Twilio. No charges, no real delivery.'
            : 'SMS sends use real Twilio. TFN purchase $2/mo, ~$0.008 per SMS segment. Flip the toggle below to preview campaigns without spending.'}
        </div>
        {platformSandbox && (
          <div style={{ fontSize: 11, color: 'var(--pn-warning)', marginTop: 6, fontStyle: 'italic' }}>
            ⓘ This tenant is in platform-level sandbox (set by Plume Nexus). Test mode is forced ON regardless of the toggle below — contact your account rep to switch to production.
          </div>
        )}
      </div>

      {/* Owner toggle */}
      <div style={{
        padding: 16, marginBottom: 18,
        background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 10,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4 }}>
              Owner-controlled test mode
            </div>
            <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.55 }}>
              Preview the next campaign before it goes out. Send to your real client list — every message lands in the inbox below with the personalization filled in, so you can verify the wording, the promo code, the merge tags. Flip OFF to resume real Twilio delivery.
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: isAdmin && !platformSandbox ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={ownerTestMode}
              onChange={toggleTestMode}
              disabled={!isAdmin || busy || platformSandbox}
              style={{ accentColor: '#92400e', transform: 'scale(1.2)' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: ownerTestMode ? '#92400e' : 'var(--pn-text-muted)' }}>
              {ownerTestMode ? 'ON' : 'OFF'}
            </span>
          </label>
        </div>
      </div>

      {/* Inbox */}
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)', margin: 0 }}>
          Sandbox inbox {log?.length ? `(${log.length})` : ''}
        </h3>
        {log?.length > 0 && (
          <button onClick={handlePurge} disabled={busy || !isAdmin} style={{
            padding: '6px 12px', fontSize: 11, fontWeight: 600,
            background: 'transparent', color: '#7f1d1d',
            border: '1px solid #fca5a5', borderRadius: 6,
            cursor: busy || !isAdmin ? 'default' : 'pointer', fontFamily: 'inherit',
          }}>
            Purge all
          </button>
        )}
      </div>

      {log === null ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 13 }}>Loading…</div>
      ) : log.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13, background: 'var(--pn-surface-alt)', borderRadius: 10, border: '1px dashed var(--pn-border)' }}>
          {effective
            ? 'No fake sends yet. Run a campaign or trigger a booking to see messages here.'
            : 'No entries — test mode has never been on for this tenant.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {log.map(row => (
            <SandboxLogRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function SandboxLogRow({ row }) {
  const kindBadge = {
    campaign:       { label: 'Campaign',        color: 'var(--pn-info)', bg: 'var(--pn-info-bg)' },
    direct:         { label: 'Direct message',  color: '#0e7490', bg: '#ecfeff' },
    tech_reminder:  { label: 'Tech reminder',   color: 'var(--pn-warning)', bg: 'var(--pn-warning-bg)' },
    pause_forward:  { label: 'Pause forward',   color: '#7c3aed', bg: '#f5f3ff' },
    booking_confirm:{ label: 'Booking confirm', color: 'var(--pn-success)', bg: 'var(--pn-success-bg)' },
    otp:            { label: 'OTP',             color: 'var(--pn-danger)', bg: 'var(--pn-danger-bg)' },
  }[row.kind] || { label: row.kind || 'sms', color: '#525252', bg: '#f5f5f5' };
  const when = row.at ? new Date(row.at).toLocaleString() : '—';
  return (
    <div style={{ padding: 12, background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', background: kindBadge.bg, color: kindBadge.color, borderRadius: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {kindBadge.label}
          </span>
          {row.recipientName && (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text)' }}>{row.recipientName}</span>
          )}
          {row.to && (
            <span style={{ fontSize: 11, color: 'var(--pn-text-muted)', fontFamily: 'monospace' }}>{row.to}</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>{when}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--pn-text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', background: 'var(--pn-surface-alt)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--pn-border)' }}>
        {row.body || '(no body)'}
      </div>
      {row.campaignName && (
        <div style={{ fontSize: 10, color: 'var(--pn-text-muted)', marginTop: 4 }}>Campaign: {row.campaignName}</div>
      )}
    </div>
  );
}

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
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden' }}>
      {rows.map((r, i) => (
        <div key={r.key} style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: i === 0 ? 'none' : '1px solid var(--pn-border)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--pn-text)', fontWeight: 500 }}>{r.label}</div>
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.5 }}>{r.desc}</div>
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
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--pn-border)' }}>
          <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>Lapse threshold:</span>
          <input type="number" min={14} max={365} value={autoLapsedDays}
            disabled={!isAdmin}
            onChange={e => setAutoLapsedDays(Math.max(14, Number(e.target.value)))}
            style={{ width: 80, textAlign: 'center', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '6px 10px', fontSize: 13 }} />
          <span style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>days</span>
        </div>
      )}
      {isAdmin && (
        <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--pn-border)', display: 'flex', justifyContent: 'flex-end' }}>
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
function CampaignRow({ campaign: c, last, onDelete, onCancel, onClone, onRetry }) {
  const [expanded, setExpanded] = useState(false);
  const STATUS = {
    pending:   { bg: 'var(--pn-warning-bg)', fg: 'var(--pn-warning)', label: 'Queued'    },
    scheduled: { bg: '#fdf4ff', fg: '#86198f', label: 'Scheduled' },
    sending:   { bg: 'var(--pn-info-bg)', fg: 'var(--pn-info)', label: 'Sending'   },
    done:      { bg: 'var(--pn-success-bg)', fg: 'var(--pn-success)', label: 'Sent'      },
    failed:    { bg: 'var(--pn-danger-bg)', fg: 'var(--pn-danger)', label: 'Failed'    },
    cancelled: { bg: '#f5f5f5', fg: '#6b7280', label: 'Cancelled' },
  };
  // 'sending' / 'pending' / 'scheduled' all support cancel. Scheduled
  // ones never started; the Cloud Scheduler sweep skips them since
  // status changes to 'cancelled'.
  const isActive       = c.status === 'pending' || c.status === 'sending' || c.status === 'scheduled';
  const cancelInFlight = isActive && c.cancelRequested;
  const canRetry       = (c.status === 'done' || c.status === 'cancelled' || c.status === 'failed') && (c.failCount > 0 || c.attemptedCount < c.recipientCount);
  const s        = STATUS[c.status] || STATUS.pending;
  const segLabel = SEGMENTS.find(x => x.id === c.segmentType)?.label || c.segmentType || '—';
  const date     = new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid var(--pn-border)' }}>
      <div onClick={() => setExpanded(x => !x)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: '#e8f4ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{c.channel === 'sms' ? '💬' : '📣'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{c.name}</span>
            {c.channel === 'sms' && (
              <span style={{ fontSize: 10, background: 'var(--pn-info-bg)', color: 'var(--pn-info)', border: '1px solid #bfdbfe', borderRadius: 6, padding: '1px 7px', fontWeight: 600 }}>SMS</span>
            )}
            {c.promoCode && (
              <span style={{ fontSize: 10, background: '#f0faf6', color: '#2D7A5F', border: '1px solid #c6e8d5', borderRadius: 6, padding: '1px 7px', fontWeight: 700, fontFamily: 'monospace' }}>{c.promoCode}</span>
            )}
            {c.ctaUrl && (
              <span style={{ fontSize: 10, background: 'var(--pn-info-bg)', color: 'var(--pn-info)', border: '1px solid #bfdbfe', borderRadius: 6, padding: '1px 7px', fontWeight: 600 }}>CTA</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>
            {segLabel}
            {c.segmentParams?.techName    ? ` · ${c.segmentParams.techName}`    : ''}
            {c.segmentParams?.serviceName ? ` · ${c.segmentParams.serviceName}` : ''}
            {c.segmentParams?.days        ? ` (${c.segmentParams.days}d lapse)` : ''}
            {c.segmentParams?.date        ? ` · ${c.segmentParams.date}`        : ''}
            {' · '}{c.recipientCount || 0} recipients
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.fg, letterSpacing: '.04em', textTransform: 'uppercase' }}>{s.label}</span>
          {(c.status === 'sending' || c.status === 'done' || c.status === 'cancelled') && (
            <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 3 }}>
              {c.status === 'done' ? '✓' : c.status === 'cancelled' ? '⏹' : '📨'} {c.sentCount || 0} sent{c.failCount > 0 ? ` · ${c.failCount} failed` : ''}
              {c.status === 'sending' && c.recipientCount ? ` · ${(c.recipientCount - (c.attemptedCount || 0))} queued` : ''}
            </div>
          )}
          {c.status === 'scheduled' && c.scheduleAt && (
            <div style={{ fontSize: 10, color: '#86198f', marginTop: 3, fontWeight: 600 }}>
              {new Date(c.scheduleAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
          {c.status === 'pending' && (
            <div style={{ fontSize: 10, color: '#92400e', marginTop: 3 }}>
              waiting for function…
            </div>
          )}
          {c.status === 'failed' && c.error && (
            <div style={{ fontSize: 10, color: '#ef4444', marginTop: 3, fontWeight: 600 }}>
              {c.error}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 2 }}>{date}</div>
        </div>
        <span style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginLeft: 4 }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 14px 64px', borderTop: '1px solid var(--pn-border)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 6 }}>{c.subject}</div>
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 120, overflowY: 'auto', background: 'var(--pn-bg)', borderRadius: 6, padding: '8px 10px', marginBottom: 10 }}>{c.body}</div>

          <CampaignDiagnostics c={c} />

          {/* Legacy failures panel — only for campaigns from before the
              activity-log change (no attempts array). */}
          {!Array.isArray(c.attempts) && Array.isArray(c.failures) && c.failures.length > 0 && (
            <div style={{ marginBottom: 10, background: 'var(--pn-danger-bg)', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-danger)', marginBottom: 6 }}>
                ⚠ {c.failures.length} delivery {c.failures.length === 1 ? 'failure' : 'failures'}{c.failCount > c.failures.length ? ` (showing first ${c.failures.length} of ${c.failCount})` : ''}
              </div>
              <div style={{ maxHeight: 160, overflowY: 'auto', fontSize: 11, color: 'var(--pn-danger)' }}>
                {c.failures.map((f, i) => (
                  <div key={i} style={{ padding: '3px 0', borderTop: i > 0 ? '1px solid #fecaca' : 'none' }}>
                    <div style={{ fontWeight: 600 }}>{f.name} · <code style={{ background: 'var(--pn-danger-bg)', padding: '0 4px', borderRadius: 3 }}>{f.code}</code></div>
                    <div style={{ color: 'var(--pn-danger)', marginTop: 1 }}>{f.phone || f.email || '—'} — {f.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isActive && (
              <button onClick={e => { e.stopPropagation(); onCancel(); }} disabled={cancelInFlight}
                style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #f59e0b', background: cancelInFlight ? 'var(--pn-warning-bg)' : 'var(--pn-warning-bg)', color: 'var(--pn-warning)', cursor: cancelInFlight ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                {cancelInFlight ? '⏳ Cancelling…' : c.status === 'scheduled' ? '⏹ Cancel scheduled' : '⏹ Cancel send'}
              </button>
            )}
            {canRetry && (
              <button onClick={e => { e.stopPropagation(); onRetry(); }}
                style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #2D7A5F', background: '#f0faf6', color: '#2D7A5F', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                🔄 Retry {Math.max(c.failCount || 0, (c.recipientCount || 0) - (c.attemptedCount || 0))} unsent
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); onClone(); }}
              style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-alt)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              ⧉ Duplicate
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(); }}
              style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #fca5a5', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              🗑 Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Campaign diagnostics: live progress + per-recipient attempt log ────────
function fmtElapsed(ms) {
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function CampaignDiagnostics({ c }) {
  const isSms = c.channel === 'sms';
  const fnName = isSms ? 'sendSMSCampaign' : 'sendMarketingCampaign';
  const [now, setNow] = useState(() => Date.now());
  const isActive = c.status === 'pending' || c.status === 'sending';
  // Live ticker so elapsed/last-update times stay accurate while a campaign is in flight.
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, [isActive]);

  const startedAt = c.startedAt ? new Date(c.startedAt).getTime() : null;
  const createdAt = c.createdAt ? new Date(c.createdAt).getTime() : null;
  const lastUpdateAt = c.lastUpdateAt ? new Date(c.lastUpdateAt).getTime() : null;
  const sentAt = c.sentAt ? new Date(c.sentAt).getTime() : null;

  const queuedFor = createdAt && startedAt ? startedAt - createdAt : (createdAt && c.status === 'pending' ? now - createdAt : null);
  const sendingFor = startedAt ? (sentAt || now) - startedAt : null;
  const sinceLastUpdate = lastUpdateAt && c.status === 'sending' ? now - lastUpdateAt : null;
  const stuck = c.status === 'pending' && queuedFor && queuedFor > 30000;
  const stalled = c.status === 'sending' && sinceLastUpdate && sinceLastUpdate > 30000;

  const total = c.recipientCount || (Array.isArray(c.attempts) ? c.attempts.length : 0) || 0;
  const sent = c.sentCount || 0;
  const failed = c.failCount || 0;
  const attempted = c.attemptedCount ?? (sent + failed);
  const queued = Math.max(0, total - attempted);
  const pct = total > 0 ? Math.min(100, Math.round((attempted / total) * 100)) : 0;

  const attempts = Array.isArray(c.attempts) ? c.attempts : null;
  // Render newest-first so live activity is at the top.
  const orderedAttempts = attempts ? [...attempts].reverse() : null;

  // Nothing useful to show for legacy campaigns (no attempts) that already finished.
  if (!attempts && !isActive) return null;

  return (
    <div style={{ marginBottom: 10, background: 'var(--pn-surface-alt)', border: '1px solid var(--pn-border)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Activity log</div>
        <div style={{ fontSize: 10, color: 'var(--pn-text-muted)' }}>
          {c.status === 'pending' && queuedFor != null && <>queued {fmtElapsed(queuedFor)}</>}
          {c.status === 'sending' && sendingFor != null && <>sending {fmtElapsed(sendingFor)}{sinceLastUpdate != null ? ` · last update ${fmtElapsed(sinceLastUpdate)} ago` : ''}</>}
          {c.status === 'done' && sendingFor != null && <>completed in {fmtElapsed(sendingFor)}</>}
        </div>
      </div>

      {(stuck || stalled) && (
        <div style={{ background: 'var(--pn-warning-bg)', border: '1px solid #fcd34d', borderRadius: 6, padding: '6px 10px', marginBottom: 8, fontSize: 11, color: 'var(--pn-warning)' }}>
          ⚠ {stuck ? `Campaign hasn't started after 30s — Cloud Function may not be picking it up. Check \`firebase functions:log --only ${fnName}\`.`
                    : `No progress in 30s — function may be slow, throttled by ${isSms ? 'Twilio' : 'AWS SES'}, or about to hit its timeout.`}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
        <Stat label="Sent"    value={sent}      color="#16a34a" />
        <Stat label="Failed"  value={failed}    color={failed > 0 ? '#ef4444' : '#9ca3af'} />
        <Stat label="Queued"  value={queued}    color="#92400e" />
        <Stat label="Total"   value={total}     color="var(--pn-text)" />
      </div>

      {total > 0 && (
        <div style={{ height: 6, background: 'var(--pn-surface-alt)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ display: 'flex', height: '100%' }}>
            <div style={{ width: `${total > 0 ? (sent / total * 100) : 0}%`, background: '#16a34a' }} />
            <div style={{ width: `${total > 0 ? (failed / total * 100) : 0}%`, background: '#ef4444' }} />
          </div>
        </div>
      )}

      {orderedAttempts && orderedAttempts.length > 0 ? (
        <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 6, maxHeight: 240, overflowY: 'auto', fontSize: 11 }}>
          {orderedAttempts.map((a, i) => {
            const isFail = a.status === 'failed';
            const time = a.at ? new Date(a.at).toLocaleTimeString('en-US', { hour12: false }) : '';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 10px', borderBottom: i < orderedAttempts.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
                <span style={{ fontSize: 12, lineHeight: '14px', color: isFail ? '#ef4444' : '#16a34a', flexShrink: 0 }}>{isFail ? '✗' : '✓'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600, color: 'var(--pn-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || '(unknown)'}</span>
                    <span style={{ fontSize: 10, color: 'var(--pn-text-faint)', flexShrink: 0 }}>{time}</span>
                  </div>
                  <div style={{ fontSize: 10, color: isFail ? '#9a3412' : 'var(--pn-text-muted)', marginTop: 1 }}>
                    {a.phone || a.email || '—'}
                    {isFail && a.code && <> · <code style={{ background: 'var(--pn-danger-bg)', padding: '0 4px', borderRadius: 3, color: 'var(--pn-danger)' }}>{a.code}</code></>}
                    {isFail && a.reason && <> — {a.reason}</>}
                    {a.promoCode && <> · <code style={{ background: 'var(--pn-success-bg)', padding: '0 4px', borderRadius: 3, color: 'var(--pn-success)', fontFamily: 'monospace' }}>{a.promoCode}</code></>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : isActive ? (
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', padding: '8px 10px', textAlign: 'center', background: 'var(--pn-surface)', border: '1px dashed var(--pn-border)', borderRadius: 6 }}>
          {c.status === 'pending' ? 'Waiting for the Cloud Function to pick this up…' : 'Reaching the first recipient…'}
        </div>
      ) : null}

      {c.attemptsTruncated && (
        <div style={{ fontSize: 10, color: 'var(--pn-text-muted)', marginTop: 6, fontStyle: 'italic' }}>
          Log truncated to first 2,000 entries (full counters above are accurate).
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: 'var(--pn-surface)', borderRadius: 6, padding: '6px 8px', textAlign: 'center', border: '1px solid var(--pn-border)' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 1 }}>{label}</div>
    </div>
  );
}

// ── Campaign modal ─────────────────────────────────────
function CampaignModal({ onSend, onClose, prefill = null }) {
  const { showToast, settings } = useApp();
  const [channel,     setChannel]     = useState(prefill?.channel || 'email');
  const [name,        setName]        = useState(prefill ? `${prefill.name} (copy)` : '');
  const [segType,     setSegType]     = useState(prefill?.segmentType || 'test_subjects');
  const [lapDays,     setLapDays]     = useState(prefill?.segmentParams?.days || 60);
  const [techSel,     setTechSel]     = useState(prefill?.segmentParams?.techName || '');
  // For "Appointments on a date": YYYY-MM-DD picker, defaulting to today.
  // For "Today's remaining": no input — date is locked to today, time
  // cutoff is computed at recipient-resolution time.
  const apptDateDefault = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const [apptDate,    setApptDate]    = useState(prefill?.segmentParams?.date || apptDateDefault);
  const [dateAppts,   setDateAppts]   = useState(null);
  const [serviceSel,  setServiceSel]  = useState(prefill?.segmentParams?.serviceName || '');
  const [promoSel,    setPromoSel]    = useState('');
  // Personalized promo codes: when on, one unique code is generated per
  // recipient at send time, bound to that client's clientId so only they
  // can redeem it. Body should include {promoCode} as the substitution
  // token. Works on both email and SMS channels.
  const [persPromo,   setPersPromo]   = useState(!!prefill?.promoPersonalize);
  const [persPrefix,  setPersPrefix]  = useState(prefill?.promoPersonalize?.prefix || (settings?.salonName || 'MERAKI').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8));
  const [persType,    setPersType]    = useState(prefill?.promoPersonalize?.type   || 'percent');
  const [persValue,   setPersValue]   = useState(prefill?.promoPersonalize?.value != null ? String(prefill.promoPersonalize.value) : '10');
  const [persExpDays, setPersExpDays] = useState(prefill?.promoPersonalize?.expiresDays != null ? String(prefill.promoPersonalize.expiresDays) : '30');
  const [subject,     setSubject]     = useState(prefill?.subject || '');
  const [body,        setBody]        = useState(prefill?.body || '');
  const [smsBody,     setSmsBody]     = useState(prefill?.smsBody || '');
  const [addCta,      setAddCta]      = useState(!!(prefill?.ctaUrl));
  const [ctaText,     setCtaText]     = useState(prefill?.ctaText || 'Book Your Appointment');
  // Default to the tenant's actual public booking URL when no override is
  // configured in settings. /book is the path App.jsx routes to
  // BookingScreen; the bare domain serves the salon webfront landing.
  const defaultBookingUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/book';
  const [ctaUrl,      setCtaUrl]      = useState(prefill?.ctaUrl || settings?.bookingUrl || defaultBookingUrl);
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

  // Scheduling: 'now' (immediate) | 'later' (date+time). Default to immediate.
  // When a campaign is scheduled, the doc is written with status='scheduled'
  // + scheduleAt (ISO); a Cloud Scheduler sweep flips it to 'sending' once due.
  const [sendMode,    setSendMode]    = useState('now');
  // Default schedule: tomorrow 10am local (a sane non-zero default that
  // doesn't accidentally fire immediately if the user picks "later" but
  // forgets to change the time).
  const defaultSchedule = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
    return { date: d.toISOString().slice(0, 10), time: '10:00' };
  }, []);
  const [schedDate,   setSchedDate]   = useState(defaultSchedule.date);
  const [schedTime,   setSchedTime]   = useState(defaultSchedule.time);

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

  // Single-day appointment fetch for the appts_on_date / appts_today_remaining
  // segments. Today's-remaining always queries today; the date-picker variant
  // queries whatever date the user picked. Single-day range = cheap.
  useEffect(() => {
    if (segType !== 'appts_on_date' && segType !== 'appts_today_remaining') { setDateAppts(null); return; }
    const date = segType === 'appts_today_remaining' ? apptDateDefault : apptDate;
    if (!date) { setDateAppts([]); return; }
    setDateAppts(null);
    fetchAppointmentsByRange(date, date)
      .then(appts => setDateAppts(appts.filter(a => a.status !== 'cancelled' && a.status !== 'no_show')))
      .catch(() => setDateAppts([]));
  }, [segType, apptDate, apptDateDefault]); // eslint-disable-line

  useEffect(() => {
    if (segType !== 'no_review') { setReviewedIds(null); return; }
    setReviewedIds(null);
    fetchReviewReceived().then(recs => setReviewedIds(new Set(recs.map(r => r.clientId).filter(Boolean)))).catch(() => setReviewedIds(new Set()));
  }, [segType]); // eslint-disable-line

  const recipients = useMemo(() => {
    if (!clients) return null;
    // commPreferences gates per-channel marketing. When the field is missing
    // (legacy clients), default to opted-in for both channels — same as
    // existing behavior. marketingOptOut is the master kill-switch and
    // overrides the channel preferences.
    const channelOk = (c) => {
      if (c.marketingOptOut) return false;
      const cp = c.commPreferences;
      if (!cp) return true; // legacy: no preferences set → both channels OK
      return channel === 'sms' ? cp.marketingSms !== false : cp.marketingEmail !== false;
    };
    const withContact = channel === 'sms'
      ? clients.filter(c => c.phone && channelOk(c))
      : clients.filter(c => c.email && channelOk(c));
    if (segType === 'all') return withContact;
    if (segType === 'test_subjects') return withContact.filter(c => c.testSubject);
    if (segType === 'appts_on_date') {
      if (dateAppts === null) return null;
      const ids = new Set(dateAppts.map(a => a.clientId).filter(Boolean));
      return withContact.filter(c => ids.has(c.id));
    }
    if (segType === 'appts_today_remaining') {
      if (dateAppts === null) return null;
      // Cutoff = HH:MM right now. startTime is stored as "HH:MM" so a
      // string compare gives correct ordering.
      const now = new Date();
      const cutoff = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const ids = new Set(dateAppts
        .filter(a => (a.startTime || '00:00') >= cutoff)
        .map(a => a.clientId)
        .filter(Boolean));
      return withContact.filter(c => ids.has(c.id));
    }
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
  }, [clients, channel, segType, lapDays, recentAppts, techSel, serviceSel, allAppts, newDays, minVisits, reviewedIds, dateAppts]);

  function applyTemplate(tpl) {
    // Resolve {bookingLink} to whichever URL the user has configured for the
    // CTA (or the tenant default). Doing it at apply time means the textarea
    // shows the actual link — WYSIWYG — and lets the user edit if needed.
    const link = (ctaUrl && ctaUrl.trim()) || defaultBookingUrl;
    const resolveLinks = (s) => (s || '').replace(/\{bookingLink\}/g, link);
    if (tpl.subject) setSubject(resolveLinks(tpl.subject));
    if (tpl.body)    setBody(resolveLinks(tpl.body));
    if (tpl.smsBody) setSmsBody(resolveLinks(tpl.smsBody));
    setActiveTemplate(tpl.id);
    setSavingTpl(false);
  }

  async function handleSaveTemplate() {
    const n = tplName.trim() || name.trim();
    // Channel-aware required fields: SMS templates need smsBody; email
    // templates need subject + body. Both are saved when both are filled
    // so a single template can serve both channels.
    const hasEmail = !!(subject.trim() && body.trim());
    const hasSms   = !!smsBody.trim();
    if (!n || (!hasEmail && !hasSms)) return;
    try {
      const tpl = {
        name: n,
        subject: hasEmail ? subject.trim() : '',
        body:    hasEmail ? body.trim()    : '',
        smsBody: hasSms   ? smsBody.trim() : '',
      };
      const doc = await saveCampaignTemplate(tpl);
      const newTpl = { id: doc.id, ...tpl };
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

  const needsSelection = (segType === 'tech' && !techSel) || (segType === 'service' && !serviceSel) || (segType === 'appts_on_date' && !apptDate);
  const loading        = !clients ||
    (segType === 'lapsed'      && recentAppts === null) ||
    (['tech','service','new_clients','top_clients'].includes(segType) && allAppts === null) ||
    (segType === 'no_review'   && reviewedIds === null) ||
    (['appts_on_date','appts_today_remaining'].includes(segType) && dateAppts === null);

  // Compute the schedule's ISO timestamp. Treat the date+time as local
  // (matches what the user typed in the inputs); convert to UTC ISO for
  // storage so the Cloud Function can compare against `new Date().toISOString()`.
  const scheduleAt = useMemo(() => {
    if (sendMode !== 'later' || !schedDate || !schedTime) return null;
    const local = new Date(`${schedDate}T${schedTime}:00`);
    return Number.isNaN(local.getTime()) ? null : local.toISOString();
  }, [sendMode, schedDate, schedTime]);
  const scheduleInPast = scheduleAt && new Date(scheduleAt).getTime() <= Date.now();

  const smsInfo = useMemo(() => smsSegmentInfo(smsBody), [smsBody]);
  const recipientCount = recipients?.length ?? 0;
  const estCost = channel === 'sms' && smsInfo.segments > 0
    ? recipientCount * smsInfo.segments * SMS_RATE_PER_SEGMENT
    : 0;

  const canSend = !sending && !loading && !needsSelection &&
    !!name.trim() && recipientCount > 0 &&
    (channel === 'sms' ? !!smsBody.trim() : (!!subject.trim() && !!body.trim())) &&
    (sendMode === 'now' || (!!scheduleAt && !scheduleInPast));

  async function submit() {
    if (!canSend) return;

    // Mass-send safety check. >10 recipients is a sane threshold for "this
    // is more than a personal test" — same threshold competitors use.
    if (recipientCount > 10) {
      const what = sendMode === 'later' ? 'schedule' : 'send';
      const when = sendMode === 'later' ? `\n\nScheduled for: ${new Date(scheduleAt).toLocaleString()}` : '';
      const cost = channel === 'sms' && estCost > 0 ? `\nEstimated cost: ~$${estCost.toFixed(2)} (${smsInfo.segments} segment${smsInfo.segments !== 1 ? 's' : ''} × ${recipientCount} recipients)` : '';
      const ok = window.confirm(
        `You're about to ${what} this campaign to ${recipientCount} recipients.${when}${cost}\n\nContinue?`
      );
      if (!ok) return;
    }

    setSending(true);
    const segmentParams = {};
    if (segType === 'lapsed')       segmentParams.days        = lapDays;
    if (segType === 'tech')         segmentParams.techName    = techSel;
    if (segType === 'service')      segmentParams.serviceName = serviceSel;
    if (segType === 'new_clients')  segmentParams.days        = newDays;
    if (segType === 'top_clients')  segmentParams.minVisits   = minVisits;
    if (segType === 'appts_on_date') segmentParams.date       = apptDate;
    await onSend({
      name: name.trim(), channel,
      subject:    channel === 'email' ? subject.trim() : null,
      body:       channel === 'email' ? body.trim()    : null,
      smsBody:    channel === 'sms'   ? smsBody.trim() : null,
      segmentType: segType, segmentParams,
      // Shared promo (single code visible in the email block) is mutually
      // exclusive with personalized — when persPromo is on, no shared code
      // is attached and the function generates per-recipient codes instead.
      promoCode:  !persPromo && channel === 'email' && selectedPromo?.code  ? selectedPromo.code  : null,
      promoLabel: !persPromo && channel === 'email' && promoLabel           ? promoLabel          : null,
      promoPersonalize: persPromo ? {
        prefix:       (persPrefix || 'PROMO').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'PROMO',
        type:         persType === 'amount' ? 'amount' : 'percent',
        value:        Math.max(0, Number(persValue) || 0),
        expiresDays:  Math.max(1, Math.floor(Number(persExpDays) || 30)),
      } : null,
      ctaText:    channel === 'email' && addCta && ctaText.trim() ? ctaText.trim() : null,
      ctaUrl:     channel === 'email' && addCta && ctaUrl.trim()  ? ctaUrl.trim()  : null,
      recipients: recipients.map(c => ({ clientId: c.id, name: c.name, email: c.email || null, phone: c.phone || null })),
      recipientCount,
      // 'pending' fires the immediate trigger; 'scheduled' is picked up by
      // runScheduledCampaigns when scheduleAt is past.
      status: sendMode === 'later' ? 'scheduled' : 'pending',
      scheduleAt: sendMode === 'later' ? scheduleAt : null,
      sentCount: 0, failCount: 0,
    });
    setSending(false);
  }

  // Insert a personalization variable at the cursor of the active body
  // textarea. Detects which channel's textarea is in focus.
  function insertVariable(varName) {
    const isSms = channel === 'sms';
    const cur = isSms ? smsBody : body;
    const setter = isSms ? setSmsBody : setBody;
    setter(cur + (cur && !cur.endsWith(' ') ? ' ' : '') + varName);
    setActiveTemplate(null);
  }

  const allTemplates = [...BUILTIN_TEMPLATES, ...savedTpls];
  const optedOutCount = clients ? clients.filter(c => c.marketingOptOut).length : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 560, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>New Campaign</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border)', background: 'var(--pn-surface-alt)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* ── Template picker — shows templates with content for the active channel ── */}
          {(() => {
            // For SMS, hide templates that lack an smsBody (they'd insert
            // nothing useful). For email, hide those that lack subject+body.
            const channelTemplates = allTemplates.filter(t =>
              channel === 'sms'
                ? !!(t.smsBody && t.smsBody.trim())
                : !!((t.subject || '').trim() && (t.body || '').trim())
            );
            if (channelTemplates.length === 0) return null;
            const builtinCount = channelTemplates.filter(t => t.id.startsWith('_')).length;
            const savedCount = channelTemplates.length - builtinCount;
            return (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                  Templates
                  <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--pn-text-faint)', marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>
                    {savedCount > 0 ? `${builtinCount} built-in · ${savedCount} saved` : `${builtinCount} built-in`}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
                  {channelTemplates.map(tpl => {
                    const active  = activeTemplate === tpl.id;
                    const builtin = tpl.id.startsWith('_');
                    return (
                      <div key={tpl.id} onClick={() => applyTemplate(tpl)}
                        style={{ flexShrink: 0, width: 110, padding: '10px 10px 8px', borderRadius: 10, border: `1.5px solid ${active ? '#2D7A5F' : 'var(--pn-border)'}`, background: active ? '#f0faf6' : 'var(--pn-surface-alt)', cursor: 'pointer', position: 'relative' }}>
                        <div style={{ fontSize: 20, marginBottom: 4 }}>{tpl.icon || '📄'}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: active ? '#2D7A5F' : 'var(--pn-text)', lineHeight: 1.3 }}>{tpl.name}</div>
                        {!builtin && (
                          <button
                            onClick={e => handleDeleteTemplate(tpl, e)}
                            title="Delete template"
                            style={{ position: 'absolute', top: 5, right: 5, width: 16, height: 16, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.08)', color: 'var(--pn-text-faint)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}>
                            ×
                          </button>
                        )}
                        {!builtin && (
                          <div style={{ fontSize: 9, color: 'var(--pn-text-faint)', marginTop: 3 }}>saved</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── Channel toggle ── */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            {[{ id: 'email', label: '✉️ Email' }, { id: 'sms', label: '💬 SMS' }].map(ch => (
              <button key={ch.id} onClick={() => setChannel(ch.id)}
                style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `1.5px solid ${channel === ch.id ? '#2D7A5F' : 'var(--pn-border)'}`, background: channel === ch.id ? '#f0faf6' : 'var(--pn-surface-alt)', color: channel === ch.id ? '#2D7A5F' : 'var(--pn-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}>
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
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${segType === s.id ? '#2D7A5F' : 'var(--pn-border)'}`, background: segType === s.id ? '#f0faf6' : 'var(--pn-surface)', cursor: 'pointer' }}>
                  <input type="radio" name="seg" value={s.id} checked={segType === s.id} onChange={() => { setSegType(s.id); setTechSel(''); setServiceSel(''); setShowRecipients(false); }} style={{ accentColor: '#2D7A5F', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{s.desc}</div>
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
                <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>days without a visit</span>
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

          {segType === 'appts_on_date' && (
            <F label="Date">
              <input type="date" value={apptDate} onChange={e => setApptDate(e.target.value)} style={inp} />
              <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 4 }}>
                Cancelled and no-show appointments are excluded.
              </div>
            </F>
          )}

          {segType === 'appts_today_remaining' && (
            <F label="Today's remaining">
              <div style={{ fontSize: 12, color: 'var(--pn-warning)', padding: '8px 12px', background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', borderRadius: 6, lineHeight: 1.55 }}>
                Resolves at send time: clients with appointments today (<strong>{apptDateDefault}</strong>) starting at the current time or later. Useful for "running 15 min behind" or "we're closing early today" alerts.
              </div>
            </F>
          )}

          {segType === 'new_clients' && (
            <F label="First visit within (days)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min={1} max={365} value={newDays}
                  onChange={e => setNewDays(Math.max(1, Number(e.target.value)))}
                  style={{ ...inp, width: 90 }} />
                <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>days ago</span>
              </div>
            </F>
          )}

          {segType === 'top_clients' && (
            <F label="Minimum visits (last year)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min={1} max={100} value={minVisits}
                  onChange={e => setMinVisits(Math.max(1, Number(e.target.value)))}
                  style={{ ...inp, width: 90 }} />
                <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>or more visits</span>
              </div>
            </F>
          )}

          {/* Audience preview */}
          <div style={{ marginBottom: 14 }}>
            <div style={{
              background: (loading || needsSelection) ? 'var(--pn-bg)' : recipients?.length ? 'var(--pn-success-bg)' : 'var(--pn-danger-bg)',
              border: `1px solid ${(loading || needsSelection) ? 'var(--pn-border)' : recipients?.length ? '#c6e8d5' : '#fca5a5'}`,
              borderRadius: showRecipients ? '8px 8px 0 0' : 8, padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              {loading ? (
                <span style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>Computing audience…</span>
              ) : needsSelection ? (
                <span style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>
                  {segType === 'tech' ? 'Select a tech to preview audience.' : 'Select a service to preview audience.'}
                </span>
              ) : !recipients?.length ? (
                <span style={{ fontSize: 12, color: 'var(--pn-danger)' }}>No matching clients with an email address.</span>
              ) : (
                <>
                  <span style={{ fontSize: 22 }}>👥</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13 }}>
                      <strong style={{ color: '#2D7A5F' }}>{recipients.length}</strong>
                      <span style={{ color: 'var(--pn-text-muted)', marginLeft: 5 }}>recipients</span>
                      {optedOutCount > 0 && <span style={{ color: 'var(--pn-text-faint)', fontSize: 11, marginLeft: 8 }}>· {optedOutCount} opted out</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>
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
              <div style={{ border: '1px solid #c6e8d5', borderTop: 'none', borderRadius: '0 0 8px 8px', maxHeight: 180, overflowY: 'auto', background: 'var(--pn-surface)' }}>
                {recipients.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderBottom: i < recipients.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
                    <span style={{ fontSize: 12, color: 'var(--pn-text)', flex: 1 }}>{c.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{channel === 'sms' ? (c.phone || '—') : (c.email || '—')}</span>
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
                  <div style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>
                    Use <code style={{ background: 'var(--pn-surface-alt)', borderRadius: 3, padding: '1px 4px' }}>{'{firstName}'}</code> to personalize.
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
                        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none', background: tplName.trim() ? '#3D95CE' : 'var(--pn-border-strong)', color: '#fff', cursor: tplName.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                        Save
                      </button>
                      <button onClick={() => setSavingTpl(false)}
                        style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--pn-border)', background: 'var(--pn-surface-alt)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </F>

              <F label="Attach promo code (optional)">
                {!persPromo && (
                  <select value={promoSel} onChange={e => setPromoSel(e.target.value)} style={inp}>
                    <option value="">— None —</option>
                    {promos.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.code} · {p.type === 'percent' ? `${p.value}% off` : `$${p.value} off`}
                        {p.endDate ? ` · expires ${p.endDate}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                {!persPromo && selectedPromo && (
                  <div style={{ fontSize: 11, color: '#2D7A5F', marginTop: 5, padding: '6px 10px', background: '#f0faf6', borderRadius: 6, border: '1px solid #c6e8d5' }}>
                    <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>{selectedPromo.code}</strong> · {promoLabel} will appear as a highlighted block in the email. (One shared code for all recipients.)
                  </div>
                )}
              </F>

              <F label="Book now button (optional)">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: addCta ? 10 : 0 }}>
                  <div onClick={() => setAddCta(v => !v)}
                    style={{ width: 36, height: 20, borderRadius: 10, background: addCta ? '#2D7A5F' : '#d1d5db', position: 'relative', transition: 'background .2s', flexShrink: 0, cursor: 'pointer' }}>
                    <div style={{ position: 'absolute', top: 2, left: addCta ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>Add a "Book Now" button to the email</span>
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
              <textarea value={smsBody} onChange={e => { setSmsBody(e.target.value.slice(0, 1600)); setActiveTemplate(null); }} rows={4}
                placeholder="Hi {firstName}, come visit us at Meraki! Book at meraki.tipflow.app"
                style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 5, gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginRight: 4 }}>Insert:</span>
                  <button type="button" onClick={() => insertVariable('{firstName}')} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-alt)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>{'{firstName}'}</button>
                  <button type="button" onClick={() => insertVariable('{lastName}')} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-alt)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>{'{lastName}'}</button>
                  <button type="button" onClick={() => { const link = (ctaUrl && ctaUrl.trim()) || defaultBookingUrl; setSmsBody(prev => prev + (prev && !prev.endsWith(' ') ? ' ' : '') + link); setActiveTemplate(null); }} title="Insert booking link" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-alt)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>🔗 Booking link</button>
                  {persPromo && (
                    <button type="button" onClick={() => insertVariable('{promoCode}')} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid #2D7A5F', background: '#f0faf6', color: '#2D7A5F', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>{'{promoCode}'}</button>
                  )}
                </div>
                <span style={{ fontSize: 10, color: smsInfo.segments > 1 ? '#f59e0b' : 'var(--pn-text-muted)' }}>
                  {smsInfo.length} chars · {smsInfo.segments} segment{smsInfo.segments !== 1 ? 's' : ''} · {smsInfo.encoding}
                  {smsInfo.encoding === 'UCS-2' && smsInfo.segments > 1 ? ' (emoji halves capacity)' : ''}
                </span>
              </div>
              {channel === 'sms' && recipientCount > 0 && smsInfo.segments > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--pn-text-muted)' }}>
                  Estimated cost: <strong>${estCost.toFixed(2)}</strong>
                  <span style={{ color: 'var(--pn-text-faint)' }}> · {smsInfo.segments} × {recipientCount} × ${SMS_RATE_PER_SEGMENT.toFixed(4)}/segment</span>
                </div>
              )}
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, color: 'var(--pn-warning)' }}>
                Requires Twilio configured. Clients must have a phone number on file. Add an opt-out clause (e.g. "Reply STOP to opt out") for TCPA compliance.
              </div>
            </F>
          )}

          <F label="Personalized promo per recipient">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--pn-text)' }}>
              <div onClick={() => setPersPromo(v => !v)}
                style={{ width: 36, height: 20, borderRadius: 10, background: persPromo ? '#2D7A5F' : '#d1d5db', position: 'relative', transition: 'background .2s', flexShrink: 0, cursor: 'pointer' }}>
                <div style={{ position: 'absolute', top: 2, left: persPromo ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
              </div>
              <span style={{ flex: 1 }}>Generate a unique single-use code for each recipient. The code is bound to that client only — others can't redeem it.</span>
            </label>
            {persPromo && (
              <div style={{ marginTop: 10, padding: '12px 14px', background: 'var(--pn-success-bg)', border: '1px solid #c6e8d5', borderRadius: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>Code prefix</label>
                    <input value={persPrefix} onChange={e => setPersPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                      placeholder="MERAKI" style={{ ...inp, fontFamily: 'monospace' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>Discount</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select value={persType} onChange={e => setPersType(e.target.value)} style={{ ...inp, flex: '0 0 90px' }}>
                        <option value="percent">% off</option>
                        <option value="amount">$ off</option>
                      </select>
                      <input type="number" min="0" step={persType === 'percent' ? '1' : '0.01'} value={persValue} onChange={e => setPersValue(e.target.value)} style={{ ...inp, flex: 1 }} />
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--pn-text-muted)' }}>
                  <span>Expires after</span>
                  <input type="number" min="1" max="365" value={persExpDays} onChange={e => setPersExpDays(e.target.value)}
                    style={{ ...inp, width: 70 }} />
                  <span>day{Number(persExpDays) === 1 ? '' : 's'}</span>
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--pn-success)', padding: '6px 10px', background: 'var(--pn-success-bg)', border: '1px dashed #86efac', borderRadius: 6 }}>
                  Use <code style={{ fontFamily: 'monospace', background: 'var(--pn-success-bg)', padding: '0 4px', borderRadius: 3 }}>{'{promoCode}'}</code> in the {channel === 'sms' ? 'SMS body' : 'email body'} to insert the recipient's unique code. Example: <code style={{ fontFamily: 'monospace', background: 'var(--pn-surface)', padding: '0 4px', borderRadius: 3 }}>{persPrefix || 'MERAKI'}-A3F7K9P2</code>
                </div>
              </div>
            )}
          </F>

          <F label="Send schedule">
            <div style={{ display: 'flex', gap: 8, marginBottom: sendMode === 'later' ? 10 : 0 }}>
              <button type="button" onClick={() => setSendMode('now')}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1px solid ${sendMode === 'now' ? '#2D7A5F' : 'var(--pn-border-strong)'}`, background: sendMode === 'now' ? '#f0faf6' : 'var(--pn-surface)', color: sendMode === 'now' ? '#2D7A5F' : 'var(--pn-text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                ⚡ Send immediately
              </button>
              <button type="button" onClick={() => setSendMode('later')}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1px solid ${sendMode === 'later' ? '#2D7A5F' : 'var(--pn-border-strong)'}`, background: sendMode === 'later' ? '#f0faf6' : 'var(--pn-surface)', color: sendMode === 'later' ? '#2D7A5F' : 'var(--pn-text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                🕒 Schedule for later
              </button>
            </div>
            {sendMode === 'later' && (
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    style={{ ...inp, width: 'auto' }} />
                  <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)}
                    style={{ ...inp, width: 'auto' }} />
                  <span style={{ fontSize: 10, color: 'var(--pn-text-muted)' }}>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
                </div>
                <div style={{ fontSize: 11, color: scheduleInPast ? '#ef4444' : 'var(--pn-text-muted)', marginTop: 6 }}>
                  {scheduleAt
                    ? scheduleInPast
                      ? '⚠ Pick a time in the future — this is in the past.'
                      : `Will send around ${new Date(scheduleAt).toLocaleString()} (within 1 minute).`
                    : 'Pick a date and time.'}
                </div>
              </div>
            )}
          </F>

          <div style={{ display: 'flex', gap: 8 }}>
            {channel === 'email' && (
              <button onClick={() => setShowPreview(true)} disabled={!subject.trim() && !body.trim()}
                style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-alt)', color: 'var(--pn-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                👁 Preview
              </button>
            )}
            <button onClick={submit} disabled={!canSend}
              style={{ flex: channel === 'email' ? 2 : 1, padding: 11, borderRadius: 10, border: 'none', background: canSend ? '#2D7A5F' : 'var(--pn-border-strong)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: canSend ? 'pointer' : 'default', fontFamily: 'inherit' }}>
              {sending ? (sendMode === 'later' ? 'Scheduling…' : 'Queuing…')
                : loading ? 'Loading…'
                : needsSelection ? 'Select audience'
                : sendMode === 'later'
                  ? `Schedule for ${recipientCount} client${recipientCount !== 1 ? 's' : ''}`
                  : `Send to ${recipientCount} client${recipientCount !== 1 ? 's' : ''}`}
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
  const { settings } = useApp();
  const brand = settings?.salonName
    ? { salonName: settings.salonName, footerLine: settings.salonName }
    : null;
  const html = buildPreviewHtml(body, promoCode, promoLabel, ctaText, ctaUrl, brand);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 540, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Email Preview</div>
            {subject && <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2 }}>Subject: {subject}</div>}
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border)', background: 'var(--pn-surface-alt)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--pn-bg)' }}>
          <iframe title="Email preview" srcDoc={html} style={{ width: '100%', minHeight: 480, border: 'none', display: 'block' }} sandbox="allow-same-origin" />
        </div>
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--pn-border)', textAlign: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>"{'{firstName}'}" shown as "there" for preview</span>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, sub }) {
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent || 'var(--pn-text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--pn-text-faint)', fontSize: 13 }}>{children}</div>;
}

function F({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

const inp = { width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '9px 12px', fontSize: 13, background: 'var(--pn-surface-alt)', outline: 'none' };
