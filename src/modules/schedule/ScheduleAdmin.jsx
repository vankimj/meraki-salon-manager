import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { parsePhoneNumberFromString as lpnParse, AsYouType as AsYouTypeFormatter } from 'libphonenumber-js';
import { currentLocationId, isMultiLocation, effectiveLocationId, appointmentInLocation, employeeInLocation, subscribeLocations, subscribeCurrentLocation } from '../../lib/locations';
import { fetchAppointments, fetchAppointmentsByRange, fetchAppointmentById, subscribeToAppointments, subscribeToAppointmentsByRange, createAppointment, saveAppointment, deleteAppointment, deleteRecurringGroup, fetchRecurringGroup, fetchClients, createClient, fetchServices, fetchEmployees, fetchUserPrefs, saveUserPrefs, subscribeQueue, updateWaitlistEntry, removeWaitlistEntry, subscribeTurnRoster, saveTurnRoster, subscribeTimeOff, createTimeOff, updateTimeOff, deleteTimeOff, fetchClientVisits, patchWebfrontConfig, storeHoursToWebfrontHours, fetchAttendance, subscribeAttendance, fetchReceiptByApptId } from '../../lib/firestore';
import { isSalonOpenNow, clockedInNameSet, clockedInTodayNameSet, techWorkStatus, isScheduledOnDay, attendanceKey } from '../../lib/shiftGate';
import { computeNextOpening, computeSeatStart } from './seatTime';
import { techApptWindow, buildTechApptHours, daySpanFromTechHours } from '../../lib/apptHours';
import ClientSearch from './ClientSearch';
import { callFn, startTrace } from '../../lib/firebase';
import CheckoutModal from '../checkout/CheckoutModal';
import RefundModal from '../receipts/RefundModal';
import RestoreFromBQModal from '../../components/RestoreFromBQModal';
import TrashButton from '../../components/TrashButton';
import { useApp } from '../../context/AppContext';
import { logActivity } from '../../lib/logger';
import { applyTurnCredit, recomputeTodayTurns } from '../../lib/turnCredit';
import { resolveTurnMode, buildTurnValueMap, turnValueForLineName } from '../../lib/turnValue';
import { fetchTurnRoster } from '../../lib/firestore';
import DayReplayModal from '../../components/DayReplayModal';
import { notifyAffectedTechs } from '../../lib/notifications';
import { TENANT_ID } from '../../lib/tenant';
import { resizeImg } from '../../utils/helpers';
import { resolveServicePricing } from '../../utils/serviceHelpers';
import VoiceAssistant from '../voice/VoiceAssistant';
import NotesEditor from '../../components/NotesEditor';
import CoachMark from '../../components/CoachMark';
import TurnHelpModal from '../../components/TurnHelpModal';

// No baked-in tech roster. Multi-tenant SaaS — tech columns come from the
// tenant's employees collection. While employees load, columns are empty
// (the "no employees yet" empty state in the grid prompts the owner to
// add their first one). Previously this defaulted to Meraki's 10 names,
// which leaked Meraki-specific data into every brand-new tenant's view.
const FALLBACK_TECHS = [];

const SLOT_H = 56; // px per 30-min slot

function minsToStr(m) {
  const h = Math.floor(m / 60), min = m % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${min.toString().padStart(2, '0')} ${ampm}`;
}

function strToMins(str) {
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const STATUS_COLORS = {
  scheduled:     { bg: 'var(--pn-info-bg)',    border: '#3B82F6', text: 'var(--pn-info)' },
  'in-progress': { bg: 'var(--pn-warning-bg)', border: '#F59E0B', text: 'var(--pn-warning)' },
  done:          { bg: 'var(--pn-success-bg)', border: '#10B981', text: 'var(--pn-success)' },
  cancelled:     { bg: 'var(--pn-danger-bg)',  border: '#EF4444', text: 'var(--pn-danger)' },
  no_show:       { bg: '#F3F4F6', border: '#6B7280', text: '#374151' },
};

// One distinct color per tech, assigned by stable index in the full tech list
const TECH_PALETTE = [
  { solid: '#2D7A5F', bg: '#e8f5ef', text: '#1a4d3a' }, // forest green
  { solid: '#3D95CE', bg: '#e8f2fb', text: '#1a4d7a' }, // blue
  { solid: '#9333EA', bg: '#f3eeff', text: '#4a1d96' }, // purple
  { solid: '#D97706', bg: '#fef3c7', text: '#78350f' }, // amber
  { solid: '#BE185D', bg: '#fdf2f8', text: '#831843' }, // pink
  { solid: '#059669', bg: '#d1fae5', text: '#065f46' }, // emerald
  { solid: '#0891B2', bg: '#e0f7fa', text: '#164e63' }, // cyan
  { solid: '#EA580C', bg: '#fff7ed', text: '#7c2d12' }, // orange
  { solid: '#4F46E5', bg: '#eef2ff', text: '#3730a3' }, // indigo
  { solid: '#0F766E', bg: '#f0fdfa', text: '#134e4a' }, // teal
];

function getTechColor(techName, allTechs) {
  const idx = allTechs.indexOf(techName);
  return TECH_PALETTE[idx >= 0 ? idx % TECH_PALETTE.length : 0];
}

const STATUS_DOT = {
  scheduled:     { color: '#3B82F6', label: '●' },
  'in-progress': { color: '#F59E0B', label: '●' },
  done:          { color: '#10B981', label: '●' },
  cancelled:     { color: '#EF4444', label: '●' },
  no_show:       { color: '#6B7280', label: '●' },
};

const OVERLAY_KEY = 'meraki_visible_techs';

function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
}

// Returns the time-off entries that apply to a specific date for a tech.
// allDay entries cover the whole day; partial entries cover a slot range.
function timeOffOnDate(timeOff, techName, date) {
  if (!Array.isArray(timeOff) || !techName || !date) return [];
  return timeOff.filter(t =>
    t.techName === techName &&
    (t.startDate || '') <= date && date <= (t.endDate || t.startDate || '')
  );
}

// True if the given (techName, slotMins) is inside a time-off block.
// Partial-day entries on the first/last day respect startTime/endTime.
function isSlotBlocked(timeOff, techName, date, slotMins) {
  const hits = timeOffOnDate(timeOff, techName, date);
  for (const t of hits) {
    if (t.allDay !== false) return t;
    // Partial-day: only apply startTime/endTime on the relevant edges.
    const isStart = date === (t.startDate || '');
    const isEnd   = date === (t.endDate   || t.startDate || '');
    let s = 0, e = 24 * 60;
    if (t.startTime && isStart) s = strToMins(t.startTime);
    if (t.endTime   && isEnd)   e = strToMins(t.endTime);
    if (slotMins >= s && slotMins < e) return t;
  }
  return null;
}

function weekStartOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadOverlay(allTechs) {
  try {
    const stored = JSON.parse(localStorage.getItem(OVERLAY_KEY));
    if (Array.isArray(stored)) {
      const existing = stored.filter(t => allTechs.includes(t));
      const added    = allTechs.filter(t => !stored.includes(t));
      return [...existing, ...added];
    }
  } catch {}
  return [...allTechs];
}

// US phone normalization. Strip everything that isn't a digit, drop a
// International phone helpers via libphonenumber-js. US numbers entered
// without a country code are auto-treated as US (default). Anything
// starting with "+" is parsed against the appropriate country's rules.
//
// Returns { digits, formatted, valid, empty }:
//   - digits    canonical comparable identity (E.164 minus the +)
//   - formatted human-readable display string
//   - valid     true iff parsing succeeded and the number is a real
//               phone number for that country
//   - empty     no input
//
// digits is what duplicate-detection compares on (numbers stored in
// E.164 across all countries compare cleanly without per-country
// normalization headaches).
function normalizePhone(input) {
  const raw = String(input || '');
  if (!raw.trim()) return { digits: '', formatted: '', valid: true, empty: true };
  try {
    const parsed = raw.startsWith('+')
      ? lpnParse(raw)
      : lpnParse(raw, 'US');
    if (parsed?.isValid()) {
      return {
        digits:    parsed.format('E.164').replace('+', ''),
        formatted: parsed.format('INTERNATIONAL'),
        valid:     true,
        empty:     false,
      };
    }
  } catch (_) {}
  // Fall back to digit-only canonicalization for anything we can't
  // parse — keeps legacy data flowing without losing the input.
  return { digits: raw.replace(/\D/g, ''), formatted: raw.trim(), valid: false, empty: false };
}

function displayPhone(p) {
  if (!p) return '';
  const info = normalizePhone(p);
  return info.valid ? info.formatted : String(p);
}

// Live "as you type" formatter. AsYouType from libphonenumber-js
// handles US auto-formatting AND international (when a + is present).
function formatPhoneAsYouType(input) {
  const text = String(input || '');
  if (!text) return '';
  const ayt = new AsYouTypeFormatter(text.startsWith('+') ? undefined : 'US');
  return ayt.input(text);
}

// Common email-domain suggestions, surfaced once the user has typed past
// the "@" but no dot is present yet. Ordered by frequency in US salons.
const COMMON_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'outlook.com', 'aol.com', 'me.com', 'comcast.net', 'live.com'];
function emailSuggestions(input) {
  const v = String(input || '');
  const at = v.indexOf('@');
  if (at < 0) return [];
  const local = v.slice(0, at);
  if (!local) return [];
  const after = v.slice(at + 1).toLowerCase();
  // Stop suggesting once the user has typed a TLD-style dot in the domain
  if (after.includes('.')) return [];
  return COMMON_EMAIL_DOMAINS
    .filter(d => d.startsWith(after))
    .slice(0, 5)
    .map(d => `${local}@${d}`);
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function blankAppt(date, techName, startMins, clientName = '', serviceName = '', extra = {}) {
  return {
    clientId: extra.clientId || '',
    clientName: clientName,
    clientPhone: extra.clientPhone || '',
    clientEmail: extra.clientEmail || '',
    techName: techName || '',
    services: [{ name: serviceName, duration: 60, price: '' }],
    date: date,
    startTime: startMins != null
      ? `${String(Math.floor(startMins / 60)).padStart(2, '0')}:${String(startMins % 60).padStart(2, '0')}`
      : '09:00',
    duration: 60,
    notes: '',
    status: 'scheduled',
  };
}

// ── Main ──────────────────────────────────────────────
export default function ScheduleAdmin({ onOpenClient } = {}) {
  const { settings, updateSettings, isTech, isAdmin, isScheduler, myTechName, canEditOwnSchedule, gUser, showToast, addApptToTicket } = useApp();
  // A tech the admin set to view-only: can read their day but not add, move,
  // edit, delete, or check out appointments. Enforced server-side too.
  const scheduleReadOnly = isTech && !canEditOwnSchedule;

  const [date,         setDate]        = useState(todayStr());

  // Derive walk-in hours from per-day store hours (fall back to global walkIn setting)
  const dow_ = dayOfWeek(date);
  const storeDay = settings.storeHours?.[dow_] || {};
  const walkInOpen  = strToMins(storeDay.open  || settings.walkIn?.open  || '09:00');
  const walkInClose = strToMins(storeDay.close || settings.walkIn?.close || '18:00');
  // Per-tech appointment-only windows for the displayed day. The grid spans the
  // widest tech window (so extended slots are visible); each tech's blue
  // "appointment-only" zone is bounded by their own window. Legacy salon-wide
  // settings.apptHours is a migration fallback for extended techs not yet given
  // a per-tech window.
  const techWindows = buildTechApptHours(empRecords, settings, dow_, settings.apptHours);
  const apptSpan    = daySpanFromTechHours(techWindows, walkInOpen, walkInClose);
  const dayStart    = apptSpan.open;
  const dayEnd      = apptSpan.close;
  const slots = [];
  for (let m = dayStart; m < dayEnd; m += 30) slots.push(m);
  const [appts,        setAppts]       = useState([]);
  const [loading,      setLoading]     = useState(true);
  // Multi-location: when >1 active location, the grid shows only the current
  // location's appointments (plus legacy untagged ones — never hidden). Filtered
  // client-side so no composite index is needed; single-location is unaffected.
  const [curLoc,   setCurLoc]   = useState(currentLocationId());
  const [locState, setLocState] = useState(null);
  useEffect(() => subscribeCurrentLocation(setCurLoc), []);
  useEffect(() => subscribeLocations(setLocState), []);
  const visibleAppts = useMemo(
    () => (isMultiLocation(locState) ? appts.filter(a => appointmentInLocation(a, curLoc)) : appts),
    [appts, locState, curLoc],
  );
  // Location key for per-location docs (turnRoster, queue scoping). Collapses
  // to the bare/default key for single-location tenants — see effectiveLocationId.
  const effLoc = useMemo(() => effectiveLocationId(locState, curLoc), [locState, curLoc]);
  const [modal,        setModal]       = useState(null);
  const [checkout,     setCheckout]    = useState(null);
  const [refund,       setRefund]      = useState(null);
  const [clients,      setClients]     = useState([]);
  const [services,     setServices]    = useState([]);
  const [techs,        setTechs]       = useState(FALLBACK_TECHS);
  const [techExtended,     setTechExtended]     = useState({});
  const [empRecords,       setEmpRecords]       = useState([]); // active employee records (for per-tech appt windows)
  const [showAll,          setShowAll]          = useState(false);
  const [showHours,        setShowHours]        = useState(false);
  const [showTimeOff,      setShowTimeOff]      = useState(false);
  // When the Time Off modal is opened from the New Appointment modal's
  // "🌴 Block time", this prefills the add-form with the tapped slot
  // (tech + date + start/end). Null = opened blank.
  const [blockPrefill,     setBlockPrefill]     = useState(null);
  // Toolbar overflow menu — collapses infrequent controls (Hours,
  // Time Off, future settings) under a single ⚙ button so the daily
  // toolbar stays uncluttered for non-tech-savvy salon owners.
  const [showToolbarMenu,  setShowToolbarMenu]  = useState(false);
  const [timeOff,          setTimeOff]          = useState([]);
  // Hydrate immediately from localStorage (or fall back to all known techs)
  // so the filter pills render on first paint. Previously this was `null`
  // until `fetchEmployees` returned at least one employee — which meant
  // brand-new tenants (no employees seeded yet) had the filter pills
  // permanently hidden even though tech columns were showing via the
  // FALLBACK_TECHS list. The `fetchEmployees` effect still overwrites this
  // once real employee data is available.
  const [visibleTechNames, setVisibleTechNames] = useState(() => loadOverlay(FALLBACK_TECHS));
  // Single-tech focus mode. Click a column header in the day grid to zoom
  // into just that tech's schedule (full column width, overlap clusters
  // become much more readable). Click the header again to back out.
  const [focusedTech,      setFocusedTech]      = useState(null);
  const [empWorkDays,      setEmpWorkDays]      = useState({});
  const [employees,        setEmployeesData]    = useState([]);
  const [viewMode,         setViewMode]         = useState('day');
  const [weekAppts,        setWeekAppts]        = useState([]);
  const [weekLoading,      setWeekLoading]      = useState(false);
  // The walk-in queue + turn roster are always shown on today's day view (the
  // old "Queue" toggle was removed — they default open).
  const [showReplay,       setShowReplay]       = useState(false);
  const [queueEntries,     setQueueEntries]     = useState([]);
  const [turnRoster,       setTurnRoster]       = useState({ date: '', roster: [] });
  const [deleteDialog,     setDeleteDialog]     = useState(null); // appt with recurringGroupId
  // Series creation conflict prompt — { dates: [{date, ok, reasons[]}], proceed, cancel }
  const [seriesConflict,   setSeriesConflict]   = useState(null);
  // Series edit prompt — { appt, original }; user picks scope (this / following / all)
  const [seriesEdit,       setSeriesEdit]       = useState(null);
  // Track viewport width so the day grid can fit a tech's own column
  // cleanly on a phone (techs are the primary mobile audience). 0 means
  // "unknown / desktop" so the default widths stand.
  const [viewportW,        setViewportW]        = useState(typeof window !== 'undefined' ? window.innerWidth : 0);
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const load = useCallback(async () => {
    // Kept for places that still trigger an explicit reload (e.g. modal save error paths).
    // The live subscription below is the primary source of truth.
    setLoading(true);
    try { setAppts(await fetchAppointments(date)); }
    catch (e) { console.error('[Schedule] load failed:', e); }
    finally { setLoading(false); }
  }, [date]);

  // Real-time day-view subscription — appointment changes from any client appear within ~1s.
  useEffect(() => {
    setLoading(true);
    const t = startTrace('calendar_day_load'); // time-to-first-appointments (Firebase Perf)
    let first = true;
    const unsub = subscribeToAppointments(date, list => {
      setAppts(list);
      setLoading(false);
      if (first) { first = false; t?.stop(); }
    });
    return () => { unsub(); if (first) t?.stop(); };
  }, [date]);

  const weekStart = weekStartOf(date);
  const loadWeek = useCallback(async () => {
    setWeekLoading(true);
    try { setWeekAppts(await fetchAppointmentsByRange(weekStart, addDays(weekStart, 6))); }
    catch { setWeekAppts([]); }
    finally { setWeekLoading(false); }
  }, [weekStart]);

  // Real-time week-view subscription — only active while in week mode.
  useEffect(() => {
    if (viewMode !== 'week') return;
    setWeekLoading(true);
    const unsub = subscribeToAppointmentsByRange(weekStart, addDays(weekStart, 6), list => {
      setWeekAppts(list);
      setWeekLoading(false);
    });
    return unsub;
  }, [viewMode, weekStart]);

  // Self-heal startTime fields written in 12h "h:mm AM/PM" format. An earlier
  // version of drag-and-drop reschedule used the display formatter and saved
  // strings like "2:00 PM" — those parse to NaN in strToMins and the block
  // renders at top:NaN (invisible). Convert them back to 24h "HH:mm" so the
  // appt becomes visible again. Idempotent: HH:mm strings are left alone.
  useEffect(() => {
    appts.forEach(a => {
      const s = a.startTime;
      if (!s) return;
      const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s);
      if (!m12) return;
      let h = parseInt(m12[1], 10);
      const min = m12[2];
      const isPM = m12[3].toUpperCase() === 'PM';
      if (isPM && h < 12) h += 12;
      if (!isPM && h === 12) h = 0;
      const fixed = `${String(h).padStart(2, '0')}:${min}`;
      saveAppointment(a.id, { startTime: fixed }).catch(e => console.error('[Schedule] startTime repair failed', e));
    });
  }, [appts]);

  // Real-time queue listener — always on so badge stays current. Re-subscribes
  // when the location switches so the queue/badge reflect the current site.
  useEffect(() => {
    const unsub = subscribeQueue(todayStr(), setQueueEntries, effLoc);
    return unsub;
  }, [effLoc]);

  // Live time-off subscription so blocked-out periods render on the day grid
  // and slot interactions can respect them.
  useEffect(() => {
    const unsub = subscribeTimeOff(setTimeOff);
    return unsub;
  }, []);

  // Real-time turn roster (today only) for the walk-in rotation panel.
  // Re-subscribes on location switch so each site shows its own rotation.
  useEffect(() => {
    const unsub = subscribeTurnRoster(todayStr(), setTurnRoster, effLoc);
    return unsub;
  }, [effLoc]);

  // Today's attendance (time clock) so "Working today / right now" + the
  // working/off split reflect who's actually clocked in (union with profile hrs).
  const [attendanceToday, setAttendanceToday] = useState({ entries: [] });
  useEffect(() => {
    const unsub = subscribeAttendance(todayStr(), setAttendanceToday);
    return unsub;
  }, []);

  useEffect(() => {
    fetchClients().then(setClients).catch(() => {});
    fetchServices().then(s => setServices(s.filter(sv => sv.active !== false))).catch(() => {});
    fetchEmployees().then(async emps => {
      const active = emps.filter(e => e.active !== false);
      setEmployeesData(active);
      if (active.length) {
        const names = active.map(e => e.name);
        setTechs(names);
        // Fast initial render from localStorage while Firestore loads
        setVisibleTechNames(loadOverlay(names));
        // Override with Firestore prefs if available
        if (gUser?.uid) {
          try {
            const prefs = await fetchUserPrefs(gUser.uid);
            if (Array.isArray(prefs.visibleTechs)) {
              const kept  = prefs.visibleTechs.filter(t => names.includes(t));
              const added = names.filter(t => !prefs.visibleTechs.includes(t));
              const merged = [...kept, ...added];
              setVisibleTechNames(merged);
              localStorage.setItem(OVERLAY_KEY, JSON.stringify(merged));
            }
          } catch {}
        }
        const ext = {};
        const wd  = {};
        active.forEach(e => {
          ext[e.name] = !!e.extendedHoursAllowed;
          wd[e.name]  = e.workDays || {};
        });
        setTechExtended(ext);
        setEmpWorkDays(wd);
        setEmpRecords(active);
      }
    }).catch(() => {});
  }, []);

  // Clients whose birthday month+day matches the selected date
  const birthdayClients = clients.filter(c => {
    if (!c.birthday) return false;
    const [, bm, bd] = c.birthday.split('-');
    const [, dm, dd] = date.split('-');
    return bm === dm && bd === dd;
  });

  const birthdayEmployees = employees.filter(e => {
    if (!e.birthday) return false;
    const [, bm, bd] = e.birthday.split('-');
    const [, dm, dd] = date.split('-');
    return bm === dm && bd === dd;
  });

  // Earliest free start (minutes since midnight) for a tech TODAY, and the
  // default start time for a seated walk-in. Both delegate to the pure,
  // unit-tested helpers in ./seatTime (see seatTime.test.js) — passing the live
  // component state + `now` so the logic stays in one tested place.
  function techApptWindowToday(techName) {
    const dow = new Date().toLocaleDateString('en-US', { weekday: 'short' });
    const emp = empRecords.find(e => e.name === techName);
    return emp ? techApptWindow(emp, settings, dow, settings.apptHours) : null;
  }
  function nextOpeningMins(techName, durationMins = 60) {
    return computeNextOpening({ settings, empWorkDays, appts, now: new Date(), techName, durationMins, today: todayStr(), apptWindow: techApptWindowToday(techName) });
  }
  function seatStartMins(techName, durationMins = 60) {
    return computeSeatStart({ settings, empWorkDays, appts, now: new Date(), techName, durationMins, today: todayStr(), apptWindow: techApptWindowToday(techName) });
  }

  async function handleSave(appt, original, pendingSeat) {
    try {
      // No-anonymous-customers rule (2026-05-12): every NEW appointment must
      // reference a real client record. When the user books someone who isn't
      // in the system yet (typed a name + a phone or email but never linked a
      // client), auto-create their profile here — or link an existing client
      // if the phone/email already matches one — so the appointment is
      // reachable AND the person shows up in Clients. The inline form already
      // required a name plus a phone or email before enabling Save; a save with
      // no name and no contact stays blocked. Existing walk-in appts (legacy /
      // GG-imported, no clientId) keep editing freely on the appt.id path.
      let resolvedClientId    = appt.clientId  || '';
      let resolvedClientName  = appt.clientName || '';
      let resolvedClientPhone = appt.clientPhone || '';
      let resolvedClientEmail = appt.clientEmail || '';
      if (!appt.id && !resolvedClientId) {
        const name      = resolvedClientName.trim();
        const phoneInfo = normalizePhone(resolvedClientPhone);
        const email     = resolvedClientEmail.trim();
        // Validate exactly like the full "+ details" sub-form (saveNewClient)
        // so this fast inline path can't mint junk records: a non-empty phone
        // must actually parse, a non-empty email must look real, and at least
        // one VALID contact is required. (An unparseable phone stored verbatim
        // gets no phoneDigits index server-side → the client is unfindable by
        // phone and becomes a duplicate magnet.)
        if (!name) {
          alert('Add the client\'s name — or pick an existing client from the search box.');
          return;
        }
        if (!phoneInfo.empty && !phoneInfo.valid) {
          alert('That phone number doesn\'t look valid. Enter a US number like (614) 555-0123, or an international one with a +country code.');
          return;
        }
        if (email && !EMAIL_RE.test(email)) {
          alert('That email address looks invalid.');
          return;
        }
        const phone = phoneInfo.valid ? phoneInfo.formatted : '';
        if (!phone && !email) {
          alert('Add a phone or email so we can create their profile — or pick an existing client from the search box.');
          return;
        }
        try {
          const pd = phoneInfo.digits;
          const em = email.toLowerCase();
          const existing = clients.find(c => {
            const cpd = normalizePhone(c.phone).digits;
            const cem = (c.email || '').trim().toLowerCase();
            return (pd && cpd && cpd === pd) || (em && cem && cem === em);
          });
          if (existing) {
            resolvedClientId    = existing.id;
            resolvedClientName  = existing.name  || name;
            resolvedClientPhone = existing.phone || phone;
            resolvedClientEmail = existing.email || email;
            if (showToast && existing.name) showToast(`Linked to existing client ${existing.name}`, 4000);
          } else {
            const data = {
              name, phone, email,
              commPreferences: { appointmentSms: true, appointmentEmail: true, appointmentVoice: false, marketingSms: true, marketingEmail: true, marketingVoice: false },
              instagramTags: [], googleReviews: [], visits: [],
            };
            resolvedClientId    = await createClient(data);
            resolvedClientName  = name;
            resolvedClientPhone = phone;
            resolvedClientEmail = email;
            setClients(prev => [...prev, { id: resolvedClientId, ...data }].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
            logActivity('client_added', `${name}${phone ? ' · ' + phone : ''}${email ? ' · ' + email : ''} (from Schedule appt)`);
          }
        } catch (e) {
          alert(`Could not create the client profile: ${e.message || 'unknown error'}`);
          return;
        }
      }

      // Clock-in gate: a tech editing their own calendar while the salon is open
      // ("on shift") must be clocked in. Off shift (salon closed) they can edit
      // freely so they can plan from home. Admins/schedulers manage schedules as
      // their job and aren't gated. Workflow guard — server still authorizes.
      if (isTech && !isAdmin && isSalonOpenNow(settings)) {
        try {
          const att = await fetchAttendance(attendanceKey());
          const inSet = clockedInNameSet(att);
          if (myTechName && !inSet.has(String(myTechName).trim().toLowerCase())) {
            const msg = 'Clock in at the Time Clock before changing your schedule during open hours.';
            showToast ? showToast(msg, 6000) : alert(msg);
            return;
          }
        } catch { /* attendance unreadable → fail open */ }
      }

      const dur = (appt.services || []).reduce((sum, s) => sum + (Number(s.duration) || 0), 0) || 60;
      // Out-of-hours warning is now surfaced inline in ApptModal's Review
      // panel before the user clicks Save (one consolidated review surface
      // instead of stacking browser confirms). By the time we get here,
      // the user has already seen and accepted any soft warnings.

      const { recurrence, ...apptBase } = appt;
      // Keep legacy `notes` string in sync with the structured notesLog so
      // email templates / AI tools / reports that still read appt.notes
      // continue to see the latest text. Joined newest-first.
      const log = Array.isArray(apptBase.notesLog) ? apptBase.notesLog : [];
      const derivedNotes = log.length
        ? log.map(e => e?.text || '').filter(Boolean).join('\n\n')
        : (apptBase.notes || '');
      const full = { ...apptBase, notes: derivedNotes, duration: dur,
        clientId: resolvedClientId, clientName: resolvedClientName,
        clientPhone: resolvedClientPhone, clientEmail: resolvedClientEmail };
      // Record which staff member entered this booking — surfaced in Reports as
      // the "source" for in-salon bookings. Only on NEW staff-created appts
      // (never overwrite on edit; online bookings carry source='online_booking').
      if (!appt.id && !full.source && !full.bookedByName) {
        full.bookedByName = gUser?.displayName || (gUser?.email ? gUser.email.split('@')[0] : null);
      }
      const svcSummary = (full.services || []).map(s => s.name || s.customName).filter(Boolean).join(', ') || 'no services';
      const totalPrice = (full.services || []).reduce((s, sv) => s + Number(sv.price || 0), 0);
      const logDetail  = `${appt.clientName || 'walk-in'} with ${appt.techName} on ${appt.date} at ${appt.startTime} — ${svcSummary}${totalPrice > 0 ? ` ($${totalPrice.toFixed(2)})` : ''}`;

      if (appt.id) {
        // If this is part of a series and the user actually changed something
        // meaningful, ask whether to apply to one / following / all.
        const inSeries = !!original?.recurringGroupId;
        const meaningfulChange = inSeries && (
          appt.techName    !== original.techName    ||
          appt.startTime   !== original.startTime   ||
          appt.status      !== original.status      ||
          appt.clientId    !== original.clientId    ||
          appt.notes       !== original.notes       ||
          JSON.stringify(appt.services) !== JSON.stringify(original.services)
        );
        if (meaningfulChange) {
          setSeriesEdit({ appt, original, full, logDetail, dur });
          return;
        }
        const { id, createdAt, ...data } = full;
        await saveAppointment(id, data);
        logActivity('appt_updated', logDetail);

        // Turn credit: every completed appointment today = +1 turn for the
        // tech (Mango POS model — same whether it's a walk-in, a request, or
        // a scheduled appt).
        const becameDone = original?.status !== 'done' && appt.status === 'done';
        if (becameDone) {
          applyTurnCredit({ ...full, id: appt.id }, resolveTurnMode(settings)).then(applied => {
            if (applied) logActivity('turn_credit', `${appt.techName} +1 (${appt.clientName || 'walk-in'})`);
          });
        }
      } else if (recurrence) {
        // Pre-flight: check each future date for conflicts and let the user
        // decide skip-some / book-anyway / cancel before we write anything.
        const dates = [];
        for (let i = 0; i < recurrence.count; i++) {
          dates.push(addDays(full.date, i * recurrence.weeks * 7));
        }
        const checks = await checkSeriesConflicts(dates, full);
        const anyConflict = checks.some(c => !c.ok);
        if (anyConflict) {
          setSeriesConflict({
            dates: checks,
            full,
            recurrence,
            logDetail,
          });
          return; // user picks an option in the dialog
        }
        await createSeries(full, recurrence, dates, logDetail);
      } else {
        const newId = await createAppointment({ ...full, locationId: full.locationId || currentLocationId() });
        full.id = newId;
        logActivity('appt_created', logDetail);
      }

      notifyAffectedTechs(original, full, gUser).catch(e => console.error('[Notif]', e));

      // Queue-seat finalize: now that the appointment is actually saved, pull the
      // person off the walk-in queue and (only for 🎯 Next) credit the turn to
      // whoever they ended up seated with. Deferring to here is what makes
      // cancelling the modal a true no-op — they stay in the queue, no turn moves.
      if (pendingSeat) {
        if (pendingSeat.creditTurn && full.techName) {
          const credited = (turnRoster.roster || []).map(r =>
            r.techName === full.techName ? { ...r, turnsTaken: (Number(r.turnsTaken) || 0) + 1 } : r
          );
          await saveTurnRoster(todayStr(), credited, effLoc).catch(() => {});
        }
        await updateWaitlistEntry(pendingSeat.entryId, { status: 'seated' }).catch(() => {});
        logActivity('walkin_seated', `${full.clientName || 'walk-in'} → ${full.techName || '—'}`);
      }

      // The write is done — close the modal now. Refresh the calendar in the
      // BACKGROUND so a slow Firestore read doesn't pin "Saving…". The real-time
      // subscription surfaces the change anyway; this is a belt-and-suspenders sync.
      setModal(null);
      (viewMode === 'week' ? loadWeek() : load()).catch(e => console.error('[Schedule] refresh failed', e));
    } catch (e) {
      console.error('[Schedule] save failed:', e);
      const msg = `Couldn't save the appointment: ${e?.message || 'unknown error'}`;
      if (showToast) showToast(msg, 7000); else alert(msg);
    }
  }

  // Deleting (trash) soft-deletes the appt — it doesn't flip status to
  // 'cancelled', so the server's cancellation-notice trigger won't fire. For a
  // real, upcoming client appointment, offer to text/email them it's cancelled.
  // Walk-ins, past appts, and already-cancelled/done appts skip the prompt.
  async function maybeNotifyClientOfCancel(appt) {
    if (!appt?.clientId) return;
    if (appt.status === 'cancelled' || appt.status === 'done') return;
    if ((appt.date || '') < attendanceKey()) return; // past appointment
    if (!confirm(`Let ${appt.clientName || 'the client'} know by text/email that this appointment is cancelled?`)) return;
    try {
      await callFn('notifyAppointmentCancelled')({ tenantId: TENANT_ID, apptId: appt.id });
      showToast?.('Cancellation notice sent to the client');
    } catch (e) {
      showToast?.(`Couldn't send cancellation notice: ${e?.message || 'try again'}`);
    }
  }

  async function handleDelete(appt) {
    if (appt.recurringGroupId) {
      setDeleteDialog(appt);
      return;
    }
    if (!confirm(`Delete this appointment for ${appt.clientName || 'walk-in'}?`)) return;
    await maybeNotifyClientOfCancel(appt);
    await deleteAppointment(appt.id);
    const svcNames = (appt.services || []).map(s => s.name || s.customName).filter(Boolean).join(', ') || 'no services';
    logActivity('appt_deleted', `${appt.clientName || 'walk-in'} with ${appt.techName} on ${appt.date} — ${svcNames}`);
    setAppts(a => a.filter(x => x.id !== appt.id));
    setModal(null);
  }

  async function handleDeleteOne(appt) {
    await maybeNotifyClientOfCancel(appt);
    await deleteAppointment(appt.id);
    logActivity('appt_deleted', `${appt.clientName || 'walk-in'} with ${appt.techName} on ${appt.date} (series ${appt.recurringIndex}/${appt.recurringTotal})`);
    setAppts(a => a.filter(x => x.id !== appt.id));
    setDeleteDialog(null);
    setModal(null);
  }

  async function handleDeleteSeries(appt) {
    await deleteRecurringGroup(appt.recurringGroupId);
    logActivity('appt_series_deleted', `${appt.clientName || 'walk-in'} recurring series (${appt.recurringTotal} appts)`);
    if (viewMode === 'week') { await loadWeek(); } else { await load(); }
    setDeleteDialog(null);
    setModal(null);
  }

  // Look ahead at every date in a proposed series and flag problems:
  // store closed, tech off-day, or another appt overlaps the same tech/time.
  // Single Firestore range query, in-memory cross-check.
  async function checkSeriesConflicts(dates, full) {
    if (!dates.length) return [];
    const startDate = dates[0];
    const endDate   = dates[dates.length - 1];
    const existing  = await fetchAppointmentsByRange(startDate, endDate);
    const startMins = strToMins(full.startTime || '00:00');
    const endMins   = startMins + (Number(full.duration) || 60);
    return dates.map(d => {
      const reasons = [];
      const dow = dayOfWeek(d);
      const sh  = settings.storeHours?.[dow] || {};
      if (sh.closed) reasons.push('salon closed that day');
      const wd  = empWorkDays[full.techName]?.[dow];
      if (wd && wd.on === false) reasons.push(`${full.techName} off that day`);
      // Time off (vacation/sick/personal) blocks the slot.
      const blocked = isSlotBlocked(timeOff, full.techName, d, startMins);
      if (blocked) reasons.push(`${full.techName} on ${blocked.type || 'time off'}`);
      const collisions = existing.filter(a => {
        if (a.date !== d) return false;
        if (a.techName !== full.techName) return false;
        if (a.status === 'cancelled') return false;
        const aStart = strToMins(a.startTime || '00:00');
        const aEnd   = aStart + (Number(a.duration) || 60);
        return aStart < endMins && aEnd > startMins;
      });
      if (collisions.length) {
        reasons.push(`${full.techName} already booked ${collisions[0].startTime}`);
      }
      return { date: d, ok: reasons.length === 0, reasons };
    });
  }

  async function createSeries(full, recurrence, dates, logDetail) {
    const groupId = crypto.randomUUID();
    for (let i = 0; i < dates.length; i++) {
      await createAppointment({
        ...full,
        locationId: full.locationId || currentLocationId(),
        date: dates[i],
        recurringGroupId: groupId,
        recurringIndex: i + 1,
        recurringTotal: dates.length,
      });
    }
    logActivity('appt_series_created', `${dates.length}× ${logDetail}`);
    if (viewMode === 'week') { await loadWeek(); } else { await load(); }
    setModal(null);
  }

  async function confirmSeriesConflict(action) {
    const ctx = seriesConflict;
    if (!ctx) return;
    const { full, recurrence, dates, logDetail } = ctx;
    setSeriesConflict(null);
    if (action === 'cancel') return;
    let finalDates;
    if (action === 'skip') {
      finalDates = dates.filter(d => d.ok).map(d => d.date);
    } else { // 'force'
      finalDates = dates.map(d => d.date);
    }
    if (!finalDates.length) {
      showToast('Nothing to book — all dates conflict');
      return;
    }
    await createSeries(full, recurrence, finalDates, logDetail);
  }

  // Apply the changes from a series edit to a chosen scope.
  async function applySeriesEdit(scope) {
    const ctx = seriesEdit;
    if (!ctx) return;
    const { appt, original, full, logDetail, dur } = ctx;
    setSeriesEdit(null);

    if (scope === 'this') {
      const { id, createdAt, ...data } = full;
      await saveAppointment(id, data);
      logActivity('appt_updated', logDetail);
      const becameDone = original?.status !== 'done' && appt.status === 'done';
      if (becameDone) {
        applyTurnCredit({ ...full, id: appt.id }, resolveTurnMode(settings)).then(applied => {
          if (applied) logActivity('turn_credit', `${appt.techName} +1 (${appt.clientName || 'walk-in'})`);
        });
      }
      if (viewMode === 'week') { await loadWeek(); } else { await load(); }
      setModal(null);
      return;
    }

    // 'following' or 'all' — fan out to series siblings
    const siblings = await fetchRecurringGroup(original.recurringGroupId);
    const targets = scope === 'all'
      ? siblings
      : siblings.filter(s => (s.recurringIndex || 0) >= (original.recurringIndex || 0));
    // Fields propagated to siblings (NOT date — each occurrence keeps its own date)
    const patch = {
      techName:        appt.techName,
      startTime:       appt.startTime,
      status:          appt.status,
      clientId:        appt.clientId,
      clientName:      appt.clientName,
      services:        appt.services,
      duration:        dur,
      notes:           appt.notes,
      techRequestType: appt.techRequestType,
      updatedAt:       new Date().toISOString(),
    };
    for (const s of targets) {
      await saveAppointment(s.id, patch);
    }
    logActivity('appt_series_updated', `${targets.length}× ${appt.clientName || 'walk-in'} — ${scope === 'all' ? 'whole series' : 'this and following'}`);
    if (viewMode === 'week') { await loadWeek(); } else { await load(); }
    setModal(null);
  }

