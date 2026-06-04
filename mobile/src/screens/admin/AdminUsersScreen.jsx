import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { fetchUsersFull, setUserRole } from '../../lib/firestore';
import { auth } from '../../lib/firebase';
import useTenantAccess from '../../hooks/useTenantAccess';

const ROLE_COLORS = {
  admin:     ['#eff6ff', '#2563eb'],
  scheduler: ['#f0fdf4', '#16a34a'],
  tech:      ['#faf5ff', '#7c3aed'],
  readonly:  ['#f5f5f5', '#888'],
  pending:   ['#fffbeb', '#b45309'],
  denied:    ['#fef2f2', '#b91c1c'],
};
const ROLES = ['admin', 'scheduler', 'tech', 'readonly', 'denied'];

// Users + roles. Admins can change a role; the write goes through
// setUserRole → saveUsers, a faithful port of the web writeBatch that
// updates data/usersFull + the rules projections atomically.
export default function AdminUsersScreen() {
  const { isAdmin } = useTenantAccess();
  const [users, setUsers] = useState(null);
  const [busy, setBusy]   = useState(false);
  const me = (auth.currentUser?.email || '').toLowerCase();

  const load = useCallback(async () => { try { setUsers(await fetchUsersFull()); } catch { setUsers([]); } }, []);
  useEffect(() => { load(); }, [load]);

  function pickRole(user) {
    if (!isAdmin || busy) return;
    const isSelf = (user.email || '').toLowerCase() === me;
    const opts = ROLES.filter(r => r !== user.role).map(r => ({
      text: r,
      style: r === 'denied' ? 'destructive' : 'default',
      onPress: () => changeRole(user, r, isSelf),
    }));
    Alert.alert(`Change role — ${user.name || user.email}`, `Currently: ${user.role || '—'}`, [...opts, { text: 'Cancel', style: 'cancel' }]);
  }

  function changeRole(user, role, isSelf) {
    const apply = async () => {
      setBusy(true);
      try { await setUserRole(user.email, role); await load(); }
      catch (e) { Alert.alert('Couldn\'t change role', e?.message || 'Try again.'); }
      finally { setBusy(false); }
    };
    if (isSelf && role !== 'admin') {
      Alert.alert('Demote yourself?', 'You will lose admin access on this account.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Demote', style: 'destructive', onPress: apply },
      ]);
    } else apply();
  }

  if (users === null) return <View style={styles.center}><ActivityIndicator color="#2D7A5F" /></View>;

  return (
    <FlatList
      style={styles.wrap}
      data={users}
      keyExtractor={(u, i) => (u.email || String(i))}
      contentContainerStyle={{ padding: 14 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#2D7A5F" />}
      ListHeaderComponent={<Text style={styles.note}>{isAdmin ? 'Tap a user to change their role.' : 'View-only.'}</Text>}
      ListEmptyComponent={<Text style={styles.empty}>No users found (or you lack access to the rich user list).</Text>}
      renderItem={({ item }) => {
        const [bg, c] = ROLE_COLORS[item.role] || ['#f5f5f5', '#888'];
        return (
          <TouchableOpacity style={styles.row} activeOpacity={isAdmin ? 0.6 : 1} onPress={() => pickRole(item)}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{item.name || item.email || '(unknown)'}</Text>
              <Text style={styles.sub} numberOfLines={1}>{item.email || ''}{item.techName ? ` · ${item.techName}` : ''}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: bg }]}><Text style={[styles.badgeText, { color: c }]}>{item.role || '—'}</Text></View>
          </TouchableOpacity>
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
