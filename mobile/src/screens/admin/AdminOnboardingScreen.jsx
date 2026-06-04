import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchOnboarding } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

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

const getStatus = (t) => ({
  done:    [t.greenSoft, t.success,  '✓'],
  skipped: [t.surfaceAlt, t.textMuted, '–'],
  pending: [t.warningBg, t.warning,  '○'],
});

export default function AdminOnboardingScreen() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const STATUS = getStatus(theme);

  const [ob, setOb] = useState(undefined);
  const load = useCallback(async () => { setOb(await fetchOnboarding()); }, []);
  useEffect(() => { load(); }, [load]);

  if (ob === undefined) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  const statusOf = (k) => ob?.phases?.[k]?.status || 'pending';
  const doneCount = PHASES.filter(([k]) => ['done', 'skipped'].includes(statusOf(k))).length;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}>
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

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  summary: { fontSize: 13, fontWeight: '700', color: t.text, marginBottom: 14 },
  row:     { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.border },
  dot:     { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  glyph:   { fontSize: 14, fontWeight: '800' },
  label:   { flex: 1, fontSize: 14.5, fontWeight: '600', color: t.text },
  status:  { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  note:    { fontSize: 12, color: t.textFaint, marginTop: 14, lineHeight: 17 },
});
