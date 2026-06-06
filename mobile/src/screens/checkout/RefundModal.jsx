import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, StyleSheet, Alert, Modal, Image, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { updateAppointment, fetchClient, saveClient } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Record-only refund (mirrors the web RefundModal): writes a `refund` object on
// the appointment, optionally adds store credit to the client, with a reason +
// optional photo. Does NOT call Stripe — the actual money return (cash back /
// manual card refund) is done out-of-band by the salon, same as the web.
export default function RefundModal({ appt, onClose, onDone }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const open = !!appt;
  const payment   = appt?.payment || {};
  const maxRefund = payment.total ?? payment.subtotal ?? 0;

  const [amount,    setAmount]    = useState('');
  const [reason,    setReason]    = useState('');
  const [photo,     setPhoto]     = useState('');
  const [addCredit, setAddCredit] = useState(false);
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    if (appt) {
      setAmount(String(maxRefund || ''));
      setReason(''); setPhoto(''); setAddCredit(!!appt.clientId); setSaving(false);
    }
  }, [appt?.id]);

  async function pickPhoto() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Photos access needed', 'Enable photo access in Settings to attach proof.'); return; }
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
      if (r.canceled || !r.assets?.[0]) return;
      const out = await ImageManipulator.manipulateAsync(r.assets[0].uri, [{ resize: { width: 800 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      setPhoto(`data:image/jpeg;base64,${out.base64}`);
    } catch (e) { Alert.alert('Couldn\'t attach photo', e?.message || 'Try again.'); }
  }

  async function submit() {
    const amt = Number(amount) || 0;
    if (amt <= 0) { Alert.alert('Enter a refund amount'); return; }
    if (amt > maxRefund + 0.001) { Alert.alert('Too much', `Refund can't exceed the original ${money(maxRefund)}.`); return; }
    if (!reason.trim()) { Alert.alert('Reason required', 'Add a short reason for the refund.'); return; }
    if (saving) return;
    setSaving(true);
    try {
      const refund = {
        amount: amt, reason: reason.trim(), photo: photo || null,
        addedCredit: addCredit && !!appt.clientId, refundedAt: new Date().toISOString(),
      };
      await updateAppointment(appt.id, { refund });
      if (addCredit && appt.clientId) {
        const c = await fetchClient(appt.clientId).catch(() => null);
        if (c) await saveClient(appt.clientId, { credit: (Number(c.credit) || 0) + amt });
      }
      onDone?.(refund);
    } catch (e) {
      Alert.alert('Refund failed', e?.message || 'Please try again.');
      setSaving(false);
    }
  }

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Refund</Text>
              <TouchableOpacity onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.sub}>{appt?.clientName || 'Walk-in'} · original {money(maxRefund)}</Text>

              <Text style={styles.label}>Refund amount</Text>
              <View style={styles.amountRow}>
                <Text style={styles.dollar}>$</Text>
                <TextInput style={styles.amountInput} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={maxRefund.toFixed(2)} placeholderTextColor={theme.placeholder} />
                <TouchableOpacity onPress={() => setAmount(String(maxRefund))} style={styles.fullBtn}><Text style={styles.fullBtnText}>Full</Text></TouchableOpacity>
              </View>

              <Text style={styles.label}>Reason</Text>
              <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} value={reason} onChangeText={setReason} placeholder="Why is this being refunded?" placeholderTextColor={theme.placeholder} multiline maxLength={400} />

              {!!appt?.clientId && (
                <TouchableOpacity style={styles.creditRow} activeOpacity={0.7} onPress={() => setAddCredit(v => !v)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.creditLabel}>Add as store credit</Text>
                    <Text style={styles.creditSub}>Apply {money(Number(amount) || 0)} to this client's account instead of / alongside the cash refund.</Text>
                  </View>
                  <Switch value={addCredit} onValueChange={setAddCredit} trackColor={{ true: theme.green }} />
                </TouchableOpacity>
              )}

              <Text style={styles.label}>Photo (optional)</Text>
              {photo ? (
                <TouchableOpacity onPress={pickPhoto} activeOpacity={0.8}><Image source={{ uri: photo }} style={styles.photo} /></TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto}><Text style={styles.photoBtnText}>＋ Attach proof photo</Text></TouchableOpacity>
              )}
            </ScrollView>

            <TouchableOpacity style={[styles.submit, (saving || !(Number(amount) > 0) || !reason.trim()) && { opacity: 0.5 }]} onPress={submit} disabled={saving || !(Number(amount) > 0) || !reason.trim()}>
              <Text style={styles.submitText}>{saving ? 'Processing…' : `Issue refund · ${money(Number(amount) || 0)}`}</Text>
            </TouchableOpacity>
            <Text style={styles.note}>Records the refund + (optional) store credit. Return the money via cash or your card processor — this doesn't move funds.</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: t.overlay, justifyContent: 'flex-end' },
  sheet:    { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 28 },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title:    { fontSize: 18, fontWeight: '800', color: t.text },
  close:    { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceMuted },
  closeText:{ fontSize: 22, color: t.textMuted, lineHeight: 24 },
  sub:      { fontSize: 13, color: t.textMuted, marginBottom: 12 },
  label:    { fontSize: 12, fontWeight: '700', color: t.textMuted, marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  amountRow:{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: t.border },
  dollar:   { fontSize: 18, color: t.textMuted },
  amountInput:{ flex: 1, fontSize: 18, fontWeight: '800', color: t.text, paddingVertical: 11, marginLeft: 6 },
  fullBtn:  { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: t.surfaceMuted },
  fullBtnText:{ fontSize: 12, fontWeight: '800', color: t.textMuted },
  input:    { backgroundColor: t.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  creditRow:{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, backgroundColor: t.surfaceAlt, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.border },
  creditLabel:{ fontSize: 14, fontWeight: '700', color: t.text },
  creditSub:{ fontSize: 11.5, color: t.textMuted, marginTop: 3, lineHeight: 16 },
  photoBtn: { borderWidth: 1, borderColor: t.borderStrong, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  photoBtnText:{ color: t.textMuted, fontWeight: '700', fontSize: 14 },
  photo:    { width: '100%', height: 160, borderRadius: 12, resizeMode: 'cover' },
  submit:   { marginTop: 18, backgroundColor: t.danger, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  submitText:{ color: '#fff', fontWeight: '800', fontSize: 15 },
  note:     { fontSize: 11, color: t.textFaint, marginTop: 10, lineHeight: 16, textAlign: 'center' },
});
