import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { fetchUsersFull, setUserRole } from '../../lib/firestore';
import { auth } from '../../lib/firebase';
import { getCustomRoles } from '../../lib/customRoles';
import useTenantAccess from '../../hooks/useTenantAccess';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const ROLE_COLORS = {
  admin:     ['#eff6ff', '#2563eb'],
  manager:   ['#eef2ff', '#4f46e5'],
  scheduler: ['#f0fdf4', '#16a34a'],
  tech:      ['#faf5ff', '#7c3aed'],
  readonly:  ['#f5f5f5', '#888'],
  pending:   ['#fffbeb', '#b45309'],
  denied:    ['#fef2f2', '#b91c1c'],
};
const CUSTOM_ROLE_COLOR = ['#fdf2f8', '#be185d'];   // any custom_* role
// Assignable built-in roles + display labels. 'manager' was previously missing.
const BUILTIN_ROLES = ['admin', 'manager', 'scheduler', 'tech', 'readonly', 'denied'];
const ROLE_LABEL = { admin: 'Owner / admin', manager: 'Manager', scheduler: 'Front desk', tech: 'Staff (tech)', readonly: 'View only', denied: 'Denied', pending: 'Pending' };

// Users + roles. Admins can change a role; the write goes through
// setUserRole → saveUsers, a faithful port of the web writeBatch that
// updates data/usersFull + the rules projections atomically.
export default function AdminUsersScreen() {
  const { isAdmin } = useTenantAccess();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [users, setUsers] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [overlay, setOverlay] = useState({ roles: [] });
  const me = (auth.currentUser?.email || '').toLowerCase();

  const load = useCallback(async () => { try { setUsers(await fetchUsersFull()); } catch { setUsers([]); } }, []);
  useEffect(() => { load(); }, [load]);
  // Custom-role overlay so the picker can assign custom roles + label them.
  useEffect(() => { getCustomRoles().then(setOverlay).catch(() => {}); }, []);

  const customRoles = (overlay && Array.isArray(overlay.roles)) ? overlay.roles : [];
  const assignableRoles = [...BUILTIN_ROLES, ...customRoles.map(r => r.key)];
  const labelFor = (r) => customRoles.find(c => c.key === r)?.label || ROLE_LABEL[r] || r;
  const colorFor = (r) => ROLE_COLORS[r] || (String(r).startsWith('custom_') ? CUSTOM_ROLE_COLOR : ['#f5f5f5', '#888']);

  function pickRole(user) {
    if (!isAdmin || busy) return;
    const isSelf = (user.email || '').toLowerCase() === me;
    const opts = assignableRoles.filter(r => r !== user.role).map(r => ({
      text: labelFor(r),
      style: r === 'denied' ? 'destructive' : 'default',
      onPress: () => changeRole(user, r, isSelf),
    }));
    Alert.alert(`Change role — ${user.name || user.email}`, `Currently: ${labelFor(user.role) || '—'}`, [...opts, { text: 'Cancel', style: 'cancel' }]);
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

  if (users === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <FlatList
      style={styles.wrap}
      data={users}
      keyExtractor={(u, i) => (u.email || String(i))}
      contentContainerStyle={{ padding: 14 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}
      ListHeaderComponent={<Text style={styles.note}>{isAdmin ? 'Tap a user to change their role.' : 'View-only.'}</Text>}
      ListEmptyComponent={<Text style={styles.empty}>No users found (or you lack access to the rich user list).</Text>}
      renderItem={({ item }) => {
        const [bg, c] = colorFor(item.role);
        return (
          <TouchableOpacity style={styles.row} activeOpacity={isAdmin ? 0.6 : 1} onPress={() => pickRole(item)}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{item.name || item.email || '(unknown)'}</Text>
              <Text style={styles.sub} numberOfLines={1}>{item.email || ''}{item.techName ? ` · ${item.techName}` : ''}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: bg }]}><Text style={[styles.badgeText, { color: c }]}>{labelFor(item.role) || '—'}</Text></View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  note:    { fontSize: 12, color: t.textFaint, marginBottom: 10, paddingHorizontal: 2 },
  empty:   { textAlign: 'center', color: t.textFaint, marginTop: 50, fontSize: 13 },
  row:     { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.border, gap: 10 },
  name:    { fontSize: 15, fontWeight: '700', color: t.text },
  sub:     { fontSize: 12, color: t.textMuted, marginTop: 2 },
  badge:   { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText:{ fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
});
