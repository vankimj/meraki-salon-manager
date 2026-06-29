import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, TextInput, ScrollView, Alert, RefreshControl, Image, Linking,
} from 'react-native';
import {
  subscribeAppointments, setAppointmentStatus, checkInAppointment, setAppointmentNotes,
  fetchAppointmentsByRange, createAppointment, fetchClients, fetchServices, fetchEmployees,
  fetchTimeOff, createClient, updateAppointment, fetchClient, softDeleteAppointment,
  softDeleteRecurringSeries, fetchSettings, fetchAttendance, notifyAppointmentCancelled,
  createTimeOff, deleteTimeOff,
} from '../lib/firestore';
import { isSalonOpenNow, clockedInNameSet, attendanceKey } from '../lib/shiftGate';
import { notifyAffectedTechs } from '../lib/notifications';
import { addApptToTab, removeApptFromTab, getCurrentTab, tabCount, tabTotal, subscribeTab, clearTab } from '../lib/currentTab';
import useCurrentEmployee from '../hooks/useCurrentEmployee';
import { auth } from '../lib/firebase';
import useTenantAccess from '../hooks/useTenantAccess';
import useResponsive from '../hooks/useResponsive';
import useTrashHeader from '../hooks/useTrashHeader';
import Icon from '../components/Icon';
import RefundModal from './checkout/RefundModal';
import TurnHelpSheet from '../components/TurnHelpSheet';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

// Salon hours + slot grid. Matches the web SLOT_H=40 / 9am-8pm convention
// from CLAUDE.md so the day view feels familiar across devices.
const SLOT_MINUTES = 30;
const DAY_START_MIN = 9 * 60;       // 9 AM
const DAY_END_MIN   = 20 * 60;      // 8 PM
const SLOT_PX       = 50;           // taller than web for finger-tap accuracy
const SLOT_COUNT    = (DAY_END_MIN - DAY_START_MIN) / SLOT_MINUTES;

// Resolve a service's effective price + duration for the performing tech.
// Mirrors the web techServicePrice / techServiceDuration (serviceHelpers.js):
// Resolve a service's price, tolerant of the catalog schema: services now store
// `basePrice` (with optional priceFrom), older ones stored `price`. Reading only
// `price` made every newer service resolve to $0 on appointment creation.
export function servicePrice(svc) {
  return Number(svc?.basePrice ?? svc?.price ?? 0) || 0;
}

// tech.servicePrices[svcId] / serviceDurations[svcId] override the service's
// price/duration when set (price >= 0 valid incl. $0 comp; duration > 0).
function resolveTechSvc(svc, tech) {
  const p = tech?.servicePrices?.[svc?.id];
  const d = tech?.serviceDurations?.[svc?.id];
  return {
    price:    (typeof p === 'number' && p >= 0) ? p : servicePrice(svc),
    duration: (typeof d === 'number' && d > 0) ? d : (svc?.duration || 30),
  };
}

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

