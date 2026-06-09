import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchAppointmentsByRange, fetchReceiptsByRange, fetchEmployees } from '../../lib/firestore';
import { todayStr, apptRevenue } from '../reports/metrics';

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function startOfWeekISO(date) {
  const d = new Date(date + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday-anchored week
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString('en-CA');
}

function addDaysISO(date, n) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

function startOfMonthISO(date) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(1);
  return d.toLocaleDateString('en-CA');
}

function endOfMonthISO(date) {
  const d = new Date(date + 'T12:00:00');
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d.toLocaleDateString('en-CA');
}

function fmtMoney(n) {
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtMoneyExact(n) {
  return `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pctChange(curr, prev) {
  if (!prev) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

// For a tech: sum revenue + tips from receipts in the range, and count
// services from done appointments. Honors techSplit when present so
// multi-tech checkouts attribute correctly.
function computeTechSlice(receipts, appointments, techName) {
  let revenue = 0;
  let tips    = 0;
  let serviceCount = 0;
  const clientIds = new Set();
  const clientNames = {}; // for display fallback when no clientId
  const tipEntries = []; // { date, amount, clientName }
  const redoEntries = []; // { date, dir:'in'|'out', amount, label, other, reason, clientName }
  const services = {};   // { name: { count, revenue } }

  // Revenue + tips come from receipts
  receipts.forEach(r => {
    const p = r.payment || {};
    const refundList = Array.isArray(r.refunds) ? r.refunds : (r.refund ? [r.refund] : []);
    const structured = refundList.length > 0;
    // Legacy refunds (pre per-tech commission) flipped the whole receipt negative;
    // structured refunds carry per-tech withhold/goodwill and are docked below.
    const legacyNeg = !structured && (r.transactionType === 'refund' || r.transactionType === 'void' || r.transactionType === 'cancellation');
    const sign = legacyNeg ? -1 : 1;
    let myRev = 0, totalRev = 0;
    if (p.techSplit && p.techSplit.length) {
      p.techSplit.forEach(s => { totalRev += Number(s.revenue) || 0; });
      p.techSplit.forEach(s => {
        if (s.techName !== techName) return;
        myRev   += Number(s.revenue) || 0;
        revenue += sign * (Number(s.revenue) || 0);
        tips    += sign * (Number(s.tip) || 0);
        if (s.tip && !legacyNeg) tipEntries.push({ date: r.date, amount: Number(s.tip), clientName: r.clientName || 'Walk-in', services: s.services || [] });
      });
    } else if (r.techName === techName) {
      const rev = Number(p.subtotal) || ((r.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0));
      myRev = rev; totalRev = rev;
      revenue += sign * rev;
      tips    += sign * (Number(p.tip) || 0);
      if (p.tip && !legacyNeg) tipEntries.push({ date: r.date, amount: Number(p.tip), clientName: r.clientName || 'Walk-in', services: r.services || [] });
    }
    // Structured refunds: dock this tech's revenue by their share of each WITHHELD
    // refund (goodwill leaves the tech whole — the salon absorbs that share).
    if (structured && myRev > 0 && totalRev > 0) {
      refundList.forEach(rf => {
        const treat = (rf.commissionByTech && rf.commissionByTech[techName]) || 'withhold';
        if (treat === 'withhold') revenue -= (myRev / totalRev) * (Number(rf.amount) || 0);
      });
    }
    // Redo transfer: the original tech loses the redone service's revenue; the
    // redo tech gains it. Audit lines let the tech see exactly why pay moved.
    (Array.isArray(r.redos) ? r.redos : []).forEach(rd => {
      (rd.services || []).forEach(it => {
        if (it.fromTech === techName) { const d = Number(it.amount) || 0; revenue -= d; redoEntries.push({ date: rd.redoneAt || r.date, dir: 'out', amount: d, label: it.name, other: rd.toTech, reason: rd.reason, clientName: r.clientName || 'Walk-in' }); }
      });
      if (rd.toTech === techName) { const d = Number(rd.amount) || 0; revenue += d; redoEntries.push({ date: rd.redoneAt || r.date, dir: 'in', amount: d, label: (rd.services || []).map(s => s.name).join(', '), other: [...new Set((rd.services || []).map(s => s.fromTech).filter(Boolean))].join(', '), reason: rd.reason, clientName: r.clientName || 'Walk-in' }); }
    });
  });

  // Service counts come from done appointments (or receipts with services)
  appointments.forEach(a => {
    if (a.status !== 'done') return;
    const split = a.payment?.techSplit;
    if (split && split.length) {
      split.forEach(s => {
        if (s.techName !== techName) return;
        const techServices = (a.services || []).filter(sv => (sv.techName || a.techName) === techName);
        techServices.forEach(sv => {
          serviceCount += 1;
          const k = sv.name || 'Service';
          if (!services[k]) services[k] = { count: 0, revenue: 0 };
          services[k].count += 1;
          services[k].revenue += Number(sv.price) || 0;
        });
        if (a.clientId) clientIds.add(a.clientId);
        if (!a.clientId && a.clientName) clientNames[a.clientName] = (clientNames[a.clientName] || 0) + 1;
      });
    } else if (a.techName === techName) {
      (a.services || []).forEach(sv => {
        serviceCount += 1;
        const k = sv.name || 'Service';
        if (!services[k]) services[k] = { count: 0, revenue: 0 };
        services[k].count += 1;
        services[k].revenue += Number(sv.price) || 0;
      });
      if (a.clientId) clientIds.add(a.clientId);
      if (!a.clientId && a.clientName) clientNames[a.clientName] = (clientNames[a.clientName] || 0) + 1;
    }
  });

  return {
    revenue,
    tips,
    serviceCount,
    clientCount: clientIds.size + Object.keys(clientNames).length,
    avgTip: serviceCount ? tips / serviceCount : 0,
    services,
    tipEntries: tipEntries.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    redoEntries: redoEntries.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  };
}

export default function TechEarnings() {
  const { isAdmin, isScheduler, isTech, myTechName, viewAs } = useApp();
  const canPickTech = (isAdmin || isScheduler) && !viewAs;
  const [techName, setTechName] = useState(myTechName || '');
  const [techList, setTechList] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [data, setData]         = useState(null);
  // Earnings are masked by default so a glance over the shoulder doesn't reveal
  // pay; the eye toggle reveals them. Preference persists per device.
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem('pn_earnings_hidden') !== '0'; } catch { return true; }
  });
  function toggleHidden() {
    setHidden(h => {
      const next = !h;
      try { localStorage.setItem('pn_earnings_hidden', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  // Load tech list (admin/scheduler view)
  useEffect(() => {
    if (!canPickTech) {
      setTechList([myTechName].filter(Boolean));
      return;
    }
    fetchEmployees().then(emps => {
      const active = emps.filter(e => e.active !== false && e.name).map(e => e.name).sort();
      setTechList(active);
      if (!techName && active.length) setTechName(active[0]);
    }).catch(() => {});
  }, [canPickTech, myTechName]); // eslint-disable-line

  // Load data when tech changes
  useEffect(() => {
    if (!techName) { setLoading(false); return; }
    setLoading(true);
    const today = todayStr();
    const monthStart = startOfMonthISO(today);
    const monthEnd   = endOfMonthISO(today);
    const lastMonth = (() => {
      const d = new Date(today + 'T12:00:00');
      d.setMonth(d.getMonth() - 1);
      return { start: startOfMonthISO(d.toLocaleDateString('en-CA')), end: endOfMonthISO(d.toLocaleDateString('en-CA')) };
    })();
    const weekStart = startOfWeekISO(today);
    const weekEnd   = addDaysISO(weekStart, 6);
    const prevWeekStart = addDaysISO(weekStart, -7);
    const prevWeekEnd   = addDaysISO(weekStart, -1);
    const yesterday  = addDaysISO(today, -1);
    const next7End   = addDaysISO(today, 7);
    const rangeStart = lastMonth.start;
    const rangeEnd   = next7End;

    Promise.all([
      fetchAppointmentsByRange(rangeStart, rangeEnd),
      fetchReceiptsByRange(rangeStart, rangeEnd),
    ]).then(([appts, receipts]) => {
      const sliceFor = (s, e) => {
        const apptsRange = appts.filter(a => a.date >= s && a.date <= e);
        const recsRange = receipts.filter(r => r.date >= s && r.date <= e);
        return computeTechSlice(recsRange, apptsRange, techName);
      };
      const today_     = sliceFor(today, today);
      const yesterday_ = sliceFor(yesterday, yesterday);
      const week_      = sliceFor(weekStart, weekEnd);
      const prevWeek_  = sliceFor(prevWeekStart, prevWeekEnd);
      const month_     = sliceFor(monthStart, monthEnd);
      const lastMonth_ = sliceFor(lastMonth.start, lastMonth.end);

      // Coming up: today's remaining + next 7 days
      const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
      const todayRemaining = appts.filter(a =>
        a.date === today &&
        a.techName === techName &&
        a.status === 'scheduled' &&
        (() => { const [h, m] = (a.startTime || '00:00').split(':').map(Number); return (h * 60 + m) >= nowMins; })()
      ).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      const nextSevenDays = appts.filter(a =>
        a.date > today && a.date <= next7End &&
        a.techName === techName &&
        a.status !== 'cancelled'
      ).sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')));

      // Top clients (last 30 days based on done appts)
      const last30Start = addDaysISO(today, -30);
      const last30Appts = appts.filter(a => a.date >= last30Start && a.date <= today && a.techName === techName && a.status === 'done');
      const clientStats = {};
      last30Appts.forEach(a => {
        const key = a.clientId || `walkin:${a.clientName || ''}`;
        if (!clientStats[key]) clientStats[key] = { name: a.clientName || 'Walk-in', visits: 0, spend: 0 };
        clientStats[key].visits += 1;
        clientStats[key].spend  += apptRevenue(a);
      });
      const topClients = Object.values(clientStats)
        .filter(c => c.name !== 'Walk-in')
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 6);

      setData({
        today: today_, yesterday: yesterday_,
        week: week_, prevWeek: prevWeek_,
        month: month_, lastMonth: lastMonth_,
        todayRemaining, nextSevenDays, topClients,
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [techName]);

  if (!techName) {
    return (
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24, textAlign: 'center', color: 'var(--pn-text-muted)' }}>
        No tech profile linked to your account. Ask an admin to add you.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', paddingBottom: 32 }}>
      {/* Header / tech picker */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Earnings dashboard</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pn-text)' }}>{techName}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={toggleHidden}
            title={hidden ? 'Show earnings' : 'Hide earnings'}
            style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>{hidden ? '👁' : '🙈'}</span>
            {hidden ? 'Show earnings' : 'Hide earnings'}
          </button>
          {canPickTech && techList.length > 1 && (
            <select value={techName} onChange={e => setTechName(e.target.value)}
              style={{ fontFamily: 'inherit', fontSize: 13, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', outline: 'none' }}>
              {techList.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--pn-text-faint)' }}>Loading…</div>
      )}

      {!loading && data && data.month.serviceCount === 0 && data.todayRemaining.length === 0 && data.nextSevenDays.length === 0 && (
        <div style={{ background: 'linear-gradient(135deg, #f3eafc 0%, #eaf3fc 100%)', border: '1px solid #d8d0e8', borderRadius: 14, padding: 24, textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✨</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 6 }}>Welcome, {techName.split(' ')[0]}!</div>
          <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
            Your dashboard will fill in once you start completing appointments. Tips, services done, and your weekly take-home will all appear here in real time.
          </div>
        </div>
      )}

      {!loading && data && (
        <>
          {/* Three stat cards: Today / This week / This month */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 22 }}>
            <StatCard
              title="Today"
              hidden={hidden}
              accent="#3D95CE"
              services={data.today.serviceCount}
              revenue={data.today.revenue}
              tips={data.today.tips}
              avgTip={data.today.avgTip}
              clients={data.today.clientCount}
              compareLabel="vs yesterday"
              compareDelta={pctChange(data.today.revenue + data.today.tips, data.yesterday.revenue + data.yesterday.tips)}
            />
            <StatCard
              title="This week"
              hidden={hidden}
              accent="#2D7A5F"
              services={data.week.serviceCount}
              revenue={data.week.revenue}
              tips={data.week.tips}
              avgTip={data.week.avgTip}
              clients={data.week.clientCount}
              compareLabel="vs last week"
              compareDelta={pctChange(data.week.revenue + data.week.tips, data.prevWeek.revenue + data.prevWeek.tips)}
            />
            <StatCard
              title="This month"
              hidden={hidden}
              accent="#6a4fa0"
              services={data.month.serviceCount}
              revenue={data.month.revenue}
              tips={data.month.tips}
              avgTip={data.month.avgTip}
              clients={data.month.clientCount}
              compareLabel="vs last month"
              compareDelta={pctChange(data.month.revenue + data.month.tips, data.lastMonth.revenue + data.lastMonth.tips)}
            />
          </div>

          {/* Tips timeline + coming up + top clients */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            <Panel title="Recent tips">
              {data.month.tipEntries.length === 0 ? (
                <Empty>No tips yet this month</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.month.tipEntries.slice(0, 8).map((e, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--pn-bg)', borderRadius: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{e.clientName}</div>
                        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>
                          {new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          {e.services?.length ? ` · ${e.services.map(s => s.name || s).filter(Boolean).slice(0, 2).join(', ')}` : ''}
                        </div>
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#22c55e' }}>{hidden ? '••••' : `+${fmtMoneyExact(e.amount)}`}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {data.month.redoEntries?.length > 0 && (
              <Panel title="Redo adjustments">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.month.redoEntries.slice(0, 8).map((e, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--pn-bg)', borderRadius: 8 }}>
                      <div style={{ minWidth: 0, paddingRight: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>
                          {e.dir === 'in' ? `Redid ${e.clientName}'s ${e.label}` : `${e.clientName}'s ${e.label} redone by ${e.other || 'another tech'}`}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>
                          {new Date((e.date || '').slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          {e.dir === 'in' && e.other ? ` · orig. ${e.other}` : ''}
                          {e.reason ? ` · "${e.reason}"` : ''}
                        </div>
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: e.dir === 'in' ? '#22c55e' : '#ef4444', whiteSpace: 'nowrap' }}>{hidden ? '••••' : `${e.dir === 'in' ? '+' : '−'}${fmtMoneyExact(e.amount)}`}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="Coming up">
              {data.todayRemaining.length === 0 && data.nextSevenDays.length === 0 ? (
                <Empty>Nothing scheduled in the next 7 days</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.todayRemaining.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Today's remaining</div>
                      {data.todayRemaining.map(a => (
                        <ApptRow key={a.id} a={a} />
                      ))}
                    </>
                  )}
                  {data.nextSevenDays.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 4 }}>Next 7 days</div>
                      {data.nextSevenDays.slice(0, 8).map(a => (
                        <ApptRow key={a.id} a={a} showDate />
                      ))}
                    </>
                  )}
                </div>
              )}
            </Panel>

            <Panel title="Your regulars (last 30 days)">
              {data.topClients.length === 0 ? (
                <Empty>No regulars yet</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.topClients.map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: i === 0 ? '#fff7ed' : 'var(--pn-bg)', borderRadius: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>
                        {i === 0 && '⭐ '}
                        {c.name}
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>{c.visits} visit{c.visits === 1 ? '' : 's'}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#2D7A5F' }}>{hidden ? '••••' : fmtMoney(c.spend)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* Service mix breakdown */}
            <Panel title="Top services this month">
              {Object.keys(data.month.services).length === 0 ? (
                <Empty>No services yet this month</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(data.month.services)
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 6)
                    .map(([name, s]) => (
                      <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--pn-bg)', borderRadius: 8 }}>
                        <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>{name}</div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>×{s.count}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#6a4fa0' }}>{hidden ? '••••' : fmtMoney(s.revenue)}</span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ title, accent, services, revenue, tips, avgTip, clients, compareLabel, compareDelta, hidden }) {
  const total = revenue + tips;
  const mask = (s) => (hidden ? '••••' : s);
  const trendColor = compareDelta == null ? '#888' : compareDelta > 0 ? '#22c55e' : compareDelta < 0 ? '#ef4444' : '#888';
  const trendArrow = compareDelta == null ? '·' : compareDelta > 0 ? '▲' : compareDelta < 0 ? '▼' : '—';
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 14, padding: 18, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{title}</div>
        {compareDelta != null && (
          <div style={{ fontSize: 11, color: trendColor, fontWeight: 700 }}>
            {trendArrow} {Math.abs(compareDelta)}% <span style={{ fontWeight: 400, color: 'var(--pn-text-faint)' }}>{compareLabel}</span>
          </div>
        )}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: accent, lineHeight: 1.1, marginBottom: 4 }}>{mask(fmtMoney(total))}</div>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>Total: services + tips</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 14 }}>
        <Stat label="Services" value={mask(fmtMoney(revenue))} sub={`${services} done`} />
        <Stat label="Tips" value={mask(fmtMoney(tips))} sub={services ? (hidden ? 'avg ••••' : `avg ${fmtMoneyExact(avgTip)}`) : '—'} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--pn-text-muted)' }}>
        {clients} unique client{clients === 1 ? '' : 's'}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--pn-bg)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pn-text)', lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>{sub}</div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', padding: '14px 4px', textAlign: 'center' }}>{children}</div>;
}

function ApptRow({ a, showDate }) {
  const dateStr = showDate
    ? new Date(a.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : '';
  const t = a.startTime || '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--pn-bg)', borderRadius: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{a.clientName || 'Walk-in'}</div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>
          {showDate ? `${dateStr} · ${t}` : t}
          {Array.isArray(a.services) && a.services.length > 0 ? ` · ${a.services.map(s => s.name).filter(Boolean).join(', ')}` : ''}
        </div>
      </div>
    </div>
  );
}
