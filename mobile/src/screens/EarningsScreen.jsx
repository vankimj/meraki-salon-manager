import { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { fetchReceiptsByRange, fetchAppointmentsByRange } from '../lib/firestore';
import useCurrentEmployee from '../hooks/useCurrentEmployee';
import Icon from '../components/Icon';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfWeekISO(date) {
  const d = new Date(date + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString('en-CA');
}
function startOfMonthISO(date) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(1);
  return d.toLocaleDateString('en-CA');
}
function fmtMoney(n) {
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtMoneyExact(n) {
  return `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDateShort(s) {
  if (!s) return '';
  const d = new Date(s + (s.length === 10 ? 'T12:00:00' : ''));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Mirror of computeTechSlice from src/modules/earnings/TechEarnings.jsx —
// honors techSplit when present so multi-tech checkouts attribute correctly.
function computeTechSlice(receipts, appointments, techName) {
  let revenue = 0;
  let tips    = 0;
  let serviceCount = 0;
  const clientIds = new Set();
  const tipEntries = [];          // { date, amount, clientName }
  const services   = {};          // { name: { count, revenue } }
  const byDay      = {};          // { date: take-home (revenue + tips) }

  receipts.forEach(r => {
    const p = r.payment || {};
    const isNeg = r.transactionType === 'refund' || r.transactionType === 'void' || r.transactionType === 'cancellation';
    const sign  = isNeg ? -1 : 1;
    let rTake = 0;                 // this receipt's take-home for this tech
    if (p.techSplit && p.techSplit.length) {
      p.techSplit.forEach(s => {
        if (s.techName !== techName) return;
        const rev = sign * (Number(s.revenue) || 0);
        const tip = sign * (Number(s.tip) || 0);
        revenue += rev; tips += tip; rTake += rev + tip;
        if (s.tip && !isNeg) tipEntries.push({ date: r.date, amount: Number(s.tip), clientName: r.clientName || 'Walk-in' });
      });
    } else if (r.techName === techName) {
      const rev = sign * (Number(p.subtotal) || ((r.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0)));
      const tip = sign * (Number(p.tip) || 0);
      revenue += rev; tips += tip; rTake += rev + tip;
      if (p.tip && !isNeg) tipEntries.push({ date: r.date, amount: Number(p.tip), clientName: r.clientName || 'Walk-in' });
    }
    if (rTake !== 0 && r.date) byDay[r.date] = (byDay[r.date] || 0) + rTake;
    if (r.clientId && !isNeg && (r.techName === techName || (p.techSplit || []).some(s => s.techName === techName))) {
      clientIds.add(r.clientId);
    }
  });

  appointments.forEach(a => {
    if (a.status !== 'done' && a.status !== 'completed') return;
    if ((a.techName || '') !== techName) return;
    (a.services || []).forEach(sv => {
      const name = sv.name || 'Service';
      if (!services[name]) services[name] = { count: 0, revenue: 0 };
      services[name].count   += 1;
      services[name].revenue += Number(sv.price) || 0;
      serviceCount += 1;
    });
    if ((a.services || []).length === 0) serviceCount += 1;
  });

  // Sort tip entries newest first; cap at most 12 in the UI.
  tipEntries.sort((a, b) => `${b.date}`.localeCompare(`${a.date}`));

  // Sort services by count desc; top 6 in UI.
  const serviceList = Object.entries(services)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count);

  return { revenue, tips, serviceCount, clientCount: clientIds.size, tipEntries, serviceList, byDay };
}

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'week',  label: 'This week' },
  { id: 'month', label: 'This month' },
];

export default function EarningsScreen() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { techName, loading: empLoading } = useCurrentEmployee();
  const [range, setRange] = useState('week');
  const [data,  setData]  = useState({ revenue: 0, tips: 0, serviceCount: 0, clientCount: 0, tipEntries: [], serviceList: [], byDay: {} });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { startDate, endDate } = useMemo(() => {
    const today = todayStr();
    if (range === 'today') return { startDate: today, endDate: today };
    if (range === 'week')  return { startDate: startOfWeekISO(today), endDate: today };
    return { startDate: startOfMonthISO(today), endDate: today };
  }, [range]);

  async function load() {
    if (!techName) return;
    setLoading(true);
    try {
      const [receipts, appts] = await Promise.all([
        fetchReceiptsByRange(startDate, endDate),
        fetchAppointmentsByRange(startDate, endDate),
      ]);
      setData(computeTechSlice(receipts, appts, techName));
    } catch (e) {
      console.warn('[earnings] load failed:', e?.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, [range, techName]);

  if (empLoading) {
    return <ActivityIndicator style={{ marginTop: 60 }} color={theme.blue} />;
  }

  if (!techName) {
    return (
      <View style={styles.emptyState}>
        <Icon name="dollar" size={56} color={theme.textFaint} strokeWidth={1.5} />
        <Text style={[styles.emptyTitle, { marginTop: 14 }]}>No employee record</Text>
        <Text style={styles.emptyBody}>
          Your account isn't linked to an employee profile yet. Ask your salon owner to add you in Employees.
        </Text>
      </View>
    );
  }

  const total = data.revenue + data.tips;

  // Per-day take-home across the selected range (skip 'today' — one bar isn't a
  // trend). Missing days fill to 0 so the spacing reflects real calendar gaps.
  const trend = useMemo(() => {
    if (range === 'today') return [];
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const cur = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    const out = [];
    let guard = 0;
    while (cur <= end && guard++ < 40) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      out.push({ key: iso, value: Math.max(0, data.byDay?.[iso] || 0), dow: cur.getDay(), dom: cur.getDate() });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [range, startDate, endDate, data.byDay]);
  const trendMax = Math.max(...trend.map(d => d.value), 1);
  const trendBest = trend.reduce((m, d) => Math.max(m, d.value), 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }} tintColor={theme.blue} />
      }
    >
      {/* Range selector */}
      <View style={styles.rangeRow}>
        {RANGES.map(r => {
          const active = range === r.id;
          return (
            <TouchableOpacity
              key={r.id}
              style={[styles.rangeBtn, active && styles.rangeBtnActive]}
              onPress={() => setRange(r.id)}
            >
              <Text style={[styles.rangeBtnText, active && styles.rangeBtnTextActive]}>{r.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Hero — total take-home */}
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>YOUR TAKE-HOME</Text>
        <Text style={styles.heroAmount}>{fmtMoneyExact(total)}</Text>
        <Text style={styles.heroSub}>
          {RANGES.find(r => r.id === range)?.label} · {techName}
        </Text>
      </View>

      {loading ? <ActivityIndicator style={{ marginVertical: 30 }} color={theme.blue} /> : (
        <>
          {/* Stat grid */}
          <View style={styles.statGrid}>
            <Stat label="Revenue"  value={fmtMoney(data.revenue)}     accent="#2D7A5F" />
            <Stat label="Tips"     value={fmtMoney(data.tips)}        accent="#3D9E8A" />
            <Stat label="Services" value={String(data.serviceCount)}  accent="#3D95CE" />
            <Stat label="Clients"  value={String(data.clientCount)}   accent="#5b3b8c" />
          </View>

          {trend.length > 1 && trendBest > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.sectionLabel}>Daily take-home</Text>
              <View style={styles.card}>
                <View style={styles.chartRow}>
                  {trend.map(d => {
                    const h = d.value > 0 ? Math.max(4, Math.round((d.value / trendMax) * 92)) : 2;
                    const isBest = d.value === trendBest && d.value > 0;
                    const label = range === 'week' ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.dow] : (d.dom % 5 === 0 ? String(d.dom) : '');
                    return (
                      <View key={d.key} style={styles.chartCol}>
                        <View style={[styles.bar, { height: h, backgroundColor: d.value > 0 ? (isBest ? theme.teal : theme.green) : theme.border }]} />
                        <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
                      </View>
                    );
                  })}
                </View>
                <Text style={styles.chartCaption}>Best day {fmtMoney(trendBest)}</Text>
              </View>
            </View>
          )}

          {data.serviceCount === 0 && data.tips === 0 && (
            <View style={styles.welcomeCard}>
              <Icon name="sparkles" size={36} color={theme.teal} strokeWidth={2} />
              <Text style={[styles.welcomeTitle, { marginTop: 10 }]}>You're all set up</Text>
              <Text style={styles.welcomeBody}>
                As soon as appointments wrap up and tips come in, your take-home and stats will populate here.
              </Text>
            </View>
          )}

          {/* Top services */}
          {data.serviceList.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.sectionLabel}>Top services</Text>
              <View style={styles.card}>
                {data.serviceList.slice(0, 6).map((s, i) => (
                  <View key={s.name} style={[styles.serviceRow, i > 0 && styles.serviceRowDivider]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.serviceName} numberOfLines={1}>{s.name}</Text>
                      <Text style={styles.serviceCount}>{s.count}× this {range === 'today' ? 'day' : range === 'week' ? 'week' : 'month'}</Text>
                    </View>
                    <Text style={styles.serviceRevenue}>{fmtMoney(s.revenue)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Recent tips */}
          {data.tipEntries.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.sectionLabel}>Recent tips</Text>
              <View style={styles.card}>
                {data.tipEntries.slice(0, 12).map((t, i) => (
                  <View key={`${t.date}-${i}`} style={[styles.tipRow, i > 0 && styles.tipRowDivider]}>
                    <Text style={styles.tipDate}>{fmtDateShort(t.date)}</Text>
                    <Text style={styles.tipClient} numberOfLines={1}>{t.clientName}</Text>
                    <Text style={styles.tipAmount}>{fmtMoneyExact(t.amount)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, accent }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.statCard, { borderLeftColor: accent }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  content:   { padding: 16, paddingBottom: 32 },
  rangeRow:  { flexDirection: 'row', backgroundColor: t.surface, borderRadius: 10, padding: 4, marginBottom: 14 },
  rangeBtn:  { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 8 },
  rangeBtnActive: { backgroundColor: t.green },
  rangeBtnText: { fontSize: 13, color: t.textMuted, fontWeight: '500' },
  rangeBtnTextActive: { color: '#fff', fontWeight: '700' },

  hero:      { backgroundColor: '#0f1923', borderRadius: 16, padding: 22, marginBottom: 14, alignItems: 'center' },
  heroLabel: { fontSize: 11, color: 'rgba(255,255,255,.5)', letterSpacing: 1.2, fontWeight: '700' },
  heroAmount:{ fontSize: 42, fontWeight: '800', color: '#fff', marginTop: 6, letterSpacing: -1 },
  heroSub:   { fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 4 },

  statGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard:  { backgroundColor: t.surface, borderRadius: 12, padding: 14, flexBasis: '47%', flexGrow: 1, borderLeftWidth: 3 },
  statLabel: { fontSize: 11, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600' },
  statValue: { fontSize: 22, fontWeight: '700', color: t.text, marginTop: 4 },

  sectionLabel: { fontSize: 11, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', marginBottom: 8, marginLeft: 4 },
  card:         { backgroundColor: t.surface, borderRadius: 12, padding: 4 },
  chartRow:     { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 108, paddingHorizontal: 8, paddingTop: 8, gap: 2 },
  chartCol:     { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar:          { width: '70%', maxWidth: 22, borderRadius: 3 },
  barLabel:     { fontSize: 9, color: t.textFaint, marginTop: 4 },
  chartCaption: { fontSize: 11, color: t.textMuted, textAlign: 'center', paddingVertical: 8 },

  serviceRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, gap: 12 },
  serviceRowDivider: { borderTopWidth: 1, borderTopColor: t.border },
  serviceName:       { fontSize: 14, fontWeight: '600', color: t.text },
  serviceCount:      { fontSize: 11, color: t.textMuted, marginTop: 2 },
  serviceRevenue:    { fontSize: 14, fontWeight: '700', color: t.green },

  tipRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12, gap: 10 },
  tipRowDivider: { borderTopWidth: 1, borderTopColor: t.border },
  tipDate:       { fontSize: 11, color: t.textMuted, width: 56 },
  tipClient:     { flex: 1, fontSize: 13, color: t.text },
  tipAmount:     { fontSize: 13, fontWeight: '700', color: t.teal },

  welcomeCard:  { backgroundColor: t.surface, borderRadius: 14, padding: 20, marginTop: 14, alignItems: 'center' },
  welcomeIcon:  { fontSize: 36, marginBottom: 8 },
  welcomeTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 6 },
  welcomeBody:  { fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 19 },

  emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon:  { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: t.text, marginBottom: 6 },
  emptyBody:  { fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 19 },
});
