import { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Switch, Alert } from 'react-native';
import { fetchSettings, updateSettings } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
const RECEIPT_MODES = [
  { value: 'auto', label: 'Auto' }, { value: 'email', label: 'Email' },
  { value: 'sms',  label: 'SMS' },  { value: 'both',  label: 'Both' },
];

// Field-driven settings editor — the most-used editable settings. The full
// web Settings catalog (booking flow, themes, geo check-in, Stripe, demo
// data, etc.) stays on web; these are the day-to-day ones.
const FIELDS = [
  { key: 'timeoutMin',     label: 'Auto sign-out (minutes)', type: 'number', def: 5 },
  { key: 'taxRate',        label: 'Sales tax rate (%)',      type: 'number', def: 0 },
  { key: 'ccFeePct',       label: 'Card fee (%)',            type: 'number', def: 0 },
  { key: 'ccFeeFlat',      label: 'Card fee (flat $)',       type: 'number', def: 0 },
  { key: 'removalPrice',   label: 'Removal service price ($)', type: 'number', def: 0 },
  { key: 'noCardTips',     label: 'Disable tips on card',    type: 'bool' },
  { key: 'terminalLocationId', label: 'Stripe Terminal Location ID (tml_…)', type: 'text' },
  { key: 'googleReviewUrl',label: 'Google review URL',       type: 'text' },
  { key: 'ein',            label: 'Business EIN',            type: 'text' },
];

export default function AdminSettingsScreen() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [settings, setSettings] = useState(null);
  const [draft,    setDraft]    = useState({});
  const [receipt,  setReceipt]  = useState('auto');
  const [refundDefault, setRefundDefault] = useState('withhold');
  const [saving,   setSaving]   = useState(false);

  const load = useCallback(async () => {
    const s = await fetchSettings().catch(() => ({})) || {};
    setSettings(s);
    const d = {};
    FIELDS.forEach(f => { d[f.key] = f.type === 'bool' ? !!s[f.key] : (s[f.key] ?? f.def ?? ''); });
    setDraft(d);
    setReceipt(s.receiptDelivery || 'auto');
    setRefundDefault(s.refundCommissionDefault === 'goodwill' ? 'goodwill' : 'withhold');
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const payload = { receiptDelivery: receipt, refundCommissionDefault: refundDefault };
      FIELDS.forEach(f => {
        if (f.type === 'number') payload[f.key] = Number(draft[f.key]) || 0;
        else if (f.type === 'bool') payload[f.key] = !!draft[f.key];
        else payload[f.key] = draft[f.key] || '';
      });
      await updateSettings(payload);
      Alert.alert('Saved', 'Settings updated.');
    } catch (e) { Alert.alert('Couldn\'t save', e?.message || 'Please try again.'); }
    finally { setSaving(false); }
  }

  if (settings === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.card}>
        <Text style={styles.readLabel}>Plan</Text>
        <Text style={styles.readValue}>{settings.plan || 'pro'}</Text>
        <Text style={[styles.readLabel, { marginTop: 12 }]}>Salon</Text>
        <Text style={styles.readValue}>{settings.salonName || '—'}</Text>
      </View>

      <Text style={styles.section}>Editable</Text>
      {FIELDS.map(f => (
        <View key={f.key}>
          <Text style={styles.fieldLabel}>{f.label}</Text>
          {f.type === 'bool' ? (
            <Switch value={!!draft[f.key]} onValueChange={v => setDraft({ ...draft, [f.key]: v })} trackColor={{ true: theme.green }} />
          ) : (
            <TextInput
              style={styles.input}
              value={String(draft[f.key] ?? '')}
              onChangeText={v => setDraft({ ...draft, [f.key]: v })}
              keyboardType={f.type === 'number' ? 'decimal-pad' : 'default'}
              autoCapitalize="none"
            />
          )}
        </View>
      ))}

      <Text style={styles.fieldLabel}>Receipt delivery</Text>
      <View style={styles.chips}>
        {RECEIPT_MODES.map(m => {
          const on = receipt === m.value;
          return (
            <TouchableOpacity key={m.value} onPress={() => setReceipt(m.value)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{m.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.fieldLabel}>Refund commission default</Text>
      <View style={styles.chips}>
        {[{ value: 'withhold', label: 'Withhold from tech' }, { value: 'goodwill', label: 'Salon absorbs' }].map(m => {
          const on = refundDefault === m.value;
          return (
            <TouchableOpacity key={m.value} onPress={() => setRefundDefault(m.value)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{m.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.note}>Default for new refunds — staff can override per tech at refund time.</Text>

      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save settings'}</Text>
      </TouchableOpacity>
      <Text style={styles.note}>Booking flow, themes, geo check-in, payments & demo data are on the web app.</Text>
    </ScrollView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: t.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  card:      { backgroundColor: t.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: t.border },
  readLabel: { fontSize: 11, fontWeight: '700', color: t.textFaint, textTransform: 'uppercase', letterSpacing: 0.3 },
  readValue: { fontSize: 16, fontWeight: '600', color: t.text, marginTop: 3, textTransform: 'capitalize' },
  section:   { fontSize: 13, fontWeight: '800', color: t.text, marginTop: 22, marginBottom: 4 },
  fieldLabel:{ fontSize: 12, fontWeight: '700', color: t.textMuted, marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input:     { backgroundColor: t.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  chips:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:      { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  chipOn:    { backgroundColor: t.greenSoft, borderColor: t.green },
  chipText:  { fontSize: 13, color: t.textMuted, fontWeight: '600' },
  chipTextOn:{ color: t.green, fontWeight: '800' },
  saveBtn:   { marginTop: 24, backgroundColor: t.blue, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveText:  { color: '#fff', fontWeight: '800', fontSize: 15 },
  note:      { fontSize: 12, color: t.textFaint, marginTop: 14, lineHeight: 17 },
});
