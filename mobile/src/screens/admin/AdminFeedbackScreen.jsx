import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchFeedback, updateFeedbackStatus } from '../../lib/firestore';

const STATUS = ['open', 'resolved', 'ignored'];
const STATUS_COLOR = { open: ['#eff6ff', '#2563eb'], resolved: ['#f0fdf4', '#16a34a'], ignored: ['#f5f5f5', '#888'] };

// In-app feedback triage. Entry shape (web FeedbackModal): type (bug|idea),
// message/text, status, email/submittedBy, createdAt.
export default function AdminFeedbackScreen() {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('open');
  const load = useCallback(async () => { try { setItems(await fetchFeedback()); } catch { setItems([]); } }, []);
  useEffect(() => { load(); }, [load]);

  async function setStatus(item, status) {
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, status } : x));
    try { await updateFeedbackStatus(item.id, status); } catch { load(); }
  }

  if (items === null) return <View style={styles.center}><ActivityIndicator color="#2D7A5F" /></View>;
  const shown = items.filter(i => (i.status || 'open') === filter);

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        {STATUS.map(s => (
          <TouchableOpacity key={s} onPress={() => setFilter(s)} style={[styles.tab, filter === s && styles.tabOn]}>
            <Text style={[styles.tabText, filter === s && styles.tabTextOn]}>
              {s} ({items.filter(i => (i.status || 'open') === s).length})
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 14 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#2D7A5F" />}
        ListEmptyComponent={<Text style={styles.empty}>Nothing {filter}.</Text>}
        renderItem={({ item }) => {
          const [bg, c] = STATUS_COLOR[item.status || 'open'] || STATUS_COLOR.open;
          return (
            <View style={styles.row}>
              <View style={styles.head}>
                <View style={[styles.typeBadge, { backgroundColor: item.type === 'bug' ? '#fef2f2' : '#fffbeb' }]}>
                  <Text style={[styles.typeText, { color: item.type === 'bug' ? '#b91c1c' : '#b45309' }]}>{item.type || 'note'}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: bg }]}><Text style={[styles.statusText, { color: c }]}>{item.status || 'open'}</Text></View>
              </View>
              <Text style={styles.msg}>{item.message || item.text || item.body || '(no message)'}</Text>
              <Text style={styles.meta}>
                {item.email || item.submittedBy || 'anonymous'}
                {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString()}` : ''}
              </Text>
              <View style={styles.actions}>
                {STATUS.filter(s => s !== (item.status || 'open')).map(s => (
                  <TouchableOpacity key={s} onPress={() => setStatus(item, s)} style={styles.actBtn}>
                    <Text style={styles.actText}>{s === 'open' ? 'Reopen' : s === 'resolved' ? 'Resolve' : 'Ignore'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
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
  tabs:    { flexDirection: 'row', backgroundColor: '#fff', padding: 6, gap: 6, borderBottomWidth: 1, borderBottomColor: '#ececec' },
  tab:     { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: '#f1f3f5' },
  tabOn:   { backgroundColor: '#eef5f2' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'capitalize' },
  tabTextOn:{ color: '#2D7A5F' },
  empty:   { textAlign: 'center', color: '#999', marginTop: 50, fontSize: 13 },
  row:     { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#ececec' },
  head:    { flexDirection: 'row', gap: 8, marginBottom: 8 },
  typeBadge:{ borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  typeText:{ fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  statusBadge:{ borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:{ fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  msg:     { fontSize: 14, color: '#1a1a1a', lineHeight: 19 },
  meta:    { fontSize: 11, color: '#aaa', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actBtn:  { borderWidth: 1, borderColor: '#d5d8db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  actText: { fontSize: 12, fontWeight: '700', color: '#555' },
});