function openNew(techName, slotMins) {
    if (scheduleReadOnly) { showToast('View-only access — ask an admin to make changes.'); return; }
    setModal({ appt: blankAppt(date, techName, slotMins), original: null, mode: 'edit' });
  }

  function openView(appt) { setModal({ appt, original: appt, mode: 'view' }); }
  function openEdit(appt) { setModal({ appt: { ...appt }, original: appt, mode: 'edit' }); }

  // "Issue Refund" routes through the REAL refund flow (refundSale: Stripe/credit
  // refund + ledger + commission). That operates on the POS receipt, not the
  // appointment — so look up the receipt that covers this appt first. No receipt
  // means the appt was never checked out, so there's nothing to refund.
  async function requestRefund(appt) {
    try {
      const receipt = await fetchReceiptByApptId(appt?.id);
      if (!receipt) {
        showToast('No payment to refund — this appointment hasn\'t been checked out.');
        return;
      }
      setRefund(receipt);
    } catch (e) {
      showToast(`Couldn't load the sale to refund: ${e?.message || 'try again'}`);
    }
  }

  function toggleTechVisible(name) {
    setVisibleTechNames(prev => {
      const next = prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name];
      if (next.length === 0) return prev;
      localStorage.setItem(OVERLAY_KEY, JSON.stringify(next));
      if (gUser?.uid) saveUserPrefs(gUser.uid, { visibleTechs: next }).catch(() => {});
      return next;
    });
  }

  const dow            = dayOfWeek(date);
  const isStoreClosed  = !!settings.storeHours?.[dow]?.closed;
  const displayTechs0  = isTech && !showAll
    ? techs.filter(t => t === myTechName)
    : (focusedTech && techs.includes(focusedTech))
      ? [focusedTech]
      : visibleTechNames ? techs.filter(t => visibleTechNames.includes(t)) : techs;
  // Multi-location: only show columns for techs who work at the current
  // location. A tech with no employee record (fallback) or no locationIds
  // (unassigned) is shown everywhere — employeeInLocation's back-compat rule.
  const displayTechs   = isMultiLocation(locState)
    ? displayTechs0.filter(t => { const e = employees.find(emp => emp.name === t); return !e || employeeInLocation(e, curLoc); })
    : displayTechs0;

  const personalView   = isTech && !showAll;

  // Per-tech "working today / right now" — based on each tech's PROFILE working
  // hours (configured shift), not the time clock (who's clocked in is shown in
  // the turn roster). Drives the quick filters and the working/off column split.
  const isToday         = date === todayStr();
  const nowMinsForWork  = new Date().getHours() * 60 + new Date().getMinutes();
  const clockedInNowSet   = clockedInNameSet(attendanceToday);
  const clockedInTodaySet = clockedInTodayNameSet(attendanceToday);
  const normName = (s) => String(s || '').trim().toLowerCase();
  const techStatusFor = (t) => {
    const wd = empWorkDays[t]?.[dow];
    const hasShift = !!empWorkDays[t] && Object.keys(empWorkDays[t]).length > 0;
    const blocks = timeOffOnDate(timeOff, t, date);
    const start = wd?.start ? strToMins(wd.start) : (techWindows[t]?.open ?? 540);
    const end   = wd?.end   ? strToMins(wd.end)   : (techWindows[t]?.close ?? 1080);
    return techWorkStatus({
      isToday,
      // Clocked in today/now (union with profile hours) so the buttons reflect
      // who's actually here even on a day their profile marks off.
      clockedInToday: isToday && clockedInTodaySet.has(normName(t)),
      clockedInNow:   isToday && clockedInNowSet.has(normName(t)),
      hasShift,
      // An absent weekday defaults to ON when the tech has any hours configured
      // (the editor only writes the days you toggle off) — see isScheduledOnDay.
      shiftOnToday:   isScheduledOnDay(empWorkDays[t], dow),
      withinShiftNow: nowMinsForWork >= start && nowMinsForWork < end,
      allDayOff:      blocks.some(b => b.allDay !== false),
      blockedNow:     isToday && isSlotBlocked(timeOff, t, date, nowMinsForWork),
    });
  };
  // "Off today" only applies once at least one tech is known to be working
  // (has profile hours covering today); with nobody working, no one is greyed out.
  // Per-tech breakdown of today's COMPLETED (done) services + each service's
  // turn value, for the roster chip detail. Mirrors recomputeTodayTurns: a done
  // appt's services each contribute their configured turnValue (value mode) /
  // the visit counts as 1 (count mode).
  const turnMode      = resolveTurnMode(settings);
  const turnValueMap  = buildTurnValueMap(services);
  const turnDetailFor = (techName) => {
    const items = [];
    (appts || []).forEach(a => {
      if (a.techName !== techName || a.status !== 'done' || a.date !== todayStr()) return;
      (Array.isArray(a.services) ? a.services : []).forEach(sv => {
        const name = (sv && (sv.name || sv.customName)) || 'Service';
        items.push({ name, tv: turnValueForLineName(name, turnValueMap), time: a.startTime, client: a.clientName });
      });
    });
    return items.sort((x, y) => String(x.time || '').localeCompare(String(y.time || '')));
  };
  const someWorking  = displayTechs.some(t => techStatusFor(t).today);
  const offTodaySet  = new Set(someWorking ? displayTechs.filter(t => !techStatusFor(t).today) : []);
  const hasWorkingShown = displayTechs.some(t => !offTodaySet.has(t));
  // Split working-left / off-right (with a divider) whenever the shown columns
  // mix working + off — i.e. "All techs". A narrowing filter (Working today/now)
  // shows only working techs, so there's nothing to split.
  const splitWorkingOff = !personalView && !focusedTech && offTodaySet.size > 0 && hasWorkingShown;
  const orderedTechs = splitWorkingOff
    ? [...displayTechs.filter(t => !offTodaySet.has(t)), ...displayTechs.filter(t => offTodaySet.has(t))]
    : displayTechs;
  const firstOffTech = splitWorkingOff ? orderedTechs.find(t => offTodaySet.has(t)) : null;
  // Focused (single-tech zoom) mode gets a wide column so overlapping
  // appointments split into readable lanes even at 4–5 deep. On a phone
  // (≤480px) the single-tech view shrinks to fit the viewport so a tech
  // can read their own day with no horizontal scroll. TIME_COL is 54.
  const phoneW         = viewportW > 0 && viewportW <= 480 ? viewportW - 60 : null;
  const techColWidth   = focusedTech
    ? (phoneW || 720)
    : displayTechs.length === 1 ? (phoneW || 360)
    : displayTechs.length <= 3 ? 180 : 120;

  // Today's summary (personal view only)
  const myAppts = personalView && date === todayStr()
    ? appts.filter(a => a.techName === myTechName)
    : null;
  const nowMinsGlobal = new Date().getHours() * 60 + new Date().getMinutes();
  const nextAppt = myAppts
    ? myAppts
        .filter(a => a.status === 'scheduled' && strToMins(a.startTime) > nowMinsGlobal)
        .sort((a, b) => strToMins(a.startTime) - strToMins(b.startTime))[0]
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0, flexWrap: 'wrap' }}>
        {viewMode === 'day' ? (
          <>
            <NavBtn onClick={() => setDate(d => addDays(d, -1))}>‹</NavBtn>
            <button onClick={() => setDate(todayStr())} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: date === todayStr() ? '#3D95CE' : 'var(--pn-surface)', color: date === todayStr() ? '#fff' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
              Today
            </button>
            <NavBtn onClick={() => setDate(d => addDays(d, 1))}>›</NavBtn>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--pn-text)' }}>{fmtDate(date)}</span>
            {isTech && (
              <button onClick={() => setShowAll(v => !v)} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, fontFamily: 'inherit', cursor: 'pointer', border: `1px solid ${showAll ? '#3D95CE' : 'var(--pn-border-strong)'}`, background: showAll ? 'var(--pn-info-bg)' : 'var(--pn-surface)', color: showAll ? 'var(--pn-info)' : 'var(--pn-text-muted)', fontWeight: showAll ? 600 : 400 }}>
                {showAll ? '👥 All Techs' : '👤 My Column'}
              </button>
            )}
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ marginLeft: 'auto', fontSize: 12, border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '5px 8px', fontFamily: 'inherit', background: 'var(--pn-bg)' }} />
          </>
        ) : (
          <>
            <NavBtn onClick={() => setDate(addDays(weekStart, -7))}>‹</NavBtn>
            <button onClick={() => setDate(todayStr())} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: weekStart === weekStartOf(todayStr()) ? '#3D95CE' : 'var(--pn-surface)', color: weekStart === weekStartOf(todayStr()) ? '#fff' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
              This week
            </button>
            <NavBtn onClick={() => setDate(addDays(weekStart, 7))}>›</NavBtn>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--pn-text)' }}>
              Week of {new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(addDays(weekStart, 6) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
            <span style={{ marginLeft: 'auto' }} />
          </>
        )}

        {/* Day / Week toggle */}
        <div style={{ display: 'flex', border: '1px solid var(--pn-border-strong)', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
          {[['day','Day'],['week','Week']].map(([v, label]) => (
            <button key={v} onClick={() => setViewMode(v)} style={{ padding: '5px 12px', border: 'none', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', background: viewMode === v ? '#3D95CE' : 'var(--pn-surface)', color: viewMode === v ? '#fff' : 'var(--pn-text-muted)', fontWeight: viewMode === v ? 600 : 400 }}>
              {label}
            </button>
          ))}
        </div>

        <TrashButton collections={['appointments', 'timeOff']} scope="Schedule" />

        {/* "Block time" moved into the New Appointment modal (tap an empty slot
            → 🌴 Block time) so blocking a tech's time is part of the same flow
            and prefills the tapped slot. */}

        {/* Overflow menu — keeps the toolbar focused on daily controls
            (date nav, view toggle, queue) and tucks infrequent admin ones
            (Store hours) under a single ⚙ button. Closed by default;
            clicking outside dismisses it. */}
        {isAdmin && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setShowToolbarMenu(o => !o)}
              title="Schedule options"
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${showToolbarMenu ? '#3D95CE' : 'var(--pn-border-strong)'}`, background: showToolbarMenu ? 'var(--pn-info-bg)' : 'var(--pn-surface)', color: showToolbarMenu ? 'var(--pn-info)' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
              ⚙ Options
            </button>
            {showToolbarMenu && (
              <>
                {/* Click-away catcher */}
                <div onClick={() => setShowToolbarMenu(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 19, background: 'transparent' }} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                  background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 20,
                  minWidth: 200, padding: 4,
                }}>
                  <button onClick={() => { setShowHours(true); setShowToolbarMenu(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--pn-text)', borderRadius: 6 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--pn-surface-alt)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <span>🕐</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>Store hours</div>
                      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 1 }}>Open / close times by day</div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {showHours && <HoursModal settings={settings} updateSettings={updateSettings} onClose={() => setShowHours(false)} />}
      {showTimeOff && (
        <TimeOffModal
          timeOff={timeOff}
          techs={techs}
          employees={employees}
          services={services}
          clients={clients}
          isAdmin={isAdmin}
          isScheduler={isScheduler}
          isTech={isTech}
          myTechName={myTechName}
          gUser={gUser}
          prefill={blockPrefill}
          onClose={() => { setShowTimeOff(false); setBlockPrefill(null); }}
        />
      )}

      {/* Turn roster — walk-in rotation (visible whenever the queue is open or when there's a roster) */}
      {date === todayStr() && (
        <TurnRosterPanel
          roster={turnRoster.roster || []}
          allTechs={(employees && employees.length > 0) ? employees : techs.map(n => ({ id: n, name: n }))}
          onAddTech={async tech => {
            const next = [...(turnRoster.roster || []), { techId: tech.id, techName: tech.name, clockInAt: new Date().toISOString(), turnsTaken: 0 }];
            await saveTurnRoster(todayStr(), next, effLoc).catch(e => showToast('Save failed: ' + e.message, 3000));
            logActivity('turn_clockin', tech.name);
          }}
          onRemoveTech={async techId => {
            const next = (turnRoster.roster || []).filter(r => r.techId !== techId);
            await saveTurnRoster(todayStr(), next, effLoc).catch(e => showToast('Save failed: ' + e.message, 3000));
          }}
          onAdjustTurns={async (techId, delta) => {
            const next = (turnRoster.roster || []).map(r =>
              r.techId === techId
                ? { ...r, turnsTaken: Math.max(0, Math.round(((Number(r.turnsTaken) || 0) + delta) * 2) / 2) }
                : r);
            await saveTurnRoster(todayStr(), next, effLoc).catch(e => showToast('Save failed: ' + e.message, 3000));
          }}
          onResetDay={async () => {
            if (!window.confirm('Clear today\'s turn roster? Everyone will need to clock back in.')) return;
            await saveTurnRoster(todayStr(), [], effLoc).catch(e => showToast('Save failed: ' + e.message, 3000));
          }}
          onRecount={async () => {
            try {
              const result = await recomputeTodayTurns(resolveTurnMode(settings), services, curLoc);
              const lines = Object.entries(result.byTech).map(([n, c]) => `${n}: ${c}`).join(' · ');
              showToast(`Recounted ${result.recounted} done appts today${lines ? ' — ' + lines : ''}`, 5000);
            } catch (e) {
              showToast('Recount failed: ' + e.message, 3500);
            }
          }}
          onReplay={() => setShowReplay(true)}
          turnMode={turnMode}
          turnDetailFor={turnDetailFor}
        />
      )}
      {showReplay && (
        <DayReplayModal
          services={services}
          turnMode={resolveTurnMode(settings)}
          initialDate={date}
          fetchDay={async (d) => ({ appointments: (await fetchAppointments(d)).filter(a => appointmentInLocation(a, curLoc)), roster: ((await fetchTurnRoster(d, curLoc)) || {}).roster || [] })}
          onClose={() => setShowReplay(false)}
        />
      )}

      {/* Queue panel */}
      {date === todayStr() && (
        <QueuePanel
          entries={queueEntries}
          turnRoster={turnRoster.roster || []}
          onAutoSeatNext={(entry) => {
            const next = nextUpInRotation(turnRoster.roster || []);
            if (!next) {
              showToast('No techs in turn rotation. Clock someone in first.', 3500);
              return;
            }
            setDate(todayStr());
            setViewMode('day');
            // Default the start time to the up-next tech's next opening today.
            const nSvc = services.find(s => s.name === entry.serviceName);
            const nDur = nSvc ? (resolveServicePricing(nSvc, null, employees.find(e => e.name === next.techName)).duration || 60) : 60;
            const nStart = seatStartMins(next.techName, nDur);
            // Defer the turn credit AND the queue removal until the appointment is
            // actually saved (handleSave's pendingSeat path). If the user cancels
            // the modal, nothing happened — they stay in the queue and the rotation
            // doesn't advance. _turnCredited rides on the appt so a later checkout
            // won't double-count the turn. Carry the queue entry's existing client
            // link + contact so the appt is prefilled (and saves without re-keying).
            setModal({
              appt: {
                ...blankAppt(todayStr(), next.techName, nStart, entry.clientName, entry.serviceName,
                  { clientId: entry.clientId, clientPhone: entry.clientPhone, clientEmail: entry.clientEmail }),
                _turnCredited: new Date().toISOString(),
              },
              original: null,
              mode: 'edit',
              pendingSeat: { entryId: entry.id, creditTurn: true },
            });
          }}
          onSeat={entry => {
            setDate(todayStr());
            setViewMode('day');
            // Default the start time to this tech's next opening today (or, for an
            // "Any" entry, the next open slot from now).
            const sTech  = entry.techName === 'Any' ? '' : entry.techName;
            const sSvc   = services.find(s => s.name === entry.serviceName);
            const sDur   = sSvc ? (resolveServicePricing(sSvc, null, sTech ? employees.find(e => e.name === sTech) : null).duration || 60) : 60;
            const sStart = seatStartMins(sTech, sDur);
            // Defer the queue removal until the appointment saves (pendingSeat) so
            // cancelling the modal leaves the person in the queue. Manual assignment
            // doesn't pre-credit a turn — it's reconciled at checkout / Recount.
            // Carry the queue entry's existing client link + contact so the appt
            // is prefilled and saves without re-keying the customer.
            setModal({ appt: blankAppt(todayStr(), sTech, sStart, entry.clientName, entry.serviceName,
              { clientId: entry.clientId, clientPhone: entry.clientPhone, clientEmail: entry.clientEmail }), original: null, mode: 'edit', pendingSeat: { entryId: entry.id } });
          }}
          onRemove={async entry => { await removeWaitlistEntry(entry.id).catch(() => {}); }}
          onDone={async entry => { await updateWaitlistEntry(entry.id, { status: 'done' }).catch(() => {}); }}
          onAddToTicket={async entry => {
            if (!entry.apptId) return;
            const appt = await fetchAppointmentById(entry.apptId).catch(() => null);
            if (!appt) {
              showToast('Could not load appointment. Try refreshing.', 4000);
              return;
            }
            addApptToTicket(appt);
            updateWaitlistEntry(entry.id, { status: 'done' }).catch(() => {});
            showToast(`Added ${appt.clientName || 'walk-in'} to ticket`);
          }}
        />
      )}

      {/* Tech overlay filter pills — day view only, hidden when there are
          no techs (the empty state below carries the call-to-action). */}
      {viewMode === 'day' && (!isTech || showAll) && visibleTechNames && techs.length > 0 && (() => {
        // "Working today" = clocked in today (time clock) OR scheduled on a
        // configured shift; "Working right now" = currently clocked in OR within
        // today's shift window. Unified in techStatusFor (clock + shift), so the
        // filters work for clock-based salons like Meraki that set no shift hours.
        const techIsWorkingToday = (t) => techStatusFor(t).today;
        const techIsWorkingNow   = (t) => techStatusFor(t).now;
        const applyFilter = (predicate) => {
          const next = techs.filter(predicate);
          if (!next.length) showToast('No techs match that filter right now — showing all.');
          setVisibleTechNames(next.length ? next : techs);
          localStorage.setItem(OVERLAY_KEY, JSON.stringify(next.length ? next : techs));
        };
        const showAllTechs = () => { setVisibleTechNames(techs); localStorage.setItem(OVERLAY_KEY, JSON.stringify(techs)); };
        const Btn = ({ label, onClick, hint }) => (
          <button onClick={onClick} title={hint}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, border: '1.5px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            {label}
          </button>
        );
        return (
          <>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap', flexShrink: 0 }}>
              <Btn label="All techs" hint="Show every tech" onClick={showAllTechs} />
              <Btn label="Working today" hint="Show only techs scheduled to work today" onClick={() => applyFilter(techIsWorkingToday)} />
              {isToday && (
                <Btn label="Working right now" hint="Show only techs whose shift covers right now" onClick={() => applyFilter(techIsWorkingNow)} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap', flexShrink: 0 }}>
              {techs.map(t => {
                const on  = visibleTechNames.includes(t);
                const col = getTechColor(t, techs);
                return (
                  <button key={t} onClick={() => toggleTechVisible(t)} style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 20,
                    border: `1.5px solid ${on ? col.solid : 'var(--pn-border-strong)'}`,
                    background: on ? col.bg : 'var(--pn-surface-alt)',
                    color: on ? col.text : 'var(--pn-text-faint)',
                    cursor: 'pointer', fontFamily: 'inherit', fontWeight: on ? 600 : 400,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    {on && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: col.solid, flexShrink: 0 }} />}
                    {t}
                  </button>
                );
              })}
            </div>
          </>
        );
      })()}

      {/* Store closed banner — day view only */}
      {viewMode === 'day' && isStoreClosed && (
        <div style={{ background: 'var(--pn-danger-bg)', border: '1px solid #FECACA', borderRadius: 8, padding: '7px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 14 }}>🚫</span>
          <span style={{ fontSize: 12, color: 'var(--pn-danger)', fontWeight: 500 }}>Salon is closed today — appointments can still be booked manually</span>
        </div>
      )}

      {/* Client birthdays banner — day view only */}
      {viewMode === 'day' && birthdayClients.length > 0 && (
        <div style={{ background: 'var(--pn-warning-bg)', border: '1px solid #FED7AA', borderRadius: 8, padding: '7px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>🎂</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-warning)' }}>Client birthdays today:</span>
          {birthdayClients.map(c => (
            <span key={c.id} style={{ fontSize: 12, color: 'var(--pn-warning)', background: 'var(--pn-warning-bg)', borderRadius: 20, padding: '2px 10px', border: '1px solid #FED7AA' }}>
              {c.name}
            </span>
          ))}
        </div>
      )}

      {/* Staff birthdays banner — day view only */}
      {viewMode === 'day' && birthdayEmployees.length > 0 && (
        <div style={{ background: 'var(--pn-success-bg)', border: '1px solid #BBF7D0', borderRadius: 8, padding: '7px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>🎊</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-success)' }}>Staff birthdays today:</span>
          {birthdayEmployees.map(e => (
            <span key={e.id} style={{ fontSize: 12, color: 'var(--pn-success)', background: 'var(--pn-success-bg)', borderRadius: 20, padding: '2px 10px', border: '1px solid #BBF7D0' }}>
              {e.name}
            </span>
          ))}
        </div>
      )}

      {/* Personal view summary strip — day view only */}
      {viewMode === 'day' && myAppts && !loading && (
        <div style={{ background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', borderRadius: 10, padding: '10px 14px', marginBottom: 10, flexShrink: 0, color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {myAppts.length === 0 ? 'No appointments today' : `${myAppts.length} appointment${myAppts.length !== 1 ? 's' : ''} today`}
              </div>
              {nextAppt && (
                <div style={{ fontSize: 11, opacity: .85, marginTop: 2 }}>
                  Next: {nextAppt.clientName || 'Walk-in'} at {minsToStr(strToMins(nextAppt.startTime))}
                </div>
              )}
              {!nextAppt && myAppts.length > 0 && (
                <div style={{ fontSize: 11, opacity: .85, marginTop: 2 }}>All done for the day 🎉</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginLeft: 'auto', flexWrap: 'wrap' }}>
              {[['scheduled', '#DBEAFE', '#1e40af'], ['in-progress', '#FEF3C7', '#78350f'], ['done', '#D1FAE5', '#065f46']].map(([st, bg, fg]) => {
                const count = myAppts.filter(a => a.status === st).length;
                if (count === 0) return null;
                return (
                  <div key={st} style={{ background: bg, color: fg, fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap' }}>
                    {count} {st}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      {techs.length === 0 && !loading && !weekLoading ? (
        <NoTechsEmptyState />
      ) : viewMode === 'week'
        ? weekLoading
          ? <div style={{ textAlign: 'center', color: 'var(--pn-text-faint)', padding: 40, fontSize: 13 }}>Loading…</div>
          : <WeekGrid
              weekStart={weekStart}
              appts={isMultiLocation(locState) ? weekAppts.filter(a => appointmentInLocation(a, curLoc)) : weekAppts}
              clients={clients}
              employees={employees}
              allTechs={techs}
              onApptClick={appt => { setDate(appt.date); openView(appt); }}
              onDayClick={d => { setDate(d); setViewMode('day'); }}
            />
        : loading
          ? <div style={{ textAlign: 'center', color: 'var(--pn-text-faint)', padding: 40, fontSize: 13 }}>Loading…</div>
          : <DayGrid
              date={date}
              appts={visibleAppts}
              timeOff={timeOff}
              techs={orderedTechs}
              offToday={offTodaySet}
              dividerTech={firstOffTech}
              allTechs={techs}
              clients={clients}
              techExtended={techExtended}
              techWindows={techWindows}
              empWorkDays={empWorkDays}
              slots={slots}
              dayStart={dayStart}
              walkInOpen={walkInOpen}
              walkInClose={walkInClose}
              techColWidth={techColWidth}
              focusedTech={focusedTech}
              onToggleFocusTech={(name) => setFocusedTech(prev => prev === name ? null : name)}
              onSlotClick={openNew}
              onApptClick={openView}
              onApptReschedule={(apptId, newTech, newMins) => {
                if (scheduleReadOnly) return;
                const original = appts.find(a => a.id === apptId);
                if (!original) return;
                // startTime is stored as 24h "HH:mm" — minsToStr returns
                // a 12h display string ("2:00 PM"), which would corrupt
                // the field and leave the block unrenderable after save.
                const newStartTime = `${String(Math.floor(newMins / 60)).padStart(2, '0')}:${String(newMins % 60).padStart(2, '0')}`;
                if (newStartTime === original.startTime && newTech === original.techName) return;
                setModal({
                  appt: { ...original, techName: newTech, startTime: newStartTime },
                  original,
                  mode: 'edit',
                });
              }}
            />
      }

      {modal && (
        <ApptModal
          appt={modal.appt}
          mode={modal.mode}
          clients={clients}
          services={services}
          techs={techs}
          employees={employees}
          onChange={patch => setModal(m => ({ ...m, appt: { ...m.appt, ...patch } }))}
          onSwitchEdit={() => setModal(m => ({ ...m, mode: 'edit' }))}
          onSave={() => handleSave(modal.appt, modal.original, modal.pendingSeat)}
          onDelete={() => handleDelete(modal.appt)}
          onClose={() => setModal(null)}
          onBlockTime={(techName, dateStr, startTime) => {
            const sMin = startTime ? strToMins(startTime) : 9 * 60;
            const eMin = Math.min(sMin + 60, 23 * 60 + 59);
            const to24 = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
            setBlockPrefill({ techName: techName || '', date: dateStr || todayStr(), start: startTime || '09:00', end: to24(eMin) });
            setModal(null);
            setShowTimeOff(true);
          }}
          onCheckout={appt => { setModal(null); setCheckout({ appts: [appt], walkInClient: null }); }}
          onAddToTicket={appt => { setModal(null); addApptToTicket(appt); showToast(`Added ${appt.clientName || 'walk-in'} to ticket`); }}
          onRefund={appt => requestRefund(appt)}
          onOpenClient={(id) => { setModal(null); onOpenClient?.(id); }}
          onClientCreated={(c) => setClients(prev => [...prev, c].sort((a, b) => (a.name || '').localeCompare(b.name || '')))}
          isAdmin={isAdmin}
          viewOnly={scheduleReadOnly}
          onReload={load}
        />
      )}

      {checkout && (
        <CheckoutModal
          appts={checkout.appts}
          walkInClient={checkout.walkInClient}
          techs={techs}
          onComplete={() => { setCheckout(null); load(); }}
          onClose={() => setCheckout(null)}
        />
      )}

      {refund && (
        <RefundModal
          receipt={refund}
          onClose={() => setRefund(null)}
          onDone={(msg) => { if (msg) showToast(msg); setRefund(null); setModal(null); load(); }}
          showToast={showToast}
          commissionDefault={settings?.refundCommissionDefault === 'goodwill' ? 'goodwill' : 'withhold'}
        />
      )}

      {deleteDialog && (
        <RecurringDeleteDialog
          appt={deleteDialog}
          onDeleteOne={() => handleDeleteOne(deleteDialog)}
          onDeleteAll={() => handleDeleteSeries(deleteDialog)}
          onCancel={() => setDeleteDialog(null)}
        />
      )}

      {seriesConflict && (
        <SeriesConflictDialog
          dates={seriesConflict.dates}
          onSkip={() => confirmSeriesConflict('skip')}
          onForce={() => confirmSeriesConflict('force')}
          onCancel={() => confirmSeriesConflict('cancel')}
        />
      )}

      {seriesEdit && (
        <SeriesEditDialog
          appt={seriesEdit.appt}
          onScope={(scope) => applySeriesEdit(scope)}
          onCancel={() => setSeriesEdit(null)}
        />
      )}

      <VoiceAssistant clients={clients} services={services} techs={techs} employees={employees} />

      {/* First-visit tip. Salon owners often miss the click-to-create +
          drag-to-reschedule + tech-focus interactions on first encounter
          with the day grid; one-time popover surfaces them. */}
      <CoachMark
        id="schedule_intro"
        title="A few schedule shortcuts"
        body="Click any empty slot to book an appointment. Drag an existing one to reschedule it. Tap a tech's name at the top of a column to zoom into just that tech's day."
      />
    </div>
  );
}

// ── Turn rotation helpers ─────────────────────────────
// Pick the next "up" tech from the roster: lowest turnsTaken first, then
// earliest clockInAt as the tiebreaker. Returns null if roster is empty.
function nextUpInRotation(roster) {
  if (!roster || roster.length === 0) return null;
  const sorted = [...roster].sort((a, b) => {
    if (!!a.serving !== !!b.serving) return a.serving ? 1 : -1;   // on a ticket → sinks
    const ta = a.turnsTaken || 0, tb = b.turnsTaken || 0;
    if (ta !== tb) return ta - tb;
    return (a.clockInAt || '').localeCompare(b.clockInAt || '');
  });
  return sorted[0];
}

function fmtClockIn(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtTurns(n) {
  const t = Number(n) || 0;
  const v = t % 1 === 0 ? t : t.toFixed(1);
  return `${v} turn${t === 1 ? '' : 's'}`;
}

// Plain-language reason a tech sits where they do in the walk-in rotation —
// mirrors the sort in nextUpInRotation: on a ticket sinks → fewest turns →
// earliest clock-in breaks ties. `sorted` is the already-ordered roster.
// Shown as the hover tooltip on each tech chip.
function rotationReason(r, i, sorted) {
  const turns = Number(r.turnsTaken) || 0;
  const clock = fmtClockIn(r.clockInAt);
  if (r.serving) {
    return `On a ticket right now — drops to the back of the rotation until checkout. ${fmtTurns(turns)} today${clock ? `, clocked in ${clock}` : ''}.`;
  }
  if (i === 0) {
    return `Next up — the rotation seats whoever has the fewest turns today (${fmtTurns(turns)})${clock ? `, clocked in ${clock}` : ''}. Earliest clock-in breaks ties.`;
  }
  const ahead = sorted[i - 1];
  const aheadTurns = Number(ahead.turnsTaken) || 0;
  let because;
  if (turns > aheadTurns) {
    because = `more turns so far than ${ahead.techName} (${fmtTurns(turns)} vs ${fmtTurns(aheadTurns)})`;
  } else if (turns === aheadTurns) {
    because = `tied with ${ahead.techName} on ${fmtTurns(turns)}, but clocked in later${clock ? ` (${clock})` : ''}`;
  } else {
    because = `behind ${ahead.techName} in the rotation`;
  }
  return `#${i + 1} of ${sorted.length} — ${because}. Moves up as the techs ahead take walk-ins.`;
}

// One tech pill in the walk-in rotation, with a styled hover/tap tooltip that
// explains why they're in this slot. Uses a real popover (not the native
// title=) because native tooltips don't appear on the iPad kiosk's touch and
// lag on desktop. Hover shows it; tapping the chip toggles it (touch); the
// clock-out × stops propagation so it doesn't toggle the tip.
function RotationChip({ r, i, sorted, onRemove, onAdjust, turnMode, detail }) {
  const [show, setShow] = useState(false);
  const [pinned, setPinned] = useState(false);
  const t = Number(r.turnsTaken) || 0;
  const turns = t % 1 === 0 ? t : t.toFixed(1);
  const fmtTv = (v) => { const n = Number(v) || 0; return `${n % 1 === 0 ? n : n.toFixed(1)} turn${n === 1 ? '' : 's'}`; };
  const stepBtn = (delta, label) => (
    <button onClick={(e) => { e.stopPropagation(); onAdjust(r.techId, delta); }}
      title={`${delta > 0 ? 'Add' : 'Remove'} half a turn`} disabled={delta < 0 && t <= 0}
      style={{ width: 17, height: 17, borderRadius: 5, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: (delta < 0 && t <= 0) ? 'default' : 'pointer', opacity: (delta < 0 && t <= 0) ? .4 : 1, fontSize: 12, lineHeight: 1, padding: 0, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{label}</button>
  );
  return (
    <div
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setPinned(p => !p)}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 20, background: i === 0 ? 'var(--pn-success-bg)' : 'var(--pn-bg)', border: `1px solid ${i === 0 ? '#c6e8d5' : 'var(--pn-border)'}`, cursor: 'pointer' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? 'var(--pn-success)' : 'var(--pn-text-muted)' }}>#{i + 1}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text)' }}>{r.techName}</span>
      <span style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>{fmtClockIn(r.clockInAt)}</span>
      {onAdjust && (
        <span onClick={e => e.stopPropagation()} title="Adjust this tech's turn count by half a turn"
          style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'default' }}>
          {stepBtn(-0.5, '−')}
          <span style={{ fontSize: 10, color: 'var(--pn-text-faint)', minWidth: 40, textAlign: 'center' }}>{turns} turn{t === 1 ? '' : 's'}</span>
          {stepBtn(0.5, '+')}
        </span>
      )}
      <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Remove ${r.techName} from the walk-in rotation?\n\nYou can add them back with "+ Clock in", but their turn count resets to 0.`)) onRemove(r.techId); }} title="Remove from rotation"
        style={{ background: 'none', border: 'none', color: 'var(--pn-text-faint)', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, marginLeft: 2, fontFamily: 'inherit' }}>×</button>
      {(show || pinned) && (
        <div role="tooltip" style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 60,
          width: 270, maxWidth: '80vw', maxHeight: 260, overflowY: 'auto', background: 'var(--pn-text)', color: 'var(--pn-surface)',
          fontSize: 11.5, lineHeight: 1.5, fontWeight: 500, textAlign: 'left',
          padding: '8px 10px', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.28)', pointerEvents: pinned ? 'auto' : 'none',
        }}>
          {rotationReason(r, i, sorted)}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.18)' }}>
            <div style={{ fontWeight: 700, opacity: .85, marginBottom: 4 }}>
              Completed today · {turns} turn{t === 1 ? '' : 's'}
            </div>
            {(!detail || detail.length === 0) ? (
              <div style={{ opacity: .7 }}>No completed services yet today.</div>
            ) : (
              <>
                {detail.map((it, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '1px 0' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.time ? minsToStr(strToMins(it.time)) + ' · ' : ''}{it.name}
                    </span>
                    <span style={{ flexShrink: 0, opacity: .85 }}>{fmtTv(it.tv)}</span>
                  </div>
                ))}
                {turnMode !== 'value' && (
                  <div style={{ marginTop: 5, opacity: .7, fontStyle: 'italic' }}>
                    Turns are counted 1 per visit (turn-value mode is off, so the per-service values above are informational).
                  </div>
                )}
              </>
            )}
          </div>
          {pinned && <div style={{ marginTop: 6, opacity: .55, fontSize: 10 }}>Tap the chip again to close.</div>}
        </div>
      )}
    </div>
  );
}

// ── Turn roster panel — today's walk-in rotation ──────
function TurnRosterPanel({ roster, allTechs, onAddTech, onRemoveTech, onAdjustTurns, onResetDay, onRecount, onReplay, turnMode, turnDetailFor }) {
  const [showPicker, setShowPicker] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const inRoster = new Set(roster.map(r => r.techId));
  const available = (allTechs || []).filter(t => !inRoster.has(t.id));
  const sorted = [...roster].sort((a, b) => {
    if (!!a.serving !== !!b.serving) return a.serving ? 1 : -1;   // on a ticket → sinks
    const ta = a.turnsTaken || 0, tb = b.turnsTaken || 0;
    if (ta !== tb) return ta - tb;
    return (a.clockInAt || '').localeCompare(b.clockInAt || '');
  });
  const next = sorted[0];

  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, marginBottom: 12, overflow: 'visible', flexShrink: 0, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--pn-border)', background: 'var(--pn-bg)', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', flex: 1, minWidth: 0 }}>
          🎯 Walk-in turn order
          <button onClick={() => setShowHelp(true)} title="How the turn system works"
            style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--pn-info)', background: 'var(--pn-info-bg)', border: '1px solid #bfdbfe', borderRadius: 20, padding: '2px 9px', cursor: 'pointer', fontFamily: 'inherit' }}>
            ? How turns work
          </button>
          {next && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--pn-success)', background: 'var(--pn-success-bg)', borderRadius: 20, padding: '2px 10px', border: '1px solid #c6e8d5' }}>Next up: {next.techName}</span>}
        </span>
        {showHelp && <TurnHelpModal onClose={() => setShowHelp(false)} />}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowPicker(o => !o)} disabled={available.length === 0}
            style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: available.length === 0 ? '#ccc' : 'var(--tm-primary, #2D7A5F)', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: available.length === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            + Clock in
          </button>
          {showPicker && available.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 50, minWidth: 180, maxHeight: 280, overflowY: 'auto' }}>
              {available.map(t => (
                <button key={t.id} onClick={() => { onAddTech(t); setShowPicker(false); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, color: 'var(--pn-text)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderBottom: '1px solid var(--pn-border)' }}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {onReplay && (
          <button onClick={onReplay}
            title="Replay how the rotation played out on any day"
            style={{ fontSize: 11, color: 'var(--pn-info)', background: 'var(--pn-info-bg)', border: '1px solid #bfdbfe', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
            ▶ Replay the day
          </button>
        )}
        {roster.length > 0 && (
          <button onClick={onRecount}
            title="Rebuild turn counts from today's completed appointments"
            style={{ fontSize: 11, color: 'var(--pn-info)', background: 'var(--pn-info-bg)', border: '1px solid #bfdbfe', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
            ↺ Recount
          </button>
        )}
        {roster.length > 0 && (
          <button onClick={onResetDay}
            style={{ fontSize: 11, color: 'var(--pn-text-muted)', background: 'none', border: '1px solid var(--pn-border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
            Reset day
          </button>
        )}
      </div>
      {roster.length === 0 ? (
        <div style={{ padding: '14px', fontSize: 12, color: 'var(--pn-text-faint)', textAlign: 'center' }}>
          No techs clocked in yet. Click <strong style={{ color: 'var(--pn-text-muted)' }}>+ Clock in</strong> as people arrive — the rotation order is determined by clock-in time.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 10 }}>
          {sorted.map((r, i) => (
            <RotationChip key={r.techId} r={r} i={i} sorted={sorted} onRemove={onRemoveTech} onAdjust={onAdjustTurns} turnMode={turnMode} detail={turnDetailFor ? turnDetailFor(r.techName) : null} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Queue panel ───────────────────────────────────────
function QueuePanel({ entries, turnRoster, onAutoSeatNext, onSeat, onRemove, onDone, onAddToTicket }) {
  const waiting  = entries.filter(e => e.status === 'waiting');
  const arrived  = entries.filter(e => e.status === 'waiting' && e.hasAppointment);
  const done     = entries.filter(e => ['seated','done','removed'].includes(e.status));

  function waitTime(iso) {
    const mins = Math.round((Date.now() - new Date(iso)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins/60)}h ${mins%60}m`;
  }

  const kioskUrl = `${window.location.origin}/?queue`;

  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, marginBottom: 12, overflow: 'hidden', flexShrink: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--pn-border)', background: 'var(--pn-bg)', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', flex: 1, minWidth: 0 }}>
          📋 Today's Queue
          {waiting.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#fff', background: '#ef4444', borderRadius: 20, padding: '1px 7px' }}>{waiting.length}</span>}
        </span>
        <a href={kioskUrl} target="_blank" rel="noreferrer"
          style={{ fontSize: 11, color: '#3D95CE', textDecoration: 'none', fontWeight: 600, padding: '4px 10px', border: '1px solid #3D95CE', borderRadius: 20 }}>
          Open Kiosk ↗
        </a>
      </div>

      {waiting.length === 0 && done.length === 0 ? (
        <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--pn-text-faint)', textAlign: 'center' }}>Queue is empty — clients can add themselves at <strong style={{ color: '#3D95CE' }}>/?queue</strong></div>
      ) : (
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {waiting.map((entry, i) => {
            const canCheckout = entry.hasAppointment && entry.apptId;
            return (
              <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid var(--pn-border)' }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: entry.hasAppointment ? 'var(--pn-info-bg)' : 'var(--pn-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: entry.hasAppointment ? 'var(--pn-info)' : 'var(--pn-success)', flexShrink: 0 }}>
                  {entry.hasAppointment ? '📅' : i + 1 - arrived.filter((_, j) => j < arrived.indexOf(entry)).length}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{entry.clientName}</span>
                    {entry.hasAppointment && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: 'var(--pn-info-bg)', color: 'var(--pn-info)', border: '1px solid #93C5FD' }}>Has appt</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 1 }}>
                    {entry.serviceName || '—'}
                    {entry.techName && entry.techName !== 'Any' ? ` · ${entry.techName}` : ' · Any tech'}
                    <span style={{ marginLeft: 6, color: 'var(--pn-text-faint)' }}>· {waitTime(entry.addedAt)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {!entry.hasAppointment && turnRoster && turnRoster.length > 0 && (
                    <button onClick={() => onAutoSeatNext(entry)} title={`Auto-seat with the next tech in rotation (${nextUpInRotation(turnRoster)?.techName || ''})`}
                      style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--tm-primary, #2D7A5F)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      🎯 Next
                    </button>
                  )}
                  {!entry.hasAppointment && (
                    <button onClick={() => onSeat(entry)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #c6e8d5', background: 'var(--pn-success-bg)', color: 'var(--pn-success)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Manual assignment
                    </button>
                  )}
                  {canCheckout && (
                    <button onClick={() => onAddToTicket(entry)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #bfdbfe', background: 'var(--pn-info-bg)', color: 'var(--pn-info)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      🧾 Add to ticket
                    </button>
                  )}
                  <button onClick={() => onRemove(entry)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
          {done.length > 0 && (
            <div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', borderTop: '1px solid var(--pn-border)', background: 'var(--pn-bg)' }}>
              Completed today ({done.length})
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Week grid ─────────────────────────────────────────
function WeekGrid({ weekStart, appts, clients, employees, allTechs, onApptClick, onDayClick }) {
  const today = todayStr();
  const days  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  // O(1) client lookup keyed by id — avoids an O(clients) .find() per
  // appointment block (×~600 clients ×N appts every render).
  const clientById = useMemo(() => new Map((clients || []).map(c => [c.id, c])), [clients]);

  // Birthday map: date → [names]
  const bdayMap = {};
  [...clients, ...employees].forEach(p => {
    if (!p.birthday) return;
    const md = p.birthday.slice(5, 10);
    days.forEach(d => {
      if (d.slice(5, 10) === md) {
        if (!bdayMap[d]) bdayMap[d] = [];
        bdayMap[d].push(p.name);
      }
    });
  });

  // Total appointments this week
  const weekTotal = appts.filter(a => !a._demo).length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Week summary strip */}
      {weekTotal > 0 && (
        <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginBottom: 8, flexShrink: 0 }}>
          {weekTotal} appointment{weekTotal !== 1 ? 's' : ''} this week
          {[['scheduled','#3B82F6'],['in-progress','#F59E0B'],['done','#10B981'],['cancelled','#EF4444']].map(([s, c]) => {
            const n = appts.filter(a => a.status === s).length;
            if (!n) return null;
            return <span key={s} style={{ marginLeft: 8, color: c, fontWeight: 600 }}>{n} {s}</span>;
          })}
        </div>
      )}

      {/* 7-column grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))', gap: 4, overflowX: 'auto', overflowY: 'hidden' }}>
        {days.map(day => {
          const isToday   = day === today;
          const dayAppts  = appts.filter(a => a.date === day).sort((a, b) => strToMins(a.startTime) - strToMins(b.startTime));
          const bdays     = bdayMap[day] || [];
          const headerFmt = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

          return (
            <div key={day} style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${isToday ? '#3D95CE' : 'var(--pn-border)'}`, borderRadius: 8, overflow: 'hidden', background: 'var(--pn-surface)', minHeight: 0 }}>

              {/* Day header */}
              <div onClick={() => onDayClick(day)} style={{
                padding: '7px 8px', cursor: 'pointer', flexShrink: 0,
                background: isToday ? 'var(--pn-info-bg)' : 'var(--pn-bg)',
                borderBottom: `2px solid ${isToday ? '#3D95CE' : 'var(--pn-border)'}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: isToday ? 'var(--pn-info)' : 'var(--pn-text)' }}>{headerFmt}</div>
                <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 1 }}>
                  {dayAppts.length ? `${dayAppts.length} appt${dayAppts.length !== 1 ? 's' : ''}` : 'open'}
                </div>
                {bdays.length > 0 && (
                  <div style={{ fontSize: 9, color: '#EA580C', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    🎂 {bdays.join(', ')}
                  </div>
                )}
              </div>

              {/* Appointment list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '4px 3px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dayAppts.length === 0
                  ? <div style={{ fontSize: 10, color: 'var(--pn-border)', textAlign: 'center', paddingTop: 14 }}>—</div>
                  : dayAppts.map(appt => {
                      const col         = getTechColor(appt.techName, allTechs || []);
                      const dot         = STATUS_DOT[appt.status] || STATUS_DOT.scheduled;
                      const isCancelled = appt.status === 'cancelled';
                      const isDone      = appt.status === 'done';
                      const blockBg     = isCancelled ? 'var(--pn-danger-bg)' : isDone ? 'var(--pn-surface-muted)' : col.bg;
                      const blockBorder = isCancelled ? '#EF4444' : isDone ? 'var(--pn-border-strong)' : col.solid;
                      const blockText   = isCancelled ? 'var(--pn-danger)' : isDone ? 'var(--pn-text-muted)' : col.text;
                      // Allergy lookup — surfaces a ⚠ on the block so the
                      // tech sees it before opening the appt. Falls back
                      // to no-op for walk-ins / unlinked appts.
                      const apptAllergies = appt.clientId
                        ? (clientById.get(appt.clientId)?.allergies || '')
                        : '';
                      return (
                        <div key={appt.id} onClick={e => { e.stopPropagation(); onApptClick(appt); }}
                          style={{ padding: '3px 5px', borderRadius: 5, background: blockBg, borderLeft: `3px solid ${blockBorder}`, cursor: 'pointer', opacity: isCancelled ? 0.6 : 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: blockText, lineHeight: 1.2, flex: 1 }}>
                              {minsToStr(strToMins(appt.startTime))}
                            </div>
                            {!!apptAllergies && (
                              <span title={`Allergies: ${apptAllergies}`} style={{ fontSize: 12, color: '#b45309', lineHeight: 1, fontWeight: 700 }}>⚠</span>
                            )}
                            {appt.techRequestType === 'specific' ? (
                              <span title="Client asked for this tech" style={{ fontSize: 13, color: '#ef4444', lineHeight: 1, fontWeight: 700 }}>★</span>
                            ) : appt.techRequestType === 'auto' ? (
                              <span title="No preference — picked automatically" style={{ fontSize: 10, lineHeight: 1 }}>🎲</span>
                            ) : (
                              <span title="Front desk assigned this tech" style={{ fontSize: 10, lineHeight: 1 }}>📋</span>
                            )}
                            <span style={{ fontSize: 8, color: dot.color }}>{dot.label}</span>
                          </div>
                          <div style={{ fontSize: 10, color: blockText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                            {appt.clientName || 'Walk-in'}
                          </div>
                          <div style={{ fontSize: 9, color: blockBorder, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, opacity: .8 }}>
                            {appt.techName}
                          </div>
                        </div>
                      );
                    })
                }
              </div>

              {/* Drill-down link */}
              <div onClick={() => onDayClick(day)} style={{ padding: '4px 8px', borderTop: '1px solid var(--pn-border)', fontSize: 10, color: '#3D95CE', cursor: 'pointer', textAlign: 'center', flexShrink: 0, background: 'var(--pn-bg)' }}>
                View day →
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Day grid ──────────────────────────────────────────
function DayGrid({ date, appts, timeOff = [], techs, offToday, dividerTech, allTechs, clients = [], techExtended, techWindows = {}, empWorkDays, slots, dayStart, walkInOpen, walkInClose, techColWidth, focusedTech, onToggleFocusTech, onSlotClick, onApptClick, onApptReschedule }) {
  // Pointer-event drag-to-reschedule. Works on both mouse and touch
  // (iPad/iPhone) — HTML5 D&D doesn't work on touch devices natively.
  // Dragging happens in two phases:
  //   1. onPointerDown stashes the candidate appt + start coords. Click
  //      still works at this point for short interactions.
  //   2. Once pointer moves >6px the drag becomes "active": we capture
  //      the pointer, render a translated ghost, and listen at the
  //      document level for move/up.
  const [drag, setDrag] = useState(null); // { id, startX, startY, dx, dy, hoverKey } or null
  const dragRef = useRef(null);
  dragRef.current = drag;
  // After a successful drop the browser still fires a `click` on the appt
  // block. Without this guard the click would re-open the appt in view mode
  // and overwrite the edit modal we just opened from the drop.
  const justDroppedRef = useRef(0);

  useEffect(() => {
    if (!drag) return;
    function onMove(e) {
      const cur = dragRef.current;
      if (!cur) return;
      const dx = e.clientX - cur.startX;
      const dy = e.clientY - cur.startY;
      // Walk the DOM at the pointer's coords to find the slot cell under it.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el?.closest?.('[data-slot-tech]');
      const hoverKey = cell ? `${cell.dataset.slotTech}:${cell.dataset.slotMins}` : null;
      setDrag({ ...cur, dx, dy, hoverKey, active: cur.active || Math.hypot(dx, dy) > 6 });
      if (cur.active || Math.hypot(dx, dy) > 6) e.preventDefault();
    }
    function onUp(e) {
      const cur = dragRef.current;
      setDrag(null);
      if (!cur || !cur.active) return; // a click, not a drag
      justDroppedRef.current = Date.now();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el?.closest?.('[data-slot-tech]');
      if (!cell) return;
      const tech = cell.dataset.slotTech;
      const mins = parseInt(cell.dataset.slotMins, 10);
      if (!tech || !Number.isFinite(mins)) return;
      // If the drop target is a tech-off slot or a time-off block, ask
      // before reassigning. Mirrors the click-to-create confirm flow.
      const blockedType = cell.dataset.slotBlockedType;
      const blockedNotes = cell.dataset.slotBlockedNotes;
      const isOffCell    = cell.dataset.slotOff === '1';
      if (blockedType) {
        const notes = blockedNotes ? ` — "${blockedNotes}"` : '';
        const ok = window.confirm(`${tech} is on ${blockedType}${notes} on this day.\n\nReschedule to this slot anyway?`);
        if (!ok) return;
      } else if (isOffCell) {
        const ok = window.confirm(`${tech} is not scheduled to work then.\n\nReschedule to this slot anyway?`);
        if (!ok) return;
      }
      onApptReschedule && onApptReschedule(cur.id, tech, mins);
    }
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup',   onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [drag?.id]); // eslint-disable-line
  const TIME_COL = 54;
  const TECH_COL = techColWidth || 120;
  const dow = dayOfWeek(date);
  // O(1) client lookup keyed by id — avoids an O(clients) .find() per
  // appointment overlay block (×~600 clients) on every render, including
  // every pointermove frame during a drag.
  const clientById = useMemo(() => new Map((clients || []).map(c => [c.id, c])), [clients]);

  // Per-(tech, appt) overlap layout: { lane, laneCount }. This sweep-line
  // clustering is O(appts log appts) and depends ONLY on the day's appts +
  // tech columns — NOT on drag state. Memoizing it means a drag (which fires
  // setDrag on every pointermove) no longer rebuilds the whole layout each
  // frame; the moving block is repositioned via transform instead.
  const layoutById = useMemo(() => {
    // Standard sweep-line: sort by startTime, place each appt in the
    // lowest free lane, expand laneCount whenever a cluster grows.
    const map = {};
    techs.forEach(techName => {
      const techAppts = appts
        .filter(a => a.techName === techName && a.status !== 'cancelled')
        .map(a => ({
          id: a.id,
          start: strToMins(a.startTime || '00:00'),
          end: strToMins(a.startTime || '00:00') + (Number(a.duration) || 60),
        }))
        .sort((x, y) => x.start - y.start || y.end - x.end);
      // Cluster: appts that all transitively overlap. Lay each out.
      let cluster = [];
      const flush = () => {
        if (!cluster.length) return;
        // Greedy lane assignment within the cluster.
        const lanes = []; // each lane = end-time of last appt placed
        cluster.forEach(c => {
          let laneIdx = lanes.findIndex(end => end <= c.start);
          if (laneIdx === -1) { laneIdx = lanes.length; lanes.push(0); }
          lanes[laneIdx] = c.end;
          c.lane = laneIdx;
        });
        const laneCount = lanes.length;
        cluster.forEach(c => { map[c.id] = { lane: c.lane, laneCount }; });
        cluster = [];
      };
      let clusterEnd = -1;
      techAppts.forEach(c => {
        if (c.start >= clusterEnd) flush();
        cluster.push(c);
        clusterEnd = Math.max(clusterEnd, c.end);
      });
      flush();
    });
    return map;
  }, [appts, techs]);

  const isToday = date === todayStr();
  const nowMins = isToday ? (new Date().getHours() * 60 + new Date().getMinutes()) : -1;
  const nowHour = isToday ? new Date().getHours() : -1;
  const nowLineTop = (isToday && nowMins >= dayStart && nowMins < dayStart + slots.length * 30)
    ? ((nowMins - dayStart) / 30) * SLOT_H
    : null;

  const hasApptOnlyZone = slots.some(m => m < walkInOpen || m >= walkInClose);

  return (
    <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', borderRadius: 10, border: '1px solid var(--pn-border)', background: 'var(--pn-surface)' }}>
      {/* Header row */}
      <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, background: 'var(--pn-bg)', borderBottom: '2px solid var(--pn-border)' }}>
        <div style={{ width: TIME_COL, flexShrink: 0 }} />
        {techs.map(tech => {
          const isOff = offToday ? offToday.has(tech) : (empWorkDays[tech]?.[dow]?.on === false);
          const col   = getTechColor(tech, allTechs || techs);
          const todayTimeOff = timeOffOnDate(timeOff, tech, date);
          const hasTimeOff = todayTimeOff.length > 0;
          const timeOffLabel = hasTimeOff
            ? (todayTimeOff[0].type === 'sick' ? '🩹 sick'
               : todayTimeOff[0].type === 'personal' ? '🏠 personal'
               : '🌴 vacation')
            : null;
          const isFocused = focusedTech === tech;
          const canFocus  = !!onToggleFocusTech;
          return (
            <div
              key={tech}
              onClick={canFocus ? () => onToggleFocusTech(tech) : undefined}
              title={canFocus ? (isFocused ? 'Click to back out and show all techs' : `Click to zoom into ${tech}'s schedule only`) : undefined}
              style={{ width: TECH_COL, flexShrink: 0, fontSize: 11, fontWeight: 600, color: isOff ? 'var(--pn-text-faint)' : col.text, textAlign: 'center', borderLeft: tech === dividerTech ? '2px solid var(--pn-border-strong)' : '1px solid var(--pn-border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: isOff ? 'var(--pn-bg)' : col.bg, paddingBottom: 6, cursor: canFocus ? 'pointer' : 'default', userSelect: 'none' }}>
              <div style={{ height: 3, background: isOff ? 'var(--pn-border-strong)' : col.solid, marginBottom: 6 }} />
              <div style={{ padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: canFocus ? 'underline dotted' : 'none', textUnderlineOffset: 3, textDecorationColor: 'var(--pn-text-faint)' }}>
                {isFocused ? `← ${tech}` : tech}
              </div>
              {isOff && (
                <div style={{ fontSize: 8, color: 'var(--pn-text-faint)', fontWeight: 500, letterSpacing: '.03em' }}>off today</div>
              )}
              {!isOff && hasTimeOff && (
                <div style={{ fontSize: 9, color: '#92400e', fontWeight: 700, letterSpacing: '.03em' }}>{timeOffLabel}</div>
              )}
              {!isOff && !hasTimeOff && hasApptOnlyZone && techExtended[tech] && (
                <div style={{ fontSize: 8, color: col.solid, fontWeight: 600, letterSpacing: '.03em', opacity: .8 }}>extended hrs</div>
              )}
              {isFocused && (
                <div style={{ fontSize: 8, color: col.solid, fontWeight: 700, letterSpacing: '.04em', opacity: .85, marginTop: 2 }}>FOCUSED · click to exit</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time slots */}
      <div style={{ position: 'relative' }}>
        {slots.map((slotMins) => {
          const inWalkIn    = slotMins >= walkInOpen && slotMins < walkInClose;
          const isBoundary  = slotMins === walkInClose && hasApptOnlyZone;
          const slotHour    = Math.floor(slotMins / 60);
          const isCurrentHr = isToday && slotHour === nowHour;
          const isPast      = isToday && slotMins + 30 <= nowMins;
          const isEvenHour  = slotHour % 2 === 0;
          const isHourStart = slotMins % 60 === 0;

          return (
          <div key={slotMins} style={{
            display: 'flex', height: SLOT_H, position: 'relative',
            borderBottom: isHourStart ? '1px solid var(--pn-border)' : '1px solid var(--pn-border)',
            background: isCurrentHr
              ? 'rgba(254,243,199,0.7)'
              : isPast
              ? 'rgba(0,0,0,.018)'
              : isEvenHour && inWalkIn
              ? 'rgba(248,250,252,1)'
              : 'transparent',
          }}>
            {isBoundary && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,rgba(245,158,11,.7),rgba(245,158,11,.1))', zIndex: 6, pointerEvents: 'none' }} />
            )}

            {/* Time label */}
            <div style={{ width: TIME_COL, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'flex-start', paddingRight: 6, paddingTop: 3, position: 'relative' }}>
              {slotMins % 60 === 0 && (
                <span style={{ fontSize: 12, color: isCurrentHr ? '#ef4444' : isPast ? 'var(--pn-text-faint)' : 'var(--pn-text-muted)', fontWeight: isCurrentHr ? 700 : 600 }}>
                  {minsToStr(slotMins)}
                </span>
              )}
              {isBoundary && (
                <span style={{ fontSize: 7, color: '#f59e0b', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', lineHeight: 1.2 }}>appt only</span>
              )}
            </div>

            {/* Tech cells */}
            {techs.map(tech => {
              const isOff  = offToday ? offToday.has(tech) : (empWorkDays[tech]?.[dow]?.on === false);
              const blockedBy = isSlotBlocked(timeOff, tech, date, slotMins);
              // `interactive` controls drag-drop reschedule (drop targets are
              // limited to slots where the tech is actually working).
              // `clickable` is broader — clicking an off / time-off slot still
              // works; we just gate the new-appt modal behind a confirm so
              // staff can't book over a tech's day off by mistake.
              const interactive = !isOff && !blockedBy;
              const clickable   = true;
              // Per-tech appointment-only zone: outside store hours but within
              // THIS tech's own appointment window (not a salon-wide window).
              const tw          = techWindows[tech];
              const inExtended  = !inWalkIn && techExtended[tech] && (!tw || (slotMins >= tw.open && slotMins < tw.close));
              const slotKey = `${tech}:${slotMins}`;
              // Drop hover lights up on every cell — interactive or not. The
              // onUp handler gates the actual reschedule with a confirm
              // when the drop lands on an off / time-off slot.
              const isDropHover = drag?.active && drag.hoverKey === slotKey;
              const tooltipBlocked = blockedBy
                ? `${tech} · ${blockedBy.type || 'time off'}${blockedBy.notes ? ` — ${blockedBy.notes}` : ''}`
                : null;
              return (
                <div
                  key={tech}
                  data-slot-tech={tech}
                  data-slot-mins={slotMins}
                  data-slot-off={isOff ? '1' : undefined}
                  data-slot-blocked-type={blockedBy?.type || undefined}
                  data-slot-blocked-notes={blockedBy?.notes || undefined}
                  onClick={() => {
                    if (Date.now() - justDroppedRef.current < 400) return;
                    if (blockedBy) {
                      const kind = blockedBy.type || 'time off';
                      const notes = blockedBy.notes ? ` — "${blockedBy.notes}"` : '';
                      const ok = window.confirm(`${tech} is on ${kind}${notes} on this day.\n\nBook this appointment anyway?`);
                      if (!ok) return;
                    } else if (isOff) {
                      const ok = window.confirm(`${tech} is not scheduled to work on ${dow.charAt(0).toUpperCase() + dow.slice(1)}.\n\nBook this appointment anyway?`);
                      if (!ok) return;
                    }
                    onSlotClick(tech, slotMins);
                  }}
                  style={{
                    width: TECH_COL, flexShrink: 0, borderLeft: tech === dividerTech ? '2px solid var(--pn-border-strong)' : '1px solid var(--pn-border)',
                    cursor: clickable ? 'pointer' : 'default',
                    position: 'relative',
                    background: isDropHover
                      ? 'rgba(45,122,95,.18)'
                      : blockedBy
                      ? 'repeating-linear-gradient(45deg,rgba(245,158,11,.10),rgba(245,158,11,.10) 6px,rgba(245,158,11,.22) 6px,rgba(245,158,11,.22) 12px)'
                      : isOff
                      ? 'repeating-linear-gradient(45deg,#fafafa,#fafafa 4px,#f0f0f0 4px,#f0f0f0 8px)'
                      : !inWalkIn
                      ? (inExtended ? 'rgba(59,130,246,.06)' : 'rgba(0,0,0,.025)')
                      : 'transparent',
                    outline: isDropHover ? '2px dashed #2D7A5F' : 'none',
                    outlineOffset: -2,
                  }}
                  title={
                    tooltipBlocked ? tooltipBlocked
                    : isOff ? `${tech} · off today`
                    : inWalkIn ? `${tech} · ${minsToStr(slotMins)}`
                    : inExtended ? `${tech} · appointment-only hours`
                    : `${tech} · outside store hours — confirm on save`
                  }
                >
                  {interactive && !drag && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .1s' }}
                         onMouseEnter={e => { e.currentTarget.style.background = inWalkIn ? 'rgba(59,130,246,.08)' : 'rgba(59,130,246,.13)'; if (e.currentTarget.firstChild) e.currentTarget.firstChild.style.opacity = '0.9'; }}
                         onMouseLeave={e => { e.currentTarget.style.background = ''; if (e.currentTarget.firstChild) e.currentTarget.firstChild.style.opacity = '0.22'; }}>
                      <span style={{ fontSize: 22, lineHeight: 1, fontWeight: 300, color: '#3D95CE', opacity: 0.22, transition: 'opacity .1s', pointerEvents: 'none', userSelect: 'none' }}>+</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          );
        })}

        {/* Now line */}
        {nowLineTop !== null && (
          <div style={{ position: 'absolute', top: nowLineTop, left: 0, right: 0, height: 2, background: '#ef4444', zIndex: 8, pointerEvents: 'none', boxShadow: '0 0 4px rgba(239,68,68,.4)' }}>
            <div style={{ position: 'absolute', left: TIME_COL - 5, top: -4, width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
          </div>
        )}

        {/* Appointment overlays — with overlap layout. We compute a layout
            map ahead of time so overlapping appts in the same tech column
            split width side-by-side (Google-Calendar style) instead of
            stacking on top of each other and hiding what's underneath. */}
        {(() => {
          // layoutById (sweep-line overlap clustering) is memoized above on
          // [appts, techs] so a drag's per-frame setDrag doesn't rebuild it.
          return appts.map(appt => {
          const techIdx = techs.indexOf(appt.techName);
          if (techIdx === -1) return null;
          const startMins = strToMins(appt.startTime);
          const topOffset = ((startMins - dayStart) / 30) * SLOT_H;
          const height    = Math.max((appt.duration / 30) * SLOT_H - 2, SLOT_H - 2);
          // Side-by-side lane geometry. If laneCount === 1 the block fills
          // the column as before. Cancelled appts aren't included in the
          // overlap clusters — they render full-width but at lower z.
          const layout = layoutById[appt.id] || { lane: 0, laneCount: 1 };
          const isOverlap = layout.laneCount > 1;
          // Width-aware split. If the equal split is comfortably readable
          // (>= 90px per lane), use Google-Calendar side-by-side. Only when
          // the lane would be too narrow do we fall back to the cascade
          // peek-out layout. This means a wide focused-tech column at 720px
          // can fit 7+ overlaps cleanly instead of cascading them.
          const equalLaneW = (TECH_COL - 4) / layout.laneCount;
          let laneW, laneLeft, laneZ;
          if (equalLaneW < 90 && layout.laneCount >= 2) {
            const step = Math.max(14, Math.min(22, (TECH_COL - 4) * 0.18));
            laneW    = (TECH_COL - 4) - step * (layout.laneCount - 1);
            laneLeft = layout.lane * step;
            laneZ    = 5 + layout.lane;
          } else {
            laneW    = equalLaneW;
            laneLeft = layout.lane * laneW;
            laneZ    = 5;
          }
          const left = TIME_COL + techIdx * TECH_COL + 2 + laneLeft;
          const col         = getTechColor(appt.techName, allTechs || techs);
          const dot         = STATUS_DOT[appt.status] || STATUS_DOT.scheduled;
          const isCancelled = appt.status === 'cancelled';
          const isDone      = appt.status === 'done';
          const blockBg     = isCancelled ? 'var(--pn-danger-bg)' : isDone ? 'var(--pn-surface-muted)' : col.bg;
          const blockBorder = isCancelled ? '#EF4444' : isDone ? 'var(--pn-border-strong)' : col.solid;
          const blockText   = isCancelled ? 'var(--pn-danger)' : isDone ? 'var(--pn-text-muted)' : col.text;

          // Done/cancelled appts shouldn't be reschedulable — they represent
          // historical state. Active scheduled appts are draggable.
          const isDraggable = !isDone && !isCancelled;
          const isBeingDragged = drag?.id === appt.id && drag.active;
          // Native tooltip — invaluable when the lane is too narrow to show
          // the full client name / services. Hover the block for full info.
          const svcSummary = (appt.services || []).map(s => s.name || s.customName).filter(Boolean).join(', ');
          const tooltipText = [
            appt.clientName || 'Walk-in',
            `${minsToStr(startMins)} · ${appt.duration} min`,
            svcSummary || '(no service)',
            appt.techName,
            isOverlap ? `Overlap ${layout.lane + 1} of ${layout.laneCount}` : null,
          ].filter(Boolean).join('\n');
          return (
            <div
              key={appt.id}
              title={tooltipText}
              onClick={e => {
                e.stopPropagation();
                // If we just finished an active drag, suppress the click so
                // it doesn't re-open the appt in view mode and clobber the
                // edit modal opened from the drop.
                if (Date.now() - justDroppedRef.current < 400) return;
                onApptClick(appt);
              }}
              onPointerDown={isDraggable ? (e) => {
                if (e.button !== undefined && e.button !== 0) return;
                setDrag({ id: appt.id, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, hoverKey: null, active: false });
              } : undefined}
              style={{
                position: 'absolute',
                top: topOffset + 1,
                left,
                width: Math.max(laneW - 2, 30),
                height,
                background: blockBg,
                border: `1px solid ${isCancelled ? '#fca5a5' : isDone ? '#d1d5db' : col.solid}`,
                borderLeft: `3px solid ${blockBorder}`,
                borderRadius: 6,
                padding: isOverlap ? '2px 4px' : '3px 5px',
                cursor: isDraggable ? (isBeingDragged ? 'grabbing' : 'grab') : 'pointer',
                overflow: 'hidden',
                zIndex: isBeingDragged ? 20 : laneZ,
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                opacity: isCancelled ? 0.55 : 1,
                transform: isBeingDragged ? `translate(${drag.dx}px, ${drag.dy}px)` : 'none',
                boxShadow: isBeingDragged ? '0 6px 18px rgba(0,0,0,.25)' : 'none',
                touchAction: isDraggable ? 'none' : 'auto',
                userSelect: 'none',
                // While ANY drag is active, ALL appt overlays must be
                // pointer-transparent — not just the one being dragged.
                // Otherwise elementFromPoint hits a sibling overlay and
                // closest('[data-slot-tech]') returns null, silently
                // killing the drop. This lets the user reschedule onto a
                // slot already filled by another appt (i.e., create an
                // overlap by drag-dropping into an occupied lane).
                pointerEvents: drag?.active ? 'none' : 'auto',
                transition: isBeingDragged ? 'none' : 'opacity .12s, box-shadow .12s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {!isOverlap && (
                  appt.techRequestType === 'specific' ? (
                    <span title="Client asked for this tech" style={{ fontSize: 14, color: '#ef4444', flexShrink: 0, lineHeight: 1, fontWeight: 700 }}>★</span>
                  ) : appt.techRequestType === 'auto' ? (
                    <span title="No preference — picked automatically" style={{ fontSize: 11, flexShrink: 0, lineHeight: 1 }}>🎲</span>
                  ) : (
                    <span title="Front desk assigned this tech" style={{ fontSize: 11, flexShrink: 0, lineHeight: 1 }}>📋</span>
                  )
                )}
                {(() => {
                  const allergies = appt.clientId
                    ? (clientById.get(appt.clientId)?.allergies || '')
                    : '';
                  return allergies ? (
                    <span title={`Allergies: ${allergies}`} style={{ fontSize: 12, color: '#b45309', fontWeight: 700, lineHeight: 1, flexShrink: 0 }}>⚠</span>
                  ) : null;
                })()}
                <div style={{ fontSize: isOverlap ? 11 : 13, fontWeight: 700, color: blockText, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {appt.clientName || 'Walk-in'}
                </div>
                <span title={appt.status} style={{ fontSize: 10, color: dot.color, flexShrink: 0, lineHeight: 1 }}>{dot.label}</span>
                {!isOverlap && appt.recurringGroupId && (
                  <span title={`Recurring · ${appt.recurringIndex}/${appt.recurringTotal}`} style={{ fontSize: 10, flexShrink: 0, lineHeight: 1 }}>🔁</span>
                )}
                {!isOverlap && appt.source === 'online_booking' && (
                  <span title="Online booking" style={{ fontSize: 10, background: blockBorder, color: '#fff', borderRadius: 4, padding: '1px 5px', fontWeight: 700, flexShrink: 0, lineHeight: 1.5 }}>WEB</span>
                )}
                {!isOverlap && appt.checkedInAt && (
                  <span title="Client checked in" style={{ fontSize: 10, background: blockBorder, color: '#fff', borderRadius: 4, padding: '1px 5px', fontWeight: 700, flexShrink: 0, lineHeight: 1.5 }}>IN</span>
                )}
              </div>
              <div style={{ fontSize: isOverlap ? 10 : 12, color: blockText, opacity: .85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                {appt.services?.map(s => s.name).filter(Boolean).join(', ') || (isOverlap ? minsToStr(startMins) : '—')}
              </div>
              {!isOverlap && height > SLOT_H && (
                <div style={{ fontSize: 11, color: blockText, opacity: .65, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {minsToStr(startMins)} · {appt.duration} min
                </div>
              )}
              {isOverlap && (
                <div style={{ position: 'absolute', top: 1, right: 2, fontSize: 8, fontWeight: 700, color: '#92400e', opacity: .65, lineHeight: 1, pointerEvents: 'none' }}>
                  {layout.lane + 1}/{layout.laneCount}
                </div>
              )}
            </div>
          );
          });
        })()}
      </div>
    </div>
  );
}

// ── Appointment modal ─────────────────────────────────
function ApptModal({ appt, mode, clients, services, techs, employees = [], onChange, onSwitchEdit, onSave, onDelete, onClose, onBlockTime, onCheckout, onAddToTicket, onRefund, onOpenClient, onClientCreated, viewOnly, isAdmin, onReload }) {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const { gUser, settings } = useApp();
  const [saving,    setSaving]    = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Inline service-history panel — always rendered when an existing
  // appointment has a linked client. Fetched once on mount; appointments
  // + imported GG receipts joined client-side, newest-first.
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history,        setHistory]        = useState(null);
  const [rebooking,      setRebooking]      = useState(false);
  const [expandedVisitId, setExpandedVisitId] = useState(null);
  // New-client mini-form state. Replaces the inline phone/email walk-in
  // panel — when the user has no client linked, they tap "+ Create new
  // client contact" and fill out a quick profile here. On save we mint a
  // real client doc, set appt.clientId/clientName, and the ClientSearch
  // above renders the new client as the linked one.
  const [newClientOpen,   setNewClientOpen]   = useState(false);
  const [newClient,       setNewClient]       = useState({ name: '', phone: '', email: '', birthday: '', notes: '' });
  const [newClientSaving, setNewClientSaving] = useState(false);
  // Banned-client guard — when an admin picks a banned client we surface a
  // visible warning and require an explicit override checkbox before saving.
  // Resets whenever the linked client changes.
  const [banOverrideAck, setBanOverrideAck] = useState(false);
  // Collapsible "More options" disclosure that hides infrequent fields
  // (the "Client asked for this tech" toggle, the recurring/Repeat
  // section). Auto-opens when an existing appt already has any of those
  // values set so the user doesn't lose track of an active setting.
  const [advancedOpen, setAdvancedOpen] = useState(
    appt.techRequestType === 'specific' || !!appt.recurrence
  );
  const linkedClient = clients.find(c => c.id === appt.clientId);
  const linkedBanned = !!linkedClient?.banned;
  useEffect(() => { setBanOverrideAck(false); }, [appt.clientId]);
  const [emailFocused,    setEmailFocused]    = useState(false);
  const [dupeCandidates,  setDupeCandidates]  = useState(null); // null | [{client, matchKind}]
  const emailSuggestionList = emailFocused ? emailSuggestions(newClient.email) : [];
  const emailVal      = (newClient.email || '').trim();
  const emailValid    = !emailVal || EMAIL_RE.test(emailVal);
  const showEmailErr  = !!emailVal && !emailValid && !emailFocused;
  const isView = mode === 'view';

  useEffect(() => {
    if (!appt.clientId || !appt.id) return;
    let cancelled = false;
    setHistoryLoading(true);
    // Pass the resolved client record (if loaded) so fetchClientVisits can
    // fan out on phone/email, surfacing prior walk-ins / imported receipts
    // / orphaned-duplicate-client visits that aren't linked to this id.
    const linkedClient = clients.find(c => c.id === appt.clientId);
    fetchClientVisits(appt.clientId, linkedClient)
      .then(rows => { if (!cancelled) setHistory(rows.filter(r => r.id !== appt.id)); })
      .catch(() => { if (!cancelled) setHistory([]); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [appt.clientId, appt.id, clients]);

  function copyCheckinLink() {
    const url = `${window.location.origin}?checkin=${appt.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  const isNew  = !appt.id;

  // While a name is being typed into ClientSearch, appt.clientName updates on
  // every keystroke — so the inline "new client" capture must NOT pop in until
  // the typed text matches no existing client (mirrors the search dropdown's
  // own filter). Otherwise it flashes over the still-open search results.
  const typedClientName = (appt.clientName || '').trim();
  const typedNameMatchesExisting = !appt.clientId && typedClientName.length > 0 &&
    clients.some(c => (c.name || '').toLowerCase().includes(typedClientName.toLowerCase()) || (c.phone || '').includes(typedClientName));

  function openNewClientForm() {
    // Pre-fill name with whatever was typed into ClientSearch as a
    // walk-in-style entry, and pre-fill any contact info already keyed.
    setNewClient({
      name:     (appt.clientName || '').trim(),
      phone:    (appt.clientPhone || '').trim(),
      email:    (appt.clientEmail || '').trim(),
      birthday: '',
      notes:    '',
    });
    setNewClientOpen(true);
  }

  async function saveNewClient() {
    const name      = (newClient.name  || '').trim();
    const rawPhone  = (newClient.phone || '').trim();
    const emailRaw  = (newClient.email || '').trim();
    const email     = emailRaw.toLowerCase();
    if (!name) { window.alert('Please enter the client\'s name.'); return; }

    // Phone: parse via libphonenumber-js — accepts US numbers without
    // country code (default) and international numbers when they start
    // with "+". Stored format is INTERNATIONAL (e.g. "+1 614 555 0123",
    // "+44 20 7946 0958") so it round-trips cleanly across countries.
    const phoneInfo = normalizePhone(rawPhone);
    if (!phoneInfo.empty && !phoneInfo.valid) {
      window.alert('Phone number is not valid. Enter a US phone like (614) 555-0123, or an international one with country code: +44 20 7946 0958.');
      return;
    }
    const phone = phoneInfo.formatted;
    if (!phone) { window.alert('Phone number is required for every client.'); return; }
    if (email && !EMAIL_RE.test(email)) { window.alert('That email address looks invalid.'); return; }

    // Duplicate check: scan the in-memory clients list for matches on
    // normalized phone digits or lowercased email. If any are found,
    // surface them in an inline picker so the user can either link to
    // an existing record or override and create a new one anyway.
    const phoneDigits = phoneInfo.digits;
    const dupes = clients
      .map(c => {
        const cDigits = normalizePhone(c.phone).digits;
        const cEmail  = (c.email || '').trim().toLowerCase();
        const phoneHit = !!(phoneDigits && cDigits && cDigits === phoneDigits);
        const emailHit = !!(email && cEmail && cEmail === email);
        if (!phoneHit && !emailHit) return null;
        return { client: c, matchKind: phoneHit && emailHit ? 'phone & email' : phoneHit ? 'phone' : 'email' };
      })
      .filter(Boolean);
    if (dupes.length) {
      setDupeCandidates(dupes);
      return;
    }

    await actuallyCreateClient(name, phone, emailRaw);
  }

  // Bypasses the duplicate-check; called by the picker's "Create new
  // anyway" button when the user has already seen the matches and decided
  // they really do want a new record (e.g., two family members sharing a
  // phone, or a stale duplicate they plan to clean up later).
  async function actuallyCreateClient(name, phone, emailRaw) {
    setNewClientSaving(true);
    try {
      const data = {
        name, phone, email: emailRaw,
        birthday:  newClient.birthday || '',
        notes:     newClient.notes || '',
        commPreferences: { appointmentSms: true, appointmentEmail: true, appointmentVoice: false, marketingSms: true, marketingEmail: true, marketingVoice: false },
        instagramTags: [], googleReviews: [], visits: [],
      };
      const id = await createClient(data);
      const created = { id, ...data };
      onClientCreated?.(created);
      onChange({ clientId: id, clientName: name, clientPhone: phone, clientEmail: emailRaw });
      logActivity('client_added', `${name}${phone ? ' · ' + phone : ''}${emailRaw ? ' · ' + emailRaw : ''} (from Schedule)`);
      setNewClientOpen(false);
      setDupeCandidates(null);
    } catch (e) {
      window.alert(`Could not create client: ${e.message || 'unknown error'}`);
    } finally {
      setNewClientSaving(false);
    }
  }

  function linkExistingFromPicker(client) {
    onChange({ clientId: client.id, clientName: client.name, clientPhone: client.phone || '', clientEmail: client.email || '' });
    setDupeCandidates(null);
    setNewClientOpen(false);
  }

  const totalDur = appt.services?.reduce((s, sv) => s + (Number(sv.duration) || 0), 0) || 0;

  function patchService(i, patch) {
    onChange({ services: appt.services.map((s, idx) => idx === i ? { ...s, ...patch } : s) });
  }

  function addService() {
    onChange({ services: [...(appt.services || []), { name: '', duration: 60, price: '' }] });
  }

  function removeService(i) {
    if (appt.services.length === 1) return;
    onChange({ services: appt.services.filter((_, idx) => idx !== i) });
  }

  function pickClient(clientId) {
    const c = clients.find(c => c.id === clientId);
    onChange({ clientId, clientName: c ? c.name : '' });
  }

  // The performing tech can have a per-service duration override (e.g. a
  // newer tech who needs more time). Resolve against the assigned tech so
  // the block length matches who's actually doing the service.
  const apptTech = employees.find(e => e.id === appt.techId || e.name === appt.techName) || null;

  function pickService(i, name) {
    const svc = services.find(s => s.name === name);
    const r = svc ? resolveServicePricing(svc, null, apptTech) : null;
    const duration = r?.duration || 60;
    // Clear any prior sub-service option when the base service changes.
    patchService(i, { name, optionId: null, optionName: null, duration, price: r != null ? r.price : (svc?.basePrice || '') });
  }

  // Sub-service / option picker: applies the option's price + duration
  // override (or add) for the chosen service, resolved against the
  // performing tech. Empty optionId reverts to the service's standard price.
  function pickOption(i, optionId) {
    const sv  = appt.services[i];
    const svc = services.find(s => s.name === sv?.name);
    const opt = optionId ? (svc?.options || []).find(o => o.id === optionId) || null : null;
    const r   = svc ? resolveServicePricing(svc, opt, apptTech) : null;
    patchService(i, {
      optionId:   opt ? opt.id : null,
      optionName: opt ? opt.name : null,
      duration:   r?.duration || sv?.duration || 60,
      price:      r != null ? r.price : (sv?.price ?? ''),
    });
  }

  // Toggle an optional add-on (a reference to another catalog service) for the
  // base service at line i. Adds/removes a separate service line tagged
  // addOnOf: <base service id> so it stacks its own price + time, resolved
  // against the performing tech. Mirrors the customer-booking add-on path.
  function toggleAddOn(baseDoc, addOnSvc) {
    const isOn = (appt.services || []).some(s => s.addOnOf === baseDoc.id && (s.id === addOnSvc.id || s.name === addOnSvc.name));
    if (isOn) {
      onChange({ services: (appt.services || []).filter(s => !(s.addOnOf === baseDoc.id && (s.id === addOnSvc.id || s.name === addOnSvc.name))) });
      return;
    }
    const opt = addOnSvc.options?.[0] || null;
    const r = resolveServicePricing(addOnSvc, opt, apptTech);
    onChange({ services: [...(appt.services || []), {
      id: addOnSvc.id, name: addOnSvc.name,
      optionId: opt?.id || null, optionName: opt?.name || null,
      duration: r.duration || 30, price: r.price ?? '',
      taxable: addOnSvc.taxable !== false, addOnOf: baseDoc.id,
    }] });
  }

  // Re-resolve every service's duration for the newly-assigned tech so their
  // per-service times take effect. Items carrying an explicit option override
  // (e.g. created via online booking) keep their resolved duration.
  function pickTechName(name) {
    // "No preference" sentinel — clears the assigned tech and marks the
    // appointment for automatic assignment (techRequestType 'auto').
    if (name === '__any__') {
      onChange({ techName: '', techRequestType: 'auto' });
      return;
    }
    const newTech = employees.find(e => e.name === name) || null;
    const next = (appt.services || []).map(sv => {
      if (sv.optionId) return sv;
      const svc = services.find(s => s.name === sv.name);
      if (!svc) return sv;
      const r = resolveServicePricing(svc, null, newTech);
      return { ...sv, duration: r.duration || sv.duration || 60, price: r.price };
    });
    // Picking a real tech leaves a client-requested ('specific') flag intact
    // but clears the 'auto' no-preference state to the scheduler default.
    const techRequestType = name
      ? (appt.techRequestType === 'specific' ? 'specific' : 'scheduler')
      : appt.techRequestType;
    onChange({ techName: name, services: next, techRequestType });
  }

  // Rebook-from-last-visit (#14): prefill the service list from this
  // client's most recent visit (appointments + imported receipts), dropping
  // removal-only line items and re-resolving price/duration for the tech.
  async function rebookFromLastVisit() {
    if (!appt.clientId || rebooking) return;
    setRebooking(true);
    try {
      let visits = history;
      if (!visits) visits = await fetchClientVisits(appt.clientId, linkedClient).catch(() => []);
      const rebookable = s => !(s.isRemoval || s.id === 'removal') && (s.name || s.customName);
      const last = (visits || []).find(v => (v.services || []).some(rebookable));
      if (!last) { window.alert('No prior visit with services found for this client.'); return; }
      const tech = employees.find(e => e.id === appt.techId || e.name === appt.techName) || null;
      const mapped = (last.services || []).filter(rebookable).map(s => {
        const svcDoc = services.find(d => d.id === s.id || d.name === s.name);
        const opt = s.optionId && svcDoc ? (svcDoc.options || []).find(o => o.id === s.optionId) || null : null;
        const r = svcDoc ? resolveServicePricing(svcDoc, opt, tech) : null;
        return {
          name:       s.name || '',
          customName: s.customName || '',
          id:         s.id,
          optionId:   s.optionId || null,
          optionName: s.optionName || (opt?.name ?? null),
          duration:   r?.duration ?? Number(s.duration) ?? 60,
          price:      r != null ? r.price : (s.price ?? ''),
        };
      });
      if (mapped.length) onChange({ services: mapped });
    } finally {
      setRebooking(false);
    }
  }

  // Save-time validation, consolidated into a single inline panel above
  // the form. Replaces a stack of blocking window.alert / window.confirm
  // popups (missing contact → banned-client → no service → out-of-hours)
  // that previously fired one after another. Each issue lives in either:
  //
  //   blockers  — Save button is disabled until they're resolved
  //   warnings  — Save proceeds in one click; user has already seen them
  //
  // Net effect for the salon owner: zero modal popups during a normal
  // save. Issues are visible in the form before they hit Save.
  const issues = (() => {
    if (isView) return [];
    const list = [];

    // BLOCKER · client must be contactable
    if (!appt.clientId) {
      const hasName  = !!(appt.clientName  || '').trim();
      const hasPhone = !!(appt.clientPhone || '').trim();
      const hasEmail = !!(appt.clientEmail || '').trim();
      if (!hasName) {
        list.push({ kind: 'block', icon: '👤', label: "Add the client's name (or pick one from the search above)." });
      } else if (!hasPhone && !hasEmail) {
        list.push({ kind: 'block', icon: '📞', label: "Add a phone or email — every appointment needs a way to reach the client." });
      }
    }

    // BLOCKER · banned client without override
    if (linkedBanned && !banOverrideAck) {
      list.push({ kind: 'block', icon: '🚫', label: `${linkedClient?.name || 'This client'} is banned. Tick the override checkbox below to proceed.` });
    }

    // WARN · no service selected
    const hasService = (appt.services || []).some(s => (s.name || s.customName || '').trim());
    if (!hasService) {
      list.push({ kind: 'warn', icon: '✂️', label: 'No service is selected. The appointment will save without one.' });
    }

    // WARN · out-of-hours / closed-day
    if (appt.date && appt.startTime) {
      const dur       = (appt.services || []).reduce((s, sv) => s + (Number(sv.duration) || 0), 0) || Number(appt.duration) || 60;
      const apptDow   = dayOfWeek(appt.date);
      const day       = settings?.storeHours?.[apptDow] || {};
      const startMins = strToMins(appt.startTime);
      const endMins   = startMins + dur;
      const fmtMins   = (m) => {
        const h = Math.floor(m / 60), mm = m % 60;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
        return `${hh}:${String(mm).padStart(2, '0')} ${ampm}`;
      };
      const dowLabel = apptDow.charAt(0).toUpperCase() + apptDow.slice(1);
      if (day.closed) {
        list.push({ kind: 'warn', icon: '🚫', label: `The salon is marked closed on ${dowLabel}. Booking will save anyway.` });
      } else if (day.open && day.close) {
        const openMins  = strToMins(day.open);
        const closeMins = strToMins(day.close);
        if (startMins < openMins) {
          list.push({ kind: 'warn', icon: '🕐', label: `Starts at ${fmtMins(startMins)} — before the salon opens at ${fmtMins(openMins)}.` });
        } else if (endMins > closeMins) {
          list.push({ kind: 'warn', icon: '🕐', label: `Ends at ${fmtMins(endMins)} (${dur}-minute duration) — after the salon closes at ${fmtMins(closeMins)}.` });
        }
      }
    }

    return list;
  })();
  const blockers = issues.filter(i => i.kind === 'block');
  const warnings = issues.filter(i => i.kind === 'warn');

  async function submit() {
    if (blockers.length) return; // Save is disabled at the button level
    if (linkedBanned && banOverrideAck) {
      logActivity('banned_booking_override',
        `Booked banned client ${linkedClient?.name || appt.clientName} (${appt.clientId}) with ${appt.techName} on ${appt.date} at ${appt.startTime}`);
    }
    setSaving(true);
    try { await onSave(); } finally { setSaving(false); }
  }

  // 'in-progress' (kiosk-only, decorative) and 'done' (set by Checkout, which
  // records the sale) are intentionally NOT manual options — completing an
  // appointment here would skip the sale. Use the Checkout button to complete.
  const statusOpts = [
    { value: 'scheduled',    label: 'Scheduled' },
    { value: 'cancelled',    label: 'Cancelled' },
    { value: 'no_show',      label: 'No-show' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 640, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {isNew ? 'New Appointment' : isView ? (appt.clientName || 'Walk-in') : 'Edit Appointment'}
            </span>
            {isView && !isNew && <ViewBadge />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isNew && !viewOnly && onBlockTime && (
              <button onClick={() => onBlockTime(appt.techName, appt.date, appt.startTime)}
                title="Block this time off instead — vacation, sick, a break"
                style={{ fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                🌴 Block time
              </button>
            )}
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>

          {/* Review panel — consolidated save-time validation. Shows
              every blocker / warning in one place so the user reviews
              everything once instead of clicking through a stack of
              browser confirms. */}
          {(blockers.length > 0 || warnings.length > 0) && (
            <div style={{
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 10,
              background: blockers.length > 0 ? 'var(--pn-danger-bg)' : 'var(--pn-warning-bg)',
              border: `1px solid ${blockers.length > 0 ? '#fca5a5' : '#fde68a'}`,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700,
                color: blockers.length > 0 ? 'var(--pn-danger)' : 'var(--pn-warning)',
                textTransform: 'uppercase', letterSpacing: '.05em',
                marginBottom: 6,
              }}>
                {blockers.length > 0
                  ? `Fix before saving (${blockers.length})`
                  : `Heads up (${warnings.length})`}
              </div>
              {blockers.map((b, i) => (
                <div key={`b${i}`} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--pn-danger)', lineHeight: 1.45, padding: '2px 0' }}>
                  <span style={{ flexShrink: 0 }}>{b.icon}</span>
                  <span>{b.label}</span>
                </div>
              ))}
              {warnings.map((w, i) => (
                <div key={`w${i}`} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--pn-warning)', lineHeight: 1.45, padding: '2px 0' }}>
                  <span style={{ flexShrink: 0 }}>{w.icon}</span>
                  <span>{w.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Status badge (view) or selector (edit) */}
          <div style={{ marginBottom: 12 }}>
            {isView ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <StatusChip status={appt.status} />
                {appt.checkedInAt && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'var(--pn-success-bg)', color: 'var(--pn-success)', border: '1px solid #bbf7d0' }}>
                    ✓ Checked in
                  </span>
                )}
                {appt.recurringGroupId && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'var(--pn-info-bg)', color: 'var(--pn-info)', border: '1px solid #c7dff7' }}>
                    🔁 {appt.recurringIndex}/{appt.recurringTotal}
                  </span>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                {statusOpts.map(o => {
                  const colors = STATUS_COLORS[o.value] || STATUS_COLORS.scheduled;
                  const active = appt.status === o.value;
                  return (
                    <button key={o.value} onClick={() => onChange({ status: o.value })}
                      style={{ flex: 1, fontSize: 10, padding: '5px 4px', borderRadius: 6, border: `1.5px solid ${active ? colors.border : 'var(--pn-border)'}`, background: active ? colors.bg : 'var(--pn-bg)', color: active ? colors.text : 'var(--pn-text-faint)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: active ? 600 : 400 }}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Client */}
          <Field label="Client">
            {isView ? (
              appt.clientId ? (
                <button
                  onClick={() => onOpenClient?.(appt.clientId)}
                  title="Open client profile"
                  style={{ background: 'none', border: 'none', padding: 0, margin: 0, fontFamily: 'inherit', fontSize: 14, color: '#3D95CE', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer' }}>
                  {appt.clientName || 'Walk-in'}
                </button>
              ) : (
                <ViewVal>{appt.clientName || 'Walk-in'}</ViewVal>
              )
            ) : (
              <ClientSearch
                clients={clients}
                clientId={appt.clientId}
                clientName={appt.clientName}
                onChange={patch => onChange(patch)}
              />
            )}
          </Field>

          {/* New-client contact capture — once a name is typed but no existing
              client is linked, collect a phone/email right here so SAVING the
              appointment mints (or links) a real client profile. No more
              "walk-in with name" dead-end; the "+ full details" form below
              stays available for birthday/notes. */}
          {!isView && !appt.clientId && typedClientName && !typedNameMatchesExisting && !newClientOpen && (
            <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--pn-warning-bg)', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: 11, color: 'var(--pn-warning)', fontWeight: 700, marginBottom: 7 }}>
                New client “{typedClientName}” — add a phone or email and we'll create their profile when you save.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="tel" inputMode="tel" autoComplete="off" placeholder="Phone  (614) 555-0123"
                  value={appt.clientPhone || ''}
                  onChange={e => onChange({ clientPhone: formatPhoneAsYouType(e.target.value) })}
                  style={{ ...inp, flex: 1, marginBottom: 0 }} />
                <input type="email" inputMode="email" autoComplete="off" placeholder="email (optional)"
                  value={appt.clientEmail || ''}
                  onChange={e => onChange({ clientEmail: e.target.value })}
                  style={{ ...inp, flex: 1, marginBottom: 0 }} />
              </div>
            </div>
          )}

          {/* Banned-client warning — surfaces when the linked client has
              banned: true. Requires explicit override checkbox before save. */}
          {!isView && linkedBanned && (
            <div style={{
              marginBottom: 12,
              padding: '12px 14px',
              background: 'var(--pn-danger-bg)',
              border: '1.5px solid #fca5a5',
              borderRadius: 10,
              fontSize: 13, color: 'var(--pn-danger)', lineHeight: 1.5,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 18 }}>🚫</span>
                <strong style={{ fontSize: 14 }}>This client is banned</strong>
              </div>
              <div style={{ marginBottom: 10, color: 'var(--pn-danger)' }}>
                <strong>{linkedClient?.name}</strong> is flagged as banned in the client profile — bookings should not be accepted.
              </div>
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 9,
                padding: '8px 10px', background: 'var(--pn-surface)',
                border: '1px solid #fca5a5', borderRadius: 8,
                cursor: 'pointer', fontSize: 12, color: 'var(--pn-danger)',
              }}>
                <input type="checkbox" checked={banOverrideAck} onChange={e => setBanOverrideAck(e.target.checked)} style={{ marginTop: 1 }} />
                <span>I understand this client is banned and want to book them anyway. <strong>This action will be logged.</strong></span>
              </label>
            </div>
          )}

          {/* New-client capture — required for unlinked appts (incl. walk-ins).
              Click the button to open a mini profile form. On save we mint a
              real client and link it to this appt. Hidden once a client is
              picked from the search above. */}
          {!isView && !appt.clientId && !newClientOpen && (
            <div style={{ marginBottom: 10 }}>
              <button onClick={openNewClientForm}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px dashed #fde68a', background: 'var(--pn-warning-bg)', color: 'var(--pn-warning)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                {(appt.clientName || '').trim() ? '+ Add full details (birthday, notes, duplicate check)' : '+ Create new client contact'}
              </button>
            </div>
          )}
          {!isView && !appt.clientId && newClientOpen && dupeCandidates && (
            <div style={{ marginBottom: 10, padding: '12px', borderRadius: 10, background: 'var(--pn-warning-bg)', border: '1px solid #fdba74' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--pn-warning)', fontWeight: 700 }}>
                  Possible duplicate{dupeCandidates.length > 1 ? 's' : ''} found ({dupeCandidates.length})
                </div>
                <button onClick={() => setDupeCandidates(null)} style={{ border: 'none', background: 'none', color: 'var(--pn-warning)', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--pn-warning)', opacity: .85, marginBottom: 8 }}>
                A client with that {dupeCandidates[0].matchKind} is already on file. Pick which one to use for this appointment, or create a new record anyway.
              </div>
              <div style={{ background: 'var(--pn-surface)', borderRadius: 8, border: '1px solid #fed7aa', overflow: 'hidden', marginBottom: 8 }}>
                {dupeCandidates.map(({ client, matchKind }, i) => (
                  <div key={client.id} style={{ padding: '10px 12px', borderBottom: i < dupeCandidates.length - 1 ? '1px solid #fed7aa' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {client.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayPhone(client.phone) || '—'}{client.email ? ' · ' + client.email : ''}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--pn-warning)', fontWeight: 600, marginTop: 2 }}>
                        Matched on {matchKind}
                      </div>
                    </div>
                    <button onClick={() => linkExistingFromPicker(client)}
                      title="Use this existing client for the current appointment"
                      style={{ padding: '6px 12px', border: 'none', background: '#3D95CE', color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                      Use this client
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setDupeCandidates(null)} disabled={newClientSaving}
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
                <button onClick={() => {
                  const phoneInfo = normalizePhone(newClient.phone);
                  actuallyCreateClient((newClient.name || '').trim(), phoneInfo.empty ? '' : phoneInfo.formatted, (newClient.email || '').trim());
                }} disabled={newClientSaving}
                  style={{ flex: 2, padding: '8px 10px', border: '1.5px solid #ea580c', background: 'var(--pn-surface)', color: '#9a3412', fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: newClientSaving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                  {newClientSaving ? 'Saving…' : 'Create new anyway'}
                </button>
              </div>
            </div>
          )}
          {!isView && !appt.clientId && newClientOpen && !dupeCandidates && (
            <div style={{ marginBottom: 10, padding: '12px', borderRadius: 10, background: 'var(--pn-warning-bg)', border: '1px solid #fde68a' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--pn-warning)', fontWeight: 700 }}>New client profile</div>
                <button onClick={() => setNewClientOpen(false)} style={{ border: 'none', background: 'none', color: 'var(--pn-warning)', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
              </div>
              <input placeholder="Full name *" value={newClient.name}
                onChange={e => setNewClient(p => ({ ...p, name: e.target.value }))}
                style={{ ...inp, marginBottom: 6 }} />
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input type="tel" inputMode="tel" placeholder="Phone *  (614) 555-0123  ·  +44 20 7946 0958" value={newClient.phone}
                  onChange={e => setNewClient(p => ({ ...p, phone: formatPhoneAsYouType(e.target.value) }))}
                  style={{ ...inp, flex: 1 }} />
                <div style={{ flex: 1, position: 'relative' }}>
                  <input type="email" inputMode="email" autoComplete="off" placeholder="name@example.com"
                    value={newClient.email}
                    onChange={e => setNewClient(p => ({ ...p, email: e.target.value }))}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setTimeout(() => setEmailFocused(false), 150)}
                    style={{ ...inp, width: '100%', borderColor: showEmailErr ? '#fca5a5' : 'var(--pn-border-strong)' }} />
                  {emailSuggestionList.length > 0 && (
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 2px)', background: 'var(--pn-surface)', border: '1px solid var(--pn-border-strong)', borderRadius: 8, zIndex: 220, maxHeight: 180, overflowY: 'auto', boxShadow: '0 6px 20px rgba(0,0,0,.12)' }}>
                      {emailSuggestionList.map(s => (
                        <div key={s}
                          onMouseDown={e => { e.preventDefault(); setNewClient(p => ({ ...p, email: s })); setEmailFocused(false); }}
                          style={{ padding: '7px 10px', fontSize: 12, color: 'var(--pn-text)', cursor: 'pointer', borderBottom: '1px solid var(--pn-border)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--pn-surface-alt)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          {s}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {showEmailErr && (
                <div style={{ fontSize: 11, color: 'var(--pn-danger)', marginBottom: 6, marginTop: -2 }}>That email address looks invalid.</div>
              )}
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input type="date" placeholder="Birthday" value={newClient.birthday}
                  onChange={e => setNewClient(p => ({ ...p, birthday: e.target.value }))}
                  style={{ ...inp, flex: 1 }} />
              </div>
              <textarea placeholder="Notes (optional)" rows={2} value={newClient.notes}
                onChange={e => setNewClient(p => ({ ...p, notes: e.target.value }))}
                style={{ ...inp, resize: 'vertical', marginBottom: 8 }} />
              <div style={{ fontSize: 10, color: 'var(--pn-warning)', opacity: .7, marginBottom: 8 }}>Phone or email required.</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setNewClientOpen(false)} disabled={newClientSaving}
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
                <button onClick={saveNewClient} disabled={newClientSaving}
                  style={{ flex: 2, padding: '8px 10px', border: 'none', background: newClientSaving ? '#ccc' : '#2D7A5F', color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: newClientSaving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                  {newClientSaving ? 'Saving…' : 'Save & link to appointment'}
                </button>
              </div>
            </div>
          )}

          {/* Tech + Date + Time row */}
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="Tech" style={{ flex: 2 }}>
              {isView ? (
                <ViewVal>{appt.techName || '—'}</ViewVal>
              ) : (
                <select value={appt.techRequestType === 'auto' && !appt.techName ? '__any__' : (appt.techName || '')} onChange={e => pickTechName(e.target.value)} style={inp}>
                  <option value="">Pick tech…</option>
                  <option value="__any__">🎲 No preference (any tech)</option>
                  {techs.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
            </Field>
            <Field label="Time" style={{ flex: 1 }}>
              {isView ? (
                <ViewVal>{appt.startTime ? minsToStr(strToMins(appt.startTime)) : '—'}</ViewVal>
              ) : (
                <input type="time" value={appt.startTime} onChange={e => onChange({ startTime: e.target.value })} style={inp} />
              )}
            </Field>
          </div>

          {/* Tech preference — surfaced inline right under the tech picker
              (was previously buried under "More options"). Edit mode shows
              the "client asked for this tech" toggle when a real tech is
              assigned; view mode shows whichever flag is active. */}
          {!isView && appt.techName && (
            <label style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${appt.techRequestType === 'specific' ? '#ef4444' : 'var(--pn-border)'}`, background: appt.techRequestType === 'specific' ? 'var(--pn-danger-bg)' : 'var(--pn-bg)', cursor: 'pointer' }}>
              <input type="checkbox"
                checked={appt.techRequestType === 'specific'}
                onChange={e => onChange({ techRequestType: e.target.checked ? 'specific' : 'scheduler' })}
                style={{ accentColor: '#ef4444', cursor: 'pointer' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: appt.techRequestType === 'specific' ? 'var(--pn-danger)' : 'var(--pn-text-muted)' }}>
                <span style={{ color: '#ef4444', fontWeight: 700, marginRight: 4 }}>★</span>
                Client asked for this tech
              </span>
            </label>
          )}
          {isView && appt.techRequestType === 'specific' && (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pn-text)', fontWeight: 600 }}>
              <span style={{ fontSize: 14, color: '#ef4444', fontWeight: 700 }}>★</span>
              Client asked for {appt.techName}
            </div>
          )}
          {isView && appt.techRequestType === 'auto' && !appt.techName && (
            <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--pn-text-muted)', fontWeight: 600 }}>
              🎲 No tech preference — assign automatically
            </div>
          )}

          {/* Date */}
          <Field label="Date">
            {isView ? (
              <ViewVal>{appt.date ? new Date(appt.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '—'}</ViewVal>
            ) : (
              <input type="date" value={appt.date} onChange={e => onChange({ date: e.target.value })} style={inp} />
            )}
          </Field>

          {/* Services */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>
                Services {totalDur > 0 && <span style={{ color: 'var(--pn-text-faint)' }}>· {totalDur} min total</span>}
              </label>
              {!isView && appt.clientId && (
                <button onClick={rebookFromLastVisit} disabled={rebooking} type="button"
                  title="Prefill the services from this client's most recent visit"
                  style={{ fontSize: 11, color: '#3D95CE', background: 'none', border: '1px solid #b3d4ef', borderRadius: 6, cursor: rebooking ? 'default' : 'pointer', padding: '3px 8px', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {rebooking ? 'Loading…' : '↻ Rebook last visit'}
                </button>
              )}
            </div>
            {(appt.services || []).map((svc, i) => (
              <div key={i} style={{ background: 'var(--pn-bg)', borderRadius: 8, border: '1px solid var(--pn-border)', padding: 8, marginBottom: 6 }}>
                {isView ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: 'var(--pn-text)' }}>{svc.name || '—'}</span>
                    <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>
                      {svc.duration ? `${svc.duration} min` : ''}{svc.price ? ` · $${svc.price}` : ''}
                    </span>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <select value={svc.name} onChange={e => pickService(i, e.target.value)} style={{ ...inp, flex: 2 }}>
                        <option value="">Pick service…</option>
                        {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                        <option value="__other__">Other</option>
                      </select>
                      {appt.services.length > 1 && (
                        <button onClick={() => removeService(i)} style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18, padding: '0 4px', flexShrink: 0 }}>×</button>
                      )}
                    </div>
                    {svc.name === '__other__' && (
                      <input value={svc.customName || ''} onChange={e => patchService(i, { customName: e.target.value })} placeholder="Service name" style={{ ...inp, marginBottom: 6 }} />
                    )}
                    {(() => {
                      // Sub-service options (e.g. Gel-X variants, nail-art tiers).
                      // Only render when the chosen service actually defines options.
                      const svcDoc = services.find(s => s.name === svc.name);
                      const opts = svcDoc?.options || [];
                      if (!opts.length) return null;
                      const base = resolveServicePricing(svcDoc, null, apptTech);
                      return (
                        <select value={svc.optionId || ''} onChange={e => pickOption(i, e.target.value)} style={{ ...inp, marginBottom: 6 }}>
                          <option value="">Standard · {base.duration} min · ${base.price}{svcDoc.priceFrom ? '+' : ''}</option>
                          {opts.map(o => {
                            const r = resolveServicePricing(svcDoc, o, apptTech);
                            return <option key={o.id} value={o.id}>{o.name} · {r.duration} min · ${r.price}{o.priceFrom ? '+' : ''}</option>;
                          })}
                        </select>
                      );
                    })()}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="number" min={5} step={5} value={svc.duration} onChange={e => patchService(i, { duration: Number(e.target.value) })}
                        placeholder="min" style={{ ...inp, width: 70 }} />
                      <span style={{ fontSize: 12, color: 'var(--pn-text-faint)', alignSelf: 'center' }}>min</span>
                      <input type="number" min={0} value={svc.price} onChange={e => patchService(i, { price: e.target.value })}
                        placeholder="price" style={{ ...inp, width: 70 }} />
                      <span style={{ fontSize: 12, color: 'var(--pn-text-faint)', alignSelf: 'center' }}>$</span>
                    </div>
                    {/* Add-on toggles — only on base lines (not on an add-on's
                        own line). Each toggle adds/removes a linked service line. */}
                    {!svc.addOnOf && (() => {
                      const svcDoc = services.find(s => s.name === svc.name);
                      const addOns = (svcDoc?.addOnServiceIds || []).map(id => services.find(s => s.id === id)).filter(a => a && a.active !== false);
                      if (!svcDoc || !addOns.length) return null;
                      return (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--pn-border)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>Add-ons</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {addOns.map(a => {
                              const on = (appt.services || []).some(s => s.addOnOf === svcDoc.id && (s.id === a.id || s.name === a.name));
                              const r = resolveServicePricing(a, a.options?.[0] || null, apptTech);
                              return (
                                <button key={a.id} type="button" onClick={() => toggleAddOn(svcDoc, a)}
                                  style={{ fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                                    border: `1.5px solid ${on ? '#2D7A5F' : 'var(--pn-border)'}`, background: on ? 'var(--pn-success-bg, #eaf5ef)' : 'var(--pn-surface)',
                                    color: on ? '#2D7A5F' : 'var(--pn-text)', borderRadius: 999, padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                  <span>{on ? '✓' : '+'}</span><span>{a.name}</span><span style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>+${r.price} · {r.duration}m</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            ))}
            {!isView && (
              <button onClick={addService} style={{ fontSize: 12, color: '#3D95CE', background: 'none', border: '1px dashed #b3d4ef', borderRadius: 8, cursor: 'pointer', padding: '6px 12px', width: '100%', fontFamily: 'inherit' }}>
                + Add service
              </button>
            )}
          </div>

          {/* Notes — multi-entry log + SOAP template */}
          <Field label="Notes">
            <NotesEditor
              entries={appt.notesLog}
              legacy={appt.notes}
              onChange={notesLog => onChange({ notesLog })}
              viewOnly={isView}
              author={gUser?.email || gUser?.displayName || ''}
              enableSoap={settings?.clinicalNotes === true}
            />
          </Field>

          {/* Service history — always shown for linked clients on existing
              appts. Joins appts + imported GG receipts so the staff sees
              the full timeline, not just records this app generated. */}
          {appt.clientId && appt.id && (
            <div style={{ marginBottom: 10, border: '1px solid var(--pn-border)', borderRadius: 10, background: 'var(--pn-bg)', overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: 'var(--pn-surface-alt)', borderBottom: '1px solid var(--pn-border)', fontSize: 11, fontWeight: 700, color: 'var(--pn-text)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                Service History {history && `· ${history.length}`}
              </div>
              {historyLoading ? (
                <div style={{ padding: '14px', fontSize: 12, color: 'var(--pn-text-muted)', textAlign: 'center' }}>Loading…</div>
              ) : (history?.length ? (
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {history.map((v, i) => {
                    const svcs = (v.services || []).map(s => s.name || s.customName).filter(Boolean).join(', ');
                    const raw = v.raw || {};
                    const pay = raw.payment || {};
                    const total = pay.total ?? raw.total ?? v.revenue ?? null;
                    const isExpanded = expandedVisitId === v.id;
                    const STATUS_STYLE = {
                      scheduled:   { bg: 'var(--pn-info-bg)',    fg: 'var(--pn-info)',    label: 'Scheduled' },
                      'in-progress':{ bg: 'var(--pn-warning-bg)', fg: 'var(--pn-warning)', label: 'In progress' },
                      done:        { bg: 'var(--pn-success-bg)', fg: 'var(--pn-success)', label: 'Done' },
                      cancelled:   { bg: 'var(--pn-danger-bg)',  fg: 'var(--pn-danger)',  label: 'Cancelled' },
                      no_show:     { bg: 'var(--pn-warning-bg)', fg: 'var(--pn-warning)', label: 'No-show' },
                      refunded:    { bg: 'var(--pn-warning-bg)', fg: 'var(--pn-warning)', label: 'Refunded' },
                    };
                    const sStyle = STATUS_STYLE[v.status] || { bg: '#e5e7eb', fg: '#374151', label: v.status || '—' };
                    return (
                      <div key={v.id || i} style={{ borderBottom: i < history.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
                        <div role="button" tabIndex={0}
                          onClick={() => setExpandedVisitId(prev => prev === v.id ? null : v.id)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedVisitId(prev => prev === v.id ? null : v.id); } }}
                          title={isExpanded ? 'Hide details' : 'Show details'}
                          style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer', background: isExpanded ? 'var(--pn-info-bg)' : 'transparent', userSelect: 'none' }}
                          onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--pn-bg)'; }}
                          onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <svg width="10" height="10" viewBox="0 0 10 10"
                                style={{ flexShrink: 0, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>
                                <path d="M3 1 L7 5 L3 9" fill="none" stroke="#3D95CE" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              {v.date || '—'}{v.startTime ? ` · ${minsToStr(strToMins(v.startTime))}` : ''}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: sStyle.bg, color: sStyle.fg, letterSpacing: '.03em', textTransform: 'uppercase' }}>{sStyle.label}</span>
                              {total != null && (
                                <span style={{ fontSize: 12, fontWeight: 600, color: '#2D7A5F' }}>${Number(total).toFixed(2)}</span>
                              )}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.4, paddingLeft: 14 }}>
                            {svcs || '(no services on file)'}
                            {v.techName ? <span style={{ color: 'var(--pn-text-muted)' }}> · {v.techName}</span> : null}
                          </div>
                        </div>
                        {isExpanded && (() => {
                          // Compute extras shown only in the expanded view.
                          const totalDur = (v.services || []).reduce((s, sv) => s + (Number(sv.duration) || 0), 0) || raw.duration || 0;
                          const startMins = v.startTime ? strToMins(v.startTime) : null;
                          const endStr    = startMins != null && totalDur ? minsToStr(startMins + totalDur) : null;
                          const tipPct    = (pay.subtotal && pay.tip) ? (Number(pay.tip) / Number(pay.subtotal)) * 100 : null;
                          const SOURCE_LABELS = {
                            online_booking: '🌐 Booked online',
                            rebook_prompt:  '🔁 Rebook',
                            imported:       '📥 Imported (GG)',
                            walk_in:        '🚶 Walk-in',
                          };
                          const sourceLabel = SOURCE_LABELS[raw.source] || (v.source === 'receipt' ? '🧾 Imported receipt' : '📅 Booked in-app');
                          const fmtDateTime = (iso) => { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
                          return (
                          <div style={{ padding: '10px 14px 12px 26px', background: 'var(--pn-surface)', borderTop: '1px solid var(--pn-border)', fontSize: 12, color: 'var(--pn-text)', lineHeight: 1.5 }}>
                            {/* Header row — source · duration · star tag */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 11 }}>
                              <span style={{ color: 'var(--pn-text-muted)' }}>{sourceLabel}</span>
                              {totalDur > 0 && <span style={{ color: 'var(--pn-text-muted)' }}>· {totalDur} min total{endStr ? ` (ends ${endStr})` : ''}</span>}
                              {raw.techRequestType === 'specific' && (
                                <span style={{ background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', border: '1px solid #fca5a5', borderRadius: 4, padding: '0 6px', fontWeight: 700 }}>★ Requested {v.techName}</span>
                              )}
                              {raw.recurringGroupId && (
                                <span style={{ background: 'var(--pn-info-bg)', color: 'var(--pn-info)', border: '1px solid #c7d2fe', borderRadius: 4, padding: '0 6px', fontWeight: 600 }}>
                                  🔁 Recurring{raw.recurringIndex && raw.recurringTotal ? ` ${raw.recurringIndex}/${raw.recurringTotal}` : ''}
                                </span>
                              )}
                            </div>

                            {(v.services || []).length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <div style={{ fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4, fontSize: 11 }}>Services</div>
                                {v.services.map((s, j) => (
                                  <div key={j} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0', borderBottom: j < v.services.length - 1 ? '1px dashed var(--pn-border)' : 'none' }}>
                                    <span>
                                      {s.name || s.customName || '—'}
                                      {s.isRemoval && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--pn-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>(removal)</span>}
                                    </span>
                                    <span style={{ color: 'var(--pn-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                                      {s.duration ? `${s.duration}m` : ''}
                                      {s.price ? ` · $${Number(s.price).toFixed(2)}` : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {(pay.subtotal != null || pay.tax != null || pay.tip != null || pay.total != null) && (
                              <div style={{ marginBottom: 8, padding: '6px 10px', background: 'var(--pn-bg)', borderRadius: 6, border: '1px solid var(--pn-border)' }}>
                                <div style={{ fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4, fontSize: 11 }}>Payment</div>
                                {pay.subtotal != null && <Row label="Subtotal" value={`$${Number(pay.subtotal).toFixed(2)}`} />}
                                {pay.discount != null && Number(pay.discount) > 0 && <Row label="Discount" value={`-$${Number(pay.discount).toFixed(2)}`} muted />}
                                {pay.tax != null      && <Row label="Tax"      value={`$${Number(pay.tax).toFixed(2)}`} />}
                                {pay.tip != null      && <Row label={`Tip${tipPct ? ` (${tipPct.toFixed(0)}%)` : ''}`} value={`$${Number(pay.tip).toFixed(2)}`} />}
                                {pay.total != null    && <Row label="Total"    value={`$${Number(pay.total).toFixed(2)}`} bold />}
                                {pay.method && <Row label="Method" value={pay.method} muted />}
                                {pay.paidAt && <Row label="Paid"   value={fmtDateTime(pay.paidAt)} muted />}
                              </div>
                            )}
                            {raw.refund && (
                              <div style={{ marginBottom: 8, padding: '6px 10px', background: 'var(--pn-danger-bg)', border: '1px solid #fecaca', borderRadius: 6, color: 'var(--pn-danger)' }}>
                                <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 2 }}>Refunded ${Number(raw.refund.amount || 0).toFixed(2)}</div>
                                {raw.refund.reason && <div style={{ fontSize: 11 }}>{raw.refund.reason}</div>}
                                {raw.refund.refundedAt && <div style={{ fontSize: 10, opacity: .8, marginTop: 2 }}>{fmtDateTime(raw.refund.refundedAt)}</div>}
                              </div>
                            )}
                            {raw.notes && (
                              <div style={{ marginBottom: 6 }}>
                                <div style={{ fontWeight: 700, color: 'var(--pn-text)', marginBottom: 2, fontSize: 11 }}>Notes</div>
                                <div style={{ whiteSpace: 'pre-wrap', color: 'var(--pn-text-muted)' }}>{raw.notes}</div>
                              </div>
                            )}
                            {/* Lifecycle stamps — keep at the bottom in a muted row */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--pn-border)' }}>
                              {raw.createdAt   && <span>Booked {fmtDateTime(raw.createdAt)}</span>}
                              {raw.checkedInAt && <span>Checked in {fmtDateTime(raw.checkedInAt)}</span>}
                              {raw.updatedAt && raw.createdAt && raw.updatedAt !== raw.createdAt && (
                                <span>Updated {fmtDateTime(raw.updatedAt)}</span>
                              )}
                            </div>
                          </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ padding: '14px', fontSize: 12, color: 'var(--pn-text-muted)', textAlign: 'center' }}>No prior visits on file.</div>
              ))}
            </div>
          )}

          {/* More options — disclosure for infrequent fields. The "client
              asked for this tech" toggle now lives inline under the tech
              picker; this keeps the recurring/repeat schedule behind a link
              to keep the default modal short. New appointments only. */}
          {!isView && !appt.id && (
            <div style={{ marginBottom: 10 }}>
              <button onClick={() => setAdvancedOpen(o => !o)} type="button"
                style={{ background: 'none', border: 'none', color: '#3D95CE', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
                {advancedOpen ? '▾ Hide more options' : '▸ More options · repeat'}
              </button>
              {advancedOpen && (
                <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px dashed var(--pn-border)' }}>
                  {/* Recurring repeat — new appointments only */}
                  <RepeatSection
                    recurrence={appt.recurrence}
                    date={appt.date}
                    onChange={onChange}
                  />
                </div>
              )}
            </div>
          )}

          {/* Photos */}
          <PhotoSection
            photosBefore={appt.photosBefore || []}
            photosAfter={appt.photosAfter || []}
            isView={isView}
            onChange={onChange}
          />
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--pn-border)', display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          {isView ? (
            <>
              {!isNew && !viewOnly && (
                <button onClick={onDelete} style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid #fca5a5', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  Delete
                </button>
              )}
              {appt.id && (
                <button onClick={copyCheckinLink} title="Copy check-in link for client"
                  style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: `1px solid ${linkCopied ? '#bbf7d0' : 'var(--pn-border-strong)'}`, background: linkCopied ? 'var(--pn-success-bg)' : 'var(--pn-surface)', color: linkCopied ? 'var(--pn-success)' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {linkCopied ? '✓ Copied!' : '🔗 Check-in'}
                </button>
              )}
              {appt.id && isAdmin && !viewOnly && (
                <button onClick={() => setRestoreOpen(true)}
                  title="Restore an earlier version of this appointment from the BigQuery mirror"
                  style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  ⏳ History
                </button>
              )}
              {!viewOnly && (
                <button onClick={onSwitchEdit} style={{ flex: 1, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE', whiteSpace: 'nowrap' }}>Edit</button>
              )}
              {!viewOnly && appt.id && appt.status !== 'done' && appt.status !== 'cancelled' && (
                <>
                  <button onClick={() => onAddToTicket(appt)}
                    style={{ flex: 1, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--pn-surface)', color: 'var(--pn-success)', border: '1.5px solid #2D7A5F', borderRadius: 8, padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    🧾 Add to ticket
                  </button>
                  <button onClick={() => onCheckout(appt)}
                    style={{ flex: 2, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg,#2D7A5F 0%,#3D95CE 100%)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', whiteSpace: 'nowrap' }}>
                    Checkout now
                  </button>
                </>
              )}
              {!viewOnly && appt.id && appt.status === 'done' && !appt.refund && (
                <button onClick={() => onRefund(appt)}
                  style={{ flex: 1, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 10px' }}>
                  Refund
                </button>
              )}
              {appt.refund && (
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, marginBottom: appt.refund.reason || appt.refund.photo ? 6 : 0 }}>
                    Refunded ${appt.refund.amount.toFixed(2)}
                  </div>
                  {appt.refund.reason && (
                    <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', lineHeight: 1.4 }}>{appt.refund.reason}</div>
                  )}
                  {appt.refund.photo && (
                    <img src={appt.refund.photo} alt="Refund" style={{ marginTop: 6, width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 6, border: '1px solid #fca5a5' }} />
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <button onClick={onClose} style={{ flex: 1, ...btnBase }}>Cancel</button>
              <button onClick={submit}
                disabled={saving || blockers.length > 0}
                title={blockers.length > 0 ? 'Resolve the items in the panel above first.' : ''}
                style={{
                  flex: 2, ...btnBase,
                  background: blockers.length > 0 ? '#cbd5e1' : '#3D95CE',
                  color: '#fff', borderColor: blockers.length > 0 ? '#cbd5e1' : '#3D95CE',
                  opacity: saving ? .6 : 1,
                  cursor: (saving || blockers.length > 0) ? 'default' : 'pointer',
                }}>
                {saving ? 'Saving…'
                  : blockers.length > 0 ? 'Fix issues to save'
                  : warnings.length > 0 ? (isNew ? 'Book anyway' : 'Save anyway')
                  : (isNew ? 'Book Appointment' : 'Save Changes')}
              </button>
            </>
          )}
        </div>
      </div>
      {restoreOpen && appt.id && (
        <RestoreFromBQModal
          collection="appointments"
          docId={appt.id}
          label={`${appt.clientName || 'Walk-in'} · ${appt.date}`}
          onClose={() => setRestoreOpen(false)}
          onRestored={async () => {
            setRestoreOpen(false);
            await onReload?.();
            onClose();
          }}
        />
      )}
    </div>
  );
}

// ── Repeat (recurring series) ─────────────────────────
function RepeatSection({ recurrence, date, onChange }) {
  const enabled = !!recurrence;
  const weeks   = recurrence?.weeks ?? 2;
  const count   = recurrence?.count ?? 6;

  function toggle() {
    onChange({ recurrence: enabled ? null : { weeks: 2, count: 6 } });
  }
  function patch(delta) {
    onChange({ recurrence: { weeks, count, ...delta } });
  }

  let endLabel = '';
  if (enabled && date) {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + (count - 1) * weeks * 7);
    endLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const freqLabel = weeks === 1 ? 'weekly' : `every ${weeks} weeks`;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: enabled ? 8 : 0 }}>
        <label style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>🔁 Repeat</label>
        <button onClick={toggle} style={{
          width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', padding: 0,
          background: enabled ? '#2D7A5F' : '#d0d0d0', position: 'relative', transition: 'background .2s', flexShrink: 0,
        }}>
          <div style={{
            width: 16, height: 16, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 3, left: enabled ? 21 : 3, transition: 'left .2s',
          }} />
        </button>
      </div>
      {enabled && (
        <div style={{ background: 'var(--pn-info-bg)', borderRadius: 10, border: '1px solid #c7dff7', padding: '10px 12px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--pn-info)', fontWeight: 600, marginBottom: 4 }}>Frequency</div>
              <select value={weeks} onChange={e => patch({ weeks: Number(e.target.value) })} style={{ ...inp, fontSize: 12, padding: '5px 8px' }}>
                <option value={1}>Every week</option>
                <option value={2}>Every 2 weeks</option>
                <option value={3}>Every 3 weeks</option>
                <option value={4}>Every 4 weeks</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--pn-info)', fontWeight: 600, marginBottom: 4 }}>Occurrences</div>
              <select value={count} onChange={e => patch({ count: Number(e.target.value) })} style={{ ...inp, fontSize: 12, padding: '5px 8px' }}>
                {[2,3,4,5,6,8,10,12,16,24,52].map(n => (
                  <option key={n} value={n}>{n} appointments</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--pn-info)', fontWeight: 500 }}>
            Creates {count} appointments {freqLabel}, through {endLabel}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Recurring delete dialog ────────────────────────────
function RecurringDeleteDialog({ appt, onDeleteOne, onDeleteAll, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, padding: 24, width: '90%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 6 }}>Delete recurring appointment</div>
        <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
          This is appointment {appt.recurringIndex} of {appt.recurringTotal} in a series. What would you like to delete?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={onDeleteOne}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-text)', textAlign: 'left' }}>
            Just this appointment
          </button>
          <button onClick={onDeleteAll}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #fca5a5', background: 'var(--pn-danger-bg)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-danger)', textAlign: 'left' }}>
            All {appt.recurringTotal} in this series
          </button>
          <button onClick={onCancel}
            style={{ padding: '8px', borderRadius: 10, border: 'none', background: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-text-faint)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Series conflict dialog (pre-flight on create) ──────
function SeriesConflictDialog({ dates, onSkip, onForce, onCancel }) {
  const okCount = dates.filter(d => d.ok).length;
  const conflictCount = dates.length - okCount;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, padding: 22, width: '94%', maxWidth: 460, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4 }}>Recurring series — conflicts found</div>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
          {conflictCount} of {dates.length} dates have a problem ({okCount} are clear).
        </div>
        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--pn-border)', borderRadius: 10, marginBottom: 14, background: 'var(--pn-bg)' }}>
          {dates.map((d, i) => {
            const human = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderBottom: i < dates.length - 1 ? '1px solid var(--pn-border)' : 'none', background: d.ok ? 'transparent' : 'var(--pn-danger-bg)' }}>
                <span style={{ fontSize: 14, lineHeight: 1.3, flexShrink: 0, color: d.ok ? '#22c55e' : '#ef4444' }}>{d.ok ? '✓' : '✕'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: d.ok ? 'var(--pn-text)' : 'var(--pn-danger)' }}>{human}</div>
                  {!d.ok && (
                    <div style={{ fontSize: 11, color: 'var(--pn-danger)', marginTop: 2 }}>{d.reasons.join(' · ')}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={onSkip} disabled={okCount === 0}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #2D7A5F', background: okCount === 0 ? 'var(--pn-surface-alt)' : 'var(--pn-success-bg)', fontSize: 14, fontWeight: 600, cursor: okCount === 0 ? 'default' : 'pointer', fontFamily: 'inherit', color: okCount === 0 ? 'var(--pn-text-faint)' : 'var(--pn-success)', textAlign: 'left' }}>
            Skip the {conflictCount} conflicts — book {okCount} clear date{okCount === 1 ? '' : 's'}
          </button>
          <button onClick={onForce}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #f59e0b', background: 'var(--pn-warning-bg)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-warning)', textAlign: 'left' }}>
            Book all {dates.length} anyway (overlap allowed)
          </button>
          <button onClick={onCancel}
            style={{ padding: '8px', borderRadius: 10, border: 'none', background: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-text-faint)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Series edit scope dialog ───────────────────────────
function SeriesEditDialog({ appt, onScope, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, padding: 24, width: '90%', maxWidth: 360, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 6 }}>Edit recurring appointment</div>
        <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
          This is appointment {appt.recurringIndex || '?'} of {appt.recurringTotal || '?'} in a series. Apply your changes to:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => onScope('this')}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-text)', textAlign: 'left' }}>
            Just this appointment
          </button>
          <button onClick={() => onScope('following')}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #c7dff7', background: 'var(--pn-info-bg)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-info)', textAlign: 'left' }}>
            This and all following
          </button>
          <button onClick={() => onScope('all')}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #c7dff7', background: 'var(--pn-info-bg)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-info)', textAlign: 'left' }}>
            All {appt.recurringTotal || ''} in this series
          </button>
          <button onClick={onCancel}
            style={{ padding: '8px', borderRadius: 10, border: 'none', background: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-text-faint)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Before / After photos ─────────────────────────────
function PhotoSection({ photosBefore, photosAfter, isView, onChange }) {
  const [uploading, setUploading] = useState(null); // 'before' | 'after' | null
  const [lightbox,  setLightbox]  = useState(null); // { src, label }
  const beforeRef = useRef(null);
  const afterRef  = useRef(null);

  const hasPhotos = photosBefore.length > 0 || photosAfter.length > 0;
  if (isView && !hasPhotos) return null;

  async function upload(file, type) {
    setUploading(type);
    try {
      const b64 = await resizeImg(file, 720, 960, 0.72);
      if (type === 'before') onChange({ photosBefore: [...photosBefore, b64] });
      else                   onChange({ photosAfter:  [...photosAfter,  b64] });
    } catch { /* ignore */ }
    finally { setUploading(null); }
  }

  function remove(type, idx) {
    if (type === 'before') onChange({ photosBefore: photosBefore.filter((_, i) => i !== idx) });
    else                   onChange({ photosAfter:  photosAfter.filter((_, i) => i !== idx) });
  }

  function PhotoRow({ photos, type, label, max }) {
    const ref = type === 'before' ? beforeRef : afterRef;
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>{label}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {photos.map((src, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={src} alt="" onClick={() => setLightbox({ src, label })}
                style={{ width: 68, height: 68, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--pn-border)', cursor: 'pointer', display: 'block' }} />
              {!isView && (
                <button onClick={() => remove(type, i)}
                  style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%', background: '#ef4444', border: 'none', color: '#fff', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                  ×
                </button>
              )}
            </div>
          ))}
          {!isView && photos.length < max && (
            <>
              <input ref={ref} type="file" accept="image/*,.heic,.heif,.dng" style={{ display: 'none' }}
                onChange={async e => { if (e.target.files[0]) await upload(e.target.files[0], type); e.target.value = ''; }} />
              <button onClick={() => ref.current?.click()} disabled={uploading === type}
                style={{ width: 68, height: 68, borderRadius: 8, border: '2px dashed var(--pn-border-strong)', background: 'var(--pn-bg)', cursor: 'pointer', fontSize: 22, color: 'var(--pn-text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}>
                {uploading === type ? '…' : '+'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 6 }}>📸 Photos</label>
        <PhotoRow photos={photosBefore} type="before" label="Before" max={3} />
        <PhotoRow photos={photosAfter}  type="after"  label="After"  max={4} />
      </div>

      {lightbox && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}
             onClick={() => setLightbox(null)}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
            {lightbox.label}
          </div>
          <img src={lightbox.src} alt="" style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 10 }}
               onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: 16, right: 16, width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ×
          </button>
        </div>
      )}
    </>
  );
}

// ── Client search typeahead ───────────────────────────

// ── Small components ──────────────────────────────────
function StatusChip({ status }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.scheduled;
  const labels = { scheduled: 'Scheduled', 'in-progress': 'In Progress', done: 'Done', cancelled: 'Cancelled' };
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}>
      {labels[status] || status}
    </span>
  );
}

function ViewBadge() {
  return <span style={{ fontSize: 10, background: 'var(--pn-surface-alt)', color: 'var(--pn-text-muted)', borderRadius: 20, padding: '2px 8px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>view</span>;
}

function NavBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--pn-text-muted)', fontFamily: 'inherit' }}>
      {children}
    </button>
  );
}

function NoTechsEmptyState() {
  return (
    <div style={{
      textAlign: 'center', padding: '60px 24px',
      background: 'var(--pn-surface)', border: '1px dashed var(--pn-border-strong)', borderRadius: 12,
      marginTop: 20,
    }}>
      <div style={{ fontSize: 56, marginBottom: 12, opacity: 0.7 }}>👥</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 6 }}>
        No employees yet
      </div>
      <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', maxWidth: 380, margin: '0 auto 18px', lineHeight: 1.55 }}>
        Add your first employee to start booking appointments. Each employee shows up as a column in the day grid.
      </div>
      <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', fontStyle: 'italic' }}>
        Open <strong>Employees</strong> from the sidebar to add one.
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 10, ...style }}>
      <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>{label}</label>
      {children}
    </div>
  );
}

function ViewVal({ children, style }) {
  return <div style={{ fontSize: 13, color: 'var(--pn-text)', padding: '5px 0', minHeight: 24, lineHeight: 1.5, ...style }}>{children}</div>;
}

// Compact label/value row used inside the expanded service-history detail
// view. `bold` highlights totals; `muted` greys out secondary fields.
function Row({ label, value, bold, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, padding: '1px 0', color: muted ? 'var(--pn-text-muted)' : 'var(--pn-text)' }}>
      <span>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

const inp     = { fontFamily: 'inherit', width: '100%', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: 'var(--pn-text)', outline: 'none', background: 'var(--pn-bg)', boxSizing: 'border-box' };
const btnBase = { fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'var(--pn-surface)', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 14px', color: 'var(--pn-text)' };

// ── Time Off modal (vacation / sick / personal) ────────
function TimeOffModal({ timeOff, techs, employees, services, clients = [], isAdmin, isScheduler, isTech, myTechName, gUser, prefill, onClose }) {
  // Admins/schedulers see and manage everyone's time off; techs see only their own.
  const canManageOthers = isAdmin || isScheduler;
  const visible = canManageOthers
    ? timeOff
    : timeOff.filter(t => t.techName === myTechName);
  const upcoming = visible
    .filter(t => (t.endDate || t.startDate) >= todayStr())
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  const past = visible
    .filter(t => (t.endDate || t.startDate) < todayStr())
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
    .slice(0, 10);

  const [showAdd, setShowAdd] = useState(!!prefill);
  const canAdd = canManageOthers || (isTech && !!myTechName);

  function fmtDate(d) {
    if (!d) return '';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function fmtRange(t) {
    if (!t.startDate) return '—';
    if (!t.endDate || t.endDate === t.startDate) return fmtDate(t.startDate);
    return `${fmtDate(t.startDate)} – ${fmtDate(t.endDate)}`;
  }
  function typeLabel(t) {
    if (t === 'sick') return '🩹 Sick';
    if (t === 'personal') return '🏠 Personal';
    return '🌴 Vacation';
  }

  async function handleDelete(t) {
    if (!confirm(`Delete this time off entry?\n\n${t.techName} · ${fmtRange(t)}`)) return;
    try { await deleteTimeOff(t.id); }
    catch (e) { alert(`Could not delete — ${e.message}`); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>🌴 Time Off</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {showAdd ? (
            <TimeOffForm
              techs={techs}
              employees={employees}
              services={services}
              clients={clients}
              timeOff={timeOff}
              isAdmin={isAdmin}
              isScheduler={isScheduler}
              isTech={isTech}
              myTechName={myTechName}
              gUser={gUser}
              prefill={prefill}
              onCancel={() => (prefill ? onClose() : setShowAdd(false))}
              onSaved={() => (prefill ? onClose() : setShowAdd(false))}
            />
          ) : (
            <>
              {canAdd && (
                <button onClick={() => setShowAdd(true)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px dashed #2D7A5F', background: 'var(--pn-success-bg)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-success)', marginBottom: 14 }}>
                  + Add time off
                </button>
              )}

              <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Upcoming</div>
              {upcoming.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', padding: '12px 4px' }}>None scheduled.</div>
              ) : upcoming.map(t => (
                <TimeOffRow key={t.id} t={t} typeLabel={typeLabel} fmtRange={fmtRange}
                  canEdit={canManageOthers || t.techName === myTechName}
                  onDelete={() => handleDelete(t)} />
              ))}

              {past.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 16, marginBottom: 6 }}>Recent past</div>
                  {past.map(t => (
                    <TimeOffRow key={t.id} t={t} typeLabel={typeLabel} fmtRange={fmtRange}
                      canEdit={canManageOthers || t.techName === myTechName}
                      onDelete={() => handleDelete(t)} muted />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TimeOffRow({ t, typeLabel, fmtRange, canEdit, onDelete, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--pn-border)', background: muted ? 'var(--pn-bg)' : 'var(--pn-surface)', marginBottom: 6, opacity: muted ? .7 : 1 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{t.techName || '—'}</span>
          <span style={{ fontSize: 11, color: 'var(--pn-text-muted)', fontWeight: 500 }}>· {typeLabel(t.type)}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>
          {fmtRange(t)}
          {t.allDay === false && t.startTime && t.endTime ? ` · ${t.startTime}–${t.endTime}` : ''}
        </div>
        {t.notes && (
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, fontStyle: 'italic' }}>{t.notes}</div>
        )}
      </div>
      {canEdit && (
        <button onClick={onDelete} title="Delete"
          style={{ fontSize: 12, padding: '5px 9px', borderRadius: 6, border: '1px solid #fca5a5', background: 'var(--pn-surface)', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
          Delete
        </button>
      )}
    </div>
  );
}

function TimeOffForm({ techs, employees, services, clients = [], timeOff, isAdmin, isScheduler, isTech, myTechName, gUser, prefill, onCancel, onSaved }) {
  const canManageOthers = isAdmin || isScheduler;
  const defaultTech = canManageOthers ? '' : (myTechName || '');
  const today = todayStr();
  // When opened from a tapped schedule slot (New Appointment → 🌴 Block time),
  // prefill the tech + date + a partial-day window starting at that slot.
  const [techName, setTechName] = useState(prefill?.techName || defaultTech);
  const [type, setType] = useState('vacation');
  const [startDate, setStartDate] = useState(prefill?.date || today);
  const [endDate, setEndDate] = useState(prefill?.date || today);
  const [allDay, setAllDay] = useState(prefill ? false : true);
  const [startTime, setStartTime] = useState(prefill?.start || '09:00');
  const [endTime, setEndTime] = useState(prefill?.end || '17:00');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [conflictCtx, setConflictCtx] = useState(null); // { affected, draftEntry }
  const [messagesCtx, setMessagesCtx] = useState(null); // { affected, draftEntry, reassignmentsByApptId }

  async function persist(draftEntry, reassignments) {
    // Apply any tech reassignments first (so the affected appts move BEFORE
    // the time-off block lands and the day grid stops rendering them on the
    // out-going tech).
    if (reassignments && reassignments.length) {
      for (const r of reassignments) {
        await saveAppointment(r.apptId, {
          techName: r.newTech,
          // Drop the "specific request" flag — the original requested tech is
          // off, so this is now a scheduler-assigned reassignment.
          techRequestType: 'scheduler',
          reassignedFrom: r.fromTech,
          reassignedAt: new Date().toISOString(),
        });
      }
    }
    await createTimeOff(draftEntry);

    // After save: if there were any affected appts (reassigned or left
    // manual), open the AI message-drafting panel so the user can quickly
    // notify clients. Skipping the panel just calls onSaved.
    const ctx = conflictCtx;
    if (ctx && ctx.affected && ctx.affected.length > 0) {
      const reByApptId = {};
      (reassignments || []).forEach(r => { reByApptId[r.apptId] = r; });
      // Enrich affected appts with client phone/email for the messages panel
      const clientById = new Map((clients || []).map(c => [c.id, c]));
      const enriched = ctx.affected.map(a => {
        const c = clientById.get(a.clientId) || {};
        return { ...a, clientPhone: c.phone || null, clientEmail: c.email || null };
      });
      setMessagesCtx({ affected: enriched, draftEntry, reassignmentsByApptId: reByApptId });
    } else {
      onSaved();
    }
  }

  async function submit() {
    setErr('');
    if (!techName) { setErr('Pick a tech'); return; }
    if (!startDate) { setErr('Start date required'); return; }
    if (endDate && endDate < startDate) { setErr('End date is before start date'); return; }
    if (!allDay && (!startTime || !endTime)) { setErr('Pick start and end times'); return; }
    if (!allDay && endTime <= startTime) { setErr('End time must be after start'); return; }

    const draftEntry = {
      techName,
      type,
      startDate,
      endDate: endDate || startDate,
      allDay,
      startTime: allDay ? null : startTime,
      endTime:   allDay ? null : endTime,
      notes: notes.trim() || null,
      createdBy: gUser?.email || null,
    };

    setSaving(true);
    try {
      // Find appts that conflict with this time-off block.
      const all = await fetchAppointmentsByRange(draftEntry.startDate, draftEntry.endDate);
      const blockS = !allDay && startTime ? strToMins(startTime) : 0;
      const blockE = !allDay && endTime   ? strToMins(endTime)   : 24 * 60;
      const affected = all.filter(a => {
        if (a.techName !== techName) return false;
        if (a.status === 'cancelled' || a.status === 'done') return false;
        if (allDay) return true;
        const aS = strToMins(a.startTime || '00:00');
        const aE = aS + (Number(a.duration) || 60);
        // Overlap test against block window. For multi-day blocks, allDay
        // already matches; otherwise we apply the time window per-day.
        return aS < blockE && aE > blockS;
      });

      if (affected.length === 0) {
        await persist(draftEntry, []);
      } else {
        setConflictCtx({ affected, draftEntry });
      }
    } catch (e) {
      setErr(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (messagesCtx) {
    return (
      <ConflictMessagesPanel
        affected={messagesCtx.affected}
        draftEntry={messagesCtx.draftEntry}
        reassignmentsByApptId={messagesCtx.reassignmentsByApptId}
        onClose={() => { setMessagesCtx(null); onSaved(); }}
      />
    );
  }

  if (conflictCtx) {
    return (
      <TimeOffConflictView
        affected={conflictCtx.affected}
        draftEntry={conflictCtx.draftEntry}
        techs={techs}
        employees={employees}
        services={services}
        timeOff={timeOff}
        onCancel={() => setConflictCtx(null)}
        onConfirm={async (reassignments) => {
          setSaving(true);
          try {
            await persist(conflictCtx.draftEntry, reassignments);
          } catch (e) {
            setErr(e?.message || 'Could not save');
            setConflictCtx(null);
          } finally {
            setSaving(false);
          }
        }}
        saving={saving}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)' }}>New time off</div>
        <button onClick={onCancel} style={{ ...btnBase, padding: '5px 10px', fontSize: 12 }}>← Back</button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4 }}>Tech</div>
        {canManageOthers ? (
          <select value={techName} onChange={e => setTechName(e.target.value)} style={inp}>
            <option value="">Pick a tech…</option>
            {techs.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <div style={{ ...inp, background: 'var(--pn-surface-alt)' }}>{myTechName || '—'}</div>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4 }}>Type</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'vacation', label: '🌴 Vacation' },
            { id: 'sick',     label: '🩹 Sick' },
            { id: 'personal', label: '🏠 Personal' },
          ].map(opt => (
            <button key={opt.id} onClick={() => setType(opt.id)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: type === opt.id ? '1.5px solid #2D7A5F' : '1px solid var(--pn-border-strong)', background: type === opt.id ? 'var(--pn-success-bg)' : 'var(--pn-surface)', fontSize: 13, fontWeight: type === opt.id ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit', color: type === opt.id ? 'var(--pn-success)' : 'var(--pn-text-muted)' }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4 }}>From</div>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inp} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4 }}>To</div>
          <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} style={inp} />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', cursor: 'pointer', marginBottom: 10 }}>
        <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
        <span style={{ fontSize: 13, color: 'var(--pn-text-muted)' }}>All day</span>
      </label>

      {!allDay && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4 }}>Start time</div>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={inp} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4 }}>End time</div>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={inp} />
          </div>
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4 }}>Note (optional)</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="e.g. Family trip — back the 18th" />
      </div>

      {err && (
        <div style={{ fontSize: 12, color: 'var(--pn-danger)', background: 'var(--pn-danger-bg)', border: '1px solid #fca5a5', padding: '6px 10px', borderRadius: 8, marginBottom: 10 }}>{err}</div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={submit} disabled={saving}
          style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none', background: saving ? '#cbb6e0' : '#2D7A5F', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', color: '#fff' }}>
          {saving ? 'Saving…' : 'Save time off'}
        </button>
        <button onClick={onCancel} disabled={saving} style={{ ...btnBase, padding: '10px 14px' }}>Cancel</button>
      </div>
    </div>
  );
}

// Suggests techs who can cover a single appt: must be different from the
// out-going tech, capable of every service in the cart, working that day,
// not on time off, and free at the appt's time slot.
function suggestCoverageTechs(appt, employees, services, allAppts, timeOff) {
  if (!appt || !Array.isArray(employees) || employees.length === 0) return [];
  const apptStart = strToMins(appt.startTime || '00:00');
  const apptEnd   = apptStart + (Number(appt.duration) || 60);
  const apptDow   = dayOfWeek(appt.date);
  // Map service names → service objects (for serviceIds capability check).
  const svcByName = new Map((services || []).map(s => [s.name, s]));
  const apptSvcIds = (appt.services || [])
    .map(s => svcByName.get(s.name)?.id)
    .filter(Boolean);

  const ranked = employees
    .filter(e => e.name && e.name !== appt.techName)
    .map(e => {
      const reasons = [];
      // Capability — empty serviceIds = "can do all" (back-compat).
      const empSvcIds = e.serviceIds || [];
      if (empSvcIds.length > 0 && apptSvcIds.length > 0) {
        const allCovered = apptSvcIds.every(id => empSvcIds.includes(id));
        if (!allCovered) reasons.push('missing service');
      }
      // Work day on that DOW
      const wd = e.workDays?.[apptDow];
      if (wd && wd.on === false) reasons.push('off that day');
      // Not on time off at this slot
      if (isSlotBlocked(timeOff, e.name, appt.date, apptStart)) reasons.push('on time off');
      // Free at the slot — no overlapping appts
      const overlap = (allAppts || []).some(a => {
        if (a.id === appt.id) return false;
        if (a.techName !== e.name) return false;
        if (a.date !== appt.date) return false;
        if (a.status === 'cancelled') return false;
        const aS = strToMins(a.startTime || '00:00');
        const aE = aS + (Number(a.duration) || 60);
        return aS < apptEnd && aE > apptStart;
      });
      if (overlap) reasons.push('booked at that time');
      return { name: e.name, ok: reasons.length === 0, reasons };
    });

  // Available first, then unavailable with reasons (so user has visibility).
  ranked.sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? -1 : 1));
  return ranked;
}

function TimeOffConflictView({ affected, draftEntry, techs, employees, services, timeOff, onCancel, onConfirm, saving }) {
  // Build per-appt coverage suggestions once when the dialog opens.
  const allAppts = affected; // best-effort — we already know they're on the affected tech in this range
  const suggestionsByAppt = useMemo(() => {
    const map = {};
    affected.forEach(a => {
      map[a.id] = suggestCoverageTechs(a, employees || [], services || [], allAppts, timeOff || []);
    });
    return map;
  }, [affected, employees, services, allAppts, timeOff]);

  // For each appt: { newTech: '' | name, overrideSpecific: bool }
  const [picks, setPicks] = useState(() => {
    const init = {};
    affected.forEach(a => { init[a.id] = { newTech: '', overrideSpecific: false }; });
    return init;
  });

  function patch(apptId, delta) {
    setPicks(p => ({ ...p, [apptId]: { ...p[apptId], ...delta } }));
  }

  function fmt(a) {
    const dStr = new Date(a.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const t = a.startTime ? minsToStr(strToMins(a.startTime)) : '';
    return `${dStr} · ${t}`;
  }

  function autoPickAll() {
    setPicks(p => {
      const next = { ...p };
      affected.forEach(a => {
        const sugg = suggestionsByAppt[a.id] || [];
        const first = sugg.find(s => s.ok);
        if (first) next[a.id] = { ...next[a.id], newTech: first.name };
      });
      return next;
    });
  }

  const reassignments = affected
    .map(a => {
      const p = picks[a.id] || {};
      if (!p.newTech) return null;
      // Specific-request appts require the override flag.
      if (a.techRequestType === 'specific' && !p.overrideSpecific) return null;
      return { apptId: a.id, newTech: p.newTech, fromTech: a.techName };
    })
    .filter(Boolean);

  const specificCount = affected.filter(a => a.techRequestType === 'specific').length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)' }}>
          ⚠️ {affected.length} appointment{affected.length === 1 ? '' : 's'} affected
        </div>
        <button onClick={onCancel} disabled={saving} style={{ ...btnBase, padding: '5px 10px', fontSize: 12 }}>← Back</button>
      </div>

      <div style={{ background: 'var(--pn-warning-bg)', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--pn-warning)', lineHeight: 1.5 }}>
          <strong>It's up to you (or {draftEntry.techName}) to contact these clients</strong> to reschedule, or to find another tech to cover. The system <em>will not</em> auto-cancel or auto-notify the client. For appointments where the client did not specifically request {draftEntry.techName}, you can pick a coverage tech below — that change will be applied when you save.
          {specificCount > 0 && (
            <> {specificCount} appointment{specificCount === 1 ? '' : 's'} ⭐ specifically requested {draftEntry.techName}; we recommend reaching out to the client first before reassigning. You can override and auto-find another tech if needed.</>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Conflicts</div>
        <button onClick={autoPickAll} disabled={saving}
          style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6, border: '1px solid #c7dff7', background: 'var(--pn-info-bg)', color: 'var(--pn-info)', cursor: 'pointer', fontFamily: 'inherit' }}>
          Auto-pick all where possible
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {affected.map(a => {
          const sugg = suggestionsByAppt[a.id] || [];
          const isSpecific = a.techRequestType === 'specific';
          const pick = picks[a.id] || {};
          const services = (a.services || []).map(s => s.name).filter(Boolean).join(', ') || '—';
          const blocked = isSpecific && !pick.overrideSpecific;
          const availSuggestions = sugg.filter(s => s.ok);
          return (
            <div key={a.id} style={{ border: `1px solid ${isSpecific ? '#fca5a5' : 'var(--pn-border)'}`, borderRadius: 10, padding: 10, background: isSpecific ? 'var(--pn-danger-bg)' : 'var(--pn-surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {isSpecific && <span title="Client asked for this tech" style={{ color: '#ef4444', fontWeight: 700, fontSize: 14 }}>⭐</span>}
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)', flex: 1 }}>
                  {a.clientName || 'Walk-in'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>{fmt(a)}</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 8 }}>{services}</div>

              {isSpecific && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--pn-danger)', marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!pick.overrideSpecific}
                    onChange={e => patch(a.id, { overrideSpecific: e.target.checked, newTech: e.target.checked ? pick.newTech : '' })} />
                  Override — let me reassign anyway (I'll contact the client)
                </label>
              )}

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--pn-text-muted)', flexShrink: 0 }}>Cover with:</span>
                <select value={pick.newTech || ''} onChange={e => patch(a.id, { newTech: e.target.value })}
                  disabled={blocked || saving}
                  style={{ ...inp, flex: 1, fontSize: 12, padding: '5px 7px', opacity: blocked ? .5 : 1 }}>
                  <option value="">— Leave on {a.techName} (handle manually) —</option>
                  {availSuggestions.map(s => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                  {sugg.filter(s => !s.ok).length > 0 && (
                    <optgroup label="Unavailable">
                      {sugg.filter(s => !s.ok).map(s => (
                        <option key={s.name} value="" disabled>{s.name} — {s.reasons.join(', ')}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {!blocked && availSuggestions.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--pn-danger)', marginTop: 6 }}>
                  No available tech can cover this — you'll need to reschedule with the client.
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onConfirm(reassignments)} disabled={saving}
          style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none', background: saving ? '#cbb6e0' : '#2D7A5F', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', color: '#fff' }}>
          {saving
            ? 'Saving…'
            : reassignments.length > 0
              ? `Reassign ${reassignments.length} & save time off`
              : 'Save time off (handle manually)'}
        </button>
        <button onClick={onCancel} disabled={saving} style={{ ...btnBase, padding: '10px 14px' }}>Cancel</button>
      </div>
    </div>
  );
}

// ── AI-drafted client outreach for time-off conflicts ─
function ConflictMessagesPanel({ affected, draftEntry, reassignmentsByApptId, onClose }) {
  const { showToast } = useApp();
  const [drafts, setDrafts] = useState([]);     // [{ apptId, scenario, smsDraft, emailSubject, emailDraft }]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sentByApptId, setSentByApptId] = useState({}); // { [apptId]: { sms?: 'sent'|'failed', email?: ... } }
  const [sendingByApptId, setSendingByApptId] = useState({});

  // Build the input shape the function expects
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const apptInputs = affected.map(a => {
          const r = reassignmentsByApptId[a.id];
          return {
            id:               a.id,
            clientName:       a.clientName || 'Client',
            clientPhone:      a.clientPhone || '',
            clientEmail:      a.clientEmail || '',
            date:             a.date,
            startTime:        a.startTime,
            services:         a.services || [],
            techRequestType:  a.techRequestType || 'scheduler',
            newTechName:      r?.newTech || null,
          };
        });
        const { httpsCallable } = await import('firebase/functions');
        const { functions } = await import('../../lib/firebase');
        const fn = httpsCallable(functions, 'draftConflictMessages');
        const res = await fn({
          tenantId:       TENANT_ID,
          technicianName: draftEntry.techName,
          reason:         draftEntry.type,
          startDate:      draftEntry.startDate,
          endDate:        draftEntry.endDate,
          affected:       apptInputs,
        });
        if (!cancelled) setDrafts(res?.data?.drafts || []);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Could not draft messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [affected, draftEntry, reassignmentsByApptId]);

  function patchDraft(apptId, delta) {
    setDrafts(d => d.map(x => x.apptId === apptId ? { ...x, ...delta } : x));
  }

  async function send(apptId, channel) {
    const draft = drafts.find(d => d.apptId === apptId);
    const appt  = affected.find(a => a.id === apptId);
    if (!draft || !appt) return;

    setSendingByApptId(s => ({ ...s, [apptId]: channel }));
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../lib/firebase');
      if (channel === 'sms') {
        if (!appt.clientId) throw new Error('No client ID — open the client record first');
        if (!appt.clientPhone) throw new Error('No phone on file');
        await httpsCallable(functions, 'sendDirectSms')({ clientId: appt.clientId, body: draft.smsDraft });
        setSentByApptId(s => ({ ...s, [apptId]: { ...(s[apptId] || {}), sms: 'sent' } }));
      } else if (channel === 'email') {
        if (!appt.clientId) throw new Error('No client ID — open the client record first');
        if (!appt.clientEmail) throw new Error('No email on file');
        await httpsCallable(functions, 'sendDirectEmail')({ clientId: appt.clientId, subject: draft.emailSubject, body: draft.emailDraft });
        setSentByApptId(s => ({ ...s, [apptId]: { ...(s[apptId] || {}), email: 'sent' } }));
      }
      showToast(`Message sent to ${appt.clientName}`);
    } catch (e) {
      setSentByApptId(s => ({ ...s, [apptId]: { ...(s[apptId] || {}), [channel]: 'failed' } }));
      showToast(`Failed to send: ${e.message || 'unknown error'}`, 4000);
    } finally {
      setSendingByApptId(s => { const n = { ...s }; delete n[apptId]; return n; });
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)' }}>📨 Notify clients</div>
        <button onClick={onClose} style={{ ...btnBase, padding: '5px 10px', fontSize: 12 }}>Done</button>
      </div>

      <div style={{ background: 'linear-gradient(135deg,#f3eafc,#eaf3fc)', border: '1px solid #d8d0e8', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#6a4fa0', lineHeight: 1.5 }}>
          <strong>AI-drafted outreach for {affected.length} affected client{affected.length === 1 ? '' : 's'}.</strong> Edit any message, then send via SMS or email. Reassigned appts get a "swap confirmation" message; un-reassigned appts get a "please reschedule" message.
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--pn-text-muted)', fontSize: 13 }}>
          ✨ Drafting personalized messages…
        </div>
      )}

      {error && (
        <div style={{ background: 'var(--pn-danger-bg)', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--pn-danger)', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {!loading && !error && drafts.length === 0 && (
        <div style={{ textAlign: 'center', padding: 16, fontSize: 12, color: 'var(--pn-text-muted)' }}>No drafts generated.</div>
      )}

      {!loading && drafts.map(d => {
        const appt = affected.find(a => a.id === d.apptId);
        if (!appt) return null;
        const sent     = sentByApptId[d.apptId] || {};
        const sending  = sendingByApptId[d.apptId];
        const r        = reassignmentsByApptId[d.apptId];
        const dStr     = (() => {
          try { return new Date(appt.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
          catch { return appt.date; }
        })();
        const tStr     = appt.startTime ? minsToStr(strToMins(appt.startTime)) : '';
        const isReassigned = !!r;

        return (
          <div key={d.apptId} style={{ border: '1px solid var(--pn-border)', borderRadius: 10, padding: 10, marginBottom: 10, background: 'var(--pn-surface)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', flex: 1 }}>{appt.clientName || 'Client'}</div>
              <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>{dStr} · {tStr}</div>
            </div>

            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 8 }}>
              {isReassigned
                ? <>↪ Reassigned: {appt.techName} → <strong>{r.newTech}</strong></>
                : <>⚠ No coverage — needs reschedule</>
              }
            </div>

            {/* SMS block */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', fontWeight: 600 }}>📱 SMS</div>
                <div style={{ fontSize: 10, color: appt.clientPhone ? '#22c55e' : 'var(--pn-text-faint)' }}>
                  {appt.clientPhone || 'no phone on file'}
                </div>
              </div>
              <textarea
                value={d.smsDraft}
                onChange={e => patchDraft(d.apptId, { smsDraft: e.target.value })}
                rows={3}
                style={{ ...inp, fontSize: 12, width: '100%', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <div style={{ fontSize: 10, color: d.smsDraft.length > 160 ? '#92400e' : 'var(--pn-text-faint)' }}>
                  {d.smsDraft.length} chars{d.smsDraft.length > 160 && ' · 2+ segments'}
                </div>
                <button
                  onClick={() => send(d.apptId, 'sms')}
                  disabled={!appt.clientPhone || !appt.clientId || sending === 'sms' || sent.sms === 'sent'}
                  style={{
                    fontSize: 11, padding: '5px 10px', borderRadius: 6, border: 'none',
                    background: sent.sms === 'sent' ? '#22c55e' : sent.sms === 'failed' ? '#fca5a5' : (!appt.clientPhone || !appt.clientId) ? '#ccc' : '#3D95CE',
                    color: '#fff', cursor: (!appt.clientPhone || !appt.clientId || sent.sms === 'sent') ? 'default' : 'pointer', fontFamily: 'inherit',
                  }}>
                  {sending === 'sms' ? 'Sending…' : sent.sms === 'sent' ? '✓ Sent' : sent.sms === 'failed' ? 'Retry' : 'Send SMS'}
                </button>
              </div>
            </div>

            {/* Email block */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', fontWeight: 600 }}>✉️ Email</div>
                <div style={{ fontSize: 10, color: appt.clientEmail ? '#22c55e' : 'var(--pn-text-faint)' }}>
                  {appt.clientEmail || 'no email on file'}
                </div>
              </div>
              <input
                value={d.emailSubject}
                onChange={e => patchDraft(d.apptId, { emailSubject: e.target.value })}
                placeholder="Subject"
                style={{ ...inp, fontSize: 12, width: '100%', marginBottom: 4 }}
              />
              <textarea
                value={d.emailDraft}
                onChange={e => patchDraft(d.apptId, { emailDraft: e.target.value })}
                rows={4}
                style={{ ...inp, fontSize: 12, width: '100%', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  onClick={() => send(d.apptId, 'email')}
                  disabled={!appt.clientEmail || !appt.clientId || sending === 'email' || sent.email === 'sent'}
                  style={{
                    fontSize: 11, padding: '5px 10px', borderRadius: 6, border: 'none',
                    background: sent.email === 'sent' ? '#22c55e' : sent.email === 'failed' ? '#fca5a5' : (!appt.clientEmail || !appt.clientId) ? '#ccc' : '#2D7A5F',
                    color: '#fff', cursor: (!appt.clientEmail || !appt.clientId || sent.email === 'sent') ? 'default' : 'pointer', fontFamily: 'inherit',
                  }}>
                  {sending === 'email' ? 'Sending…' : sent.email === 'sent' ? '✓ Sent' : sent.email === 'failed' ? 'Retry' : 'Send email'}
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button onClick={onClose} style={{ ...btnBase, padding: '8px 14px', fontSize: 13 }}>Done</button>
      </div>
    </div>
  );
}

// ── Hours modal ────────────────────────────────────────
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_DAY = { open: '09:00', close: '18:00', closed: false };

function HoursModal({ settings, updateSettings, onClose }) {
  const saved = settings.storeHours || {};
  const [hours,     setHours]     = useState(() => {
    const h = {};
    WEEK_DAYS.forEach(d => { h[d] = { ...DEFAULT_DAY, ...saved[d] }; });
    return h;
  });
  const [lateEnabled, setLateEnabled] = useState(settings.lateCheckinAlert?.enabled !== false);
  const [lateMins,    setLateMins]    = useState(String(Number(settings.lateCheckinAlert?.minutes) > 0 ? Number(settings.lateCheckinAlert.minutes) : 15));
  const [saving,    setSaving]    = useState(false);

  function patch(day, delta) {
    setHours(h => ({ ...h, [day]: { ...h[day], ...delta } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const lm = Math.max(1, Math.min(120, parseInt(lateMins, 10) || 15));
      // Note: salon-wide apptHours is intentionally NOT written here anymore —
      // appointment-only hours are per-tech now. The existing settings.apptHours
      // value is left in place as a migration fallback for extended techs that
      // haven't been given a per-tech window yet (see techApptWindow).
      await updateSettings({ ...settings, storeHours: hours,
        lateCheckinAlert: { enabled: lateEnabled, minutes: lm } });
      // Mirror to the publicly-readable webfront doc so the public website
      // (which can't read staff-only `settings`) shows the same hours. Best-
      // effort: a webfront write failure shouldn't block the schedule save.
      try {
        await patchWebfrontConfig({ hours: storeHoursToWebfrontHours(hours) });
      } catch (e) { console.warn('[hours mirror → webfront]', e?.message || e); }
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 440, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>🕐 Store Hours</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {/* Per-day hours */}
          {WEEK_DAYS.map((day, i) => {
            const h = hours[day];
            return (
              <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: i > 0 ? '1px solid var(--pn-border)' : 'none' }}>
                <div style={{ width: 32, fontSize: 13, fontWeight: 500, color: h.closed ? 'var(--pn-text-faint)' : 'var(--pn-text)' }}>{day}</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--pn-text-muted)', cursor: 'pointer', userSelect: 'none', minWidth: 62 }}>
                  <input type="checkbox" checked={!!h.closed} onChange={e => patch(day, { closed: e.target.checked })} />
                  Closed
                </label>
                {!h.closed && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                    <input type="time" value={h.open}  onChange={e => patch(day, { open:  e.target.value })}
                      style={{ fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '5px 7px', fontSize: 12 }} />
                    <span style={{ color: 'var(--pn-text-faint)' }}>–</span>
                    <input type="time" value={h.close} onChange={e => patch(day, { close: e.target.value })}
                      style={{ fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '5px 7px', fontSize: 12 }} />
                  </div>
                )}
              </div>
            );
          })}

          {/* Appointment-only hours are now PER-TECH (Employees → tech →
              "Can be booked outside store hours"), not one salon-wide window. */}
          <div style={{ marginTop: 16, padding: '12px', background: 'var(--pn-info-bg)', borderRadius: 10, border: '1px solid #c7dff7' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-info)', marginBottom: 4 }}>Appointment-only hours</div>
            <div style={{ fontSize: 11, color: 'var(--pn-info)', lineHeight: 1.5 }}>Now set <strong>per tech</strong> — open a tech in <strong>Employees</strong> and turn on “Can be booked outside store hours (appointment-only).” Each tech's window defaults to your store hours.</div>
          </div>

          {/* Late check-in alert */}
          <div style={{ marginTop: 16, padding: '12px', background: 'var(--pn-warning-bg)', borderRadius: 10, border: '1px solid var(--pn-warning)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={lateEnabled} onChange={e => setLateEnabled(e.target.checked)} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-warning)' }}>Late check-in alert</span>
            </label>
            <div style={{ fontSize: 11, color: 'var(--pn-warning)', margin: '8px 0 10px' }}>
              Push the tech when a client hasn&apos;t checked in this many minutes after their appointment — to check them in or mark a no-show.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: lateEnabled ? 1 : 0.5 }}>
              <input type="number" min="1" max="120" value={lateMins} disabled={!lateEnabled}
                onChange={e => setLateMins(e.target.value)}
                style={{ fontFamily: 'inherit', border: '1px solid var(--pn-warning)', borderRadius: 8, padding: '6px 8px', fontSize: 12, width: 72 }} />
              <span style={{ fontSize: 12, color: 'var(--pn-warning)' }}>minutes after start</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--pn-border)', flexShrink: 0 }}>
          <button onClick={onClose} style={{ flex: 1, ...btnBase }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 2, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE', opacity: saving ? .6 : 1 }}>
            {saving ? 'Saving…' : 'Save Hours'}
          </button>
        </div>
      </div>
    </div>
  );
}
