import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, TextInput, ScrollView, Alert, RefreshControl, Image, Linking,
} from 'react-native';
import {
  subscribeAppointments, setAppointmentStatus, checkInAppointment, setAppointmentNotes,
  fetchAppointmentsByRange, createAppointment, fetchClients, fetchServices, fetchEmployees,
  fetchTimeOff, createClient, updateAppointment, fetchClient,
} from '../lib/firestore';
import { addApptToTab, removeApptFromTab, getCurrentTab, tabCount, tabTotal, subscribeTab, clearTab } from '../lib/currentTab';
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

// International phone helpers via libphonenumber-js (Google's standard
// metadata). US-style numbers without a country code are auto-treated
// as US (the salon's home country); international numbers must include
// a leading "+" and country code. The "as you type" formatter feeds
// libphonenumber's AsYouType class for live formatting per-country.
//
// On save we store the canonical E.164 form ("+16145550123") because
// it's what Twilio + most platforms expect for SMS routing.
import { AsYouType, parsePhoneNumberFromString, isValidPhoneNumber } from 'libphonenumber-js';

const DEFAULT_COUNTRY = 'US';

function formatPhoneInput(raw) {
  const text = String(raw || '');
  // AsYouType keeps the leading + when present, otherwise assumes the
  // default country and formats nationally — e.g. "(614) 555-0123"
  // for US, "020 7946 0958" for UK with country code.
  const formatter = new AsYouType(text.startsWith('+') ? undefined : DEFAULT_COUNTRY);
  return formatter.input(text);
}
function isValidPhone(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  return text.startsWith('+')
    ? isValidPhoneNumber(text)
    : isValidPhoneNumber(text, DEFAULT_COUNTRY);
}
// Normalize to E.164 ("+1614...") for storage. Returns null if invalid.
function toE164(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const parsed = text.startsWith('+')
    ? parsePhoneNumberFromString(text)
    : parsePhoneNumberFromString(text, DEFAULT_COUNTRY);
  return parsed?.isValid() ? parsed.format('E.164') : null;
}

// Working-hour window for a given date based on the tech's workDays
// config. Falls back to the salon-wide DAY_START/END if the tech
// hasn't set hours for that weekday. Returns null if the tech is
// off that day, or { startMin, endMin } if they're working.
const DOW_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function workWindowFor(iso, workDays) {
  const dow = DOW_KEYS[new Date(iso + 'T12:00:00').getDay()];
  const cfg = workDays?.[dow];
  if (!cfg) return { startMin: DAY_START_MIN, endMin: DAY_END_MIN };  // no config = full day available
  if (cfg.on === false) return null;                                  // explicitly off
  return {
    startMin: cfg.start ? hhmmToMin(cfg.start) : DAY_START_MIN,
    endMin:   cfg.end   ? hhmmToMin(cfg.end)   : DAY_END_MIN,
  };
}

