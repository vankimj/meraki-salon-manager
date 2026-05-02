import { useState, useEffect, useMemo } from 'react';
import { fetchAppointmentsByRange, fetchClients, fetchReceiptsByRange } from '../../lib/firestore';
import { useApp } from '../../context/AppContext';

// ── helpers ────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOf(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBefore(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function allDatesInRange(start, end) {
  const dates = [];
  const d = new Date(start + 'T12:00:00');
  const e = new Date(end   + 'T12:00:00');
  while (d <= e) { dates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return dates;
}

function fmt$(n) {
  return '$' + Math.round(n).toLocaleString();
}

function apptRevenue(a) {
  return (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
}

// ── compute all metrics ────────────────────────────────
function computeMetrics(appointments) {
  const today = todayStr();
  const done = appointments.filter(a => a.status !== 'cancelled' && a.date <= today);

  const totalRevenue  = done.reduce((s, a) => s + apptRevenue(a), 0);
  const totalAppts    = done.length;
  const walkInAppts   = done.filter(a => !a.clientId);
  const walkIns       = walkInAppts.length;
  const anonymous     = walkInAppts.filter(a => !a.clientName || a.clientName === 'Walk-in').length;
  const namedWalkIns  = walkIns - anonymous;
  const scheduled     = totalAppts - walkIns;
  const avgTicket     = totalAppts ? totalRevenue / totalAppts : 0;

  const byDay = {};
  done.forEach(a => { byDay[a.date] = (byDay[a.date] || 0) + apptRevenue(a); });

  const byTech = {};
  function ensureTech(name) {
    if (!byTech[name]) byTech[name] = { revenue: 0, count: 0, services: {}, clients: new Set() };
  }
  done.forEach(a => {
    if (a.payment?.techSplit) {
      // Multi-tech: attribute revenue and services per split entry
      a.payment.techSplit.forEach(split => {
        ensureTech(split.techName);
        byTech[split.techName].revenue += split.revenue || 0;
        byTech[split.techName].count++;
        if (a.clientId) byTech[split.techName].clients.add(a.clientId);
        // Match services by techName field if present, else distribute evenly
        const techServices = (a.services || []).filter(sv => (sv.techName || a.techName) === split.techName);
        techServices.forEach(sv => {
          const k = sv.name || 'Unknown';
          if (!byTech[split.techName].services[k]) byTech[split.techName].services[k] = { count: 0, revenue: 0 };
          byTech[split.techName].services[k].count++;
          byTech[split.techName].services[k].revenue += Number(sv.price) || 0;
        });
      });
    } else {
      ensureTech(a.techName);
      const rev = apptRevenue(a);
      byTech[a.techName].revenue += rev;
      byTech[a.techName].count++;
      if (a.clientId) byTech[a.techName].clients.add(a.clientId);
      (a.services || []).forEach(sv => {
        const k = sv.name || 'Unknown';
        if (!byTech[a.techName].services[k]) byTech[a.techName].services[k] = { count: 0, revenue: 0 };
        byTech[a.techName].services[k].count++;
        byTech[a.techName].services[k].revenue += Number(sv.price) || 0;
      });
    }
  });
  Object.values(byTech).forEach(t => { t.clientCount = t.clients.size; delete t.clients; });

  const byService = {};
  done.forEach(a => {
    (a.services || []).forEach(sv => {
      const k = sv.name || 'Unknown';
      if (!byService[k]) byService[k] = { revenue: 0, count: 0 };
      byService[k].revenue += Number(sv.price) || 0;
      byService[k].count++;
    });
  });

  const byClient = {};
  done.forEach(a => {
    if (!a.clientId) return;
    if (!byClient[a.clientId]) byClient[a.clientId] = { name: a.clientName, revenue: 0, count: 0 };
    byClient[a.clientId].revenue += apptRevenue(a);
    byClient[a.clientId].count++;
  });

  return { totalRevenue, totalAppts, walkIns, anonymous, namedWalkIns, scheduled, avgTicket, byDay, byTech, byService, byClient };
}

// ── main component ─────────────────────────────────────
const PERIODS = [
  { label: '7D',       days: 7   },
  { label: '30D',      days: 30  },
  { label: '90D',      days: 90  },
  { label: 'All time', days: 730 },
];

const TABS = [
  { id: 'overview',     label: 'Overview' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'tax',          label: 'IRS / Tax Report' },
];

export default function ReportsAdmin() {
  const { isTech, isScheduler } = useApp();
  const [activeTab,  setActiveTab]  = useState('overview');
  const [periodDays,  setPeriodDays]  = useState(30); // number | 'custom'
  const [customStart, setCustomStart] = useState(startOf(30));
  const [customEnd,   setCustomEnd]   = useState(todayStr());
  const [appts,       setAppts]       = useState(null);
  const [priorAppts,  setPriorAppts]  = useState(null);
  const [loading,     setLoading]     = useState(true);

  if (isTech || isScheduler) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 20px', color: '#aaa', fontSize: 14 }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🔒</div>
        <div style={{ fontWeight: 600, color: '#555', marginBottom: 8 }}>Access Restricted</div>
        <div>Reports are available to admin and management staff only.</div>
      </div>
    );
  }

  const isCustom  = periodDays === 'custom';
  const endDate   = isCustom ? customEnd   : todayStr();
  const startDate = isCustom ? customStart : startOf(periodDays);
  const durationDays = isCustom
    ? Math.max(1, Math.round((new Date(endDate + 'T12:00:00') - new Date(startDate + 'T12:00:00')) / 86400000) + 1)
    : periodDays;
  const showComparison = durationDays <= 90;
  const priorStart = daysBefore(startDate, durationDays);
  const priorEnd   = daysBefore(startDate, 1);

  useEffect(() => {
    if (activeTab === 'overview') load();
  }, [startDate, endDate, activeTab]); // eslint-disable-line

  async function load() {
    setLoading(true);
    setAppts(null);
    setPriorAppts(null);
    try {
      const [current, prior] = await Promise.all([
        fetchAppointmentsByRange(startDate, endDate),
        showComparison ? fetchAppointmentsByRange(priorStart, priorEnd) : Promise.resolve([]),
      ]);
      setAppts(current);
      setPriorAppts(prior);
    } catch (e) { console.error('[Reports] load failed:', e); setAppts([]); setPriorAppts([]); }
    finally  { setLoading(false); }
  }

  const metrics      = useMemo(() => appts       ? computeMetrics(appts)       : null, [appts]);
  const priorMetrics = useMemo(() => priorAppts  ? computeMetrics(priorAppts)  : null, [priorAppts]);

  const clientRetention = useMemo(() => {
    if (!metrics || !priorAppts || !appts) return null;
    const priorIds = new Set(priorAppts.filter(a => a.clientId).map(a => a.clientId));
    const today = todayStr();
    const done  = appts.filter(a => a.status !== 'cancelled' && a.date <= today);
    let newCount = 0, returningCount = 0, walkInCount = 0;
    const seen = {};
    done.forEach(a => {
      if (!a.clientId) { walkInCount++; return; }
      if (!seen[a.clientId]) {
        seen[a.clientId] = true;
        priorIds.has(a.clientId) ? returningCount++ : newCount++;
      }
    });
    return { newCount, returningCount, walkInCount, total: newCount + returningCount + walkInCount };
  }, [metrics, priorAppts, appts]);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', paddingBottom: 24 }}>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e8e8e8', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '8px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: activeTab === t.id ? 600 : 400,
            background: 'none', border: 'none', cursor: 'pointer',
            color: activeTab === t.id ? '#1a1a1a' : '#888',
            borderBottom: activeTab === t.id ? '2px solid #2D7A5F' : '2px solid transparent',
            marginBottom: -1, transition: 'color .15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'tax' ? (
        <TaxReport />
      ) : activeTab === 'transactions' ? (
        <TransactionsReport
          startDate={isCustom ? customStart : startOf(periodDays)}
          endDate={isCustom ? customEnd : todayStr()}
          isCustom={isCustom}
          periodDays={periodDays}
          setPeriodDays={setPeriodDays}
          customStart={customStart} setCustomStart={setCustomStart}
          customEnd={customEnd}     setCustomEnd={setCustomEnd}
        />
      ) : (
        <>
          {/* Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {PERIODS.map(p => (
                <PillBtn key={p.days} active={periodDays === p.days} onClick={() => setPeriodDays(p.days)}>
                  {p.label}
                </PillBtn>
              ))}
              <PillBtn active={isCustom} onClick={() => setPeriodDays('custom')}>Custom</PillBtn>
              {isCustom && (
                <>
                  <input type="date" value={customStart} max={customEnd} onChange={e => setCustomStart(e.target.value)}
                    style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #d8d8d8', fontFamily: 'inherit', background: '#fafafa', color: '#555', outline: 'none' }} />
                  <span style={{ color: '#888', fontSize: 12 }}>→</span>
                  <input type="date" value={customEnd} min={customStart} max={todayStr()} onChange={e => setCustomEnd(e.target.value)}
                    style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #d8d8d8', fontFamily: 'inherit', background: '#fafafa', color: '#555', outline: 'none' }} />
                </>
              )}
            </div>
            <ExportMenu appts={appts} metrics={metrics} startDate={startDate} endDate={endDate} />
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>Loading…</div>
          ) : !metrics?.totalAppts ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>No completed appointments in this period.</div>
          ) : (
            <>
              <div className="kpi-grid">
                <KPICard label="Revenue"      value={fmt$(metrics.totalRevenue)} accent="#2D7A5F"
                  current={metrics.totalRevenue}   prev={showComparison ? priorMetrics?.totalRevenue   : undefined} />
                <KPICard label="Appointments" value={metrics.totalAppts.toLocaleString()}
                  current={metrics.totalAppts}     prev={showComparison ? priorMetrics?.totalAppts     : undefined} />
                <KPICard label="Avg Ticket"   value={fmt$(metrics.avgTicket)}
                  current={metrics.avgTicket}      prev={showComparison ? priorMetrics?.avgTicket      : undefined} />
                <KPICard label="Walk-ins"
                  value={`${metrics.walkIns}`}
                  sub={`${metrics.totalAppts ? Math.round(metrics.walkIns / metrics.totalAppts * 100) : 0}% of total`}
                  current={metrics.walkIns}        prev={showComparison ? priorMetrics?.walkIns        : undefined} />
              </div>

              <Card title="Walk-ins vs Scheduled" style={{ marginBottom: 12 }}>
                <WalkInVsScheduled metrics={metrics} />
              </Card>

              {clientRetention && showComparison && (
                <Card title="New vs Returning Clients" style={{ marginBottom: 12 }}>
                  <NewVsReturning retention={clientRetention} periodDays={durationDays} />
                </Card>
              )}

              <Card title="Daily Revenue" style={{ marginBottom: 12 }}>
                <RevenueChart byDay={metrics.byDay} startDate={startDate} endDate={endDate} />
              </Card>

              <Card title="Tech Leaderboard" style={{ marginBottom: 12 }}>
                <Leaderboard byTech={metrics.byTech} />
              </Card>

              <Card title="Top Services" style={{ marginBottom: 12 }}>
                <ServiceTable byService={metrics.byService} />
              </Card>

              <Card title="Top Clients">
                <TopClients byClient={metrics.byClient} />
              </Card>

              <Card title="Top Referrers" style={{ marginTop: 12 }}>
                <ReferralLeaderboard />
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Walk-in vs Scheduled ───────────────────────────────
function WalkInVsScheduled({ metrics }) {
  const { totalAppts, walkIns, scheduled, anonymous, namedWalkIns } = metrics;
  const pctWalk = totalAppts ? Math.round(walkIns / totalAppts * 100) : 0;
  const pctSched = 100 - pctWalk;

  const rows = [
    { label: 'Scheduled (with client record)', count: scheduled,    color: '#3B82F6', pct: pctSched },
    { label: 'Walk-ins (total)',               count: walkIns,      color: '#F59E0B', pct: pctWalk  },
    { label: '  ↳ with name recorded',         count: namedWalkIns, color: '#10B981', pct: totalAppts ? Math.round(namedWalkIns / totalAppts * 100) : 0, sub: true },
    { label: '  ↳ anonymous',                  count: anonymous,    color: '#EF4444', pct: totalAppts ? Math.round(anonymous / totalAppts * 100) : 0, sub: true },
  ];

  return (
    <div>
      <div style={{ height: 10, borderRadius: 6, overflow: 'hidden', display: 'flex', marginBottom: 16 }}>
        <div style={{ width: `${pctSched}%`, background: '#3B82F6', transition: 'width .4s' }} />
        <div style={{ width: `${pctWalk}%`,  background: '#F59E0B', transition: 'width .4s' }} />
      </div>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', marginBottom: 8, paddingLeft: r.sub ? 16 : 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: r.color, flexShrink: 0, marginRight: 8 }} />
          <span style={{ fontSize: r.sub ? 12 : 13, color: r.sub ? '#888' : '#333', flex: 1 }}>{r.label}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginRight: 12 }}>{r.count}</span>
          <span style={{ fontSize: 11, color: '#bbb', width: 36, textAlign: 'right' }}>{r.pct}%</span>
        </div>
      ))}
    </div>
  );
}

// ── New vs Returning clients ───────────────────────────
function NewVsReturning({ retention, periodDays }) {
  const { newCount, returningCount, walkInCount, total } = retention;
  const pctNew  = total ? Math.round(newCount       / total * 100) : 0;
  const pctRet  = total ? Math.round(returningCount / total * 100) : 0;
  const pctWalk = total ? Math.round(walkInCount    / total * 100) : 0;

  const rows = [
    { label: 'Returning clients',     count: returningCount, pct: pctRet,  color: '#2D7A5F' },
    { label: 'New clients',           count: newCount,       pct: pctNew,  color: '#3D95CE' },
    { label: 'Walk-ins (no record)',  count: walkInCount,    pct: pctWalk, color: '#F59E0B' },
  ];

  return (
    <div>
      <div style={{ height: 10, borderRadius: 6, overflow: 'hidden', display: 'flex', marginBottom: 16 }}>
        <div style={{ width: `${pctRet}%`,  background: '#2D7A5F', transition: 'width .4s' }} />
        <div style={{ width: `${pctNew}%`,  background: '#3D95CE', transition: 'width .4s' }} />
        <div style={{ width: `${pctWalk}%`, background: '#F59E0B', transition: 'width .4s' }} />
      </div>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: r.color, flexShrink: 0, marginRight: 8 }} />
          <span style={{ fontSize: 13, color: '#333', flex: 1 }}>{r.label}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginRight: 12 }}>{r.count}</span>
          <span style={{ fontSize: 11, color: '#bbb', width: 36, textAlign: 'right' }}>{r.pct}%</span>
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#bbb', marginTop: 8 }}>
        "New" = client not seen in the prior {periodDays} days
      </div>
    </div>
  );
}

// ── Revenue chart ──────────────────────────────────────
function RevenueChart({ byDay, startDate, endDate }) {
  const [tooltip, setTooltip] = useState(null); // { i, value, label }
  const dates  = allDatesInRange(startDate, endDate);
  const values = dates.map(d => byDay[d] || 0);
  const H = 130;

  const aggregate = dates.length > 45;
  let bars = [];
  if (aggregate) {
    for (let i = 0; i < dates.length; i += 7) {
      const slice = values.slice(i, i + 7);
      bars.push({ label: dates[i], value: slice.reduce((s, v) => s + v, 0) });
    }
  } else {
    bars = dates.map((d, i) => ({ label: d, value: values[i] }));
  }
  const barMax = Math.max(...bars.map(b => b.value), 1);

  function barLabel(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return aggregate
      ? 'wk ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  return (
    <div>
      <svg viewBox={`0 0 600 ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1="0" y1={H - f * H} x2="600" y2={H - f * H} stroke="#f0f0f0" strokeWidth="1" />
        ))}
        {bars.map((b, i) => {
          const slotW = 600 / bars.length;
          const barW  = Math.max(slotW * 0.72, 2);
          const barH  = (b.value / barMax) * (H - 4);
          const x     = i * slotW + (slotW - barW) / 2;
          return (
            <g key={i}
              onMouseEnter={() => setTooltip({ i, value: b.value, label: barLabel(b.label) })}
              onMouseLeave={() => setTooltip(null)}>
              <rect x={i * slotW} y={0} width={slotW} height={H} fill="transparent" />
              <rect x={x} y={H - barH} width={barW} height={Math.max(barH, 1)}
                fill={tooltip?.i === i ? '#2A7AB5' : b.value > 0 ? '#3D95CE' : '#f0f0f0'}
                rx="2" opacity={b.value > 0 ? 1 : 0.4} />
            </g>
          );
        })}
        {tooltip && tooltip.value > 0 && (() => {
          const slotW = 600 / bars.length;
          const cx = tooltip.i * slotW + slotW / 2;
          const barH = (tooltip.value / barMax) * (H - 4);
          const ty = Math.max(H - barH - 6, 38);
          const tw = 90, th = 34;
          const tx = Math.min(Math.max(cx - tw / 2, 0), 600 - tw);
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={tx} y={ty - th} width={tw} height={th} rx={5} fill="rgba(20,20,20,.88)" />
              <text x={tx + tw / 2} y={ty - th + 14} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">{fmt$(tooltip.value)}</text>
              <text x={tx + tw / 2} y={ty - th + 26} textAnchor="middle" fill="rgba(255,255,255,.5)" fontSize="9">{tooltip.label}</text>
            </g>
          );
        })()}
        <line x1="0" y1={H} x2="600" y2={H} stroke="#e0e0e0" strokeWidth="1" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#bbb', marginTop: 4 }}>
        <span>{new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span style={{ fontWeight: 500, color: '#888' }}>{aggregate ? 'weekly' : 'daily'} · max {fmt$(barMax)}</span>
        <span>{new Date(endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </div>
    </div>
  );
}

// ── Leaderboard ────────────────────────────────────────
const MEDALS = ['🥇', '🥈', '🥉'];

function Leaderboard({ byTech }) {
  const [expanded, setExpanded] = useState(null);
  const sorted = Object.entries(byTech).sort((a, b) => b[1].revenue - a[1].revenue);
  const maxRev = sorted[0]?.[1].revenue || 1;

  if (!sorted.length) return <Empty>No data</Empty>;

  return (
    <div>
      {sorted.map(([name, d], i) => {
        const avgTicket = d.count ? d.revenue / d.count : 0;
        const isOpen = expanded === name;
        const topServices = Object.entries(d.services)
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .slice(0, 8);

        return (
          <div key={name} style={{ marginBottom: 2 }}>
            {/* Row */}
            <div
              onClick={() => setExpanded(isOpen ? null : name)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, cursor: 'pointer', background: isOpen ? '#f0f7ff' : 'transparent', transition: 'background .15s' }}
            >
              <div style={{ width: 22, fontSize: 16, textAlign: 'center', flexShrink: 0 }}>
                {MEDALS[i] || <span style={{ fontSize: 12, color: '#bbb', fontWeight: 600 }}>#{i + 1}</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{name}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#2D7A5F', flexShrink: 0, marginLeft: 8 }}>{fmt$(d.revenue)}</span>
                </div>
                <div style={{ height: 5, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                  <div style={{ height: '100%', width: `${(d.revenue / maxRev) * 100}%`, background: i === 0 ? 'linear-gradient(90deg,#f59e0b,#f97316)' : 'linear-gradient(90deg,#2D7A5F,#3D95CE)', borderRadius: 3, transition: 'width .4s' }} />
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#888' }}>
                  <span>{d.count} appts</span>
                  <span>avg {fmt$(avgTicket)}</span>
                  <span>{d.clientCount} client{d.clientCount !== 1 ? 's' : ''}</span>
                </div>
              </div>
              <span style={{ fontSize: 11, color: '#bbb', flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
            </div>

            {/* Drill-down: service history */}
            {isOpen && (
              <div style={{ margin: '0 0 8px 32px', background: '#fafafa', borderRadius: 8, border: '1px solid #e8e8e8', padding: '10px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Service breakdown</div>
                {topServices.length === 0
                  ? <Empty>No service data</Empty>
                  : topServices.map(([svcName, s], si) => (
                    <div key={svcName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: si < topServices.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                      <span style={{ fontSize: 12, color: '#333' }}>{svcName}</span>
                      <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: '#aaa' }}>{s.count}×</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>{fmt$(s.revenue)}</span>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Service table ──────────────────────────────────────
function ServiceTable({ byService }) {
  const sorted = Object.entries(byService)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 12);

  if (!sorted.length) return <Empty>No data</Empty>;
  return (
    <div>
      {sorted.map(([name, d], i) => (
        <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: i < sorted.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
          <span style={{ fontSize: 13, color: '#333' }}>{name}</span>
          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{fmt$(d.revenue)}</span>
            <span style={{ fontSize: 11, color: '#bbb', marginLeft: 6 }}>{d.count}×</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Top clients ────────────────────────────────────────
function TopClients({ byClient }) {
  const sorted = Object.entries(byClient)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 10);

  if (!sorted.length) return <Empty>No data</Empty>;

  const cols = [sorted.slice(0, 5), sorted.slice(5, 10)];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
      {cols.map((col, ci) => (
        <div key={ci}>
          {col.map(([, d], i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: i < col.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
              <div>
                <span style={{ fontSize: 13, color: '#333', fontWeight: 500 }}>{d.name}</span>
                <span style={{ fontSize: 11, color: '#bbb', marginLeft: 8 }}>{d.count} visit{d.count !== 1 ? 's' : ''}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', flexShrink: 0, marginLeft: 12 }}>{fmt$(d.revenue)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Referral leaderboard ──────────────────────────────
function ReferralLeaderboard() {
  const [clients, setClients] = useState(null);

  useEffect(() => {
    fetchClients().then(setClients).catch(() => setClients([]));
  }, []);

  if (!clients) return <div style={{ fontSize: 13, color: '#bbb', padding: '12px 0' }}>Loading…</div>;

  const referralMap = {};
  clients.forEach(c => {
    if (c.referredBy?.id) {
      if (!referralMap[c.referredBy.id]) referralMap[c.referredBy.id] = { name: c.referredBy.name, count: 0, referrals: [] };
      referralMap[c.referredBy.id].count++;
      referralMap[c.referredBy.id].referrals.push(c.name);
    }
  });

  const sorted = Object.values(referralMap).sort((a, b) => b.count - a.count).slice(0, 10);
  if (!sorted.length) return <Empty>No referrals recorded yet. Add "Referred by" on client profiles to track this.</Empty>;

  return (
    <div>
      {sorted.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < sorted.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: i === 0 ? '#fbbf24' : i === 1 ? '#9ca3af' : i === 2 ? '#d97706' : '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: i < 3 ? '#fff' : '#aaa', flexShrink: 0 }}>
            {i + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{r.name}</div>
            <div style={{ fontSize: 11, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.referrals.join(', ')}</div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#2D7A5F', flexShrink: 0 }}>
            {r.count} {r.count === 1 ? 'referral' : 'referrals'}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── IRS / Tax Report ───────────────────────────────────
const PAY_METHODS = [
  { id: 'all',   label: 'All methods' },
  { id: 'cash',  label: 'Cash only'   },
  { id: 'card',  label: 'Card only'   },
  { id: 'venmo', label: 'Venmo only'  },
  { id: 'zelle', label: 'Zelle only'  },
];

const QUARTERS = [
  { id: 'all', label: 'All quarters' },
  { id: '1',   label: 'Q1 (Jan–Mar)' },
  { id: '2',   label: 'Q2 (Apr–Jun)' },
  { id: '3',   label: 'Q3 (Jul–Sep)' },
  { id: '4',   label: 'Q4 (Oct–Dec)' },
];

const QUARTER_MONTHS = { 1: [1,2,3], 2: [4,5,6], 3: [7,8,9], 4: [10,11,12] };

// ─── Transactions Report (filterable + per-tech detail) ───────────────
const METHOD_LABELS = { card: 'Credit card', cash: 'Cash', venmo: 'Venmo', other: 'Other' };

// For done appointments that don't have a receipt row (legacy / demo data),
// build a receipt-shaped object so the Transactions tab can still surface them.
function apptToSyntheticReceipt(a) {
  const sales = (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
  const p = a.payment || {};
  const startISO = `${a.date}T${(a.startTime || '12:00')}:00.000Z`;
  return {
    id:           `appt:${a.id}`,
    apptIds:      [a.id],
    clientId:     a.clientId || null,
    clientName:   a.clientName || '',
    clientEmail:  a.clientEmail || null,
    techName:     a.techName || '',
    date:         a.date,
    startTime:    a.startTime || '',
    services:     (a.services || []).map(sv => ({ name: sv.name, price: sv.price, techName: sv.techName || a.techName })),
    retailProducts: p.retailProducts || null,
    giftCardsSold:  null,
    createdAt:    p.paidAt || startISO,
    payment: {
      subtotal:     p.subtotal     ?? sales,
      discountAmount: p.discountAmount ?? 0,
      promoAmount:  p.promoAmount  ?? 0,
      tax:          p.tax          ?? 0,
      taxRate:      p.taxRate      ?? 0,
      tip:          p.tip          ?? 0,
      total:        p.total        ?? sales,
      method:       p.method       ?? 'other',
      ccFee:        p.ccFee        ?? 0,
      gcSalesTotal: p.gcSalesTotal ?? 0,
      techSplit:    p.techSplit    || null,
      _synthetic:   !p.paidAt,
    },
  };
}

function TransactionsReport({ startDate, endDate, isCustom, periodDays, setPeriodDays, customStart, setCustomStart, customEnd, setCustomEnd }) {
  const [receipts, setReceipts] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [methodFilter, setMethodFilter] = useState('all');   // all | card | cash | other
  const [typeFilter,   setTypeFilter]   = useState('all');   // all | service | retail | gcSale
  const [techFilter,   setTechFilter]   = useState('all');   // all | <techName>

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchReceiptsByRange(startDate, endDate).catch(() => []),
      fetchAppointmentsByRange(startDate, endDate).catch(() => []),
    ]).then(([rs, as]) => {
      // Receipts are the canonical record. For appointments marked done that
      // don't have a corresponding receipt (legacy / demo / pre-receipt data),
      // synthesize a receipt-shaped row so the report covers the full history.
      const covered = new Set();
      rs.forEach(r => (r.apptIds || []).forEach(id => covered.add(id)));
      const synthesized = as
        .filter(a => a.status === 'done' && !covered.has(a.id))
        .map(a => apptToSyntheticReceipt(a));
      const all = [...rs, ...synthesized].sort(
        (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
      );
      setReceipts(all);
    }).finally(() => setLoading(false));
  }, [startDate, endDate]);

  const allTechs = useMemo(() => {
    const set = new Set();
    (receipts || []).forEach(r => {
      if (r.payment?.techSplit) r.payment.techSplit.forEach(s => s.techName && set.add(s.techName));
      else if (r.techName) r.techName.split(',').map(t => t.trim()).filter(Boolean).forEach(t => set.add(t));
    });
    return Array.from(set).sort();
  }, [receipts]);

  // Filter rows
  const filtered = useMemo(() => {
    if (!receipts) return [];
    return receipts.filter(r => {
      if (methodFilter !== 'all') {
        const m = r.payment?.method || 'other';
        if (methodFilter === 'card'  && m !== 'card') return false;
        if (methodFilter === 'cash'  && m !== 'cash') return false;
        if (methodFilter === 'other' && (m === 'card' || m === 'cash')) return false;
      }
      if (typeFilter !== 'all') {
        const hasService = (r.services || []).length > 0;
        const hasRetail  = (r.retailProducts || []).length > 0;
        const hasGcSale  = (r.giftCardsSold || []).length > 0 || (r.payment?.gcSalesTotal || 0) > 0;
        if (typeFilter === 'service' && !hasService) return false;
        if (typeFilter === 'retail'  && !hasRetail)  return false;
        if (typeFilter === 'gcSale'  && !hasGcSale)  return false;
      }
      if (techFilter !== 'all') {
        const techs = r.payment?.techSplit
          ? r.payment.techSplit.map(s => s.techName)
          : (r.techName || '').split(',').map(t => t.trim()).filter(Boolean);
        if (!techs.includes(techFilter)) return false;
      }
      return true;
    });
  }, [receipts, methodFilter, typeFilter, techFilter]);

  // Per-tech aggregate from filtered receipts
  const perTech = useMemo(() => {
    const m = {};
    function ensure(name) {
      if (!m[name]) m[name] = { appts: 0, sales: 0, tax: 0, tips: 0, card: 0, cash: 0, ccFees: 0 };
    }
    filtered.forEach(r => {
      const p = r.payment || {};
      const total = p.total || 0;
      const subtotalSvc = (r.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
      // Allocation of tax/method/ccFee proportional to a tech's share of services
      if (p.techSplit && p.techSplit.length > 0) {
        const totalSvcRev = p.techSplit.reduce((s, t) => s + (t.revenue || 0), 0);
        p.techSplit.forEach(t => {
          ensure(t.techName);
          const ratio = totalSvcRev > 0 ? (t.revenue || 0) / totalSvcRev : 1 / p.techSplit.length;
          m[t.techName].appts += 1 / p.techSplit.length;
          m[t.techName].sales += t.revenue || 0;
          m[t.techName].tax   += (p.tax || 0) * ratio;
          m[t.techName].tips  += t.tipShare || 0;
          if (p.method === 'card') {
            m[t.techName].card   += total * ratio;
            m[t.techName].ccFees += (p.ccFee || 0) * ratio;
          } else if (p.method === 'cash') {
            m[t.techName].cash   += total * ratio;
          }
        });
      } else if (r.techName) {
        const t = r.techName.split(',')[0].trim() || '—';
        ensure(t);
        m[t].appts += 1;
        m[t].sales += subtotalSvc;
        m[t].tax   += p.tax || 0;
        m[t].tips  += p.tip || 0;
        if (p.method === 'card') { m[t].card += total; m[t].ccFees += p.ccFee || 0; }
        else if (p.method === 'cash') m[t].cash += total;
      }
    });
    return Object.entries(m).sort((a, b) => b[1].sales - a[1].sales);
  }, [filtered]);

  // Salon-level totals (including non-tech-attributed lines like gift card sales)
  const totals = useMemo(() => {
    let sales = 0, tax = 0, tips = 0, card = 0, cash = 0, gcSold = 0, ccFees = 0;
    filtered.forEach(r => {
      const p = r.payment || {};
      const svcRev   = (r.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
      const retail   = (r.retailProducts || []).reduce((s, x) => s + (x.price || 0) * (x.qty || 1), 0);
      sales  += svcRev + retail;
      tax    += p.tax || 0;
      tips   += p.tip || 0;
      gcSold += p.gcSalesTotal || 0;
      ccFees += p.ccFee || 0;
      if (p.method === 'card') card += p.total || 0;
      else if (p.method === 'cash') cash += p.total || 0;
    });
    return { sales, tax, tips, card, cash, gcSold, ccFees };
  }, [filtered]);

  function exportCSV() {
    const rows = [['Date','Time','Client','Tech(s)','Type','Sales','Tax','Tip','Method','GC Sold','CC Fee','Total']];
    filtered.forEach(r => {
      const p = r.payment || {};
      const dt = (r.createdAt || '').slice(0, 19).replace('T', ' ');
      const svcRev = (r.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
      const retail = (r.retailProducts || []).reduce((s, x) => s + (x.price || 0) * (x.qty || 1), 0);
      const types = [];
      if ((r.services || []).length)        types.push('service');
      if ((r.retailProducts || []).length)  types.push('retail');
      if ((r.giftCardsSold || []).length)   types.push('GC sale');
      rows.push([
        dt.split(' ')[0], dt.split(' ')[1] || '',
        r.clientName || '',
        r.techName || (r.payment?.techSplit || []).map(s => s.techName).join(', '),
        types.join('+') || '—',
        (svcRev + retail).toFixed(2),
        (p.tax || 0).toFixed(2),
        (p.tip || 0).toFixed(2),
        p.method || '',
        (p.gcSalesTotal || 0).toFixed(2),
        (p.ccFee || 0).toFixed(2),
        (p.total || 0).toFixed(2),
      ]);
    });
    dlCSV(`transactions_${startDate}_to_${endDate}.csv`, rows);
  }

  return (
    <>
      {/* Date toolbar (mirrors Overview) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {PERIODS.map(p => (
            <PillBtn key={p.days} active={periodDays === p.days} onClick={() => setPeriodDays(p.days)}>{p.label}</PillBtn>
          ))}
          <PillBtn active={isCustom} onClick={() => setPeriodDays('custom')}>Custom</PillBtn>
          {isCustom && (
            <>
              <input type="date" value={customStart} max={customEnd} onChange={e => setCustomStart(e.target.value)}
                style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #d8d8d8', fontFamily: 'inherit', background: '#fafafa', color: '#555', outline: 'none' }} />
              <span style={{ color: '#888', fontSize: 12 }}>→</span>
              <input type="date" value={customEnd} min={customStart} max={todayStr()} onChange={e => setCustomEnd(e.target.value)}
                style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #d8d8d8', fontFamily: 'inherit', background: '#fafafa', color: '#555', outline: 'none' }} />
            </>
          )}
        </div>
        <button onClick={exportCSV} disabled={!filtered.length}
          style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: '1px solid #2D7A5F', background: filtered.length ? '#2D7A5F' : '#d0d0d0', color: '#fff', fontWeight: 600, cursor: filtered.length ? 'pointer' : 'default', fontFamily: 'inherit' }}>
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterGroup label="Method" value={methodFilter} onChange={setMethodFilter} options={[
          { id: 'all',   label: 'All' },
          { id: 'card',  label: '💳 Card' },
          { id: 'cash',  label: '💵 Cash' },
          { id: 'other', label: 'Other' },
        ]} />
        <FilterGroup label="Type" value={typeFilter} onChange={setTypeFilter} options={[
          { id: 'all',     label: 'All' },
          { id: 'service', label: 'Service' },
          { id: 'retail',  label: 'Retail' },
          { id: 'gcSale',  label: '🎁 Gift card' },
        ]} />
        {allTechs.length > 0 && (
          <select value={techFilter} onChange={e => setTechFilter(e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fff', fontFamily: 'inherit', color: '#333' }}>
            <option value="all">All techs</option>
            {allTechs.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>Loading…</div>
      ) : !filtered.length ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb', fontSize: 13 }}>No transactions match these filters.</div>
      ) : (
        <>
          {/* KPI summary band — salon-level totals reflecting the active filter */}
          <div className="kpi-grid" style={{ marginBottom: 12 }}>
            <KPICard label="Sales"     value={fmt$(totals.sales)} accent="#2D7A5F" />
            <KPICard label="Tax"       value={fmt$(totals.tax)} />
            <KPICard label="Tips"      value={fmt$(totals.tips)} />
            <KPICard label="Card"      value={fmt$(totals.card)} sub={`${filtered.filter(r => r.payment?.method === 'card').length} txns`} />
            <KPICard label="Cash"      value={fmt$(totals.cash)} sub={`${filtered.filter(r => r.payment?.method === 'cash').length} txns`} />
            <KPICard label="GC sold"   value={fmt$(totals.gcSold)} accent="#7c3aed" />
            <KPICard label="CC fees"   value={fmt$(totals.ccFees)} sub="recorded" />
          </div>

          {perTech.length > 0 && (
            <Card title="Per-Tech Detail" style={{ marginBottom: 12 }}>
              <PerTechTable rows={perTech} />
            </Card>
          )}

          <Card title={`Transactions (${filtered.length})`}>
            <TransactionList receipts={filtered} />
          </Card>
        </>
      )}
    </>
  );
}

function FilterGroup({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 4px', background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 8 }}>
      <span style={{ fontSize: 11, color: '#888', fontWeight: 600, marginLeft: 6 }}>{label}:</span>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none',
            background: value === o.id ? '#2D7A5F' : 'transparent',
            color: value === o.id ? '#fff' : '#666',
            fontWeight: value === o.id ? 700 : 500,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PerTechTable({ rows }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
        <thead>
          <tr style={{ background: '#fafafa', textAlign: 'left' }}>
            <Th>Tech</Th>
            <Th>Appts</Th>
            <Th>Sales</Th>
            <Th>Tax</Th>
            <Th>Tips</Th>
            <Th>Card</Th>
            <Th>Cash</Th>
            <Th>CC fees</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, d]) => (
            <tr key={name} style={{ borderTop: '1px solid #f0f0f0' }}>
              <Td bold>{name}</Td>
              <Td>{Math.round(d.appts)}</Td>
              <Td green>{fmt$(d.sales)}</Td>
              <Td>{fmt$(d.tax)}</Td>
              <Td>{fmt$(d.tips)}</Td>
              <Td>{fmt$(d.card)}</Td>
              <Td>{fmt$(d.cash)}</Td>
              <Td muted>{fmt$(d.ccFees)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransactionList({ receipts }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 880 }}>
        <thead>
          <tr style={{ background: '#fafafa', textAlign: 'left' }}>
            <Th>Date</Th>
            <Th>Client</Th>
            <Th>Tech(s)</Th>
            <Th>Type</Th>
            <Th>Sales</Th>
            <Th>Tax</Th>
            <Th>Tip</Th>
            <Th>Method</Th>
            <Th>GC sold</Th>
            <Th>CC fee</Th>
            <Th>Total</Th>
          </tr>
        </thead>
        <tbody>
          {receipts.map(r => {
            const p = r.payment || {};
            const dt = (r.createdAt || '').slice(0, 16).replace('T', ' ');
            const svcRev = (r.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
            const retail = (r.retailProducts || []).reduce((s, x) => s + (x.price || 0) * (x.qty || 1), 0);
            const techs = r.payment?.techSplit
              ? r.payment.techSplit.map(s => s.techName).join(', ')
              : (r.techName || '—');
            const types = [];
            if ((r.services || []).length)       types.push('Service');
            if ((r.retailProducts || []).length) types.push('Retail');
            if ((r.giftCardsSold || []).length || (p.gcSalesTotal || 0) > 0) types.push('GC sale');
            return (
              <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                <Td muted>{dt}</Td>
                <Td>{r.clientName || '—'}</Td>
                <Td>{techs}</Td>
                <Td muted>{types.join(' + ') || '—'}</Td>
                <Td>{fmt$(svcRev + retail)}</Td>
                <Td muted>{fmt$(p.tax || 0)}</Td>
                <Td muted>{fmt$(p.tip || 0)}</Td>
                <Td>{METHOD_LABELS[p.method] || p.method || '—'}</Td>
                <Td>{p.gcSalesTotal > 0 ? fmt$(p.gcSalesTotal) : '—'}</Td>
                <Td muted>{p.ccFee > 0 ? fmt$(p.ccFee) : '—'}</Td>
                <Td bold green>{fmt$(p.total || 0)}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function taxRevenue(a, techFilter) {
  if (techFilter !== 'all' && a.payment?.techSplit) {
    const split = a.payment.techSplit.find(t => t.techName === techFilter);
    return split?.revenue || 0;
  }
  return a.payment?.total ?? apptRevenue(a);
}

function TaxReport() {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  const [year,      setYear]      = useState(currentYear);
  const [quarter,   setQuarter]   = useState('all');
  const [payMethod, setPayMethod] = useState('all');
  const [tech,      setTech]      = useState('all');
  const [appts,     setAppts]     = useState(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => { loadYear(); }, [year]); // eslint-disable-line

  async function loadYear() {
    setLoading(true);
    setAppts(null);
    try {
      const data = await fetchAppointmentsByRange(`${year}-01-01`, `${year}-12-31`);
      setAppts(data);
    } catch (e) {
      console.error('[TaxReport] load failed:', e);
      setAppts([]);
    } finally {
      setLoading(false);
    }
  }

  const allTechs = useMemo(() => {
    if (!appts) return [];
    const names = new Set();
    appts.forEach(a => {
      if (a.payment?.techSplit) {
        a.payment.techSplit.forEach(t => { if (t.techName) names.add(t.techName); });
      } else if (a.techName) {
        names.add(a.techName);
      }
    });
    return [...names].sort();
  }, [appts]);

  const filtered = useMemo(() => {
    if (!appts) return [];
    const today = todayStr();
    return appts.filter(a => {
      if (a.status === 'cancelled' || a.date > today) return false;

      if (quarter !== 'all') {
        const mo = parseInt(a.date.slice(5, 7), 10);
        if (!QUARTER_MONTHS[parseInt(quarter, 10)].includes(mo)) return false;
      }

      if (payMethod !== 'all') {
        const method = (a.payment?.method || '').toLowerCase();
        if (method !== payMethod) return false;
      }

      if (tech !== 'all') {
        if (a.payment?.techSplit) {
          if (!a.payment.techSplit.some(t => t.techName === tech)) return false;
        } else {
          if (a.techName !== tech) return false;
        }
      }

      return true;
    });
  }, [appts, quarter, payMethod, tech]);

  // Quarterly totals (always show all 4 regardless of quarter filter)
  const quarterTotals = useMemo(() => {
    if (!appts) return {};
    const today = todayStr();
    const base = appts.filter(a => a.status !== 'cancelled' && a.date <= today);
    const methodBase = payMethod === 'all' ? base : base.filter(a => (a.payment?.method || '').toLowerCase() === payMethod);
    const techBase = tech === 'all' ? methodBase : methodBase.filter(a => {
      if (a.payment?.techSplit) return a.payment.techSplit.some(t => t.techName === tech);
      return a.techName === tech;
    });
    const totals = {};
    [1,2,3,4].forEach(q => {
      const months = QUARTER_MONTHS[q];
      const qAppts = techBase.filter(a => months.includes(parseInt(a.date.slice(5, 7), 10)));
      totals[q] = {
        revenue: qAppts.reduce((s, a) => s + taxRevenue(a, tech), 0),
        count:   qAppts.length,
      };
    });
    return totals;
  }, [appts, payMethod, tech]);

  const monthlyRows = useMemo(() => {
    const months = {};
    filtered.forEach(a => {
      const m = a.date.slice(0, 7);
      if (!months[m]) months[m] = { revenue: 0, count: 0, cash: 0, card: 0, venmo: 0, zelle: 0, other: 0 };
      const rev = taxRevenue(a, tech);
      months[m].revenue += rev;
      months[m].count++;
      const method = (a.payment?.method || '').toLowerCase();
      if      (method === 'cash')  months[m].cash  += rev;
      else if (method === 'card')  months[m].card  += rev;
      else if (method === 'venmo') months[m].venmo += rev;
      else if (method === 'zelle') months[m].zelle += rev;
      else                         months[m].other += rev;
    });
    return Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, tech]);

  const tech1099 = useMemo(() => {
    const byTech = {};
    filtered.forEach(a => {
      if (a.payment?.techSplit) {
        a.payment.techSplit.forEach(split => {
          if (tech !== 'all' && split.techName !== tech) return;
          if (!byTech[split.techName]) byTech[split.techName] = { revenue: 0, count: 0 };
          byTech[split.techName].revenue += split.revenue || 0;
          byTech[split.techName].count++;
        });
      } else {
        const tname = a.techName || 'Unknown';
        if (tech !== 'all' && tname !== tech) return;
        if (!byTech[tname]) byTech[tname] = { revenue: 0, count: 0 };
        byTech[tname].revenue += taxRevenue(a, tech);
        byTech[tname].count++;
      }
    });
    return Object.entries(byTech).sort((a, b) => b[1].revenue - a[1].revenue);
  }, [filtered, tech]);

  const totalRev    = filtered.reduce((s, a) => s + taxRevenue(a, tech), 0);
  const totalCount  = filtered.length;
  const showMethodCols = payMethod === 'all';

  function exportTaxCSV() {
    const filterLabel = [
      `Year: ${year}`,
      quarter !== 'all' ? `Q${quarter}` : 'Full Year',
      payMethod !== 'all' ? PAY_METHODS.find(m => m.id === payMethod)?.label : 'All methods',
      tech !== 'all' ? tech : 'All techs',
    ].join(' | ');

    const rows = [
      ['Meraki Nail Studio — IRS / Tax Report'],
      [filterLabel],
      ['Generated', todayStr()],
      [],
      ['=== QUARTERLY SUMMARY ==='],
      ['Quarter', 'Revenue ($)', 'Appointments'],
      ...[1,2,3,4].map(q => [`Q${q}`, (quarterTotals[q]?.revenue || 0).toFixed(2), (quarterTotals[q]?.count || 0)]),
      ['TOTAL', totalRev.toFixed(2), totalCount],
      [],
      ['=== MONTHLY BREAKDOWN ==='],
      showMethodCols
        ? ['Month', 'Revenue ($)', 'Appointments', 'Cash ($)', 'Card ($)', 'Venmo ($)', 'Zelle ($)', 'Other ($)']
        : ['Month', 'Revenue ($)', 'Appointments'],
      ...monthlyRows.map(([m, d]) => {
        const [yr, mo] = m.split('-');
        const label = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        return showMethodCols
          ? [label, d.revenue.toFixed(2), d.count, d.cash.toFixed(2), d.card.toFixed(2), d.venmo.toFixed(2), d.zelle.toFixed(2), d.other.toFixed(2)]
          : [label, d.revenue.toFixed(2), d.count];
      }),
      [],
      ['=== 1099 CONTRACTOR SUMMARY ==='],
      ['Contractor', 'Revenue ($)', 'Appointments', '1099-NEC Required (>=$600)'],
      ...tech1099.map(([name, d]) => [name, d.revenue.toFixed(2), d.count, d.revenue >= 600 ? 'YES — File 1099-NEC' : 'No']),
    ];
    dlCSV(`meraki-tax-report-${year}${quarter !== 'all' ? '-Q' + quarter : ''}${payMethod !== 'all' ? '-' + payMethod : ''}.csv`, rows);
  }

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20, alignItems: 'center' }}>
        {/* Year */}
        <div style={{ display: 'flex', gap: 4 }}>
          {years.map(y => (
            <PillBtn key={y} active={year === y} onClick={() => setYear(y)}>{y}</PillBtn>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: '#e0e0e0', flexShrink: 0 }} />

        {/* Quarter */}
        <select value={quarter} onChange={e => setQuarter(e.target.value)} style={filterSelectStyle}>
          {QUARTERS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
        </select>

        {/* Payment method */}
        <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={filterSelectStyle}>
          {PAY_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>

        {/* Tech */}
        <select value={tech} onChange={e => setTech(e.target.value)} style={filterSelectStyle}>
          <option value="all">All techs</option>
          {allTechs.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <div style={{ flex: 1 }} />

        <button onClick={exportTaxCSV} disabled={!appts?.length}
          style={{ padding: '7px 16px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', border: '1px solid #2D7A5F', background: '#2D7A5F', color: '#fff', cursor: !appts?.length ? 'default' : 'pointer', fontWeight: 500, opacity: !appts?.length ? .4 : 1 }}>
          ↓ Export CSV
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>Loading {year}…</div>
      ) : !appts?.length ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>No completed appointments for {year}.</div>
      ) : (
        <>
          {/* KPI row */}
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <KPICard label="Total Revenue"   value={fmt$(totalRev)}                  accent="#2D7A5F" />
            <KPICard label="Appointments"    value={totalCount.toLocaleString()} />
            <KPICard label="Avg Ticket"      value={totalCount ? fmt$(totalRev / totalCount) : '$0'} />
            <KPICard label="1099 Required"   value={tech1099.filter(([, d]) => d.revenue >= 600).length.toString()} sub="techs ≥ $600" />
          </div>

          {/* Quarterly summary */}
          <Card title="Quarterly Summary" style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {[1,2,3,4].map(q => {
                const d = quarterTotals[q] || { revenue: 0, count: 0 };
                const isActive = quarter === String(q);
                return (
                  <div key={q} onClick={() => setQuarter(isActive ? 'all' : String(q))}
                    style={{ background: isActive ? '#e8f4ee' : '#fafafa', border: `1px solid ${isActive ? '#2D7A5F' : '#e8e8e8'}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'all .15s' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: isActive ? '#2D7A5F' : '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Q{q}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', lineHeight: 1 }}>{fmt$(d.revenue)}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{d.count} appts</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, fontSize: 13, color: '#555', fontWeight: 600 }}>
              Year total: {fmt$(Object.values(quarterTotals).reduce((s, d) => s + d.revenue, 0))}
            </div>
          </Card>

          {/* Monthly breakdown */}
          <Card title="Monthly Breakdown" style={{ marginBottom: 12 }}>
            {monthlyRows.length === 0 ? (
              <Empty>No data for selected filters.</Empty>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e8e8e8' }}>
                      <Th left>Month</Th>
                      <Th>Revenue</Th>
                      <Th>Appts</Th>
                      <Th>Avg Ticket</Th>
                      {showMethodCols && <><Th color="#3D7A3D">Cash</Th><Th color="#3D95CE">Card</Th><Th color="#7C3AED">Venmo</Th><Th color="#059669">Zelle</Th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyRows.map(([m, d], i) => {
                      const [yr, mo] = m.split('-');
                      const label = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                      return (
                        <tr key={m} style={{ borderBottom: '1px solid #f5f5f5', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                          <td style={{ padding: '8px 4px', fontSize: 12, color: '#333', fontWeight: 500 }}>{label}</td>
                          <Td bold green>{fmt$(d.revenue)}</Td>
                          <Td>{d.count}</Td>
                          <Td>{d.count ? fmt$(d.revenue / d.count) : '—'}</Td>
                          {showMethodCols && (
                            <>
                              <Td muted={d.cash === 0}>{d.cash > 0 ? fmt$(d.cash) : '—'}</Td>
                              <Td muted={d.card === 0}>{d.card > 0 ? fmt$(d.card) : '—'}</Td>
                              <Td muted={d.venmo === 0}>{d.venmo > 0 ? fmt$(d.venmo) : '—'}</Td>
                              <Td muted={d.zelle === 0}>{d.zelle > 0 ? fmt$(d.zelle) : '—'}</Td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: '2px solid #e8e8e8', fontWeight: 700 }}>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: '#555' }}>TOTAL</td>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: '#2D7A5F', textAlign: 'right', fontWeight: 700 }}>{fmt$(totalRev)}</td>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: '#333', textAlign: 'right' }}>{totalCount}</td>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: '#888', textAlign: 'right' }}>{totalCount ? fmt$(totalRev / totalCount) : '—'}</td>
                      {showMethodCols && (
                        <>
                          <Td bold>{fmt$(monthlyRows.reduce((s,[,d]) => s + d.cash,  0))}</Td>
                          <Td bold>{fmt$(monthlyRows.reduce((s,[,d]) => s + d.card,  0))}</Td>
                          <Td bold>{fmt$(monthlyRows.reduce((s,[,d]) => s + d.venmo, 0))}</Td>
                          <Td bold>{fmt$(monthlyRows.reduce((s,[,d]) => s + d.zelle, 0))}</Td>
                        </>
                      )}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* 1099 summary */}
          <Card title="1099-NEC Contractor Summary">
            {tech1099.length === 0 ? (
              <Empty>No data for selected filters.</Empty>
            ) : (
              <>
                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 12 }}>
                  Contractors paid ≥ $600 in {year} must receive a 1099-NEC. Thresholds based on service revenue attributed to each tech.
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e8e8e8' }}>
                      <Th left>Contractor</Th>
                      <Th>Revenue</Th>
                      <Th>Appts</Th>
                      <Th>Avg Ticket</Th>
                      <Th>1099-NEC</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {tech1099.map(([name, d], i) => {
                      const needs1099 = d.revenue >= 600;
                      return (
                        <tr key={name} style={{ borderBottom: '1px solid #f5f5f5', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                          <td style={{ padding: '8px 4px', fontSize: 12, color: '#333', fontWeight: 500 }}>{name}</td>
                          <Td bold green>{fmt$(d.revenue)}</Td>
                          <Td>{d.count}</Td>
                          <Td>{d.count ? fmt$(d.revenue / d.count) : '—'}</Td>
                          <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 12, background: needs1099 ? '#fef2f2' : '#f0fdf4', color: needs1099 ? '#ef4444' : '#22c55e' }}>
                              {needs1099 ? 'Required' : 'Not required'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: '2px solid #e8e8e8' }}>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: '#555', fontWeight: 700 }}>TOTAL</td>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: '#2D7A5F', textAlign: 'right', fontWeight: 700 }}>
                        {fmt$(tech1099.reduce((s, [, d]) => s + d.revenue, 0))}
                      </td>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: '#333', textAlign: 'right', fontWeight: 700 }}>
                        {tech1099.reduce((s, [, d]) => s + d.count, 0)}
                      </td>
                      <td colSpan={2} style={{ padding: '8px 4px', fontSize: 11, color: '#aaa', textAlign: 'right' }}>
                        {tech1099.filter(([, d]) => d.revenue >= 600).length} of {tech1099.length} techs require 1099
                      </td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

const filterSelectStyle = {
  fontFamily: 'inherit', fontSize: 12, padding: '6px 10px', borderRadius: 8,
  border: '1px solid #d8d8d8', background: '#fff', color: '#444', cursor: 'pointer',
};

function Th({ children, left, color }) {
  return (
    <th style={{ padding: '6px 4px', textAlign: left ? 'left' : 'right', fontSize: 11, fontWeight: 600, color: color || '#aaa', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}

function Td({ children, bold, green, muted }) {
  return (
    <td style={{ padding: '8px 4px', textAlign: 'right', fontSize: 12, fontWeight: bold ? 700 : 400, color: green ? '#2D7A5F' : muted ? '#ccc' : '#333' }}>
      {children}
    </td>
  );
}

// ── shared primitives ──────────────────────────────────
function Card({ title, children, style }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', padding: '16px 20px', ...style }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

function KPICard({ label, value, sub, accent, current, prev }) {
  let delta = null;
  if (current !== undefined && prev !== undefined && prev !== null) {
    if (prev > 0) {
      const pct = (current - prev) / prev * 100;
      delta = { pct: Math.round(Math.abs(pct)), up: pct >= 0 };
    } else if (current > 0) {
      delta = { pct: 100, up: true };
    }
  }
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', padding: '16px 20px' }}>
      <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: accent || '#1a1a1a', lineHeight: 1 }}>{value}</div>
        {delta && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: delta.up ? '#f0fdf4' : '#fef2f2', color: delta.up ? '#16a34a' : '#ef4444', flexShrink: 0 }}>
            {delta.up ? '↑' : '↓'} {delta.pct}%
          </span>
        )}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function PillBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 16px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12,
      fontWeight: active ? 600 : 400,
      background: active ? '#1a1a1a' : '#fff',
      color: active ? '#fff' : '#555',
      border: `1px solid ${active ? '#1a1a1a' : '#d8d8d8'}`,
      cursor: 'pointer',
    }}>
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <div style={{ fontSize: 13, color: '#bbb', padding: '8px 0' }}>{children}</div>;
}

// ── Export menu ────────────────────────────────────────
function dlCSV(filename, rows) {
  const csv  = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel UTF-8
  const url  = URL.createObjectURL(blob);
  const el   = document.createElement('a');
  el.href = url; el.download = filename;
  el.click(); URL.revokeObjectURL(url);
}

function ExportMenu({ appts, metrics, startDate, endDate }) {
  const [open, setOpen] = useState(false);
  const disabled = !appts?.length || !metrics;

  function exportRaw() {
    const today = todayStr();
    dlCSV(`meraki-appointments-${startDate}-to-${endDate}.csv`, [
      ['Date', 'Client', 'Tech', 'Services', 'Revenue ($)', 'Status', 'Type'],
      ...appts
        .filter(a => a.status !== 'cancelled' && a.date <= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(a => [
          a.date,
          a.clientName || 'Walk-in',
          a.techName || '',
          (a.services || []).map(s => s.name).join(' + '),
          apptRevenue(a).toFixed(2),
          a.status,
          a.clientId ? 'Scheduled' : 'Walk-in',
        ]),
    ]);
    setOpen(false);
  }

  function exportMonthly() {
    const today = todayStr();
    const months = {};
    appts.filter(a => a.status !== 'cancelled' && a.date <= today).forEach(a => {
      const m = a.date.slice(0, 7);
      if (!months[m]) months[m] = { revenue: 0, count: 0 };
      months[m].revenue += apptRevenue(a);
      months[m].count++;
    });
    const sorted = Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]));
    let runningTotal = 0;
    const dataRows = sorted.map(([month, d]) => {
      const [yr, mo] = month.split('-');
      const label = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      runningTotal += d.revenue;
      return [label, d.revenue.toFixed(2), d.count, d.count ? (d.revenue / d.count).toFixed(2) : '0.00', runningTotal.toFixed(2)];
    });
    dlCSV(`meraki-monthly-revenue-${startDate}-to-${endDate}.csv`, [
      ['Month', 'Revenue ($)', 'Appointments', 'Avg Ticket ($)', 'Running Total ($)'],
      ...dataRows,
      ['TOTAL', sorted.reduce((s, [, d]) => s + d.revenue, 0).toFixed(2), sorted.reduce((s, [, d]) => s + d.count, 0), '', ''],
    ]);
    setOpen(false);
  }

  function exportTechSummary() {
    const sorted = Object.entries(metrics.byTech).sort((a, b) => b[1].revenue - a[1].revenue);
    const grandTotal = sorted.reduce((s, [, d]) => s + d.revenue, 0);
    dlCSV(`meraki-tech-summary-${startDate}-to-${endDate}.csv`, [
      ['Tech Name', 'Revenue ($)', 'Appointments', 'Avg Ticket ($)', 'Unique Clients', '% of Revenue'],
      ...sorted.map(([name, d]) => [
        name,
        d.revenue.toFixed(2),
        d.count,
        d.count ? (d.revenue / d.count).toFixed(2) : '0.00',
        d.clientCount,
        grandTotal ? (d.revenue / grandTotal * 100).toFixed(1) + '%' : '0.0%',
      ]),
      ['TOTAL', grandTotal.toFixed(2), sorted.reduce((s, [, d]) => s + d.count, 0), '', '', '100.0%'],
    ]);
    setOpen(false);
  }

  function export1099() {
    const sorted = Object.entries(metrics.byTech).sort((a, b) => b[1].revenue - a[1].revenue);
    dlCSV(`meraki-1099-${new Date(startDate + 'T12:00:00').getFullYear()}.csv`, [
      ['Contractor Name', 'Total Compensation ($)', 'Appointments', '1099 Required (>$600)', 'Notes'],
      ...sorted.map(([name, d]) => [
        name,
        d.revenue.toFixed(2),
        d.count,
        d.revenue >= 600 ? 'YES' : 'No',
        d.revenue >= 600 ? 'File 1099-NEC' : '',
      ]),
      ['', '', '', '', ''],
      ['Report period', `${startDate} to ${endDate}`, '', '', 'Generated ' + todayStr()],
    ]);
    setOpen(false);
  }

  const OPTS = [
    { label: 'All appointments',   sub: 'raw row-per-appointment',       fn: exportRaw },
    { label: 'Monthly revenue',    sub: 'grouped by calendar month',     fn: exportMonthly },
    { label: 'Per-tech summary',   sub: 'revenue + avg ticket per tech', fn: exportTechSummary },
    { label: '1099 report',        sub: 'contractors ≥ $600',            fn: export1099 },
  ];

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', border: '1px solid #d8d8d8', background: '#fff', cursor: disabled ? 'default' : 'pointer', color: disabled ? '#ccc' : '#555', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}
      >
        ↓ Export <span style={{ fontSize: 10, opacity: .7 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,.1)', zIndex: 100, minWidth: 230, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px 6px', fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.07em', borderBottom: '1px solid #f0f0f0' }}>
              Download as CSV
            </div>
            {OPTS.map(opt => (
              <button key={opt.label} onClick={opt.fn}
                style={{ display: 'block', width: '100%', padding: '10px 16px', background: 'none', border: 'none', borderBottom: '1px solid #f5f5f5', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8f9fa'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ fontSize: 13, color: '#222', fontWeight: 500 }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{opt.sub}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

