import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler, Alert } from 'react-native';
import PinPad from './PinPad';
import { verifyKioskPin } from '../lib/firestore';
import { clearKioskLocked } from '../lib/kioskLock';
import { auth } from '../lib/firebase';
import { useThemedStyles } from '../theme/ThemeContext';

// Full-screen launch gate shown whenever the device is in kiosk mode (persisted
// flag). Closes the force-quit-to-escape hole: relaunching a killed kiosk lands
// here, not in the signed-in app. Only a correct admin PIN (verifyKioskPin)
// clears the flag and lets the app render. Signing out goes to the login screen
// (no admin access) and the flag persists, so it's not a bypass.
export default function KioskLockGate({ onUnlock }) {
  const styles = useThemedStyles(makeStyles);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  async function submit(pin) {
    setBusy(true); setErr('');
    try {
      const res = await verifyKioskPin(pin);
      if (res?.ok) { await clearKioskLocked(); onUnlock?.(); return; }
      setErr('Wrong PIN');
    } catch (e) {
      setErr(String(e?.message || '').includes('no_kiosk_pin') ? 'No admin PIN on this account' : 'Wrong PIN');
    } finally { setBusy(false); }
  }

  function signOut() {
    Alert.alert('Sign out?', 'You can sign back in, but the kiosk stays locked until an admin PIN unlocks it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => auth.signOut().catch(() => {}) },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.lock}>🔒</Text>
        <PinPad title="Kiosk locked" subtitle="Enter your admin PIN to unlock this device" onSubmit={submit} error={err} busy={busy} />
        <TouchableOpacity onPress={signOut} style={styles.signout}><Text style={styles.signoutText}>Sign out</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:  { flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card:  { backgroundColor: t.surface, borderRadius: 24, padding: 28, width: '100%', maxWidth: 380, alignItems: 'center' },
  lock:  { fontSize: 44, marginBottom: 4 },
  signout: { marginTop: 18, paddingVertical: 8, paddingHorizontal: 20 },
  signoutText: { fontSize: 14, fontWeight: '700', color: t.textMuted },
});
