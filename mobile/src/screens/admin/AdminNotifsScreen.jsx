import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchNotifications } from '../../lib/firestore';

// Read-only notification monitor (appointment alerts, receipts, reviews,
// handbook reminders, etc.). Fields vary by changeType — render defensively.
function statusOf(n) {
  if (n.error || n.status === 'failed' || n.emailStatus === 'failed' || n.smsStatus === 'failed') return ['#fef2f2', '#b91c1c', 'failed'];
  if (n.sent === false || n.status === 'pending') return ['#fffbeb', '#b45309', 'pending'];
  return ['#f0fdf4', '#16a34a', 'sent'];
}

export default function AdminNotifsScreen() {
  const [items, setItems] = useState(null);
  const load = useCallback(async () => { try { setItems(await fetchNotifications(150)); } catch { setItems([]); } }, []);
  useEffect(() => { load(); }, [load]);

  if (items === null) return <View style={styles.center}><ActivityIndicator color="#2D7A5F" /></View>;

  return (
    <FlatList
      style={styles.wrap}
      data={items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ padding: 14 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#2D7A5F" />}
      ListEmptyComponent={<Text style={styles.empty}>No notifications yet.</Text>}
      renderItem={({ item }) => {
        const [bg, c, label] = statusOf(item);
        const who = item.recipient || item.email || item.phone || item.techName || item.clientName || '';
        return (
          <View style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.type} numberOfLines={1}>{(item.changeType || item.type || 'notification').replace(/_/g, ' ')}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {who}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString()}` : ''}
              </Text>
              {!!item.error && <Text style={styles.err} numberOfLines={2}>{String(item.error)}</Text>}
            </View>
            <View style={[styles.badge, { backgroundColor: bg }]}><Text style={[styles.badgeText, { color: c }]}>{label}</Text></View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#f5f7fa' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  empty:   { textAlign: 'center', color: '#999', marginTop: 50, fontSize: 13 },
  row:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: '#ececec', gap: 10 },
  type:    { fontSize: 14, fontWeight: '700', color: '#1a1a1a', textTransform: 'capitalize' },
  sub:     { fontSize: 11.5, color: '#8a8a8a', marginTop: 2 },
  err:     { fontSize: 11, color: '#b91c1c', marginTop: 3 },
  badge:   { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText:{ fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
});
