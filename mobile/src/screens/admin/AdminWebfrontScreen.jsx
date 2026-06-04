import { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { fetchWebfrontConfig, saveWebfrontConfig, fetchGoogleBusinessAuth } from '../../lib/firestore';

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
// Hours are free-text per day on the public site (e.g. "9am – 6pm" / "Closed").
const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

// Public-site business info (merge-saved). The operating-hours editor +
// Google Business OAuth/sync stay on the web app for now.
export default function AdminWebfrontScreen({ navigation }) {
  const [cfg, setCfg]   = useState(null);
  const [saving, setSaving] = useState(false);
  const [gbAuth, setGbAuth] = useState(null);

  const load = useCallback(async () => {
    setCfg(await fetchWebfrontConfig().catch(() => ({})));
    setGbAuth(await fetchGoogleBusinessAuth().catch(() => null));
  }, []);
  useEffect(() => {
    load();
    const unsub = navigation?.addListener?.('focus', () => { fetchGoogleBusinessAuth().then(setGbAuth).catch(() => {}); });
    return unsub;
  }, [load, navigation]);

  async function save() {
    setSaving(true);
    try {
      const patch = { hours: cfg.hours || {} };
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
      <Text style={[styles.label, { marginTop: 20 }]}>Hours</Text>
      {DAYS.map(([key, label]) => (
        <View key={key} style={styles.hoursRow}>
          <Text style={styles.dayLabel}>{label}</Text>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={cfg.hours?.[key] || ''}
            onChangeText={v => setCfg({ ...cfg, hours: { ...(cfg.hours || {}), [key]: v } })}
            placeholder="9am – 6pm / Closed"
            placeholderTextColor="#bbb"
            autoCapitalize="none"
          />
        </View>
      ))}

      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save public site'}</Text>
      </TouchableOpacity>

      <Text style={[styles.label, { marginTop: 24 }]}>Google Business Profile</Text>
      <Text style={styles.help}>Connect your Google listing to sync reviews onto your public site.</Text>
      <TouchableOpacity style={styles.gbRow} onPress={() => navigation.navigate('AdminGoogleBusiness')}>
        <View style={{ flex: 1 }}>
          <Text style={styles.gbTitle}>{gbAuth ? '✓ Google Business connected' : 'Set up Google Business'}</Text>
          <Text style={styles.gbSub}>{gbAuth ? (gbAuth.locationName || gbAuth.accountName || 'Tap to manage') : 'Connect, confirm your listing & sync reviews'}</Text>
        </View>
        <Text style={styles.gbChev}>›</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#f5f7fa' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  label:   { fontSize: 12, fontWeight: '700', color: '#888', marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input:   { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: '#1a1a1a', borderWidth: 1, borderColor: '#ececec' },
  help:    { fontSize: 12.5, color: '#888', marginTop: 4 },
  gbRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 8, borderWidth: 1, borderColor: '#ececec' },
  gbTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  gbSub:   { fontSize: 12, color: '#8a8a8a', marginTop: 2 },
  gbChev:  { fontSize: 24, color: '#ccc', marginLeft: 8 },
  hoursRow:{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  dayLabel:{ width: 38, fontSize: 13, fontWeight: '700', color: '#555' },
  saveBtn: { marginTop: 22, backgroundColor: BLUE, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveText:{ color: '#fff', fontWeight: '800', fontSize: 15 },
  note:    { fontSize: 12, color: '#aaa', marginTop: 14, lineHeight: 17 },
});
