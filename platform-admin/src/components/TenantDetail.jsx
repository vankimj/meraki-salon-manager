import { useEffect, useState } from 'react';
import { fetchTenantMetadata, updateTenantRecord, provisionTenantDocs } from '../lib/tenants.js';
import { C, FONT, shadow, radius } from '../theme.js';

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
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px', color: C.ink, letterSpacing: '-.005em' }}>{meta.name || meta.id}</h1>
          <div style={{ fontSize: 13, color: C.muted, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span><code style={{ background: C.bgCode, padding: '2px 6px', borderRadius: 3, fontSize: 11 }}>{meta.id}</code></span>
            {meta.ownerEmail && <span>👤 {meta.ownerEmail}</span>}
            {meta.createdAt && <span>📅 Created {meta.createdAt.slice(0, 10)}</span>}
            <StatusBadge status={status} lastActivityIso={meta.lastActivityIso} />
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
      </div>

      {/* Coming-soon panels — all of these are aggregate data only */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <Panel title="Usage + cost (this month)" placeholder>
          AI calls, SMS sends, email sends, storage. Aggregated cost only — no content. Coming Phase 2.
        </Panel>
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
    </>
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
