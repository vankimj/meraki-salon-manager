import { useState, useEffect, useRef, useMemo } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { buildDayReplay } from '../lib/dayReplay';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

const COLORS = ['#2D7A5F', '#3D95CE', '#b8742f', '#8e5bd0', '#c0392b', '#0e9aa7', '#d4860b', '#5a7d2a'];
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shiftDay = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
const pretty = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };

// "Replay the day" — animates how the real rotation tallied on a chosen date.
// fetchDay(date) → { appointments, roster }.
export default function DayReplaySheet({ visible, onClose, services = [], turnMode = 'count', fetchDay, initialDate }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [date, setDate] = useState(initialDate || todayKey());
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);

  useEffect(() => { if (!visible) { setStep(0); setPlaying(false); setDate(initialDate || todayKey()); } }, [visible, initialDate]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setLoading(true); setStep(0); setPlaying(false);
    Promise.resolve(fetchDay(date)).then(d => { if (live) { setRaw(d || { appointments: [], roster: [] }); setLoading(false); } })
      .catch(() => { if (live) { setRaw({ appointments: [], roster: [] }); setLoading(false); } });
    return () => { live = false; };
  }, [date, visible, fetchDay]);

  const replay = useMemo(() => raw ? buildDayReplay({ appointments: raw.appointments, services, roster: raw.roster, turnMode, date }) : null, [raw, services, turnMode, date]);
  const nEvents = replay ? replay.events.length : 0;

  const advance = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setStep(s => Math.min(nEvents, s + 1)); };
  useEffect(() => {
    if (!playing) return;
    if (step >= nEvents) { setPlaying(false); return; }
    timer.current = setTimeout(advance, 1100);
    return () => clearTimeout(timer.current);
  }, [playing, step, nEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  const colorOf = useMemo(() => { const m = {}; (replay ? replay.techs : []).forEach((t, i) => { m[t.name] = COLORS[i % COLORS.length]; }); return m; }, [replay]);
  const unit = turnMode === 'value' ? 'pts' : 'turns';
  const fmt = (n) => turnMode === 'value' ? Math.round(n * 10) / 10 : n;
  const maxVal = replay ? Math.max(1, ...replay.techs.map(t => replay.finals[t.name] || 0)) : 1;
  const incoming = replay && step >= 1 && step <= nEvents ? replay.events[step - 1] : null;
  const done = replay && step >= nEvents;
  const cum = replay ? replay.cumulative[Math.min(step, nEvents)] : {};
  const setDay = (n) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setDate(d => shiftDay(d, n)); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>▶ Replay the day</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><Text style={styles.close}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
            <View style={styles.dayNav}>
              <TouchableOpacity onPress={() => setDay(-1)} style={styles.dayArrow}><Text style={styles.dayArrowText}>‹</Text></TouchableOpacity>
              <Text style={styles.dayLabel}>{pretty(date)}</Text>
              <TouchableOpacity onPress={() => setDay(1)} disabled={date >= todayKey()} style={styles.dayArrow}><Text style={[styles.dayArrowText, date >= todayKey() && { color: theme.textFaint }]}>›</Text></TouchableOpacity>
              <Text style={styles.modeTag}>{turnMode === 'value' ? 'by value' : 'by count'}</Text>
            </View>

            {loading ? (
              <View style={{ padding: 30, alignItems: 'center' }}><ActivityIndicator color={theme.green} /></View>
            ) : replay.isEmpty ? (
              <Text style={styles.empty}>No completed walk-ins or appointments for this day yet. Once tickets check out, they’ll replay here.</Text>
            ) : (
              <>
                <View style={styles.controls}>
                  <TouchableOpacity style={styles.playBtn} onPress={() => { if (done) { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setStep(0); setPlaying(true); } else setPlaying(p => !p); }}>
                    <Text style={styles.playBtnText}>{done ? '↺ Replay' : playing ? '⏸ Pause' : '▶ Play'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.stepBtn} disabled={done} onPress={() => { setPlaying(false); advance(); }}>
                    <Text style={[styles.stepBtnText, done && { color: theme.textFaint }]}>Step ›</Text>
                  </TouchableOpacity>
                  <Text style={styles.counter}>{step} / {nEvents}</Text>
                </View>

                <View style={[styles.incoming, incoming && styles.incomingOn]}>
                  <Text style={styles.incomingText}>
                    {incoming
                      ? `${incoming.startTime ? incoming.startTime + ' · ' : ''}${incoming.techName} took ${incoming.client}${incoming.services.length ? ' · ' + incoming.services.join(', ') : ''}  (+${fmt(incoming.credit)} ${unit}${incoming.requested ? ' · requested' : incoming.kind === 'walkin' ? ' · walk-in' : ''})`
                      : done ? 'End of day — final tally below.' : `Press ▶ to replay ${nEvents} checkout${nEvents === 1 ? '' : 's'}.`}
                  </Text>
                </View>

                {replay.techs.map(t => {
                  const v = cum[t.name] || 0;
                  const active = incoming && incoming.techName === t.name;
                  return (
                    <View key={t.name} style={{ marginBottom: 11 }}>
                      <View style={styles.barHead}>
                        <Text style={[styles.barName, { color: colorOf[t.name] }]}>
                          {t.name}{t.clockInAt ? <Text style={styles.barClock}>  🕘 {new Date(t.clockInAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</Text> : null}{active ? '  ＋' : ''}
                        </Text>
                        <Text style={styles.barMeta}>{fmt(v)} {unit}</Text>
                      </View>
                      <View style={styles.barTrack}>
                        <View style={{ flex: Math.max(0, v), backgroundColor: colorOf[t.name], borderRadius: 7 }} />
                        <View style={{ flex: Math.max(0.001, maxVal - v) }} />
                      </View>
                    </View>
                  );
                })}

                {done && (
                  <Text style={styles.note}>This is exactly how the rotation tallied — the lowest bar was always “next up.” {turnMode === 'value' ? 'Each ticket added its value at checkout.' : 'Each completed ticket added one turn.'}</Text>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.45)', justifyContent: 'flex-end' },
  sheet:    { backgroundColor: t.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '90%' },
  head:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: t.border },
  title:    { fontSize: 16, fontWeight: '800', color: t.text, flex: 1 },
  close:    { fontSize: 18, color: t.textMuted, fontWeight: '700', paddingLeft: 12 },
  dayNav:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  dayArrow: { paddingHorizontal: 10, paddingVertical: 4 },
  dayArrowText: { fontSize: 22, color: t.blue, fontWeight: '700' },
  dayLabel: { fontSize: 14, fontWeight: '800', color: t.text },
  modeTag:  { marginLeft: 'auto', fontSize: 11, color: t.textFaint, fontWeight: '700' },
  empty:    { fontSize: 13, color: t.textMuted, lineHeight: 19, padding: 12, textAlign: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  playBtn:  { backgroundColor: t.green, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  playBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  stepBtn:  { borderWidth: 1, borderColor: t.borderStrong, borderRadius: 8, paddingHorizontal: 13, paddingVertical: 9 },
  stepBtnText: { color: t.textMuted, fontWeight: '700', fontSize: 13 },
  counter:  { marginLeft: 'auto', fontSize: 12, color: t.textMuted, fontWeight: '700' },
  incoming: { minHeight: 40, borderRadius: 10, justifyContent: 'center', paddingHorizontal: 12, marginBottom: 12 },
  incomingOn: { backgroundColor: t.greenSoft },
  incomingText: { fontSize: 12.5, fontWeight: '700', color: t.text, textAlign: 'center', lineHeight: 17 },
  barHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 },
  barName:  { fontSize: 12.5, fontWeight: '700' },
  barClock: { fontSize: 10, fontWeight: '600', color: t.textFaint },
  barMeta:  { fontSize: 11.5, color: t.textMuted },
  barTrack: { flexDirection: 'row', height: 15, backgroundColor: t.surfaceAlt, borderRadius: 7, overflow: 'hidden' },
  note:     { fontSize: 12, color: t.textFaint, lineHeight: 17, marginTop: 8 },
});
