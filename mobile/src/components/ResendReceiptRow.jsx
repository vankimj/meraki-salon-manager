import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { resendReceiptSms, resendReceiptEmail } from '../lib/firestore';
import { parseReceiptContact } from '../lib/checkout';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

// Re-send a receipt by text OR email after the sale. A typed contact is routed
// to the right backend resend (email if it parses as an address, else SMS).
// Identify the receipt by id when known, else by viewToken (the per-sale
// saleId). Shared by the post-sale Done screens and the receipts history.
export default function ResendReceiptRow({ receiptId = null, viewToken = null, defaultContact = '', compact = false }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [val, setVal]     = useState(defaultContact || '');
  const [busy, setBusy]   = useState(false);
  const [sentMsg, setSentMsg] = useState('');

  async function send() {
    const contact = parseReceiptContact(val);
    if (!contact) { Alert.alert('Enter a phone or email', 'Add a valid phone number or email address to send the receipt to.'); return; }
    if (!receiptId && !viewToken) { Alert.alert("Can't send", 'This sale has no receipt reference yet.'); return; }
    setBusy(true); setSentMsg('');
    try {
      const res = contact.email
        ? await resendReceiptEmail({ receiptId, viewToken, email: contact.email })
        : await resendReceiptSms({ receiptId, viewToken, phone: contact.phone });
      if (res?.ok) {
        setSentMsg(contact.email ? `Emailed to ${contact.email}` : `Texted to ${contact.phone}`);
      } else {
        const e = res?.error || 'send_failed';
        const msg = e === 'no_phone' ? 'No phone number to send to.'
          : e === 'no_email' ? 'No email address to send to.'
          : e === 'not_configured' ? "Receipts aren't fully set up for this salon yet."
          : String(e);
        Alert.alert("Couldn't send", msg);
      }
    } catch (e) {
      Alert.alert("Couldn't send", e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={compact ? null : styles.wrap}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={val}
          onChangeText={(t) => { setVal(t); if (sentMsg) setSentMsg(''); }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Phone or email"
          placeholderTextColor={theme.placeholder}
          maxLength={60}
          editable={!busy}
        />
        <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={send} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send</Text>}
        </TouchableOpacity>
      </View>
      {!!sentMsg && <Text style={styles.sent}>✓ {sentMsg}</Text>}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { marginTop: 14, width: '100%' },
  row:     { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input:   { flex: 1, backgroundColor: t.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  btn:     { backgroundColor: t.green, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minWidth: 76 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  sent:    { color: t.success, fontSize: 12.5, fontWeight: '700', marginTop: 8, textAlign: 'center' },
});
