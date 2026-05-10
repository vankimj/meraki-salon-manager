import { useState, useEffect, useMemo } from 'react';
import { fetchAppointmentsByRange, fetchClients, fetchReceiptsByRange, fetchEmployees, fetchClientVisits, fetchHistoricalClientIds } from '../../lib/firestore';
import { useApp } from '../../context/AppContext';
import { generate1099NecPdf } from '../../lib/pdf1099';
import { todayStr, apptRevenue, apptToSyntheticReceipt, buildTransactions, computeMetrics, computeCancellations } from './metrics';
import CoachMark from '../../components/CoachMark';
import { TENANT_ID } from '../../lib/tenant';


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

// Match RevenueChart's aggregation threshold (>45 days → weekly bars).
function revenueChartTitle(startDate, endDate) {
  if (!startDate || !endDate) return 'Revenue';
  const days = Math.max(
    1,
    Math.round((new Date(endDate + 'T12:00:00') - new Date(startDate + 'T12:00:00')) / 86400000) + 1,
  );
  return days > 45 ? 'Weekly Revenue' : 'Daily Revenue';
}


// ── Filters ────────────────────────────────────────────
const EMPTY_FILTERS = Object.freeze({
  techs:      [],          // multi: tech names from techSplit or techName
  services:   [],          // multi: service names
  methods:    [],          // multi: 'card' | 'cash' | 'venmo' | 'other'
  sources:    [],          // multi: 'in-salon' | 'online_booking' | 'imported' | 'rebook_prompt'
  clientType: 'all',       // 'all' | 'scheduled' | 'walkin'
});

const METHOD_OPTIONS = [
  { id: 'card',  label: 'Credit card' },
  { id: 'cash',  label: 'Cash' },
  { id: 'venmo', label: 'Venmo' },
  { id: 'other', label: 'Other' },
];

const SOURCE_OPTIONS = [
  { id: 'in-salon',       label: 'In-salon' },
  { id: 'online_booking', label: 'Online booking' },
  { id: 'rebook_prompt',  label: 'Rebook prompt' },
  { id: 'imported',       label: 'Imported (GG)' },
];

const CLIENT_TYPE_OPTIONS = [
  { id: 'all',       label: 'All clients' },
  { id: 'scheduled', label: 'Scheduled (with record)' },
  { id: 'walkin',    label: 'Walk-ins' },
];

function txTechs(t) {
  if (t.payment?.techSplit?.length) return t.payment.techSplit.map(s => s.techName).filter(Boolean);
  return [t.techName].filter(Boolean);
}
function txSourceKey(t) {
  if (t._importedFrom === 'glossgenius') return 'imported';
  return t.source || 'in-salon';
}

function buildFilterOptions(appts) {
  if (!appts) return { techs: [], services: [] };
  const techs = new Set(), services = new Set();
  appts.forEach(t => {
    txTechs(t).forEach(n => techs.add(n));
    (t.services || []).forEach(s => { if (s.name) services.add(s.name); });
  });
  return {
    techs:    Array.from(techs).sort(),
    services: Array.from(services).sort(),
  };
}

function countActiveFilters(f) {
  let n = 0;
  if (f.techs.length)    n++;
  if (f.services.length) n++;
  if (f.methods.length)  n++;
  if (f.sources.length)  n++;
  if (f.clientType !== 'all') n++;
  return n;
}

function filterTransactions(appts, f) {
  if (!appts) return null;
  if (countActiveFilters(f) === 0) return appts;
  return appts.filter(t => {
    if (f.techs.length) {
      const techs = txTechs(t);
      if (!techs.some(n => f.techs.includes(n))) return false;
    }
    if (f.services.length) {
      const names = (t.services || []).map(s => s.name);
      if (!names.some(n => f.services.includes(n))) return false;
    }
    if (f.methods.length) {
      const m = t.payment?.method || 'other';
      if (!f.methods.includes(m)) return false;
    }
    if (f.sources.length) {
      if (!f.sources.includes(txSourceKey(t))) return false;
    }
    if (f.clientType === 'scheduled' && !t.clientId) return false;
    if (f.clientType === 'walkin'    &&  t.clientId) return false;
    return true;
  });
}

// ── main component ─────────────────────────────────────
const PERIODS = [
  { label: '7D',       days: 7   },
  { label: '30D',      days: 30  },
  { label: '90D',      days: 90  },
  { label: 'All time', days: 3650 }, // ~10 years — covers any imported salon history
];

const TABS = [
  { id: 'overview',     label: 'Overview' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'tax',          label: 'IRS / Tax Report' },
  { id: 'ask',          label: 'Ask AI' },
];

