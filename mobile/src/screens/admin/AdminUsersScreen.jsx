import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchUsersFull } from '../../lib/firestore';

const ROLE_COLORS = {
  admin:     ['#eff6ff', '#2563eb'],
  scheduler: ['#f0fdf4', '#16a34a'],
  tech:      ['#faf5ff', '#7c3aed'],
  readonly:  ['#f5f5f5', '#888'],
  pending:   ['#fffbeb', '#b45309'],
  denied:    ['#fef2f2', '#b91c1c'],
};

// Read-only users + roles list. Role editing stays on the web app for now
// (the data/usersFull + projection writeBatch isn't ported to mobile yet —
// doing partial writes risks the usersFull-missing incident class).
export default function AdminUsersScreen() {
  const [users, setUsers] = useState(null);
  const load = useCallback(async () => { try { setUsers(await fetchUsersFull()); } catch { setUsers([]); } }, []);
  useEffect(() => { load(); }, [load]);

  if (users === null) return <View style={styles.center}><ActivityIndicator color="#2D7A5F" /></View>;

  return (
    <FlatList
      style={styles.wrap}
      data={users}
      keyExtractor={(u, i) => (u.email || String(i))}
      contentContainerStyle={{ padding: 14 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#2D7A5F" />}
      ListHeaderComponent={<Text style={styles.note}>View-only on mobile — change roles on the web app.</Text>}
      ListEmptyComponent={<Text style={styles.empty}>No users found (or you lack access to the rich user list).</Text>}
      renderItem={({ item }) => {
        const [bg, c] = ROLE_COLORS[item.role] || ['#f5f5f5', '#888'];
        return (
          <View style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{item.name || item.email || '(unknown)'}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {item.email || ''}{item.techName ? ` · ${item.techName}` : ''}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: bg }]}>
              <Text style={[styles.badgeText, { color: c }]}>{item.role || '—'}</Text>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#f5f7fa' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  note:    { fontSize: 12, color: '#999', marginBottom: 10, paddingHorizontal: 2 },
  empty:   { textAlign: 'center', color: '#999', marginTop: 50, fontSize: 13 },
  row:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#ececec', gap: 10 },
  name:    { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  sub:     { fontSize: 12, color: '#8a8a8a', marginTop: 2 },
  badge:   { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText:{ fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
});
