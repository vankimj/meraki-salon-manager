import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, TextInput, ScrollView, Alert, RefreshControl,
} from 'react-native';
import { subscribeAppointments, setAppointmentStatus, checkInAppointment, setAppointmentNotes } from '../lib/firestore';
import useCurrentEmployee from '../hooks/useCurrentEmployee';
import Icon from '../components/Icon';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const STATUS_META = {
  scheduled: { label: 'Scheduled', color: '#3D95CE', bg: '#EBF4FB' },
  done:      { label: 'Done',      color: '#16a34a', bg: '#f0fdf4' },
  cancelled: { label: 'Cancelled', color: '#ef4444', bg: '#fef2f2' },
  no_show:   { label: 'No-show',   color: '#92400e', bg: '#fef3c7' },
};

export default function ScheduleScreen() {
  const { techName, loading: empLoading } = useCurrentEmployee();
  const [date,    setDate]    = useState(todayStr());
  const [appts,   setAppts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false); // admins / floor-view toggle
  const [detail,  setDetail]  = useState(null);  // selected appt for the modal

  // Live subscription so an iPad check-in (or another tech editing) shows
  // up here immediately. Re-subscribes when `date` changes.
  useEffect(() => {
    setLoading(true);
    const unsub = subscribeAppointments(date, (list) => {
      setAppts(list);
      setLoading(false);
    });
    return unsub;
  }, [date]);

  function shiftDate(days) {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  }

  const filtered = useMemo(() => {
    if (showAll || !techName) return appts;
    return appts.filter(a => (a.techName || '') === techName);
  }, [appts, showAll, techName]);

  const isToday = date === todayStr();
  const displayDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <View style={styles.container}>
      {/* Date nav row */}
      <View style={styles.dateRow}>
        <TouchableOpacity style={styles.navBtn} onPress={() => shiftDate(-1)}>
          <Text style={styles.navBtnText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.dateCenter}>
          <Text style={styles.dateText}>{displayDate}</Text>
          <Text style={styles.apptCount}>
            {filtered.length} appt{filtered.length !== 1 ? 's' : ''}
            {!showAll && techName ? ` · ${techName}` : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.navBtn} onPress={() => shiftDate(1)}>
          <Text style={styles.navBtnText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Today / All-techs toggle */}
      <View style={styles.toggleRow}>
        {!isToday && (
          <TouchableOpacity style={[styles.chip, styles.chipBlue]} onPress={() => setDate(todayStr())}>
            <Text style={styles.chipBlueText}>Today</Text>
          </TouchableOpacity>
        )}
        {techName && (
          <TouchableOpacity
            style={[styles.chip, showAll ? styles.chipBlue : styles.chipMuted]}
            onPress={() => setShowAll(v => !v)}
          >
            <Text style={showAll ? styles.chipBlueText : styles.chipMutedText}>
              {showAll ? '👥 All techs' : '👤 Just me'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {(empLoading || loading) ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#3D95CE" />
      ) : filtered.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="calendar" size={56} color="#cbd0d6" strokeWidth={1.5} />
          <Text style={[styles.emptyTitle, { marginTop: 14 }]}>Nothing on the books</Text>
          <Text style={styles.emptyBody}>
            {showAll ? 'No appointments this day.' : `No appointments for ${techName || 'you'} this day.`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={a => a.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                // Live subscription already keeps data fresh; pull-to-refresh
                // is mostly for tactile feedback.
                setRefreshing(true);
                setTimeout(() => setRefreshing(false), 600);
              }}
              tintColor="#3D95CE"
            />
          }
          renderItem={({ item: a }) => {
            const meta = STATUS_META[a.status] || STATUS_META.scheduled;
            return (
              <TouchableOpacity style={styles.apptCard} onPress={() => setDetail(a)} activeOpacity={0.7}>
                <View style={styles.apptTime}>
                  <Text style={styles.apptTimeText}>{fmtTime(a.startTime)}</Text>
                  {a.duration ? <Text style={styles.apptDuration}>{a.duration}m</Text> : null}
                </View>
                <View style={styles.apptInfo}>
                  <Text style={styles.clientName} numberOfLines={1}>
                    {a.clientName || 'Walk-in'}
                  </Text>
                  <Text style={styles.techService} numberOfLines={1}>
                    {showAll ? `${a.techName} · ` : ''}
                    {(a.services || []).map(s => s.name).filter(Boolean).join(', ')
                      || a.serviceName
                      || ''}
                  </Text>
                </View>
                <View style={styles.apptRight}>
                  {a.checkedInAt && <View style={styles.checkedInBadge}><Text style={styles.checkedInText}>✓</Text></View>}
                  <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <ApptDetailModal
        appt={detail}
        onClose={() => setDetail(null)}
        onUpdate={(patch) => {
          // Optimistic local update; live sub will reconcile.
          setAppts(prev => prev.map(a => a.id === detail.id ? { ...a, ...patch } : a));
          setDetail(prev => prev ? { ...prev, ...patch } : null);
        }}
      />
    </View>
  );
}

// ── Detail modal (status, check-in, notes) ─────────────
function ApptDetailModal({ appt, onClose, onUpdate }) {
  const [notes,   setNotes]   = useState('');
  const [working, setWorking] = useState(false);
  const [tab,     setTab]     = useState('actions');

  useEffect(() => {
    if (appt) {
      setNotes(appt.notes || '');
      setTab('actions');
    }
  }, [appt?.id]);

  if (!appt) return null;

  async function changeStatus(status) {
    if (working) return;
    setWorking(true);
    try {
      await setAppointmentStatus(appt.id, status);
      onUpdate({ status });
    } catch (e) {
      Alert.alert('Couldn\'t update status', e?.message || 'Please try again.');
    } finally {
      setWorking(false);
    }
  }

  async function doCheckIn() {
    if (working || appt.checkedInAt) return;
    setWorking(true);
    try {
      const stamp = new Date().toISOString();
      await checkInAppointment(appt.id);
      onUpdate({ checkedInAt: stamp });
    } catch (e) {
      Alert.alert('Couldn\'t check in', e?.message || 'Please try again.');
    } finally {
      setWorking(false);
    }
  }

  async function saveNotes() {
    if (working) return;
    setWorking(true);
    try {
      await setAppointmentNotes(appt.id, notes);
      onUpdate({ notes });
      Alert.alert('Notes saved');
    } catch (e) {
      Alert.alert('Couldn\'t save notes', e?.message || 'Please try again.');
    } finally {
      setWorking(false);
    }
  }

  const services = (appt.services || []).map(s => s.name).filter(Boolean).join(', ')
    || appt.serviceName || '';

  return (
    <Modal visible={!!appt} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {appt.clientName || 'Walk-in'}
              </Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {fmtTime(appt.startTime)}{appt.duration ? ` · ${appt.duration} min` : ''}
                {services ? ` · ${services}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabRow}>
            {[{ id: 'actions', label: 'Actions' }, { id: 'notes', label: 'Notes' }].map(t => (
              <TouchableOpacity
                key={t.id}
                onPress={() => setTab(t.id)}
                style={[styles.tabBtn, tab === t.id && styles.tabBtnActive]}
              >
                <Text style={[styles.tabBtnText, tab === t.id && styles.tabBtnTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            {tab === 'actions' && (
              <>
                {/* Check-in */}
                <Text style={styles.sectionLabel}>Client arrival</Text>
                {appt.checkedInAt ? (
                  <View style={styles.checkedInPill}>
                    <Text style={styles.checkedInPillText}>
                      ✓ Checked in at {fmtTime(appt.checkedInAt.slice(11, 16))}
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.primaryBtn, working && { opacity: 0.5 }]}
                    onPress={doCheckIn}
                    disabled={working}
                  >
                    <Text style={styles.primaryBtnText}>📍 Mark client checked-in</Text>
                  </TouchableOpacity>
                )}

                {/* Status */}
                <Text style={[styles.sectionLabel, { marginTop: 22 }]}>Appointment status</Text>
                <View style={styles.statusGrid}>
                  {Object.entries(STATUS_META).map(([id, meta]) => {
                    const active = appt.status === id;
                    return (
                      <TouchableOpacity
                        key={id}
                        style={[
                          styles.statusBtn,
                          active && { backgroundColor: meta.bg, borderColor: meta.color },
                        ]}
                        onPress={() => changeStatus(id)}
                        disabled={working || active}
                      >
                        <Text style={[
                          styles.statusBtnText,
                          active && { color: meta.color, fontWeight: '700' },
                        ]}>
                          {meta.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Contact info */}
                {(appt.clientPhone || appt.clientEmail) && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 22 }]}>Client contact</Text>
                    {appt.clientPhone ? <Text style={styles.contactLine}>📞 {appt.clientPhone}</Text> : null}
                    {appt.clientEmail ? <Text style={styles.contactLine}>✉️ {appt.clientEmail}</Text> : null}
                  </>
                )}
              </>
            )}

            {tab === 'notes' && (
              <>
                <Text style={styles.sectionLabel}>Appointment notes</Text>
                <TextInput
                  style={styles.notesInput}
                  multiline
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Anything the next stylist should know — preferred shape, allergies, last polish, vibe..."
                  placeholderTextColor="#bbb"
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, working && { opacity: 0.5 }, { marginTop: 10 }]}
                  onPress={saveNotes}
                  disabled={working}
                >
                  <Text style={styles.primaryBtnText}>Save notes</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  dateRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 12, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: '#ebebeb',
  },
  navBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  navBtnText: { fontSize: 28, color: '#3D95CE', lineHeight: 32 },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateText: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  apptCount: { fontSize: 11, color: '#888', marginTop: 2 },
  toggleRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ebebeb',
  },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  chipBlue: { backgroundColor: '#EBF4FB', borderColor: '#3D95CE' },
  chipBlueText: { color: '#1a5f8a', fontSize: 12, fontWeight: '600' },
  chipMuted: { backgroundColor: '#fff', borderColor: '#e0e0e0' },
  chipMutedText: { color: '#555', fontSize: 12, fontWeight: '500' },

  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  emptyBody: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 19 },

  apptCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  apptTime: { width: 56, alignItems: 'center' },
  apptTimeText: { fontSize: 12, fontWeight: '700', color: '#3D95CE' },
  apptDuration: { fontSize: 10, color: '#aaa', marginTop: 2 },
  apptInfo: { flex: 1, minWidth: 0 },
  clientName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  techService: { fontSize: 11, color: '#888', marginTop: 2 },
  apptRight: { alignItems: 'flex-end', gap: 4 },
  checkedInBadge: { backgroundColor: '#f0fdf4', borderRadius: 8, paddingVertical: 2, paddingHorizontal: 6 },
  checkedInText: { fontSize: 11, fontWeight: '700', color: '#16a34a' },
  statusPill: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  statusPillText: { fontSize: 10, fontWeight: '600' },

  // Modal
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.55)' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%', paddingBottom: 20 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  modalSubtitle: { fontSize: 12, color: '#888', marginTop: 2 },
  modalClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' },
  modalCloseText: { fontSize: 22, color: '#666', lineHeight: 24 },

  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#3D95CE' },
  tabBtnText: { fontSize: 13, color: '#888', fontWeight: '500' },
  tabBtnTextActive: { color: '#1a5f8a', fontWeight: '700' },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  primaryBtn: { backgroundColor: '#2D7A5F', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  checkedInPill: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  checkedInPillText: { color: '#16a34a', fontSize: 13, fontWeight: '600' },

  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusBtn: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#e0e0e0', backgroundColor: '#fff', flexGrow: 1, alignItems: 'center', minWidth: '47%',
  },
  statusBtnText: { fontSize: 13, color: '#666' },

  contactLine: { fontSize: 14, color: '#1a1a1a', marginBottom: 6 },
  notesInput: {
    minHeight: 140, padding: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#fafafa',
    fontSize: 14, color: '#1a1a1a',
  },
});
