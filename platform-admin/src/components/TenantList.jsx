import { useEffect, useState, useMemo } from 'react';
import { fetchTenants } from '../lib/tenants.js';
import { C, FONT, shadow, radius } from '../theme.js';
import NewTenantModal from './NewTenantModal.jsx';

export default function TenantList() {
  const [tenants,    setTenants]    = useState(null);
  const [search,     setSearch]     = useState('');
  const [planFilter, setPlanFilter] = useState('all');
  const [showNew,    setShowNew]    = useState(false);
  const [error,      setError]      = useState('');

  async function load() {
    setError('');
    try {
      setTenants(await fetchTenants());
    } catch (e) {
      setError(e?.message || 'Failed to load tenants.');
      setTenants([]);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!tenants) return null;
    return tenants.filter(t => {
      const q = search.trim().toLowerCase();
      if (q && !`${t.name || ''} ${t.id} ${t.ownerEmail || ''}`.toLowerCase().includes(q)) return false;
      if (planFilter !== 'all' && (t.plan || 'starter') !== planFilter) return false;
      return true;
    });
  }, [tenants, search, planFilter]);

  const summary = useMemo(() => {
    if (!tenants) return null;
    return {
      total:    tenants.length,
      active:   tenants.filter(t => t.active !== false).length,
      inactive: tenants.filter(t => t.active === false).length,
      legacyPlan: tenants.filter(t => ['starter','pro','enterprise'].includes(t.plan)).length,
      founders: tenants.filter(t => t.foundersMember).length,
    };
  }, [tenants]);

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px', color: C.ink, letterSpacing: '-.005em' }}>Tenants</h1>
          <div style={{ fontSize: 13, color: C.muted }}>
            {summary
              ? `${summary.total} total · ${summary.active} active${summary.inactive ? ` · ${summary.inactive} inactive` : ''}${summary.founders ? ` · ${summary.founders} Founders' Members` : ''}${summary.legacyPlan ? ` · ${summary.legacyPlan} on legacy plan` : ''}`
              : 'Loading…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={btnSecondary()}>↻ Refresh</button>
          <button onClick={() => setShowNew(true)} style={btnPrimary()}>+ New tenant</button>
        </div>
      </div>

      {/* Principle #10 banner */}
      <div style={{
        padding: '10px 14px', marginBottom: 16,
        background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
        fontSize: 12, color: '#1e40af', lineHeight: 1.55,
      }}>
        🔒 <strong>Principle #10 — Founder access by invitation only.</strong>{' '}
        This dashboard surfaces only metadata (counts, plan, last activity). Customer data (clients, appointments, receipts, messages) is never visible from here. To support a tenant, ask them to invite you as an admin via their salon-app users settings — same flow they'd use for any staff member.
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, background: C.dangerSoft, border: `1px solid ${C.danger}40`, borderRadius: 8, fontSize: 13, color: '#991b1b' }}>
          {error}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, ID, or owner email…"
          style={{
            flex: 1, minWidth: 280,
            padding: '8px 12px', fontSize: 13,
            border: `1px solid ${C.rule}`, borderRadius: 8,
            background: C.bgCard, fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <select value={planFilter} onChange={e => setPlanFilter(e.target.value)} style={selectStyle()}>
          <option value="all">All plans</option>
          <option value="starter">starter (legacy)</option>
          <option value="pro">pro (legacy)</option>
          <option value="enterprise">enterprise (legacy)</option>
          <option value="solo">Solo</option>
          <option value="studio">Studio</option>
          <option value="salonPro">Salon Pro</option>
        </select>
      </div>

      {/* Table */}
      <div style={{
        background: C.bgCard, border: `1px solid ${C.rule}`, borderRadius: radius.lg,
        overflow: 'hidden',
      }}>
        {!filtered ? (
          <Empty>Loading tenants…</Empty>
        ) : filtered.length === 0 ? (
          <Empty>No tenants match these filters.</Empty>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.bgCode, borderBottom: `1px solid ${C.rule}` }}>
                <Th>Salon</Th>
                <Th>Plan</Th>
                <Th>Cohort</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th align="right" style={{ width: 60 }}></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => <Row key={t.id} t={t} alt={i % 2 === 1} />)}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewTenantModal
          onClose={() => setShowNew(false)}
          onCreated={async () => { setShowNew(false); await load(); }}
        />
      )}
    </>
  );
}

