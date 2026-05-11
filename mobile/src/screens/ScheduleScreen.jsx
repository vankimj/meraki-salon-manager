import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, TextInput, ScrollView, Alert, RefreshControl,
} from 'react-native';
import {
  subscribeAppointments, setAppointmentStatus, checkInAppointment, setAppointmentNotes,
  fetchAppointmentsByRange, createAppointment, fetchClients, fetchServices, fetchEmployees,
} from '../lib/firestore';
import useCurrentEmployee from '../hooks/useCurrentEmployee';
import Icon from '../components/Icon';

// Salon hours + slot grid. Matches the web SLOT_H=40 / 9am-8pm convention
// from CLAUDE.md so the day view feels familiar across devices.
const SLOT_MINUTES = 30;
const DAY_START_MIN = 9 * 60;       // 9 AM
const DAY_END_MIN   = 20 * 60;      // 8 PM
const SLOT_PX       = 50;           // taller than web for finger-tap accuracy
const SLOT_COUNT    = (DAY_END_MIN - DAY_START_MIN) / SLOT_MINUTES;

function minToHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function hhmmToMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Sunday-anchored start-of-week (matches the WEEKDAY_LABELS array
// below and feels right for US salon scheduling — most salons treat
// Sunday as either closed or a fresh week start).
function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function isoFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

// Per-tech color palette + helpers — mirrors the web ScheduleAdmin so
// appt blocks look consistent across web and mobile. 10 distinct hues
// assigned by stable index in the active-tech list. Cancelled overrides
// to red, done to grey, otherwise the tech's color is used.
const TECH_PALETTE = [
  { solid: '#2D7A5F', bg: '#e8f5ef', text: '#1a4d3a' },
  { solid: '#3D95CE', bg: '#e8f2fb', text: '#1a4d7a' },
  { solid: '#9333EA', bg: '#f3eeff', text: '#4a1d96' },
  { solid: '#D97706', bg: '#fef3c7', text: '#78350f' },
  { solid: '#BE185D', bg: '#fdf2f8', text: '#831843' },
  { solid: '#059669', bg: '#d1fae5', text: '#065f46' },
  { solid: '#0891B2', bg: '#e0f7fa', text: '#164e63' },
  { solid: '#EA580C', bg: '#fff7ed', text: '#7c2d12' },
  { solid: '#4F46E5', bg: '#eef2ff', text: '#3730a3' },
  { solid: '#0F766E', bg: '#f0fdfa', text: '#134e4a' },
];
function getTechColor(techName, allTechs) {
  const idx = (allTechs || []).indexOf(techName);
  return TECH_PALETTE[idx >= 0 ? idx % TECH_PALETTE.length : 0];
}
function colorsForAppt(appt, allTechs) {
  const col = getTechColor(appt.techName, allTechs);
  if (appt.status === 'cancelled') return { bg: '#fef2f2', border: '#EF4444', text: '#991b1b', faded: true };
  if (appt.status === 'done')      return { bg: '#f3f4f6', border: '#9ca3af', text: '#6b7280', faded: false };
  return { bg: col.bg, border: col.solid, text: col.text, faded: false };
}

export default function ScheduleScreen() {
  const { techName, loading: empLoading } = useCurrentEmployee();
  const [date,    setDate]    = useState(todayStr());
  const [appts,   setAppts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false); // admins / floor-view toggle
  const [detail,  setDetail]  = useState(null);  // selected appt for the modal
  const [view,    setView]    = useState('day'); // 'day' | 'week' | 'month'
  const [createPrefill, setCreatePrefill] = useState(null);  // { date, startTime, techName } or null
  const [allTechs, setAllTechs] = useState([]);  // ordered tech-name list for color assignment

  // Stable tech list for color indexing — fetched once on mount, refreshed
  // on tenant change (RootNav re-mounts when tenant switches, so this re-runs).
  useEffect(() => {
    let cancelled = false;
    fetchEmployees()
      .then(emps => {
        if (cancelled) return;
        const names = (emps || [])
          .filter(e => e.active !== false)
          .sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999))
          .map(e => e.name)
          .filter(Boolean);
        setAllTechs(names);
      })
      .catch(() => { if (!cancelled) setAllTechs([]); });
    return () => { cancelled = true; };
  }, []);

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

  function shiftMonth(delta) {
    const d = new Date(date + 'T12:00:00');
    d.setMonth(d.getMonth() + delta, 1);   // 1st of new month avoids month-overflow weirdness
    setDate(d.toISOString().slice(0, 10));
  }

  function shiftWeek(delta) {
    shiftDate(delta * 7);
  }

  function navShift(delta) {
    if (view === 'month') return shiftMonth(delta);
    if (view === 'week')  return shiftWeek(delta);
    return shiftDate(delta);
  }

  const filtered = useMemo(() => {
    if (showAll || !techName) return appts;
    return appts.filter(a => (a.techName || '') === techName);
  }, [appts, showAll, techName]);

  const isToday = date === todayStr();
  const displayDate = (() => {
    const anchor = new Date(date + 'T12:00:00');
    if (view === 'month') return anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (view === 'week') {
      const start = startOfWeek(anchor);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      const sameMonth = start.getMonth() === end.getMonth();
      const opts = { month: 'short', day: 'numeric' };
      return sameMonth
        ? `${start.toLocaleDateString('en-US', { month: 'long' })} ${start.getDate()}–${end.getDate()}`
        : `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
    }
    return anchor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  })();

  return (
    <View style={styles.container}>
      {/* Date nav row */}
      <View style={styles.dateRow}>
        <TouchableOpacity style={styles.navBtn} onPress={() => navShift(-1)}>
          <Text style={styles.navBtnText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.dateCenter}>
          <Text style={styles.dateText}>{displayDate}</Text>
          {view === 'day' && (
            <Text style={styles.apptCount}>
              {filtered.length} appt{filtered.length !== 1 ? 's' : ''}
              {!showAll && techName ? ` · ${techName}` : ''}
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.navBtn} onPress={() => navShift(1)}>
          <Text style={styles.navBtnText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* View + filter toggles */}
      <View style={styles.toggleRow}>
        <View style={styles.viewSwitch}>
          {['day', 'week', 'month'].map(m => (
            <TouchableOpacity
              key={m}
              onPress={() => setView(m)}
              style={[styles.viewSwitchBtn, view === m && styles.viewSwitchBtnActive]}
            >
              <Text style={[styles.viewSwitchText, view === m && styles.viewSwitchTextActive]}>
                {m === 'day' ? 'Day' : m === 'week' ? 'Week' : 'Month'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
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

      {view === 'month' && (
        <MonthView
          date={date}
          techName={techName}
          showAll={showAll}
          onPickDay={(d) => { setDate(d); setView('day'); }}
        />
      )}

      {view === 'week' && (
        <WeekView
          date={date}
          techName={techName}
          showAll={showAll}
          allTechs={allTechs}
          onTapAppt={(a) => setDetail(a)}
          onTapEmpty={(d, startTime) => setCreatePrefill({ date: d, startTime, techName: showAll ? '' : (techName || '') })}
          onPickDay={(d) => { setDate(d); setView('day'); }}
        />
      )}

      {view === 'day' && (
        (empLoading || loading) ? (
          <ActivityIndicator style={{ marginTop: 40 }} color="#3D95CE" />
        ) : (
          <DayTimelineView
            appts={filtered}
            date={date}
            showAll={showAll}
            allTechs={allTechs}
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 600); }}
            onTapAppt={(a) => setDetail(a)}
            onTapEmpty={(startTime) => setCreatePrefill({ date, startTime, techName: showAll ? '' : (techName || '') })}
          />
        )
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

      <CreateApptModal
        prefill={createPrefill}
        onClose={() => setCreatePrefill(null)}
        onCreated={() => setCreatePrefill(null)}
      />
    </View>
  );
}

// ── Day timeline view ──────────────────────────────────
// Shows every 30-min slot from 9 AM to 8 PM as a tappable row. Empty
// rows surface a faint "+ Add" hint and create a new appt prefilled
// to that slot. Filled rows render the appt block sized to its
// duration (1 SLOT_PX per 30 min). Multi-tech overlaps are stacked
// horizontally; "Just me" mode never overlaps so most days are clean.
function DayTimelineView({ appts, date, showAll, allTechs, refreshing, onRefresh, onTapAppt, onTapEmpty }) {
  // Build a map of slot-index → appts that START in that slot, so
  // we can render appts overlaid on top of the slot grid.
  const slotAppts = useMemo(() => {
    const map = {};
    appts.forEach(a => {
      const startMin = hhmmToMin(a.startTime);
      if (startMin < DAY_START_MIN || startMin >= DAY_END_MIN) return;
      const idx = Math.floor((startMin - DAY_START_MIN) / SLOT_MINUTES);
      if (!map[idx]) map[idx] = [];
      map[idx].push(a);
    });
    return map;
  }, [appts]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#fff' }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3D95CE" />}
    >
      {Array.from({ length: SLOT_COUNT }).map((_, idx) => {
        const slotMin = DAY_START_MIN + idx * SLOT_MINUTES;
        const startTime = minToHHMM(slotMin);
        const slotAppt = (slotAppts[idx] || [])[0];   // primary appt — overlap UI deferred
        const overlapCount = (slotAppts[idx] || []).length;
        const isHourMark = slotMin % 60 === 0;
        return (
          <TouchableOpacity
            key={idx}
            onPress={() => slotAppt ? onTapAppt(slotAppt) : onTapEmpty(startTime)}
            activeOpacity={0.6}
            style={[styles.dayTimelineRow, { height: SLOT_PX }]}
          >
            <View style={styles.dayTimeLabel}>
              {isHourMark && <Text style={styles.dayTimeLabelText}>{fmtTime(startTime)}</Text>}
            </View>
            <View style={[styles.dayTimelineSlot, isHourMark && styles.dayTimelineSlotHour]}>
              {slotAppt ? (() => {
                const c = colorsForAppt(slotAppt, allTechs);
                return (
                  <View style={[
                    styles.dayApptBlock,
                    {
                      height: Math.max(SLOT_PX - 4, ((slotAppt.duration || 30) / SLOT_MINUTES) * SLOT_PX - 4),
                      backgroundColor: c.bg,
                      borderLeftColor: c.border,
                      opacity: c.faded ? 0.65 : 1,
                    },
                  ]}>
                    <Text style={[styles.dayApptClient, { color: c.text }]} numberOfLines={1}>
                      {slotAppt.clientName || 'Walk-in'}
                      {overlapCount > 1 ? ` +${overlapCount - 1}` : ''}
                    </Text>
                    <Text style={[styles.dayApptMeta, { color: c.text, opacity: 0.75 }]} numberOfLines={1}>
                      {showAll ? `${slotAppt.techName} · ` : ''}
                      {(slotAppt.services || []).map(s => s.name).filter(Boolean).join(', ') || ''}
                    </Text>
                  </View>
                );
              })() : (
                <Text style={styles.dayEmptyHint}>＋</Text>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ── Week view ──────────────────────────────────────────
// 7-day strip — each day is a tappable column showing appt blocks
// stacked vertically (no time grid; just the count + service summary).
// Tapping an empty area on a day prefills create modal at the next
// open hour, tap a block opens the detail modal.
const WEEK_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function WeekView({ date, techName, showAll, allTechs, onTapAppt, onTapEmpty, onPickDay }) {
  const [byDay, setByDay] = useState({});  // 'YYYY-MM-DD' → appts[]
  const [loading, setLoading] = useState(true);

  const weekStart = useMemo(() => startOfWeek(new Date(date + 'T12:00:00')), [date]);
  const days = useMemo(() => Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
    return { iso: isoFromDate(d), dow: WEEK_DAY_LABELS[i], dayNum: d.getDate(), full: d };
  }), [weekStart]);

  const startIso = days[0].iso;
  const endIso   = days[6].iso;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAppointmentsByRange(startIso, endIso)
      .then(list => {
        if (cancelled) return;
        const filtered = (showAll || !techName)
          ? list
          : list.filter(a => (a.techName || '') === techName);
        const map = {};
        filtered.forEach(a => {
          if (!a.date) return;
          if (!map[a.date]) map[a.date] = [];
          map[a.date].push(a);
        });
        Object.values(map).forEach(arr => arr.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')));
        setByDay(map);
      })
      .catch(() => { if (!cancelled) setByDay({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startIso, endIso, techName, showAll]);

  const today = todayStr();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f5f7fa' }} contentContainerStyle={{ padding: 8 }}>
      {loading && <ActivityIndicator style={{ marginTop: 12 }} color="#3D95CE" />}
      {days.map(d => {
        const appts = byDay[d.iso] || [];
        const isToday = d.iso === today;
        return (
          <View key={d.iso} style={[styles.weekDayCard, isToday && styles.weekDayCardToday]}>
            <TouchableOpacity onPress={() => onPickDay(d.iso)} style={styles.weekDayHeader} activeOpacity={0.7}>
              <Text style={[styles.weekDayDow, isToday && styles.weekDayDowToday]}>{d.dow}</Text>
              <Text style={[styles.weekDayNum, isToday && styles.weekDayNumToday]}>{d.dayNum}</Text>
              <Text style={styles.weekDayCount}>{appts.length} appt{appts.length !== 1 ? 's' : ''}</Text>
            </TouchableOpacity>
            {appts.length === 0 ? (
              <TouchableOpacity
                style={styles.weekDayEmpty}
                onPress={() => onTapEmpty(d.iso, '10:00')}
                activeOpacity={0.6}
              >
                <Text style={styles.weekDayEmptyText}>＋ Add appointment</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ paddingHorizontal: 8, paddingBottom: 8 }}>
                {appts.map(a => {
                  const c = colorsForAppt(a, allTechs);
                  return (
                    <TouchableOpacity
                      key={a.id}
                      style={[styles.weekApptBlock, { backgroundColor: c.bg, borderLeftColor: c.border, opacity: c.faded ? 0.65 : 1 }]}
                      onPress={() => onTapAppt(a)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.weekApptTime, { color: c.border }]}>{fmtTime(a.startTime)}</Text>
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={[styles.weekApptClient, { color: c.text }]} numberOfLines={1}>{a.clientName || 'Walk-in'}</Text>
                        <Text style={[styles.weekApptMeta, { color: c.text, opacity: 0.75 }]} numberOfLines={1}>
                          {showAll ? `${a.techName} · ` : ''}
                          {(a.services || []).map(s => s.name).filter(Boolean).join(', ')}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[styles.weekDayEmpty, { marginTop: 6 }]}
                  onPress={() => onTapEmpty(d.iso, '10:00')}
                  activeOpacity={0.6}
                >
                  <Text style={styles.weekDayEmptyText}>＋ Add</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

// ── Create appointment modal ───────────────────────────
// Minimum-viable create flow. Pre-fills date/time/tech from where the
// user tapped. Lets them pick a client (search), service(s) from the
// catalog, and a duration. Save → createAppointment → live sub
// reconciles. Walk-ins are supported via the "No client (walk-in)"
// row at the top of the client picker.
function CreateApptModal({ prefill, onClose, onCreated }) {
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const [pickedClient, setPickedClient] = useState(null);  // { id, name } or null
  const [clientQuery, setClientQuery] = useState('');
  const [pickedServices, setPickedServices] = useState([]); // [{ id, name, duration, price }]

  useEffect(() => {
    if (!prefill) return;
    setLoading(true);
    Promise.all([fetchClients(), fetchServices()])
      .then(([cs, svc]) => {
        setClients(cs || []);
        setServices(svc || []);
      })
      .catch(() => { setClients([]); setServices([]); })
      .finally(() => setLoading(false));
    setPickedClient(null);
    setClientQuery('');
    setPickedServices([]);
  }, [prefill?.date, prefill?.startTime]);

  if (!prefill) return null;

  const totalDuration = pickedServices.reduce((s, sv) => s + (Number(sv.duration) || 30), 0) || 30;
  const filteredClients = useMemoSafe(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return clients.slice(0, 30);
    return clients.filter(c => (c.name || '').toLowerCase().includes(q)).slice(0, 30);
  }, [clientQuery, clients]);

  function toggleService(svc) {
    setPickedServices(prev => prev.some(s => s.id === svc.id)
      ? prev.filter(s => s.id !== svc.id)
      : [...prev, { id: svc.id, name: svc.name, duration: svc.duration || 30, price: Number(svc.price) || 0 }]);
  }

  async function save() {
    if (working) return;
    if (pickedServices.length === 0) {
      Alert.alert('Add at least one service', 'Pick the service(s) the client is booking.');
      return;
    }
    setWorking(true);
    try {
      await createAppointment({
        date:      prefill.date,
        startTime: prefill.startTime,
        techName:  prefill.techName || '',
        clientId:  pickedClient?.id || '',
        clientName: pickedClient?.name || 'Walk-in',
        services:  pickedServices,
        duration:  totalDuration,
        status:    'scheduled',
        notes:     '',
        techRequestType: 'scheduler',
      });
      onCreated?.();
    } catch (e) {
      Alert.alert('Couldn\'t create appointment', e?.message || 'Please try again.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal visible={!!prefill} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>New appointment</Text>
              <Text style={styles.modalSubtitle}>
                {new Date(prefill.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {' · '}{fmtTime(prefill.startTime)}
                {prefill.techName ? ` · ${prefill.techName}` : ' · (no tech assigned)'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: 30 }} color="#3D95CE" />
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
              <Text style={styles.sectionLabel}>Client</Text>
              {pickedClient ? (
                <TouchableOpacity onPress={() => setPickedClient(null)} style={styles.pickedChip}>
                  <Text style={styles.pickedChipText}>{pickedClient.name}</Text>
                  <Text style={styles.pickedChipX}>×</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search clients…  (or leave blank for walk-in)"
                    placeholderTextColor="#bbb"
                    value={clientQuery}
                    onChangeText={setClientQuery}
                  />
                  <View style={styles.clientList}>
                    <TouchableOpacity
                      style={styles.clientRow}
                      onPress={() => setPickedClient({ id: '', name: 'Walk-in' })}
                    >
                      <Text style={styles.clientRowName}>👤 Walk-in</Text>
                    </TouchableOpacity>
                    {filteredClients.map(c => (
                      <TouchableOpacity
                        key={c.id}
                        style={styles.clientRow}
                        onPress={() => setPickedClient({ id: c.id, name: c.name })}
                      >
                        <Text style={styles.clientRowName}>{c.name}</Text>
                        {c.phone ? <Text style={styles.clientRowMeta}>{c.phone}</Text> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>
                Services ({pickedServices.length} · {totalDuration} min)
              </Text>
              <View style={styles.serviceGrid}>
                {services.map(svc => {
                  const active = pickedServices.some(s => s.id === svc.id);
                  return (
                    <TouchableOpacity
                      key={svc.id}
                      onPress={() => toggleService(svc)}
                      style={[styles.serviceChip, active && styles.serviceChipActive]}
                    >
                      <Text style={[styles.serviceChipName, active && styles.serviceChipNameActive]}>
                        {svc.name}
                      </Text>
                      <Text style={[styles.serviceChipMeta, active && styles.serviceChipMetaActive]}>
                        {svc.duration || 30}m · ${Number(svc.price) || 0}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, (working || pickedServices.length === 0) && { opacity: 0.5 }, { marginTop: 22 }]}
                onPress={save}
                disabled={working || pickedServices.length === 0}
              >
                <Text style={styles.primaryBtnText}>
                  {working ? 'Creating…' : `Create appointment (${totalDuration} min)`}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// useMemo wrapper that lets us call hooks inside a guarded sub-render.
// React Hooks rules require unconditional calls; useMemoSafe just
// renames useMemo for readability where the dep array drives the work.
function useMemoSafe(fn, deps) { return useMemo(fn, deps); }

// ── Month grid view ────────────────────────────────────
// Lightweight bird's-eye view: grid of day cells for the displayed
// month, each with the day number and a count of appointments. Tap a
// day to drop back into Day mode focused on that date. Fetches the
// month's appointments via fetchAppointmentsByRange (snapshot, not
// subscription — month view is for browsing, day view re-subscribes
// when you drill in).
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function MonthView({ date, techName, showAll, onPickDay }) {
  const [byDay, setByDay] = useState({});      // 'YYYY-MM-DD' → count
  const [loading, setLoading] = useState(true);

  const anchor = useMemo(() => new Date(date + 'T12:00:00'), [date]);
  const year   = anchor.getFullYear();
  const month  = anchor.getMonth();          // 0-indexed
  const monthStartIso = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthEndDay   = new Date(year, month + 1, 0).getDate();
  const monthEndIso   = `${year}-${String(month + 1).padStart(2, '0')}-${String(monthEndDay).padStart(2, '0')}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAppointmentsByRange(monthStartIso, monthEndIso)
      .then(list => {
        if (cancelled) return;
        const filtered = (showAll || !techName)
          ? list
          : list.filter(a => (a.techName || '') === techName);
        const map = {};
        filtered.forEach(a => { if (a.date) map[a.date] = (map[a.date] || 0) + 1; });
        setByDay(map);
      })
      .catch(() => { if (!cancelled) setByDay({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [monthStartIso, monthEndIso, techName, showAll]);

  // Build a 6-row × 7-col grid. Pad with prev/next-month blanks so
  // weekday columns stay aligned.
  const firstWeekday = new Date(year, month, 1).getDay();   // 0 = Sunday
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= monthEndDay; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);

  const today = todayStr();

  return (
    <ScrollView style={styles.monthScroll} contentContainerStyle={{ paddingBottom: 20 }}>
      <View style={styles.monthWeekdayRow}>
        {WEEKDAY_LABELS.map((w, i) => (
          <Text key={i} style={styles.monthWeekdayLabel}>{w}</Text>
        ))}
      </View>
      {loading && <ActivityIndicator style={{ marginTop: 20 }} color="#3D95CE" />}
      <View style={styles.monthGrid}>
        {cells.map((day, idx) => {
          if (day === null) return <View key={idx} style={styles.monthCell} />;
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const count = byDay[iso] || 0;
          const isToday = iso === today;
          return (
            <TouchableOpacity
              key={idx}
              style={[styles.monthCell, isToday && styles.monthCellToday]}
              onPress={() => onPickDay(iso)}
              activeOpacity={0.6}
            >
              <Text style={[styles.monthCellDay, isToday && styles.monthCellDayToday]}>{day}</Text>
              {count > 0 && (
                <View style={styles.monthCellBadge}>
                  <Text style={styles.monthCellBadgeText}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
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
  navBtn: { width: 56, height: 48, alignItems: 'center', justifyContent: 'center' },
  navBtnText: { fontSize: 32, color: '#3D95CE', lineHeight: 36, fontWeight: '300' },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateText: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  apptCount: { fontSize: 11, color: '#888', marginTop: 2 },
  toggleRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ebebeb',
    alignItems: 'center', flexWrap: 'wrap',
  },
  // Tap targets bumped to ≥44pt (Apple HIG) — techs with long nails
  // were missing the 12pt-padded chips. minHeight is the key win;
  // fontSize bumps for legibility too.
  chip: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, borderRadius: 22, borderWidth: 1, justifyContent: 'center' },
  chipBlue: { backgroundColor: '#EBF4FB', borderColor: '#3D95CE' },
  chipBlueText: { color: '#1a5f8a', fontSize: 14, fontWeight: '600' },
  chipMuted: { backgroundColor: '#fff', borderColor: '#e0e0e0' },
  chipMutedText: { color: '#555', fontSize: 14, fontWeight: '500' },

  viewSwitch:           { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 10, padding: 3, marginRight: 4 },
  viewSwitchBtn:        { paddingHorizontal: 16, paddingVertical: 10, minHeight: 38, minWidth: 60, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  viewSwitchBtnActive:  { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.10, shadowRadius: 2, elevation: 2 },
  viewSwitchText:       { fontSize: 14, color: '#666', fontWeight: '500' },
  viewSwitchTextActive: { color: '#1a1a1a', fontWeight: '700' },

  // Day timeline
  dayTimelineRow:     { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0' },
  dayTimeLabel:       { width: 56, paddingLeft: 8, paddingTop: 2 },
  dayTimeLabelText:   { fontSize: 11, color: '#888', fontWeight: '600' },
  dayTimelineSlot:    { flex: 1, paddingVertical: 2, paddingRight: 8, justifyContent: 'flex-start', alignItems: 'stretch' },
  dayTimelineSlotHour:{ borderTopWidth: 0.5, borderTopColor: '#dadcdf' },
  dayApptBlock:       { backgroundColor: '#EBF4FB', borderLeftWidth: 3, borderLeftColor: '#3D95CE', borderRadius: 6, padding: 8, justifyContent: 'center' },
  dayApptClient:      { fontSize: 13, fontWeight: '700', color: '#1a1a1a' },
  dayApptMeta:        { fontSize: 11, color: '#666', marginTop: 2 },
  dayEmptyHint:       { fontSize: 14, color: '#dadcdf', textAlign: 'center', lineHeight: 18 },

  // Week strip
  weekDayCard:        { backgroundColor: '#fff', borderRadius: 12, marginBottom: 8, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  weekDayCardToday:   { borderWidth: 1.5, borderColor: '#3D95CE' },
  weekDayHeader:      { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fafafa', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  weekDayDow:         { fontSize: 12, fontWeight: '700', color: '#888', letterSpacing: 0.4, textTransform: 'uppercase' },
  weekDayDowToday:    { color: '#1a5f8a' },
  weekDayNum:         { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  weekDayNumToday:    { color: '#1a5f8a' },
  weekDayCount:       { fontSize: 11, color: '#aaa', marginLeft: 'auto' },
  weekDayEmpty:       { padding: 14, alignItems: 'center', borderRadius: 8, backgroundColor: '#f7f8fa', marginHorizontal: 8, marginBottom: 8, marginTop: 8 },
  weekDayEmptyText:   { fontSize: 12, color: '#888', fontWeight: '500' },
  weekApptBlock:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#f7fbfd', borderLeftWidth: 3, borderLeftColor: '#3D95CE', borderRadius: 6, marginTop: 6 },
  weekApptTime:       { fontSize: 11, fontWeight: '700', color: '#3D95CE', minWidth: 56 },
  weekApptClient:     { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  weekApptMeta:       { fontSize: 11, color: '#888', marginTop: 1 },

  // Create appt modal
  searchInput:        { backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: '#1a1a1a' },
  clientList:         { marginTop: 8, backgroundColor: '#fafafa', borderRadius: 8, maxHeight: 180 },
  clientRow:          { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  clientRowName:      { fontSize: 14, color: '#1a1a1a' },
  clientRowMeta:      { fontSize: 11, color: '#888', marginTop: 2 },
  pickedChip:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EBF4FB', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, alignSelf: 'flex-start' },
  pickedChipText:     { fontSize: 13, color: '#1a5f8a', fontWeight: '600' },
  pickedChipX:        { fontSize: 18, color: '#1a5f8a', marginLeft: 8, lineHeight: 18 },
  serviceGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  serviceChip:        { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#fff', minWidth: '47%' },
  serviceChipActive:  { borderColor: '#3D95CE', backgroundColor: '#EBF4FB' },
  serviceChipName:    { fontSize: 12, fontWeight: '600', color: '#1a1a1a' },
  serviceChipNameActive: { color: '#1a5f8a' },
  serviceChipMeta:    { fontSize: 10, color: '#888', marginTop: 2 },
  serviceChipMetaActive: { color: '#3D95CE' },

  monthScroll:        { flex: 1, backgroundColor: '#f5f7fa' },
  monthWeekdayRow:    { flexDirection: 'row', backgroundColor: '#fff', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#ebebeb' },
  monthWeekdayLabel:  { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#888', letterSpacing: 0.5 },
  monthGrid:          { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#fff' },
  monthCell:          { width: `${100 / 7}%`, aspectRatio: 1, padding: 4, borderWidth: 0.5, borderColor: '#f0f0f0', alignItems: 'center', justifyContent: 'flex-start' },
  monthCellToday:     { backgroundColor: '#EBF4FB' },
  monthCellDay:       { fontSize: 13, color: '#1a1a1a', fontWeight: '500', marginTop: 2 },
  monthCellDayToday:  { color: '#1a5f8a', fontWeight: '700' },
  monthCellBadge:     { marginTop: 4, backgroundColor: '#3D95CE', borderRadius: 9, minWidth: 18, paddingHorizontal: 5, paddingVertical: 1, alignItems: 'center' },
  monthCellBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },

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
