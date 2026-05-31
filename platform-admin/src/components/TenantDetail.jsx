import { useEffect, useState } from 'react';
import { fetchTenantMetadata, updateTenantRecord, provisionTenantDocs, hardDeleteTenant, setTenantSandboxMode } from '../lib/tenants.js';
import { fetchTenantDailies, fetchTenantMonthly } from '../lib/cost.js';
import { reauthGoogle } from '../lib/firebase.js';
import { C, FONT, shadow, radius } from '../theme.js';
import { CostAreaChart, CostBreakdownCard } from './CostChart.jsx';

function statusFromActivity(lastIso) {
  if (!lastIso) return 'never';
  const days = (Date.now() - new Date(lastIso).getTime()) / 86400000;
  if (days < 7)  return 'active';
  if (days < 30) return 'idle';
  if (days < 90) return 'at-risk';
  return 'dormant';
}

export default function TenantDetail({ tenantId }) {
  const [meta,    setMeta]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [busy,    setBusy]    = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft]     = useState('');
  const [nameError, setNameError]     = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const m = await fetchTenantMetadata(tenantId);
      setMeta(m);
    } catch (e) {
      const msg = e?.message || 'Failed to load tenant.';
      setError(msg);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [tenantId]);

  async function handleToggleActive() {
    if (!meta) return;
    const newActive = meta.active === false ? true : false;
    if (!confirm(newActive ? 'Re-activate this tenant?' : 'Deactivate this tenant? They will lose access until reactivated.')) return;
    setBusy(true);
    try {
      await updateTenantRecord(meta.id, { active: newActive });
      await load();
    } finally { setBusy(false); }
  }

  async function handleProvision() {
    if (!meta) return;
    setBusy(true);
    try {
      const created = await provisionTenantDocs(meta.id, meta.ownerEmail);
      if (!created) alert('Already provisioned.');
      await load();
    } finally { setBusy(false); }
  }

  function startRenaming() {
    setNameDraft(meta?.name || '');
    setNameError('');
    setEditingName(true);
  }
  function cancelRenaming() {
    setEditingName(false);
    setNameDraft('');
    setNameError('');
  }
  async function saveRename() {
    const next = nameDraft.trim();
    if (next.length < 2) { setNameError('Name must be at least 2 characters.'); return; }
    if (next.length > 80) { setNameError('Name must be ≤ 80 characters.'); return; }
    if (next === (meta?.name || '')) { cancelRenaming(); return; }
    setBusy(true); setNameError('');
    try {
      await updateTenantRecord(meta.id, { name: next });
      await load();
      setEditingName(false);
    } catch (e) {
      setNameError(e?.message || 'Rename failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleSandbox() {
    if (!meta) return;
    const newSandbox = !meta.sandboxMode;
    const msg = newSandbox
      ? `Put ${meta.name || meta.id} into SANDBOX mode?\n\nSMS provisioning + sends will be mocked (no Twilio calls, no real charges, no real delivery). Existing real Twilio data on the tenant is left in place.`
      : `Put ${meta.name || meta.id} into PRODUCTION mode?\n\nReal Twilio calls will be made for SMS — TFN purchase is $2/mo, each delivery costs ~$0.008. Make sure this tenant has finished Toll-Free Verification, OR is OK with a fresh provisioning run that may need carrier review (2–7 days).`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await setTenantSandboxMode(meta.id, newSandbox);
      await load();
    } catch (e) {
      alert('Toggle failed: ' + (e?.message || String(e)));
    } finally { setBusy(false); }
  }

  if (loading) return <Empty>Loading tenant…</Empty>;
  if (error)   return <Empty error>{error} · <a href="/" style={{ color: C.plum }}>Back to tenants</a></Empty>;
  if (!meta)   return <Empty>Tenant not found.</Empty>;

  const status = statusFromActivity(meta.lastActivityIso);

  return (
    <>
      {/* Breadcrumb */}
      <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, textDecoration: 'none', marginBottom: 12 }}>
        ← Tenants
      </a>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 16 }}>
        <div>
          {editingName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <input
                autoFocus
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') cancelRenaming(); }}
                placeholder="Salon name"
                style={{ fontSize: 22, fontWeight: 700, color: C.ink, fontFamily: 'inherit', border: `1px solid ${C.plum}`, borderRadius: 6, padding: '4px 10px', outline: 'none', letterSpacing: '-.005em', minWidth: 320 }}
              />
              <button onClick={saveRename} disabled={busy}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: busy ? C.muted : C.plum, color: '#fff', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={cancelRenaming} disabled={busy}
                style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${C.bgCode}`, background: '#fff', color: C.muted, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: C.ink, letterSpacing: '-.005em' }}>{meta.name || meta.id}</h1>
              <button onClick={startRenaming} title="Rename salon"
                style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid transparent`, background: 'transparent', color: C.muted, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}
                onMouseEnter={e => { e.currentTarget.style.background = C.bgCode; e.currentTarget.style.color = C.plum; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted; }}
              >
                ✎
              </button>
            </div>
          )}
          {nameError && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 6 }}>{nameError}</div>}
          <div style={{ fontSize: 13, color: C.muted, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span><code style={{ background: C.bgCode, padding: '2px 6px', borderRadius: 3, fontSize: 11 }}>{meta.id}</code></span>
            {meta.ownerEmail && <span>👤 {meta.ownerEmail}</span>}
            {meta.createdAt && <span>📅 Created {meta.createdAt.slice(0, 10)}</span>}
            <StatusBadge status={status} lastActivityIso={meta.lastActivityIso} />
            {meta.sandboxMode && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', background: '#fef3c7', color: '#92400e', borderRadius: 10, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                🧪 Sandbox
              </span>
            )}
          </div>
        </div>
        {/* No "View as tenant" button — per principle #10, support requires
            the tenant to invite the founder via their own users settings. */}
      </div>

      {/* Principle #10 reminder */}
      <div style={{
        padding: '10px 14px', marginBottom: 18,
        background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
        fontSize: 12, color: '#1e40af', lineHeight: 1.55,
      }}>
        🔒 You're viewing <strong>metadata only</strong>. To access this tenant's clients, appointments, receipts, or messages, ask <strong>{meta.ownerEmail || 'the owner'}</strong> to add your email as an admin in their salon's user settings. Same flow as adding any of their staff.
      </div>

      {/* Card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 24 }}>
        <Card title="Plan">
          <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, textTransform: 'capitalize' }}>{meta.plan || 'unset'}</div>
          {meta.legacyPlan && (
            <div style={{ fontSize: 11, color: C.warning, fontWeight: 600, marginTop: 4 }}>⚠ Legacy: {meta.legacyPlan}</div>
          )}
          {meta.packs?.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {meta.packs.map(p => <span key={p} style={{ fontSize: 9, padding: '2px 6px', background: '#ede9fe', color: '#6d28d9', borderRadius: 3, fontWeight: 700, textTransform: 'uppercase' }}>{p}</span>)}
            </div>
          )}
        </Card>

        <Card title="Status">
          <div style={{ fontSize: 18, fontWeight: 700, color: meta.active === false ? C.danger : C.success }}>
            {meta.active === false ? 'Inactive' : 'Active'}
          </div>
          {meta.foundersMember && (
            <div style={{ fontSize: 10, color: C.success, fontWeight: 700, marginTop: 4, textTransform: 'uppercase' }}>● Founders' Member</div>
          )}
          {meta.pauseActive && (
            <div style={{ fontSize: 10, color: C.warning, fontWeight: 700, marginTop: 4, textTransform: 'uppercase' }}>⏸ Currently paused</div>
          )}
          <button onClick={handleToggleActive} disabled={busy} style={{
            marginTop: 8, padding: '5px 11px', fontSize: 11, fontWeight: 600,
            background: 'transparent', color: meta.active === false ? C.success : C.danger,
            border: `1px solid ${meta.active === false ? C.success : C.danger}40`,
            borderRadius: 6, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
          }}>
            {meta.active === false ? 'Re-activate' : 'Deactivate'}
          </button>
        </Card>

        <Card title="Provisioning">
          <div style={{ fontSize: 18, fontWeight: 700, color: meta.provisioned ? C.success : C.warning }}>
            {meta.provisioned ? '✓ Provisioned' : '⚠ Not provisioned'}
          </div>
          {!meta.provisioned && (
            <button onClick={handleProvision} disabled={busy} style={{
              marginTop: 8, padding: '5px 11px', fontSize: 11, fontWeight: 600,
              background: C.warning, color: '#fff', border: 'none', borderRadius: 6,
              cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
            }}>{busy ? 'Provisioning…' : 'Provision now'}</button>
          )}
        </Card>

        <Card title="Users (count)">
          <div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{meta.userCount}</div>
          <div style={{ fontSize: 10, color: C.mutedSoft, marginTop: 4 }}>Total staff with platform access</div>
        </Card>

        <Card title="Appointments (count)">
          <div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{meta.apptCount.toLocaleString()}</div>
          <div style={{ fontSize: 10, color: C.mutedSoft, marginTop: 4 }}>Total all-time</div>
        </Card>

        <Card title="Last activity">
          <div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>
            {meta.lastActivityIso ? <RelativeTime iso={meta.lastActivityIso} /> : <span style={{ color: C.mutedSoft }}>never</span>}
          </div>
          <div style={{ fontSize: 10, color: C.mutedSoft, marginTop: 4 }}>Most recent appt update / receipt / message</div>
        </Card>

        <Card title="SMS mode">
          <div style={{ fontSize: 18, fontWeight: 700, color: meta.sandboxMode ? '#92400e' : C.success }}>
            {meta.sandboxMode ? '🧪 Sandbox' : '✓ Production'}
          </div>
          <div style={{ fontSize: 10, color: C.mutedSoft, marginTop: 4, lineHeight: 1.4 }}>
            {meta.sandboxMode
              ? 'Wizard auto-approves, no real Twilio calls or charges.'
              : 'Real Twilio: TFN purchase $2/mo, ~$0.008/SMS.'}
          </div>
          <button onClick={handleToggleSandbox} disabled={busy} style={{
            marginTop: 8, padding: '5px 11px', fontSize: 11, fontWeight: 600,
            background: 'transparent',
            color: meta.sandboxMode ? C.success : '#92400e',
            border: `1px solid ${meta.sandboxMode ? C.success : '#92400e'}40`,
            borderRadius: 6, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
          }}>
            {meta.sandboxMode ? 'Switch to Production →' : '← Back to Sandbox'}
          </button>
        </Card>
      </div>

      {/* URLs panel — every public + staff entry point for this tenant. */}
      <TenantUrls slug={meta.subdomain || meta.id} aliases={meta.aliases || []} customDomain={meta.customDomain} />

      {/* Cost & usage section — real per-tenant numbers from the nightly
          aggregator. Wide stacked-area chart on the left, MTD breakdown
          card on the right. Both are pure aggregate; no per-customer signal. */}
      <CostSection tenantId={meta.id} />

      {/* Coming-soon panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <Panel title="Cap status" placeholder>
          Approaching / at / over each cap. No client names — just utilization %. Coming Phase 2.
        </Panel>
        <Panel title="Support tickets" placeholder>
          Inquiries this tenant submitted via contact form. Tenant-initiated only. Coming Phase 2.
        </Panel>
        <Panel title="Recent audit entries" placeholder>
          Platform-admin actions taken on this tenant. Coming Phase 2.
        </Panel>
      </div>

      <DangerZone tenantId={meta.id} slug={meta.subdomain || meta.id} salonName={meta.name} ownerEmail={meta.ownerEmail} />
    </>
  );
}

// 4-gate destructive operation:
//   gate 1: click "Hard delete" → opens modal
//   gate 2: type the slug verbatim (typo defense + intent confirmation)
//   gate 3: re-authenticate with Google (forces fresh sign-in popup —
//           proves a human is at the keyboard and the session wasn't
//           left open by accident)
//   gate 4: Cloud Function receives confirm string `YES-DELETE-{tid}-
//           IRREVERSIBLE` and validates server-side (last-mile defense
//           in case the modal is bypassed somehow).
function DangerZone({ tenantId, slug, salonName, ownerEmail }) {
  const [openModal, setOpenModal] = useState(false);
  return (
    <>
      <div style={{
        marginTop: 32, padding: 18,
        background: '#fef2f2', border: `1px solid #fecaca`, borderRadius: radius.md,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.danger, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
          Danger zone
        </div>
        <div style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.55, marginBottom: 14 }}>
          Hard delete drops every clients / appointments / receipts /
          settings / messages document for this tenant. Slug is
          reserved for 12 months to prevent impersonation. PITR + BQ
          mirror hold recoverable copies but recovery is manual.
        </div>
        <button onClick={() => setOpenModal(true)} style={{
          padding: '9px 16px', fontSize: 13, fontWeight: 700,
          background: C.danger, color: '#fff', border: 'none',
          borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Hard delete this tenant
        </button>
      </div>
      {openModal && (
        <HardDeleteModal
          tenantId={tenantId}
          slug={slug}
          salonName={salonName}
          ownerEmail={ownerEmail}
          onClose={() => setOpenModal(false)}
        />
      )}
    </>
  );
}

function HardDeleteModal({ tenantId, slug, salonName, ownerEmail, onClose }) {
  const [typed,    setTyped]    = useState('');
  const [step,     setStep]     = useState('confirm'); // confirm | reauthing | deleting | done | error
  const [error,    setError]    = useState('');
  const slugMatches = typed.trim().toLowerCase() === slug.toLowerCase();

  async function execute() {
    setError('');
    setStep('reauthing');
    try {
      await reauthGoogle();
    } catch (e) {
      const code = e?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('Re-authentication cancelled.');
      } else if (code === 'auth/user-mismatch') {
        setError('Re-auth picked a different Google account. Pick the same one you signed in with.');
      } else {
        setError(`Re-auth failed: ${e?.message || code || 'unknown'}`);
      }
      setStep('error');
      return;
    }
    setStep('deleting');
    try {
      const res = await hardDeleteTenant(tenantId);
      console.log('[deleteTenant]', res);
      setStep('done');
    } catch (e) {
      setError(`Server delete failed: ${e?.message || e?.code || 'unknown'}`);
      setStep('error');
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 999, padding: 20,
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, maxWidth: 520, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,.35)',
        border: `2px solid ${C.danger}`,
      }}>
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.danger }}>⚠ Hard delete tenant</div>
          {step !== 'deleting' && step !== 'reauthing' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: C.muted, cursor: 'pointer', lineHeight: 1 }}>×</button>
          )}
        </div>

        <div style={{ padding: '14px 24px' }}>
          {step === 'done' ? (
            <>
              <p style={{ fontSize: 14, color: C.text, lineHeight: 1.6, marginBottom: 14 }}>
                <strong>{salonName || slug}</strong> has been hard-deleted. All
                tenant data dropped, slug reserved 12 months, Auth domain
                removed.
              </p>
              <a href="/" style={{
                display: 'inline-block', padding: '9px 16px', fontSize: 13, fontWeight: 700,
                background: C.plum, color: '#fff', borderRadius: 8, textDecoration: 'none',
              }}>← Back to tenant list</a>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, marginBottom: 14 }}>
                You're about to permanently delete <strong>{salonName || slug}</strong>
                {ownerEmail && <> (owner: <code style={{ background: C.bgCode, padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>{ownerEmail}</code>)</>}.
                <br /><br />
                To confirm: type the tenant slug below, then re-sign-in with
                your Google account when the popup appears.
              </p>

              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                Type <code style={{ background: C.bgCode, padding: '1px 5px', borderRadius: 3, fontSize: 12, textTransform: 'none', letterSpacing: 0 }}>{slug}</code> to confirm
              </label>
              <input
                value={typed}
                onChange={e => setTyped(e.target.value)}
                placeholder={slug}
                autoFocus
                disabled={step !== 'confirm' && step !== 'error'}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 12px', fontSize: 14,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  border: `1px solid ${slugMatches ? C.success : C.rule}`,
                  borderRadius: 8, outline: 'none',
                  background: '#fff',
                  marginBottom: 16,
                }}
              />

              {step === 'reauthing' && <Status label="Waiting for Google re-auth…" />}
              {step === 'deleting'  && <Status label="Deleting tenant subtree + reserving slug…" />}
              {error && <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: `1px solid ${C.danger}`, borderRadius: 6, fontSize: 12, color: '#7f1d1d' }}>{error}</div>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button onClick={onClose} disabled={step === 'reauthing' || step === 'deleting'}
                  style={{
                    padding: '9px 14px', fontSize: 13, fontWeight: 600,
                    background: '#fff', color: C.muted, border: `1px solid ${C.rule}`,
                    borderRadius: 8, cursor: step === 'reauthing' || step === 'deleting' ? 'default' : 'pointer', fontFamily: 'inherit',
                  }}>Cancel</button>
                <button onClick={execute} disabled={!slugMatches || step === 'reauthing' || step === 'deleting'}
                  style={{
                    padding: '9px 16px', fontSize: 13, fontWeight: 700,
                    background: C.danger, color: '#fff', border: 'none',
                    borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                    opacity: (!slugMatches || step === 'reauthing' || step === 'deleting') ? 0.4 : 1,
                  }}>
                  {step === 'reauthing' ? 'Re-authenticating…' : step === 'deleting' ? 'Deleting…' : 'Re-auth + delete'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Status({ label }) {
  return (
    <div style={{
      padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe',
      borderRadius: 8, fontSize: 12, color: '#1e40af', fontWeight: 600,
      marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{
        display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
        border: `2px solid #1e40af`, borderTopColor: 'transparent',
        animation: 'spin .8s linear infinite',
      }} />
      {label}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function TenantUrls({ slug, aliases, customDomain }) {
  const base = `https://${slug}.plumenexus.com`;
  const rows = [
    { label: 'Public webfront',     path: '/',            note: 'Landing page — services, team, booking CTA' },
    { label: 'Booking page',        path: '/book',        note: 'Online booking flow' },
    { label: 'Staff app',           path: '/manage',      note: 'Sign-in required — owner + staff' },
    { label: 'TipFlow kiosk',       path: '/tipflow',     note: 'iPad checkout / tip kiosk' },
    { label: 'Walk-in queue',       path: '/queue',       note: 'Front-desk arrival kiosk' },
    { label: 'Privacy policy',      path: '/privacy',     note: 'Public legal page' },
    { label: 'Terms of service',    path: '/terms',       note: 'Public legal page' },
    { label: 'SMS consent',         path: '/sms-consent', note: 'TFN reviewer + opt-in proof page' },
  ];
  return (
    <div style={{
      marginTop: 8, marginBottom: 24,
      background: C.bgCard, border: `1px solid ${C.rule}`, borderRadius: radius.md,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.rule}`, background: C.bgCode }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>Tenant URLs</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {rows.map((r, i) => (
            <UrlRow key={r.path} label={r.label} url={`${base}${r.path}`} note={r.note} top={i === 0} />
          ))}
          {customDomain && (
            <UrlRow label="Custom domain" url={`https://${customDomain}`} note="Pro+ vanity domain — same app served via tenant's own hostname" badge="PRO" />
          )}
          {aliases.length > 0 && aliases.map(a => (
            <UrlRow key={a} label="Alias (301 → primary)" url={`https://${a}.plumenexus.com`} note={`Redirects to ${slug}.plumenexus.com — kept active forever per subdomain-change policy`} muted />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UrlRow({ label, url, note, top, muted, badge }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <tr style={{ borderTop: top ? 'none' : `1px solid ${C.rule}`, opacity: muted ? 0.7 : 1 }}>
      <td style={{ padding: '10px 16px', verticalAlign: 'top', width: '24%' }}>
        <div style={{ fontWeight: 700, color: C.ink, fontSize: 13 }}>
          {label}
          {badge && <span style={{ marginLeft: 6, fontSize: 9, padding: '2px 6px', background: '#ede9fe', color: '#6d28d9', borderRadius: 3, fontWeight: 700, letterSpacing: '.04em' }}>{badge}</span>}
        </div>
        <div style={{ fontSize: 10, color: C.mutedSoft, marginTop: 3, lineHeight: 1.4 }}>{note}</div>
      </td>
      <td style={{ padding: '10px 16px', verticalAlign: 'middle' }}>
        <code style={{
          background: C.bgCode, padding: '4px 8px', borderRadius: 4,
          fontSize: 11, color: C.text, fontFamily: 'ui-monospace, Menlo, monospace',
          wordBreak: 'break-all',
        }}>{url}</code>
      </td>
      <td style={{ padding: '10px 16px', verticalAlign: 'middle', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <button onClick={copy} style={{
          padding: '4px 10px', fontSize: 11, fontWeight: 600,
          background: copied ? C.successSoft : '#fff', color: copied ? C.success : C.muted,
          border: `1px solid ${copied ? C.success : C.rule}`,
          borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', marginRight: 4,
          transition: 'background .12s, color .12s, border-color .12s',
        }}>{copied ? '✓ Copied' : 'Copy'}</button>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{
          display: 'inline-block', padding: '4px 10px', fontSize: 11, fontWeight: 600,
          background: '#fff', color: C.plum, border: `1px solid ${C.rule}`,
          borderRadius: 4, textDecoration: 'none', fontFamily: 'inherit',
        }}>Open ↗</a>
      </td>
    </tr>
  );
}

function CostSection({ tenantId }) {
  const [days,    setDays]    = useState(30);
  const [dailies, setDailies] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    Promise.all([
      fetchTenantDailies(tenantId, days),
      fetchTenantMonthly(tenantId),
    ])
      .then(([d, m]) => { if (alive) { setDailies(d); setMonthly(m); } })
      .catch(e => { if (alive) setError(e?.message || 'Failed to load cost data.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tenantId, days]);

  return (
    <div style={{
      marginTop: 8, marginBottom: 24,
      background: C.bgCard, border: `1px solid ${C.rule}`, borderRadius: radius.md,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${C.rule}`, background: C.bgCode,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Cost to run this tenant
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                background: days === d ? C.plum : '#fff',
                color: days === d ? '#fff' : C.muted,
                border: `1px solid ${days === d ? C.plum : C.rule}`,
                borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <div style={{
        display: 'grid', gap: 16, padding: 16,
        gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
      }}>
        <div>
          {loading && <div style={{ padding: 32, textAlign: 'center', color: C.mutedSoft, fontSize: 12 }}>Loading…</div>}
          {error   && <div style={{ padding: 16, color: C.danger, fontSize: 12 }}>{error}</div>}
          {!loading && !error && <CostAreaChart data={dailies} height={240} />}
        </div>
        <CostBreakdownCard monthly={monthly} />
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.rule}`, borderRadius: radius.md,
      padding: 16,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.mutedSoft, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Panel({ title, children, placeholder }) {
  return (
    <div style={{
      background: placeholder ? C.bgCode : C.bgCard,
      border: `1px ${placeholder ? 'dashed' : 'solid'} ${C.rule}`,
      borderRadius: radius.md,
      padding: 18,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

function StatusBadge({ status, lastActivityIso }) {
  const META = {
    active:  { label: 'Active',     color: C.success,  bg: C.successSoft },
    idle:    { label: 'Idle',       color: '#0891b2',  bg: '#cffafe' },
    'at-risk': { label: 'At-risk',  color: C.warning,  bg: C.warningSoft },
    dormant: { label: 'Dormant',    color: '#6b7280',  bg: '#f3f4f6' },
    never:   { label: 'Never used', color: C.danger,   bg: C.dangerSoft },
  };
  const m = META[status] || META.never;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, background: m.bg, color: m.color, fontSize: 11, fontWeight: 600 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.color }} />
      {m.label}
      {lastActivityIso && <span style={{ marginLeft: 4, opacity: .7 }}>· <RelativeTime iso={lastActivityIso} /></span>}
    </span>
  );
}

function RelativeTime({ iso }) {
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days < 1)        return `${Math.round(days * 24)}h ago`;
  if (days < 30)       return `${Math.round(days)}d ago`;
  if (days < 365)      return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function Empty({ children, error }) {
  return (
    <div style={{
      padding: 48, textAlign: 'center',
      color: error ? C.danger : C.muted,
      fontSize: 14,
    }}>{children}</div>
  );
}
