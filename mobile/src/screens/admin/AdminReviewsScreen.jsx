import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchReviewRequests, fetchReviewReceived } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Google review requests sent + reviews received. Read-only on mobile.
export default function AdminReviewsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const [tab, setTab]   = useState('requests');
  const [reqs, setReqs] = useState(null);
  const [recv, setRecv] = useState(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetchReviewRequests(200).catch(() => []), fetchReviewReceived().catch(() => [])]);
    setReqs(a); setRecv(b);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (reqs === null || recv === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  const clicked = reqs.filter(r => r.clicked).length;

  return (
    <View style={styles.wrap}>
      <View style={styles.stats}>
        <Stat label="Sent" value={reqs.length} />
        <Stat label="Clicked" value={clicked} />
        <Stat label="Received" value={recv.length} />
      </View>
      <View style={styles.tabs}>
        {[['requests', 'Requests'], ['received', 'Received']].map(([id, label]) => (
          <TouchableOpacity key={id} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabOn]}>
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'requests' ? (
        <FlatList
          data={reqs}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 14 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}
          ListEmptyComponent={<Text style={styles.empty}>No requests sent.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.clientName || item.name || 'Client'}</Text>
                <Text style={styles.sub}>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}</Text>
              </View>
              <Text style={[styles.pill, item.clicked ? styles.pillGreen : styles.pillGray]}>{item.clicked ? 'clicked' : 'sent'}</Text>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={recv}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 14 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}
          ListEmptyComponent={<Text style={styles.empty}>No reviews received.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.author || item.clientName || 'Reviewer'}{item.rating ? ` · ${'★'.repeat(Number(item.rating) || 0)}` : ''}</Text>
                {!!(item.text || item.comment) && <Text style={styles.sub} numberOfLines={2}>{item.text || item.comment}</Text>}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

function Stat({ label, value }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: t.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  stats:     { flexDirection: 'row', backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: 14 },
  stat:      { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '800', color: t.green },
  statLabel: { fontSize: 11, color: t.textFaint, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  tabs:      { flexDirection: 'row', backgroundColor: t.surface, padding: 6, gap: 6, borderBottomWidth: 1, borderBottomColor: t.border },
  tab:       { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: t.surfaceAlt },
  tabOn:     { backgroundColor: t.greenSoft },
  tabText:   { fontSize: 13, fontWeight: '700', color: t.textMuted },
  tabTextOn: { color: t.green },
  empty:     { textAlign: 'center', color: t.textFaint, marginTop: 50, fontSize: 13 },
  row:       { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.border, gap: 10 },
  name:      { fontSize: 14.5, fontWeight: '700', color: t.text },
  sub:       { fontSize: 12, color: t.textMuted, marginTop: 2 },
  pill:      { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  pillGreen: { backgroundColor: t.greenSoft, color: t.success },
  pillGray:  { backgroundColor: t.surfaceMuted, color: t.textMuted },
});
