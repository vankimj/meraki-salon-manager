import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchReceiptsByRange, fetchAppointmentsByRange } from '../../lib/firestore';
import { buildTransactions, computeMetrics } from '../../lib/metrics';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';

const GREEN = '#2D7A5F';
const PERIODS = [{ days: 0, label: 'Today' }, { days: 7, label: '7d' }, { days: 30, label: '30d' }, { days: 90, label: '90d' }];
const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function rangeFor(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}

// Read-only revenue dashboard. Reuses the web's pure metrics (computeMetrics
// / buildTransactions, copied verbatim to mobile/src/lib/metrics.js). The AI
// assistant + PDF export stay web-only for now.
export default function ReportsScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['receipts'], isAdmin);
  const [days, setDays]       = useState(30);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { startDate, endDate } = rangeFor(days);
      const [receipts, appts] = await Promise.all([
        fetchReceiptsByRange(startDate, endDate).catch(() => []),
        fetchAppointmentsByRange(startDate, endDate).catch(() => []),
      ]);
      setMetrics(computeMetrics(buildTransactions(receipts, appts)));
    } catch { setMetrics(null); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const techs = metrics ? Object.entries(metrics.byTech).map(([name, t]) => ({ name, ...t })).sort((a, b) => b.revenue - a.revenue) : [];
  const services = metrics ? Object.entries(metrics.byService).map(([name, s]) => ({ name, ...s })).sort((a, b) => b.revenue - a.revenue).slice(0, 8) : [];

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={GREEN} />}>
      <View style={styles.tabs}>
        {PERIODS.map(p => (
          <TouchableOpacity key={p.label} onPress={() => setDays(p.days)} style={[styles.tab, days === p.days && styles.tabOn]}>
            <Text style={[styles.tabText, days === p.days && styles.tabTextOn]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={GREEN} /></View>
      ) : !metrics || metrics.totalAppts === 0 ? (
        <Text style={styles.empty}>No completed transactions in this period.</Text>
      ) : (
        <>
          <View style={styles.kpis}>
            <Kpi label="Revenue" value={money(metrics.totalRevenue)} big />
            <Kpi label="Appts" value={metrics.totalAppts} />
            <Kpi label="Avg ticket" value={money(metrics.avgTicket)} />
            <Kpi label="Tips" value={money(metrics.tipTotal)} />
          </View>

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
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{s.name}</Text>
                <Text style={styles.sub}>{s.count}×</Text>
              </View>
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
          <Text style={styles.note}>Full Reports (filters, AI assistant, PDF/1099 export) are on the web app.</Text>
        </>
      )}
    </ScrollView>
  );
}

function Kpi({ label, value, big }) {
  return (
    <View style={[styles.kpi, big && styles.kpiBig]}>
      <Text style={[styles.kpiValue, big && styles.kpiValueBig]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:     { flex: 1, backgroundColor: '#f5f7fa' },
  center:   { paddingVertical: 60, alignItems: 'center' },
  empty:    { textAlign: 'center', color: '#999', marginTop: 50, fontSize: 13 },
  tabs:     { flexDirection: 'row', gap: 6, marginBottom: 14 },
  tab:      { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#ececec' },
  tabOn:    { backgroundColor: '#eef5f2', borderColor: GREEN },
  tabText:  { fontSize: 13, fontWeight: '700', color: '#888' },
  tabTextOn:{ color: GREEN },
  kpis:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  kpi:      { width: '48%', backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#ececec' },
  kpiBig:   { backgroundColor: '#eef5f2', borderColor: GREEN },
  kpiValue: { fontSize: 20, fontWeight: '800', color: '#1a1a1a' },
  kpiValueBig:{ fontSize: 26, color: GREEN },
  kpiLabel: { fontSize: 11, color: '#888', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.3 },
  section:  { fontSize: 14, fontWeight: '800', color: '#1a1a1a', marginTop: 22, marginBottom: 8 },
  row:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: '#ececec', gap: 10 },
  rank:     { fontSize: 14, fontWeight: '800', color: '#bbb', width: 18, textAlign: 'center' },
  name:     { fontSize: 14.5, fontWeight: '700', color: '#1a1a1a' },
  sub:      { fontSize: 12, color: '#8a8a8a', marginTop: 2 },
  amount:   { fontSize: 15, fontWeight: '800', color: GREEN },
  note:     { fontSize: 12, color: '#aaa', marginTop: 16, lineHeight: 17 },
});
