import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Dimensions, Platform, Share, Modal } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import DateTimePicker from '@react-native-community/datetimepicker';
import { fetchReceiptsByRange, fetchAppointmentsByRange, fetchServiceRatingsByRange, fetchHistoricalClientIds, fetchClients, fetchClientAppointments, fetchFraudBlocksByRange } from '../../lib/firestore';
import { buildTransactions, computeMetrics, computeCancellations, computeRefundBreakdown, computeRetention } from '../../lib/metrics';
import AskAIChat from '../../components/AskAIChat';
import useTenantAccess from '../../hooks/useTenantAccess';
import useResponsive from '../../hooks/useResponsive';
import useTrashHeader from '../../hooks/useTrashHeader';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const PERIODS = [{ days: 0, label: 'Today' }, { days: 7, label: '7d' }, { days: 14, label: '14d' }, { days: 30, label: '30d' }, { days: 90, label: '90d' }];
const LIST_CAP = 50;  // initial render cap for the unbounded cancellations + fraud lists
const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const isoDay = (d) => d.toISOString().slice(0, 10);

function presetRange(days) {
  const end = new Date(), start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: isoDay(start), endDate: isoDay(end) };
}

// Aggregate service ratings for the Ratings tab (matches the web tab).
function computeRatings(list) {
  const arr = (list || []).filter(r => Number(r.rating) >= 1 && Number(r.rating) <= 5);
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const sources = { email: 0, sms: 0, web: 0 };
  const techMap = {};
  let sum = 0;
  arr.forEach(r => {
    const v = Math.round(Number(r.rating)); sum += Number(r.rating);
    dist[v] = (dist[v] || 0) + 1;
    if (sources[r.source] != null) sources[r.source]++;
    const t = r.techName || '—';
    (techMap[t] || (techMap[t] = { name: t, count: 0, sum: 0 }));
    techMap[t].count++; techMap[t].sum += Number(r.rating);
  });
  const byTech = Object.values(techMap)
    .map(t => ({ ...t, avg: t.count ? t.sum / t.count : 0 }))
    .sort((a, b) => b.avg - a.avg || b.count - a.count);
  const low = arr.filter(r => Number(r.rating) < 3).slice(0, 20);
  return { count: arr.length, avg: arr.length ? sum / arr.length : 0, dist, sources, byTech, low };
}

const stars = (n) => '★'.repeat(Math.round(Number(n) || 0)) + '☆'.repeat(Math.max(0, 5 - Math.round(Number(n) || 0)));

// Revenue-by-day bar chart (react-native-svg — already a dep, no native add).
// `width` is the inner card width; falls back to the phone window width.
function RevenueChart({ byDay, width }) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const entries = Object.entries(byDay || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map(e => e[1]), 1);
  const W = width || (Dimensions.get('window').width - 60);
  const H = 120, gap = entries.length > 40 ? 1 : 2;
  const bw = Math.max(2, (W - gap * (entries.length - 1)) / entries.length);
  return (
    <View style={styles.chartCard}>
      <Svg width={W} height={H}>
        {entries.map(([date, rev], i) => {
          const h = Math.max(1, (rev / max) * (H - 6));
          return <Rect key={date} x={i * (bw + gap)} y={H - h} width={bw} height={h} rx={1} fill={theme.green} />;
        })}
      </Svg>
      <View style={styles.chartAxis}>
        <Text style={styles.axisText}>{entries[0][0].slice(5)}</Text>
        <Text style={styles.axisText}>peak {money(max)}/day</Text>
        <Text style={styles.axisText}>{entries[entries.length - 1][0].slice(5)}</Text>
      </View>
    </View>
  );
}

