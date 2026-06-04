import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchIntegrityReport } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Read-only view of the nightly integrity scanner report. Each check has a
// status (ok|warn|error) + detail; mirrors the web IntegrityReportModal.
const CHECKS = [
  ['usersFullSync',        'Staff projection sync'],
  ['orphanedAppointments', 'Appointments without a client'],
  ['orphanedReceipts',     'Receipts without an appointment'],
  ['employeesWithoutComp', 'Employees missing comp/tax'],
  ['staleTombstones',      'Tombstones overdue for purge'],
];

export default function AdminIntegrityScreen() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const COLOR = {
    ok:    [theme.greenSoft,  theme.success, '✓'],
    warn:  [theme.warningBg,  theme.warning,  '⚠'],
    error: [theme.dangerBg,   theme.danger,   '⚠'],
  };

  const [report, setReport] = useState(undefined);
  const load = useCallback(async () => { setReport(await fetchIntegrityReport()); }, []);
  useEffect(() => { load(); }, [load]);

  if (report === undefined) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}>
      {!report ? (
        <Text style={styles.empty}>No scan yet. The integrity scanner runs nightly at 4am ET.</Text>
      ) : (
        <>
          <Text style={styles.generated}>
            Last scan: {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : 'unknown'}
          </Text>
          {CHECKS.map(([key, label]) => {
            const check = report[key] || {};
            const [bg, c, glyph] = COLOR[check.status] || COLOR.ok;
            return (
              <View key={key} style={[styles.card, { backgroundColor: bg }]}>
                <View style={styles.cardHead}>
                  <Text style={[styles.glyph, { color: c }]}>{glyph}</Text>
                  <Text style={styles.label}>{label}</Text>
                </View>
                {!!check.detail && <Text style={styles.detail}>{check.detail}</Text>}
                {Array.isArray(check.sample) && check.sample.length > 0 && (
                  <Text style={styles.sample}>e.g. {check.sample.slice(0, 3).join(', ')}</Text>
                )}
              </View>
            );
          })}
          <Text style={styles.note}>For specific deleted records, use the Trash. Restore lives in Admin → Trash and per-module.</Text>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: t.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  empty:     { textAlign: 'center', color: t.textFaint, marginTop: 40, fontSize: 13, lineHeight: 19 },
  generated: { fontSize: 12, color: t.textMuted, marginBottom: 14 },
  card:      { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  cardHead:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  glyph:     { fontSize: 16, fontWeight: '800' },
  label:     { fontSize: 14.5, fontWeight: '700', color: t.text },
  detail:    { fontSize: 12.5, color: t.textMuted, marginTop: 5 },
  sample:    { fontSize: 11.5, color: t.textMuted, marginTop: 4, fontStyle: 'italic' },
  note:      { fontSize: 12, color: t.textFaint, marginTop: 14, lineHeight: 17 },
});
