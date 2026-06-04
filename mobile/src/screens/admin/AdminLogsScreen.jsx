import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchLogs } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Read-only activity log. Entry shape (web logActivity): timestamp, email,
// name, action, details.
export default function AdminLogsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const [logs, setLogs] = useState(null);
  const load = useCallback(async () => { try { setLogs(await fetchLogs(100)); } catch { setLogs([]); } }, []);
  useEffect(() => { load(); }, [load]);

  if (logs === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <FlatList
      style={styles.wrap}
      data={logs}
      keyExtractor={(l) => l.id}
      contentContainerStyle={{ padding: 14 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}
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

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  empty:   { textAlign: 'center', color: t.textFaint, marginTop: 50, fontSize: 13 },
  row:     { backgroundColor: t.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: t.border },
  action:  { fontSize: 14, fontWeight: '700', color: t.text },
  details: { fontSize: 12.5, color: t.textMuted, marginTop: 3 },
  time:    { fontSize: 11, color: t.textFaint, marginTop: 5 },
});
