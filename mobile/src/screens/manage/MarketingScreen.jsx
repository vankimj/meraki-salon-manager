import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, RefreshControl, Modal, ScrollView, Alert,
} from 'react-native';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';
import { fetchCampaigns, createCampaignDraft, cancelCampaign, deleteCampaign, buildMarketingRecipients, sendCampaignNow } from '../../lib/firestore';

const GREEN = '#2D7A5F', BLUE = '#3D95CE';
const STATUS_COLOR = {
  draft:     ['#f5f5f5', '#888'],
  scheduled: ['#eff6ff', '#2563eb'],
  sending:   ['#fffbeb', '#b45309'],
  sent:      ['#f0fdf4', '#16a34a'],
  cancelled: ['#fef2f2', '#b91c1c'],
};

// Mobile manages campaign DRAFTS only — scheduling/sending (which fires real
// SMS/email to clients) stays on the web app on purpose.
export default function MarketingScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['campaigns'], isAdmin);
  const [items, setItems]   = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => { try { setItems(await fetchCampaigns()); } catch { setItems([]); } }, []);
  useEffect(() => { load(); }, [load]);

  async function saveDraft() {
    if (!editing.title?.trim()) { Alert.alert('Title required'); return; }
    setSaving(true);
    try { await createCampaignDraft({ title: editing.title.trim(), type: editing.type, template: editing.template || '' }); setEditing(null); await load(); }
    catch (e) { Alert.alert('Couldn\'t save', e?.message || 'Try again.'); }
    finally { setSaving(false); }
  }
  function confirmCancel(item) {
    Alert.alert('Cancel campaign?', 'Stops a scheduled/sending campaign.', [
      { text: 'No', style: 'cancel' },
      { text: 'Cancel it', style: 'destructive', onPress: async () => { try { await cancelCampaign(item.id); await load(); } catch {} } },
    ]);
  }
  // Mass-send with TCPA opt-in filtering + a hard double-confirm. Creates a
  // 'pending' campaign doc → the send Cloud Function trigger delivers it.
  async function sendDraft(item) {
    const channel = item.type || 'sms';
    let recipients;
    try { recipients = await buildMarketingRecipients(channel); }
    catch (e) { Alert.alert('Couldn\'t build audience', e?.message || 'Try again.'); return; }
    const n = recipients.length;
    if (n === 0) { Alert.alert('No recipients', `No clients are opted in for ${channel.toUpperCase()} marketing.`); return; }
    const segs = channel === 'sms' ? Math.max(1, Math.ceil((item.template || '').length / 160)) : 1;
    const cost = channel === 'sms' ? n * segs * 0.0079 : 0;
    const costStr = cost ? ` · ~$${cost.toFixed(2)}` : '';
    Alert.alert(
      `Send to ${n} client${n === 1 ? '' : 's'}?`,
      `This sends a REAL ${channel.toUpperCase()} to ${n} opted-in client${n === 1 ? '' : 's'}${costStr}. It cannot be undone once it starts.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Review', onPress: () => Alert.alert(
          'Final confirmation',
          `Send "${item.title}" now to ${n} ${channel.toUpperCase()} recipient${n === 1 ? '' : 's'}?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: `Send to ${n}`, style: 'destructive', onPress: async () => {
              try {
                await sendCampaignNow({
                  name: item.title, channel,
                  smsBody: channel === 'sms' ? (item.template || '') : '',
                  subject: item.title, body: channel === 'email' ? (item.template || '') : '',
                  recipients,
                });
                await load();
                Alert.alert('Sending', `Campaign queued to ${n} recipient${n === 1 ? '' : 's'}.`);
              } catch (e) { Alert.alert('Send failed', e?.message || 'Try again.'); }
            } },
          ],
        ) },
      ],
    );
  }

  function confirmDelete(item) {
    Alert.alert('Delete campaign?', 'Restorable from Trash for 30 days.', [
      { text: 'No', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteCampaign(item.id); await load(); } catch {} } },
    ]);
  }

  if (items === null) return <View style={styles.center}><ActivityIndicator color={GREEN} /></View>;

  return (
    <View style={styles.wrap}>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 14, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={GREEN} />}
        ListHeaderComponent={<Text style={styles.note}>Create a draft, then Send to all opted-in clients (with confirmation). Advanced audience segmentation + scheduling are on the web app.</Text>}
        ListEmptyComponent={<Text style={styles.empty}>No campaigns yet.</Text>}
        renderItem={({ item }) => {
          const [bg, c] = STATUS_COLOR[item.status] || STATUS_COLOR.draft;
          const canCancel = ['scheduled', 'sending'].includes(item.status);
          return (
            <View style={styles.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title} numberOfLines={1}>{item.title || item.subject || '(untitled)'}</Text>
                <Text style={styles.sub} numberOfLines={1}>{(item.type || 'sms').toUpperCase()}{item.scheduledFor ? ` · ${new Date(item.scheduledFor).toLocaleDateString()}` : ''}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: bg }]}><Text style={[styles.badgeText, { color: c }]}>{item.status || 'draft'}</Text></View>
              {isAdmin && (item.status === 'draft' || !item.status) && <TouchableOpacity onPress={() => sendDraft(item)} style={styles.sendBtn}><Text style={styles.sendText}>Send</Text></TouchableOpacity>}
              {isAdmin && canCancel && <TouchableOpacity onPress={() => confirmCancel(item)} style={styles.smallBtn}><Text style={styles.smallText}>Cancel</Text></TouchableOpacity>}
              {isAdmin && <TouchableOpacity onPress={() => confirmDelete(item)} style={styles.xBtn}><Text style={styles.xText}>🗑</Text></TouchableOpacity>}
            </View>
          );
        }}
      />
      {isAdmin && (
        <TouchableOpacity style={styles.fab} onPress={() => setEditing({ title: '', type: 'sms', template: '' })}>
          <Text style={styles.fabText}>＋ New draft</Text>
        </TouchableOpacity>
      )}

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>New campaign draft</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <Text style={styles.label}>Title</Text>
              <TextInput style={styles.input} value={editing?.title} onChangeText={v => setEditing({ ...editing, title: v })} placeholder="Spring promo" placeholderTextColor="#bbb" />
              <Text style={styles.label}>Channel</Text>
              <View style={styles.chips}>
                {['sms', 'email'].map(t => (
                  <TouchableOpacity key={t} onPress={() => setEditing({ ...editing, type: t })} style={[styles.chip, editing?.type === t && styles.chipOn]}>
                    <Text style={[styles.chipText, editing?.type === t && styles.chipTextOn]}>{t.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>Message</Text>
              <TextInput style={[styles.input, { height: 100, textAlignVertical: 'top' }]} multiline value={editing?.template} onChangeText={v => setEditing({ ...editing, template: v })} placeholder="Hi {firstName}! …" placeholderTextColor="#bbb" />
            </ScrollView>
            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={saveDraft} disabled={saving}>
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save draft'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditing(null)} style={{ alignItems: 'center', paddingVertical: 10 }}><Text style={{ color: '#888', fontWeight: '600' }}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: '#f5f7fa' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  note:      { fontSize: 12, color: '#999', marginBottom: 10 },
  empty:     { textAlign: 'center', color: '#999', marginTop: 50, fontSize: 13 },
  row:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: '#ececec', gap: 8 },
  title:     { fontSize: 14.5, fontWeight: '700', color: '#1a1a1a' },
  sub:       { fontSize: 12, color: '#8a8a8a', marginTop: 2 },
  badge:     { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  sendBtn:   { backgroundColor: '#eef5f2', borderWidth: 1, borderColor: GREEN, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  sendText:  { fontSize: 12, fontWeight: '800', color: GREEN },
  smallBtn:  { borderWidth: 1, borderColor: '#d5d8db', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  smallText: { fontSize: 11, fontWeight: '700', color: '#555' },
  xBtn:      { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fdecea', alignItems: 'center', justifyContent: 'center' },
  xText:     { fontSize: 13 },
  fab:       { position: 'absolute', right: 18, bottom: 24, backgroundColor: GREEN, borderRadius: 26, paddingHorizontal: 20, paddingVertical: 14 },
  fabText:   { color: '#fff', fontWeight: '800', fontSize: 14 },
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:     { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 24 },
  sheetTitle:{ fontSize: 18, fontWeight: '800', color: '#1a1a1a', marginBottom: 6 },
  label:     { fontSize: 12, fontWeight: '700', color: '#888', marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input:     { backgroundColor: '#f6f7f9', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: '#1a1a1a', borderWidth: 1, borderColor: '#ececec' },
  chips:     { flexDirection: 'row', gap: 8 },
  chip:      { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 16, backgroundColor: '#f1f3f5', borderWidth: 1, borderColor: '#e3e6e8' },
  chipOn:    { backgroundColor: '#eef5f2', borderColor: GREEN },
  chipText:  { fontSize: 13, color: '#666', fontWeight: '700' },
  chipTextOn:{ color: GREEN },
  saveBtn:   { marginTop: 18, backgroundColor: BLUE, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveText:  { color: '#fff', fontWeight: '800', fontSize: 15 },
});
