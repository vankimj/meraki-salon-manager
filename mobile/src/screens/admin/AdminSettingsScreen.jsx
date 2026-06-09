import { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Switch, Alert } from 'react-native';
import { fetchSettings, updateSettings, setKioskPin, hasKioskPin } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
const RECEIPT_MODES = [
  { value: 'auto', label: 'Auto' }, { value: 'email', label: 'Email' },
  { value: 'sms',  label: 'SMS' },  { value: 'both',  label: 'Both' },
];
const DEPOSIT_MODES = [
  { value: 'store',     label: 'Store card' },
  { value: 'authorize', label: 'Authorize hold' },
  { value: 'charge',    label: 'Charge deposit' },
];
const DEFAULT_BCP = { firstTimeRequireCard: false, allBookingsRequireCard: false, depositMode: 'store', depositPct: 0 };

// Field-driven settings editor — the most-used editable settings. The full
// web Settings catalog (booking flow, themes, geo check-in, Stripe, demo
// data, etc.) stays on web; these are the day-to-day ones.
const FIELDS = [
  { key: 'timeoutMin',     label: 'Auto sign-out (minutes)', type: 'number', def: 5 },
  { key: 'taxRate',        label: 'Sales tax rate (%)',      type: 'number', def: 0 },
  { key: 'ccFeePct',       label: 'Card fee (%)',            type: 'number', def: 0 },
  { key: 'ccFeeFlat',      label: 'Card fee (flat $)',       type: 'number', def: 0 },
  { key: 'removalPrice',   label: 'Removal service price ($)', type: 'number', def: 0 },
  { key: 'noCardTips',     label: 'Disable tips on card',    type: 'bool' },
  { key: 'walkinPartialTurns',  label: 'Walk-in: partial turns (full / half / none)', type: 'bool' },
  { key: 'walkinRequestNoTurn', label: "Walk-in: requested tech doesn't take a turn",  type: 'bool' },
  { key: 'walkinSeniorityOrder', label: 'Walk-in: break turn ties by seniority',        type: 'bool' },
  { key: 'terminalLocationId', label: 'Stripe Terminal Location ID (tml_…)', type: 'text' },
  { key: 'googleReviewUrl',label: 'Google review URL',       type: 'text' },
  { key: 'ein',            label: 'Business EIN',            type: 'text' },
];

