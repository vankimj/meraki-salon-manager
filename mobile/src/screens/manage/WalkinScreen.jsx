import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import useTenantAccess from '../../hooks/useTenantAccess';
import {
  fetchTurnRoster, saveTurnRoster, fetchWaitlist, addWaitlistEntry, updateWaitlistEntry, removeWaitlistEntry,
  fetchEmployees,
} from '../../lib/firestore';

const GREEN = '#2D7A5F';

// Walk-in kiosk: today's turn rotation (next tech up = fewest turns) +
// a waitlist. Front-desk tool — any staff can operate it.
export default function WalkinScreen() {
  const { canEditSchedule, isAdmin } = useTenantAccess();
  const canEdit = isAdmin || canEditSchedule;
  const [roster,  setRoster]  = useState(null);
  const [waitlist, setWaitlist] = useState([]);
  const [emps,    setEmps]    = useState([]);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    const [r, w, e] = await Promise.all([fetchTurnRoster(), fetchWaitlist(), fetchEmployees().catch(() => [])]);
    setRoster(r.roster || []);
    setWaitlist(w);
    setEmps(e.filter(x => x.active !== false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function persistRoster(next) {
    setRoster(next);
    try { await saveTurnRoster(new Date().toISOString().slice(0, 10), next); } catch { load(); }
  }
  function addTurn(techId) {
    if (!canEdit) return;
    persistRoster(roster.map(t => t.techId === techId ? { ...t, turnsTaken: (t.turnsTaken || 0) + 1 } : t));
  }
  function removeTech(techId) {
    if (!canEdit) return;
    persistRoster(roster.filter(t => t.techId !== techId));
  }
  function addTech(emp) {
    if (!canEdit || roster.some(t => t.techId === emp.id)) return;
    persistRoster([...roster, { techId: emp.id, techName: emp.name, clockInAt: new Date().toISOString(), turnsTaken: 0 }]);
  }
  async function addWaiter() {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    try { await addWaitlistEntry({ clientName: name }); await load(); }
    catch (e) { Alert.alert('Couldn\'t add', e?.message || 'Try again.'); }
  }
  async function seat(entry) {
    try { await updateWaitlistEntry(entry.id, { status: 'seated', seatedAt: new Date().toISOString() }); await load(); } catch {}
  }
  async function removeWaiter(id) {
    try { await removeWaitlistEntry(id); await load(); } catch {}
  }

  if (roster === null) return <View style={styles.center}><ActivityIndicator color={GREEN} /></View>;

  const sorted = [...roster].sort((a, b) => (a.turnsTaken || 0) - (b.turnsTaken || 0) || (a.clockInAt || '').localeCompare(b.clockInAt || ''));
  const waiting = waitlist.filter(w => w.status !== 'seated');
  const offRoster = emps.filter(e => !roster.some(t => t.techId === e.id));

  return (
    <FlatList
      style={styles.wrap}
      data={sorted}
      keyExtractor={(t) => t.techId}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={GREEN} />}
      ListHeaderComponent={<Text style={styles.section}>Rotation — next up first</Text>}
      ListEmptyComponent={<Text style={styles.empty}>No techs clocked in. Add one below.</Text>}
      renderItem={({ item, index }) => (
        <View style={[styles.row, index === 0 && styles.nextRow]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{index === 0 ? '⭐ ' : ''}{item.techName}</Text>
            <Text style={styles.sub}>{item.turnsTaken || 0} turn{(item.turnsTaken || 0) === 1 ? '' : 's'} today</Text>
          </View>
          {canEdit && (
            <>
              <TouchableOpacity style={styles.turnBtn} onPress={() => addTurn(item.techId)}><Text style={styles.turnText}>+1 turn</Text></TouchableOpacity>
              <TouchableOpacity style={styles.xBtn} onPress={() => removeTech(item.techId)}><Text style={styles.xText}>✕</Text></TouchableOpacity>
            </>
          )}
        </View>
      )}
      ListFooterComponent={
        <View>
          {canEdit && offRoster.length > 0 && (
            <>
              <Text style={styles.subSection}>Clock in a tech</Text>
              <View style={styles.chipWrap}>
                {offRoster.map(e => (
                  <TouchableOpacity key={e.id} style={styles.chip} onPress={() => addTech(e)}>
                    <Text style={styles.chipText}>+ {e.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.section}>Waitlist ({waiting.length})</Text>
          {canEdit && (
            <View style={styles.addRow}>
              <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Walk-in name" placeholderTextColor="#bbb" onSubmitEditing={addWaiter} returnKeyType="done" />
              <TouchableOpacity style={styles.addBtn} onPress={addWaiter}><Text style={styles.addText}>Add</Text></TouchableOpacity>
            </View>
          )}
          {waiting.length === 0 ? (
            <Text style={styles.empty}>No one waiting.</Text>
          ) : waiting.map(w => (
            <View key={w.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{w.clientName || 'Walk-in'}</Text>
                <Text style={styles.sub}>{w.addedAt ? new Date(w.addedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}{w.services ? ` · ${w.services}` : ''}</Text>
              </View>
              {canEdit && (
                <>
                  <TouchableOpacity style={styles.turnBtn} onPress={() => seat(w)}><Text style={styles.turnText}>Seat</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.xBtn} onPress={() => removeWaiter(w.id)}><Text style={styles.xText}>✕</Text></TouchableOpacity>
                </>
              )}
            </View>
          ))}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  wrap:       { flex: 1, backgroundColor: '#f5f7fa' },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  section:    { fontSize: 14, fontWeight: '800', color: '#1a1a1a', marginTop: 18, marginBottom: 8 },
  subSection: { fontSize: 12, fontWeight: '700', color: '#888', marginTop: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  empty:      { color: '#999', fontSize: 13, paddingVertical: 14 },
  row:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#ececec', gap: 8 },
  nextRow:    { borderColor: GREEN, backgroundColor: '#f3faf7' },
  name:       { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  sub:        { fontSize: 12, color: '#8a8a8a', marginTop: 2 },
  turnBtn:    { backgroundColor: '#eef5f2', borderWidth: 1, borderColor: GREEN, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 },
  turnText:   { color: GREEN, fontWeight: '800', fontSize: 12 },
  xBtn:       { width: 30, height: 30, borderRadius: 15, backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center' },
  xText:      { color: '#999', fontSize: 14, fontWeight: '700' },
  chipWrap:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:       { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d8d8d8', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  chipText:   { fontSize: 13, color: '#555', fontWeight: '600' },
  addRow:     { flexDirection: 'row', gap: 8, marginBottom: 10 },
  input:      { flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: '#ececec' },
  addBtn:     { backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  addText:    { color: '#fff', fontWeight: '800', fontSize: 14 },
});
