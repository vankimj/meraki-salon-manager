import { useState, useEffect, useMemo, useRef } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { TURN_HELP as H } from '../lib/turnHelp';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const COLORS = { Anna: '#2D7A5F', Bao: '#3D95CE', Chi: '#b8742f' };

function buildRun(clients, assigned, techs) {
  const zero = () => Object.fromEntries(techs.map(t => [t, { rev: 0, val: 0, count: 0 }]));
  const run = [zero()];
  let cur = zero();
  clients.forEach((c, i) => {
    cur = JSON.parse(JSON.stringify(cur));
    const t = assigned[i];
    cur[t].rev += c.price; cur[t].val += c.value; cur[t].count += 1;
    run.push(cur);
  });
  return run;
}

// Animated, beginner-friendly explainer of the fair-turn system. Self-contained
// (own play/step state); mirrors the web TurnHelpModal.
export default function TurnHelpSheet({ visible, onClose }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { techs, clients, systems } = H;

  const runs = useMemo(() => ({
    leastBusy: buildRun(clients, systems.leastBusy.assigned, techs),
    mango:     buildRun(clients, systems.mango.assigned, techs),
  }), [clients, systems, techs]);
  const maxRev = useMemo(() => {
    let m = 0;
    ['leastBusy', 'mango'].forEach(k => techs.forEach(t => { m = Math.max(m, runs[k][clients.length][t].rev); }));
    return m || 1;
  }, [runs, clients.length, techs]);

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);

  useEffect(() => { if (!visible) { setStep(0); setPlaying(false); } }, [visible]);

  const advance = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setStep(s => Math.min(clients.length, s + 1)); };

  useEffect(() => {
    if (!playing) return;
    if (step >= clients.length) { setPlaying(false); return; }
    timer.current = setTimeout(advance, 1200);
    return () => clearTimeout(timer.current);
  }, [playing, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const incoming = step >= 1 && step <= clients.length ? clients[step - 1] : null;
  const done = step >= clients.length;

  const Panel = ({ sys }) => {
    const run = runs[sys.key][step];
    const recipient = incoming ? sys.assigned[step - 1] : null;
    const end = runs[sys.key][clients.length];
    const revs = techs.map(t => end[t].rev);
    const spread = Math.max(...revs) - Math.min(...revs);
    return (
      <View style={styles.panel}>
        <Text style={styles.panelLabel}>{sys.label}</Text>
        <Text style={styles.panelBlurb}>{sys.blurb}</Text>
        {techs.map(t => {
          const d = run[t];
          const got = recipient === t;
          return (
            <View key={t} style={{ marginBottom: 10 }}>
              <View style={styles.barHead}>
                <Text style={[styles.barName, { color: COLORS[t] }]}>
                  {t}{got ? '  ＋ got it' : ''}
                </Text>
                <Text style={styles.barMeta}>${d.rev} · {d.count} {d.count === 1 ? 'client' : 'clients'}</Text>
              </View>
              <View style={styles.barTrack}>
                <View style={{ flex: Math.max(0, d.rev), backgroundColor: COLORS[t], borderRadius: 7 }} />
                <View style={{ flex: Math.max(0.001, maxRev - d.rev) }} />
              </View>
            </View>
          );
        })}
        {done && (
          <View style={[styles.verdict, spread > 120 ? styles.verdictBad : styles.verdictGood]}>
            <Text style={[styles.verdictText, { color: spread > 120 ? '#b3261e' : '#1a7a4f' }]}>
              {spread > 120
                ? `😬 Pay gap: $${spread}. Same-ish client counts, very different money.`
                : `✅ Pay gap: only $${spread}. Everyone earned about the same.`}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>🔄 {H.title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
            {/* Basics */}
            <Text style={styles.h}>First, the basics</Text>
            {H.basics.map((b, i) => (
              <Text key={i} style={styles.p}><Text style={styles.bold}>{b.term}: </Text>{b.def}</Text>
            ))}

            {/* Big question */}
            <View style={styles.qBox}>
              <Text style={styles.qQ}>❓ {H.bigQuestion.q}</Text>
              <Text style={styles.qA}>{H.bigQuestion.a}</Text>
              {H.bigQuestion.why.map((w, i) => <Text key={i} style={styles.qWhy}>{w}</Text>)}
            </View>

            {/* Idea + menu */}
            <Text style={styles.h}>The idea: count the value of the work, not the headcount</Text>
            <Text style={styles.p}>{H.idea}</Text>
            <View style={styles.chipWrap}>
              {H.menu.map(m => (
                <View key={m.name} style={styles.chip}>
                  <Text style={styles.chipText}>{m.name} · {m.value} {m.value === 1 ? 'pt' : 'pts'} · ${m.price}</Text>
                </View>
              ))}
            </View>

            {/* Walkthrough */}
            <Text style={styles.h}>Watch one day unfold — same 9 walk-ins, two systems</Text>
            <Text style={styles.p}>Hit play. The same customers arrive in the same order; watch how each system hands them out and what each tech earns.</Text>

            <View style={styles.controls}>
              <TouchableOpacity
                style={styles.playBtn}
                onPress={() => { if (done) { setStep(0); setPlaying(true); } else setPlaying(p => !p); }}>
                <Text style={styles.playBtnText}>{done ? '↺ Replay' : playing ? '⏸ Pause' : '▶ Play'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.stepBtn} disabled={done} onPress={() => { setPlaying(false); advance(); }}>
                <Text style={[styles.stepBtnText, done && { color: theme.textFaint }]}>Step ›</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setPlaying(false); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setStep(0); }}>
                <Text style={styles.resetBtn}>Reset</Text>
              </TouchableOpacity>
              <Text style={styles.counter}>{step} / {clients.length}</Text>
            </View>

            <View style={[styles.incoming, incoming && styles.incomingOn]}>
              <Text style={styles.incomingText}>
                {incoming
                  ? `Walk-in #${incoming.n}: ${incoming.service} · $${incoming.price} (${incoming.value} pts)`
                  : done ? 'That’s the whole day — compare the two drawers 👇' : 'Press ▶ Play to start the day.'}
              </Text>
            </View>

            <Panel sys={systems.leastBusy} />
            <Panel sys={systems.mango} />

            {/* Why not fair */}
            <Text style={styles.h}>Why “least busy” feels fair but isn’t</Text>
            {H.whyNotFair.map((w, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>›</Text>
                <Text style={styles.bulletText}>{w}</Text>
              </View>
            ))}

            <Text style={styles.footer}>{H.footer}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.45)', justifyContent: 'flex-end' },
  sheet:    { backgroundColor: t.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '92%' },
  head:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: t.border },
  title:    { fontSize: 16, fontWeight: '800', color: t.text, flex: 1 },
  close:    { fontSize: 18, color: t.textMuted, fontWeight: '700', paddingLeft: 12 },
  h:        { fontSize: 14, fontWeight: '800', color: t.green, marginTop: 20, marginBottom: 7 },
  p:        { fontSize: 13.5, lineHeight: 20, color: t.textMuted, marginBottom: 7 },
  bold:     { fontWeight: '800', color: t.text },
  qBox:     { backgroundColor: '#fff8ed', borderWidth: 1, borderColor: '#f3d9a4', borderRadius: 12, padding: 14, marginTop: 18 },
  qQ:       { fontSize: 13.5, fontWeight: '800', color: '#9a6b1e' },
  qA:       { fontSize: 15, fontWeight: '800', color: '#1a7a4f', marginTop: 4, marginBottom: 8 },
  qWhy:     { fontSize: 13, lineHeight: 19, color: '#6b5a3a', marginBottom: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip:     { backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.border, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 11.5, color: t.textMuted, fontWeight: '600' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 10, flexWrap: 'wrap' },
  playBtn:  { backgroundColor: t.green, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  playBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  stepBtn:  { borderWidth: 1, borderColor: t.borderStrong, borderRadius: 8, paddingHorizontal: 13, paddingVertical: 9 },
  stepBtnText: { color: t.textMuted, fontWeight: '700', fontSize: 13 },
  resetBtn: { color: t.textMuted, fontWeight: '700', fontSize: 13 },
  counter:  { marginLeft: 'auto', fontSize: 12, color: t.textMuted, fontWeight: '700' },
  incoming: { minHeight: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, marginBottom: 12 },
  incomingOn: { backgroundColor: t.greenSoft },
  incomingText: { fontSize: 13, fontWeight: '700', color: t.text, textAlign: 'center' },
  panel:    { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 13, marginBottom: 12 },
  panelLabel: { fontSize: 13, fontWeight: '800', color: t.text },
  panelBlurb: { fontSize: 11.5, color: t.textMuted, lineHeight: 16, marginTop: 2, marginBottom: 12 },
  barHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 },
  barName:  { fontSize: 12, fontWeight: '700' },
  barMeta:  { fontSize: 11, color: t.textMuted },
  barTrack: { flexDirection: 'row', height: 15, backgroundColor: t.surfaceAlt, borderRadius: 7, overflow: 'hidden' },
  verdict:  { marginTop: 4, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7 },
  verdictBad:  { backgroundColor: '#fdecea' },
  verdictGood: { backgroundColor: '#eaf6ef' },
  verdictText: { fontSize: 11.5, fontWeight: '700', lineHeight: 16 },
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  bulletDot: { color: t.green, fontWeight: '800', fontSize: 14, lineHeight: 20 },
  bulletText: { flex: 1, fontSize: 13, lineHeight: 19, color: t.textMuted },
  footer:   { fontSize: 13, fontStyle: 'italic', color: t.textFaint, marginTop: 16, lineHeight: 19, borderTopWidth: 1, borderTopColor: t.border, paddingTop: 14 },
});
