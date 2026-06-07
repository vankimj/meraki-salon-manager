import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Modal, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { refundSale } from '../lib/firestore';
import { genReceiptToken } from '../lib/checkout';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Refund a sale from the receipts hub. Detects card-vs-cash from the receipt's
// payment: a card sale with a Stripe PaymentIntent is refunded for REAL to the
// card (server-side via refundSale → Stripe reverse_transfer); cash / no-PI is
// recorded only. Partial-refund aware (caps at the remaining refundable) and
// idempotent (one stable key per open sheet).
export default function RefundSheet({ receipt, onClose, onDone }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const open = !!receipt;
  const payment   = receipt?.payment || {};
  const original  = Number(payment.total) || 0;
  const already   = Number(receipt?.refundedAmount) || 0;
  const remaining = Math.max(0, original - already);
  const isCard    = payment.method === 'card' && !!payment.stripePaymentIntentId;

  const [amount,    setAmount]    = useState('');
  const [reason,    setReason]    = useState('');
  const [refundTo,  setRefundTo]  = useState('money');   // 'money' | 'credit'
  const [saving,    setSaving]    = useState(false);
  const [idemKey,   setIdemKey]   = useState('');

  useEffect(() => {
    if (receipt) {
      setAmount(remaining ? String(remaining.toFixed(2)) : '');
      setReason(''); setRefundTo('money'); setSaving(false);
      setIdemKey(genReceiptToken(24));   // one stable idempotency key per sheet open
    }
  }, [receipt?.id]);

  async function submit() {
    const amt = Number(amount) || 0;
    if (amt <= 0) { Alert.alert('Enter a refund amount'); return; }
    if (amt > remaining + 0.001) { Alert.alert('Too much', `Refund can't exceed the remaining ${money(remaining)}.`); return; }
    if (!reason.trim()) { Alert.alert('Reason required', 'Add a short reason for the refund.'); return; }
    if (saving) return;
    setSaving(true);
    try {
      const res = await refundSale({
        receiptId: receipt.id,
        amountCents: Math.round(amt * 100),
        reason: reason.trim(),
        refundTo,
        idempotencyKey: idemKey,
      });
      if (!res?.ok) throw new Error(res?.error || 'Refund failed.');
      const msg = refundTo === 'credit'
        ? `${money(amt)} added as store credit.`
        : isCard ? `${money(amt)} refunded to the card.`
        : `${money(amt)} refund recorded — return the cash to the customer.`;
      onDone?.({ amount: amt, message: msg });
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
              <Text style={styles.sub}>{receipt?.clientName || 'Walk-in'} · original {money(original)}{already > 0 ? ` · ${money(already)} already refunded` : ''}</Text>

              <Text style={styles.label}>Refund amount</Text>
              <View style={styles.amountRow}>
                <Text style={styles.dollar}>$</Text>
                <TextInput style={styles.amountInput} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={remaining.toFixed(2)} placeholderTextColor={theme.placeholder} />
                <TouchableOpacity onPress={() => setAmount(String(remaining.toFixed(2)))} style={styles.fullBtn}><Text style={styles.fullBtnText}>Full</Text></TouchableOpacity>
              </View>

              <Text style={styles.label}>Reason</Text>
              <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} value={reason} onChangeText={setReason} placeholder="Why is this being refunded?" placeholderTextColor={theme.placeholder} multiline maxLength={400} />

              <Text style={styles.label}>Refund to</Text>
              <View style={styles.methodRow}>
                <TouchableOpacity style={[styles.methodBtn, refundTo === 'money' && styles.methodBtnOn]} onPress={() => setRefundTo('money')} activeOpacity={0.8}>
                  <Text style={[styles.methodTitle, refundTo === 'money' && styles.methodTitleOn]}>{isCard ? 'Back to card' : 'Cash'}</Text>
                  <Text style={styles.methodSub}>{isCard ? 'Stripe refund' : 'hand cash back'}</Text>
                </TouchableOpacity>
                {!!receipt?.clientId && (
                  <TouchableOpacity style={[styles.methodBtn, refundTo === 'credit' && styles.methodBtnOn]} onPress={() => setRefundTo('credit')} activeOpacity={0.8}>
                    <Text style={[styles.methodTitle, refundTo === 'credit' && styles.methodTitleOn]}>Store credit</Text>
                    <Text style={styles.methodSub}>no money moves</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.methodNote}>
                {refundTo === 'credit'
                  ? `Adds ${money(Number(amount) || 0)} to ${receipt?.clientName || 'the client'}'s balance — the original payment is NOT refunded.`
                  : isCard ? 'Refunds the customer’s card for real, via Stripe.'
                  : 'Records the refund — hand the cash back yourself.'}
              </Text>
            </ScrollView>

            <TouchableOpacity style={[styles.submit, (saving || !(Number(amount) > 0) || !reason.trim()) && { opacity: 0.5 }]} onPress={submit} disabled={saving || !(Number(amount) > 0) || !reason.trim()}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{refundTo === 'credit' ? `Give ${money(Number(amount) || 0)} credit` : isCard ? `Refund ${money(Number(amount) || 0)} to card` : `Record ${money(Number(amount) || 0)} refund`}</Text>}
            </TouchableOpacity>
            <Text style={styles.note}>Every refund alerts all admins (push, email, and text) with your name.</Text>
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
  methodRow:  { flexDirection: 'row', gap: 8, marginTop: 6 },
  methodBtn:  { flex: 1, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 10, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.surfaceAlt, alignItems: 'center' },
  methodBtnOn:{ borderColor: t.green, backgroundColor: t.greenSoft },
  methodTitle:{ fontSize: 14, fontWeight: '800', color: t.textMuted },
  methodTitleOn:{ color: t.green },
  methodSub:  { fontSize: 11, color: t.textFaint, marginTop: 2 },
  methodNote: { fontSize: 12, color: t.textMuted, marginTop: 8, lineHeight: 17 },
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
  submit:   { marginTop: 18, backgroundColor: t.danger, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  submitText:{ color: '#fff', fontWeight: '800', fontSize: 15 },
  note:     { fontSize: 11, color: t.textFaint, marginTop: 10, lineHeight: 16, textAlign: 'center' },
});
