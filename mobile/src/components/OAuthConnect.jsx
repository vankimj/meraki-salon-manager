import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

// Generic "connect via OAuth" row. Opens the server-minted auth URL in the
// system browser; the existing web-hosted callback stores the tokens. When
// the user returns, onReturn() re-reads the status doc so the UI flips to
// connected. Works without app-scheme redirect URIs.
export default function OAuthConnect({ label, getUrl, onReturn, connected, connectedLabel, disabled }) {
  const [busy, setBusy] = useState(false);

  async function connect() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const url = await getUrl();
      if (!url) throw new Error('Could not start the connection.');
      await WebBrowser.openBrowserAsync(url);
      await onReturn?.();   // re-check status after the browser closes
    } catch (e) {
      Alert.alert('Connection failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (connected) {
    return (
      <View style={styles.connectedRow}>
        <Text style={styles.connectedText}>✓ {connectedLabel || 'Connected'}</Text>
        <TouchableOpacity onPress={connect} disabled={busy}>
          <Text style={styles.reconnect}>{busy ? 'Opening…' : 'Reconnect'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableOpacity onPress={connect} disabled={busy || disabled} style={[styles.btn, (busy || disabled) && { opacity: 0.6 }]}>
      <Text style={styles.btnText}>{busy ? 'Opening…' : label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn:          { backgroundColor: '#3D95CE', borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  btnText:      { color: '#fff', fontWeight: '800', fontSize: 14 },
  connectedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginTop: 8 },
  connectedText:{ color: '#16a34a', fontWeight: '800', fontSize: 14 },
  reconnect:    { color: '#3D95CE', fontWeight: '700', fontSize: 13 },
});
