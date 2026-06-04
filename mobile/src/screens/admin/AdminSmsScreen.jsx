import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchSmsStatus } from '../../lib/firestore';

// Read-only SMS status: sandbox vs live + provisioned toll-free number.
// Provisioning/TFN registration is done on the web app.
export default function AdminSmsScreen() {
  const [s, setS] = useState(undefined);
  const load = useCallback(async () => { setS(await fetchSmsStatus()); }, []);
  useEffect(() => { load(); }, [load]);

  if (s === undefined) return <View style={styles.center}><ActivityIndicator color="#2D7A5F" /></View>;

  const live = !s.sandboxMode;
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#2D7A5F" />}>
      <View style={styles.card}>
        <Text style={styles.label}>Mode</Text>
        <View style={[styles.badge, { backgroundColor: live ? '#f0fdf4' : '#fffbeb' }]}>
          <Text style={[styles.badgeText, { color: live ? '#16a34a' : '#b45309' }]}>{live ? 'LIVE' : 'SANDBOX'}</Text>
        </View>
        <Text style={[styles.label, { marginTop: 16 }]}>Toll-free number</Text>
        <Text style={styles.value}>{s.tfn || 'Not provisioned'}</Text>
        {!!s.sms?.status && (<><Text style={[styles.label, { marginTop: 16 }]}>Registration</Text><Text style={styles.value}>{s.sms.status}</Text></>)}
      </View>
      <Text style={styles.note}>SMS provisioning, TFN registration, and TrustHub verification are managed on the web app.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#f5f7fa' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  card:    { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#ececec' },
  label:   { fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.3 },
  value:   { fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginTop: 4 },
  badge:   { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 },
  badgeText:{ fontSize: 12, fontWeight: '800' },
  note:    { fontSize: 12, color: '#aaa', marginTop: 14, lineHeight: 17 },
});
