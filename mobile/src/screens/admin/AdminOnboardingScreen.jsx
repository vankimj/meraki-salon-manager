import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchOnboarding } from '../../lib/firestore';

// Read-only onboarding progress (mirrors web onboarding PHASES + status).
const PHASES = [
  ['welcome',  'Welcome'],
  ['profile',  'Salon profile'],
  ['import',   'Bring your stuff'],
  ['money',    'Money + compliance'],
  ['branding', 'Look & feel'],
  ['team',     'Your team'],
  ['reach',    'Reach your clients'],
  ['launch',   'Launch'],
];
const STATUS = {
  done:    ['#f0fdf4', '#16a34a', '✓'],
  skipped: ['#f5f5f5', '#888',    '–'],
  pending: ['#fffbeb', '#b45309', '○'],
};

export default function AdminOnboardingScreen() {
  const [ob, setOb] = useState(undefined);
  const load = useCallback(async () => { setOb(await fetchOnboarding()); }, []);
  useEffect(() => { load(); }, [load]);

  if (ob === undefined) return <View style={styles.center}><ActivityIndicator color="#2D7A5F" /></View>;

  const statusOf = (k) => ob?.phases?.[k]?.status || 'pending';
  const doneCount = PHASES.filter(([k]) => ['done', 'skipped'].includes(statusOf(k))).length;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#2D7A5F" />}>
      <Text style={styles.summary}>{doneCount} of {PHASES.length} steps complete{ob?.completedAt ? ' · onboarding finished 🎉' : ''}</Text>
      {PHASES.map(([key, label]) => {
        const [bg, c, glyph] = STATUS[statusOf(key)] || STATUS.pending;
        return (
          <View key={key} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: bg }]}><Text style={[styles.glyph, { color: c }]}>{glyph}</Text></View>
            <Text style={styles.label}>{label}</Text>
            <Text style={[styles.status, { color: c }]}>{statusOf(key)}</Text>
          </View>
        );
      })}
      <Text style={styles.note}>Run the setup wizard on the web app to complete remaining steps.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#f5f7fa' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  summary: { fontSize: 13, fontWeight: '700', color: '#1a1a1a', marginBottom: 14 },
  row:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#ececec' },
  dot:     { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  glyph:   { fontSize: 14, fontWeight: '800' },
  label:   { flex: 1, fontSize: 14.5, fontWeight: '600', color: '#1a1a1a' },
  status:  { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  note:    { fontSize: 12, color: '#aaa', marginTop: 14, lineHeight: 17 },
});
