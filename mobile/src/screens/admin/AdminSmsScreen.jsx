import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchSmsStatus } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Read-only SMS status: sandbox vs live + provisioned toll-free number.
// Provisioning/TFN registration is done on the web app.
export default function AdminSmsScreen() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [s, setS] = useState(undefined);
  const load = useCallback(async () => { setS(await fetchSmsStatus()); }, []);
  useEffect(() => { load(); }, [load]);

  if (s === undefined) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  const live = !s.sandboxMode;
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}>
      <View style={styles.card}>
        <Text style={styles.label}>Mode</Text>
        <View style={[styles.badge, { backgroundColor: live ? theme.greenSoft : theme.warningBg }]}>
          <Text style={[styles.badgeText, { color: live ? theme.success : theme.warning }]}>{live ? 'LIVE' : 'SANDBOX'}</Text>
        </View>
        <Text style={[styles.label, { marginTop: 16 }]}>Toll-free number</Text>
        <Text style={styles.value}>{s.tfn || 'Not provisioned'}</Text>
        {!!s.sms?.status && (<><Text style={[styles.label, { marginTop: 16 }]}>Registration</Text><Text style={styles.value}>{s.sms.status}</Text></>)}
      </View>
      <Text style={styles.note}>SMS provisioning, TFN registration, and TrustHub verification are managed on the web app.</Text>
    </ScrollView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  card:    { backgroundColor: t.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: t.border },
  label:   { fontSize: 11, fontWeight: '700', color: t.textFaint, textTransform: 'uppercase', letterSpacing: 0.3 },
  value:   { fontSize: 16, fontWeight: '600', color: t.text, marginTop: 4 },
  badge:   { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 },
  badgeText:{ fontSize: 12, fontWeight: '800' },
  note:    { fontSize: 12, color: t.textFaint, marginTop: 14, lineHeight: 17 },
});
