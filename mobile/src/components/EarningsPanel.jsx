import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchReceiptsByRange, fetchAppointmentsByRange } from '../lib/firestore';
import Icon from './Icon';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

const HIDE_KEY = 'pn_earnings_hidden';

// Earnings body extracted from the old Earnings tab so it can live inside the
// Dashboard. Self-contained (fetches its own data) but takes `techName` from the
// parent so the employee record is only looked up once. No ScrollView of its own.

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfWeekISO(date) {
  const d = new Date(date + 'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toLocaleDateString('en-CA');
}
function startOfMonthISO(date) {
  const d = new Date(date + 'T12:00:00'); d.setDate(1);
  return d.toLocaleDateString('en-CA');
}
const fmtMoney = (n) => `$${Math.round(n).toLocaleString()}`;
const fmtMoneyExact = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDateShort = (s) => { if (!s) return ''; const d = new Date(s + (s.length === 10 ? 'T12:00:00' : '')); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

// Honors techSplit when present so multi-tech checkouts attribute correctly.
function computeTechSlice(receipts, appointments, techName) {
  let revenue = 0, tips = 0, serviceCount = 0;
  const clientIds = new Set(), tipEntries = [], redoEntries = [], services = {}, byDay = {};
  receipts.forEach(r => {
    const p = r.payment || {};
    const refundList = Array.isArray(r.refunds) ? r.refunds : (r.refund ? [r.refund] : []);
    const structured = refundList.length > 0;
    const legacyNeg = !structured && (r.transactionType === 'refund' || r.transactionType === 'void' || r.transactionType === 'cancellation');
    const sign = legacyNeg ? -1 : 1;
    let rTake = 0, myRev = 0, totalRev = 0;
    if (p.techSplit && p.techSplit.length) {
      p.techSplit.forEach(s => { totalRev += Number(s.revenue) || 0; });
      p.techSplit.forEach(s => {
        if (s.techName !== techName) return;
        myRev += Number(s.revenue) || 0;
        const rev = sign * (Number(s.revenue) || 0); const tip = sign * (Number(s.tip) || 0);
        revenue += rev; tips += tip; rTake += rev + tip;
        if (s.tip && !legacyNeg) tipEntries.push({ date: r.date, amount: Number(s.tip), clientName: r.clientName || 'Walk-in' });
      });
    } else if (r.techName === techName) {
      const baseRev = Number(p.subtotal) || ((r.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0));
      myRev = baseRev; totalRev = baseRev;
      const rev = sign * baseRev; const tip = sign * (Number(p.tip) || 0);
      revenue += rev; tips += tip; rTake += rev + tip;
      if (p.tip && !legacyNeg) tipEntries.push({ date: r.date, amount: Number(p.tip), clientName: r.clientName || 'Walk-in' });
    }
    if (structured && myRev > 0 && totalRev > 0) {
      refundList.forEach(rf => {
        const treat = (rf.commissionByTech && rf.commissionByTech[techName]) || 'withhold';
        if (treat === 'withhold') { const dock = (myRev / totalRev) * (Number(rf.amount) || 0); revenue -= dock; rTake -= dock; }
      });
    }
    // Redo transfer: the original tech loses the redone service's revenue; the
    // redo tech gains it. Captured as audit lines so the tech sees why pay moved.
    (Array.isArray(r.redos) ? r.redos : []).forEach(rd => {
      (rd.services || []).forEach(it => {
        if (it.fromTech === techName) { const d = Number(it.amount) || 0; revenue -= d; rTake -= d; redoEntries.push({ date: rd.redoneAt || r.date, dir: 'out', amount: d, label: it.name, other: rd.toTech, reason: rd.reason, client: r.clientName || 'Walk-in' }); }
      });
      if (rd.toTech === techName) { const d = Number(rd.amount) || 0; revenue += d; rTake += d; redoEntries.push({ date: rd.redoneAt || r.date, dir: 'in', amount: d, label: (rd.services || []).map(s => s.name).join(', '), other: [...new Set((rd.services || []).map(s => s.fromTech).filter(Boolean))].join(', '), reason: rd.reason, client: r.clientName || 'Walk-in' }); }
    });
    if (rTake !== 0 && r.date) byDay[r.date] = (byDay[r.date] || 0) + rTake;
    if (r.clientId && !legacyNeg && (r.techName === techName || (p.techSplit || []).some(s => s.techName === techName))) clientIds.add(r.clientId);
  });
  appointments.forEach(a => {
    if (a.status !== 'done' && a.status !== 'completed') return;
    if ((a.techName || '') !== techName) return;
    (a.services || []).forEach(sv => {
      const name = sv.name || 'Service';
      if (!services[name]) services[name] = { count: 0, revenue: 0 };
      services[name].count += 1; services[name].revenue += Number(sv.price) || 0; serviceCount += 1;
    });
    if ((a.services || []).length === 0) serviceCount += 1;
  });
  tipEntries.sort((a, b) => `${b.date}`.localeCompare(`${a.date}`));
  redoEntries.sort((a, b) => `${b.date}`.localeCompare(`${a.date}`));
  const serviceList = Object.entries(services).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count);
  return { revenue, tips, serviceCount, clientCount: clientIds.size, tipEntries, redoEntries, serviceList, byDay };
}

const RANGES = [{ id: 'today', label: 'Today' }, { id: 'week', label: 'This week' }, { id: 'biweekly', label: '2 weeks' }, { id: 'month', label: 'This month' }];

export default function EarningsPanel({ techName }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [range, setRange] = useState('week');
  const [data, setData] = useState({ revenue: 0, tips: 0, serviceCount: 0, clientCount: 0, tipEntries: [], redoEntries: [], serviceList: [], byDay: {} });
  const [loading, setLoading] = useState(false);
  // Earnings masked by default (shoulder-surf privacy); tap the eye to reveal.
  // Preference persists on the device.
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem(HIDE_KEY).then(v => { if (v === '0') setHidden(false); }).catch(() => {});
  }, []);
  function toggleHidden() {
    setHidden(h => { const next = !h; AsyncStorage.setItem(HIDE_KEY, next ? '1' : '0').catch(() => {}); return next; });
  }
  const show = (s) => (hidden ? '••••' : s);

  const { startDate, endDate } = useMemo(() => {
    const today = todayStr();
    if (range === 'today') return { startDate: today, endDate: today };
    if (range === 'week') return { startDate: startOfWeekISO(today), endDate: today };
    if (range === 'biweekly') {
      const d = new Date(today + 'T12:00:00');
      d.setDate(d.getDate() - 13); // inclusive 14-day window
      return { startDate: d.toLocaleDateString('en-CA'), endDate: today };
    }
    return { startDate: startOfMonthISO(today), endDate: today };
  }, [range]);

  useEffect(() => {
    let alive = true;
    if (!techName) return;
    (async () => {
      setLoading(true);
      try {
        const [receipts, appts] = await Promise.all([fetchReceiptsByRange(startDate, endDate), fetchAppointmentsByRange(startDate, endDate)]);
        if (alive) setData(computeTechSlice(receipts, appts, techName));
      } catch (e) { console.warn('[earnings] load failed:', e?.message); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [range, techName, startDate, endDate]);

  const trend = useMemo(() => {
    if (range === 'today') return [];
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const cur = new Date(sy, sm - 1, sd), end = new Date(ey, em - 1, ed), out = [];
    let guard = 0;
    while (cur <= end && guard++ < 40) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      out.push({ key: iso, value: Math.max(0, data.byDay?.[iso] || 0), dow: cur.getDay(), dom: cur.getDate() });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [range, startDate, endDate, data.byDay]);

  if (!techName) return null;
  const total = data.revenue + data.tips;
  const trendMax = Math.max(...trend.map(d => d.value), 1);
  const trendBest = trend.reduce((m, d) => Math.max(m, d.value), 0);

  return (
    <View>
      <View style={styles.rangeRow}>
        {RANGES.map(r => {
          const active = range === r.id;
          return (
            <TouchableOpacity key={r.id} style={[styles.rangeBtn, active && styles.rangeBtnActive]} onPress={() => setRange(r.id)}>
              <Text style={[styles.rangeBtnText, active && styles.rangeBtnTextActive]}>{r.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.hero}>
        <TouchableOpacity onPress={toggleHidden} style={styles.eyeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.eyeIcon}>{hidden ? '👁' : '🙈'}</Text>
        </TouchableOpacity>
        <Text style={styles.heroLabel}>YOUR TAKE-HOME</Text>
        <Text style={styles.heroAmount}>{show(fmtMoneyExact(total))}</Text>
        <Text style={styles.heroSub}>{RANGES.find(r => r.id === range)?.label} · {techName}{hidden ? ' · tap 👁 to show' : ''}</Text>
      </View>

      {loading ? <ActivityIndicator style={{ marginVertical: 30 }} color={theme.blue} /> : (
        <>
          <View style={styles.statGrid}>
            <Stat label="Revenue"  value={show(fmtMoney(data.revenue))} accent="#2D7A5F" />
            <Stat label="Tips"     value={show(fmtMoney(data.tips))}    accent="#3D9E8A" />
            <Stat label="Services" value={String(data.serviceCount)} accent="#3D95CE" />
            <Stat label="Clients"  value={String(data.clientCount)}  accent="#6a4fa0" />
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
                <Text style={styles.chartCaption}>Best day {show(fmtMoney(trendBest))}</Text>
              </View>
            </View>
          )}

          {data.serviceCount === 0 && data.tips === 0 && (
            <View style={styles.welcomeCard}>
              <Icon name="sparkles" size={36} color={theme.teal} strokeWidth={2} />
              <Text style={[styles.welcomeTitle, { marginTop: 10 }]}>You're all set up</Text>
              <Text style={styles.welcomeBody}>As soon as appointments wrap up and tips come in, your take-home and stats will populate here.</Text>
            </View>
          )}

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
                    <Text style={styles.serviceRevenue}>{show(fmtMoney(s.revenue))}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {data.tipEntries.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.sectionLabel}>Recent tips</Text>
              <View style={styles.card}>
                {data.tipEntries.slice(0, 12).map((t, i) => (
                  <View key={`${t.date}-${i}`} style={[styles.tipRow, i > 0 && styles.tipRowDivider]}>
                    <Text style={styles.tipDate}>{fmtDateShort(t.date)}</Text>
                    <Text style={styles.tipClient} numberOfLines={1}>{t.clientName}</Text>
                    <Text style={styles.tipAmount}>{show(fmtMoneyExact(t.amount))}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {(data.redoEntries || []).length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.sectionLabel}>Redo adjustments</Text>
              <View style={styles.card}>
                {data.redoEntries.slice(0, 12).map((rd, i) => (
                  <View key={`${rd.date}-${i}`} style={[styles.tipRow, i > 0 && styles.tipRowDivider]}>
                    <Text style={styles.tipDate}>{fmtDateShort(rd.date)}</Text>
                    <Text style={styles.tipClient} numberOfLines={2}>
                      {rd.dir === 'in'
                        ? `Redid ${rd.client}'s ${rd.label} (orig. ${rd.other || 'another tech'})`
                        : `${rd.client}'s ${rd.label} redone by ${rd.other || 'another tech'}`}
                    </Text>
                    <Text style={[styles.tipAmount, { color: rd.dir === 'in' ? '#2D7A5F' : '#C0392B' }]}>
                      {hidden ? '••••' : `${rd.dir === 'in' ? '+' : '−'}${fmtMoneyExact(rd.amount)}`}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </>
      )}
    </View>
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
  rangeRow:  { flexDirection: 'row', backgroundColor: t.surface, borderRadius: 10, padding: 4, marginBottom: 14 },
  rangeBtn:  { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 8 },
  rangeBtnActive: { backgroundColor: t.green },
  rangeBtnText: { fontSize: 13, color: t.textMuted, fontWeight: '500' },
  rangeBtnTextActive: { color: '#fff', fontWeight: '700' },
  hero:      { backgroundColor: '#0f1923', borderRadius: 16, padding: 22, marginBottom: 14, alignItems: 'center' },
  eyeBtn:    { position: 'absolute', top: 12, right: 14, padding: 4 },
  eyeIcon:   { fontSize: 18 },
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
  welcomeTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 6 },
  welcomeBody:  { fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 19 },
});
