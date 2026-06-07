import { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { fetchTurnRoster, fetchWaitlist, fetchEmployees, fetchSettings } from '../../lib/firestore';
import TechAvatar from '../../components/TechAvatar';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const fmtTurns = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(1); };

// Read-only walk-in monitor for the clock kiosk: shows the live turn rotation
// (same sort as the Walk-in Manager) and the current waitlist. Polls every 15s.
// No edit controls — purely a display.
export default function WalkinMonitor() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [roster, setRoster]   = useState(null);
  const [waiting, setWaiting] = useState([]);
  const [emps, setEmps]       = useState([]);
  const [seniority, setSeniority] = useState(false);

  const load = useCallback(async () => {
    const [r, w, e, s] = await Promise.all([
      fetchTurnRoster(),
      fetchWaitlist(),
      fetchEmployees().catch(() => []),
      fetchSettings().catch(() => ({})),
    ]);
    setRoster(r.roster || []);
    setWaiting((w || []).filter(x => x.status !== 'seated'));
    setEmps(e || []);
    setSeniority(!!s?.walkinSeniorityOrder);
  }, []);
  useEffect(() => {
    load().catch(() => {});
    const id = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(id);
  }, [load]);

  if (roster === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  const senById = {}, photoByTech = {};
  emps.forEach(e => { senById[e.id] = Number.isFinite(e.sortOrder) ? e.sortOrder : 999; if (e.name) photoByTech[e.name] = e.photo; });
  const sorted = [...roster].sort((a, b) =>
    (a.away ? 1 : 0) - (b.away ? 1 : 0)
    || (a.turnsTaken || 0) - (b.turnsTaken || 0)
    || (seniority ? ((senById[a.techId] ?? 999) - (senById[b.techId] ?? 999)) : 0)
    || (a.clockInAt || '').localeCompare(b.clockInAt || ''));

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.section}>Rotation — next up</Text>
      {sorted.length === 0 ? <Text style={styles.empty}>No techs in the rotation.</Text> : sorted.map((t, i) => {
        const isNext = i === 0 && !t.away;
        return (
          <View key={t.techId} style={[styles.row, isNext && styles.nextRow, t.away && { opacity: 0.55 }]}>
            <Text style={[styles.pos, isNext && styles.posNext]}>{isNext ? '⭐' : i + 1}</Text>
            <TechAvatar name={t.techName} photo={photoByTech[t.techName]} size={42} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.name}>{t.techName}{t.away ? '  💤 away' : ''}</Text>
              <Text style={styles.sub}>{fmtTurns(t.turnsTaken)} turn{(t.turnsTaken || 0) === 1 ? '' : 's'} today</Text>
            </View>
          </View>
        );
      })}

      <Text style={styles.section}>Waitlist ({waiting.length})</Text>
      {waiting.length === 0 ? <Text style={styles.empty}>No one waiting.</Text> : waiting.map((w, i) => {
        const svc = (w.serviceNames && w.serviceNames.length) ? w.serviceNames.join(', ') : (w.services || '');
        const pref = w.requestedTechName ? `wants ${w.requestedTechName}` : 'no preference';
        return (
          <View key={w.id} style={styles.row}>
            <Text style={styles.pos}>{i + 1}</Text>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.name}>{w.clientName || 'Walk-in'}</Text>
              <Text style={styles.sub} numberOfLines={1}>{[svc, pref].filter(Boolean).join(' · ')}</Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content:  { padding: 16, paddingBottom: 40, maxWidth: 720, alignSelf: 'center', width: '100%' },
  section:  { fontSize: 15, fontWeight: '800', color: t.text, marginTop: 18, marginBottom: 10 },
  empty:    { color: t.textFaint, fontSize: 14, paddingVertical: 12 },
  row:      { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: t.border },
  nextRow:  { borderColor: t.green, backgroundColor: t.greenSoft },
  pos:      { width: 30, fontSize: 18, fontWeight: '800', color: t.textMuted, textAlign: 'center' },
  posNext:  { color: t.green },
  name:     { fontSize: 17, fontWeight: '700', color: t.text },
  sub:      { fontSize: 13, color: t.textMuted, marginTop: 2 },
});