// Time-off entries covering `iso` for `techName`, resolved to a minute range
// within the day so the calendar can draw them as block-out bands. All-day
// entries span the whole working day; partial entries honor startTime/endTime
// (only on the relevant edge day of a multi-day range). Mirrors the web's
// isSlotBlocked semantics.
function dayBlocksFor(iso, techName, timeOff) {
  if (!techName || !timeOff?.length) return [];
  const t = techName.toLowerCase();
  const out = [];
  for (const o of timeOff) {
    if ((o.techName || '').toLowerCase() !== t) continue;
    const start = o.startDate || '';
    const end   = o.endDate || o.startDate || '';
    if (!(start <= iso && iso <= end)) continue;
    let s = DAY_START_MIN, e = DAY_END_MIN;
    if (o.allDay === false) {
      if (o.startTime && iso === start) s = Math.max(DAY_START_MIN, hhmmToMin(o.startTime));
      if (o.endTime   && iso === end)   e = Math.min(DAY_END_MIN, hhmmToMin(o.endTime));
    }
    if (e > s) out.push({ id: o.id, startMin: s, endMin: e, reason: o.reason || o.type || 'Blocked', entry: o });
  }
  return out;
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

function statusMeta(t) {
  return {
    scheduled: { label: 'Scheduled', color: t.blue,    bg: t.blueSoft  },
    done:      { label: 'Done',      color: t.success, bg: t.greenSoft },
    cancelled: { label: 'Cancelled', color: t.danger,  bg: t.dangerBg  },
    no_show:   { label: 'No-show',   color: t.warning, bg: t.warningBg },
  };
}

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
function colorsForAppt(appt, allTechs, t) {
  const col = getTechColor(appt.techName, allTechs);
  if (appt.status === 'cancelled') return { bg: t.dangerBg, border: t.danger, text: t.danger, faded: true };
  if (appt.status === 'done')      return { bg: t.surfaceMuted, border: t.borderStrong, text: t.textMuted, faded: false };
  return { bg: col.bg, border: col.solid, text: col.text, faded: false };
}

export default function ScheduleScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { employee, techName, loading: empLoading } = useCurrentEmployee();
  const { isAdmin, role, canEditSchedule, email } = useTenantAccess();
  // Who may view the WHOLE salon's schedule (RBAC schedule_all): owner/manager/
  // scheduler. A plain tech stays scoped to their own. (admin === owner.)
  const canSeeAll = isAdmin || role === 'manager' || role === 'scheduler';
  useTrashHeader(navigation, ['appointments', 'timeOff'], isAdmin);
  const [date,    setDate]    = useState(todayStr());
  const [appts,   setAppts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Role-aware tech filter. EMPTY set = "Everyone" (admins only). Non-admins
  // are hard-scoped to their own techName below and never see this control.
  const [selectedTechs, setSelectedTechs] = useState(() => new Set());  // names; EMPTY = "Everyone" (admins only)
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail,  setDetail]  = useState(null);  // selected appt for the modal
  const [refundAppt, setRefundAppt] = useState(null);  // appt being refunded
  const [view,    setView]    = useState('day'); // 'day' | 'week' | 'month'
  const [createPrefill, setCreatePrefill] = useState(null);  // { date, startTime, techName } or null
  const [editAppt, setEditAppt] = useState(null);            // existing appt being edited or null
  const [showTurnHelp, setShowTurnHelp] = useState(false);   // "how turns work" (Mango) explainer
  const [tabOpen,  setTabOpen]  = useState(false);
  const [tabSnap,  setTabSnap]  = useState(getCurrentTab()); // re-rendered on tab change
  const [settings, setSettings] = useState(null);
  const [attendance, setAttendance] = useState(null);

  useEffect(() => subscribeTab(setTabSnap), []);
  // Clock-in gate inputs: a tech editing their own calendar while the salon is
  // open must be clocked in (off shift / closed → free; admins exempt).
  useEffect(() => { fetchSettings().then(setSettings).catch(() => setSettings({})); }, []);
  useEffect(() => { fetchAttendance(attendanceKey()).then(setAttendance).catch(() => setAttendance({ entries: [] })); }, []);

  // Returns true (and alerts) when the current tech must clock in before they
  // can change the schedule. Admins, non-techs, and off-shift edits pass.
  function clockGateBlocked() {
    if (isAdmin || !techName || !settings || !attendance) return false;
    if (!isSalonOpenNow(settings)) return false;
    const inSet = clockedInNameSet(attendance);
    if (inSet.has(String(techName).trim().toLowerCase())) return false;
    Alert.alert('Clock in required', 'Clock in at the Time Clock before changing your schedule during open hours.');
    return true;
  }

  // Deleting soft-deletes (doesn't flip status), so the server cancellation
  // notice doesn't fire. For a real, upcoming client appt, offer to text/email
  // them. Walk-ins, past, and done/cancelled appts skip the prompt.
  function maybeNotifyClientOfCancel(a) {
    return new Promise((resolve) => {
      if (!a?.clientId || a.status === 'cancelled' || a.status === 'done' || (a.date || '') < todayStr()) {
        resolve(); return;
      }
      Alert.alert(
        'Notify the client?',
        `Text/email ${a.clientName || 'the client'} that this appointment is cancelled?`,
        [
          { text: "Don't notify", style: 'cancel', onPress: () => resolve() },
          { text: 'Notify', onPress: async () => { try { await notifyAppointmentCancelled(a.id); } catch {} resolve(); } },
        ],
        { cancelable: false },
      );
    });
  }
  const [allTechs, setAllTechs] = useState([]);  // ordered tech-name list for color assignment
  const [timeOff,  setTimeOff]  = useState([]);  // [{ techName, startDate, endDate }]
  // Map of clientId → minimal client snapshot ({ allergies }). Used by
  // the calendar views to flag appts whose client has allergies on
  // file. Loaded once per tenant; keys never change for an existing
  // client so we don't refresh on every schedule update.
  const [clientsById, setClientsById] = useState({});

  // Stable tech list + time-off snapshot — fetched on mount, refreshed on
  // tenant change (RootNav re-mounts on tenant switch, so this re-runs). Client
  // allergies are loaded lazily per visible day below (NOT the whole client
  // collection — each client doc carries a base64 photo, so the old full fetch
  // pulled multi-MB on every schedule open).
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

  // Allergy flags: fetch only the clients actually on the loaded day (deduped,
  // and cached across days in clientsById) instead of the entire collection.
  useEffect(() => {
    const need = Array.from(new Set((appts || []).map(a => a.clientId).filter(Boolean)))
      .filter(id => !(id in clientsById));
    if (!need.length) return;
    let cancelled = false;
    Promise.all(need.map(id =>
      fetchClient(id).then(c => [id, { allergies: c?.allergies || '' }]).catch(() => [id, { allergies: '' }]),
    )).then(entries => {
      if (cancelled) return;
      setClientsById(prev => {
        const next = { ...prev };
        entries.forEach(([id, v]) => { next[id] = v; });
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [appts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-pull time-off after a block-out is created or deleted (it's a one-shot
  // fetch, not a live subscription like appointments).
  const reloadTimeOff = () => { fetchTimeOff().then(off => setTimeOff(off || [])).catch(() => {}); };

  // Tap a block-out band → confirm and remove it (frees the slot for booking).
  function deleteBlock(entry) {
    if (!entry?.id) return;
    if (clockGateBlocked()) return;
    const range = entry.startTime ? ` (${fmtTime(entry.startTime)}–${fmtTime(entry.endTime)})` : '';
    Alert.alert(
      'Remove block-out?',
      `Free up ${entry.reason || entry.type || 'this blocked time'}${range} for ${entry.techName || 'this tech'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: async () => {
          try { await deleteTimeOff(entry.id); reloadTimeOff(); }
          catch (e) { Alert.alert('Couldn’t remove', e?.message || 'Please try again.'); }
        } },
      ],
    );
  }

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

  // ── Role-aware tech scoping ──────────────────────────
  // Non-admins (techs) are HARD-SCOPED to their own techName in every view —
  // they never see another tech's appointments and get no filter control.
  // Admins default to "Everyone" (empty set) and can narrow to a subset.
  const everyone = canSeeAll && selectedTechs.size === 0;
  const visibleTechs = useMemo(() => {
    if (!canSeeAll) return techName ? [techName] : [];   // plain tech → own only
    if (!selectedTechs.size) return allTechs;
    return allTechs.filter(t => selectedTechs.has(t));
  }, [canSeeAll, techName, allTechs, selectedTechs]);
  const visibleSet = useMemo(() => new Set(visibleTechs), [visibleTechs]);
  const ownOnly = visibleTechs.length === 1 && visibleTechs[0] === techName;
  // Keep the name `showAll` so the views' prop wiring stays; it means
  // "multi-tech layout" — true unless we're scoped to exactly the user's own.
  const showAll = !ownOnly;

  const filtered = useMemo(() => {
    if (everyone) return appts;                 // admin viewing everyone — include blank-tech appts too
    return appts.filter(a => visibleSet.has(a.techName || ''));
  }, [appts, everyone, visibleSet]);

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
              {everyone ? '' : (ownOnly ? ' · Just me' : ` · ${visibleTechs.join(', ')}`)}
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.navBtn} onPress={() => navShift(1)}>
          <Text style={styles.navBtnText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Tab / cart bar — only when something's been staged */}
      {tabSnap.appts.length + tabSnap.products.length > 0 && (
        <TouchableOpacity style={styles.cartBar} onPress={() => setTabOpen(true)} activeOpacity={0.85}>
          <View style={styles.cartBadge}>
            <Text style={styles.cartBadgeText}>{tabSnap.appts.length + tabSnap.products.length}</Text>
          </View>
          <Text style={styles.cartBarText}>🛒  Tab · ${tabTotal().toFixed(2)}</Text>
          <Text style={styles.cartBarCta}>Check out ›</Text>
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
        {/* Walk-in queue + who's clocked in — opens the existing Walk-in
            Manager (rotation + waitlist) in the Manage stack, matching the
            web schedule's turn roster. `initial: false` puts the Manage
            grid (ManageGrid, the stack's initialRouteName) beneath Walkin so
            the back button works and tapping the Manage tab returns to the
            grid — without it, a never-yet-opened Manage stack initializes
            with Walkin as its only route and gets stuck on the queue. */}
        {canSeeAll && (
          <TouchableOpacity
            style={[styles.chip, styles.chipGreen]}
            onPress={() => navigation.getParent()?.navigate('Manage', { screen: 'Walkin', initial: false })}
          >
            <Text style={styles.chipGreenText}>📋 Queue</Text>
          </TouchableOpacity>
        )}
        {/* Mango turn-system explainer — same "How turns work" help the web
            schedule shows, opening the shared TurnHelpSheet. */}
        {canSeeAll && (
          <TouchableOpacity style={[styles.chip, styles.chipMuted]} onPress={() => setShowTurnHelp(true)}>
            <Text style={styles.chipMutedText}>❔ How turns work</Text>
          </TouchableOpacity>
        )}
        {/* Tech filter — owner/manager/scheduler. Plain techs are locked to their own. */}
        {canSeeAll && (
          <>
            <TouchableOpacity
              style={[styles.chip, everyone ? styles.chipBlue : styles.chipMuted]}
              onPress={() => setSelectedTechs(new Set())}
            >
              <Text style={everyone ? styles.chipBlueText : styles.chipMutedText}>👥 Everyone</Text>
            </TouchableOpacity>
            {!!techName && (
              <TouchableOpacity
                style={[styles.chip, ownOnly ? styles.chipBlue : styles.chipMuted]}
                onPress={() => setSelectedTechs(new Set([techName]))}
              >
                <Text style={ownOnly ? styles.chipBlueText : styles.chipMutedText}>👤 Just me</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* Per-tech filter — tap any tech to show only them; tap more for a combo;
          "Everyone" above clears it. Direct, no buried gear/modal. */}
      {canSeeAll && allTechs.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginBottom: 6 }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 12, alignItems: 'center' }}
        >
          {allTechs.map(t => {
            const on = selectedTechs.has(t);
            return (
              <TouchableOpacity
                key={t}
                style={[styles.chip, on ? styles.chipBlue : styles.chipMuted]}
                onPress={() => setSelectedTechs(prev => {
                  const n = new Set(prev);
                  if (n.has(t)) n.delete(t); else n.add(t);
                  return n;
                })}
              >
                <Text style={on ? styles.chipBlueText : styles.chipMutedText}>{t}{t === techName ? ' (me)' : ''}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {view === 'month' && (
        <MonthView
          date={date}
          techName={techName}
          showAll={showAll}
          allTechs={everyone ? allTechs : visibleTechs}
          onPickDay={(d) => { setDate(d); setView('day'); }}
        />
      )}

      {view === 'week' && (
        <WeekView
          date={date}
          techName={techName}
          showAll={showAll}
          allTechs={everyone ? allTechs : visibleTechs}
          clientsById={clientsById}
          workDays={employee?.workDays}
          timeOff={timeOff}
          onTapAppt={(a) => setDetail(a)}
          onTapEmpty={(d, startTime) => setCreatePrefill({ date: d, startTime, techName: showAll ? '' : (techName || '') })}
          onPickDay={(d) => { setDate(d); setView('day'); }}
        />
      )}

      {view === 'day' && (
        (empLoading || loading) ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={theme.blue} />
        ) : showAll ? (
          /* Tech-column grid (headers per tech, gaps visible at a glance) on
             phone AND tablet now — columns size to the screen and the tech
             filter chips above narrow which columns show. Single-tech ("Just
             me") still uses the roomier single timeline. */
          <DayGridView
            appts={filtered}
            allTechs={everyone ? allTechs : visibleTechs}
            clientsById={clientsById}
            date={date}
            timeOff={timeOff}
            onDeleteBlock={deleteBlock}
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); reloadTimeOff(); setTimeout(() => setRefreshing(false), 600); }}
            onTapAppt={(a) => setDetail(a)}
            onTapEmpty={(startTime, tech) => setCreatePrefill({ date, startTime, techName: tech ?? '' })}
            onReschedule={async (a, patch) => {
              if (clockGateBlocked()) return;
              setAppts(prev => prev.map(x => x.id === a.id ? { ...x, ...patch } : x));
              try { await updateAppointment(a.id, patch); notifyAffectedTechs(a, { ...a, ...patch }).catch(() => {}); }
              catch (e) { Alert.alert('Couldn\'t move', e?.message || 'Try again.'); setAppts(prev => prev.map(x => x.id === a.id ? { ...x, startTime: a.startTime, techName: a.techName } : x)); }
            }}
          />
        ) : (
          <DayTimelineView
            appts={filtered}
            date={date}
            showAll={showAll}
            allTechs={everyone ? allTechs : visibleTechs}
            clientsById={clientsById}
            workDays={employee?.workDays}
            timeOff={timeOff}
            techName={techName}
            onDeleteBlock={deleteBlock}
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); reloadTimeOff(); setTimeout(() => setRefreshing(false), 600); }}
            onTapAppt={(a) => setDetail(a)}
            onTapEmpty={(startTime) => setCreatePrefill({ date, startTime, techName: showAll ? '' : (techName || '') })}
            onReschedule={async (a, patch) => {
              if (clockGateBlocked()) return;
              setAppts(prev => prev.map(x => x.id === a.id ? { ...x, ...patch } : x));
              try { await updateAppointment(a.id, patch); notifyAffectedTechs(a, { ...a, ...patch }).catch(() => {}); }
              catch (e) { Alert.alert('Couldn\'t move', e?.message || 'Try again.'); setAppts(prev => prev.map(x => x.id === a.id ? { ...x, startTime: a.startTime, techName: a.techName } : x)); }
            }}
          />
        )
      )}

      <ApptDetailModal
        appt={detail}
        cartTab={tabSnap}
        canDelete={!!detail && (isAdmin || (!!techName && detail.techName === techName && canEditSchedule))}
        onClose={() => setDetail(null)}
        onEdit={(a) => { setDetail(null); setEditAppt(a); }}
        onAddToTab={(a) => addApptToTab(a)}
        onDelete={async (a) => {
          await maybeNotifyClientOfCancel(a);
          await softDeleteAppointment(a.id, email);
          notifyAffectedTechs(a, { ...a, status: 'cancelled' }).catch(() => {});
          removeApptFromTab(a.id);
          setAppts(prev => prev.filter(x => x.id !== a.id));
          setDetail(null);
        }}
        onDeleteSeries={async (a) => {
          const ids = await softDeleteRecurringSeries(a.recurringGroupId, email, { fromDate: todayStr() });
          ids.forEach(id => removeApptFromTab(id));
          setAppts(prev => prev.filter(x => !ids.includes(x.id)));
          setDetail(null);
        }}
        onUpdate={(patch) => {
          // Optimistic local update; live sub will reconcile.
          setAppts(prev => prev.map(a => a.id === detail.id ? { ...a, ...patch } : a));
          setDetail(prev => prev ? { ...prev, ...patch } : null);
        }}
        onRefund={(a) => { setDetail(null); setRefundAppt(a); }}
      />

      <RefundModal
        appt={refundAppt}
        onClose={() => setRefundAppt(null)}
        onDone={(refund) => {
          setAppts(prev => prev.map(a => a.id === refundAppt.id ? { ...a, refund } : a));
          setRefundAppt(null);
          Alert.alert('Refund recorded', `$${(Number(refund.amount) || 0).toFixed(2)} refunded${refund.addedCredit ? ' + store credit added' : ''}.`);
        }}
      />

      <CreateApptModal
        prefill={createPrefill}
        editAppt={editAppt}
        gateBlocked={clockGateBlocked}
        onClose={() => { setCreatePrefill(null); setEditAppt(null); }}
        onCreated={() => { setCreatePrefill(null); setEditAppt(null); reloadTimeOff(); }}
      />

      <TurnHelpSheet visible={showTurnHelp} onClose={() => setShowTurnHelp(false)} />

      <TabModal open={tabOpen} tab={tabSnap} onClose={() => setTabOpen(false)}
        onCheckout={() => { setTabOpen(false); navigation.navigate('Checkout'); }} />

      <TechFilterModal
        open={isAdmin && filterOpen}
        allTechs={allTechs}
        selected={selectedTechs}
        myTech={techName}
        onEveryone={() => setSelectedTechs(new Set())}
        onJustMe={() => setSelectedTechs(new Set(techName ? [techName] : []))}
        onToggle={(name) => setSelectedTechs(prev => {
          const next = new Set(prev);
          if (next.has(name)) next.delete(name); else next.add(name);
          return next;
        })}
        onClose={() => setFilterOpen(false)}
      />
    </View>
  );
}

// ── Tech filter modal (admins only) ────────────────────
// Bottom-sheet that lets an admin choose whose schedule to view:
// Everyone (all techs), Just me, or an arbitrary multi-select subset.
// Non-admins never see this — they're hard-scoped to their own techName.
function TechFilterModal({ open, allTechs, selected, myTech, onEveryone, onJustMe, onToggle, onClose }) {
  const styles = useThemedStyles(makeStyles);
  if (!open) return null;
  const isEveryone = selected.size === 0;
  const isJustMe = !!myTech && selected.size === 1 && selected.has(myTech);

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { height: '70%' }]}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Show schedule for</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            <TouchableOpacity
              style={[styles.techFilterRow, isEveryone && styles.techFilterRowActive]}
              onPress={onEveryone}
              activeOpacity={0.7}
            >
              <Text style={styles.techFilterLabel}>👥 Everyone</Text>
              {isEveryone && <Text style={styles.techFilterCheck}>✓</Text>}
            </TouchableOpacity>

            {!!myTech && (
              <TouchableOpacity
                style={[styles.techFilterRow, isJustMe && styles.techFilterRowActive]}
                onPress={onJustMe}
                activeOpacity={0.7}
              >
                <Text style={styles.techFilterLabel}>👤 Just me</Text>
                {isJustMe && <Text style={styles.techFilterCheck}>✓</Text>}
              </TouchableOpacity>
            )}

            <View style={styles.techFilterDivider} />

            {(allTechs || []).map(name => {
              const checked = selected.has(name);
              return (
                <TouchableOpacity
                  key={name}
                  style={styles.techFilterRow}
                  onPress={() => onToggle(name)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.techFilterLabel}>{name}</Text>
                  <View style={[styles.techFilterBox, checked && styles.techFilterBoxChecked]}>
                    {checked && <Text style={styles.techFilterBoxCheck}>✓</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.85} onPress={onClose}>
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Day timeline view ──────────────────────────────────
// Shows every 30-min slot from 9 AM to 8 PM as a tappable row. Empty
// rows surface a faint "+ Add" hint and create a new appt prefilled
// to that slot. Filled rows render the appt block sized to its
// duration (1 SLOT_PX per 30 min). Multi-tech overlaps are stacked
// horizontally; "Just me" mode never overlaps so most days are clean.
function DayTimelineView({ appts, date, showAll, allTechs, clientsById, workDays, timeOff, techName, onDeleteBlock, refreshing, onRefresh, onTapAppt, onTapEmpty, onReschedule }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { contentMaxWidth } = useResponsive();
  const [moving, setMoving] = useState(null);   // appt long-pressed to reschedule
  // Working-window awareness — same rules as WeekView's gap calc.
  // Only meaningful when scoped to a single tech (showAll=false).
  // Only ALL-DAY time off collapses the day to the "off" screen. Partial
  // block-outs render inline as bands so the rest of the day is still bookable.
  const offEntry = !showAll ? timeOffOn(date, techName, timeOff) : null;
  const off    = (offEntry && offEntry.allDay !== false) ? offEntry : null;
  const window = (!showAll && techName) ? workWindowFor(date, workDays) : { startMin: DAY_START_MIN, endMin: DAY_END_MIN };
  const isOffDay = off || window === null;
  const blocks  = (!showAll && techName) ? dayBlocksFor(date, techName, timeOff) : [];
  const blockAt = (slotMin) => blocks.find(b => slotMin >= b.startMin && slotMin < b.endMin) || null;

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
    <>
    {moving && (
      <View style={styles.moveBanner}>
        <Text style={styles.moveBannerText} numberOfLines={1}>Moving {moving.clientName || 'Walk-in'} — tap a new time</Text>
        <TouchableOpacity onPress={() => setMoving(null)} style={styles.moveCancel}><Text style={styles.moveCancelText}>✕ Cancel</Text></TouchableOpacity>
      </View>
    )}
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.surface }}
      contentContainerStyle={{ paddingBottom: 40, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.blue} />}
    >
      {Array.from({ length: SLOT_COUNT }).map((_, idx) => {
        const slotMin = DAY_START_MIN + idx * SLOT_MINUTES;
        const startTime = minToHHMM(slotMin);
        const inWorkWindow = slotMin >= window.startMin && slotMin < window.endMin;
        const slotList = slotAppts[idx] || [];   // ALL appts starting this slot — rendered side-by-side
        const blk = !slotList.length ? blockAt(slotMin) : null;   // personal block-out covering this slot
        const isHourMark = slotMin % 60 === 0;
        return (
          <TouchableOpacity
            key={idx}
            onPress={() => {
              if (moving) { onReschedule?.(moving, { startTime, techName: moving.techName }); setMoving(null); }
              else if (blk) onDeleteBlock?.(blk.entry);           // tap a block-out to remove it
              else if (!slotList.length) onTapEmpty(startTime);   // empty cells add; each appt handles its own tap below
            }}
            delayLongPress={300}
            activeOpacity={moving ? 0.6 : 1}
            disabled={!moving && !inWorkWindow && !slotList.length && !blk}
            style={[styles.dayTimelineRow, { height: SLOT_PX }, !inWorkWindow && styles.dayTimelineRowOff, moving && styles.dayTimelineRowDrop]}
          >
            <View style={styles.dayTimeLabel}>
              {isHourMark && <Text style={[styles.dayTimeLabelText, !inWorkWindow && { color: theme.textFaint }]}>{fmtTime(startTime)}</Text>}
            </View>
            <View style={[styles.dayTimelineSlot, isHourMark && styles.dayTimelineSlotHour]}>
              {slotList.length ? (
                <View style={{ flexDirection: 'row', flex: 1, gap: 3 }}>
                  {slotList.map((a, ai) => {
                    const c = colorsForAppt(a, allTechs, theme);
                    return (
                      <TouchableOpacity
                        key={a.id || ai}
                        style={{ flex: 1 }}
                        activeOpacity={0.6}
                        onPress={() => onTapAppt(a)}
                        onLongPress={() => { if (onReschedule && !moving) setMoving(a); }}
                        delayLongPress={300}
                      >
                        <View style={[
                          styles.dayApptBlock,
                          {
                            height: Math.max(SLOT_PX - 4, ((a.duration || 30) / SLOT_MINUTES) * SLOT_PX - 4),
                            backgroundColor: c.bg,
                            borderLeftColor: c.border,
                            opacity: moving?.id === a.id ? 0.4 : (c.faded ? 0.65 : 1),
                          },
                        ]}>
                          <Text style={[styles.dayApptClient, { color: c.text }]} numberOfLines={1}>
                            {a.techRequestType === 'specific' && <Text style={styles.requestStar}>★ </Text>}
                            {!!clientsById?.[a.clientId]?.allergies && <Text style={styles.allergyWarn}>⚠ </Text>}
                            {a.clientName || 'Walk-in'}
                          </Text>
                          <Text style={[styles.dayApptMeta, { color: c.text, opacity: 0.75 }]} numberOfLines={1}>
                            {showAll ? `${a.techName} · ` : ''}
                            {(a.services || []).map(s => s.name).filter(Boolean).join(', ') || ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : blk ? (
                <View style={[styles.dayApptBlock, { backgroundColor: theme.surfaceMuted, borderLeftColor: theme.textMuted, borderStyle: 'dashed', borderWidth: 1, borderColor: theme.border, height: SLOT_PX - 4, justifyContent: 'center' }]}>
                  {slotMin === blk.startMin && <Text style={styles.blockBandText} numberOfLines={1}>⛔ {blk.reason}</Text>}
                </View>
              ) : (
                <Text style={styles.dayEmptyHint}>＋</Text>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
    </>
  );
}

// ── Day grid view (tablet · all techs) ─────────────────
// One column per tech, web-style. Each column is an absolutely-positioned
// timeline: free slots are tappable "+" zones, appt blocks float on top
// sized to their duration. Time axis is fixed on the left (outside the
// horizontal scroll) so it stays put while you scroll across techs; the
// whole thing scrolls vertically through the 9 AM–8 PM day. Tablet-only —
// the phone keeps the single-column DayTimelineView.
const GRID_HEADER_H = 42;
const GRID_COL_W    = 156;

function DayGridView({ appts, allTechs, clientsById, date, timeOff, onDeleteBlock, refreshing, onRefresh, onTapAppt, onTapEmpty, onReschedule }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width: screenW } = useResponsive();
  const [moving, setMoving] = useState(null);   // appt picked up to reschedule
  const GRID_H = SLOT_COUNT * SLOT_PX;
  // Show every active tech as a column; fall back to whoever has appts.
  const baseTechs = (allTechs && allTechs.length)
    ? allTechs
    : Array.from(new Set(appts.map(a => a.techName).filter(Boolean)));
  // Append a "No preference" column ('') whenever any appt is unassigned (a
  // staff-created no-preference booking, techRequestType 'auto') so it stays
  // visible — drag it onto a tech column to assign. Without this it'd vanish.
  const hasUnassigned = appts.some(a => !(a.techName || '').trim());
  const techs = hasUnassigned ? [...baseTechs, ''] : baseTechs;
  // Column width adapts to how many techs are shown so filtering down (via the
  // chips above) fills the screen — 1–2 techs span the full width so gaps read
  // clearly; more techs fall back to a fixed width and scroll horizontally.
  const AXIS_W = 52;
  const avail  = Math.max(0, screenW - AXIS_W);
  const fit    = techs.length > 0 ? Math.floor(avail / techs.length) : GRID_COL_W;
  const colW   = fit >= 132 ? Math.min(fit, 240) : GRID_COL_W;

  // Per-tech occupancy: which slot each appt starts in, and which slots
  // it covers (so we don't draw a "+" under a booked block).
  const byTech = useMemo(() => {
    const m = {};
    techs.forEach(t => { m[t] = { starts: {}, covered: {} }; });
    appts.forEach(a => {
      const t = a.techName || '';
      if (!m[t]) return;
      const startMin = hhmmToMin(a.startTime);
      if (startMin < DAY_START_MIN || startMin >= DAY_END_MIN) return;
      const startIdx = Math.floor((startMin - DAY_START_MIN) / SLOT_MINUTES);
      const span = Math.max(1, Math.ceil((Number(a.duration) || 30) / SLOT_MINUTES));
      m[t].starts[startIdx] = a;
      for (let k = 0; k < span && startIdx + k < SLOT_COUNT; k++) m[t].covered[startIdx + k] = true;
    });
    return m;
  }, [appts, techs.join('|')]);

  return (
   <View style={{ flex: 1 }}>
    {moving && (
      <View style={styles.moveBanner}>
        <Text style={styles.moveBannerText} numberOfLines={1}>Moving {moving.clientName || 'Walk-in'} — tap a new slot</Text>
        <TouchableOpacity onPress={() => setMoving(null)} style={styles.moveCancel}><Text style={styles.moveCancelText}>✕ Cancel</Text></TouchableOpacity>
      </View>
    )}
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.surface }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.blue} />}
    >
      <View style={{ flexDirection: 'row' }}>
        {/* Fixed time axis */}
        <View style={{ width: 52 }}>
          <View style={{ height: GRID_HEADER_H }} />
          <View style={{ height: GRID_H }}>
            {Array.from({ length: SLOT_COUNT }).map((_, idx) => {
              const slotMin = DAY_START_MIN + idx * SLOT_MINUTES;
              if (slotMin % 60 !== 0) return null;
              return (
                <Text key={idx} style={[styles.gridTimeLabel, { top: idx * SLOT_PX - 7 }]}>
                  {fmtTime(minToHHMM(slotMin))}
                </Text>
              );
            })}
          </View>
        </View>

        {/* Horizontally-scrollable tech columns */}
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={{ flexDirection: 'row', height: GRID_HEADER_H }}>
              {techs.map(t => (
                <View key={t || 'none'} style={[styles.gridHeadCell, { width: colW }]}>
                  <View style={[styles.gridHeadDot, { backgroundColor: t ? getTechColor(t, allTechs).solid : theme.textMuted }]} />
                  <Text style={styles.gridHeadText} numberOfLines={1}>{t || 'No preference'}</Text>
                </View>
              ))}
            </View>

            <View style={{ flexDirection: 'row', height: GRID_H }}>
              {techs.map(t => {
                const occ = byTech[t] || { starts: {}, covered: {} };
                return (
                  <View key={t || 'none'} style={[styles.gridCol, { width: colW, height: GRID_H }]}>
                    {/* Gridlines + "+" hints are non-interactive Views (cheap).
                        A SINGLE tap layer per column handles empty-slot taps via
                        the touch's locationY — instead of one TouchableOpacity
                        per 30-min slot, which mounted ~220 gesture responders on
                        a 10-tech phone view and made the schedule lag. */}
                    {Array.from({ length: SLOT_COUNT }).map((_, idx) => {
                      const isHour = (DAY_START_MIN + idx * SLOT_MINUTES) % 60 === 0;
                      return (
                        <View key={idx} pointerEvents="none"
                          style={[styles.gridSlot, { top: idx * SLOT_PX, height: SLOT_PX, width: colW }, isHour && styles.gridSlotHour]}>
                          {!occ.covered[idx] && <Text style={styles.gridPlus}>＋</Text>}
                        </View>
                      );
                    })}
                    <TouchableOpacity
                      activeOpacity={0.6}
                      style={[styles.gridTapLayer, { width: colW, height: GRID_H }]}
                      onPress={(e) => {
                        const idx = Math.floor((e.nativeEvent.locationY || 0) / SLOT_PX);
                        if (idx < 0 || idx >= SLOT_COUNT || occ.covered[idx]) return;
                        onTapEmpty(minToHHMM(DAY_START_MIN + idx * SLOT_MINUTES), t);
                      }}
                    />
                    {Object.entries(occ.starts).map(([idxStr, a]) => {
                      const idx  = Number(idxStr);
                      const span = Math.max(1, Math.ceil((Number(a.duration) || 30) / SLOT_MINUTES));
                      const c    = colorsForAppt(a, allTechs, theme);
                      return (
                        <TouchableOpacity
                          key={a.id}
                          activeOpacity={0.75}
                          onPress={() => onTapAppt(a)}
                          onLongPress={() => { if (onReschedule) setMoving(a); }}
                          delayLongPress={300}
                          style={[styles.gridBlock, {
                            top: idx * SLOT_PX + 2,
                            height: span * SLOT_PX - 4,
                            width: colW - 7,
                            backgroundColor: c.bg,
                            borderLeftColor: c.border,
                            opacity: moving?.id === a.id ? 0.4 : (c.faded ? 0.7 : 1),
                          }, moving?.id === a.id && styles.gridBlockMoving]}
                        >
                          <Text style={[styles.gridBlockClient, { color: c.text }]} numberOfLines={1}>
                            {a.techRequestType === 'specific' && <Text style={styles.requestStar}>★ </Text>}
                            {!!clientsById?.[a.clientId]?.allergies && <Text style={styles.allergyWarn}>⚠ </Text>}
                            {a.clientName || 'Walk-in'}
                          </Text>
                          <Text style={[styles.gridBlockMeta, { color: c.text }]} numberOfLines={span > 1 ? 2 : 1}>
                            {(a.services || []).map(s => s.name).filter(Boolean).join(', ')}
                          </Text>
                          <Text style={[styles.gridBlockTime, { color: c.text }]}>{fmtTime(a.startTime)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                    {/* Personal block-outs (time-off) — tap to remove. */}
                    {!moving && dayBlocksFor(date, t, timeOff).map(b => (
                      <TouchableOpacity
                        key={b.id}
                        activeOpacity={0.7}
                        onPress={() => onDeleteBlock?.(b.entry)}
                        style={[styles.blockBand, {
                          top: ((b.startMin - DAY_START_MIN) / SLOT_MINUTES) * SLOT_PX + 2,
                          height: ((b.endMin - b.startMin) / SLOT_MINUTES) * SLOT_PX - 4,
                          width: colW - 7,
                        }]}
                      >
                        <Text style={styles.blockBandText} numberOfLines={2}>⛔ {b.reason}</Text>
                      </TouchableOpacity>
                    ))}
                    {/* While moving an appt, one full-column drop layer (on top)
                        turns any tap into a reschedule at that slot — slot from
                        locationY, not 22 per-slot targets. */}
                    {moving && (
                      <TouchableOpacity
                        activeOpacity={0.4}
                        style={[styles.gridDrop, { top: 0, height: GRID_H, width: colW }]}
                        onPress={(e) => {
                          const didx = Math.floor((e.nativeEvent.locationY || 0) / SLOT_PX);
                          if (didx < 0 || didx >= SLOT_COUNT) return;
                          onReschedule(moving, { startTime: minToHHMM(DAY_START_MIN + didx * SLOT_MINUTES), techName: t });
                          setMoving(null);
                        }}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </View>
    </ScrollView>
   </View>
  );
}

// ── Week view ──────────────────────────────────────────
// 7-day strip — each day is a tappable column showing appt blocks
// stacked vertically (no time grid; just the count + service summary).
// Tapping an empty area on a day prefills create modal at the next
// open hour, tap a block opens the detail modal.
const WEEK_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function WeekView({ date, techName, showAll, allTechs, clientsById, workDays, timeOff, onTapAppt, onTapEmpty, onPickDay }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { contentMaxWidth } = useResponsive();
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
          ? list.filter(a => !allTechs || allTechs.includes(a.techName || ''))
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
  }, [startIso, endIso, techName, showAll, (allTechs || []).join('|')]);

  const today = todayStr();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 8, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
      {loading && <ActivityIndicator style={{ marginTop: 12 }} color={theme.blue} />}
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
                    const c = colorsForAppt(a, allTechs, theme);
                    return (
                      <TouchableOpacity
                        key={row.key}
                        style={[styles.weekApptBlock, { backgroundColor: c.bg, borderLeftColor: c.border, opacity: c.faded ? 0.65 : 1 }]}
                        onPress={() => onTapAppt(a)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.weekApptTime, { color: c.border }]}>{fmtTime(a.startTime)}</Text>
                        <View style={{ flex: 1, marginLeft: 8 }}>
                          <Text style={[styles.weekApptClient, { color: c.text }]} numberOfLines={1}>
                            {a.techRequestType === 'specific' && (
                              <Text style={styles.requestStar}>★ </Text>
                            )}
                            {!!clientsById?.[a.clientId]?.allergies && (
                              <Text style={styles.allergyWarn}>⚠ </Text>
                            )}
                            {a.clientName || 'Walk-in'}
                          </Text>
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
function CreateApptModal({ prefill, editAppt, gateBlocked, onClose, onCreated }) {
  // CRITICAL: every hook below runs on every render regardless of
  // open state. Conditional rendering is INSIDE the JSX, never via
  // an early return between hook calls.
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { techName: myStaffName } = useCurrentEmployee();
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [pickedClient, setPickedClient] = useState(null);
  const [clientQuery, setClientQuery] = useState('');
  const [pickedServices, setPickedServices] = useState([]);
  // Which tech the appt is assigned to. '' = no preference (techRequestType
  // 'auto', same as an online "any available" booking). Seeded from the
  // column/slot the user tapped, but now editable here.
  const [pickedTech, setPickedTech] = useState('');
  // Editable start time — seeded from the tapped slot but changeable here, in
  // both create and edit. `endStr` is the block-out end time (appointments use
  // the service durations instead).
  const [startStr, setStartStr] = useState('');
  const [endStr,   setEndStr]   = useState('');
  // 'appt' = book a client; 'block' = a personal block-out (a per-tech timeOff
  // entry, so the booking conflict checks honor it). Create mode only.
  const [apptType, setApptType] = useState('appt');
  const [blockReason, setBlockReason] = useState('');
  const [repeat, setRepeat]         = useState('none');   // none | weekly | biweekly | monthly
  const [repeatCount, setRepeatCount] = useState('4');
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
    Promise.all([fetchClients(), fetchServices(), fetchEmployees()])
      .then(([cs, svc, emps]) => {
        setClients(cs || []);
        setServices(svc || []);
        setEmployees(emps || []);
      })
      .catch(() => { setClients([]); setServices([]); setEmployees([]); })
      .finally(() => setLoading(false));
    setNewClientOpen(false);
    setNewClientName('');
    setNewClientPhone('');
    setRepeat('none');
    setRepeatCount('4');
    setApptType('appt');
    setBlockReason('');
    if (isEdit) {
      setPickedClient(editAppt.clientId
        ? { id: editAppt.clientId, name: editAppt.clientName || '' }
        : null);
      setPickedServices((editAppt.services || []).map(s => ({
        id: s.id, name: s.name, duration: Number(s.duration) || 30, price: Number(s.price) || 0,
        ...(s.addOnOf ? { addOnOf: s.addOnOf } : {}),
      })));
      setStartStr(editAppt.startTime || '');
      setEndStr('');
      setPickedTech(editAppt.techName || '');
    } else {
      setPickedClient(null);
      setPickedServices([]);
      setStartStr(prefill?.startTime || '');
      // Default a block-out to one hour from the tapped slot.
      setEndStr(prefill?.startTime ? minToHHMM(Math.min(DAY_END_MIN, hhmmToMin(prefill.startTime) + 60)) : '');
      setPickedTech(prefill?.techName || '');
    }
    setClientQuery('');
  }, [prefill?.date, prefill?.startTime, editAppt?.id]);

  const totalDuration = pickedServices.reduce((s, sv) => s + (Number(sv.duration) || 30), 0) || 30;

  // Surface the services THIS tech performs first (employee.serviceIds, same
  // field the web edits). Soft sort + a ★ marker — never hides a service, so
  // an off-menu booking is still possible. Follows the picked tech so the
  // ★ services + per-tech pricing update when the assignment changes.
  const apptTechName = pickedTech || '';
  const apptTech = useMemo(
    () => employees.find(e => (e.name || '') === apptTechName) || null,
    [employees, apptTechName],
  );
  const assignedIds = useMemo(
    () => new Set(Array.isArray(apptTech?.serviceIds) ? apptTech.serviceIds : []),
    [apptTech],
  );
  const sortedServices = useMemo(() => {
    if (assignedIds.size === 0) return services;
    const yes = [], no = [];
    services.forEach(s => (assignedIds.has(s.id) ? yes : no).push(s));
    return [...yes, ...no];
  }, [services, assignedIds]);
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
    const { price, duration } = resolveTechSvc(svc, apptTech);
    setPickedServices(prev => {
      const isBaseOn = prev.some(s => s.id === svc.id && !s.addOnOf);
      // Removing a base also drops any add-ons attached to it.
      if (isBaseOn) return prev.filter(s => !(s.id === svc.id && !s.addOnOf) && s.addOnOf !== svc.id);
      return [...prev, { id: svc.id, name: svc.name, duration, price }];
    });
  }

  // Toggle an add-on (a reference to another catalog service) for a base. Adds
  // / removes a separate line tagged addOnOf:<base id> that stacks its own
  // price + time. Mirrors the web booking + staff-schedule add-on path.
  function toggleAddOn(base, addOnSvc) {
    const isOn = pickedServices.some(s => s.addOnOf === base.id && (s.id === addOnSvc.id || s.name === addOnSvc.name));
    if (isOn) {
      setPickedServices(prev => prev.filter(s => !(s.addOnOf === base.id && (s.id === addOnSvc.id || s.name === addOnSvc.name))));
      return;
    }
    const { price, duration } = resolveTechSvc(addOnSvc, apptTech);
    setPickedServices(prev => [...prev, { id: addOnSvc.id, name: addOnSvc.name, duration, price, addOnOf: base.id }]);
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
    const isBlock = !isEdit && apptType === 'block';
    const validTime = (s) => /^\d{1,2}:\d{2}$/.test(s);
    if (isBlock) {
      if (!pickedTech) {
        Alert.alert('Pick a tech', 'A block-out applies to one tech’s calendar — choose whose time to block off.');
        return;
      }
      if (!validTime(startStr) || !validTime(endStr)) {
        Alert.alert('Times not valid', 'Use 24-hour HH:MM (e.g. 12:00 and 13:00).');
        return;
      }
      if (hhmmToMin(endStr) <= hhmmToMin(startStr)) {
        Alert.alert('End before start', 'The block-out’s end time must be after its start time.');
        return;
      }
    } else {
      if (!pickedClient?.id) {
        Alert.alert('Pick a client', 'Choose an existing client or tap “＋ New client” to add one. Every appointment needs a real client record.');
        return;
      }
      if (pickedServices.length === 0) {
        Alert.alert('Add at least one service', 'Pick the service(s) the client is booking.');
        return;
      }
      if (!validTime(startStr)) {
        Alert.alert('Start time not valid', 'Use 24-hour HH:MM format (e.g. 14:30).');
        return;
      }
    }
    if (gateBlocked && gateBlocked()) return;
    setWorking(true);
    try {
      if (isBlock) {
        // A personal block-out is a partial-day timeOff entry for this tech, so
        // the same booking-conflict checks that honor vacation/sick also keep
        // this slot from being double-booked.
        await createTimeOff({
          techName:  pickedTech,
          startDate: prefill.date,
          endDate:   prefill.date,
          allDay:    false,
          startTime: startStr,
          endTime:   endStr,
          reason:    blockReason.trim() || 'Personal',
          type:      blockReason.trim() || 'Personal',
        });
      } else if (isEdit) {
        const patch = {
          startTime: startStr,
          clientId:  pickedClient.id,
          clientName: pickedClient.name,
          services:  pickedServices,
          duration:  totalDuration,
          techName:  pickedTech,
          // '' (no preference) = auto-assign, mirroring online bookings; an
          // explicit tech is a scheduler assignment. Don't clobber a client's
          // own 'specific' request when the tech is left unchanged.
          techRequestType: pickedTech
            ? (editAppt.techName === pickedTech ? (editAppt.techRequestType || 'scheduler') : 'scheduler')
            : 'auto',
        };
        await updateAppointment(editAppt.id, patch);
        notifyAffectedTechs(editAppt, { ...editAppt, ...patch }).catch(() => {});
      } else {
        // Recurring series: create N appts stepped by the chosen interval,
        // linked by a shared recurringGroupId.
        const stepDate = (iso, mode) => {
          const dt = new Date(iso + 'T12:00:00');
          if (mode === 'weekly')   dt.setDate(dt.getDate() + 7);
          if (mode === 'biweekly') dt.setDate(dt.getDate() + 14);
          if (mode === 'monthly')  dt.setMonth(dt.getMonth() + 1);
          return dt.toISOString().slice(0, 10);
        };
        const count   = repeat === 'none' ? 1 : Math.max(1, Math.min(52, Number(repeatCount) || 1));
        const groupId = repeat === 'none' ? null : `rec_${count}_${pickedClient.id}_${prefill.date}_${startStr}`;
        let d = prefill.date;
        for (let i = 0; i < count; i++) {
          await createAppointment({
            date:      d,
            startTime: startStr,
            techName:  pickedTech,
            clientId:  pickedClient.id,
            clientName: pickedClient.name,
            services:  pickedServices,
            duration:  totalDuration,
            status:    'scheduled',
            notes:     '',
            // '' (no preference) → 'auto' (assign later / any available), same
            // as an online booking with no stylist picked.
            techRequestType: pickedTech ? 'scheduler' : 'auto',
            // Records who entered the booking — shown as "Staff · Name" in
            // Reports (parity with web ScheduleAdmin).
            bookedByName: myStaffName || auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || null,
            ...(groupId ? { recurringGroupId: groupId, recurring: true } : {}),
          });
          d = stepDate(d, repeat);
        }
        notifyAffectedTechs(null, { date: prefill.date, startTime: startStr, techName: pickedTech, clientName: pickedClient.name }).catch(() => {});
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
                  return `${new Date(ctx.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTime(startStr || ctx.startTime)}${apptType === 'block' ? `–${fmtTime(endStr)} · Block-out` : ` · ${pickedTech || 'No preference'}`}`;
                })()}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: 30 }} color={theme.blue} />
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
              {!isEdit && (
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {[['appt', '📅 Appointment'], ['block', '⛔ Block-out time']].map(([id, lbl]) => (
                    <TouchableOpacity key={id} onPress={() => setApptType(id)} style={[styles.typeTab, apptType === id && styles.typeTabOn]}>
                      <Text style={[styles.typeTabText, apptType === id && styles.typeTabTextOn]}>{lbl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Editable start (and, for a block-out, end) time — changeable
                  even though it was seeded from the tapped slot. */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionLabel}>Start (24-hour)</Text>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="14:30" placeholderTextColor={theme.placeholder}
                    value={startStr} onChangeText={setStartStr}
                    keyboardType="numbers-and-punctuation" maxLength={5}
                  />
                </View>
                {apptType === 'block' && (
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionLabel}>End (24-hour)</Text>
                    <TextInput
                      style={styles.searchInput}
                      placeholder="15:30" placeholderTextColor={theme.placeholder}
                      value={endStr} onChangeText={setEndStr}
                      keyboardType="numbers-and-punctuation" maxLength={5}
                    />
                  </View>
                )}
              </View>

              {apptType === 'block' && (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Reason (optional)</Text>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Lunch, appointment, personal…"
                    placeholderTextColor={theme.placeholder}
                    value={blockReason} onChangeText={setBlockReason}
                  />
                </>
              )}

              {apptType === 'appt' && (<>
              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Client</Text>
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
                    placeholderTextColor={theme.placeholder}
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
                          placeholderTextColor={theme.placeholder}
                          value={newClientName}
                          onChangeText={setNewClientName}
                          autoFocus
                        />
                        <TextInput
                          style={styles.newClientInput}
                          placeholder="Phone *  US: (614) 555-0123  ·  Intl: +44 20 7946 0958"
                          placeholderTextColor={theme.placeholder}
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
              </>)}

              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>{apptType === 'block' ? 'Tech to block off' : 'Tech'}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0 }}
                contentContainerStyle={{ gap: 8, paddingVertical: 2, paddingRight: 12 }}
                keyboardShouldPersistTaps="handled"
              >
                {apptType === 'appt' && (
                  <TouchableOpacity
                    onPress={() => setPickedTech('')}
                    style={[styles.chip, !pickedTech ? styles.chipBlue : styles.chipMuted]}
                  >
                    <Text style={!pickedTech ? styles.chipBlueText : styles.chipMutedText}>No preference</Text>
                  </TouchableOpacity>
                )}
                {employees.filter(e => e.name).map(e => {
                  const on = pickedTech === e.name;
                  return (
                    <TouchableOpacity
                      key={e.id || e.name}
                      onPress={() => setPickedTech(e.name)}
                      style={[styles.chip, on ? styles.chipBlue : styles.chipMuted, { flexDirection: 'row', alignItems: 'center', gap: 7 }]}
                    >
                      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: getTechColor(e.name, employees.map(x => x.name)).solid }} />
                      <Text style={on ? styles.chipBlueText : styles.chipMutedText} numberOfLines={1}>{e.name}{e.name === myStaffName ? ' (me)' : ''}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {apptType === 'appt' && (<>
              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>
                Services ({pickedServices.length} · {totalDuration} min)
              </Text>
              <ScrollView
                style={styles.serviceGridScroll}
                contentContainerStyle={styles.serviceGrid}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {sortedServices.flatMap(svc => {
                  const active = pickedServices.some(s => s.id === svc.id && !s.addOnOf);
                  const performs = assignedIds.has(svc.id);
                  const eff = resolveTechSvc(svc, apptTech);
                  const chips = [
                    <TouchableOpacity
                      key={svc.id}
                      onPress={() => toggleService(svc)}
                      style={[styles.serviceChip, active && styles.serviceChipActive]}
                    >
                      <Text style={[styles.serviceChipName, active && styles.serviceChipNameActive]}>
                        {performs ? '★ ' : ''}{svc.name}
                      </Text>
                      <Text style={[styles.serviceChipMeta, active && styles.serviceChipMetaActive]}>
                        {eff.duration}m · ${eff.price}
                      </Text>
                    </TouchableOpacity>,
                  ];
                  // Add-on sub-chips appear right after their base once it's selected.
                  if (active && (svc.addOnServiceIds || []).length) {
                    (svc.addOnServiceIds || [])
                      .map(id => services.find(s => s.id === id))
                      .filter(a => a && a.active !== false)
                      .forEach(a => {
                        const on = pickedServices.some(s => s.addOnOf === svc.id && (s.id === a.id || s.name === a.name));
                        const r = resolveTechSvc(a, apptTech);
                        chips.push(
                          <TouchableOpacity
                            key={`${svc.id}__addon__${a.id}`}
                            onPress={() => toggleAddOn(svc, a)}
                            style={[styles.serviceChip, { borderStyle: 'dashed' }, on && styles.serviceChipActive]}
                          >
                            <Text style={[styles.serviceChipName, on && styles.serviceChipNameActive]}>＋ {a.name}</Text>
                            <Text style={[styles.serviceChipMeta, on && styles.serviceChipMetaActive]}>+{r.duration}m · ${r.price}</Text>
                          </TouchableOpacity>
                        );
                      });
                  }
                  return chips;
                })}
              </ScrollView>

              {!isEdit && (
                <View style={{ marginTop: 18 }}>
                  <Text style={styles.repeatLabel}>Repeat</Text>
                  <View style={styles.repeatRow}>
                    {[['none', 'Once'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 wks'], ['monthly', 'Monthly']].map(([id, lbl]) => (
                      <TouchableOpacity key={id} onPress={() => setRepeat(id)} style={[styles.repeatChip, repeat === id && styles.repeatChipOn]}>
                        <Text style={[styles.repeatChipText, repeat === id && styles.repeatChipTextOn]}>{lbl}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {repeat !== 'none' && (
                    <View style={styles.repeatCountRow}>
                      <Text style={styles.repeatCountLabel}>Occurrences</Text>
                      <TextInput style={styles.repeatCountInput} value={repeatCount} onChangeText={setRepeatCount} keyboardType="number-pad" />
                    </View>
                  )}
                </View>
              )}
              </>)}

              <TouchableOpacity
                style={[styles.primaryBtn, (working || (apptType === 'appt' && pickedServices.length === 0)) && { opacity: 0.5 }, { marginTop: 22 }]}
                onPress={save}
                disabled={working || (apptType === 'appt' && pickedServices.length === 0)}
              >
                <Text style={styles.primaryBtnText}>
                  {working
                    ? (isEdit ? 'Saving…' : (apptType === 'block' ? 'Blocking…' : 'Creating…'))
                    : (isEdit ? `Save changes (${totalDuration} min)`
                        : (apptType === 'block' ? 'Block out this time' : `Create appointment (${totalDuration} min)`))}
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

function MonthView({ date, techName, showAll, allTechs, onPickDay }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { contentMaxWidth } = useResponsive();
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
          ? list.filter(a => !allTechs || allTechs.includes(a.techName || ''))
          : list.filter(a => (a.techName || '') === techName);
        const map = {};
        filtered.forEach(a => { if (a.date) map[a.date] = (map[a.date] || 0) + 1; });
        setByDay(map);
      })
      .catch(() => { if (!cancelled) setByDay({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [monthStartIso, monthEndIso, techName, showAll, (allTechs || []).join('|')]);

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
    <ScrollView style={styles.monthScroll} contentContainerStyle={{ paddingBottom: 20, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
      <View style={styles.monthWeekdayRow}>
        {WEEKDAY_LABELS.map((w, i) => (
          <Text key={i} style={styles.monthWeekdayLabel}>{w}</Text>
        ))}
      </View>
      {loading && <ActivityIndicator style={{ marginTop: 20 }} color={theme.blue} />}
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
function TabModal({ open, tab, onClose, onCheckout }) {
  const styles = useThemedStyles(makeStyles);
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
                  style={[styles.primaryBtn, { marginTop: 18 }]}
                  activeOpacity={0.85}
                  onPress={() => onCheckout?.()}
                >
                  <Text style={styles.primaryBtnText}>Check out · ${total.toFixed(2)}</Text>
                </TouchableOpacity>

                <Text style={styles.tabFootnote}>
                  Check out to apply any discounts, promo or gift card — then you can take
                  payment yourself or "Send to front desk" so the client tips + pays at the kiosk.
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
function ApptDetailModal({ appt, cartTab, canDelete, onClose, onUpdate, onEdit, onAddToTab, onDelete, onDeleteSeries, onRefund }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
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

  function confirmDelete() {
    if (working) return;
    const who = `${appt.clientName || 'This appointment'}${appt.startTime ? ` at ${fmtTime(appt.startTime)}` : ''}`;
    const restoreNote = 'An admin can restore from the web Trash within 30 days.';
    const runDelete = (fn) => async () => {
      setWorking(true);
      try { await fn?.(appt); }
      catch (e) { Alert.alert('Couldn\'t delete', e?.message || 'Please try again.'); setWorking(false); }
    };

    // Recurring appointment → offer this-one vs the whole upcoming series.
    if (appt.recurringGroupId) {
      Alert.alert(
        'Delete recurring appointment',
        `${who} is part of a repeating series. ${restoreNote}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'This one only', style: 'destructive', onPress: runDelete(onDelete) },
          { text: 'This & all upcoming', style: 'destructive', onPress: runDelete(onDeleteSeries) },
        ],
      );
      return;
    }

    Alert.alert(
      'Delete appointment?',
      `${who} will be removed. ${restoreNote}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: runDelete(onDelete) },
      ],
    );
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
                {appt.techRequestType === 'specific' && (
                  <Text style={styles.requestStar}>★ </Text>
                )}
                {appt.clientName || 'Walk-in'}
              </Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {fmtTime(appt.startTime)}{appt.duration ? ` · ${appt.duration} min` : ''}
                {services ? ` · ${services}` : ''}
              </Text>
              {appt.techRequestType === 'specific' && (
                <View style={styles.requestBadge}>
                  <Text style={styles.requestBadgeText}>★ Client requested this tech</Text>
                </View>
              )}
              {!!appt.recurringGroupId && (
                <View style={styles.repeatBadge}>
                  <Text style={styles.repeatBadgeText}>🔁 Repeating appointment</Text>
                </View>
              )}
              {!!client?.allergies && (
                <View style={styles.allergyBadge}>
                  <Text style={styles.allergyBadgeText}>⚠ Allergies: {client.allergies}</Text>
                </View>
              )}
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
            {canDelete && (
              <TouchableOpacity onPress={confirmDelete} disabled={working} style={styles.modalDeleteBtn}>
                <Icon name="trash" size={16} color={theme.danger} />
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
                  {Object.entries(statusMeta(theme)).map(([id, meta]) => {
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

                {/* Refund — done sales only */}
                {appt.status === 'done' && appt.payment && (
                  appt.refund ? (
                    <View style={styles.refundedPill}>
                      <Text style={styles.refundedText}>↩ Refunded ${(Number(appt.refund.amount) || 0).toFixed(2)}{appt.refund.reason ? ` · ${appt.refund.reason}` : ''}</Text>
                    </View>
                  ) : canDelete ? (
                    <TouchableOpacity style={styles.refundBtn} onPress={() => onRefund?.(appt)} activeOpacity={0.85}>
                      <Text style={styles.refundBtnText}>↩ Refund this sale</Text>
                    </TouchableOpacity>
                  ) : null
                )}

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
                  placeholderTextColor={theme.placeholder}
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

const makeStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  dateRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.surface,
    paddingVertical: 12, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  navBtn: { width: 56, height: 48, alignItems: 'center', justifyContent: 'center' },
  navBtnText: { fontSize: 32, color: t.blue, lineHeight: 36, fontWeight: '300' },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateText: { fontSize: 14, fontWeight: '700', color: t.text },
  apptCount: { fontSize: 11, color: t.textMuted, marginTop: 2 },
  toggleRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border,
    alignItems: 'center', flexWrap: 'wrap',
  },
  // Tap targets bumped to ≥44pt (Apple HIG) — techs with long nails
  // were missing the 12pt-padded chips. minHeight is the key win;
  // fontSize bumps for legibility too.
  chip: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, borderRadius: 22, borderWidth: 1, justifyContent: 'center' },
  chipBlue: { backgroundColor: t.blueSoft, borderColor: t.blue },
  chipBlueText: { color: t.blue, fontSize: 14, fontWeight: '600' },
  chipMuted: { backgroundColor: t.surface, borderColor: t.borderStrong },
  chipMutedText: { color: t.textMuted, fontSize: 14, fontWeight: '500' },
  chipGreen: { backgroundColor: t.greenSoft, borderColor: t.green },
  chipGreenText: { color: t.green, fontSize: 14, fontWeight: '600' },

  viewSwitch:           { flexDirection: 'row', backgroundColor: t.surfaceMuted, borderRadius: 10, padding: 3, marginRight: 4 },
  viewSwitchBtn:        { paddingHorizontal: 16, paddingVertical: 10, minHeight: 38, minWidth: 60, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  viewSwitchBtnActive:  { backgroundColor: t.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.10, shadowRadius: 2, elevation: 2 },
  viewSwitchText:       { fontSize: 14, color: t.textMuted, fontWeight: '500' },
  viewSwitchTextActive: { color: t.text, fontWeight: '700' },

  // Tech filter modal rows
  techFilterRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 14, minHeight: 52,
    borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: t.border,
    backgroundColor: t.surface,
  },
  techFilterRowActive: { backgroundColor: t.blueSoft, borderColor: t.blue },
  techFilterLabel: { fontSize: 15, fontWeight: '600', color: t.text },
  techFilterCheck: { fontSize: 18, fontWeight: '700', color: t.blue },
  techFilterDivider: { height: 1, backgroundColor: t.border, marginVertical: 10 },
  techFilterBox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: t.borderStrong,
    alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface,
  },
  techFilterBoxChecked: { backgroundColor: t.blue, borderColor: t.blue },
  techFilterBoxCheck: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Day timeline
  dayTimelineRow:     { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: t.border },
  dayTimelineRowOff:  { backgroundColor: t.surfaceAlt },  // out-of-hours rows are visually muted
  dayTimelineRowDrop: { backgroundColor: t.blueSoft },    // while moving, rows are drop targets
  dayTimeLabel:       { width: 56, paddingLeft: 8, paddingTop: 2 },
  dayTimeLabelText:   { fontSize: 11, color: t.textMuted, fontWeight: '600' },
  dayTimelineSlot:    { flex: 1, paddingVertical: 2, paddingRight: 8, justifyContent: 'flex-start', alignItems: 'stretch' },
  dayTimelineSlotHour:{ borderTopWidth: 0.5, borderTopColor: t.borderStrong },
  dayApptBlock:       { backgroundColor: t.blueSoft, borderLeftWidth: 3, borderLeftColor: t.blue, borderRadius: 6, padding: 8, justifyContent: 'center' },
  dayApptClient:      { fontSize: 13, fontWeight: '700', color: t.text },
  dayApptMeta:        { fontSize: 11, color: t.textMuted, marginTop: 2 },
  dayEmptyHint:       { fontSize: 22, color: t.textMuted, textAlign: 'center', lineHeight: 26, fontWeight: '800' },
  gridTimeLabel:      { position: 'absolute', right: 6, fontSize: 11, color: t.textMuted, fontWeight: '600' },
  gridHeadCell:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: t.border, borderLeftWidth: 1, borderLeftColor: t.border, backgroundColor: t.surfaceAlt },
  gridHeadDot:        { width: 8, height: 8, borderRadius: 4 },
  gridHeadText:       { fontSize: 12.5, fontWeight: '800', color: t.text, flexShrink: 1 },
  gridCol:            { borderLeftWidth: 1, borderLeftColor: t.border },
  gridSlot:           { position: 'absolute', left: 0, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: t.border },
  gridTapLayer:       { position: 'absolute', top: 0, left: 0 },
  gridSlotHour:       { borderBottomColor: t.borderStrong },
  gridPlus:           { fontSize: 30, color: t.textMuted, fontWeight: '400' },
  gridBlock:          { position: 'absolute', left: 3, borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 5, overflow: 'hidden' },
  gridBlockClient:    { fontSize: 12.5, fontWeight: '800' },
  gridBlockMeta:      { fontSize: 10.5, marginTop: 1, opacity: 0.8 },
  gridBlockTime:      { fontSize: 10, marginTop: 2, opacity: 0.7, fontWeight: '600' },
  gridBlockMoving:    { borderWidth: 2, borderColor: t.blue, borderStyle: 'dashed' },
  gridDrop:           { position: 'absolute', left: 0, borderWidth: 1, borderColor: t.blue, borderStyle: 'dashed', backgroundColor: t.blueSoft, opacity: 0.5 },
  moveBanner:         { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.blue, paddingHorizontal: 14, paddingVertical: 10 },
  moveBannerText:     { flex: 1, color: '#fff', fontWeight: '800', fontSize: 14 },
  moveCancel:         { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  moveCancelText:     { color: '#fff', fontWeight: '800', fontSize: 13 },
  dayOffState:        { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 60, paddingHorizontal: 32, backgroundColor: t.surface },
  dayOffEmoji:        { fontSize: 56, marginBottom: 12 },
  dayOffTitle:        { fontSize: 18, fontWeight: '700', color: t.text, marginBottom: 8, textAlign: 'center' },
  dayOffBody:         { fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 19 },

  // Week strip
  weekDayCard:        { backgroundColor: t.surface, borderRadius: 12, marginBottom: 8, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  weekDayCardToday:   { borderWidth: 1.5, borderColor: t.blue },
  weekDayHeader:      { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: t.surfaceAlt, borderBottomWidth: 1, borderBottomColor: t.border },
  weekDayDow:         { fontSize: 12, fontWeight: '700', color: t.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' },
  weekDayDowToday:    { color: t.blue },
  weekDayNum:         { fontSize: 20, fontWeight: '700', color: t.text },
  weekDayNumToday:    { color: t.blue },
  weekDayCount:       { fontSize: 11, color: t.textFaint, marginLeft: 'auto' },
  weekDayEmpty:       { padding: 14, alignItems: 'center', borderRadius: 8, backgroundColor: t.surfaceAlt, marginHorizontal: 8, marginBottom: 8, marginTop: 8 },
  weekDayEmptyText:   { fontSize: 12, color: t.textMuted, fontWeight: '500' },
  weekGapRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  weekGapLine:        { flex: 1, height: 1, backgroundColor: t.border },
  weekGapText:        { fontSize: 11, color: t.textMuted, fontWeight: '500' },
  weekDayOffPill:     { alignSelf: 'flex-start', marginHorizontal: 12, marginVertical: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: t.surfaceMuted, borderWidth: 1, borderColor: t.borderStrong },
  weekDayOffPillText: { fontSize: 11, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  weekApptBlock:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, backgroundColor: t.blueSoft, borderLeftWidth: 3, borderLeftColor: t.blue, borderRadius: 6, marginTop: 6 },
  weekApptTime:       { fontSize: 11, fontWeight: '700', color: t.blue, minWidth: 56 },
  weekApptClient:     { fontSize: 13, fontWeight: '600', color: t.text },
  weekApptMeta:       { fontSize: 11, color: t.textMuted, marginTop: 1 },

  // Create appt modal
  searchInput:        { backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.borderStrong, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: t.text },
  // Both inner lists are bounded ScrollViews so the user can scroll
  // through the full client + service catalog without the modal's
  // outer ScrollView interfering. nestedScrollEnabled is required for
  // Android; iOS handles nested scrolling natively.
  clientList:         { marginTop: 8, backgroundColor: t.surfaceAlt, borderRadius: 8, height: 240 },
  clientRow:          { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 0.5, borderBottomColor: t.border },
  clientRowNew:       { backgroundColor: t.greenSoft, borderBottomColor: t.green },
  clientRowNewText:   { fontSize: 14, color: t.green, fontWeight: '700' },
  clientRowName:      { fontSize: 14, color: t.text },
  clientRowMeta:      { fontSize: 11, color: t.textMuted, marginTop: 2 },
  newClientForm:      { padding: 12, backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border, gap: 8 },
  newClientLabel:     { fontSize: 11, fontWeight: '700', color: t.green, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  newClientInput:     { borderWidth: 1, borderColor: t.borderStrong, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: t.text, backgroundColor: t.surface },
  newClientBtn:       { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  newClientBtnPrimary:    { backgroundColor: t.green },
  newClientBtnPrimaryText:{ color: '#fff', fontWeight: '700', fontSize: 13 },
  newClientBtnGhost:      { backgroundColor: t.surfaceMuted, borderWidth: 1, borderColor: t.border },
  newClientBtnGhostText:  { color: t.textMuted, fontWeight: '600', fontSize: 13 },
  pickedChip:         { flexDirection: 'row', alignItems: 'center', backgroundColor: t.blueSoft, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, alignSelf: 'flex-start' },
  pickedChipText:     { fontSize: 13, color: t.blue, fontWeight: '600' },
  pickedChipX:        { fontSize: 18, color: t.blue, marginLeft: 8, lineHeight: 18 },
  serviceGridScroll:  { marginTop: 4, height: 220 },
  serviceGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 4 },
  serviceChip:        { borderWidth: 1, borderColor: t.borderStrong, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: t.surface, minWidth: '47%' },
  serviceChipActive:  { borderColor: t.blue, backgroundColor: t.blueSoft },
  serviceChipName:    { fontSize: 12, fontWeight: '600', color: t.text },
  serviceChipNameActive: { color: t.blue },
  serviceChipMeta:    { fontSize: 10, color: t.textMuted, marginTop: 2 },
  serviceChipMetaActive: { color: t.blue },

  monthScroll:        { flex: 1, backgroundColor: t.bg },
  monthWeekdayRow:    { flexDirection: 'row', backgroundColor: t.surface, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border },
  monthWeekdayLabel:  { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: t.textMuted, letterSpacing: 0.5 },
  monthGrid:          { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: t.surface },
  monthCell:          { width: `${100 / 7}%`, aspectRatio: 1, padding: 4, borderWidth: 0.5, borderColor: t.border, alignItems: 'center', justifyContent: 'flex-start' },
  monthCellToday:     { backgroundColor: t.blueSoft },
  monthCellDay:       { fontSize: 13, color: t.text, fontWeight: '500', marginTop: 2 },
  monthCellDayToday:  { color: t.blue, fontWeight: '700' },
  monthCellBadge:     { marginTop: 4, backgroundColor: t.blue, borderRadius: 9, minWidth: 18, paddingHorizontal: 5, paddingVertical: 1, alignItems: 'center' },
  monthCellBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },

  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: t.text, marginBottom: 6 },
  emptyBody: { fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 19 },

  apptCard: {
    backgroundColor: t.surface, borderRadius: 12, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  apptTime: { width: 56, alignItems: 'center' },
  apptTimeText: { fontSize: 12, fontWeight: '700', color: t.blue },
  apptDuration: { fontSize: 10, color: t.textFaint, marginTop: 2 },
  apptInfo: { flex: 1, minWidth: 0 },
  clientName: { fontSize: 14, fontWeight: '600', color: t.text },
  techService: { fontSize: 11, color: t.textMuted, marginTop: 2 },
  apptRight: { alignItems: 'flex-end', gap: 4 },
  checkedInBadge: { backgroundColor: t.greenSoft, borderRadius: 8, paddingVertical: 2, paddingHorizontal: 6 },
  checkedInText: { fontSize: 11, fontWeight: '700', color: t.success },
  statusPill: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  statusPillText: { fontSize: 10, fontWeight: '600' },

  // Modal
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: t.overlay },
  // Use height (not maxHeight) so the inner ScrollView's flex:1 has
  // bounded space to fill. Without this the sheet collapses to header
  // + tab row only because the ScrollView body resolves to 0px.
  modalSheet: { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '85%', paddingBottom: 20 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: t.text },
  modalSubtitle: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  modalClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceMuted },
  modalCloseText: { fontSize: 22, color: t.textMuted, lineHeight: 24 },
  modalEditBtn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: t.blueSoft, borderWidth: 1, borderColor: t.blue, marginRight: 8 },
  modalEditBtnText: { fontSize: 13, fontWeight: '700', color: t.blue },
  modalDeleteBtn:   { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.dangerBg, borderWidth: 1, borderColor: t.danger, marginRight: 8 },
  modalAvatar:         { width: 48, height: 48, borderRadius: 24 },
  modalAvatarFallback: { backgroundColor: t.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  modalAvatarInitial:  { fontSize: 20, fontWeight: '700', color: t.textMuted },
  modalSocialsRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  modalSocialChip:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.borderStrong },
  modalSocialChipText: { fontSize: 11, color: t.text, fontWeight: '600' },
  // Red ★ next to the client name on appt blocks + detail modal —
  // matches web ScheduleAdmin's "client requested this tech by name"
  // signal so the visual cue is consistent across surfaces.
  requestStar:        { color: t.danger, fontWeight: '700' },
  requestBadge:       { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: t.dangerBg, borderWidth: 1, borderColor: t.danger },
  requestBadgeText:   { fontSize: 11, color: t.danger, fontWeight: '700' },
  repeatBadge:        { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: t.blueSoft, borderWidth: 1, borderColor: t.blue },
  repeatBadgeText:    { fontSize: 11, color: t.blue, fontWeight: '700' },
  // Allergy ⚠ on appt blocks + a prominent red banner in the detail
  // modal. Same color family as requestBadge for visual consistency,
  // but the banner spans full-width to make sure the tech sees it
  // before they start the appointment.
  allergyWarn:        { color: t.warning, fontWeight: '700' },
  allergyBadge:       { alignSelf: 'stretch', marginTop: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: t.warningBg, borderWidth: 1, borderColor: t.warning },
  allergyBadgeText:   { fontSize: 12, color: t.warning, fontWeight: '700' },

  modalContactRow:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  modalPhoneText:      { fontSize: 12, color: t.text, fontWeight: '600', marginRight: 4 },
  modalContactBtn:     { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: t.blueSoft, borderWidth: 1, borderColor: t.blue },
  modalContactBtnText: { fontSize: 12, fontWeight: '700', color: t.blue },

  // Cart / tab pill in the date-row header
  cartBar:         { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.green, marginHorizontal: 12, marginTop: 8, marginBottom: 4, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  cartBadge:       { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  cartBadgeText:   { color: '#fff', fontWeight: '800', fontSize: 14 },
  cartBarText:     { flex: 1, color: '#fff', fontWeight: '800', fontSize: 16 },
  cartBarCta:      { color: '#fff', fontWeight: '800', fontSize: 15, opacity: 0.95 },

  // Add-to-tab button on detail modal
  tabAddBtn:           { backgroundColor: t.warningBg, borderWidth: 1.5, borderColor: t.warning, paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  tabAddBtnActive:     { backgroundColor: t.greenSoft, borderColor: t.green },
  tabAddBtnText:       { fontSize: 14, fontWeight: '700', color: t.warning },
  tabAddBtnTextActive: { color: t.success },

  // TabModal rows + summary (tabRow is also used for the Actions/Notes tab bar in ApptDetailModal)
  tabRow:            { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.border },
  tabRowClient:      { fontSize: 14, fontWeight: '700', color: t.text },
  tabRowMeta:        { fontSize: 11, color: t.textMuted, marginTop: 2 },
  tabRowPrice:       { fontSize: 14, fontWeight: '700', color: t.blue },
  tabRowRemove:      { width: 28, height: 28, borderRadius: 14, backgroundColor: t.dangerBg, alignItems: 'center', justifyContent: 'center' },
  tabRowRemoveText:  { fontSize: 18, color: t.danger, lineHeight: 20 },
  tabTotalRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, marginTop: 4, borderTopWidth: 2, borderTopColor: t.text },
  tabTotalLabel:     { fontSize: 15, fontWeight: '700', color: t.text },
  tabTotalValue:     { fontSize: 18, fontWeight: '800', color: t.text },
  tabFootnote:       { fontSize: 11, color: t.textMuted, marginTop: 8, lineHeight: 16, textAlign: 'center' },
  tabClearBtn:       { marginTop: 14, alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 18, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  tabClearBtnText:   { fontSize: 12, color: t.textMuted, fontWeight: '600' },

  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: t.blue },
  tabBtnText: { fontSize: 13, color: t.textMuted, fontWeight: '500' },
  tabBtnTextActive: { color: t.blue, fontWeight: '700' },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: t.textFaint, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  repeatLabel:     { fontSize: 12, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 },
  repeatRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeTab:         { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.borderStrong },
  typeTabOn:       { backgroundColor: t.blueSoft, borderColor: t.blue },
  typeTabText:     { fontSize: 13, color: t.textMuted, fontWeight: '700' },
  typeTabTextOn:   { color: t.blue, fontWeight: '800' },
  blockBand:       { position: 'absolute', left: 3, borderRadius: 6, borderLeftWidth: 3, borderLeftColor: t.textMuted, backgroundColor: t.surfaceMuted, paddingHorizontal: 7, paddingVertical: 4, alignItems: 'flex-start', justifyContent: 'center', borderWidth: 1, borderColor: t.border, borderStyle: 'dashed' },
  blockBandText:   { fontSize: 11, fontWeight: '800', color: t.textMuted },
  repeatChip:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.borderStrong },
  repeatChipOn:    { backgroundColor: t.greenSoft, borderColor: t.green },
  repeatChipText:  { fontSize: 13, color: t.textMuted, fontWeight: '600' },
  repeatChipTextOn:{ color: t.green, fontWeight: '800' },
  repeatCountRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  repeatCountLabel:{ fontSize: 13, color: t.textMuted, fontWeight: '600' },
  repeatCountInput:{ width: 70, backgroundColor: t.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, borderWidth: 1, borderColor: t.border, textAlign: 'center' },
  primaryBtn: { backgroundColor: t.green, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  checkedInPill: { backgroundColor: t.greenSoft, borderColor: t.green, borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  checkedInPillText: { color: t.success, fontSize: 13, fontWeight: '600' },

  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusBtn: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10,
    borderWidth: 1.5, borderColor: t.borderStrong, backgroundColor: t.surface, flexGrow: 1, alignItems: 'center', minWidth: '47%',
  },
  statusBtnText: { fontSize: 13, color: t.textMuted },
  refundBtn:     { marginTop: 16, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: t.dangerBg, borderWidth: 1, borderColor: t.danger },
  refundBtnText: { fontSize: 14, fontWeight: '800', color: t.danger },
  refundedPill:  { marginTop: 16, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: t.surfaceMuted, borderWidth: 1, borderColor: t.border },
  refundedText:  { fontSize: 12.5, fontWeight: '700', color: t.textMuted },

  contactLine: { fontSize: 14, color: t.text, marginBottom: 6 },
  notesInput: {
    minHeight: 140, padding: 12, borderRadius: 10,
    borderWidth: 1, borderColor: t.borderStrong, backgroundColor: t.surfaceAlt,
    fontSize: 14, color: t.text,
  },
});
