import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchFeedback, updateFeedbackStatus } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const STATUS = ['open', 'resolved', 'ignored'];

// In-app feedback triage. Entry shape (web FeedbackModal): type (bug|idea),
// message/text, status, email/submittedBy, createdAt.
export default function AdminFeedbackScreen() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('open');
  const load = useCallback(async () => { try { setItems(await fetchFeedback()); } catch { setItems([]); } }, []);
  useEffect(() => { load(); }, [load]);

  async function setStatus(item, status) {
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, status } : x));
    try { await updateFeedbackStatus(item.id, status); } catch { load(); }
  }

  const statusColor = {
    open:     [theme.blueSoft,   theme.blue],
    resolved: [theme.greenSoft,  theme.success],
    ignored:  [theme.surfaceAlt, theme.textMuted],
  };

  if (items === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;
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
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}
        ListEmptyComponent={<Text style={styles.empty}>Nothing {filter}.</Text>}
        renderItem={({ item }) => {
          const [bg, c] = statusColor[item.status || 'open'] || statusColor.open;
          return (
            <View style={styles.row}>
              <View style={styles.head}>
                <View style={[styles.typeBadge, { backgroundColor: item.type === 'bug' ? theme.dangerBg : theme.warningBg }]}>
                  <Text style={[styles.typeText, { color: item.type === 'bug' ? theme.danger : theme.warning }]}>{item.type || 'note'}</Text>
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

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  tabs:    { flexDirection: 'row', backgroundColor: t.surface, padding: 6, gap: 6, borderBottomWidth: 1, borderBottomColor: t.border },
  tab:     { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: t.surfaceAlt },
  tabOn:   { backgroundColor: t.greenSoft },
  tabText: { fontSize: 12, fontWeight: '700', color: t.textMuted, textTransform: 'capitalize' },
  tabTextOn:{ color: t.green },
  empty:   { textAlign: 'center', color: t.textFaint, marginTop: 50, fontSize: 13 },
  row:     { backgroundColor: t.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: t.border },
  head:    { flexDirection: 'row', gap: 8, marginBottom: 8 },
  typeBadge:{ borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  typeText:{ fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  statusBadge:{ borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:{ fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  msg:     { fontSize: 14, color: t.text, lineHeight: 19 },
  meta:    { fontSize: 11, color: t.textFaint, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actBtn:  { borderWidth: 1, borderColor: t.borderStrong, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  actText: { fontSize: 12, fontWeight: '700', color: t.textMuted },
});