function Row({ t, alt }) {
  return (
    <tr style={{
      borderBottom: `1px solid ${C.ruleSoft}`,
      background: alt ? C.bgCode : 'transparent',
    }}>
      <Td>
        <a href={`/t/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ fontWeight: 600, color: C.ink }}>{t.name || t.id}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
            <code style={{ background: C.bgCode, padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>{t.id}</code>
            {t.ownerEmail && <span style={{ marginLeft: 8 }}>{t.ownerEmail}</span>}
          </div>
        </a>
      </Td>
      <Td><PlanChip p={t.plan || 'starter'} /></Td>
      <Td>
        {t.foundersMember ? (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: C.successSoft, color: C.success, textTransform: 'uppercase' }}>Founders'</span>
        ) : (
          <span style={{ fontSize: 11, color: C.mutedSoft }}>—</span>
        )}
      </Td>
      <Td>
        {t.active === false ? (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: C.dangerSoft, color: C.danger, textTransform: 'uppercase' }}>Inactive</span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.success, fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.success }} />
            Active
          </span>
        )}
      </Td>
      <Td>{t.createdAt ? t.createdAt.slice(0, 10) : '—'}</Td>
      <Td align="right">
        <a href={`/t/${t.id}`} style={{ fontSize: 12, color: C.plum, fontWeight: 600, textDecoration: 'none' }}>View →</a>
      </Td>
    </tr>
  );
}

function PlanChip({ p }) {
  const NEW = { solo: ['#dcfce7','#16a34a'], studio: ['#dbeafe','#2563eb'], salonPro: ['#ede9fe','#7c3aed'] };
  if (NEW[p]) {
    const [bg, c] = NEW[p];
    const label = p === 'salonPro' ? 'Salon Pro' : p.charAt(0).toUpperCase() + p.slice(1);
    return <span style={{ background: bg, color: c, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase' }}>{label}</span>;
  }
  if (['starter','pro','enterprise'].includes(p)) {
    return <span style={{ border: `1px dashed ${C.warning}`, color: C.warning, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase' }} title="Legacy plan — see migration plan">{p}</span>;
  }
  return <span style={{ background: '#f5f5f5', color: '#888', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase' }}>{p || '—'}</span>;
}

function Th({ children, align = 'left', style = {} }) {
  return (
    <th style={{
      textAlign: align,
      padding: '10px 14px',
      fontSize: 11, fontWeight: 700,
      color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em',
      ...style,
    }}>{children}</th>
  );
}
function Td({ children, align = 'left' }) {
  return <td style={{ padding: '10px 14px', textAlign: align, verticalAlign: 'middle' }}>{children}</td>;
}
function Empty({ children }) {
  return <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>{children}</div>;
}
function btnPrimary() {
  return {
    padding: '8px 14px', fontSize: 13, fontWeight: 600,
    background: C.ink, color: '#fff',
    border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
  };
}
function btnSecondary() {
  return {
    padding: '8px 14px', fontSize: 13, fontWeight: 600,
    background: C.bgCard, color: C.text,
    border: `1px solid ${C.rule}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
  };
}
function selectStyle() {
  return {
    padding: '8px 12px', fontSize: 13,
    border: `1px solid ${C.rule}`, borderRadius: 8,
    background: C.bgCard, fontFamily: 'inherit',
    outline: 'none', cursor: 'pointer',
  };
}
