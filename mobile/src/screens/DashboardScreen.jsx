import { useState, useEffect, useCallback } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchAppointmentsByRange, fetchServices } from '../lib/firestore';
import useCurrentEmployee from '../hooks/useCurrentEmployee';
import EarningsPanel from '../components/EarningsPanel';
import Icon from '../components/Icon';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

const WEEK_DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDaysISO = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const parseHM = (s) => { const [h, m] = String(s || '').split(':').map(Number); return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0); };
const fmtH = (min) => `${(Math.max(0, min) / 60).toFixed(1)}h`;
const initials = (n) => { const p = String(n || '?').trim().split(/\s+/); return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?'; };
const fmtApptDate = (iso) => { const d = new Date(iso + 'T12:00:00'); const t = todayISO(); return iso === t ? 'Today' : iso === addDaysISO(t, 1) ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
const fmtTime = (hm) => { const [h, m] = String(hm || '').split(':').map(Number); if (!Number.isFinite(h)) return ''; const am = h < 12; const hh = h % 12 || 12; return `${hh}:${String(m || 0).padStart(2, '0')} ${am ? 'AM' : 'PM'}`; };
const ACTIVE = (s) => !['done', 'completed', 'cancelled', 'canceled', 'no-show', 'noshow'].includes(String(s || '').toLowerCase());

export default function DashboardScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { employee, techName, loading: empLoading } = useCurrentEmployee();
  const [appts, setAppts] = useState(null);     // upcoming, active, mine
  const [durByName, setDurByName] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!techName) { setAppts([]); return; }
    const t = todayISO();
    try {
      const [list, svcs] = await Promise.all([
        fetchAppointmentsByRange(t, addDaysISO(t, 30)).catch(() => []),
        fetchServices().catch(() => []),
      ]);
      const dm = {}; (svcs || []).forEach(s => { if (s.name) dm[s.name] = Number(s.duration) || 0; });
      setDurByName(dm);
      const mine = (list || [])
        .filter(a => (a.techName || '') === techName && a.date >= t && ACTIVE(a.status))
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.startTime || '').localeCompare(b.startTime || ''));
      setAppts(mine);
    } catch { setAppts([]); }
  }, [techName]);
  useEffect(() => { load(); }, [load]);

  const apptMin = (a) => {
    const svc = a.services || [];
    if (!svc.length) return 30;
    return svc.reduce((s, sv) => s + (Number(sv.duration) || durByName[sv.name] || 30), 0);
  };

  if (empLoading || appts === null) return <View style={styles.center}><ActivityIndicator color={theme.blue} /></View>;

  // Today's shift hours from workDays + how much is booked.
  const dow = WEEK_DOW[(new Date().getDay() + 6) % 7];
  const wd = employee?.workDays?.[dow];
  const shiftMin = wd && wd.on !== false ? Math.max(0, parseHM(wd.end || '18:00') - parseHM(wd.start || '09:00')) : 0;
  const t = todayISO();
  const bookedMin = appts.filter(a => a.date === t).reduce((s, a) => s + apptMin(a), 0);
  const openMin = Math.max(0, shiftMin - bookedMin);
  const bookedPct = shiftMin > 0 ? Math.min(100, Math.round((bookedMin / shiftMin) * 100)) : 0;

  const shown = showAll ? appts : appts.slice(0, 3);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.blue} />}>

      {/* Profile button — prominent, centered */}
      <TouchableOpacity style={styles.profile} activeOpacity={0.8} onPress={() => navigation.navigate('Profile')}>
        {employee?.photo
          ? <Image source={{ uri: employee.photo }} style={styles.avatar} />
          : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarInit}>{initials(techName)}</Text></View>}
        <Text style={styles.profileName}>{techName || 'Your profile'}</Text>
        <Text style={styles.profileLink}>View profile ›</Text>
      </TouchableOpacity>

      {/* Earnings (moved from the old Earnings tab) */}
      <EarningsPanel techName={techName} />

      {/* Today's shift hours */}
      <Text style={styles.sectionLabel}>Today's shift</Text>
      <View style={styles.shiftCard}>
        {shiftMin > 0 ? (
          <>
            <View style={styles.shiftRow}>
              <ShiftStat label="Shift" value={fmtH(shiftMin)} color={theme.text} />
              <ShiftStat label="Booked" value={fmtH(bookedMin)} color={theme.green} />
              <ShiftStat label="Open" value={fmtH(openMin)} color={theme.blue} />
            </View>
            <View style={styles.barBg}><View style={[styles.barFill, { width: `${bookedPct}%` }]} /></View>
            <Text style={styles.shiftCaption}>{bookedPct}% of your shift is booked</Text>
          </>
        ) : (
          <Text style={styles.dayOff}>No shift scheduled today. Set your hours in Profile.</Text>
        )}
      </View>

      {/* Upcoming appointments */}
      <Text style={styles.sectionLabel}>Upcoming appointments</Text>
      {appts.length === 0 ? (
        <View style={styles.emptyCard}><Text style={styles.emptyText}>No upcoming appointments.</Text></View>
      ) : (
        <>
          {shown.map(a => (
            <View key={a.id} style={styles.apptRow}>
              <View style={styles.apptWhen}>
                <Text style={styles.apptDate}>{fmtApptDate(a.date)}</Text>
                <Text style={styles.apptTime}>{fmtTime(a.startTime)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.apptClient} numberOfLines={1}>{a.clientName || 'Walk-in'}</Text>
                <Text style={styles.apptSvc} numberOfLines={1}>{(a.services || []).map(s => s.name).filter(Boolean).join(', ') || '—'} · {fmtH(apptMin(a))}</Text>
              </View>
            </View>
          ))}
          {appts.length > 3 && (
            <TouchableOpacity style={styles.moreBtn} onPress={() => setShowAll(v => !v)}>
              <Text style={styles.moreText}>{showAll ? 'Show less' : `Show ${appts.length - 3} more`}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

function ShiftStat({ label, value, color }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.shiftStat}>
      <Text style={[styles.shiftValue, { color }]}>{value}</Text>
      <Text style={styles.shiftLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, paddingBottom: 36 },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },

  profile: { alignItems: 'center', paddingVertical: 18, marginBottom: 8 },
  avatar:  { width: 92, height: 92, borderRadius: 46 },
  avatarFallback: { backgroundColor: t.greenSoft, alignItems: 'center', justifyContent: 'center' },
  avatarInit: { fontSize: 34, fontWeight: '800', color: t.green },
  profileName: { fontSize: 22, fontWeight: '800', color: t.text, marginTop: 12 },
  profileLink: { fontSize: 13, color: t.blue, fontWeight: '600', marginTop: 4 },

  sectionLabel: { fontSize: 11, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', marginTop: 20, marginBottom: 8, marginLeft: 4 },

  shiftCard: { backgroundColor: t.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: t.border },
  shiftRow:  { flexDirection: 'row', justifyContent: 'space-around' },
  shiftStat: { alignItems: 'center' },
  shiftValue:{ fontSize: 24, fontWeight: '800' },
  shiftLabel:{ fontSize: 11, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600', marginTop: 2 },
  barBg:     { height: 8, borderRadius: 4, backgroundColor: t.surfaceAlt, marginTop: 14, overflow: 'hidden' },
  barFill:   { height: 8, borderRadius: 4, backgroundColor: t.green },
  shiftCaption: { fontSize: 12, color: t.textMuted, marginTop: 8, textAlign: 'center' },
  dayOff:    { fontSize: 14, color: t.textMuted, textAlign: 'center', paddingVertical: 6 },

  emptyCard: { backgroundColor: t.surface, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: t.border },
  emptyText: { fontSize: 14, color: t.textFaint, textAlign: 'center' },
  apptRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.border },
  apptWhen:  { width: 74 },
  apptDate:  { fontSize: 13, fontWeight: '800', color: t.text },
  apptTime:  { fontSize: 12, color: t.textMuted, marginTop: 2 },
  apptClient:{ fontSize: 15, fontWeight: '700', color: t.text },
  apptSvc:   { fontSize: 12, color: t.textMuted, marginTop: 2 },
  moreBtn:   { paddingVertical: 12, alignItems: 'center' },
  moreText:  { fontSize: 14, color: t.blue, fontWeight: '700' },
});
