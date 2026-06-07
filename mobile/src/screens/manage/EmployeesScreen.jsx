import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import ManageCrud from './ManageCrud';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';
import { fetchEmployees, createEmployee, saveEmployee, deleteEmployee, fetchServices, setEmployeePin, clearEmployeePin } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Set / change / clear a tech's 4-digit clock-in PIN (scrypt-hashed server-side
// via setEmployeePin). Only shown for an already-saved employee (needs an id).
function EmployeePinField({ employee }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [pin, setPin]   = useState('');
  const [busy, setBusy] = useState(false);
  const [has, setHas]   = useState(!!employee.pinHash);

  async function save() {
    if (!/^\d{4}$/.test(pin)) { Alert.alert('PIN must be 4 digits'); return; }
    setBusy(true);
    try { await setEmployeePin(employee.id, pin); setHas(true); setPin(''); Alert.alert('Saved', `Clock-in PIN ${has ? 'changed' : 'set'} for ${employee.name}.`); }
    catch (e) { Alert.alert('Couldn\'t save', e?.message || 'Please try again.'); }
    finally { setBusy(false); }
  }
  async function clear() {
    setBusy(true);
    try { await clearEmployeePin(employee.id); setHas(false); setPin(''); Alert.alert('Cleared', `${employee.name}'s PIN removed.`); }
    catch (e) { Alert.alert('Couldn\'t clear', e?.message || 'Please try again.'); }
    finally { setBusy(false); }
  }

  return (
    <View>
      <Text style={styles.pinStatus}>{has ? 'A PIN is set. Enter a new 4-digit PIN to change it.' : 'No PIN yet — set one so they can clock in at the kiosk.'}</Text>
      <View style={styles.pinRow}>
        <TextInput style={styles.pinInput} value={pin} onChangeText={t => setPin(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" secureTextEntry maxLength={4} placeholder="4-digit PIN" placeholderTextColor={theme.placeholder} />
        <TouchableOpacity style={[styles.pinBtn, (busy || pin.length !== 4) && { opacity: 0.5 }]} onPress={save} disabled={busy || pin.length !== 4}>
          <Text style={styles.pinBtnText}>{has ? 'Change' : 'Set'}</Text>
        </TouchableOpacity>
        {has && (
          <TouchableOpacity style={styles.pinClear} onPress={clear} disabled={busy}><Text style={styles.pinClearText}>Clear</Text></TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  pinStatus: { fontSize: 12.5, color: t.textMuted, marginBottom: 8, lineHeight: 17 },
  pinRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pinInput:  { flex: 1, backgroundColor: t.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  pinBtn:    { backgroundColor: t.green, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 18 },
  pinBtnText:{ color: '#fff', fontWeight: '800', fontSize: 14 },
  pinClear:  { paddingVertical: 11, paddingHorizontal: 12 },
  pinClearText:{ color: t.danger, fontWeight: '700', fontSize: 14 },
});

// Public employee fields only. Compensation/payroll (employees/{id}/private/
// comp) is admin-only and edited on the web app via a writeBatch split — not
// exposed here to avoid partial-write leakage of sensitive fields.
const BASE_FIELDS = [
  { key: 'name',      label: 'Name',      type: 'text', required: true, placeholder: 'Yasmin D' },
  { key: 'email',     label: 'Email',     type: 'text', keyboard: 'email-address', placeholder: 'name@salon.com' },
  { key: 'phone',     label: 'Phone',     type: 'text', keyboard: 'phone-pad' },
  { key: 'instagram', label: 'Instagram', type: 'text', placeholder: '@handle' },
  { key: 'active',    label: 'Active',    type: 'bool' },
];

export default function EmployeesScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['employees'], isAdmin);
  // Services power the "Services performed" multiselect (serviceIds). Same
  // field the web EmployeesAdmin edits + the booking/schedule flow reads.
  const [services, setServices] = useState([]);
  useEffect(() => { fetchServices().then(s => setServices(s || [])).catch(() => setServices([])); }, []);

  const fields = [
    ...BASE_FIELDS,
    {
      key: 'serviceIds', label: 'Services performed', type: 'multiselect',
      options: services.filter(s => s.active !== false).map(s => ({ value: s.id, label: s.name })),
      emptyLabel: 'Add services first (Manage → Services).',
    },
    {
      key: 'pin', label: 'Clock-in PIN', type: 'custom',
      show: (item) => !!item.id,   // existing employees only (needs an id)
      render: (item) => <EmployeePinField employee={item} />,
    },
  ];

  return (
    <ManageCrud
      load={fetchEmployees}
      create={createEmployee}
      save={saveEmployee}
      remove={deleteEmployee}
      canEdit={isAdmin}
      blank={() => ({ name: '', email: '', phone: '', instagram: '', active: true, serviceIds: [], sortOrder: 999 })}
      fields={fields}
      titleOf={(e) => e.name}
      subtitleOf={(e) => {
        const n = Array.isArray(e.serviceIds) ? e.serviceIds.length : 0;
        return [e.email, e.phone].filter(Boolean).join(' · ')
          || (n ? `${n} service${n === 1 ? '' : 's'}` : (e.active === false ? 'inactive' : '—'));
      }}
      addLabel="New employee"
    />
  );
}
