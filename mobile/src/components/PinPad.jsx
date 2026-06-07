import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

// Reusable numeric PIN pad. Auto-submits when `length` digits are entered.
// Used for tech clock-in/out and admin kiosk-exit.
export default function PinPad({ title, subtitle, onSubmit, onCancel, error, busy, length = 4 }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [pin, setPin] = useState('');
  const [dirty, setDirty] = useState(false);

  function press(d) {
    if (busy) return;
    setDirty(true);
    const next = (pin + d).slice(0, length);
    setPin(next);
    if (next.length === length) {
      setTimeout(() => { onSubmit(next); setPin(''); setDirty(false); }, 130);
    }
  }
  function del() { if (!busy) { setDirty(true); setPin(p => p.slice(0, -1)); } }

  const showErr = error && !dirty;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <View style={styles.wrap}>
      {!!title && <Text style={styles.title}>{title}</Text>}
      {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}
      <View style={styles.dots}>
        {Array.from({ length }).map((_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotFull, showErr && styles.dotErr]} />
        ))}
      </View>
      <Text style={[styles.err, !showErr && { opacity: 0 }]}>{showErr ? error : '·'}</Text>
      {busy ? (
        <ActivityIndicator color={theme.green} style={{ height: 220 }} />
      ) : (
        <View style={styles.grid}>
          {keys.map((k, i) => k === '' ? <View key={i} style={styles.key} /> : (
            <TouchableOpacity key={i} style={styles.key} onPress={() => k === 'del' ? del() : press(k)} activeOpacity={0.55}>
              <Text style={styles.keyText}>{k === 'del' ? '⌫' : k}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {onCancel && (
        <TouchableOpacity onPress={onCancel} style={styles.cancel}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:   { alignItems: 'center' },
  title:  { fontSize: 20, fontWeight: '800', color: t.text, textAlign: 'center' },
  sub:    { fontSize: 14, color: t.textMuted, marginTop: 4, textAlign: 'center' },
  dots:   { flexDirection: 'row', gap: 16, marginTop: 18 },
  dot:    { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: t.border, backgroundColor: 'transparent' },
  dotFull:{ backgroundColor: t.green, borderColor: t.green },
  dotErr: { borderColor: t.danger },
  err:    { fontSize: 13, color: t.danger, marginTop: 8, fontWeight: '600' },
  grid:   { flexDirection: 'row', flexWrap: 'wrap', width: 280, justifyContent: 'space-between', marginTop: 8 },
  key:    { width: 84, height: 64, alignItems: 'center', justifyContent: 'center' },
  keyText:{ fontSize: 28, fontWeight: '600', color: t.text },
  cancel: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 24 },
  cancelText:{ fontSize: 15, fontWeight: '700', color: t.textMuted },
});
