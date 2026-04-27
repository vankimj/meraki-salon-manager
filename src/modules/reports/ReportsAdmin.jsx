import { useState, useEffect, useMemo } from 'react';
import { fetchAppointmentsByRange } from '../../lib/firestore';

// ── helpers ────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }

function startOf(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
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

  const totalRevenue = done.reduce((s, a) => s + apptRevenue(a), 0);
  const totalAppts   = done.length;
  const walkIns      = done.filter(a => !a.clientId).length;
  const avgTicket    = totalAppts ? totalRevenue / totalAppts : 0;

  const byDay = {};
  done.forEach(a => { byDay[a.date] = (byDay[a.date] || 0) + apptRevenue(a); });

  const byTech = {};
  done.forEach(a => {
    if (!byTech[a.techName]) byTech[a.techName] = { revenue: 0, count: 0 };
    byTech[a.techName].revenue += apptRevenue(a);
    byTech[a.techName].count++;
  });

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

  return { totalRevenue, totalAppts, walkIns, avgTicket, byDay, byTech, byService, byClient };
}

// ── main component ─────────────────────────────────────
const PERIODS = [
  { label: '7D',       days: 7   },
  { label: '30D',      days: 30  },
  { label: '90D',      days: 90  },
  { label: 'All time', days: 730 },
];

export default function ReportsAdmin() {
  const [periodDays, setPeriodDays] = useState(30);
  const [appts,      setAppts]      = useState(null);
  const [loading,    setLoading]    = useState(true);

  const endDate   = todayStr();
  const startDate = startOf(periodDays);

  useEffect(() => { load(); }, [periodDays]); // eslint-disable-line

  async function load() {
    setLoading(true);
    setAppts(null);
    try { setAppts(await fetchAppointmentsByRange(startDate, endDate)); }
    catch (e) { console.error('[Reports] load failed:', e); setAppts([]); }
    finally  { setLoading(false); }
  }

  const metrics = useMemo(() => appts ? computeMetrics(appts) : null, [appts]);

  function exportCSV() {
    if (!appts?.length) return;
    const rows = [
      ['Date', 'Client', 'Tech', 'Services', 'Revenue ($)', 'Status'],
      ...appts.map(a => [
        a.date,
        a.clientName || 'Walk-in',
        a.techName || '',
        (a.services || []).map(s => s.name).join(' + '),
        apptRevenue(a),
        a.status,
      ]),
    ];
    const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const el   = document.createElement('a');
    el.href = url; el.download = `meraki-${startDate}-to-${endDate}.csv`;
    el.click(); URL.revokeObjectURL(url);
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', paddingBottom: 24 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {PERIODS.map(p => (
            <PillBtn key={p.days} active={periodDays === p.days} onClick={() => setPeriodDays(p.days)}>
              {p.label}
            </PillBtn>
          ))}
        </div>
        <button onClick={exportCSV} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', border: '1px solid #d8d8d8', background: '#fff', cursor: 'pointer', color: '#555', fontWeight: 500 }}>
          ↓ Export CSV
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>Loading…</div>
      ) : !metrics?.totalAppts ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#bbb', fontSize: 14 }}>No completed appointments in this period.</div>
      ) : (
        <>
          {/* KPI row — 4-col desktop, 2-col mobile via CSS class */}
          <div className="kpi-grid">
            <KPICard label="Revenue"      value={fmt$(metrics.totalRevenue)} accent="#2D7A5F" />
            <KPICard label="Appointments" value={metrics.totalAppts.toLocaleString()} />
            <KPICard label="Avg Ticket"   value={fmt$(metrics.avgTicket)} />
            <KPICard label="Walk-ins"
              value={`${metrics.walkIns}`}
              sub={`${metrics.totalAppts ? Math.round(metrics.walkIns / metrics.totalAppts * 100) : 0}% of total`}
            />
          </div>

          {/* Revenue trend */}
          <Card title="Daily Revenue" style={{ marginBottom: 12 }}>
            <RevenueChart byDay={metrics.byDay} startDate={startDate} endDate={endDate} />
          </Card>

          {/* Tech + Services — stacks to 1-col on narrow mobile */}
          <div className="two-col-grid">
            <Card title="Revenue by Tech">
              <TechBars byTech={metrics.byTech} />
            </Card>
            <Card title="Top Services">
              <ServiceTable byService={metrics.byService} />
            </Card>
          </div>

          {/* Top clients */}
          <Card title="Top Clients">
            <TopClients byClient={metrics.byClient} />
          </Card>
        </>
      )}
    </div>
  );
}

// ── Revenue chart ──────────────────────────────────────
function RevenueChart({ byDay, startDate, endDate }) {
  const dates  = allDatesInRange(startDate, endDate);
  const values = dates.map(d => byDay[d] || 0);
  const maxVal = Math.max(...values, 1);
  const H = 130;

  // For 90+ days aggregate into weeks so bars are readable
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

  return (
    <div>
      <svg viewBox={`0 0 600 ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
        {/* Gridlines */}
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1="0" y1={H - f * H} x2="600" y2={H - f * H}
            stroke="#f0f0f0" strokeWidth="1" />
        ))}
        {/* Bars */}
        {bars.map((b, i) => {
          const slotW = 600 / bars.length;
          const barW  = Math.max(slotW * 0.72, 2);
          const barH  = (b.value / barMax) * (H - 4);
          const x     = i * slotW + (slotW - barW) / 2;
          return (
            <g key={i}>
              <rect x={x} y={H - barH} width={barW} height={Math.max(barH, 1)}
                fill={b.value > 0 ? '#3D95CE' : '#f0f0f0'} rx="2" opacity={b.value > 0 ? 1 : 0.4} />
            </g>
          );
        })}
        {/* Zero line */}
        <line x1="0" y1={H} x2="600" y2={H} stroke="#e0e0e0" strokeWidth="1" />
      </svg>
      {/* Y-axis labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#bbb', marginTop: 4 }}>
        <span>{new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span style={{ fontWeight: 500, color: '#888' }}>{aggregate ? 'weekly' : 'daily'} · max {fmt$(barMax)}</span>
        <span>{new Date(endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </div>
    </div>
  );
}

// ── Tech bars ──────────────────────────────────────────
function TechBars({ byTech }) {
  const sorted = Object.entries(byTech).sort((a, b) => b[1].revenue - a[1].revenue);
  const maxRev = sorted[0]?.[1].revenue || 1;

  if (!sorted.length) return <Empty>No data</Empty>;
  return (
    <div>
      {sorted.map(([name, d]) => (
        <div key={name} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: '#333', fontWeight: 500 }}>{name}</span>
            <span style={{ color: '#888' }}>{fmt$(d.revenue)} · {d.count} appts</span>
          </div>
          <div style={{ height: 7, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(d.revenue / maxRev) * 100}%`, background: 'linear-gradient(90deg,#2D7A5F,#3D95CE)', borderRadius: 4, transition: 'width .4s' }} />
          </div>
        </div>
      ))}
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

// ── shared primitives ──────────────────────────────────
function Card({ title, children, style }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', padding: '16px 20px', ...style }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

function KPICard({ label, value, sub, accent }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', padding: '16px 20px' }}>
      <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent || '#1a1a1a', lineHeight: 1 }}>{value}</div>
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
