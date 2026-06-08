import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Modal, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { redoService, fetchEmployees } from '../lib/firestore';
import { genReceiptToken } from '../lib/checkout';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Derive the redoable service line items from a receipt. Prefer the explicit
// `services` line items (name, price, original tech); fall back to one row per
// tech in payment.techSplit (using their split revenue) when no line items.
function deriveServices(receipt) {
  if (!receipt) return [];
  const pay = receipt.payment || {};
  const lines = Array.isArray(receipt.services) ? receipt.services : [];
  const fromLines = lines
    .map(s => ({
      name:     String(s?.name || '').trim(),
      amount:   Number(s?.price) || 0,
      techName: String(s?.techName || pay.techName || receipt.techName || '').trim(),
    }))
    .filter(s => s.name && s.amount > 0 && s.techName);
  if (fromLines.length) return fromLines;
  const split = Array.isArray(pay.techSplit) ? pay.techSplit : [];
  return split
    .map(s => ({
      name:     'Service',
      amount:   Number(s?.revenue) || 0,
      techName: String(s?.techName || '').trim(),
    }))
    .filter(s => s.amount > 0 && s.techName);
}

// Record a service redo from the receipts hub. Multi-select the redone
// service(s), pick the tech who redid the work, and a reason. The server moves
// the commission for those services from the original tech to the redo tech —
// NO money is refunded. Idempotent (one stable key per open sheet).
export default function RedoSheet({ receipt, onClose, onDone }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const open = !!receipt;

  const items = deriveServices(receipt);

  const [selected, setSelected] = useState({});   // { index: true }
  const [redoTech, setRedoTech] = useState('');
  const [reason,   setReason]   = useState('');
  const [techs,    setTechs]    = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [idemKey,  setIdemKey]  = useState('');

  useEffect(() => {
    if (receipt) {
      setSelected({}); setRedoTech(''); setReason(''); setSaving(false);
      setIdemKey(genReceiptToken(24));   // one stable idempotency key per sheet open
      fetchEmployees()
        .then(list => setTechs((list || []).filter(e => e.active !== false && (e.name || '').trim())))
        .catch(() => setTechs([]));
    }
  }, [receipt?.id]);

  const selectedItems = items.filter((_, i) => selected[i]);
  const totalAmt = selectedItems.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const canSubmit = selectedItems.length > 0 && !!redoTech && !!reason.trim() && !saving;

  function toggle(i) {
    setSelected(p => ({ ...p, [i]: !p[i] }));
  }

  async function submit() {
    if (selectedItems.length === 0) { Alert.alert('Select a service', 'Pick at least one service that was redone.'); return; }
    if (!redoTech) { Alert.alert('Choose a tech', 'Who redid the service?'); return; }
    if (!reason.trim()) { Alert.alert('Reason required', 'Add a short reason for the redo.'); return; }
    if (saving) return;
    setSaving(true);
    try {
      const res = await redoService({
        receiptId: receipt.id,
        services: selectedItems.map(it => ({ name: it.name, amount: it.amount, techName: it.techName })),
        redoTech,
        reason: reason.trim(),
        idempotencyKey: idemKey,
        notify: true,
      });
      if (!res?.ok) throw new Error(res?.error || 'Redo failed.');
      onDone?.({ amount: totalAmt, redoTech, message: `Redo recorded — ${money(totalAmt)} in commission moved to ${redoTech}.` });
    } catch (e) {
      Alert.alert('Redo failed', e?.message || 'Please try again.');
      setSaving(false);
    }
  }

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Redo service</Text>
              <TouchableOpacity onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.sub}>{receipt?.clientName || 'Walk-in'}{receipt?.techName ? ` · originally ${receipt.techName}` : ''}</Text>

              <Text style={styles.label}>Which service(s) were redone?</Text>
              {items.length === 0 ? (
                <Text style={styles.methodNote}>No redoable services found on this sale.</Text>
              ) : items.map((it, i) => {
                const on = !!selected[i];
                return (
                  <TouchableOpacity key={`it${i}`} style={[styles.itemRow, on && styles.itemRowOn]} onPress={() => toggle(i)} activeOpacity={0.8}>
                    <View style={[styles.checkbox, on && styles.checkboxOn]}>{on && <Text style={styles.checkmark}>✓</Text>}</View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemName, on && styles.itemNameOn]} numberOfLines={1}>{it.name}</Text>
                      <Text style={styles.itemTech} numberOfLines={1}>{it.techName}</Text>
                    </View>
                    <Text style={[styles.itemAmt, on && styles.itemNameOn]}>{money(it.amount)}</Text>
                  </TouchableOpacity>
                );
              })}

              <Text style={styles.label}>Redo tech</Text>
              <View style={styles.techWrap}>
                {techs.length === 0 ? (
                  <Text style={styles.methodNote}>No active techs found.</Text>
                ) : techs.map(t => {
                  const name = (t.name || '').trim();
                  const on = redoTech === name;
                  return (
                    <TouchableOpacity key={t.id || name} style={[styles.techChip, on && styles.techChipOn]} onPress={() => setRedoTech(name)} activeOpacity={0.8}>
                      <Text style={[styles.techChipText, on && styles.techChipTextOn]}>{name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>Reason</Text>
              <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} value={reason} onChangeText={setReason} placeholder="Why is this being redone?" placeholderTextColor={theme.placeholder} multiline maxLength={400} />

              <Text style={styles.methodNote}>
                This moves the commission for the selected service(s) from the original tech to {redoTech || 'the redo tech'}. No money is refunded.
              </Text>
            </ScrollView>

            <TouchableOpacity style={[styles.submit, !canSubmit && { opacity: 0.5 }]} onPress={submit} disabled={!canSubmit}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Record redo{totalAmt > 0 ? ` · ${money(totalAmt)}` : ''}</Text>}
            </TouchableOpacity>
            <Text style={styles.note}>The original tech and the redo tech are both notified of the commission change.</Text>
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
  itemRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.surfaceAlt, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 },
  itemRowOn:{ borderColor: t.green, backgroundColor: t.greenSoft },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: t.border, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface },
  checkboxOn:{ borderColor: t.green, backgroundColor: t.green },
  checkmark:{ color: '#fff', fontSize: 14, fontWeight: '900' },
  itemName: { fontSize: 14, fontWeight: '700', color: t.text },
  itemNameOn:{ color: t.green },
  itemTech: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  itemAmt:  { fontSize: 14, fontWeight: '800', color: t.text },
  techWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  techChip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.surfaceAlt },
  techChipOn:{ borderColor: t.green, backgroundColor: t.greenSoft },
  techChipText:{ fontSize: 13, fontWeight: '800', color: t.textMuted },
  techChipTextOn:{ color: t.green },
  input:    { backgroundColor: t.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  methodNote: { fontSize: 12, color: t.textMuted, marginTop: 8, lineHeight: 17 },
  submit:   { marginTop: 18, backgroundColor: t.green, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  submitText:{ color: '#fff', fontWeight: '800', fontSize: 15 },
  note:     { fontSize: 11, color: t.textFaint, marginTop: 10, lineHeight: 16, textAlign: 'center' },
});