// Returns the active time-off entry covering this date for this tech,
// or null if none. Compares ISO date strings inclusive on both ends.
function timeOffOn(iso, techName, timeOff) {
  if (!techName || !timeOff?.length) return null;
  const t = techName.toLowerCase();
  return timeOff.find(o =>
    (o.techName || '').toLowerCase() === t &&
    (o.startDate || '') <= iso &&
    iso <= (o.endDate || o.startDate || '')
  ) || null;
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
  const { employee, techName, loading: empLoading } = useCurrentEmployee();
  const [date,    setDate]    = useState(todayStr());
  const [appts,   setAppts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false); // admins / floor-view toggle
  const [detail,  setDetail]  = useState(null);  // selected appt for the modal
  const [view,    setView]    = useState('day'); // 'day' | 'week' | 'month'
  const [createPrefill, setCreatePrefill] = useState(null);  // { date, startTime, techName } or null
  const [editAppt, setEditAppt] = useState(null);            // existing appt being edited or null
  const [tabOpen,  setTabOpen]  = useState(false);
  const [tabSnap,  setTabSnap]  = useState(getCurrentTab()); // re-rendered on tab change

  useEffect(() => subscribeTab(setTabSnap), []);
  const [allTechs, setAllTechs] = useState([]);  // ordered tech-name list for color assignment
  const [timeOff,  setTimeOff]  = useState([]);  // [{ techName, startDate, endDate }]

  // Stable tech list + time-off snapshot — fetched on mount, refreshed
  // on tenant change (RootNav re-mounts when tenant switches, so this re-runs).
  // Time off feeds the week-view gap calculator: a day covered by an
  // active time-off entry for the current tech is shown as OFF instead
  // of computed gaps.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchEmployees(), fetchTimeOff()])
      .then(([emps, off]) => {
        if (cancelled) return;
        const names = (emps || [])
          .filter(e => e.active !== false)
          .sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999))
          .map(e => e.name)
          .filter(Boolean);
        setAllTechs(names);
        setTimeOff(off || []);
      })
      .catch(() => { if (!cancelled) { setAllTechs([]); setTimeOff([]); } });
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

      {/* Tab / cart pill — only when something's been staged */}
      {tabSnap.appts.length + tabSnap.products.length > 0 && (
        <TouchableOpacity style={styles.cartPill} onPress={() => setTabOpen(true)} activeOpacity={0.8}>
          <Text style={styles.cartPillText}>
            🛒 Tab · {tabSnap.appts.length} appt{tabSnap.appts.length !== 1 ? 's' : ''}
            {' · $'}{tabTotal().toFixed(2)}
          </Text>
        </TouchableOpacity>
      )}

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
          workDays={employee?.workDays}
          timeOff={timeOff}
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
            workDays={employee?.workDays}
            timeOff={timeOff}
            techName={techName}
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 600); }}
            onTapAppt={(a) => setDetail(a)}
            onTapEmpty={(startTime) => setCreatePrefill({ date, startTime, techName: showAll ? '' : (techName || '') })}
          />
        )
      )}

      <ApptDetailModal
        appt={detail}
        cartTab={tabSnap}
        onClose={() => setDetail(null)}
        onEdit={(a) => { setDetail(null); setEditAppt(a); }}
        onAddToTab={(a) => addApptToTab(a)}
        onUpdate={(patch) => {
          // Optimistic local update; live sub will reconcile.
          setAppts(prev => prev.map(a => a.id === detail.id ? { ...a, ...patch } : a));
          setDetail(prev => prev ? { ...prev, ...patch } : null);
        }}
      />

      <CreateApptModal
        prefill={createPrefill}
        editAppt={editAppt}
        onClose={() => { setCreatePrefill(null); setEditAppt(null); }}
        onCreated={() => { setCreatePrefill(null); setEditAppt(null); }}
      />

      <TabModal open={tabOpen} tab={tabSnap} onClose={() => setTabOpen(false)} />
    </View>
  );
}

