import { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchClients } from '../lib/firestore';
import useTenantAccess from '../hooks/useTenantAccess';
import useTrashHeader from '../hooks/useTrashHeader';

export default function ClientsScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['clients'], isAdmin);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query,   setQuery]   = useState('');

  const load = useCallback(async () => {
    try {
      setClients(await fetchClients());
    } catch {
      setClients([]);
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Refresh when the user returns to the list (e.g. after editing a
  // client in the detail screen) so changes show without a hard reload.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    if (!query.trim()) return clients;
    const q = query.toLowerCase();
    return clients.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q)
    );
  }, [clients, query]);

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search clients…"
          placeholderTextColor="#bbb"
          style={styles.searchInput}
          clearButtonMode="while-editing"
        />
      </View>

      {loading
        ? <ActivityIndicator style={{ marginTop: 40 }} color="#3D95CE" />
        : (
          <FlatList
            data={filtered}
            keyExtractor={c => c.id}
            contentContainerStyle={{ paddingBottom: 24 }}
            ListEmptyComponent={<Text style={styles.empty}>No clients found</Text>}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => {
                  setRefreshing(true);
                  await load();
                  setRefreshing(false);
                }}
                tintColor="#3D95CE"
              />
            }
            renderItem={({ item: c }) => (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('ClientDetail', { clientId: c.id, clientName: c.name })}
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
                </View>
                {c.visits?.length > 0 && (
                  <Text style={styles.visitCount}>{c.visits.length} visit{c.visits.length !== 1 ? 's' : ''}</Text>
                )}
              </TouchableOpacity>
            )}
          />
        )
      }
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  searchRow: {
    padding: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ebebeb',
  },
  searchInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#1a1a1a',
  },
  empty: { textAlign: 'center', color: '#aaa', marginTop: 60, fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
    gap: 12,
  },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: { backgroundColor: '#e8f4f0', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 16, fontWeight: '700', color: '#2D7A5F' },
  info: { flex: 1 },
  clientName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  clientSub: { fontSize: 11, color: '#888', marginTop: 2 },
  visitCount: { fontSize: 11, color: '#3D95CE', fontWeight: '600' },
});
