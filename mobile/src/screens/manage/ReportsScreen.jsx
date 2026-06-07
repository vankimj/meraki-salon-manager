import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Dimensions, Platform, Share } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import DateTimePicker from '@react-native-community/datetimepicker';
import { fetchReceiptsByRange, fetchAppointmentsByRange } from '../../lib/firestore';
import { buildTransactions, computeMetrics, computeCancellations } from '../../lib/metrics';
import AskAIChat from '../../components/AskAIChat';
import useTenantAccess from '../../hooks/useTenantAccess';
import useResponsive from '../../hooks/useResponsive';
import useTrashHeader from '../../hooks/useTrashHeader';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const PERIODS = [{ days: 0, label: 'Today' }, { days: 7, label: '7d' }, { days: 30, label: '30d' }, { days: 90, label: '90d' }];
const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const isoDay = (d) => d.toISOString().slice(0, 10);

function presetRange(days) {
  const end = new Date(), start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: isoDay(start), endDate: isoDay(end) };
}

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
  const [section, setSection] = useState('overview');  // overview | ask

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
      const [receipts, appts, pReceipts, pAppts] = await Promise.all([
        fetchReceiptsByRange(startDate, endDate).catch(() => []),
        fetchAppointmentsByRange(startDate, endDate).catch(() => []),
        fetchReceiptsByRange(pIso(prevStart), pIso(prevEnd)).catch(() => []),
        fetchAppointmentsByRange(pIso(prevStart), pIso(prevEnd)).catch(() => []),
      ]);
      setMetrics(computeMetrics(buildTransactions(receipts, appts)));
      setCancels(computeCancellations(appts, receipts));
      setPrev(computeMetrics(buildTransactions(pReceipts, pAppts)));
    } catch { setMetrics(null); setCancels(null); setPrev(null); }
    finally { setLoading(false); }
  }, [custom, days, cStart, cEnd]);
  useEffect(() => { load(); }, [load]);

  const techs = metrics ? Object.entries(metrics.byTech).map(([name, t]) => ({ name, ...t })).sort((a, b) => b.revenue - a.revenue) : [];
  const services = metrics ? Object.entries(metrics.byService).map(([name, s]) => ({ name, ...s })).sort((a, b) => b.revenue - a.revenue).slice(0, 8) : [];

  // Per-tech drill-down — driven off the already-split byTech / tipsByTech
  // aggregates so multi-tech bookings attribute correctly (no re-query).
  const tb        = techFilter ? (metrics?.byTech?.[techFilter] || { revenue: 0, count: 0, services: {}, clientCount: 0 }) : null;
  const tbPrev    = techFilter ? (prev?.byTech?.[techFilter] || null) : null;
  const ptTips    = techFilter ? (metrics?.tipsByTech?.[techFilter] || 0) : 0;
  const ptTipsPrev= techFilter ? (prev?.tipsByTech?.[techFilter] ?? null) : null;
  const ptAvg     = tb && tb.count ? tb.revenue / tb.count : 0;
  const ptAvgPrev = tbPrev && tbPrev.count ? tbPrev.revenue / tbPrev.count : null;
  const ptServices= tb ? Object.entries(tb.services).map(([name, s]) => ({ name, ...s })).sort((a, b) => b.revenue - a.revenue).slice(0, 12) : [];
  const ptCancel  = techFilter ? (cancels?.byTech?.[techFilter] || null) : null;

  async function shareSummary() {
    try {
      await Share.share({ message: buildSummary({ custom, days, range, techFilter, metrics, tb, ptTips, ptAvg, ptServices, techs, services }) });
    } catch {}
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={styles.sectionTabs}>
        {[['overview', 'Overview'], ['ask', 'Ask AI']].map(([id, label]) => (
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

      {loading ? (
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
          <Text style={styles.note}>Tax / 1099 PDF export is on the web app.</Text>
        </>
      )}
    </ScrollView>
      )}
    </View>
  );
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
});