// Read-only revenue dashboard. Reuses the web's pure metrics. AI assistant +
// PDF/1099 export stay web-only.
export default function ReportsScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  const { isTablet, contentMaxWidth, width: winW } = useResponsive();
  useTrashHeader(navigation, ['receipts'], isAdmin);
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const [days, setDays]       = useState(30);
  const [custom, setCustom]   = useState(false);
  const [cStart, setCStart]   = useState(presetRange(30).startDate);
  const [cEnd, setCEnd]       = useState(presetRange(0).endDate);
  const [picker, setPicker]   = useState(null); // 'start' | 'end' | null
  const [metrics, setMetrics] = useState(null);
  const [cancels, setCancels] = useState(null);
  const [prev, setPrev]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [techFilter, setTechFilter] = useState('');   // '' = all techs
  const [section, setSection] = useState('overview');  // overview | ratings | ask
  const [ratings, setRatings] = useState(null);
  const [refundBreak, setRefundBreak] = useState(null);
  const [retention, setRetention] = useState(null);
  const [openBucket, setOpenBucket] = useState(null);  // expanded clientless bucket
  const [referrals, setReferrals] = useState([]);
  const [visitClient, setVisitClient] = useState(null);// { id, name } for the visits modal
  const [visits, setVisits] = useState(null);
  const [rawAppts, setRawAppts] = useState(null);     // unbuilt appts for the cancellations list
  const [clientList, setClientList] = useState(null);  // clients for joining full contact info
  const [cxKind, setCxKind] = useState('all');         // all | cancelled | no_show
  const [fraudBlocks, setFraudBlocks] = useState([]);  // honeypot/bot blocks
  const [cxShowAll, setCxShowAll] = useState(false);   // expand the capped cancellations list
  const [fraudShowAll, setFraudShowAll] = useState(false); // expand the capped fraud list

  const range = custom ? { startDate: cStart, endDate: cEnd } : presetRange(days);
  // KPIs go 4-up on a tablet (2-up on phone); chart sizes to the capped column.
  const colW = isTablet ? '23.5%' : '48%';
  const containerW = Math.min(winW, contentMaxWidth || winW);
  const chartW = containerW - 14 * 2 - 12 * 2;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { startDate, endDate } = range;
      // Previous equal-length window, immediately before, for the deltas.
      const s = new Date(startDate + 'T00:00:00'), e = new Date(endDate + 'T00:00:00');
      const prevEnd = new Date(s.getTime() - 86400000);
      const prevStart = new Date(prevEnd.getTime() - (e - s));
      const pIso = (d) => d.toISOString().slice(0, 10);
      const [receipts, appts, pReceipts, pAppts, svcRatings, priorIds, clients, fraud] = await Promise.all([
        fetchReceiptsByRange(startDate, endDate).catch(() => []),
        fetchAppointmentsByRange(startDate, endDate).catch(() => []),
        fetchReceiptsByRange(pIso(prevStart), pIso(prevEnd)).catch(() => []),
        fetchAppointmentsByRange(pIso(prevStart), pIso(prevEnd)).catch(() => []),
        fetchServiceRatingsByRange(startDate, endDate).catch(() => []),
        fetchHistoricalClientIds(startDate).catch(() => new Set()),
        fetchClients().catch(() => []),
        fetchFraudBlocksByRange(startDate, endDate).catch(() => []),
      ]);
      setFraudBlocks((fraud || []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
      const txns = buildTransactions(receipts, appts);
      setMetrics(computeMetrics(txns));
      setCancels(computeCancellations(appts, receipts));
      setRawAppts(appts);
      setClientList(clients);
      setPrev(computeMetrics(buildTransactions(pReceipts, pAppts)));
      setRatings(computeRatings(svcRatings));
      setRefundBreak(computeRefundBreakdown(receipts));
      setRetention(computeRetention(txns, priorIds));
      // Referral leaderboard from client.referredBy.
      const refMap = {};
      (clients || []).forEach(c => {
        const rb = c.referredBy;
        if (rb && rb.id) { (refMap[rb.id] || (refMap[rb.id] = { name: rb.name || 'Someone', names: [] })).names.push(c.name || 'Client'); }
      });
      setReferrals(Object.values(refMap).map(r => ({ name: r.name, count: r.names.length, names: r.names })).sort((a, b) => b.count - a.count).slice(0, 10));
    } catch { setMetrics(null); setCancels(null); setPrev(null); setRatings(null); setRefundBreak(null); setRetention(null); setReferrals([]); setRawAppts([]); setClientList([]); setFraudBlocks([]); }
    finally { setLoading(false); }
  }, [custom, days, cStart, cEnd]);
  useEffect(() => { load(); }, [load]);

  const techs = useMemo(() => metrics ? Object.entries(metrics.byTech).map(([name, t]) => ({ name, ...t })).sort((a, b) => b.revenue - a.revenue) : [], [metrics]);
  const services = useMemo(() => metrics ? Object.entries(metrics.byService).map(([name, s]) => ({ name, ...s })).sort((a, b) => b.revenue - a.revenue).slice(0, 8) : [], [metrics]);

  // Per-tech drill-down — driven off the already-split byTech / tipsByTech
  // aggregates so multi-tech bookings attribute correctly (no re-query).
  const tb        = useMemo(() => techFilter ? (metrics?.byTech?.[techFilter] || { revenue: 0, count: 0, services: {}, clientCount: 0 }) : null, [techFilter, metrics]);
  const tbPrev    = techFilter ? (prev?.byTech?.[techFilter] || null) : null;
  const ptTips    = techFilter ? (metrics?.tipsByTech?.[techFilter] || 0) : 0;
  const ptTipsPrev= techFilter ? (prev?.tipsByTech?.[techFilter] ?? null) : null;
  const ptAvg     = tb && tb.count ? tb.revenue / tb.count : 0;
  const ptAvgPrev = tbPrev && tbPrev.count ? tbPrev.revenue / tbPrev.count : null;
  const ptServices= useMemo(() => tb ? Object.entries(tb.services).map(([name, s]) => ({ name, ...s })).sort((a, b) => b.revenue - a.revenue).slice(0, 12) : [], [tb]);
  const ptCancel  = techFilter ? (cancels?.byTech?.[techFilter] || null) : null;

  async function shareSummary() {
    try {
      await Share.share({ message: buildSummary({ custom, days, range, techFilter, metrics, tb, ptTips, ptAvg, ptServices, techs, services }) });
    } catch {}
  }
  async function openVisits(clientId, name) {
    setVisitClient({ id: clientId, name }); setVisits(null);
    try { setVisits(await fetchClientAppointments(clientId) || []); } catch { setVisits([]); }
  }
  const topClients = useMemo(() => metrics ? Object.entries(metrics.byClient || {}).map(([id, c]) => ({ id, ...c })).sort((a, b) => b.revenue - a.revenue).slice(0, 10) : [], [metrics]);

  // Cancelled + no-show rows, joined with the client record for full contact
  // info, newest first. Respects the active tech filter + the kind toggle.
  const clientById = useMemo(() => (clientList || []).reduce((m, c) => { m[c.id] = c; return m; }, {}), [clientList]);
  const cxRows = useMemo(() => (rawAppts || [])
    .filter(a => a.status === 'cancelled' || a.status === 'no_show')
    .filter(a => cxKind === 'all' || a.status === cxKind)
    .filter(a => !techFilter || a.techName === techFilter)
    .map(a => {
      const c = a.clientId ? clientById[a.clientId] : null;
      return {
        ...a,
        _name:  a.clientName || c?.name || (a.clientId ? '(unknown)' : 'Walk-in'),
        _phone: c?.phone || a.clientPhone || '',
        _email: c?.email || a.clientEmail || '',
        _lost:  (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0),
        _geo:   [a.bookingGeo?.city, a.bookingGeo?.region, a.bookingGeo?.country].filter(Boolean).join(', '),
        _sort:  a.cancelledAt || `${a.date}T${a.startTime || '00:00'}`,
      };
    })
    .sort((x, y) => String(y._sort).localeCompare(String(x._sort))), [rawAppts, clientById, cxKind, techFilter]);
  const cxLost = useMemo(() => cxRows.reduce((s, r) => s + r._lost, 0), [cxRows]);
  const cxCancelled = useMemo(() => cxRows.filter(r => r.status === 'cancelled').length, [cxRows]);
  const cxNoShow = useMemo(() => cxRows.filter(r => r.status === 'no_show').length, [cxRows]);

  async function shareCancellations() {
    const L = [`Plume Nexus — Cancellations & No-Shows (${periodLabel(custom, days, range)})`,
      `${cxCancelled} cancelled · ${cxNoShow} no-show · ${money(cxLost)} lost`, ''];
    cxRows.forEach(r => {
      L.push(`${r.date}${r.startTime ? ' ' + r.startTime : ''} — ${cxLabel(r)}`);
      L.push(`  ${r._name}${r._phone ? ' · ' + r._phone : ''}${r._email ? ' · ' + r._email : ''}`);
      L.push(`  ${r.techName || '—'} · ${(r.services || []).map(s => s.name).join(', ') || '—'} · ${money(r._lost)}`);
      if (r.deposit?.amountCents > 0) L.push(`  ${r.deposit.mode === 'authorize' ? 'Hold' : 'Deposit'}: ${money(r.deposit.amountCents / 100)}${r.deposit.status ? ' · ' + r.deposit.status : ''}`);
      if (r._geo || r.bookingIp) L.push(`  Booked from: ${[r._geo, r.bookingIp].filter(Boolean).join(' · ')}`);
    });
    try { await Share.share({ message: L.join('\n') }); } catch {}
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={styles.sectionTabs}>
        {[['overview', 'Overview'], ['cancellations', 'Cancels'], ['ratings', 'Ratings'], ['ask', 'Ask AI']].map(([id, label]) => (
          <TouchableOpacity key={id} onPress={() => setSection(id)} style={[styles.sectionTab, section === id && styles.sectionTabOn]}>
            <Text style={[styles.sectionTabText, section === id && styles.sectionTabTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {section === 'ask' ? <AskAIChat /> : (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 14, paddingBottom: 40, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}>
      <View style={styles.tabs}>
        {PERIODS.map(p => (
          <TouchableOpacity key={p.label} onPress={() => { setCustom(false); setDays(p.days); }} style={[styles.tab, !custom && days === p.days && styles.tabOn]}>
            <Text style={[styles.tabText, !custom && days === p.days && styles.tabTextOn]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={() => setCustom(true)} style={[styles.tab, custom && styles.tabOn]}>
          <Text style={[styles.tabText, custom && styles.tabTextOn]}>Custom</Text>
        </TouchableOpacity>
      </View>

      {custom && (
        <View style={styles.rangeRow}>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setPicker('start')}><Text style={styles.dateText}>{cStart}</Text></TouchableOpacity>
          <Text style={styles.dash}>→</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setPicker('end')}><Text style={styles.dateText}>{cEnd}</Text></TouchableOpacity>
        </View>
      )}
      {picker && (
        <DateTimePicker
          value={new Date((picker === 'start' ? cStart : cEnd) + 'T12:00:00')}
          mode="date"
          maximumDate={new Date()}
          onChange={(e, d) => {
            if (Platform.OS !== 'ios') setPicker(null);
            if (d) { picker === 'start' ? setCStart(isoDay(d)) : setCEnd(isoDay(d)); }
            if (Platform.OS === 'ios' && e.type === 'set') setPicker(null);
          }}
        />
      )}

      {section === 'overview' && (loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.green} /></View>
      ) : !metrics || metrics.totalAppts === 0 ? (
        <Text style={styles.empty}>No completed transactions in this period.</Text>
      ) : (
        <>
          {techs.filter(t => t.name).length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6, paddingRight: 4 }}>
              <TouchableOpacity onPress={() => setTechFilter('')} style={[styles.tFilter, !techFilter && styles.tFilterOn]}>
                <Text style={[styles.tFilterText, !techFilter && styles.tFilterTextOn]}>All techs</Text>
              </TouchableOpacity>
              {techs.filter(t => t.name).map(t => (
                <TouchableOpacity key={t.name} onPress={() => setTechFilter(t.name)} style={[styles.tFilter, techFilter === t.name && styles.tFilterOn]}>
                  <Text style={[styles.tFilterText, techFilter === t.name && styles.tFilterTextOn]} numberOfLines={1}>{t.name || '(unassigned)'}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {techFilter ? (
          <>
          <View style={styles.kpis}>
            <Kpi label="Revenue" value={money(tb.revenue)} big colW={colW} delta={pctDelta(tb.revenue, tbPrev?.revenue)} />
            <Kpi label="Appts" value={tb.count} colW={colW} delta={pctDelta(tb.count, tbPrev?.count)} />
            <Kpi label="Avg ticket" value={money(ptAvg)} colW={colW} delta={pctDelta(ptAvg, ptAvgPrev)} />
            <Kpi label="Tips" value={money(ptTips)} colW={colW} delta={pctDelta(ptTips, ptTipsPrev)} />
          </View>
          <Text style={styles.deltaNote}>{techFilter || '(unassigned)'} · {tb.clientCount} client{tb.clientCount === 1 ? '' : 's'} · ▲▼ vs previous {custom ? 'period' : (days === 0 ? 'day' : `${days} days`)}</Text>

          {!!ptCancel && (ptCancel.cancelled > 0 || ptCancel.noShow > 0) && (
            <>
              <Text style={styles.section}>Cancellations</Text>
              <View style={styles.kpis}>
                <Kpi label="Cancelled" value={ptCancel.cancelled || 0} colW={colW} />
                <Kpi label="No-shows" value={ptCancel.noShow || 0} colW={colW} />
                <Kpi label="Lost revenue" value={money(ptCancel.lostRevenue)} colW={colW} />
                <Kpi label="Clients" value={tb.clientCount} colW={colW} />
              </View>
            </>
          )}

          <Text style={styles.section}>{techFilter || '(unassigned)'}'s services</Text>
          {ptServices.length === 0 && <Text style={styles.empty}>No services in this period.</Text>}
          {ptServices.map(s => (
            <View key={s.name} style={styles.row}>
              <View style={{ flex: 1 }}><Text style={styles.name}>{s.name}</Text><Text style={styles.sub}>{s.count}×</Text></View>
              <Text style={styles.amount}>{money(s.revenue)}</Text>
            </View>
          ))}
          </>
          ) : (
          <>
          <View style={styles.kpis}>
            <Kpi label="Revenue" value={money(metrics.totalRevenue)} big colW={colW} delta={pctDelta(metrics.totalRevenue, prev?.totalRevenue)} />
            <Kpi label="Appts" value={metrics.totalAppts} colW={colW} delta={pctDelta(metrics.totalAppts, prev?.totalAppts)} />
            <Kpi label="Avg ticket" value={money(metrics.avgTicket)} colW={colW} delta={pctDelta(metrics.avgTicket, prev?.avgTicket)} />
            <Kpi label="Tips" value={money(metrics.tipTotal)} colW={colW} delta={pctDelta(metrics.tipTotal, prev?.tipTotal)} />
          </View>
          <Text style={styles.deltaNote}>▲▼ vs the previous {custom ? 'period' : (days === 0 ? 'day' : `${days} days`)}</Text>

          <Text style={styles.section}>Revenue per day</Text>
          <RevenueChart byDay={metrics.byDay} width={chartW} />

          {!!cancels && (cancels.cancelCount > 0 || cancels.lostRevenue > 0) && (
            <>
              <Text style={styles.section}>Cancellations</Text>
              <View style={styles.kpis}>
                <Kpi label="Cancelled" value={cancels.cancelCount || 0} colW={colW} />
                <Kpi label="Cancel rate" value={`${Math.round((cancels.cancelRate || 0) * 100)}%`} colW={colW} />
                <Kpi label="Lost revenue" value={money(cancels.lostRevenue)} colW={colW} />
                <Kpi label="No-shows" value={cancels.noShowCount || 0} colW={colW} />
              </View>
            </>
          )}

          <Text style={styles.section}>Tech leaderboard</Text>
          {techs.map((t, i) => (
            <View key={t.name} style={styles.row}>
              <Text style={styles.rank}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{t.name || '(unassigned)'}</Text>
                <Text style={styles.sub}>{t.count} appt{t.count === 1 ? '' : 's'} · {t.clientCount} client{t.clientCount === 1 ? '' : 's'}</Text>
              </View>
              <Text style={styles.amount}>{money(t.revenue)}</Text>
            </View>
          ))}

          <Text style={styles.section}>Top services</Text>
          {services.map(s => (
            <View key={s.name} style={styles.row}>
              <View style={{ flex: 1 }}><Text style={styles.name}>{s.name}</Text><Text style={styles.sub}>{s.count}×</Text></View>
              <Text style={styles.amount}>{money(s.revenue)}</Text>
            </View>
          ))}

          <Text style={styles.section}>Payment methods</Text>
          {['card', 'cash', 'other'].map(m => (
            <View key={m} style={styles.row}>
              <Text style={[styles.name, { flex: 1, textTransform: 'capitalize' }]}>{m}</Text>
              <Text style={styles.sub}>{metrics.byMethod[m].count}×</Text>
              <Text style={[styles.amount, { marginLeft: 10 }]}>{money(metrics.byMethod[m].total)}</Text>
            </View>
          ))}
          </>
          )}
          <TouchableOpacity onPress={shareSummary} style={styles.shareBtn} activeOpacity={0.85}>
            <Text style={styles.shareBtnText}>⤴  Share summary</Text>
          </TouchableOpacity>
          {!techFilter && (
            <>
              <Text style={styles.section}>Processing fees</Text>
              <View style={styles.card2}>
                <View style={styles.statRow}><Text style={styles.statLabel}>Total card fees</Text><Text style={styles.statValue}>{money(metrics.ccFeeTotal)}</Text></View>
                <View style={styles.statRow}><Text style={styles.statLabel}>Avg per card sale</Text><Text style={styles.statValue}>{money(metrics.cardTxnCount ? metrics.ccFeeTotal / metrics.cardTxnCount : 0)}</Text></View>
                <View style={styles.statRow}><Text style={styles.statLabel}>Effective rate</Text><Text style={styles.statValue}>{(metrics.cardRevenue ? (metrics.ccFeeTotal / metrics.cardRevenue) * 100 : 0).toFixed(2)}%</Text></View>
                <View style={styles.statRow}><Text style={styles.statLabel}>Net card revenue</Text><Text style={styles.statValue}>{money(metrics.cardRevenue - metrics.ccFeeTotal)}</Text></View>
              </View>

              <Text style={styles.section}>Gratuity</Text>
              <View style={styles.card2}>
                <View style={styles.statRow}><Text style={styles.statLabel}>Total tips</Text><Text style={styles.statValue}>{money(metrics.tipTotal)}</Text></View>
                <View style={styles.statRow}><Text style={styles.statLabel}>Tip rate</Text><Text style={styles.statValue}>{(metrics.totalRevenue ? (metrics.tipTotal / metrics.totalRevenue) * 100 : 0).toFixed(1)}%</Text></View>
                <View style={styles.statRow}><Text style={styles.statLabel}>Card tips</Text><Text style={styles.statValue}>{money(metrics.tipsByMethod.card)}</Text></View>
                <View style={styles.statRow}><Text style={styles.statLabel}>Cash tips</Text><Text style={styles.statValue}>{money(metrics.tipsByMethod.cash)}</Text></View>
                {metrics.tipsByMethod.other > 0 && <View style={styles.statRow}><Text style={styles.statLabel}>Other tips</Text><Text style={styles.statValue}>{money(metrics.tipsByMethod.other)}</Text></View>}
              </View>
              {Object.entries(metrics.tipsByTech).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, amt]) => (
                <View key={name} style={styles.miniRow}><Text style={styles.miniName} numberOfLines={1}>{name}</Text><Text style={styles.miniVal}>{money(amt)}</Text></View>
              ))}

              {refundBreak && refundBreak.count > 0 && (
                <>
                  <Text style={styles.section}>Refunds & commission</Text>
                  <View style={styles.card2}>
                    <View style={styles.statRow}><Text style={styles.statLabel}>Refunded ({refundBreak.count})</Text><Text style={styles.statValue}>{money(refundBreak.refunded)}</Text></View>
                    <View style={styles.statRow}><Text style={styles.statLabel}>Withheld from techs</Text><Text style={styles.statValue}>{money(refundBreak.withheld)}</Text></View>
                    <View style={styles.statRow}><Text style={styles.statLabel}>Salon goodwill</Text><Text style={styles.statValue}>{money(refundBreak.goodwill)}</Text></View>
                  </View>
                </>
              )}

              {retention && (
                <>
                  <Text style={styles.section}>New vs returning</Text>
                  <View style={styles.card2}>
                    {retention.clientTotal > 0 ? (
                      <>
                        <View style={styles.statRow}><Text style={styles.statLabel}>Returning clients</Text><Text style={styles.statValue}>{retention.returningCount} · {Math.round(retention.returningCount / retention.clientTotal * 100)}%</Text></View>
                        <View style={styles.statRow}><Text style={styles.statLabel}>New clients</Text><Text style={styles.statValue}>{retention.newCount} · {Math.round(retention.newCount / retention.clientTotal * 100)}%</Text></View>
                      </>
                    ) : (
                      <View style={styles.statRow}><Text style={styles.statLabel}>No client-linked visits</Text><Text style={styles.statValue}>—</Text></View>
                    )}
                    {[
                      { key: 'gift',     label: 'Gift card / retail (no client)', rows: retention.giftRetailRows || [] },
                      { key: 'unlinked', label: 'Unmatched history',              rows: retention.unlinkedRows   || [] },
                      { key: 'walkin',   label: 'Walk-ins (anonymous)',           rows: retention.walkInRows     || [] },
                    ].filter(b => b.rows.length > 0).map(b => (
                      <View key={b.key}>
                        <TouchableOpacity style={styles.statRow} onPress={() => setOpenBucket(openBucket === b.key ? null : b.key)}>
                          <Text style={styles.statLabel}>{b.label}</Text>
                          <Text style={[styles.statValue, { color: theme.blue }]}>{b.rows.length} {openBucket === b.key ? '▾' : '▸'}</Text>
                        </TouchableOpacity>
                        {openBucket === b.key && b.rows.map((tx, i) => {
                          const amt = tx.payment?.total ?? (tx.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
                          const ggId = tx._glossgeniusTransactionId || tx._glossgeniusChargeId;
                          return (
                            <View key={tx.id || i} style={styles.miniRow}>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.miniName} numberOfLines={1}>{tx.clientName || '(no name)'}</Text>
                                <Text style={{ fontSize: 11, color: theme.textFaint }} numberOfLines={1}>{tx.date}{tx.techName ? ` · ${tx.techName}` : ''}{ggId ? ` · GG ${ggId}` : ''}</Text>
                              </View>
                              <Text style={styles.miniVal}>{money(amt)}</Text>
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </>
              )}

              {referrals.length > 0 && (
                <>
                  <Text style={styles.section}>Top referrers</Text>
                  {referrals.map(r => (
                    <View key={r.name} style={styles.miniRow}><Text style={styles.miniName} numberOfLines={1}>{r.name}</Text><Text style={styles.miniVal}>{r.count} referral{r.count === 1 ? '' : 's'}</Text></View>
                  ))}
                </>
              )}

              {topClients.length > 0 && (
                <>
                  <Text style={styles.section}>Top clients</Text>
                  {topClients.map(c => (
                    <TouchableOpacity key={c.id} style={styles.miniRow} onPress={() => openVisits(c.id, c.name)}>
                      <Text style={styles.miniName} numberOfLines={1}>{c.name || 'Client'}</Text>
                      <Text style={styles.miniVal}>{money(c.revenue)} · {c.count} visit{c.count === 1 ? '' : 's'}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </>
          )}

          <Text style={styles.note}>Tax / 1099 PDF export is on the web app.</Text>
        </>
      ))}

      {section === 'cancellations' && (loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.green} /></View>
      ) : (
        <>
          {techs.filter(t => t.name).length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6, paddingRight: 4 }}>
              <TouchableOpacity onPress={() => setTechFilter('')} style={[styles.tFilter, !techFilter && styles.tFilterOn]}>
                <Text style={[styles.tFilterText, !techFilter && styles.tFilterTextOn]}>All techs</Text>
              </TouchableOpacity>
              {techs.filter(t => t.name).map(t => (
                <TouchableOpacity key={t.name} onPress={() => setTechFilter(t.name)} style={[styles.tFilter, techFilter === t.name && styles.tFilterOn]}>
                  <Text style={[styles.tFilterText, techFilter === t.name && styles.tFilterTextOn]} numberOfLines={1}>{t.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <View style={styles.tabs}>
            {[['all', 'All'], ['cancelled', 'Cancelled'], ['no_show', 'No-shows']].map(([id, label]) => (
              <TouchableOpacity key={id} onPress={() => setCxKind(id)} style={[styles.tab, cxKind === id && styles.tabOn]}>
                <Text style={[styles.tabText, cxKind === id && styles.tabTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.kpis}>
            <Kpi label="Cancelled" value={cxCancelled} colW={colW} />
            <Kpi label="No-shows" value={cxNoShow} colW={colW} />
            <Kpi label="Total" value={cxRows.length} colW={colW} />
            <Kpi label="Lost revenue" value={money(cxLost)} colW={colW} />
          </View>

          {cxRows.length === 0 ? (
            <Text style={styles.empty}>No cancellations or no-shows in this period.</Text>
          ) : (
            <>
              {(cxShowAll ? cxRows : cxRows.slice(0, LIST_CAP)).map(r => (
                <TouchableOpacity key={r.id} style={styles.cxCard} activeOpacity={r.clientId ? 0.7 : 1}
                  onPress={() => r.clientId && openVisits(r.clientId, r._name)}>
                  <View style={styles.cxHead}>
                    <Text style={styles.cxName} numberOfLines={1}>{r._name}</Text>
                    <View style={[styles.cxBadge, { backgroundColor: r.status === 'no_show' ? '#FEE2E2' : '#FEF3C7' }]}>
                      <Text style={[styles.cxBadgeText, { color: r.status === 'no_show' ? '#991B1B' : '#92400E' }]}>{cxLabel(r)}</Text>
                    </View>
                  </View>
                  <Text style={styles.cxLine}>{r.date}{r.startTime ? ` · ${r.startTime}` : ''}{r.techName ? `  ·  ${r.techName}` : ''}</Text>
                  {(r._phone || r._email) && <Text style={styles.cxLine}>{[r._phone, r._email].filter(Boolean).join('  ·  ')}</Text>}
                  <Text style={styles.cxLine}>{(r.services || []).map(s => s.name).join(', ') || '—'}  ·  {money(r._lost)} lost</Text>
                  {r.deposit?.amountCents > 0 && (
                    <Text style={styles.cxLineFaint}>{r.deposit.mode === 'authorize' ? 'Hold' : 'Deposit'} {money(r.deposit.amountCents / 100)}{r.deposit.status ? `  ·  ${r.deposit.status === 'requires_capture' ? 'held' : r.deposit.status}` : ''}</Text>
                  )}
                  {(r._geo || r.bookingIp) && <Text style={styles.cxLineFaint}>Booked from {[r._geo, r.bookingIp].filter(Boolean).join('  ·  ')}</Text>}
                </TouchableOpacity>
              ))}
              {!cxShowAll && cxRows.length > LIST_CAP && (
                <TouchableOpacity onPress={() => setCxShowAll(true)} style={styles.shareBtn} activeOpacity={0.85}>
                  <Text style={styles.shareBtnText}>Show all {cxRows.length}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={shareCancellations} style={styles.shareBtn} activeOpacity={0.85}>
                <Text style={styles.shareBtnText}>⤴  Share / export list</Text>
              </TouchableOpacity>
            </>
          )}

          {fraudBlocks.length > 0 && (
            <>
              <Text style={styles.section}>🤖 Blocked booking attempts ({fraudBlocks.length})</Text>
              <Text style={styles.note}>Suspicious/automated submissions caught by the anti-bot checks (honeypot, disposable-email, velocity) — no client or appointment was created.</Text>
              {(fraudShowAll ? fraudBlocks : fraudBlocks.slice(0, LIST_CAP)).map(f => (
                <View key={f.id} style={styles.cxCard}>
                  <View style={styles.cxHead}>
                    <Text style={styles.cxName} numberOfLines={1}>{f.name || '(no name)'}</Text>
                    <View style={[styles.cxBadge, { backgroundColor: '#E5E7EB' }]}>
                      <Text style={[styles.cxBadgeText, { color: '#374151' }]}>{fraudReasonLabel(f.type)}</Text>
                    </View>
                  </View>
                  <Text style={styles.cxLine}>{String(f.createdAt || '').replace('T', ' ').slice(0, 16) || f.date}</Text>
                  {(f.phone || f.email) && <Text style={styles.cxLine}>{[f.phone, f.email].filter(Boolean).join('  ·  ')}</Text>}
                  {!!f.ip && <Text style={styles.cxLineFaint}>IP {f.ip}</Text>}
                  {!!f.userAgent && <Text style={styles.cxLineFaint} numberOfLines={1}>{f.userAgent}</Text>}
                </View>
              ))}
              {!fraudShowAll && fraudBlocks.length > LIST_CAP && (
                <TouchableOpacity onPress={() => setFraudShowAll(true)} style={styles.shareBtn} activeOpacity={0.85}>
                  <Text style={styles.shareBtnText}>Show all {fraudBlocks.length}</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </>
      ))}

      {section === 'ratings' && (loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.green} /></View>
      ) : !ratings || ratings.count === 0 ? (
        <Text style={styles.empty}>No service ratings in this period.</Text>
      ) : (
        <>
          <View style={styles.ratingHero}>
            <Text style={styles.ratingBig}>{ratings.avg.toFixed(2)}</Text>
            <Text style={styles.ratingStars}>{stars(ratings.avg)}</Text>
            <Text style={styles.ratingCount}>{ratings.count} rating{ratings.count === 1 ? '' : 's'}</Text>
          </View>

          <Text style={styles.section2}>Distribution</Text>
          {[5, 4, 3, 2, 1].map(n => {
            const c = ratings.dist[n] || 0;
            const pct = ratings.count ? Math.round((c / ratings.count) * 100) : 0;
            return (
              <View key={n} style={styles.distRow}>
                <Text style={styles.distLabel}>{n}★</Text>
                <View style={styles.distBarBg}><View style={[styles.distBarFill, { width: `${pct}%` }]} /></View>
                <Text style={styles.distCount}>{c}</Text>
              </View>
            );
          })}

          <Text style={styles.section2}>By tech</Text>
          {ratings.byTech.map(t => (
            <View key={t.name} style={styles.rRow}>
              <Text style={styles.rName} numberOfLines={1}>{t.name}</Text>
              <Text style={styles.rStars}>{stars(t.avg)}</Text>
              <Text style={styles.rAvg}>{t.avg.toFixed(2)} · {t.count}</Text>
            </View>
          ))}
          <Text style={styles.rSources}>Sources — email {ratings.sources.email} · sms {ratings.sources.sms} · web {ratings.sources.web}</Text>

          {ratings.low.length > 0 && (
            <>
              <Text style={styles.section2}>Needs attention (under 3★)</Text>
              {ratings.low.map(r => (
                <View key={r.id} style={styles.lowCard}>
                  <Text style={styles.lowHead}>{stars(r.rating)}  ·  {r.techName || '—'}{r.clientName ? `  ·  ${r.clientName}` : ''}</Text>
                  {!!r.comment && <Text style={styles.lowComment}>“{r.comment}”</Text>}
                </View>
              ))}
            </>
          )}
        </>
      ))}
    </ScrollView>
      )}

      <Modal visible={!!visitClient} transparent animationType="slide" onRequestClose={() => setVisitClient(null)}>
        <View style={styles.vBackdrop}>
          <View style={styles.vSheet}>
            <View style={styles.vHead}>
              <Text style={styles.vTitle} numberOfLines={1}>{visitClient?.name || 'Client'}</Text>
              <TouchableOpacity onPress={() => setVisitClient(null)}><Text style={styles.vClose}>✕</Text></TouchableOpacity>
            </View>
            {visits === null ? (
              <ActivityIndicator color={theme.green} style={{ marginVertical: 24 }} />
            ) : visits.length === 0 ? (
              <Text style={styles.empty}>No visit history.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 440 }}>
                {visits.map(v => (
                  <View key={v.id} style={styles.vRow}>
                    <Text style={styles.vDate}>{v.date}{v.startTime ? ` · ${v.startTime}` : ''}{v.status ? `  ·  ${v.status}` : ''}</Text>
                    <Text style={styles.vServices} numberOfLines={2}>{((v.services || []).map(s => s.name).filter(Boolean).join(', ')) || '—'}{v.techName ? `  ·  ${v.techName}` : ''}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function fraudReasonLabel(type) {
  return {
    honeypot:           'Bot',
    disposable_email:   'Temp email',
    velocity_newclient: 'Too many accts',
    velocity_booking:   'Too many bookings',
  }[type] || (type || 'Blocked');
}

function cxLabel(a) {
  if (a.status === 'no_show') return 'No-show';
  if (a.cancelledBy === 'salon')  return 'Cancelled (salon)';
  if (a.cancelledBy === 'client') return 'Cancelled (client)';
  return 'Cancelled';
}

function pctDelta(cur, prev) {
  if (prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

function periodLabel(custom, days, range) {
  if (custom) return `${range.startDate} → ${range.endDate}`;
  return days === 0 ? 'Today' : `Last ${days} days`;
}

// Plain-text report summary for the native Share sheet (text/SMS/email/etc).
function buildSummary({ custom, days, range, techFilter, metrics, tb, ptTips, ptAvg, ptServices, techs, services }) {
  const L = [`Plume Nexus — ${periodLabel(custom, days, range)}`];
  if (techFilter) {
    L.push(`Tech: ${techFilter}`);
    L.push(`Revenue ${money(tb.revenue)} · ${tb.count} appts · avg ${money(ptAvg)} · tips ${money(ptTips)}`);
    if (ptServices.length) {
      L.push('Top services:');
      ptServices.slice(0, 5).forEach(s => L.push(`  • ${s.name} — ${s.count}× ${money(s.revenue)}`));
    }
  } else {
    L.push(`Revenue ${money(metrics.totalRevenue)} · ${metrics.totalAppts} appts · avg ${money(metrics.avgTicket)} · tips ${money(metrics.tipTotal)}`);
    if (techs.length) {
      L.push('Top techs:');
      techs.slice(0, 5).forEach((t, i) => L.push(`  ${i + 1}. ${t.name || '(unassigned)'} — ${money(t.revenue)} (${t.count})`));
    }
    if (services.length) {
      L.push('Top services:');
      services.slice(0, 5).forEach(s => L.push(`  • ${s.name} — ${s.count}× ${money(s.revenue)}`));
    }
  }
  return L.join('\n');
}

function Kpi({ label, value, big, delta, colW }) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const up = delta != null && delta >= 0;
  return (
    <View style={[styles.kpi, big && styles.kpiBig, colW && { width: colW }]}>
      <Text style={[styles.kpiValue, big && styles.kpiValueBig]}>{value}</Text>
      <View style={styles.kpiBottom}>
        <Text style={styles.kpiLabel}>{label}</Text>
        {delta != null && (
          <Text style={[styles.kpiDelta, { color: up ? theme.success : theme.danger }]}>{up ? '▲' : '▼'} {Math.abs(delta)}%</Text>
        )}
      </View>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:     { flex: 1, backgroundColor: t.bg },
  center:   { paddingVertical: 60, alignItems: 'center' },
  empty:    { textAlign: 'center', color: t.textFaint, marginTop: 50, fontSize: 13 },
  sectionTabs:   { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, backgroundColor: t.bg },
  sectionTab:    { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  sectionTabOn:  { backgroundColor: t.green, borderColor: t.green },
  sectionTabText:{ fontSize: 14, fontWeight: '800', color: t.textMuted },
  sectionTabTextOn:{ color: '#fff' },
  ratingHero:  { alignItems: 'center', backgroundColor: t.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: t.border, marginTop: 4 },
  ratingBig:   { fontSize: 44, fontWeight: '800', color: t.text },
  ratingStars: { fontSize: 22, color: '#f5b400', marginTop: 2, letterSpacing: 2 },
  ratingCount: { fontSize: 13, color: t.textMuted, marginTop: 6 },
  section2:    { fontSize: 14, fontWeight: '800', color: t.text, marginTop: 20, marginBottom: 8 },
  distRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  distLabel:   { width: 28, fontSize: 13, fontWeight: '700', color: t.textMuted },
  distBarBg:   { flex: 1, height: 12, borderRadius: 6, backgroundColor: t.surfaceAlt, overflow: 'hidden' },
  distBarFill: { height: 12, borderRadius: 6, backgroundColor: '#f5b400' },
  distCount:   { width: 34, fontSize: 13, fontWeight: '700', color: t.text, textAlign: 'right' },
  rRow:        { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: t.border, gap: 8 },
  rName:       { flex: 1, fontSize: 15, fontWeight: '700', color: t.text },
  rStars:      { fontSize: 14, color: '#f5b400', letterSpacing: 1 },
  rAvg:        { fontSize: 13, fontWeight: '700', color: t.textMuted, width: 64, textAlign: 'right' },
  rSources:    { fontSize: 12.5, color: t.textFaint, marginTop: 10 },
  lowCard:     { backgroundColor: t.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: t.danger },
  lowHead:     { fontSize: 13, fontWeight: '700', color: t.text },
  lowComment:  { fontSize: 13, color: t.textMuted, marginTop: 4, fontStyle: 'italic', lineHeight: 18 },
  card2:       { backgroundColor: t.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: t.border },
  statRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  statLabel:   { fontSize: 14, color: t.textMuted },
  statValue:   { fontSize: 15, fontWeight: '800', color: t.text },
  miniRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: t.surface, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginTop: 6, borderWidth: 1, borderColor: t.border, gap: 8 },
  miniName:    { flex: 1, fontSize: 14, fontWeight: '600', color: t.text },
  miniVal:     { fontSize: 13, fontWeight: '700', color: t.textMuted },
  vBackdrop:   { flex: 1, backgroundColor: t.overlay || 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  vSheet:      { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 28 },
  vHead:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  vTitle:      { fontSize: 18, fontWeight: '800', color: t.text, flex: 1 },
  vClose:      { fontSize: 20, color: t.textMuted, paddingHorizontal: 8 },
  vRow:        { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border },
  vDate:       { fontSize: 13, fontWeight: '700', color: t.text },
  vServices:   { fontSize: 13, color: t.textMuted, marginTop: 2 },
  tabs:     { flexDirection: 'row', gap: 6, marginBottom: 12 },
  tab:      { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  tabOn:    { backgroundColor: t.greenSoft, borderColor: t.green },
  tabText:  { fontSize: 12.5, fontWeight: '700', color: t.textMuted },
  tabTextOn:{ color: t.green },
  tFilter:  { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, maxWidth: 150 },
  tFilterOn:{ backgroundColor: t.green, borderColor: t.green },
  tFilterText:  { fontSize: 12.5, fontWeight: '700', color: t.textMuted },
  tFilterTextOn:{ color: '#fff' },
  rangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12 },
  dateBtn:  { backgroundColor: t.surface, borderWidth: 1, borderColor: t.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  dateText: { fontSize: 14, fontWeight: '700', color: t.text },
  dash:     { color: t.textMuted, fontSize: 15 },
  chartCard:{ backgroundColor: t.surface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: t.border },
  chartAxis:{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontSize: 10.5, color: t.textFaint },
  kpis:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  kpi:      { width: '48%', backgroundColor: t.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: t.border },
  kpiBig:   { backgroundColor: t.greenSoft, borderColor: t.green },
  kpiValue: { fontSize: 20, fontWeight: '800', color: t.text },
  kpiValueBig:{ fontSize: 26, color: t.green },
  kpiLabel: { fontSize: 11, color: t.textMuted, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.3 },
  kpiBottom:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 },
  kpiDelta: { fontSize: 11, fontWeight: '800' },
  deltaNote:{ fontSize: 11, color: t.textFaint, marginTop: 2, marginBottom: 4 },
  section:  { fontSize: 14, fontWeight: '800', color: t.text, marginTop: 22, marginBottom: 8 },
  row:      { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: t.border, gap: 10 },
  rank:     { fontSize: 14, fontWeight: '800', color: t.textFaint, width: 18, textAlign: 'center' },
  name:     { fontSize: 14.5, fontWeight: '700', color: t.text },
  sub:      { fontSize: 12, color: t.textMuted, marginTop: 2 },
  amount:   { fontSize: 15, fontWeight: '800', color: t.green },
  note:     { fontSize: 12, color: t.textFaint, marginTop: 16, lineHeight: 17 },
  shareBtn: { marginTop: 22, borderRadius: 12, paddingVertical: 13, alignItems: 'center', backgroundColor: t.greenSoft, borderWidth: 1, borderColor: t.green },
  shareBtnText: { color: t.green, fontWeight: '800', fontSize: 14 },
  cxCard:    { backgroundColor: t.surface, borderRadius: 12, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: t.border },
  cxHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  cxName:    { flex: 1, fontSize: 15, fontWeight: '800', color: t.text },
  cxBadge:   { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  cxBadgeText:{ fontSize: 11, fontWeight: '700' },
  cxLine:    { fontSize: 12.5, color: t.textMuted, marginTop: 2 },
  cxLineFaint:{ fontSize: 11.5, color: t.textFaint, marginTop: 2 },
});
