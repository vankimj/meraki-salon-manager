import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Image, Alert, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { fetchClient, saveClient, fetchClientAppointments } from '../lib/firestore';
import Icon from '../components/Icon';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'social',  label: 'Social'  },
  { id: 'visits',  label: 'Visits'  },
];

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ClientDetailScreen({ route, navigation }) {
  const { clientId } = route.params || {};
  const [client,  setClient]  = useState(null);
  const [draft,   setDraft]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab,     setTab]     = useState('profile');
  const [visits,  setVisits]  = useState([]);

  // Load client + visit history once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, appts] = await Promise.all([
          fetchClient(clientId),
          fetchClientAppointments(clientId),
        ]);
        if (cancelled) return;
        setClient(c);
        setDraft(c);
        setVisits(appts);
      } catch (e) {
        if (!cancelled) Alert.alert('Couldn\'t load client', e?.message || 'Try again later.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  // Header right button: Edit ↔ Save.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        editing
          ? <TouchableOpacity onPress={handleSave} disabled={saving} style={{ marginRight: 12 }}>
              <Text style={[styles.headerBtn, saving && { opacity: 0.5 }]}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          : <TouchableOpacity onPress={() => setEditing(true)} style={{ marginRight: 12 }}>
              <Text style={styles.headerBtn}>Edit</Text>
            </TouchableOpacity>
      ),
    });
  }, [navigation, editing, saving, draft]);

  const handleSave = useCallback(async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      // Only persist editable fields — don't overwrite system fields
      // like _demo, createdAt, visits[], etc.
      const payload = {
        name:       draft.name || '',
        phone:      draft.phone || '',
        email:      draft.email || '',
        address:    draft.address || '',
        birthday:   draft.birthday || '',
        notes:      draft.notes || '',
        instagram:  draft.instagram || '',
        facebook:   draft.facebook || '',
        tiktok:     draft.tiktok || '',
        venmo:      draft.venmo || '',
      };
      await saveClient(clientId, payload);
      setClient({ ...client, ...payload });
      setEditing(false);
    } catch (e) {
      Alert.alert('Couldn\'t save', e?.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  }, [draft, saving, client, clientId]);

  if (loading) {
    return <ActivityIndicator style={{ marginTop: 60 }} color="#3D95CE" />;
  }
  if (!client) {
    return (
      <View style={styles.emptyState}>
        <Icon name="person" size={56} color="#cbd0d6" strokeWidth={1.5} />
        <Text style={[styles.emptyTitle, { marginTop: 14 }]}>Client not found</Text>
      </View>
    );
  }

  const set = (k, v) => setDraft(prev => ({ ...prev, [k]: v }));

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}
    >
      <View style={styles.container}>
        {/* Avatar + name header */}
        <View style={styles.identity}>
          {client.picture
            ? <Image source={{ uri: client.picture }} style={styles.avatar} />
            : <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{(client.name || '?')[0].toUpperCase()}</Text>
              </View>
          }
          <Text style={styles.name}>{client.name}</Text>
          {visits.length > 0 && (
            <Text style={styles.visitsCount}>{visits.length} visit{visits.length !== 1 ? 's' : ''}</Text>
          )}
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[styles.tabBtn, tab === t.id && styles.tabBtnActive]}
              onPress={() => setTab(t.id)}
            >
              <Text style={[styles.tabBtnText, tab === t.id && styles.tabBtnTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {tab === 'profile' && (
            <>
              <Field label="Name"     value={draft.name}     onChange={v => set('name', v)}     editing={editing} />
              <Field label="Phone"    value={draft.phone}    onChange={v => set('phone', v)}    editing={editing} keyboard="phone-pad" tel={!editing && draft.phone} />
              <Field label="Email"    value={draft.email}    onChange={v => set('email', v)}    editing={editing} keyboard="email-address" mail={!editing && draft.email} />
              <Field label="Address"  value={draft.address}  onChange={v => set('address', v)}  editing={editing} multiline />
              <Field label="Birthday" value={draft.birthday} onChange={v => set('birthday', v)} editing={editing} placeholder="YYYY-MM-DD" />
              <Field label="Notes"    value={draft.notes}    onChange={v => set('notes', v)}    editing={editing} multiline rows={4}
                     placeholder="Allergies, preferences, last polish, anything the next stylist should know..." />
            </>
          )}

          {tab === 'social' && (
            <>
              <Field label="Instagram" value={draft.instagram} onChange={v => set('instagram', v)} editing={editing} placeholder="@handle" />
              <Field label="Facebook"  value={draft.facebook}  onChange={v => set('facebook', v)}  editing={editing} placeholder="profile.url or @handle" />
              <Field label="TikTok"    value={draft.tiktok}    onChange={v => set('tiktok', v)}    editing={editing} placeholder="@handle" />
              <Field label="Venmo"     value={draft.venmo}     onChange={v => set('venmo', v)}     editing={editing} placeholder="@username" />
            </>
          )}

          {tab === 'visits' && (
            visits.length === 0
              ? <View style={styles.visitEmpty}>
                  <Icon name="calendar" size={40} color="#cbd0d6" strokeWidth={1.5} />
                  <Text style={[styles.visitEmptyText, { marginTop: 10 }]}>No appointments yet</Text>
                </View>
              : visits.map(v => (
                  <View key={v.id} style={styles.visitCard}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.visitDate}>{fmtDate(v.date)}{v.startTime ? ` · ${v.startTime}` : ''}</Text>
                      <Text style={styles.visitTech} numberOfLines={1}>
                        {[v.techName, (v.services || []).map(s => s.name).filter(Boolean).join(', ')]
                          .filter(Boolean).join(' · ')}
                      </Text>
                      {v.notes ? (
                        <Text style={styles.visitNotes} numberOfLines={2}>{v.notes}</Text>
                      ) : null}
                    </View>
                    <StatusPill status={v.status} />
                  </View>
                ))
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange, editing, multiline, rows, placeholder, keyboard, tel, mail }) {
  if (!editing) {
    if (!value) return null;
    return (
      <View style={styles.viewRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {tel ? (
          <TouchableOpacity onPress={() => Linking.openURL(`tel:${value.replace(/[^0-9+]/g,'')}`)}>
            <Text style={[styles.fieldValue, styles.linkText]}>{value}</Text>
          </TouchableOpacity>
        ) : mail ? (
          <TouchableOpacity onPress={() => Linking.openURL(`mailto:${value}`)}>
            <Text style={[styles.fieldValue, styles.linkText]}>{value}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.fieldValue}>{value}</Text>
        )}
      </View>
    );
  }
  return (
    <View style={styles.editRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value || ''}
        onChangeText={onChange}
        multiline={multiline}
        numberOfLines={rows}
        keyboardType={keyboard}
        placeholder={placeholder}
        placeholderTextColor="#bbb"
        style={[styles.editInput, multiline && { minHeight: rows ? rows * 22 : 60, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

function StatusPill({ status }) {
  const meta = {
    scheduled: { label: 'Scheduled', color: '#3D95CE', bg: '#EBF4FB' },
    done:      { label: 'Done',      color: '#16a34a', bg: '#f0fdf4' },
    cancelled: { label: 'Cancelled', color: '#ef4444', bg: '#fef2f2' },
    no_show:   { label: 'No-show',   color: '#92400e', bg: '#fef3c7' },
  }[status] || { label: status || 'Unknown', color: '#888', bg: '#f5f5f5' };
  return (
    <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10, backgroundColor: meta.bg }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: meta.color }}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  headerBtn: { color: '#2D7A5F', fontSize: 15, fontWeight: '600' },

  identity: { alignItems: 'center', paddingVertical: 22, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ebebeb' },
  avatar:   { width: 84, height: 84, borderRadius: 42, marginBottom: 10 },
  avatarFallback:  { backgroundColor: '#e8f4f0', alignItems: 'center', justifyContent: 'center' },
  avatarInitial:   { fontSize: 30, fontWeight: '700', color: '#2D7A5F' },
  name:        { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  visitsCount: { fontSize: 12, color: '#3D95CE', fontWeight: '600', marginTop: 4 },

  tabRow:        { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ebebeb' },
  tabBtn:        { flex: 1, paddingVertical: 11, alignItems: 'center' },
  tabBtnActive:  { borderBottomWidth: 2, borderBottomColor: '#3D95CE' },
  tabBtnText:    { fontSize: 13, color: '#888', fontWeight: '500' },
  tabBtnTextActive: { color: '#1a5f8a', fontWeight: '700' },

  viewRow:    { backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, marginBottom: 10 },
  editRow:    { backgroundColor: '#fff', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, marginBottom: 10 },
  fieldLabel: { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600', marginBottom: 4 },
  fieldValue: { fontSize: 14, color: '#1a1a1a' },
  linkText:   { color: '#3D95CE', textDecorationLine: 'underline' },
  editInput:  { fontSize: 14, color: '#1a1a1a', padding: 0 },

  visitCard:  { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  visitDate:  { fontSize: 13, fontWeight: '700', color: '#1a1a1a' },
  visitTech:  { fontSize: 12, color: '#888', marginTop: 3 },
  visitNotes: { fontSize: 12, color: '#666', marginTop: 6, fontStyle: 'italic' },
  visitEmpty: { alignItems: 'center', paddingTop: 40 },
  visitEmptyIcon: { fontSize: 36, marginBottom: 8 },
  visitEmptyText: { fontSize: 13, color: '#888' },

  emptyState: { alignItems: 'center', paddingTop: 80 },
  emptyIcon:  { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
});
