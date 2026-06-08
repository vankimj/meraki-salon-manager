import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { authenticateBiometric } from '../lib/biometricLock';

// Full-screen Face ID / Touch ID lock shown at launch when the app-lock pref is
// on. Prompts immediately; an Unlock button lets the user retry if they cancel.
export default function BiometricGate({ onUnlock }) {
  const [tried, setTried] = useState(false);
  const run = useCallback(async () => {
    setTried(true);
    if (await authenticateBiometric()) onUnlock?.();
  }, [onUnlock]);
  useEffect(() => { run(); }, [run]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.lock}>🔒</Text>
      <Text style={styles.title}>Plume Nexus is locked</Text>
      <Text style={styles.sub}>Unlock with Face ID to continue.</Text>
      <TouchableOpacity style={styles.btn} onPress={run}>
        <Text style={styles.btnText}>{tried ? 'Try again' : 'Unlock'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f1923', padding: 32 },
  lock:  { fontSize: 52 },
  title: { fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 16 },
  sub:   { fontSize: 14, color: 'rgba(255,255,255,.6)', marginTop: 8, textAlign: 'center' },
  btn:   { marginTop: 28, backgroundColor: '#2D7A5F', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40 },
  btnText:{ color: '#fff', fontWeight: '800', fontSize: 15 },
});
