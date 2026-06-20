import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchClients } from '../lib/firestore';
import useTenantAccess from '../hooks/useTenantAccess';
import useTrashHeader from '../hooks/useTrashHeader';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

const ClientRow = memo(function ClientRow({ client: c, styles, onPress }) {
  const handlePress = useCallback(() => onPress(c.id, c.name), [onPress, c.id, c.name]);
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={handlePress}
    >
      {c.picture
        ? <Image source={{ uri: c.picture }} style={styles.avatar} />
        : <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{(c.name || '?')[0].toUpperCase()}</Text>
          </View>
      }
      <View style={styles.info}>
        <Text style={styles.clientName}>{c.name}</Text>
        <Text style={styles.clientSub}>
          {[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact info'}
        </Text>
        {Number(c.credit) > 0 && <Text style={styles.creditPill}>💳 ${Number(c.credit).toFixed(2)} credit</Text>}
      </View>
      {c.visits?.length > 0 && (
        <Text style={styles.visitCount}>{c.visits.length} visit{c.visits.length !== 1 ? 's' : ''}</Text>
      )}
    </TouchableOpacity>
  );
});

export default function ClientsScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['clients'], isAdmin);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query,   setQuery]   = useState('');

  const lastLoadedAt = useRef(0);

  const load = useCallback(async () => {
    try {
      setClients(await fetchClients());
      lastLoadedAt.current = Date.now();
    } catch {
      setClients([]);
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Refresh when the user returns to the list (e.g. after editing a
  // client in the detail screen) so changes show without a hard reload —
  // but skip the refetch on the initial focus and whenever we loaded the
  // full collection within the last 30s, so a quick back/forward doesn't
  // re-pull 500+ base64 avatars on every focus.
  useFocusEffect(useCallback(() => {
    if (Date.now() - lastLoadedAt.current < 30000) return;
    load();
  }, [load]));

  const filtered = useMemo(() => {
    if (!query.trim()) return clients;
    const q = query.toLowerCase();
    return clients.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q)
    );
  }, [clients, query]);

  const openClient = useCallback(
    (clientId, clientName) => navigation.navigate('ClientDetail', { clientId, clientName }),
    [navigation]
  );

  const keyExtractor = useCallback(c => c.id, []);

  const renderItem = useCallback(
    ({ item: c }) => <ClientRow client={c} styles={styles} onPress={openClient} />,
    [styles, openClient]
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search clients…"
          placeholderTextColor={theme.placeholder}
          style={styles.searchInput}
          clearButtonMode="while-editing"
        />
      </View>

      {loading
        ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.blue} />
        : (
          <FlatList
            data={filtered}
            keyExtractor={keyExtractor}
            contentContainerStyle={{ paddingBottom: 24 }}
            ListEmptyComponent={<Text style={styles.empty}>No clients found</Text>}
            removeClippedSubviews
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={7}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => {
                  setRefreshing(true);
                  await load();
                  setRefreshing(false);
                }}
                tintColor={theme.blue}
              />
            }
            renderItem={renderItem}
          />
        )
      }
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  searchRow: {
    padding: 12,
    backgroundColor: t.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  searchInput: {
    backgroundColor: t.surfaceAlt,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    fontSize: 14,
    color: t.text,
  },
  empty: { textAlign: 'center', color: t.textFaint, marginTop: 60, fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surface,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
    gap: 12,
  },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: { backgroundColor: t.greenSoft, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 16, fontWeight: '700', color: t.green },
  info: { flex: 1 },
  clientName: { fontSize: 14, fontWeight: '600', color: t.text },
  creditPill: { fontSize: 11, fontWeight: '700', color: t.green, marginTop: 2 },
  clientSub: { fontSize: 11, color: t.textMuted, marginTop: 2 },
  visitCount: { fontSize: 11, color: t.blue, fontWeight: '600' },
});
