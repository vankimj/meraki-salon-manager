import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, BackHandler } from 'react-native';
import PinPad from './PinPad';
import { verifyKioskPin } from '../lib/firestore';
import { clearKioskLocked } from '../lib/kioskLock';
import { useThemedStyles } from '../theme/ThemeContext';

// Locked-kiosk exit. The app stays signed in as the admin who entered kiosk mode,
// so leaving requires that same admin to punch their kiosk PIN (verified
// server-side). Also swallows the Android hardware back button while mounted, so
// the kiosk cannot be navigated away from any other way.
export default function KioskExitButton({ onExit, label = 'Exit kiosk' }) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true); // block
    return () => sub.remove();
  }, []);

  async function submit(pin) {
    setBusy(true); setErr('');
    try {
      const res = await verifyKioskPin(pin);
      if (res?.ok) { await clearKioskLocked(); setOpen(false); onExit?.(); return; }
      setErr('Wrong PIN');
    } catch (e) {
      setErr(String(e?.message || '').includes('no_kiosk_pin')
        ? 'No admin PIN set — set one in Settings'
        : 'Wrong PIN');
    } finally { setBusy(false); }
  }

  return (
    <>
      <TouchableOpacity style={styles.btn} onPress={() => { setErr(''); setOpen(true); }} activeOpacity={0.7}>
        <Text style={styles.btnText}>🔒 {label}</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <PinPad title="Admin PIN" subtitle="Enter your PIN to leave kiosk mode"
              onSubmit={submit} onCancel={() => setOpen(false)} error={err} busy={busy} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (t) => StyleSheet.create({
  btn:      { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: t.surfaceMuted, borderWidth: 1, borderColor: t.border },
  btnText:  { fontSize: 12.5, fontWeight: '700', color: t.textMuted },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card:     { backgroundColor: t.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 },
});
