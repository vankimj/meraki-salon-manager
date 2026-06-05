import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchNotifications } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Read-only notification monitor (appointment alerts, receipts, reviews,
// handbook reminders, etc.). Fields vary by changeType — render defensively.
function statusOf(n) {
  if (n.error || n.status === 'failed' || n.emailStatus === 'failed' || n.smsStatus === 'failed') return 'failed';
  if (n.sent === false || n.status === 'pending') return 'pending';
  return 'sent';
}

export default function AdminNotifsScreen() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [items, setItems] = useState(null);
  const load = useCallback(async () => { try { setItems(await fetchNotifications(150)); } catch { setItems([]); } }, []);
  useEffect(() => { load(); }, [load]);

  const statusColors = {
    failed:  [theme.dangerBg,  theme.danger,  'failed'],
    pending: [theme.warningBg, theme.warning,  'pending'],
    sent:    [theme.greenSoft, theme.success,  'sent'],
  };

  if (items === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <FlatList
      style={styles.wrap}
      data={items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ padding: 14 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}
      ListEmptyComponent={<Text style={styles.empty}>No notifications yet.</Text>}
      renderItem={({ item }) => {
        const [bg, c, label] = statusColors[statusOf(item)];
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

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  empty:   { textAlign: 'center', color: t.textFaint, marginTop: 50, fontSize: 13 },
  row:     { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: t.border, gap: 10 },
  type:    { fontSize: 14, fontWeight: '700', color: t.text, textTransform: 'capitalize' },
  sub:     { fontSize: 11.5, color: t.textMuted, marginTop: 2 },
  err:     { fontSize: 11, color: t.danger, marginTop: 3 },
  badge:   { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText:{ fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
});
