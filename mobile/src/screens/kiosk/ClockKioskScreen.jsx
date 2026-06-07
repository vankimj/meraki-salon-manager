import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchEmployees, fetchAttendance, clockEvent } from '../../lib/firestore';
import PinPad from '../../components/PinPad';
import KioskExitButton from '../../components/KioskExitButton';
import WalkinMonitor from './WalkinMonitor';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shortName(n) {
  const p = String(n || '').trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : (p[0] || '?');
}
function initials(n) {
  const p = String(n || '?').trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}

// Self-service clock kiosk: tiles of each tech (photo + first name / last
// initial). Tap → enter your PIN → toggles clock in/out (verified server-side,
// alerts all admins). Locked: only an admin's kiosk PIN exits.
export default function ClockKioskScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [emps, setEmps]       = useState(null);
  const [byEmp, setByEmp]     = useState({});
  const [sel, setSel]         = useState(null);     // employee being PIN-prompted
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [confirm, setConfirm] = useState(null);     // { name, kind, time }
  const [mode, setMode]       = useState('menu');   // menu | timeclock | monitor

  const load = useCallback(async () => {
    const [employees, day] = await Promise.all([fetchEmployees(), fetchAttendance(todayKey())]);
    setEmps((employees || []).filter(e => e.active !== false && e.name).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    const m = {}; (day.entries || []).forEach(e => { m[e.employeeId] = e; }); setByEmp(m);
  }, []);
  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  // Lock: hide the bottom tab bar while focused so the kiosk can't be left via
  // a tab without the admin PIN (back gesture is disabled in ManageStack; the
  // KioskExitButton blocks Android hardware-back). Mirrors the front-desk kiosk.
  useFocusEffect(useCallback(() => {
    const parent = navigation.getParent();
    parent?.setOptions({ tabBarStyle: { display: 'none' } });
    return () => parent?.setOptions({ tabBarStyle: undefined });
  }, [navigation]));

  const stateOf = (id) => { const e = byEmp[id]; return (e && e.clockInAt && !e.clockOutAt) ? 'in' : 'out'; };

  async function submitPin(pin) {
    if (!sel) return;
    setBusy(true); setErr('');
    const kind = stateOf(sel.id) === 'in' ? 'out' : 'in';
    try {
      await clockEvent({ employeeId: sel.id, kind, pin });
      const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const name = shortName(sel.name);
      setSel(null);
      setConfirm({ name, kind, time });
      await load();
      setTimeout(() => setConfirm(null), 2600);
    } catch (e) {
      const m = String(e?.message || '');
      setErr(m.includes('Wrong PIN') ? 'Wrong PIN'
        : m.includes('No PIN') ? 'No PIN set — ask an admin'
        : m.toLowerCase().includes('already') ? 'Already clocked that way'
        : 'Could not clock — try again');
    } finally { setBusy(false); }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        {mode === 'menu'
          ? <Text style={styles.h1}>Clock Kiosk</Text>
          : <TouchableOpacity onPress={() => setMode('menu')} style={styles.backBtn}><Text style={styles.backText}>‹ Menu</Text></TouchableOpacity>}
        {mode !== 'menu' && <Text style={styles.h1Sub} numberOfLines={1}>{mode === 'timeclock' ? 'Time Clock' : 'Walk-in Monitor'}</Text>}
        <KioskExitButton onExit={() => navigation.goBack()} />
      </View>

      {mode === 'menu' && (
        <View style={styles.menu}>
          <TouchableOpacity style={styles.menuTile} activeOpacity={0.85} onPress={() => setMode('timeclock')}>
            <Text style={styles.menuEmoji}>🕒</Text>
            <Text style={styles.menuTitle}>Time Clock</Text>
            <Text style={styles.menuDesc}>Clock in / out by PIN</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuTile} activeOpacity={0.85} onPress={() => setMode('monitor')}>
            <Text style={styles.menuEmoji}>📋</Text>
            <Text style={styles.menuTitle}>Walk-in Monitor</Text>
            <Text style={styles.menuDesc}>Live rotation + waitlist</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'monitor' && <WalkinMonitor />}

      {mode === 'timeclock' && (
        emps === null ? (
          <View style={styles.center}><ActivityIndicator color={theme.green} /></View>
        ) : emps.length === 0 ? (
          <View style={styles.center}><Text style={styles.empty}>No active team members.</Text></View>
        ) : (
          <ScrollView contentContainerStyle={styles.grid}>
            {emps.map(e => {
              const on = stateOf(e.id) === 'in';
              return (
                <TouchableOpacity key={e.id} style={styles.tile} activeOpacity={0.8} onPress={() => { setErr(''); setSel(e); }}>
                  {e.photo
                    ? <Image source={{ uri: e.photo }} style={styles.avatar} />
                    : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarInit}>{initials(e.name)}</Text></View>}
                  <Text style={styles.tileName} numberOfLines={1}>{shortName(e.name)}</Text>
                  <View style={[styles.badge, on ? styles.badgeIn : styles.badgeOut]}>
                    <Text style={[styles.badgeText, on ? styles.badgeTextIn : styles.badgeTextOut]}>{on ? 'Clocked in' : 'Clocked out'}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )
      )}

      {/* PIN entry */}
      <Modal visible={!!sel} transparent animationType="fade" onRequestClose={() => setSel(null)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <PinPad
              title={sel ? shortName(sel.name) : ''}
              subtitle={sel ? (stateOf(sel.id) === 'in' ? 'Enter PIN to clock OUT' : 'Enter PIN to clock IN') : ''}
              onSubmit={submitPin}
              onCancel={() => { setSel(null); setErr(''); }}
              error={err}
              busy={busy}
            />
          </View>
        </View>
      </Modal>

      {/* Confirmation */}
      <Modal visible={!!confirm} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmCheck}>{confirm?.kind === 'in' ? '✅' : '👋'}</Text>
            <Text style={styles.confirmText}>
              {confirm?.name} {confirm?.kind === 'in' ? 'clocked in' : 'clocked out'}
            </Text>
            <Text style={styles.confirmTime}>{confirm?.time}</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  h1:      { fontSize: 24, fontWeight: '800', color: t.text },
  h1Sub:   { fontSize: 20, fontWeight: '800', color: t.text, flex: 1, textAlign: 'center', marginHorizontal: 10 },
  backBtn: { paddingVertical: 6, paddingRight: 12 },
  backText:{ fontSize: 17, fontWeight: '700', color: t.green },
  menu:    { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 },
  menuTile:{ width: 240, height: 210, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface, borderRadius: 24, borderWidth: 1, borderColor: t.border, padding: 20 },
  menuEmoji:{ fontSize: 54 },
  menuTitle:{ fontSize: 22, fontWeight: '800', color: t.text, marginTop: 14 },
  menuDesc: { fontSize: 14, color: t.textMuted, marginTop: 6, textAlign: 'center' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:   { color: t.textMuted, fontSize: 15 },
  grid:    { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16, padding: 16 },
  tile:    { width: 150, alignItems: 'center', backgroundColor: t.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: t.border },
  avatar:  { width: 84, height: 84, borderRadius: 42 },
  avatarFallback: { backgroundColor: t.greenSoft, alignItems: 'center', justifyContent: 'center' },
  avatarInit: { fontSize: 30, fontWeight: '800', color: t.green },
  tileName:{ fontSize: 16, fontWeight: '700', color: t.text, marginTop: 10 },
  badge:   { marginTop: 8, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12 },
  badgeIn: { backgroundColor: t.greenSoft },
  badgeOut:{ backgroundColor: t.surfaceMuted },
  badgeText:   { fontSize: 12, fontWeight: '800' },
  badgeTextIn: { color: t.green },
  badgeTextOut:{ color: t.textMuted },
  backdrop:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card:    { backgroundColor: t.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 },
  confirmCard: { backgroundColor: t.surface, borderRadius: 24, padding: 36, alignItems: 'center', maxWidth: 360 },
  confirmCheck:{ fontSize: 56 },
  confirmText: { fontSize: 22, fontWeight: '800', color: t.text, marginTop: 12, textAlign: 'center' },
  confirmTime: { fontSize: 16, color: t.textMuted, marginTop: 4 },
});