export default function ReportsAdmin() {
  const { isTech, isScheduler } = useApp();
  const [activeTab,  setActiveTab]  = useState('overview');
  const [periodDays,  setPeriodDays]  = useState(30); // number | 'custom'
  const [customStart, setCustomStart] = useState(startOf(30));
  const [customEnd,   setCustomEnd]   = useState(todayStr());
  const [appts,       setAppts]       = useState(null);
  const [rawAppts,    setRawAppts]    = useState(null); // for cancellation stats
  const [priorAppts,  setPriorAppts]  = useState(null);
  const [priorClientIds, setPriorClientIds] = useState(null);
  const [loading,     setLoading]     = useState(true);
  // Overview filters (all multi-select except clientType).
  const [filters,     setFilters]     = useState(EMPTY_FILTERS);

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
  const isAllTime = periodDays === 3650;
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
    setPriorClientIds(null);
    try {
      // priorAppts is the matching same-length prior window for KPI comparison.
      // priorClientIds is the lifetime set of clientIds with any visit before
      // startDate — used to classify "new" (first-ever visit) vs "returning".
      const [curRs, curAs, priorRs, priorAs, historicalIds] = await Promise.all([
        fetchReceiptsByRange(startDate, endDate).catch(() => []),
        fetchAppointmentsByRange(startDate, endDate),
        showComparison ? fetchReceiptsByRange(priorStart, priorEnd).catch(() => []) : Promise.resolve([]),
        showComparison ? fetchAppointmentsByRange(priorStart, priorEnd) : Promise.resolve([]),
        fetchHistoricalClientIds(startDate).catch(() => new Set()),
      ]);
      setAppts(buildTransactions(curRs, curAs));
      setRawAppts(curAs);
      setPriorAppts(buildTransactions(priorRs, priorAs));
      setPriorClientIds(historicalIds);
    } catch (e) { console.error('[Reports] load failed:', e); setAppts([]); setRawAppts([]); setPriorAppts([]); setPriorClientIds(new Set()); }
    finally  { setLoading(false); }
  }

  // Build filter option lists from the loaded transactions.
  const filterOptions = useMemo(() => buildFilterOptions(appts), [appts]);
  // Apply current filters to current and prior periods so KPIs, leaderboard,
  // and comparison numbers all stay consistent with what the user picked.
  const filteredAppts      = useMemo(() => filterTransactions(appts,      filters), [appts, filters]);
  const filteredPriorAppts = useMemo(() => filterTransactions(priorAppts, filters), [priorAppts, filters]);
  const activeFilterCount  = useMemo(() => countActiveFilters(filters), [filters]);

  const metrics      = useMemo(() => filteredAppts      ? computeMetrics(filteredAppts)      : null, [filteredAppts]);
  const priorMetrics = useMemo(() => filteredPriorAppts ? computeMetrics(filteredPriorAppts) : null, [filteredPriorAppts]);

  // Cancellations are computed from raw appointments (which include status
  // 'cancelled' and 'no_show'); buildTransactions only carries 'done'.
  // Apply tech/service/clientType filters to the raw list — payment-method
  // and source filters intentionally don't affect cancellations because
  // cancelled appointments don't have a payment method or completion source.
  const cancellationFilters = useMemo(() => ({
    techs: filters.techs, services: filters.services,
    methods: [], sources: [], clientType: filters.clientType,
  }), [filters]);
  const filteredRawAppts = useMemo(
    () => filterTransactions(rawAppts, cancellationFilters),
    [rawAppts, cancellationFilters],
  );
  // Filtered receipts feed the cancellation card too — receipts with
  // transactionType='cancellation'/'refund'/'void' (set at GG import time)
  // surface alongside cancelled appointments.
  const cancellations = useMemo(
    () => filteredRawAppts ? computeCancellations(filteredRawAppts, filteredAppts) : null,
    [filteredRawAppts, filteredAppts],
  );

  // For "All time", the fetch uses a wide 10-year window so we don't miss
  // anything, but the chart axis + export filename should reflect the
  // actual span of data — i.e. the oldest transaction's date.
  const dataMinDate = useMemo(() => {
    if (!filteredAppts?.length) return null;
    let min = null;
    filteredAppts.forEach(a => {
      if (a.date && (!min || a.date < min)) min = a.date;
    });
    return min;
  }, [filteredAppts]);
  const displayStartDate = isAllTime && dataMinDate ? dataMinDate : startDate;

  const clientRetention = useMemo(() => {
    if (!metrics || !filteredAppts || !priorClientIds) return null;
    const today = todayStr();
    const done  = filteredAppts.filter(a => a.status !== 'cancelled' && a.date <= today);
    let newCount = 0, returningCount = 0, walkInCount = 0;
    const seen = {};
    done.forEach(a => {
      if (!a.clientId) { walkInCount++; return; }
      if (!seen[a.clientId]) {
        seen[a.clientId] = true;
        // "New" = first ever visit is in this period; "Returning" = had any
        // visit (appt or receipt) before this period, anywhere in history.
        priorClientIds.has(a.clientId) ? returningCount++ : newCount++;
      }
    });
    return { newCount, returningCount, walkInCount, total: newCount + returningCount + walkInCount };
  }, [metrics, filteredAppts, priorClientIds]);

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

      {activeTab === 'ask' ? (
        <AskAI />
      ) : activeTab === 'tax' ? (
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
            <ExportMenu appts={filteredAppts} metrics={metrics} startDate={displayStartDate} endDate={endDate} filtersActive={activeFilterCount > 0} />
          </div>

          {/* Filters */}
          <FiltersPanel
            filters={filters}
            setFilters={setFilters}
            options={filterOptions}
            activeCount={activeFilterCount}
            totalCount={appts?.length || 0}
            shownCount={filteredAppts?.length || 0}
          />

          {loading ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>Loading…</div>
          ) : !metrics?.totalAppts ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>
              {activeFilterCount > 0 ? 'No transactions match the current filters.' : 'No completed appointments in this period.'}
            </div>
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

              <Card title="Payment Methods" style={{ marginBottom: 12 }}>
                <PaymentMethodsBreakdown metrics={metrics} />
              </Card>

              <Card title="Processing Fees" style={{ marginBottom: 12 }}>
                <ProcessingFeesBreakdown metrics={metrics} />
              </Card>

              <Card title="Gratuity Collected" style={{ marginBottom: 12 }}>
                <GratuityBreakdown metrics={metrics} />
              </Card>

              {cancellations && (
                <Card title="Cancellation Analysis" style={{ marginBottom: 12 }}>
                  <CancellationsBreakdown stats={cancellations} />
                </Card>
              )}

              {clientRetention && (
                <Card title="New vs Returning Clients" style={{ marginBottom: 12 }}>
                  <NewVsReturning retention={clientRetention} />
                </Card>
              )}

              <Card title={revenueChartTitle(displayStartDate, endDate)} style={{ marginBottom: 12 }}>
                <RevenueChart byDay={metrics.byDay} startDate={displayStartDate} endDate={endDate} />
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

      <CoachMark
        id="reports_intro"
        icon="📊"
        title="Try the AI assistant"
        body='Click "Ask AI" up top and ask plain-English questions like "how many first-time visitors did I get last month?" or "who were my top 5 clients in March by spend?" Beats clicking through filters.'
      />
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

// ── Payment methods breakdown ──────────────────────────
function PaymentMethodsBreakdown({ metrics }) {
  const [expanded, setExpanded] = useState(null); // method id when open
  const { byMethod, methodTotal } = metrics;
  if (!methodTotal) return <Empty>No payment data</Empty>;
  const pct = (n) => methodTotal ? Math.round(n / methodTotal * 100) : 0;

  const rows = [
    { id: 'card',  label: 'Credit card', color: '#3B82F6' },
    { id: 'cash',  label: 'Cash',        color: '#10B981' },
    { id: 'other', label: 'Other (Venmo / Zelle / GC)', color: '#A78BFA' },
  ].map(r => {
    const d = byMethod[r.id] || {};
    return {
      ...r,
      total:  d.total  || 0,
      count:  d.count  || 0,
      svcRev: d.svcRev || 0,
      retail: d.retail || 0,
      tax:    d.tax    || 0,
      tip:    d.tip    || 0,
      pct:    pct(d.total || 0),
    };
  });

  return (
    <div>
      <div style={{ height: 10, borderRadius: 6, overflow: 'hidden', display: 'flex', marginBottom: 16 }}>
        {rows.map(r => (
          <div key={r.id} style={{ width: `${r.pct}%`, background: r.color, transition: 'width .4s' }} />
        ))}
      </div>
      {rows.map(r => {
        const isOpen = expanded === r.id;
        return (
          <div key={r.id} style={{ marginBottom: 4 }}>
            <button onClick={() => setExpanded(isOpen ? null : r.id)}
              style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
              <span style={{ display: 'inline-block', width: 10, color: '#bbb', fontSize: 9, transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s', marginRight: 4 }}>▶</span>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: r.color, flexShrink: 0, marginRight: 8 }} />
              <span style={{ fontSize: 13, color: '#333', flex: 1 }}>{r.label}</span>
              <span style={{ fontSize: 11, color: '#aaa', marginRight: 16, minWidth: 60, textAlign: 'right' }}>{r.count.toLocaleString()} txn{r.count !== 1 ? 's' : ''}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginRight: 12, minWidth: 80, textAlign: 'right' }}>{fmt$(r.total)}</span>
              <span style={{ fontSize: 11, color: '#bbb', width: 36, textAlign: 'right' }}>{r.pct}%</span>
            </button>
            {isOpen && (
              <div style={{ background: '#fafafa', border: '1px solid #ececec', borderRadius: 8, padding: '8px 12px', margin: '4px 0 8px 22px', fontSize: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>What makes up this total</div>
                {[
                  { label: 'Service revenue', val: r.svcRev },
                  { label: 'Retail revenue', val: r.retail },
                  { label: 'Sales tax',      val: r.tax    },
                  { label: 'Tip',            val: r.tip    },
                ].map(c => (
                  <div key={c.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: '#666' }}>{c.label}</span>
                    <span style={{ fontWeight: 500, color: '#333' }}>{fmt$(c.val)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0', marginTop: 6, borderTop: '1px solid #e8e8e8' }}>
                  <span style={{ fontWeight: 600, color: '#333' }}>Sum of components</span>
                  <span style={{ fontWeight: 600, color: '#333' }}>{fmt$(r.svcRev + r.retail + r.tax + r.tip)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0 0' }}>
                  <span style={{ fontWeight: 600, color: '#333' }}>payment.total reported</span>
                  <span style={{ fontWeight: 600, color: '#333' }}>{fmt$(r.total)}</span>
                </div>
                {Math.abs(r.svcRev + r.retail + r.tax + r.tip - r.total) > 1 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#9a3412' }}>
                    Δ {fmt$(r.total - (r.svcRev + r.retail + r.tax + r.tip))} — usually a discount/promo/gift-card adjustment baked into <code>payment.total</code> but not into the line items.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ marginTop: 6, paddingTop: 8, borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#888', flex: 1 }}>Total collected</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{fmt$(methodTotal)}</span>
      </div>
      <div style={{ fontSize: 10, color: '#bbb', marginTop: 6, lineHeight: 1.5 }}>
        Sums <code>payment.total</code> per transaction (includes tax + tip on top of service revenue). Click a row to see the breakdown.
      </div>
    </div>
  );
}

// ── Processing fees ────────────────────────────────────
function ProcessingFeesBreakdown({ metrics }) {
  const { ccFeeTotal, cardTxnCount, cardRevenue } = metrics;
  if (cardTxnCount === 0) {
    return <Empty>No card transactions in this period</Empty>;
  }
  const avgFee = cardTxnCount ? ccFeeTotal / cardTxnCount : 0;
  const effectiveRate = cardRevenue > 0 ? ccFeeTotal / cardRevenue : 0;
  const netCardRevenue = cardRevenue - ccFeeTotal;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
        <KpiTile label="Total fees paid" big={fmt$(ccFeeTotal)} sub={`${cardTxnCount.toLocaleString()} card txn${cardTxnCount !== 1 ? 's' : ''}`} color="#EF4444" />
        <KpiTile label="Avg fee per txn" big={fmt$(avgFee)} sub={`${(effectiveRate * 100).toFixed(2)}% effective`} color="#F59E0B" />
        <KpiTile label="Net card revenue" big={fmt$(netCardRevenue)} sub={`${fmt$(cardRevenue)} gross`} color="#2D7A5F" />
      </div>
      <div style={{ fontSize: 10, color: '#bbb', lineHeight: 1.5 }}>
        Fees are summed from <code>payment.ccFee</code> on each card transaction (Stripe-style: percentage + flat per swipe). Refunds subtract.
      </div>
    </div>
  );
}

// ── Gratuity ───────────────────────────────────────────
function GratuityBreakdown({ metrics }) {
  const { tipTotal, tipTxnCount, tipsByMethod, tipsByTech, totalRevenue } = metrics;
  if (!tipTxnCount && tipTotal === 0) {
    return <Empty>No tips recorded in this period</Empty>;
  }
  const avgTip = tipTxnCount ? tipTotal / tipTxnCount : 0;
  const tipRate = totalRevenue > 0 ? tipTotal / totalRevenue : 0;

  const sumByMethod = (tipsByMethod.card || 0) + (tipsByMethod.cash || 0) + (tipsByMethod.other || 0);
  const methodPct = (n) => sumByMethod > 0 ? Math.round(n / sumByMethod * 100) : 0;

  const methodRows = [
    { id: 'card',  label: 'Card',  color: '#3B82F6', amt: tipsByMethod.card  || 0 },
    { id: 'cash',  label: 'Cash',  color: '#10B981', amt: tipsByMethod.cash  || 0 },
    { id: 'other', label: 'Other', color: '#A78BFA', amt: tipsByMethod.other || 0 },
  ].filter(r => r.amt !== 0);

  const topTechs = Object.entries(tipsByTech || {})
    .filter(([n, amt]) => n && amt > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
        <KpiTile label="Total tips"      big={fmt$(tipTotal)} sub={`${tipTxnCount.toLocaleString()} tipped txn${tipTxnCount !== 1 ? 's' : ''}`} color="#16a34a" />
        <KpiTile label="Avg tip"         big={fmt$(avgTip)}   sub="per tipped transaction" color="#0ea5e9" />
        <KpiTile label="Tip rate"        big={`${(tipRate * 100).toFixed(1)}%`} sub="vs service revenue" color="#9333EA" />
      </div>

      {methodRows.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>By payment method</div>
          {methodRows.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0, marginRight: 8 }} />
              <span style={{ fontSize: 13, color: '#333', flex: 1 }}>{r.label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginRight: 12, minWidth: 80, textAlign: 'right' }}>{fmt$(r.amt)}</span>
              <span style={{ fontSize: 11, color: '#bbb', width: 36, textAlign: 'right' }}>{methodPct(r.amt)}%</span>
            </div>
          ))}
        </>
      )}

      {topTechs.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Top earners</div>
          {topTechs.map(([name, amt]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: '#333', flex: 1 }}>{name}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>{fmt$(amt)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 10, color: '#bbb', marginTop: 10, lineHeight: 1.5 }}>
        Tips come from <code>payment.tip</code> at checkout. Multi-tech bookings split via <code>tipShare</code>. Refunds subtract.
      </div>
    </div>
  );
}

// ── KPI tile (shared) ─────────────────────────────────
function KpiTile({ label, big, sub, color }) {
  return (
    <div style={{ background: '#fafafa', border: '1px solid #ececec', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || '#1a1a1a', lineHeight: 1.1 }}>{big}</div>
      {sub && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Cancellations & no-shows ───────────────────────────
// Walk-ins-style breakdown: stacked bar + rows with count and %, plus a
// compact "Most affected techs" footer and an empty-state info panel when
// no statuses were found.
function CancellationsBreakdown({ stats }) {
  const { cancelCount, noShowCount, completedCount, scheduledCount, lostRevenue, byTech, statusCounts, totalInPeriod,
    ggCancellationCount, ggRefundCount, ggVoidCount, lostGgCxl, lostRefund, lostVoid } = stats;
  const total = totalInPeriod;
  const pct = (n) => total ? Math.round(n / total * 100) : 0;
  const ggBlocked = ggCancellationCount + ggRefundCount + ggVoidCount;

  // Empty-state copy: surfaces the raw status mix so the user can see why
  // there are no cancellations (usually because the Appointments CSV wasn't
  // imported, or the source uses an unrecognized status).
  const noCancelData = cancelCount === 0 && noShowCount === 0;
  const statusEntries = Object.entries(statusCounts || {})
    .sort((a, b) => b[1] - a[1]);

  // Special case: no appointments at all in the loaded period. Show a
  // clear message instead of a bar of all zeros.
  if (total === 0 && ggBlocked === 0) {
    return (
      <div style={{ padding: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#78350f', lineHeight: 1.6 }}>
        <strong>No appointments loaded for this period.</strong>
        <div style={{ marginTop: 6 }}>
          Cancellations live in the <strong>appointments</strong> collection (GG sales imports populate <strong>receipts</strong> only). To see cancellation history:
          <ol style={{ margin: '6px 0 0 18px', padding: 0, lineHeight: 1.7 }}>
            <li>Export the GG <strong>Appointments</strong> CSV (Insights → Reports → Appointments).</li>
            <li>Upload it via Admin → Settings → 📦 Data Imports → 📥 Import from GlossGenius.</li>
            <li>Refresh this page — the analysis will populate.</li>
          </ol>
        </div>
      </div>
    );
  }

  const rows = [
    { label: 'Completed',          count: completedCount, color: '#2D7A5F', pct: pct(completedCount) },
    { label: 'Scheduled (future)', count: scheduledCount, color: '#3B82F6', pct: pct(scheduledCount) },
    { label: 'Cancelled',          count: cancelCount,    color: '#EF4444', pct: pct(cancelCount) },
    { label: 'No-show',            count: noShowCount,    color: '#F59E0B', pct: pct(noShowCount) },
  ];

  const topByTech = Object.entries(byTech)
    .sort((a, b) => (b[1].cancelled + b[1].noShow) - (a[1].cancelled + a[1].noShow))
    .slice(0, 5);

  return (
    <div>
      {/* Stacked bar mirroring WalkInVsScheduled */}
      <div style={{ height: 10, borderRadius: 6, overflow: 'hidden', display: 'flex', marginBottom: 16 }}>
        {rows.map(r => (
          <div key={r.label} style={{ width: `${r.pct}%`, background: r.color, transition: 'width .4s' }} />
        ))}
      </div>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: r.color, flexShrink: 0, marginRight: 8 }} />
          <span style={{ fontSize: 13, color: '#333', flex: 1 }}>{r.label}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginRight: 12 }}>{r.count.toLocaleString()}</span>
          <span style={{ fontSize: 11, color: '#bbb', width: 36, textAlign: 'right' }}>{r.pct}%</span>
        </div>
      ))}

      {/* GG-import cancellation/refund/void receipts (from Payment Details
          "Transaction Type") — shown as a sub-section since they live in
          the receipts collection, not appointments. */}
      {ggBlocked > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
            From GG transactions (Payment Details · Transaction Type)
          </div>
          {[
            { label: 'Cancellations', count: ggCancellationCount, lost: lostGgCxl,  color: '#EF4444' },
            { label: 'Refunds',       count: ggRefundCount,       lost: lostRefund, color: '#F59E0B' },
            { label: 'Voids',         count: ggVoidCount,         lost: lostVoid,   color: '#9333EA' },
          ].filter(r => r.count > 0).map(r => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0, marginRight: 8 }} />
              <span style={{ fontSize: 13, color: '#333', flex: 1 }}>{r.label}</span>
              <span style={{ fontSize: 12, color: '#aaa', marginRight: 12 }}>{r.count.toLocaleString()} txn{r.count !== 1 ? 's' : ''}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: r.color }}>{fmt$(r.lost)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Lost revenue + top affected techs in a compact footer block */}
      {(cancelCount > 0 || noShowCount > 0 || ggBlocked > 0) && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: topByTech.length > 0 ? 10 : 0 }}>
            <span style={{ fontSize: 12, color: '#888', flex: 1 }}>Total lost revenue (all sources)</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#9333EA' }}>{fmt$(lostRevenue)}</span>
          </div>
          {topByTech.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
                Most affected techs
              </div>
              {topByTech.map(([name, d]) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
                  <span style={{ color: '#333', flex: 1 }}>{name}</span>
                  <span style={{ color: '#aaa', marginRight: 12 }}>{d.cancelled} cxl · {d.noShow} no-show</span>
                  <span style={{ color: '#9333EA', fontWeight: 600 }}>{fmt$(d.lostRevenue)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {noCancelData && (
        <div style={{ marginTop: 12, padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11, color: '#78350f', lineHeight: 1.6 }}>
          <strong>No cancellations or no-shows in the appointments collection.</strong>
          <div style={{ marginTop: 4 }}>
            Status mix ({totalInPeriod.toLocaleString()} appointments):{' '}
            <span style={{ color: '#9a3412' }}>
              {statusEntries.length === 0
                ? '(none)'
                : statusEntries.map(([s, n]) => `${s}: ${n.toLocaleString()}`).join(' · ')}
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#78350f' }}>
            If you expected cancellations, double-check your GG Appointments CSV included statuses like "Cancelled" or "No Show" — the importer normalizes case + spacing.
          </div>
        </div>
      )}
    </div>
  );
}

// ── New vs Returning clients ───────────────────────────
function NewVsReturning({ retention }) {
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
        "New" = first-ever visit was in this period (no prior history at the salon)
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

  // Long ranges (incl. multi-year) need the year in the label so a "May 8"
  // bar can't be read as the same May as a "May 6" right next to it.
  const longRange = dates.length > 365;
  function barLabel(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    if (aggregate) {
      return 'wk ' + d.toLocaleDateString('en-US',
        longRange ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString('en-US',
      longRange ? { month: 'short', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
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
        <span>{new Date(startDate + 'T12:00:00').toLocaleDateString('en-US',
          longRange ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' })}</span>
        <span style={{ fontWeight: 500, color: '#888' }}>{aggregate ? 'weekly' : 'daily'} · max {fmt$(barMax)}</span>
        <span>{new Date(endDate + 'T12:00:00').toLocaleDateString('en-US',
          longRange ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' })}</span>
      </div>
    </div>
  );
}

// ── Leaderboard ────────────────────────────────────────
const MEDALS = ['🥇', '🥈', '🥉'];

function Leaderboard({ byTech }) {
  const [expanded, setExpanded] = useState(null);
  // Drop the no-tech bucket — receipts with empty techName (retail, gift
  // card sales, GG imports without a Provider) shouldn't appear as a
  // ranked tech with $0 revenue. Their totals are still surfaced on the
  // Transactions tab.
  const unassigned = byTech[''] || null;
  const sorted = Object.entries(byTech)
    .filter(([name]) => name && name.trim())
    .sort((a, b) => b[1].revenue - a[1].revenue);
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
      {unassigned && unassigned.count > 0 && (
        <div style={{ marginTop: 10, padding: '8px 10px', background: '#fafafa', border: '1px solid #ececec', borderRadius: 8, fontSize: 11, color: '#888', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>+ {unassigned.count.toLocaleString()} transaction{unassigned.count !== 1 ? 's' : ''} with no tech assigned (retail, gift cards, imports without a Provider)</span>
          <span style={{ color: '#aaa' }}>{fmt$(unassigned.revenue)}</span>
        </div>
      )}
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
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null); // { id, name }
  const sorted = useMemo(
    () => Object.entries(byClient).sort((a, b) => b[1].revenue - a[1].revenue),
    [byClient],
  );
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter(([, d]) => (d.name || '').toLowerCase().includes(term));
  }, [sorted, q]);

  if (!sorted.length) return <Empty>No data</Empty>;

  // Two-column scroll: row 1 = #1 + #2, row 2 = #3 + #4, etc. Reads top→
  // bottom by rank no matter how tall the list gets. Capped container so
  // the page doesn't grow unbounded; scrolls vertically beyond ~14 rows.
  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search clients by name…"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '7px 30px 7px 32px', fontSize: 12, fontFamily: 'inherit',
            border: '1px solid #e0e0e0', borderRadius: 8, background: '#fafafa',
            color: '#333', outline: 'none',
          }}
        />
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#aaa', pointerEvents: 'none' }}>🔍</span>
        {q && (
          <button onClick={() => setQ('')} aria-label="Clear"
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#bbb', padding: '2px 6px', fontFamily: 'inherit' }}>
            ×
          </button>
        )}
      </div>

      <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 8 }}>
        {filtered.length === 0 ? (
          <Empty>No clients match "{q}"</Empty>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 32, rowGap: 0 }}>
            {filtered.map(([clientId, d]) => {
              // Preserve overall rank from `sorted` so search results still
              // show the client's standing in the full leaderboard.
              const overallRank = sorted.findIndex(([, e]) => e === d) + 1;
              return (
                <button key={clientId}
                  onClick={() => setSelected({ id: clientId, name: d.name })}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 6px', borderBottom: '1px solid #f5f5f5', minWidth: 0,
                    background: 'none', border: 'none', borderBottomColor: '#f5f5f5',
                    fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', width: '100%',
                    transition: 'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 10, color: '#bbb', fontWeight: 600, flexShrink: 0, width: 26 }}>#{overallRank}</span>
                    <span style={{ fontSize: 13, color: 'var(--tm-accent, #3D95CE)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span style={{ fontSize: 11, color: '#bbb', flexShrink: 0 }}>{d.count} visit{d.count !== 1 ? 's' : ''}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', flexShrink: 0, marginLeft: 12 }}>{fmt$(d.revenue)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ padding: '8px 0 4px', textAlign: 'center', fontSize: 10, color: '#bbb' }}>
        {q
          ? `${filtered.length} of ${sorted.length} client${sorted.length !== 1 ? 's' : ''}`
          : `${sorted.length} client${sorted.length !== 1 ? 's' : ''}`}
      </div>

      {selected && (
        <ClientVisitsModal
          clientId={selected.id}
          clientName={selected.name}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ── Client visits modal ────────────────────────────────
function ClientVisitsModal({ clientId, clientName, onClose }) {
  const [visits, setVisits] = useState(null);
  const [err,    setErr]    = useState(null);

  useEffect(() => {
    let cancel = false;
    setVisits(null); setErr(null);
    fetchClientVisits(clientId)
      .then(rows => { if (!cancel) setVisits(rows); })
      .catch(e   => { if (!cancel) setErr(e?.message || 'Failed to load visits'); });
    return () => { cancel = true; };
  }, [clientId]);

  // Esc to close
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // fetchClientVisits already sorts newest-first and pre-computes revenue.
  const totalRevenue = (visits || []).reduce((s, v) => s + (v.revenue || 0), 0);

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '94%', maxWidth: 640, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg,#2D7A5F 0%,#3D95CE 100%)', color: '#fff' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, opacity: .8, textTransform: 'uppercase', letterSpacing: '.06em' }}>Client visit history</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clientName}</div>
          </div>
          <button onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.15)', cursor: 'pointer', fontSize: 16, color: '#fff', flexShrink: 0, marginLeft: 8 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
          {err ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#ef4444', fontSize: 13 }}>Error: {err}</div>
          ) : visits == null ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#bbb', fontSize: 13 }}>Loading…</div>
          ) : visits.length === 0 ? (
            <Empty>No visits on record for this client.</Empty>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', padding: '6px 0 12px' }}>
                <span>{visits.length} visit{visits.length !== 1 ? 's' : ''}</span>
                <span>Total: <strong style={{ color: '#1a1a1a' }}>{fmt$(totalRevenue)}</strong></span>
              </div>
              {visits.map(v => {
                const services = (v.services || []).map(s => s.name).filter(Boolean).join(' + ') || '—';
                const cancelled = v.status === 'cancelled';
                return (
                  <div key={v.source + ':' + v.id} style={{ padding: '10px 0', borderBottom: '1px solid #f5f5f5', opacity: cancelled ? .55 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
                        {v.date}{v.startTime ? ` · ${v.startTime}` : ''}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#2D7A5F' }}>{fmt$(v.revenue || 0)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>{services}</div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#888' }}>
                      {v.techName && <span>👩‍💼 {v.techName}</span>}
                      <span style={{ textTransform: 'capitalize' }}>· {v.status || 'scheduled'}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
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
        <FilterRow label="Method" value={methodFilter} onChange={setMethodFilter} options={[
          { id: 'all',   label: 'All' },
          { id: 'card',  label: '💳 Card' },
          { id: 'cash',  label: '💵 Cash' },
          { id: 'other', label: 'Other' },
        ]} />
        <FilterRow label="Type" value={typeFilter} onChange={setTypeFilter} options={[
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

function FilterRow({ label, value, onChange, options }) {
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
  const { settings } = useApp();
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  const [year,      setYear]      = useState(currentYear);
  const [quarter,   setQuarter]   = useState('all');
  const [payMethod, setPayMethod] = useState('all');
  const [tech,      setTech]      = useState('all');
  const [appts,     setAppts]     = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => { loadYear(); }, [year]); // eslint-disable-line
  useEffect(() => { fetchEmployees().then(setEmployees).catch(() => setEmployees([])); }, []);

  async function downloadPdfFor(techName, revenue) {
    // Refetch employees on click so a recently-edited TIN/address shows up
    // without forcing a tab reload.
    let emp = {};
    try {
      const fresh = await fetchEmployees();
      setEmployees(fresh);
      emp = fresh.find(e => e.name === techName) || {};
    } catch {
      emp = employees.find(e => e.name === techName) || {};
    }
    const payer = {
      name:    settings?.brandName    || 'Meraki Nail Studio',
      address: settings?.brandAddress || '',
      city:    settings?.brandCity    || '',
      state:   settings?.brandState   || '',
      zip:     settings?.brandZip     || '',
      ein:     settings?.ein          || '',
      phone:   settings?.brandPhone   || '',
    };
    const recipient = {
      name:    emp.name    || techName,
      address: emp.address || '',
      city:    emp.city    || '',
      state:   emp.state   || '',
      zip:     emp.zip     || '',
      tin:     emp.tin     || '',
      email:   emp.email   || '',
      phone:   emp.phone   || '',
    };
    generate1099NecPdf({ payer, recipient, year, amount: revenue });
  }

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
                      <Th>PDF</Th>
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
                          <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                            <button onClick={() => downloadPdfFor(name, d.revenue)}
                              title={`Download 1099-NEC summary PDF for ${name}`}
                              style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: '1px solid #2D7A5F', background: '#fff', color: '#2D7A5F', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                              📄 PDF
                            </button>
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
                      <td colSpan={3} style={{ padding: '8px 4px', fontSize: 11, color: '#aaa', textAlign: 'right' }}>
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

// ── Filters panel ──────────────────────────────────────
function FiltersPanel({ filters, setFilters, options, activeCount, totalCount, shownCount }) {
  const [open, setOpen] = useState(false);

  function toggleMulti(key, value) {
    setFilters(f => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter(v => v !== value) : [...f[key], value],
    }));
  }
  function clearAll() { setFilters(EMPTY_FILTERS); }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
            border: `1.5px solid ${activeCount > 0 ? '#2D7A5F' : '#d8d8d8'}`,
            background: activeCount > 0 ? '#EDFAF3' : '#fff',
            color: activeCount > 0 ? '#166534' : '#555', cursor: 'pointer',
          }}>
          <span>⚲</span>
          <span>Filters{activeCount > 0 ? ` (${activeCount})` : ''}</span>
          <span style={{ fontSize: 10, opacity: .7 }}>{open ? '▴' : '▾'}</span>
        </button>
        {activeCount > 0 && (
          <>
            <span style={{ fontSize: 11, color: '#888' }}>
              Showing {shownCount.toLocaleString()} of {totalCount.toLocaleString()} transactions
            </span>
            <button onClick={clearAll}
              style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, fontFamily: 'inherit', fontSize: 11, background: 'none', border: '1px solid #e0e0e0', color: '#888', cursor: 'pointer' }}>
              Clear all
            </button>
          </>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 10, background: '#fafafa', border: '1px solid #ececec', borderRadius: 12, padding: 14 }}>
          <FilterSection label="Techs" empty="No techs in current data">
            {options.techs.map(name => (
              <FilterChip key={name} active={filters.techs.includes(name)} onClick={() => toggleMulti('techs', name)}>{name || '(no tech)'}</FilterChip>
            ))}
          </FilterSection>
          <FilterSection label="Services" empty="No services in current data">
            {options.services.map(name => (
              <FilterChip key={name} active={filters.services.includes(name)} onClick={() => toggleMulti('services', name)}>{name}</FilterChip>
            ))}
          </FilterSection>
          <FilterSection label="Payment method">
            {METHOD_OPTIONS.map(m => (
              <FilterChip key={m.id} active={filters.methods.includes(m.id)} onClick={() => toggleMulti('methods', m.id)}>{m.label}</FilterChip>
            ))}
          </FilterSection>
          <FilterSection label="Source">
            {SOURCE_OPTIONS.map(s => (
              <FilterChip key={s.id} active={filters.sources.includes(s.id)} onClick={() => toggleMulti('sources', s.id)}>{s.label}</FilterChip>
            ))}
          </FilterSection>
          <FilterSection label="Client type">
            {CLIENT_TYPE_OPTIONS.map(c => (
              <FilterChip key={c.id} active={filters.clientType === c.id} onClick={() => setFilters(f => ({ ...f, clientType: c.id }))} radio>
                {c.label}
              </FilterChip>
            ))}
          </FilterSection>
        </div>
      )}
    </div>
  );
}

function FilterSection({ label, children, empty }) {
  const arr = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {arr.length === 0
          ? <span style={{ fontSize: 11, color: '#bbb', fontStyle: 'italic' }}>{empty || 'No options'}</span>
          : children}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children, radio }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '5px 11px', borderRadius: 14, fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
        border: `1.5px solid ${active ? '#2D7A5F' : '#e0e0e0'}`,
        background: active ? '#EDFAF3' : '#fff',
        color: active ? '#166534' : '#555', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {!radio && active ? '✓ ' : ''}{children}
    </button>
  );
}

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

function ExportMenu({ appts, metrics, startDate, endDate, filtersActive }) {
  const [open, setOpen] = useState(false);
  const disabled = !appts?.length || !metrics;
  const fileSuffix = filtersActive ? '-filtered' : '';

  function exportCurrent() {
    // Per-transaction snapshot of exactly what's on screen, including
    // payment + tax + tip detail so the CSV is a complete record of the
    // current filtered view. Useful for ad-hoc audits and tax prep.
    const today = todayStr();
    const rows = appts
      .filter(a => a.status !== 'cancelled' && a.date && a.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(a => {
        const p = a.payment || {};
        const techs = txTechs(a).join(', ');
        const services = (a.services || []).map(s => s.name).join(' + ');
        const svcRev   = apptRevenue(a);
        const retail   = (a.retailProducts || []).reduce((s, x) => s + (Number(x.price) || 0) * (x.qty || 1), 0);
        return [
          a.date,
          a.startTime || '',
          a.clientName || 'Walk-in',
          techs,
          services,
          (a.retailProducts || []).map(x => x.name).join(', '),
          svcRev.toFixed(2),
          retail.toFixed(2),
          (Number(p.tax)  || 0).toFixed(2),
          (Number(p.tip)  || 0).toFixed(2),
          (Number(p.discountAmount) || 0).toFixed(2),
          (Number(p.ccFee) || 0).toFixed(2),
          (Number(p.total) || svcRev).toFixed(2),
          p.method || '',
          a.clientId ? 'Scheduled' : 'Walk-in',
          txSourceKey(a),
        ];
      });
    dlCSV(`meraki-report-${startDate}-to-${endDate}${fileSuffix}.csv`, [
      ['Date','Time','Client','Tech(s)','Services','Retail items','Service rev ($)','Retail rev ($)','Tax ($)','Tip ($)','Discount ($)','CC fee ($)','Total ($)','Payment','Type','Source'],
      ...rows,
    ]);
    setOpen(false);
  }

  function exportRaw() {
    const today = todayStr();
    dlCSV(`meraki-appointments-${startDate}-to-${endDate}${fileSuffix}.csv`, [
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
    dlCSV(`meraki-monthly-revenue-${startDate}-to-${endDate}${fileSuffix}.csv`, [
      ['Month', 'Revenue ($)', 'Appointments', 'Avg Ticket ($)', 'Running Total ($)'],
      ...dataRows,
      ['TOTAL', sorted.reduce((s, [, d]) => s + d.revenue, 0).toFixed(2), sorted.reduce((s, [, d]) => s + d.count, 0), '', ''],
    ]);
    setOpen(false);
  }

  function exportTechSummary() {
    const sorted = Object.entries(metrics.byTech).sort((a, b) => b[1].revenue - a[1].revenue);
    const grandTotal = sorted.reduce((s, [, d]) => s + d.revenue, 0);
    dlCSV(`meraki-tech-summary-${startDate}-to-${endDate}${fileSuffix}.csv`, [
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
    dlCSV(`meraki-1099-${new Date(startDate + 'T12:00:00').getFullYear()}${fileSuffix}.csv`, [
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
    { label: 'Current view (filtered)', sub: 'every transaction with money detail', fn: exportCurrent },
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

// ── Ask AI ────────────────────────────────────────────
// Tiny markdown renderer for assistant messages — handles the formats Claude
// actually emits (tables, bold/italic, bullet/numbered lists, headers, code).
// Kept inline so we don't pay a ~50KB react-markdown dependency.
function renderInline(text, keyPrefix = '') {
  // Process **bold**, *italic*, `code` in left-to-right order using a single
  // alternation regex so they don't fight each other.
  const parts = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0, m, idx = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) parts.push(<strong key={`${keyPrefix}b${idx++}`}>{m[1]}</strong>);
    else if (m[2] !== undefined) parts.push(<em key={`${keyPrefix}i${idx++}`}>{m[2]}</em>);
    else parts.push(
      <code key={`${keyPrefix}c${idx++}`} style={{ background: '#f3f0f8', padding: '1px 5px', borderRadius: 4, fontSize: '.92em', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
        {m[3]}
      </code>
    );
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : [text];
}

function MarkdownLite({ text }) {
  if (!text) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line separator
    if (!trimmed) { i += 1; continue; }

    // Headers
    const hMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (hMatch) {
      blocks.push({ type: 'h', level: hMatch[1].length, text: hMatch[2] });
      i += 1; continue;
    }

    // Tables: header row + separator row of dashes/pipes
    if (trimmed.includes('|') && i + 1 < lines.length && /^[\s|:\-]+$/.test(lines[i + 1].trim()) && lines[i + 1].includes('-')) {
      const splitRow = (s) => s.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const header = splitRow(trimmed);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(splitRow(lines[i].trim()));
        i += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    // Bullet list
    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Paragraph (collect consecutive non-blank, non-special lines)
    const paragraph = [trimmed];
    i += 1;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) break;
      if (/^(#{1,3}\s+|[-*]\s+|\d+\.\s+)/.test(t)) break;
      if (t.includes('|')) break;
      paragraph.push(t);
      i += 1;
    }
    blocks.push({ type: 'p', text: paragraph.join(' ') });
  }

  return (
    <div>
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        if (b.type === 'h') {
          const sz = b.level === 1 ? 17 : b.level === 2 ? 15 : 14;
          return (
            <div key={k} style={{ fontSize: sz, fontWeight: 700, color: '#1a1a1a', margin: bi === 0 ? '0 0 6px' : '12px 0 6px' }}>
              {renderInline(b.text, k)}
            </div>
          );
        }
        if (b.type === 'p') {
          return (
            <p key={k} style={{ margin: bi === 0 ? '0 0 8px' : '8px 0', color: '#222' }}>
              {renderInline(b.text, k)}
            </p>
          );
        }
        if (b.type === 'ul') {
          return (
            <ul key={k} style={{ margin: '6px 0 8px', paddingLeft: 22, color: '#222' }}>
              {b.items.map((it, ii) => <li key={ii} style={{ marginBottom: 3 }}>{renderInline(it, `${k}i${ii}`)}</li>)}
            </ul>
          );
        }
        if (b.type === 'ol') {
          return (
            <ol key={k} style={{ margin: '6px 0 8px', paddingLeft: 22, color: '#222' }}>
              {b.items.map((it, ii) => <li key={ii} style={{ marginBottom: 3 }}>{renderInline(it, `${k}i${ii}`)}</li>)}
            </ol>
          );
        }
        if (b.type === 'table') {
          return (
            <div key={k} style={{ overflowX: 'auto', margin: '10px 0' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    {b.header.map((h, hi) => (
                      <th key={hi} style={{ textAlign: 'left', padding: '8px 12px', background: '#f3eafc', color: '#5b3b8c', fontWeight: 700, borderBottom: '1px solid #d8d0e8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em' }}>
                        {renderInline(h, `${k}h${hi}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, ri) => (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#fafafa' }}>
                      {row.map((cell, ci) => (
                        <td key={ci} style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', color: '#222' }}>
                          {renderInline(cell, `${k}r${ri}c${ci}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

const SUGGESTED = [
  'How many appointments did Tess D have on Saturdays this past year?',
  'Top 10 clients by spend in the last 90 days',
  'Revenue by tech for last month',
  'Who hasn\'t visited in 60 days?',
  'How is May vs April this year?',
];

function AskAI() {
  const [messages, setMessages] = useState([]); // [{role, content}]
  const [input,    setInput]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');

  async function send(text) {
    const q = (text || input).trim();
    if (!q || busy) return;
    setError('');
    setInput('');
    const next = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setBusy(true);
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../lib/firebase');
      const fn = httpsCallable(functions, 'chatWithReports');
      const res = await fn({ tenantId: TENANT_ID, messages: next });
      const reply = res?.data?.reply || '(no answer)';
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e?.message || 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: 'linear-gradient(135deg, #f3eafc, #eaf3fc)', border: '1px solid #d8d0e8', borderRadius: 12, padding: '14px 18px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#5b3b8c', marginBottom: 4 }}>🤖 Ask anything about your data</div>
        <div style={{ fontSize: 12, color: '#7a6a9a' }}>
          Read-only. I can answer questions about appointments, revenue, clients, and techs — but I can't make changes.
        </div>
      </div>

      {messages.length === 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Try asking</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {SUGGESTED.map(s => (
              <button key={s} onClick={() => send(s)} disabled={busy}
                style={{ textAlign: 'left', fontFamily: 'inherit', fontSize: 13, color: '#444', background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10, padding: '10px 14px', cursor: busy ? 'default' : 'pointer' }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: m.role === 'user' ? '85%' : '95%',
            background: m.role === 'user' ? '#3D95CE' : '#fff',
            color: m.role === 'user' ? '#fff' : '#222',
            padding: m.role === 'user' ? '10px 14px' : '14px 18px',
            borderRadius: 14,
            border: m.role === 'user' ? 'none' : '1px solid #e8e4f0',
            boxShadow: m.role === 'user' ? 'none' : '0 1px 3px rgba(91,59,140,.06)',
            fontSize: 13.5,
            lineHeight: 1.55,
            wordBreak: 'break-word',
          }}>
            {m.role === 'user'
              ? <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
              : <MarkdownLite text={m.content} />}
          </div>
        ))}
        {busy && (
          <div style={{ alignSelf: 'flex-start', fontSize: 12, color: '#888', padding: '6px 10px' }}>
            Thinking…
          </div>
        )}
        {error && (
          <div style={{ alignSelf: 'flex-start', fontSize: 12, color: '#b91c1c', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '6px 10px' }}>
            {error}
          </div>
        )}
      </div>

      <form onSubmit={e => { e.preventDefault(); send(); }} style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask a question about your data…"
          disabled={busy}
          style={{ flex: 1, fontFamily: 'inherit', fontSize: 14, padding: '10px 14px', borderRadius: 10, border: '1px solid #d8d8d8', outline: 'none', background: '#fff', color: '#222' }}
        />
        <button type="submit" disabled={busy || !input.trim()}
          style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '10px 18px', borderRadius: 10, border: 'none', background: busy || !input.trim() ? '#cbb6e0' : '#5b3b8c', color: '#fff', cursor: busy || !input.trim() ? 'default' : 'pointer' }}>
          Ask
        </button>
        {messages.length > 0 && (
          <button type="button" onClick={() => { setMessages([]); setError(''); }} disabled={busy}
            style={{ fontFamily: 'inherit', fontSize: 13, padding: '10px 14px', borderRadius: 10, border: '1px solid #d0d0d0', background: '#fff', color: '#555', cursor: 'pointer' }}>
            Reset
          </button>
        )}
      </form>
    </div>
  );
}

