import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { seedDemoData, clearDemoData } from '../../lib/firestore';

// LEAN mobile demo seeder — 15 demo clients + ~2 appts each, all tagged
// _demo:true. NOT the web's 600-client batch (that stays on web, where it
// has checkpoint + logout-pause). Clear removes exactly the _demo rows.
export default function AdminDemoScreen() {
  const [running, setRunning] = useState(false);
  const [status,  setStatus]  = useState('');

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
      {running && <ActivityIndicator color="#2D7A5F" style={{ marginTop: 16 }} />}
      {!!status && <Text style={styles.status}>{status}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:     { flex: 1, backgroundColor: '#f5f7fa', padding: 16 },
  note:     { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 18 },
  btn:      { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 12, borderWidth: 1 },
  seed:     { backgroundColor: '#eef5f2', borderColor: '#2D7A5F' },
  seedText: { color: '#2D7A5F', fontWeight: '800', fontSize: 15 },
  clear:    { backgroundColor: '#fdecea', borderColor: '#e7b4ad' },
  clearText:{ color: '#c0392b', fontWeight: '800', fontSize: 15 },
  status:   { fontSize: 12.5, color: '#888', marginTop: 16, textAlign: 'center' },
});
