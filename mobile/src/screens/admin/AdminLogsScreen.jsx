import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchLogs } from '../../lib/firestore';

// Read-only activity log. Entry shape (web logActivity): timestamp, email,
// name, action, details.
export default function AdminLogsScreen() {
  const [logs, setLogs] = useState(null);
  const load = useCallback(async () => { try { setLogs(await fetchLogs(100)); } catch { setLogs([]); } }, []);
  useEffect(() => { load(); }, [load]);

  if (logs === null) return <View style={styles.center}><ActivityIndicator color="#2D7A5F" /></View>;

  return (
    <FlatList
      style={styles.wrap}
      data={logs}
      keyExtractor={(l) => l.id}
      contentContainerStyle={{ padding: 14 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#2D7A5F" />}
      ListEmptyComponent={<Text style={styles.empty}>No activity yet.</Text>}
      renderItem={({ item }) => {
        const details = item.details && typeof item.details !== 'string' ? JSON.stringify(item.details) : item.details;
        return (
          <View style={styles.row}>
            <Text style={styles.action}>{item.action || 'action'}</Text>
            {!!details && <Text style={styles.details} numberOfLines={3}>{details}</Text>}
            <Text style={styles.time}>
              {item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}
              {item.name || item.email ? ` · ${item.name || item.email}` : ''}
            </Text>
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
  row:     { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#ececec' },
  action:  { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  details: { fontSize: 12.5, color: '#666', marginTop: 3 },
  time:    { fontSize: 11, color: '#aaa', marginTop: 5 },
});
