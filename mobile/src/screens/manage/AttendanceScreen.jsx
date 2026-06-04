import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import useTenantAccess from '../../hooks/useTenantAccess';
import useResponsive from '../../hooks/useResponsive';
import { fetchEmployees, fetchAttendance, saveAttendance } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftKey(key, days) {
  const d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtClock(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function hoursWorked(e) {
  if (!e.clockInAt || !e.clockOutAt) return null;
  const h = (new Date(e.clockOutAt) - new Date(e.clockInAt)) / 3.6e6;
  return h > 0 ? h.toFixed(2) : null;
}

export default function AttendanceScreen() {
  const { isAdmin } = useTenantAccess();
  const { contentMaxWidth } = useResponsive();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [dateKey, setDateKey] = useState(todayKey());
  const [emps,    setEmps]    = useState([]);
  const [byEmp,   setByEmp]   = useState({});   // employeeId → { clockInAt, clockOutAt, employeeName }
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [employees, day] = await Promise.all([fetchEmployees(), fetchAttendance(dateKey)]);
      setEmps(employees);
      const map = {};
      (day.entries || []).forEach(e => { map[e.employeeId] = e; });
      setByEmp(map);
    } catch { setEmps([]); setByEmp({}); }
  }, [dateKey]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  async function persist(map) {
    setByEmp(map);
    try { await saveAttendance(dateKey, Object.values(map)); } catch {}
  }
  function setEntry(emp, patch) {
    if (!isAdmin) return;
    const prev = byEmp[emp.id] || { employeeId: emp.id, employeeName: emp.name, clockInAt: null, clockOutAt: null };
    persist({ ...byEmp, [emp.id]: { ...prev, employeeName: emp.name, ...patch } });
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  const entries   = Object.values(byEmp);
  const present   = entries.filter(e => e.clockInAt).length;
  const stillIn   = entries.filter(e => e.clockInAt && !e.clockOutAt).length;
  const workedHrs = entries.reduce((s, e) => s + (Number(hoursWorked(e)) || 0), 0);
  const absent    = Math.max(0, emps.length - present);

  return (
    <View style={styles.wrap}>
      <View style={styles.dateBar}>
        <TouchableOpacity onPress={() => setDateKey(k => shiftKey(k, -1))} style={styles.navBtn}><Text style={styles.navText}>‹</Text></TouchableOpacity>
        <Text style={styles.dateText}>
          {new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          {dateKey === todayKey() ? '  · Today' : ''}
        </Text>
        <TouchableOpacity onPress={() => setDateKey(k => shiftKey(k, 1))} style={styles.navBtn}><Text style={styles.navText}>›</Text></TouchableOpacity>
      </View>

      <View style={styles.kpiBar}>
        <Kpi value={workedHrs.toFixed(1)} label="Worked hrs" />
        <Kpi value={present} label="Present" />
        <Kpi value={stillIn} label="Clocked in" />
        <Kpi value={absent} label="Absent" />
      </View>

      <FlatList
        data={emps}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 14, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}
        ListEmptyComponent={<Text style={styles.empty}>No employees.</Text>}
        renderItem={({ item }) => {
          const e  = byEmp[item.id] || {};
          const hw = hoursWorked(e);
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.times}>In {fmtClock(e.clockInAt)} · Out {fmtClock(e.clockOutAt)}{hw ? ` · ${hw}h` : ''}</Text>
              </View>
              {isAdmin && (
                <View style={styles.actions}>
                  {!e.clockInAt ? (
                    <TouchableOpacity style={[styles.btn, styles.inBtn]} onPress={() => setEntry(item, { clockInAt: new Date().toISOString() })}><Text style={styles.inText}>Clock in</Text></TouchableOpacity>
                  ) : !e.clockOutAt ? (
                    <TouchableOpacity style={[styles.btn, styles.outBtn]} onPress={() => setEntry(item, { clockOutAt: new Date().toISOString() })}><Text style={styles.outText}>Clock out</Text></TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={[styles.btn, styles.resetBtn]} onPress={() => setEntry(item, { clockInAt: null, clockOutAt: null })}><Text style={styles.resetText}>Reset</Text></TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

function Kpi({ value, label }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.kpiCell}>
      <Text style={styles.kpiVal}>{value}</Text>
      <Text style={styles.kpiLab}>{label}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  kpiBar:  { flexDirection: 'row', backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: 12 },
  kpiCell: { flex: 1, alignItems: 'center' },
  kpiVal:  { fontSize: 19, fontWeight: '800', color: t.green },
  kpiLab:  { fontSize: 10.5, color: t.textFaint, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  dateBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.border },
  navBtn:  { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceAlt },
  navText: { fontSize: 22, color: t.green, lineHeight: 24 },
  dateText:{ fontSize: 15, fontWeight: '700', color: t.text },
  empty:   { textAlign: 'center', color: t.textFaint, marginTop: 50, fontSize: 13 },
  row:     { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: t.border },
  name:    { fontSize: 15, fontWeight: '700', color: t.text },
  times:   { fontSize: 12.5, color: t.textMuted, marginTop: 3 },
  actions: { marginLeft: 8 },
  btn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  inBtn:   { backgroundColor: t.greenSoft, borderColor: t.green },
  inText:  { color: t.green, fontWeight: '800', fontSize: 13 },
  outBtn:  { backgroundColor: t.warningBg, borderColor: t.warning },
  outText: { color: t.warning, fontWeight: '800', fontSize: 13 },
  resetBtn:{ backgroundColor: t.surfaceAlt, borderColor: t.borderStrong },
  resetText:{ color: t.textMuted, fontWeight: '700', fontSize: 13 },
});
