import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { fetchAppointmentsByRange, draftConflictTexts, sendSmsToClient } from '../lib/firestore';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}
function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
  catch { return d; }
}

// When a tech takes time off, surface the appointments that collide and let
// them send an AI-drafted "I'm out, here's how to reschedule" text to each
// affected client. Mirrors the web ScheduleAdmin conflict flow; the drafting +
// reschedule links come from the draftConflictMessages Cloud Function, the send
// from sendDirectSms. Walk-ins / clients without a phone can't be texted.
export default function ConflictTextsModal({ entry, onClose }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const open = !!entry;
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]); // [{ appt, text, status, error }]
  const [error, setError] = useState('');

  useEffect(() => {
    if (!entry) { setItems([]); setError(''); return; }
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const all = await fetchAppointmentsByRange(entry.startDate, entry.endDate);
        const tech = (entry.techName || '').toLowerCase();
        const affectedAppts = all.filter(a =>
          (a.status !== 'done' && a.status !== 'cancelled' && !a._deleted) &&
          (((a.techName || '').toLowerCase() === tech) || (a.techSplit || []).some(s => (s.techName || '').toLowerCase() === tech)) &&
          a.clientId && a.clientPhone,
        );
        if (affectedAppts.length === 0) { if (alive) { setItems([]); setLoading(false); } return; }
        const affected = affectedAppts.map(a => ({
          id: a.id, clientName: a.clientName || 'Client', clientPhone: a.clientPhone || '',
          clientEmail: a.clientEmail || '', date: a.date, startTime: a.startTime,
          services: a.services || [], techRequestType: a.techRequestType || 'scheduler', newTechName: null,
        }));
        const { drafts = [] } = await draftConflictTexts({
          technicianName: entry.techName, reason: entry.type, startDate: entry.startDate, endDate: entry.endDate, affected,
        });
        const byId = {};
        drafts.forEach(d => { byId[d.apptId] = d; });
        const next = affectedAppts.map(a => ({
          appt: a,
          text: byId[a.id]?.smsDraft || `Hi ${(a.clientName || '').split(' ')[0]}, we need to reschedule your upcoming appointment — please reply and we'll find a new time.`,
          status: 'idle', error: '',
        }));
        if (alive) setItems(next);
      } catch (e) {
        if (alive) setError(e?.message || 'Could not draft messages.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [entry?.techName, entry?.startDate, entry?.endDate, entry?.type]);

  function patch(id, delta) {
    setItems(list => list.map(it => it.appt.id === id ? { ...it, ...delta } : it));
  }

  async function sendOne(it) {
    if (it.status === 'sending' || it.status === 'sent') return;
    if (!it.text.trim()) { patch(it.appt.id, { error: 'Message is empty.' }); return; }
    patch(it.appt.id, { status: 'sending', error: '' });
    try {
      await sendSmsToClient(it.appt.clientId, it.text.trim());
      patch(it.appt.id, { status: 'sent' });
    } catch (e) {
      patch(it.appt.id, { status: 'idle', error: e?.message || 'Send failed.' });
    }
  }

  async function sendAll() {
    for (const it of items) {
      if (it.status !== 'sent') await sendOne(it); // sequential — gentle on the SMS quota
    }
  }

  const pending = items.filter(it => it.status !== 'sent').length;

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Notify affected clients</Text>
                <Text style={styles.sub}>{entry?.techName} · {fmtDate(entry?.startDate)}{entry?.endDate !== entry?.startDate ? ` – ${fmtDate(entry?.endDate)}` : ''}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></TouchableOpacity>
            </View>

            {loading ? (
              <View style={styles.center}><ActivityIndicator color={theme.green} /><Text style={styles.dim}>Finding affected appointments…</Text></View>
            ) : error ? (
              <View style={styles.center}><Text style={styles.errText}>{error}</Text></View>
            ) : items.length === 0 ? (
              <View style={styles.center}><Text style={styles.dim}>No upcoming appointments with a textable client in this time off. Nothing to send. 🎉</Text></View>
            ) : (
              <>
                <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
                  {items.map(it => (
                    <View key={it.appt.id} style={styles.card}>
                      <Text style={styles.cardName}>{it.appt.clientName || 'Client'} · {fmtDate(it.appt.date)} {fmtTime(it.appt.startTime)}</Text>
                      <TextInput
                        style={styles.draft}
                        value={it.text}
                        onChangeText={t => patch(it.appt.id, { text: t, error: '' })}
                        multiline
                        editable={it.status !== 'sent' && it.status !== 'sending'}
                        placeholderTextColor={theme.placeholder}
                      />
                      {!!it.error && <Text style={styles.errText}>{it.error}</Text>}
                      {it.status === 'sent' ? (
                        <Text style={styles.sent}>✓ Sent to {it.appt.clientName?.split(' ')[0] || 'client'}</Text>
                      ) : (
                        <TouchableOpacity style={[styles.sendBtn, it.status === 'sending' && { opacity: 0.5 }]} disabled={it.status === 'sending'} onPress={() => sendOne(it)}>
                          <Text style={styles.sendBtnText}>{it.status === 'sending' ? 'Sending…' : 'Send text'}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </ScrollView>
                <TouchableOpacity style={[styles.sendAll, pending === 0 && { opacity: 0.5 }]} disabled={pending === 0} onPress={sendAll}>
                  <Text style={styles.sendAllText}>{pending === 0 ? 'All sent ✓' : `Send all ${pending}`}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: t.overlay, justifyContent: 'flex-end' },
  sheet:    { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 28 },
  header:   { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  title:    { fontSize: 18, fontWeight: '800', color: t.text },
  sub:      { fontSize: 13, color: t.textMuted, marginTop: 2 },
  close:    { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceMuted },
  closeText:{ fontSize: 22, color: t.textMuted, lineHeight: 24 },
  center:   { alignItems: 'center', justifyContent: 'center', paddingVertical: 36, gap: 10 },
  dim:      { fontSize: 14, color: t.textMuted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 10 },
  card:     { backgroundColor: t.surfaceAlt, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.border },
  cardName: { fontSize: 13, fontWeight: '700', color: t.text, marginBottom: 6 },
  draft:    { backgroundColor: t.surface, borderRadius: 10, padding: 10, fontSize: 14, color: t.text, borderWidth: 1, borderColor: t.border, minHeight: 76, textAlignVertical: 'top' },
  sendBtn:  { marginTop: 8, backgroundColor: t.greenSoft, borderWidth: 1, borderColor: t.green, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  sendBtnText: { color: t.green, fontWeight: '800', fontSize: 13 },
  sent:     { marginTop: 8, color: t.green, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  errText:  { color: t.danger, fontSize: 12.5, marginTop: 6 },
  sendAll:  { marginTop: 14, backgroundColor: t.green, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  sendAllText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
