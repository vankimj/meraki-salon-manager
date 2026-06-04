import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Dimensions, Platform } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import DateTimePicker from '@react-native-community/datetimepicker';
import { fetchReceiptsByRange, fetchAppointmentsByRange } from '../../lib/firestore';
import { buildTransactions, computeMetrics, computeCancellations } from '../../lib/metrics';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';

const GREEN = '#2D7A5F', BLUE = '#3D95CE';
const PERIODS = [{ days: 0, label: 'Today' }, { days: 7, label: '7d' }, { days: 30, label: '30d' }, { days: 90, label: '90d' }];
const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const isoDay = (d) => d.toISOString().slice(0, 10);

function presetRange(days) {
  const end = new Date(), start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: isoDay(start), endDate: isoDay(end) };
}

// Revenue-by-day bar chart (react-native-svg — already a dep, no native add).
function RevenueChart({ byDay }) {
  const entries = Object.entries(byDay || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map(e => e[1]), 1);
  const W = Dimensions.get('window').width - 60;
  const H = 120, gap = entries.length > 40 ? 1 : 2;
  const bw = Math.max(2, (W - gap * (entries.length - 1)) / entries.length);
  return (
    <View style={styles.chartCard}>
      <Svg width={W} height={H}>
        {entries.map(([date, rev], i) => {
          const h = Math.max(1, (rev / max) * (H - 6));
          return <Rect key={date} x={i * (bw + gap)} y={H - h} width={bw} height={h} rx={1} fill={GREEN} />;
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
  useTrashHeader(navigation, ['receipts'], isAdmin);
  const [days, setDays]       = useState(30);
  const [custom, setCustom]   = useState(false);
  const [cStart, setCStart]   = useState(presetRange(30).startDate);
  const [cEnd, setCEnd]       = useState(presetRange(0).endDate);
  const [picker, setPicker]   = useState(null); // 'start' | 'end' | null
  const [metrics, setMetrics] = useState(null);
  const [cancels, setCancels] = useState(null);
  const [prev, setPrev]       = useState(null);
  const [loading, setLoading] = useState(true);

  const range = custom ? { startDate: cStart, endDate: cEnd } : presetRange(days);

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

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={GREEN} />}>
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
        <View style={styles.center}><ActivityIndicator color={GREEN} /></View>
      ) : !metrics || metrics.totalAppts === 0 ? (
        <Text style={styles.empty}>No completed transactions in this period.</Text>
      ) : (
        <>
          <View style={styles.kpis}>
            <Kpi label="Revenue" value={money(metrics.totalRevenue)} big delta={pctDelta(metrics.totalRevenue, prev?.totalRevenue)} />
            <Kpi label="Appts" value={metrics.totalAppts} delta={pctDelta(metrics.totalAppts, prev?.totalAppts)} />
            <Kpi label="Avg ticket" value={money(metrics.avgTicket)} delta={pctDelta(metrics.avgTicket, prev?.avgTicket)} />
            <Kpi label="Tips" value={money(metrics.tipTotal)} delta={pctDelta(metrics.tipTotal, prev?.tipTotal)} />
          </View>
          <Text style={styles.deltaNote}>▲▼ vs the previous {custom ? 'period' : (days === 0 ? 'day' : `${days} days`)}</Text>

          <Text style={styles.section}>Revenue per day</Text>
          <RevenueChart byDay={metrics.byDay} />

          {!!cancels && (cancels.cancelCount > 0 || cancels.lostRevenue > 0) && (
            <>
              <Text style={styles.section}>Cancellations</Text>
              <View style={styles.kpis}>
                <Kpi label="Cancelled" value={cancels.cancelCount || 0} />
                <Kpi label="Cancel rate" value={`${Math.round((cancels.cancelRate || 0) * 100)}%`} />
                <Kpi label="Lost revenue" value={money(cancels.lostRevenue)} />
                <Kpi label="No-shows" value={cancels.noShowCount || 0} />
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
          <Text style={styles.note}>AI assistant + PDF/1099 export are on the web app.</Text>
        </>
      )}
    </ScrollView>
  );
}

function pctDelta(cur, prev) {
  if (prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

function Kpi({ label, value, big, delta }) {
  const up = delta != null && delta >= 0;
  return (
    <View style={[styles.kpi, big && styles.kpiBig]}>
      <Text style={[styles.kpiValue, big && styles.kpiValueBig]}>{value}</Text>
      <View style={styles.kpiBottom}>
        <Text style={styles.kpiLabel}>{label}</Text>
        {delta != null && (
          <Text style={[styles.kpiDelta, { color: up ? '#16a34a' : '#c0392b' }]}>{up ? '▲' : '▼'} {Math.abs(delta)}%</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:     { flex: 1, backgroundColor: '#f5f7fa' },
  center:   { paddingVertical: 60, alignItems: 'center' },
  empty:    { textAlign: 'center', color: '#999', marginTop: 50, fontSize: 13 },
  tabs:     { flexDirection: 'row', gap: 6, marginBottom: 12 },
  tab:      { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#ececec' },
  tabOn:    { backgroundColor: '#eef5f2', borderColor: GREEN },
  tabText:  { fontSize: 12.5, fontWeight: '700', color: '#888' },
  tabTextOn:{ color: GREEN },
  rangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12 },
  dateBtn:  { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d8d8d8', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  dateText: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  dash:     { color: '#888', fontSize: 15 },
  chartCard:{ backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#ececec' },
  chartAxis:{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontSize: 10.5, color: '#aaa' },
  kpis:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  kpi:      { width: '48%', backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#ececec' },
  kpiBig:   { backgroundColor: '#eef5f2', borderColor: GREEN },
  kpiValue: { fontSize: 20, fontWeight: '800', color: '#1a1a1a' },
  kpiValueBig:{ fontSize: 26, color: GREEN },
  kpiLabel: { fontSize: 11, color: '#888', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.3 },
  kpiBottom:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 },
  kpiDelta: { fontSize: 11, fontWeight: '800' },
  deltaNote:{ fontSize: 11, color: '#aaa', marginTop: 2, marginBottom: 4 },
  section:  { fontSize: 14, fontWeight: '800', color: '#1a1a1a', marginTop: 22, marginBottom: 8 },
  row:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: '#ececec', gap: 10 },
  rank:     { fontSize: 14, fontWeight: '800', color: '#bbb', width: 18, textAlign: 'center' },
  name:     { fontSize: 14.5, fontWeight: '700', color: '#1a1a1a' },
  sub:      { fontSize: 12, color: '#8a8a8a', marginTop: 2 },
  amount:   { fontSize: 15, fontWeight: '800', color: GREEN },
  note:     { fontSize: 12, color: '#aaa', marginTop: 16, lineHeight: 17 },
});