export default function AdminSettingsScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [settings, setSettings] = useState(null);
  const [draft,    setDraft]    = useState({});
  const [receipt,  setReceipt]  = useState('auto');
  const [refundDefault, setRefundDefault] = useState('withhold');
  const [bcp, setBcp] = useState(DEFAULT_BCP);   // bookingCardPolicy draft
  const [saving,   setSaving]   = useState(false);
  const [kPin, setKPin]       = useState('');
  const [kHas, setKHas]       = useState(false);
  const [kSaving, setKSaving] = useState(false);

  async function saveKioskPin() {
    if (!/^\d{4}$/.test(kPin)) { Alert.alert('PIN must be 4 digits'); return; }
    setKSaving(true);
    try { await setKioskPin(kPin); setKHas(true); setKPin(''); Alert.alert('Saved', 'Kiosk exit PIN updated.'); }
    catch (e) { Alert.alert('Couldn\'t save', e?.message || 'Please try again.'); }
    finally { setKSaving(false); }
  }

  const load = useCallback(async () => {
    const s = await fetchSettings().catch(() => ({})) || {};
    setSettings(s);
    const d = {};
    FIELDS.forEach(f => { d[f.key] = f.type === 'bool' ? !!s[f.key] : (s[f.key] ?? f.def ?? ''); });
    setDraft(d);
    setReceipt(s.receiptDelivery || 'auto');
    setRefundDefault(s.refundCommissionDefault === 'goodwill' ? 'goodwill' : 'withhold');
    setBcp({ ...DEFAULT_BCP, ...(s.bookingCardPolicy || {}) });
    hasKioskPin().then(r => setKHas(!!r.hasPin)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const payload = {
        receiptDelivery: receipt,
        refundCommissionDefault: refundDefault,
        bookingCardPolicy: {
          firstTimeRequireCard:   !!bcp.firstTimeRequireCard,
          allBookingsRequireCard: !!bcp.allBookingsRequireCard,
          depositMode:            DEPOSIT_MODES.some(m => m.value === bcp.depositMode) ? bcp.depositMode : 'store',
          depositPct:             Math.min(100, Math.max(0, Math.round(Number(bcp.depositPct) || 0))),
        },
      };
      FIELDS.forEach(f => {
        if (f.type === 'number') payload[f.key] = Number(draft[f.key]) || 0;
        else if (f.type === 'bool') payload[f.key] = !!draft[f.key];
        else payload[f.key] = draft[f.key] || '';
      });
      await updateSettings(payload);
      Alert.alert('Saved', 'Settings updated.');
    } catch (e) { Alert.alert('Couldn\'t save', e?.message || 'Please try again.'); }
    finally { setSaving(false); }
  }

  if (settings === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.card}>
        <Text style={styles.readLabel}>Plan</Text>
        <Text style={styles.readValue}>{settings.plan || 'pro'}</Text>
        <Text style={[styles.readLabel, { marginTop: 12 }]}>Salon</Text>
        <Text style={styles.readValue}>{settings.salonName || '—'}</Text>
      </View>

      <Text style={styles.section}>Editable</Text>
      {FIELDS.map(f => (
        <View key={f.key}>
          <Text style={styles.fieldLabel}>{f.label}</Text>
          {f.type === 'bool' ? (
            <Switch value={!!draft[f.key]} onValueChange={v => setDraft({ ...draft, [f.key]: v })} trackColor={{ true: theme.green }} />
          ) : (
            <TextInput
              style={styles.input}
              value={String(draft[f.key] ?? '')}
              onChangeText={v => setDraft({ ...draft, [f.key]: v })}
              keyboardType={f.type === 'number' ? 'decimal-pad' : 'default'}
              autoCapitalize="none"
            />
          )}
        </View>
      ))}

      <Text style={styles.section}>Card on file for booking</Text>
      <Text style={styles.note}>Require online-booking clients to put a card on file before confirming. Separate from the cancellation-history policy.</Text>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Require for first-time clients</Text>
        <Switch value={!!bcp.firstTimeRequireCard} onValueChange={v => setBcp({ ...bcp, firstTimeRequireCard: v })} trackColor={{ true: theme.green }} />
      </View>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Require on all online bookings</Text>
        <Switch value={!!bcp.allBookingsRequireCard} onValueChange={v => setBcp({ ...bcp, allBookingsRequireCard: v })} trackColor={{ true: theme.green }} />
      </View>
      {(bcp.firstTimeRequireCard || bcp.allBookingsRequireCard) && (
        <>
          <Text style={styles.fieldLabel}>Deposit handling</Text>
          <View style={styles.chips}>
            {DEPOSIT_MODES.map(m => {
              const on = bcp.depositMode === m.value;
              return (
                <TouchableOpacity key={m.value} onPress={() => setBcp({ ...bcp, depositMode: m.value })} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.fieldLabel}>Deposit percentage (of total)</Text>
          <TextInput
            style={styles.input}
            value={String(bcp.depositPct ?? 0)}
            onChangeText={v => setBcp({ ...bcp, depositPct: v.replace(/[^0-9]/g, '').slice(0, 3) })}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={theme.placeholder}
          />
          <Text style={styles.note}>
            {bcp.depositMode === 'store'     ? 'Card is saved; nothing charged at booking — charge the % only on a no-show.' :
             bcp.depositMode === 'authorize' ? 'Authorization hold for the % at booking; captured on no-show, released otherwise.' :
                                               'Charge the % as a deposit at booking, credited at checkout.'}
          </Text>
        </>
      )}

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

      <Text style={styles.fieldLabel}>Refund commission default</Text>
      <View style={styles.chips}>
        {[{ value: 'withhold', label: 'Withhold from tech' }, { value: 'goodwill', label: 'Salon absorbs' }].map(m => {
          const on = refundDefault === m.value;
          return (
            <TouchableOpacity key={m.value} onPress={() => setRefundDefault(m.value)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{m.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.note}>Default for new refunds — staff can override per tech at refund time.</Text>

      <Text style={styles.section}>Front-desk kiosk</Text>
      <TouchableOpacity style={styles.navRow} onPress={() => navigation?.navigate('AdminTipFlow')}>
        <View style={{ flex: 1 }}>
          <Text style={styles.navRowLabel}>TipFlow slides</Text>
          <Text style={styles.navRowSub}>Tech photos + tip QR shown on the kiosk while idle</Text>
        </View>
        <Text style={styles.navRowChevron}>›</Text>
      </TouchableOpacity>

      <Text style={styles.fieldLabel}>Kiosk exit PIN</Text>
      <Text style={styles.note}>{kHas ? 'A PIN is set. Enter a new 4-digit PIN to change it.' : 'Set a 4-digit PIN. Required to lock + leave the clock and front-desk kiosks.'}</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <TextInput style={[styles.input, { flex: 1 }]} value={kPin} onChangeText={t => setKPin(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="4-digit PIN" placeholderTextColor={theme.placeholder} secureTextEntry maxLength={4} />
        <TouchableOpacity style={[styles.saveBtn, { marginTop: 0, paddingHorizontal: 20 }, (kSaving || kPin.length !== 4) && { opacity: 0.5 }]} onPress={saveKioskPin} disabled={kSaving || kPin.length !== 4}>
          <Text style={styles.saveText}>{kSaving ? '…' : kHas ? 'Change' : 'Set'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save settings'}</Text>
      </TouchableOpacity>
      <Text style={styles.note}>Booking flow, themes, geo check-in, payments & demo data are on the web app.</Text>
    </ScrollView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: t.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  card:      { backgroundColor: t.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: t.border },
  readLabel: { fontSize: 11, fontWeight: '700', color: t.textFaint, textTransform: 'uppercase', letterSpacing: 0.3 },
  readValue: { fontSize: 16, fontWeight: '600', color: t.text, marginTop: 3, textTransform: 'capitalize' },
  section:   { fontSize: 13, fontWeight: '800', color: t.text, marginTop: 22, marginBottom: 4 },
  fieldLabel:{ fontSize: 12, fontWeight: '700', color: t.textMuted, marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input:     { backgroundColor: t.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  chips:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:      { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  chipOn:    { backgroundColor: t.greenSoft, borderColor: t.green },
  chipText:  { fontSize: 13, color: t.textMuted, fontWeight: '600' },
  chipTextOn:{ color: t.green, fontWeight: '800' },
  saveBtn:   { marginTop: 24, backgroundColor: t.blue, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveText:  { color: '#fff', fontWeight: '800', fontSize: 15 },
  note:      { fontSize: 12, color: t.textFaint, marginTop: 14, lineHeight: 17 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  toggleLabel:{ flex: 1, fontSize: 14, color: t.text, fontWeight: '600', paddingRight: 12 },
  navRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.border, marginTop: 6 },
  navRowLabel:{ fontSize: 15, fontWeight: '700', color: t.text },
  navRowSub: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  navRowChevron:{ fontSize: 22, color: t.textFaint, marginLeft: 8 },
});
