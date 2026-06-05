import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { seedDemoData, clearDemoData } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// LEAN mobile demo seeder — 15 demo clients + ~2 appts each, all tagged
// _demo:true. NOT the web's 600-client batch (that stays on web, where it
// has checkpoint + logout-pause). Clear removes exactly the _demo rows.
export default function AdminDemoScreen() {
  const [running, setRunning] = useState(false);
  const [status,  setStatus]  = useState('');
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();

  function confirmSeed() {
    Alert.alert('Seed demo data?', 'Adds 15 demo clients + sample appointments (tagged _demo) to THIS salon. Use only in a test/demo tenant.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Seed', onPress: () => run(seedDemoData, 'Seeded') },
    ]);
  }
  function confirmClear() {
    Alert.alert('Clear demo data?', 'Permanently deletes every record tagged _demo. Real data is untouched.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => run(clearDemoData, 'Cleared') },
    ]);
  }
  async function run(fn, verb) {
    setRunning(true); setStatus('Working…');
    try { const res = await fn(setStatus); setStatus(`${verb}. ${JSON.stringify(res)}`); }
    catch (e) { setStatus(''); Alert.alert('Failed', e?.message || 'Try again.'); }
    finally { setRunning(false); }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.note}>The full-scale seed (hundreds of clients) lives on the web app. This is a quick, lightweight seed for mobile testing.</Text>
      <TouchableOpacity style={[styles.btn, styles.seed, running && { opacity: 0.6 }]} onPress={confirmSeed} disabled={running}>
        <Text style={styles.seedText}>＋ Seed demo data (15 clients)</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.clear, running && { opacity: 0.6 }]} onPress={confirmClear} disabled={running}>
        <Text style={styles.clearText}>🗑 Clear demo data</Text>
      </TouchableOpacity>
      {running && <ActivityIndicator color={theme.green} style={{ marginTop: 16 }} />}
      {!!status && <Text style={styles.status}>{status}</Text>}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:     { flex: 1, backgroundColor: t.bg, padding: 16 },
  note:     { fontSize: 13, color: t.textMuted, lineHeight: 19, marginBottom: 18 },
  btn:      { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 12, borderWidth: 1 },
  seed:     { backgroundColor: t.greenSoft, borderColor: t.green },
  seedText: { color: t.green, fontWeight: '800', fontSize: 15 },
  clear:    { backgroundColor: t.dangerBg, borderColor: t.danger },
  clearText:{ color: t.danger, fontWeight: '800', fontSize: 15 },
  status:   { fontSize: 12.5, color: t.textMuted, marginTop: 16, textAlign: 'center' },
});
