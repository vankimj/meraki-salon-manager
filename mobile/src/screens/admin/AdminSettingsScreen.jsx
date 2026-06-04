import { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { fetchSettings, updateSettings } from '../../lib/firestore';

const GREEN = '#2D7A5F';
const BLUE  = '#3D95CE';
const RECEIPT_MODES = [
  { value: 'auto',  label: 'Auto' }, { value: 'email', label: 'Email' },
  { value: 'sms',   label: 'SMS' },  { value: 'both',  label: 'Both' },
];

// Wave-1 mobile Settings: the most-used editable settings (auto-logout,
// sales tax, receipt delivery) + read-only plan/salon. The web Settings
// tab's 40+ sections come to mobile in later waves.
export default function AdminSettingsScreen() {
  const [settings, setSettings] = useState(null);
  const [timeoutMin, setTimeoutMin] = useState('');
  const [taxRate,    setTaxRate]    = useState('');
  const [receipt,    setReceipt]    = useState('auto');
  const [saving,     setSaving]     = useState(false);

  const load = useCallback(async () => {
    const s = await fetchSettings().catch(() => ({}));
    setSettings(s || {});
    setTimeoutMin(String(s?.timeoutMin ?? 5));
    setTaxRate(String(s?.taxRate ?? 0));
    setReceipt(s?.receiptDelivery || 'auto');
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      await updateSettings({
        timeoutMin: Number(timeoutMin) || 5,
        taxRate: Number(taxRate) || 0,
        receiptDelivery: receipt,
      });
      Alert.alert('Saved', 'Settings updated.');
    } catch (e) {
      Alert.alert('Couldn\'t save', e?.message || 'Please try again.');
    } finally { setSaving(false); }
  }

  if (settings === null) return <View style={styles.center}><ActivityIndicator color={GREEN} /></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.card}>
        <Text style={styles.readLabel}>Plan</Text>
        <Text style={styles.readValue}>{settings.plan || 'pro'}</Text>
        <Text style={[styles.readLabel, { marginTop: 12 }]}>Salon</Text>
        <Text style={styles.readValue}>{settings.salonName || '—'}</Text>
      </View>

      <Text style={styles.section}>Editable</Text>

      <Text style={styles.fieldLabel}>Auto sign-out (minutes)</Text>
      <TextInput style={styles.input} value={timeoutMin} onChangeText={setTimeoutMin} keyboardType="number-pad" />

      <Text style={styles.fieldLabel}>Sales tax rate (%)</Text>
      <TextInput style={styles.input} value={taxRate} onChangeText={setTaxRate} keyboardType="decimal-pad" />

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

      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save settings'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: '#f5f7fa' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  card:      { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#ececec' },
  readLabel: { fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.3 },
  readValue: { fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginTop: 3, textTransform: 'capitalize' },
  section:   { fontSize: 13, fontWeight: '800', color: '#1a1a1a', marginTop: 22, marginBottom: 4 },
  fieldLabel:{ fontSize: 12, fontWeight: '700', color: '#888', marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input:     { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: '#1a1a1a', borderWidth: 1, borderColor: '#ececec' },
  chips:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:      { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e6e8' },
  chipOn:    { backgroundColor: '#eef5f2', borderColor: GREEN },
  chipText:  { fontSize: 13, color: '#666', fontWeight: '600' },
  chipTextOn:{ color: GREEN, fontWeight: '800' },
  saveBtn:   { marginTop: 24, backgroundColor: BLUE, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveText:  { color: '#fff', fontWeight: '800', fontSize: 15 },
});
