import { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import OAuthConnect from '../../components/OAuthConnect';
import {
  fetchGoogleBusinessAuth, getGoogleBusinessAuthUrl, fetchWebfrontConfig, saveWebfrontConfig,
  findBusinessByAddress, syncGoogleBusinessReviews, disconnectGoogleBusiness,
} from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Per-tenant Google Business setup wizard (owner-facing — NO platform
// credentials here; those are Plume's one-time setup). Three steps:
//   1. Connect — authorize this salon's Google account.
//   2. Confirm listing — auto-detect by address (or paste a Place ID).
//   3. Sync reviews.
export default function AdminGoogleBusinessScreen() {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const [auth, setAuth]   = useState(undefined);
  const [cfg, setCfg]     = useState(null);
  const [busy, setBusy]   = useState(false);
  const [candidates, setCandidates] = useState(null);

  const load = useCallback(async () => {
    const [a, c] = await Promise.all([fetchGoogleBusinessAuth().catch(() => null), fetchWebfrontConfig().catch(() => ({}))]);
    setAuth(a); setCfg(c);
  }, []);
  const reloadAuth = useCallback(async () => { setAuth(await fetchGoogleBusinessAuth().catch(() => null)); }, []);
  useEffect(() => { load(); }, [load]);

  const connected = !!auth;
  const placeId   = cfg?.googlePlaceId || '';

  async function detect() {
    if (!cfg?.address) { Alert.alert('Add your address first', 'Set the salon address on the Public Site screen, then come back.'); return; }
    setBusy(true); setCandidates(null);
    try {
      const data = await findBusinessByAddress(cfg.address);
      const list = data.candidates || (data.placeId ? [{ placeId: data.placeId, name: data.name || 'Your business', mapsUrl: data.mapsUrl }] : []);
      if (list.length === 0) Alert.alert('No match', 'Couldn\'t find a Google listing for that address. You can paste a Place ID instead.');
      setCandidates(list);
    } catch (e) { Alert.alert('Lookup failed', e?.message || 'Try again.'); }
    finally { setBusy(false); }
  }

  async function selectPlace(c) {
    setBusy(true);
    try {
      await saveWebfrontConfig({ googlePlaceId: c.placeId, ...(c.mapsUrl ? { mapsUrl: c.mapsUrl } : {}) });
      setCfg(prev => ({ ...prev, googlePlaceId: c.placeId, ...(c.mapsUrl ? { mapsUrl: c.mapsUrl } : {}) }));
      setCandidates(null);
      Alert.alert('Listing set', `Using ${c.name || c.placeId}.`);
    } catch (e) { Alert.alert('Couldn\'t save', e?.message || 'Try again.'); }
    finally { setBusy(false); }
  }

  async function savePlaceId(v) {
    setCfg(prev => ({ ...prev, googlePlaceId: v }));
  }
  async function commitPlaceId() {
    try { await saveWebfrontConfig({ googlePlaceId: cfg.googlePlaceId || '' }); } catch {}
  }

  async function sync() {
    setBusy(true);
    try { const r = await syncGoogleBusinessReviews(); Alert.alert('Synced', `Pulled ${r.count ?? 0} reviews.`); }
    catch (e) { Alert.alert('Sync failed', e?.message || 'Try again.'); }
    finally { setBusy(false); }
  }

  function confirmDisconnect() {
    Alert.alert('Disconnect Google Business?', 'Removes this salon\'s Google connection. Your reviews stay; syncing stops.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => { try { await disconnectGoogleBusiness(); await reloadAuth(); } catch (e) { Alert.alert('Failed', e?.message); } } },
    ]);
  }

  if (auth === undefined || cfg === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      {/* Step 1 */}
      <Text style={styles.step}>1 · Connect your Google account</Text>
      <OAuthConnect
        label="Connect Google Business"
        getUrl={getGoogleBusinessAuthUrl}
        onReturn={reloadAuth}
        connected={connected}
        connectedLabel={auth?.locationName || auth?.accountName || 'Google account connected'}
      />

      {/* Step 2 */}
      <Text style={[styles.step, { marginTop: 26 }]}>2 · Confirm your listing</Text>
      <Text style={styles.help}>Auto-detect from your salon address, or paste your Google Place ID.</Text>
      <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={detect} disabled={busy}>
        <Text style={styles.btnText}>{busy ? 'Searching…' : '🔍 Find my business'}</Text>
      </TouchableOpacity>
      {candidates && candidates.map(c => (
        <TouchableOpacity key={c.placeId} style={styles.candidate} onPress={() => selectPlace(c)}>
          <Text style={styles.candName}>{c.name || c.placeId}</Text>
          {!!c.address && <Text style={styles.candSub}>{c.address}</Text>}
          <Text style={styles.candUse}>Use this →</Text>
        </TouchableOpacity>
      ))}
      <Text style={[styles.help, { marginTop: 14 }]}>Place ID</Text>
      <View style={styles.placeRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={placeId} onChangeText={savePlaceId} onBlur={commitPlaceId} placeholder="ChIJ…" placeholderTextColor={theme.placeholder} autoCapitalize="none" />
        {!!placeId && <Text style={styles.placeOk}>✓</Text>}
      </View>

      {/* Step 3 */}
      <Text style={[styles.step, { marginTop: 26 }]}>3 · Sync reviews</Text>
      <TouchableOpacity
        style={[styles.btn, styles.syncBtn, (!connected || !placeId || busy) && { opacity: 0.45 }]}
        onPress={sync}
        disabled={!connected || !placeId || busy}
      >
        <Text style={styles.syncText}>{busy ? 'Syncing…' : 'Sync Google reviews now'}</Text>
      </TouchableOpacity>
      {(!connected || !placeId) && <Text style={styles.help}>Connect (step 1) and set a listing (step 2) first.</Text>}

      {connected && (
        <TouchableOpacity onPress={confirmDisconnect} style={{ marginTop: 28, alignItems: 'center' }}>
          <Text style={styles.disconnect}>Disconnect Google Business</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: t.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  step:      { fontSize: 15, fontWeight: '800', color: t.text, marginBottom: 6 },
  help:      { fontSize: 12.5, color: t.textMuted, marginBottom: 8, lineHeight: 17 },
  btn:       { backgroundColor: t.surface, borderWidth: 1, borderColor: t.borderStrong, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnText:   { color: t.textMuted, fontWeight: '700', fontSize: 14 },
  candidate: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.green, borderRadius: 12, padding: 14, marginTop: 10 },
  candName:  { fontSize: 15, fontWeight: '700', color: t.text },
  candSub:   { fontSize: 12, color: t.textMuted, marginTop: 2 },
  candUse:   { fontSize: 12, fontWeight: '800', color: t.green, marginTop: 6 },
  placeRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input:     { backgroundColor: t.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  placeOk:   { fontSize: 18, color: t.green, fontWeight: '800' },
  syncBtn:   { backgroundColor: t.blue, borderColor: t.blue },
  syncText:  { color: '#fff', fontWeight: '800', fontSize: 14 },
  disconnect:{ color: t.danger, fontWeight: '700', fontSize: 13 },
});
