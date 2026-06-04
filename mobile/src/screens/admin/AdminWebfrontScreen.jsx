import { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { fetchWebfrontConfig, saveWebfrontConfig } from '../../lib/firestore';

const GREEN = '#2D7A5F', BLUE = '#3D95CE';
const FIELDS = [
  ['tagline',   'Tagline'],
  ['about',     'About'],
  ['phone',     'Phone'],
  ['address',   'Address'],
  ['mapsUrl',   'Google Maps URL'],
  ['instagram', 'Instagram'],
  ['facebook',  'Facebook'],
  ['tiktok',    'TikTok'],
];

// Public-site business info (merge-saved). The operating-hours editor +
// Google Business OAuth/sync stay on the web app for now.
export default function AdminWebfrontScreen() {
  const [cfg, setCfg]   = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => { setCfg(await fetchWebfrontConfig().catch(() => ({}))); }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const patch = {};
      FIELDS.forEach(([k]) => { patch[k] = cfg[k] || ''; });
      await saveWebfrontConfig(patch);
      Alert.alert('Saved', 'Public site updated.');
    } catch (e) { Alert.alert('Couldn\'t save', e?.message || 'Try again.'); }
    finally { setSaving(false); }
  }

  if (cfg === null) return <View style={styles.center}><ActivityIndicator color={GREEN} /></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      {FIELDS.map(([key, label]) => (
        <View key={key}>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            style={[styles.input, key === 'about' && { height: 90, textAlignVertical: 'top' }]}
            value={cfg[key] || ''}
            onChangeText={v => setCfg({ ...cfg, [key]: v })}
            multiline={key === 'about'}
            autoCapitalize={['phone', 'mapsUrl', 'instagram', 'facebook', 'tiktok'].includes(key) ? 'none' : 'sentences'}
          />
        </View>
      ))}
      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save public site'}</Text>
      </TouchableOpacity>
      <Text style={styles.note}>Operating hours + Google Business connection are managed on the web app.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#f5f7fa' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  label:   { fontSize: 12, fontWeight: '700', color: '#888', marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input:   { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: '#1a1a1a', borderWidth: 1, borderColor: '#ececec' },
  saveBtn: { marginTop: 22, backgroundColor: BLUE, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveText:{ color: '#fff', fontWeight: '800', fontSize: 15 },
  note:    { fontSize: 12, color: '#aaa', marginTop: 14, lineHeight: 17 },
});
