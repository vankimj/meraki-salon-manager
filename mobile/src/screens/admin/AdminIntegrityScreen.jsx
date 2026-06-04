import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchIntegrityReport } from '../../lib/firestore';

// Read-only view of the nightly integrity scanner report. Each check has a
// status (ok|warn|error) + detail; mirrors the web IntegrityReportModal.
const CHECKS = [
  ['usersFullSync',        'Staff projection sync'],
  ['orphanedAppointments', 'Appointments without a client'],
  ['orphanedReceipts',     'Receipts without an appointment'],
  ['employeesWithoutComp', 'Employees missing comp/tax'],
  ['staleTombstones',      'Tombstones overdue for purge'],
];
const COLOR = { ok: ['#f0fdf4', '#16a34a', '✓'], warn: ['#fffbeb', '#b45309', '⚠'], error: ['#fef2f2', '#b91c1c', '⚠'] };

export default function AdminIntegrityScreen() {
  const [report, setReport] = useState(undefined);
  const load = useCallback(async () => { setReport(await fetchIntegrityReport()); }, []);
  useEffect(() => { load(); }, [load]);

  if (report === undefined) return <View style={styles.center}><ActivityIndicator color="#2D7A5F" /></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#2D7A5F" />}>
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

const styles = StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: '#f5f7fa' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  empty:     { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 13, lineHeight: 19 },
  generated: { fontSize: 12, color: '#888', marginBottom: 14 },
  card:      { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  cardHead:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  glyph:     { fontSize: 16, fontWeight: '800' },
  label:     { fontSize: 14.5, fontWeight: '700', color: '#1a1a1a' },
  detail:    { fontSize: 12.5, color: '#555', marginTop: 5 },
  sample:    { fontSize: 11.5, color: '#888', marginTop: 4, fontStyle: 'italic' },
  note:      { fontSize: 12, color: '#aaa', marginTop: 14, lineHeight: 17 },
});
