import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import useTenantAccess from '../../hooks/useTenantAccess';
import { fetchEmployees, fetchAttendance, saveAttendance } from '../../lib/firestore';

const GREEN = '#2D7A5F';

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

  if (loading) return <View style={styles.center}><ActivityIndicator color={GREEN} /></View>;

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

      <FlatList
        data={emps}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 14 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={GREEN} />}
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

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#f5f7fa' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  dateBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#ececec' },
  navBtn:  { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f3f5' },
  navText: { fontSize: 22, color: GREEN, lineHeight: 24 },
  dateText:{ fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  empty:   { textAlign: 'center', color: '#999', marginTop: 50, fontSize: 13 },
  row:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#ececec' },
  name:    { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  times:   { fontSize: 12.5, color: '#8a8a8a', marginTop: 3 },
  actions: { marginLeft: 8 },
  btn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  inBtn:   { backgroundColor: '#eef5f2', borderColor: GREEN },
  inText:  { color: GREEN, fontWeight: '800', fontSize: 13 },
  outBtn:  { backgroundColor: '#fdf2e6', borderColor: '#c47d2e' },
  outText: { color: '#c47d2e', fontWeight: '800', fontSize: 13 },
  resetBtn:{ backgroundColor: '#f1f3f5', borderColor: '#d5d8db' },
  resetText:{ color: '#888', fontWeight: '700', fontSize: 13 },
});
