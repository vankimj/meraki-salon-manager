import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { resendReceiptSms, resendReceiptEmail } from '../lib/firestore';
import { parseReceiptContact } from '../lib/checkout';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

// Re-send a receipt by text AND/OR email after the sale. Shows a phone field and
// an email field, each prefilled from the client profile so staff usually just
// tap Send. Identify the receipt by id when known, else by viewToken (saleId).
// Back-compat: a single `defaultContact` is split into the right field.
export default function ResendReceiptRow({ receiptId = null, viewToken = null, defaultContact = '', defaultPhone = '', defaultEmail = '', compact = false }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const seed = parseReceiptContact(defaultContact) || {};
  const [phone, setPhone] = useState(defaultPhone || seed.phone || '');
  const [email, setEmail] = useState(defaultEmail || seed.email || '');
  const [busyKind, setBusyKind] = useState(null); // 'sms' | 'email' | null
  const [sentMsg, setSentMsg]   = useState('');

  async function sendSms() {
    if (!receiptId && !viewToken) { Alert.alert("Can't send", 'This sale has no receipt reference yet.'); return; }
    const p = parseReceiptContact(phone)?.phone;
    if (!p) { Alert.alert('Enter a phone', 'Add a valid phone number to text the receipt to.'); return; }
    setBusyKind('sms'); setSentMsg('');
    try {
      const res = await resendReceiptSms({ receiptId, viewToken, phone: p });
      if (res?.ok) setSentMsg(`Texted to ${p}`);
      else Alert.alert("Couldn't send", res?.error === 'not_configured' ? "Receipts aren't fully set up for this salon yet." : String(res?.error || 'send_failed'));
    } catch (e) { Alert.alert("Couldn't send", e?.message || 'Please try again.'); }
    finally { setBusyKind(null); }
  }

  async function sendEmail() {
    if (!receiptId && !viewToken) { Alert.alert("Can't send", 'This sale has no receipt reference yet.'); return; }
    const em = parseReceiptContact(email)?.email;
    if (!em) { Alert.alert('Enter an email', 'Add a valid email address to send the receipt to.'); return; }
    setBusyKind('email'); setSentMsg('');
    try {
      const res = await resendReceiptEmail({ receiptId, viewToken, email: em });
      if (res?.ok) setSentMsg(`Emailed to ${em}`);
      else Alert.alert("Couldn't send", res?.error === 'not_configured' ? "Receipts aren't fully set up for this salon yet." : String(res?.error || 'send_failed'));
    } catch (e) { Alert.alert("Couldn't send", e?.message || 'Please try again.'); }
    finally { setBusyKind(null); }
  }

  const busy = !!busyKind;
  return (
    <View style={compact ? null : styles.wrap}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={(t) => { setPhone(t); if (sentMsg) setSentMsg(''); }}
          keyboardType="phone-pad"
          placeholder="Phone"
          placeholderTextColor={theme.placeholder}
          maxLength={40}
          editable={!busy}
        />
        <TouchableOpacity style={[styles.btn, (busy || !phone.trim()) && { opacity: 0.5 }]} onPress={sendSms} disabled={busy || !phone.trim()} activeOpacity={0.85}>
          {busyKind === 'sms' ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>💬 Text</Text>}
        </TouchableOpacity>
      </View>
      <View style={[styles.row, { marginTop: 8 }]}>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={(t) => { setEmail(t); if (sentMsg) setSentMsg(''); }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Email"
          placeholderTextColor={theme.placeholder}
          maxLength={60}
          editable={!busy}
        />
        <TouchableOpacity style={[styles.btn, (busy || !email.trim()) && { opacity: 0.5 }]} onPress={sendEmail} disabled={busy || !email.trim()} activeOpacity={0.85}>
          {busyKind === 'email' ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>✉️ Email</Text>}
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
  btn:     { backgroundColor: t.green, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minWidth: 92 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  sent:    { color: t.success, fontSize: 12.5, fontWeight: '700', marginTop: 8, textAlign: 'center' },
});
