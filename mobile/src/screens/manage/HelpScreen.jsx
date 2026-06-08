import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from '../../components/Icon';
import useTenantAccess from '../../hooks/useTenantAccess';
import { getVisibleModules, moduleMeta } from '../../lib/modules';
import { fetchSettings } from '../../lib/firestore';
import { HELP_GENERAL, HELP_TOPICS, HELP_FEATURES } from '../../lib/helpContent';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Staff Help & Guide: concise per-feature how-tos, filtered to what this tenant
// has enabled (reuses getVisibleModules so it never lists a plan's missing tiles).
export default function HelpScreen() {
  const { isAdmin, plan } = useTenantAccess();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [settings, setSettings] = useState(null);
  const [q, setQ]       = useState('');
  const [open, setOpen] = useState('getting-started');

  const load = useCallback(async () => { setSettings(await fetchSettings().catch(() => ({}))); }, []);
  useEffect(() => { load(); }, [load]);

  if (settings === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  const effSettings = settings || (plan ? { plan } : { plan: 'starter' });
  const visible = getVisibleModules(effSettings, { isAdmin });

  const moduleTopics = visible
    .filter(m => HELP_TOPICS[m.id])
    .map(m => ({ id: m.id, title: m.label, ...HELP_TOPICS[m.id], icon: moduleMeta(m.id).icon || HELP_TOPICS[m.id].icon }));
  const featureTopics = HELP_FEATURES.filter(f => !f.adminOnly || isAdmin);
  const all = [...HELP_GENERAL, ...moduleTopics, ...featureTopics];

  const needle = q.trim().toLowerCase();
  const topics = needle
    ? all.filter(t => `${t.title} ${t.what}`.toLowerCase().includes(needle))
    : all;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 14, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
      <Text style={styles.intro}>Quick how-tos for the tools you have. Tap a topic to expand.</Text>
      <TextInput
        style={styles.search}
        value={q}
        onChangeText={setQ}
        placeholder="Search help…"
        placeholderTextColor={theme.placeholder}
        autoCapitalize="none"
      />

      {topics.length === 0 && <Text style={styles.empty}>No help topics match “{q}”.</Text>}

      {topics.map(t => {
        const isOpen = open === t.id;
        return (
          <View key={t.id} style={styles.card}>
            <TouchableOpacity style={styles.head} activeOpacity={0.7} onPress={() => setOpen(isOpen ? null : t.id)}>
              <View style={styles.iconWrap}><Icon name={t.icon || 'grid'} size={18} color={theme.green} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{t.title}</Text>
                <Text style={styles.what} numberOfLines={isOpen ? 0 : 1}>{t.what}</Text>
              </View>
              <Text style={styles.chev}>{isOpen ? '−' : '+'}</Text>
            </TouchableOpacity>
            {isOpen && (
              <View style={styles.body}>
                {(t.steps || []).map((s, i) => (
                  <View key={i} style={styles.stepRow}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                    <Text style={styles.stepText}>{s}</Text>
                  </View>
                ))}
                {!!t.tip && (
                  <View style={styles.tip}><Text style={styles.tipText}>💡 {t.tip}</Text></View>
                )}
              </View>
            )}
          </View>
        );
      })}

      <Text style={styles.footer}>Owner setup (billing, Stripe, deep settings, marketing sends) lives on the web app.</Text>
    </ScrollView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  intro:   { fontSize: 13, color: t.textMuted, marginBottom: 12, lineHeight: 18 },
  search:  { backgroundColor: t.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border, marginBottom: 14 },
  empty:   { color: t.textFaint, fontSize: 14, paddingVertical: 16, textAlign: 'center' },
  card:    { backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.border, marginBottom: 10, overflow: 'hidden' },
  head:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconWrap:{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.greenSoft, alignItems: 'center', justifyContent: 'center' },
  title:   { fontSize: 15, fontWeight: '800', color: t.text },
  what:    { fontSize: 12.5, color: t.textMuted, marginTop: 2, lineHeight: 17 },
  chev:    { fontSize: 22, color: t.textFaint, width: 22, textAlign: 'center' },
  body:    { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 2 },
  stepRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  stepNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: t.surfaceAlt, color: t.textMuted, fontSize: 12, fontWeight: '800', textAlign: 'center', lineHeight: 20, overflow: 'hidden' },
  stepText:{ flex: 1, fontSize: 14, color: t.text, lineHeight: 20 },
  tip:     { backgroundColor: t.greenSoft, borderRadius: 10, padding: 11, marginTop: 4 },
  tipText: { fontSize: 13, color: t.green, lineHeight: 18 },
  footer:  { fontSize: 12, color: t.textFaint, marginTop: 12, lineHeight: 17, textAlign: 'center' },
});