// ── Day timeline view ──────────────────────────────────
// Shows every 30-min slot from 9 AM to 8 PM as a tappable row. Empty
// rows surface a faint "+ Add" hint and create a new appt prefilled
// to that slot. Filled rows render the appt block sized to its
// duration (1 SLOT_PX per 30 min). Multi-tech overlaps are stacked
// horizontally; "Just me" mode never overlaps so most days are clean.
function DayTimelineView({ appts, date, showAll, allTechs, workDays, timeOff, techName, refreshing, onRefresh, onTapAppt, onTapEmpty }) {
  // Working-window awareness — same rules as WeekView's gap calc.
  // Only meaningful when scoped to a single tech (showAll=false).
  const off    = !showAll ? timeOffOn(date, techName, timeOff) : null;
  const window = (!showAll && techName) ? workWindowFor(date, workDays) : { startMin: DAY_START_MIN, endMin: DAY_END_MIN };
  const isOffDay = off || window === null;

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

  if (isOffDay) {
    return (
      <View style={styles.dayOffState}>
        <Text style={styles.dayOffEmoji}>🌴</Text>
        <Text style={styles.dayOffTitle}>{off ? (off.reason || 'Time off') : 'Not a working day'}</Text>
        <Text style={styles.dayOffBody}>
          {off
            ? `You're off from ${off.startDate}${off.endDate && off.endDate !== off.startDate ? ` to ${off.endDate}` : ''}.`
            : `Your schedule shows you don't work this day of the week. Update your work days on the employees page if that's wrong.`}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#fff' }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3D95CE" />}
    >
      {Array.from({ length: SLOT_COUNT }).map((_, idx) => {
        const slotMin = DAY_START_MIN + idx * SLOT_MINUTES;
        const startTime = minToHHMM(slotMin);
        const inWorkWindow = slotMin >= window.startMin && slotMin < window.endMin;
        const slotAppt = (slotAppts[idx] || [])[0];   // primary appt — overlap UI deferred
        const overlapCount = (slotAppts[idx] || []).length;
        const isHourMark = slotMin % 60 === 0;
        return (
          <TouchableOpacity
            key={idx}
            onPress={() => slotAppt ? onTapAppt(slotAppt) : onTapEmpty(startTime)}
            activeOpacity={0.6}
            disabled={!inWorkWindow && !slotAppt}
            style={[styles.dayTimelineRow, { height: SLOT_PX }, !inWorkWindow && styles.dayTimelineRowOff]}
          >
            <View style={styles.dayTimeLabel}>
              {isHourMark && <Text style={[styles.dayTimeLabelText, !inWorkWindow && { color: '#cbd0d6' }]}>{fmtTime(startTime)}</Text>}
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

function WeekView({ date, techName, showAll, allTechs, workDays, timeOff, onTapAppt, onTapEmpty, onPickDay }) {
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

        // Working-hours / time-off awareness — only meaningful when
        // we know which tech we're scoping to. In "All techs" mode we
        // can't speak to anyone's individual schedule, so fall back
        // to the salon-wide window.
        const off    = !showAll ? timeOffOn(d.iso, techName, timeOff) : null;
        const window = (!showAll && techName) ? workWindowFor(d.iso, workDays) : { startMin: DAY_START_MIN, endMin: DAY_END_MIN };
        const isOffDay = off || window === null;

        return (
          <View key={d.iso} style={[styles.weekDayCard, isToday && styles.weekDayCardToday]}>
            <TouchableOpacity onPress={() => onPickDay(d.iso)} style={styles.weekDayHeader} activeOpacity={0.7}>
              <Text style={[styles.weekDayDow, isToday && styles.weekDayDowToday]}>{d.dow}</Text>
              <Text style={[styles.weekDayNum, isToday && styles.weekDayNumToday]}>{d.dayNum}</Text>
              <Text style={styles.weekDayCount}>
                {isOffDay ? (off ? 'time off' : 'off') : `${appts.length} appt${appts.length !== 1 ? 's' : ''}`}
              </Text>
            </TouchableOpacity>
            {isOffDay ? (
              <View style={styles.weekDayOffPill}>
                <Text style={styles.weekDayOffPillText}>
                  {off ? `OFF · ${off.reason || 'Time off'}` : 'NOT WORKING'}
                </Text>
              </View>
            ) : appts.length === 0 ? (
              <TouchableOpacity
                style={styles.weekDayEmpty}
                onPress={() => onTapEmpty(d.iso, minToHHMM(window.startMin))}
                activeOpacity={0.6}
              >
                <Text style={styles.weekDayEmptyText}>
                  ＋ Add appointment ({fmtTime(minToHHMM(window.startMin))} – {fmtTime(minToHHMM(window.endMin))})
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ paddingHorizontal: 8, paddingBottom: 8 }}>
                {(() => {
                  // Interleave appt blocks with gap indicators so techs can
                  // see open time between appointments at a glance and
                  // squeeze in walk-ins. Gap bounds are the tech's
                  // configured work window for this day-of-week, falling
                  // back to salon-wide hours if no per-tech config or in
                  // All-techs mode.
                  const liveAppts = appts.filter(a => a.status !== 'cancelled');
                  const rows = [];
                  const windowStart = window.startMin;
                  const windowEnd   = window.endMin;
                  let cursor = windowStart;

                  liveAppts.forEach((a, i) => {
                    const startMin = hhmmToMin(a.startTime);
                    const dur      = Number(a.duration) || 30;
                    const endMin   = startMin + dur;
                    if (startMin - cursor >= 30) {
                      rows.push({ kind: 'gap', from: cursor, to: startMin, key: `g-${i}` });
                    }
                    rows.push({ kind: 'appt', appt: a, key: a.id });
                    cursor = Math.max(cursor, endMin);
                  });
                  if (windowEnd - cursor >= 30) {
                    rows.push({ kind: 'gap', from: cursor, to: windowEnd, key: 'g-tail' });
                  }

                  return rows.map(row => {
                    if (row.kind === 'gap') {
                      const mins = row.to - row.from;
                      const label = mins >= 60
                        ? `${Math.floor(mins / 60)}h${mins % 60 ? ' ' + (mins % 60) + 'm' : ''} open`
                        : `${mins}m open`;
                      return (
                        <TouchableOpacity
                          key={row.key}
                          style={styles.weekGapRow}
                          onPress={() => onTapEmpty(d.iso, minToHHMM(row.from))}
                          activeOpacity={0.6}
                        >
                          <View style={styles.weekGapLine} />
                          <Text style={styles.weekGapText}>
                            {fmtTime(minToHHMM(row.from))} – {fmtTime(minToHHMM(row.to))} · {label} ＋
                          </Text>
                          <View style={styles.weekGapLine} />
                        </TouchableOpacity>
                      );
                    }
                    const a = row.appt;
                    const c = colorsForAppt(a, allTechs);
                    return (
                      <TouchableOpacity
                        key={row.key}
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
                  });
                })()}
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
// Create OR Edit appointment. Pass `prefill` (date/startTime/techName)
// to open in create mode; pass `editAppt` (full existing appt) to open
// in edit mode. The two are mutually exclusive — caller picks which.
// In edit mode the title/CTA flip to "Edit appointment" / "Save changes"
// and save goes through updateAppointment instead of createAppointment.
function CreateApptModal({ prefill, editAppt, onClose, onCreated }) {
  // CRITICAL: every hook below runs on every render regardless of
  // open state. Conditional rendering is INSIDE the JSX, never via
  // an early return between hook calls.
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [pickedClient, setPickedClient] = useState(null);
  const [clientQuery, setClientQuery] = useState('');
  const [pickedServices, setPickedServices] = useState([]);
  // Editable time fields — only used in edit mode but the state stays
  // declared unconditionally to keep hook order stable.
  const [editStartTime, setEditStartTime] = useState('');
  // Inline new-client form state — opens when user taps "+ New client".
  const [newClientOpen,  setNewClientOpen]  = useState(false);
  const [newClientName,  setNewClientName]  = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);

  const open = !!(prefill || editAppt);
  const isEdit = !!editAppt;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([fetchClients(), fetchServices()])
      .then(([cs, svc]) => {
        setClients(cs || []);
        setServices(svc || []);
      })
      .catch(() => { setClients([]); setServices([]); })
      .finally(() => setLoading(false));
    setNewClientOpen(false);
    setNewClientName('');
    setNewClientPhone('');
    if (isEdit) {
      setPickedClient(editAppt.clientId
        ? { id: editAppt.clientId, name: editAppt.clientName || '' }
        : null);
      setPickedServices((editAppt.services || []).map(s => ({
        id: s.id, name: s.name, duration: Number(s.duration) || 30, price: Number(s.price) || 0,
      })));
      setEditStartTime(editAppt.startTime || '');
    } else {
      setPickedClient(null);
      setPickedServices([]);
      setEditStartTime('');
    }
    setClientQuery('');
  }, [prefill?.date, prefill?.startTime, editAppt?.id]);

  const totalDuration = pickedServices.reduce((s, sv) => s + (Number(sv.duration) || 30), 0) || 30;
  // Full client catalog flows into a bounded inner ScrollView so the
  // user can scroll through everyone without hijacking the outer
  // modal scroll. Cap at 200 visible rows for perf — anyone past
  // that should narrow with search.
  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return clients.slice(0, 200);
    return clients.filter(c => (c.name || '').toLowerCase().includes(q)).slice(0, 200);
  }, [clientQuery, clients]);

  if (!open) return null;   // Safe now — every hook above already ran.

  function toggleService(svc) {
    setPickedServices(prev => prev.some(s => s.id === svc.id)
      ? prev.filter(s => s.id !== svc.id)
      : [...prev, { id: svc.id, name: svc.name, duration: svc.duration || 30, price: Number(svc.price) || 0 }]);
  }

  // Inline client creation. Phone is required so every appt has a way
  // to reach the customer (matches the platform-wide rule "no walk-ins,
  // every client has a phone number"). On success, the new client gets
  // selected as the appt's client and the form collapses.
  async function saveNewClient() {
    const name = newClientName.trim();
    if (!name) { Alert.alert('Name required', 'Enter the client\'s name.'); return; }
    if (!isValidPhone(newClientPhone)) {
      Alert.alert(
        'Phone number not valid',
        'Enter a US phone like (614) 555-0123, or an international one with country code: +44 20 7946 0958.',
      );
      return;
    }
    // Store E.164 ("+16145550123") so Twilio and any future SMS sends
    // route correctly regardless of caller country.
    const phone = toE164(newClientPhone) || formatPhoneInput(newClientPhone);
    setCreatingClient(true);
    try {
      const id = await createClient({
        name,
        phone,
        email: '',
        notes: '',
        createdAt: new Date().toISOString(),
        createdFrom: 'mobile_appt_create',
      });
      const created = { id, name, phone };
      setClients(prev => [created, ...prev]);
      setPickedClient({ id, name });
      setNewClientOpen(false);
      setNewClientName('');
      setNewClientPhone('');
    } catch (e) {
      Alert.alert('Couldn\'t create client', e?.message || 'Please try again.');
    } finally {
      setCreatingClient(false);
    }
  }

  async function save() {
    if (working) return;
    if (!pickedClient?.id) {
      Alert.alert('Pick a client', 'Choose an existing client or tap “＋ New client” to add one. Every appointment needs a real client record.');
      return;
    }
    if (pickedServices.length === 0) {
      Alert.alert('Add at least one service', 'Pick the service(s) the client is booking.');
      return;
    }
    if (isEdit && !/^\d{1,2}:\d{2}$/.test(editStartTime)) {
      Alert.alert('Start time not valid', 'Use 24-hour HH:MM format (e.g. 14:30).');
      return;
    }
    setWorking(true);
    try {
      if (isEdit) {
        await updateAppointment(editAppt.id, {
          startTime: editStartTime,
          clientId:  pickedClient.id,
          clientName: pickedClient.name,
          services:  pickedServices,
          duration:  totalDuration,
        });
      } else {
        await createAppointment({
          date:      prefill.date,
          startTime: prefill.startTime,
          techName:  prefill.techName || '',
          clientId:  pickedClient.id,
          clientName: pickedClient.name,
          services:  pickedServices,
          duration:  totalDuration,
          status:    'scheduled',
          notes:     '',
          techRequestType: 'scheduler',
        });
      }
      onCreated?.();
    } catch (e) {
      Alert.alert(isEdit ? 'Couldn\'t save changes' : 'Couldn\'t create appointment', e?.message || 'Please try again.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>{isEdit ? 'Edit appointment' : 'New appointment'}</Text>
              <Text style={styles.modalSubtitle}>
                {(() => {
                  const ctx = isEdit ? editAppt : prefill;
                  const tech = ctx.techName;
                  return `${new Date(ctx.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTime(isEdit ? editStartTime : ctx.startTime)}${tech ? ' · ' + tech : ' · (no tech)'}`;
                })()}
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
              {isEdit && (
                <>
                  <Text style={styles.sectionLabel}>Start time (24-hour)</Text>
                  <TextInput
                    style={[styles.searchInput, { marginBottom: 16 }]}
                    placeholder="14:30"
                    placeholderTextColor="#bbb"
                    value={editStartTime}
                    onChangeText={setEditStartTime}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </>
              )}
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
                    placeholder="Search clients by name…"
                    placeholderTextColor="#bbb"
                    value={clientQuery}
                    onChangeText={setClientQuery}
                  />
                  <ScrollView
                    style={styles.clientList}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    {newClientOpen ? (
                      <View style={styles.newClientForm}>
                        <Text style={styles.newClientLabel}>New client</Text>
                        <TextInput
                          style={styles.newClientInput}
                          placeholder="Full name *"
                          placeholderTextColor="#bbb"
                          value={newClientName}
                          onChangeText={setNewClientName}
                          autoFocus
                        />
                        <TextInput
                          style={styles.newClientInput}
                          placeholder="Phone *  US: (614) 555-0123  ·  Intl: +44 20 7946 0958"
                          placeholderTextColor="#bbb"
                          value={newClientPhone}
                          onChangeText={t => setNewClientPhone(formatPhoneInput(t))}
                          keyboardType="phone-pad"
                        />
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                          <TouchableOpacity
                            style={[styles.newClientBtn, styles.newClientBtnGhost]}
                            onPress={() => { setNewClientOpen(false); setNewClientName(''); setNewClientPhone(''); }}
                            disabled={creatingClient}
                          >
                            <Text style={styles.newClientBtnGhostText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.newClientBtn, styles.newClientBtnPrimary, creatingClient && { opacity: 0.5 }]}
                            onPress={saveNewClient}
                            disabled={creatingClient}
                          >
                            <Text style={styles.newClientBtnPrimaryText}>{creatingClient ? 'Saving…' : 'Save & select'}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.clientRow, styles.clientRowNew]}
                        onPress={() => setNewClientOpen(true)}
                      >
                        <Text style={styles.clientRowNewText}>＋ New client</Text>
                      </TouchableOpacity>
                    )}
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
                  </ScrollView>
                </>
              )}

              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>
                Services ({pickedServices.length} · {totalDuration} min)
              </Text>
              <ScrollView
                style={styles.serviceGridScroll}
                contentContainerStyle={styles.serviceGrid}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
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
              </ScrollView>

              <TouchableOpacity
                style={[styles.primaryBtn, (working || pickedServices.length === 0) && { opacity: 0.5 }, { marginTop: 22 }]}
                onPress={save}
                disabled={working || pickedServices.length === 0}
              >
                <Text style={styles.primaryBtnText}>
                  {working
                    ? (isEdit ? 'Saving…' : 'Creating…')
                    : (isEdit ? `Save changes (${totalDuration} min)` : `Create appointment (${totalDuration} min)`)}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

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

// Build the social links shown in the appt detail. Centralized so the
// formatting matches across web + mobile and the URL builders are
// auditable. Falls back to a tel:/sms: scheme for phone where useful.
function buildClientLinks(client) {
  if (!client) return [];
  const out = [];
  const norm = (v) => String(v || '').trim().replace(/^@/, '');
  if (client.instagram) out.push({ kind: 'instagram', label: '@' + norm(client.instagram), url: `https://instagram.com/${norm(client.instagram)}` });
  if (client.facebook) {
    const fb = String(client.facebook).trim();
    const url = fb.startsWith('http') ? fb : `https://facebook.com/${norm(fb)}`;
    out.push({ kind: 'facebook', label: norm(fb), url });
  }
  if (client.tiktok) out.push({ kind: 'tiktok', label: '@' + norm(client.tiktok), url: `https://tiktok.com/@${norm(client.tiktok)}` });
  if (client.venmo)  out.push({ kind: 'venmo',  label: '@' + norm(client.venmo),  url: `https://venmo.com/${norm(client.venmo)}` });
  return out;
}
const SOCIAL_EMOJI = { instagram: '📸', facebook: '👥', tiktok: '🎵', venmo: '💸' };

// ── Tab / cart modal ───────────────────────────────────
// Shows everything currently staged for checkout. NFC tap-to-pay is
// the planned terminal flow (physical reader on the way) — for now the
// pay button is disabled with a "coming soon" affordance so the
// interaction is documented in the UI but the code path doesn't
// silently do nothing.
function TabModal({ open, tab, onClose }) {
  if (!open) return null;
  const total = tab.appts.reduce((s, a) => {
    const svcSum = (a.services || []).reduce((ss, sv) => ss + (Number(sv.price) || 0), 0);
    return s + svcSum;
  }, 0);

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>🛒 Tab</Text>
              <Text style={styles.modalSubtitle}>
                {tab.appts.length} appt{tab.appts.length !== 1 ? 's' : ''} · ${total.toFixed(2)}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            {tab.appts.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ fontSize: 56, marginBottom: 12 }}>🛒</Text>
                <Text style={styles.emptyTitle}>Tab is empty</Text>
                <Text style={styles.emptyBody}>Open an appointment and tap "🛒 Add to tab" to stage it for checkout.</Text>
              </View>
            ) : (
              <>
                {tab.appts.map(a => {
                  const svcSum = (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
                  const svcSummary = (a.services || []).map(s => s.name).filter(Boolean).join(', ') || '—';
                  return (
                    <View key={a.id} style={styles.tabRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.tabRowClient} numberOfLines={1}>{a.clientName || 'Walk-in'}</Text>
                        <Text style={styles.tabRowMeta} numberOfLines={1}>
                          {a.date} · {fmtTime(a.startTime)} · {svcSummary}
                        </Text>
                      </View>
                      <Text style={styles.tabRowPrice}>${svcSum.toFixed(2)}</Text>
                      <TouchableOpacity
                        style={styles.tabRowRemove}
                        onPress={() => removeApptFromTab(a.id)}
                        activeOpacity={0.6}
                      >
                        <Text style={styles.tabRowRemoveText}>×</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}

                <View style={styles.tabTotalRow}>
                  <Text style={styles.tabTotalLabel}>Subtotal</Text>
                  <Text style={styles.tabTotalValue}>${total.toFixed(2)}</Text>
                </View>

                <TouchableOpacity
                  disabled
                  style={[styles.primaryBtn, { marginTop: 18, opacity: 0.55 }]}
                  activeOpacity={1}
                >
                  <Text style={styles.primaryBtnText}>📲 Tap to pay (NFC) — coming soon</Text>
                </TouchableOpacity>
                <Text style={styles.tabFootnote}>
                  NFC checkout will activate once the physical terminals arrive. For now the tab
                  is just a staging area — settle these appts manually on the web checkout flow.
                </Text>

                <TouchableOpacity
                  style={styles.tabClearBtn}
                  onPress={() => clearTab()}
                  activeOpacity={0.6}
                >
                  <Text style={styles.tabClearBtnText}>Clear tab</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Detail modal (status, check-in, notes, client snapshot) ─────────────
function ApptDetailModal({ appt, cartTab, onClose, onUpdate, onEdit, onAddToTab }) {
  const [notes,   setNotes]   = useState('');
  const [working, setWorking] = useState(false);
  const [tab,     setTab]     = useState('actions');
  const [client,  setClient]  = useState(null);   // loaded lazily

  useEffect(() => {
    if (appt) {
      setNotes(appt.notes || '');
      setTab('actions');
      setClient(null);
      // Fetch the full client record by ID so the modal can show
      // the photo + socials. Skip if the appt is unlinked (legacy
      // walk-in with no clientId).
      if (appt.clientId) {
        fetchClient(appt.clientId).then(c => setClient(c)).catch(() => setClient(null));
      }
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
  const photoUri = client?.picture || null;
  const socials  = buildClientLinks(client);
  const initial  = (appt.clientName || '?')[0].toUpperCase();

  return (
    <Modal visible={!!appt} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          {/* Header */}
          <View style={styles.modalHeader}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.modalAvatar} />
            ) : (
              <View style={[styles.modalAvatar, styles.modalAvatarFallback]}>
                <Text style={styles.modalAvatarInitial}>{initial}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {appt.clientName || 'Walk-in'}
              </Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {fmtTime(appt.startTime)}{appt.duration ? ` · ${appt.duration} min` : ''}
                {services ? ` · ${services}` : ''}
              </Text>
              {client?.phone && (() => {
                // tel: and sms: schemes are permissive — pass the raw
                // stored phone (already formatted as US "(614) 555-0123"
                // or international "+44 20 7946 0958"). iOS strips
                // anything non-numeric so both forms route correctly.
                const tel = `tel:${client.phone}`;
                const sms = `sms:${client.phone}`;
                return (
                  <View style={styles.modalContactRow}>
                    <Text style={styles.modalPhoneText}>{client.phone}</Text>
                    <TouchableOpacity
                      style={styles.modalContactBtn}
                      onPress={() => Linking.openURL(tel).catch(() => {})}
                      activeOpacity={0.6}
                    >
                      <Text style={styles.modalContactBtnText}>📞 Call</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.modalContactBtn}
                      onPress={() => Linking.openURL(sms).catch(() => {})}
                      activeOpacity={0.6}
                    >
                      <Text style={styles.modalContactBtnText}>💬 Text</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}
              {socials.length > 0 && (
                <View style={styles.modalSocialsRow}>
                  {socials.map(s => (
                    <TouchableOpacity
                      key={s.kind}
                      style={styles.modalSocialChip}
                      onPress={() => Linking.openURL(s.url).catch(() => {})}
                      activeOpacity={0.6}
                    >
                      <Text style={styles.modalSocialChipText}>
                        {SOCIAL_EMOJI[s.kind]} {s.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            {onEdit && (
              <TouchableOpacity onPress={() => onEdit(appt)} style={styles.modalEditBtn}>
                <Text style={styles.modalEditBtnText}>Edit</Text>
              </TouchableOpacity>
            )}
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

                {/* Add to tab — single tap stages this appt for checkout.
                    Already-on-tab disables the button so accidental
                    double-taps don't no-op silently. */}
                {(() => {
                  const onTab = (cartTab?.appts || []).some(a => a.id === appt.id);
                  return (
                    <TouchableOpacity
                      style={[styles.tabAddBtn, onTab && styles.tabAddBtnActive]}
                      onPress={() => onAddToTab?.(appt)}
                      disabled={onTab}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.tabAddBtnText, onTab && styles.tabAddBtnTextActive]}>
                        {onTab ? '✓ On the tab' : '🛒 Add to tab'}
                      </Text>
                    </TouchableOpacity>
                  );
                })()}

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
  dayTimelineRowOff:  { backgroundColor: '#fafbfc' },  // out-of-hours rows are visually muted
  dayTimeLabel:       { width: 56, paddingLeft: 8, paddingTop: 2 },
  dayTimeLabelText:   { fontSize: 11, color: '#888', fontWeight: '600' },
  dayTimelineSlot:    { flex: 1, paddingVertical: 2, paddingRight: 8, justifyContent: 'flex-start', alignItems: 'stretch' },
  dayTimelineSlotHour:{ borderTopWidth: 0.5, borderTopColor: '#dadcdf' },
  dayApptBlock:       { backgroundColor: '#EBF4FB', borderLeftWidth: 3, borderLeftColor: '#3D95CE', borderRadius: 6, padding: 8, justifyContent: 'center' },
  dayApptClient:      { fontSize: 13, fontWeight: '700', color: '#1a1a1a' },
  dayApptMeta:        { fontSize: 11, color: '#666', marginTop: 2 },
  dayEmptyHint:       { fontSize: 14, color: '#dadcdf', textAlign: 'center', lineHeight: 18 },
  dayOffState:        { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 60, paddingHorizontal: 32, backgroundColor: '#fff' },
  dayOffEmoji:        { fontSize: 56, marginBottom: 12 },
  dayOffTitle:        { fontSize: 18, fontWeight: '700', color: '#1a1a1a', marginBottom: 8, textAlign: 'center' },
  dayOffBody:         { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 19 },

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
  weekGapRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  weekGapLine:        { flex: 1, height: 1, backgroundColor: '#e8eaee' },
  weekGapText:        { fontSize: 11, color: '#888', fontWeight: '500' },
  weekDayOffPill:     { alignSelf: 'flex-start', marginHorizontal: 12, marginVertical: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e0e0e0' },
  weekDayOffPillText: { fontSize: 11, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  weekApptBlock:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#f7fbfd', borderLeftWidth: 3, borderLeftColor: '#3D95CE', borderRadius: 6, marginTop: 6 },
  weekApptTime:       { fontSize: 11, fontWeight: '700', color: '#3D95CE', minWidth: 56 },
  weekApptClient:     { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  weekApptMeta:       { fontSize: 11, color: '#888', marginTop: 1 },

  // Create appt modal
  searchInput:        { backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: '#1a1a1a' },
  // Both inner lists are bounded ScrollViews so the user can scroll
  // through the full client + service catalog without the modal's
  // outer ScrollView interfering. nestedScrollEnabled is required for
  // Android; iOS handles nested scrolling natively.
  clientList:         { marginTop: 8, backgroundColor: '#fafafa', borderRadius: 8, height: 240 },
  clientRow:          { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  clientRowNew:       { backgroundColor: '#f0faf6', borderBottomColor: '#d1ead8' },
  clientRowNewText:   { fontSize: 14, color: '#2D7A5F', fontWeight: '700' },
  clientRowName:      { fontSize: 14, color: '#1a1a1a' },
  clientRowMeta:      { fontSize: 11, color: '#888', marginTop: 2 },
  newClientForm:      { padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', gap: 8 },
  newClientLabel:     { fontSize: 11, fontWeight: '700', color: '#2D7A5F', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  newClientInput:     { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#1a1a1a', backgroundColor: '#fff' },
  newClientBtn:       { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  newClientBtnPrimary:    { backgroundColor: '#2D7A5F' },
  newClientBtnPrimaryText:{ color: '#fff', fontWeight: '700', fontSize: 13 },
  newClientBtnGhost:      { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  newClientBtnGhostText:  { color: '#666', fontWeight: '600', fontSize: 13 },
  pickedChip:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EBF4FB', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, alignSelf: 'flex-start' },
  pickedChipText:     { fontSize: 13, color: '#1a5f8a', fontWeight: '600' },
  pickedChipX:        { fontSize: 18, color: '#1a5f8a', marginLeft: 8, lineHeight: 18 },
  serviceGridScroll:  { marginTop: 4, height: 220 },
  serviceGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 4 },
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
  // Use height (not maxHeight) so the inner ScrollView's flex:1 has
  // bounded space to fill. Without this the sheet collapses to header
  // + tab row only because the ScrollView body resolves to 0px.
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '85%', paddingBottom: 20 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  modalSubtitle: { fontSize: 12, color: '#888', marginTop: 2 },
  modalClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' },
  modalCloseText: { fontSize: 22, color: '#666', lineHeight: 24 },
  modalEditBtn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#EBF4FB', borderWidth: 1, borderColor: '#3D95CE', marginRight: 8 },
  modalEditBtnText: { fontSize: 13, fontWeight: '700', color: '#1a5f8a' },
  modalAvatar:         { width: 48, height: 48, borderRadius: 24 },
  modalAvatarFallback: { backgroundColor: '#e8eaee', alignItems: 'center', justifyContent: 'center' },
  modalAvatarInitial:  { fontSize: 20, fontWeight: '700', color: '#888' },
  modalSocialsRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  modalSocialChip:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#f0f4f8', borderWidth: 1, borderColor: '#dbe3eb' },
  modalSocialChipText: { fontSize: 11, color: '#3a4a5a', fontWeight: '600' },
  modalContactRow:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  modalPhoneText:      { fontSize: 12, color: '#1a1a1a', fontWeight: '600', marginRight: 4 },
  modalContactBtn:     { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: '#EBF4FB', borderWidth: 1, borderColor: '#3D95CE' },
  modalContactBtnText: { fontSize: 12, fontWeight: '700', color: '#1a5f8a' },

  // Cart / tab pill in the date-row header
  cartPill:        { backgroundColor: '#fffbeb', borderColor: '#fde68a', borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#fde68a' },
  cartPillText:    { fontSize: 13, color: '#92400e', fontWeight: '700' },

  // Add-to-tab button on detail modal
  tabAddBtn:           { backgroundColor: '#fffbeb', borderWidth: 1.5, borderColor: '#fde68a', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  tabAddBtnActive:     { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  tabAddBtnText:       { fontSize: 14, fontWeight: '700', color: '#92400e' },
  tabAddBtnTextActive: { color: '#16a34a' },

  // TabModal rows + summary
  tabRow:            { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  tabRowClient:      { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  tabRowMeta:        { fontSize: 11, color: '#888', marginTop: 2 },
  tabRowPrice:       { fontSize: 14, fontWeight: '700', color: '#1a5f8a' },
  tabRowRemove:      { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center' },
  tabRowRemoveText:  { fontSize: 18, color: '#ef4444', lineHeight: 20 },
  tabTotalRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, marginTop: 4, borderTopWidth: 2, borderTopColor: '#1a1a1a' },
  tabTotalLabel:     { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  tabTotalValue:     { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  tabFootnote:       { fontSize: 11, color: '#888', marginTop: 8, lineHeight: 16, textAlign: 'center' },
  tabClearBtn:       { marginTop: 14, alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 18, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  tabClearBtnText:   { fontSize: 12, color: '#888', fontWeight: '600' },

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
