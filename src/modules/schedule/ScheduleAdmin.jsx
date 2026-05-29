import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { parsePhoneNumberFromString as lpnParse, AsYouType as AsYouTypeFormatter } from 'libphonenumber-js';
import { fetchAppointments, fetchAppointmentsByRange, fetchAppointmentById, subscribeToAppointments, subscribeToAppointmentsByRange, createAppointment, saveAppointment, deleteAppointment, deleteRecurringGroup, fetchRecurringGroup, fetchClients, createClient, fetchServices, fetchEmployees, fetchUserPrefs, saveUserPrefs, subscribeQueue, updateWaitlistEntry, removeWaitlistEntry, subscribeTurnRoster, saveTurnRoster, subscribeTimeOff, createTimeOff, updateTimeOff, deleteTimeOff, fetchClientVisits } from '../../lib/firestore';
import CheckoutModal from '../checkout/CheckoutModal';
import RefundModal from '../checkout/RefundModal';
import RestoreFromBQModal from '../../components/RestoreFromBQModal';
import { useApp } from '../../context/AppContext';
import { logActivity } from '../../lib/logger';
import { applyTurnCredit, recomputeTodayTurns } from '../../lib/turnCredit';
import { notifyAffectedTechs } from '../../lib/notifications';
import { TENANT_ID } from '../../lib/tenant';
import { resizeImg } from '../../utils/helpers';
import { resolveServicePricing } from '../../utils/serviceHelpers';
import VoiceAssistant from '../voice/VoiceAssistant';
import NotesEditor from '../../components/NotesEditor';
import CoachMark from '../../components/CoachMark';

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
  scheduled:     { bg: '#DBEAFE', border: '#3B82F6', text: '#1e40af' },
  'in-progress': { bg: '#FEF3C7', border: '#F59E0B', text: '#78350f' },
  done:          { bg: '#D1FAE5', border: '#10B981', text: '#065f46' },
  cancelled:     { bg: '#FEE2E2', border: '#EF4444', text: '#991b1b' },
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

function blankAppt(date, techName, startMins, clientName = '', serviceName = '') {
  return {
    clientId: '',
    clientName: clientName,
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
  const apptOpen    = strToMins(settings.apptHours?.open  || '09:00');
  const apptClose   = strToMins(settings.apptHours?.close || '20:00');
  const dayStart    = Math.min(walkInOpen, apptOpen);
  const dayEnd      = Math.max(walkInClose, apptClose);
  const slots = [];
  for (let m = dayStart; m < dayEnd; m += 30) slots.push(m);
  const [appts,        setAppts]       = useState([]);
  const [loading,      setLoading]     = useState(true);
  const [modal,        setModal]       = useState(null);
  const [checkout,     setCheckout]    = useState(null);
  const [refund,       setRefund]      = useState(null);
  const [clients,      setClients]     = useState([]);
  const [services,     setServices]    = useState([]);
  const [techs,        setTechs]       = useState(FALLBACK_TECHS);
  const [techExtended,     setTechExtended]     = useState({});
  const [showAll,          setShowAll]          = useState(false);
  const [showHours,        setShowHours]        = useState(false);
  const [showTimeOff,      setShowTimeOff]      = useState(false);
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
  const [showQueue,        setShowQueue]        = useState(false);
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
    const unsub = subscribeToAppointments(date, list => {
      setAppts(list);
      setLoading(false);
    });
    return unsub;
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

  // Real-time queue listener — always on so badge stays current
  useEffect(() => {
    const unsub = subscribeQueue(todayStr(), setQueueEntries);
    return unsub;
  }, []);

  // Live time-off subscription so blocked-out periods render on the day grid
  // and slot interactions can respect them.
  useEffect(() => {
    const unsub = subscribeTimeOff(setTimeOff);
    return unsub;
  }, []);

  // Real-time turn roster (today only) for the walk-in rotation panel.
  useEffect(() => {
    const unsub = subscribeTurnRoster(todayStr(), setTurnRoster);
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

  async function handleSave(appt, original) {
    try {
      // No-anonymous-customers rule (2026-05-12): every NEW appointment
      // must reference a real client record. Existing walk-in appts
      // (legacy / GG-imported, no clientId) stay editable without
      // forcing a fresh assignment, since there are thousands of them
      // and the user might just be tweaking notes / status / time.
      if (!appt.id && !appt.clientId) {
        alert('Pick an existing client from the search box, or use "+ Create new client contact" to add one. Anonymous appointments are no longer allowed — every client needs a phone number.');
        return;
      }
      const dur = appt.services.reduce((sum, s) => sum + (Number(s.duration) || 0), 0) || 60;
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
      const full = { ...apptBase, notes: derivedNotes, duration: dur };
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
          applyTurnCredit({ ...full, id: appt.id }).then(applied => {
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
        const newId = await createAppointment(full);
        full.id = newId;
        logActivity('appt_created', logDetail);
      }

      notifyAffectedTechs(original, full, gUser).catch(e => console.error('[Notif]', e));
      if (viewMode === 'week') { await loadWeek(); } else { await load(); }
      setModal(null);
    } catch (e) { console.error('[Schedule] save failed:', e); }
  }

  async function handleDelete(appt) {
    if (appt.recurringGroupId) {
      setDeleteDialog(appt);
      return;
    }
    if (!confirm(`Delete this appointment for ${appt.clientName || 'walk-in'}?`)) return;
    await deleteAppointment(appt.id);
    const svcNames = (appt.services || []).map(s => s.name || s.customName).filter(Boolean).join(', ') || 'no services';
    logActivity('appt_deleted', `${appt.clientName || 'walk-in'} with ${appt.techName} on ${appt.date} — ${svcNames}`);
    setAppts(a => a.filter(x => x.id !== appt.id));
    setModal(null);
  }

  async function handleDeleteOne(appt) {
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
        applyTurnCredit({ ...full, id: appt.id }).then(applied => {
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
  const displayTechs   = isTech && !showAll
    ? techs.filter(t => t === myTechName)
    : (focusedTech && techs.includes(focusedTech))
      ? [focusedTech]
      : visibleTechNames ? techs.filter(t => visibleTechNames.includes(t)) : techs;

  const personalView   = isTech && !showAll;
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
            <button onClick={() => setDate(todayStr())} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: date === todayStr() ? '#3D95CE' : '#fff', color: date === todayStr() ? '#fff' : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>
              Today
            </button>
            <NavBtn onClick={() => setDate(d => addDays(d, 1))}>›</NavBtn>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{fmtDate(date)}</span>
            {isTech && (
              <button onClick={() => setShowAll(v => !v)} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, fontFamily: 'inherit', cursor: 'pointer', border: `1px solid ${showAll ? '#3D95CE' : '#d8d8d8'}`, background: showAll ? '#EBF4FB' : '#fff', color: showAll ? '#1a5f8a' : '#555', fontWeight: showAll ? 600 : 400 }}>
                {showAll ? '👥 All Techs' : '👤 My Column'}
              </button>
            )}
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ marginLeft: 'auto', fontSize: 12, border: '1px solid #d8d8d8', borderRadius: 6, padding: '5px 8px', fontFamily: 'inherit', background: '#fafafa' }} />
          </>
        ) : (
          <>
            <NavBtn onClick={() => setDate(addDays(weekStart, -7))}>‹</NavBtn>
            <button onClick={() => setDate(todayStr())} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: weekStart === weekStartOf(todayStr()) ? '#3D95CE' : '#fff', color: weekStart === weekStartOf(todayStr()) ? '#fff' : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>
              This week
            </button>
            <NavBtn onClick={() => setDate(addDays(weekStart, 7))}>›</NavBtn>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>
              Week of {new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(addDays(weekStart, 6) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
            <span style={{ marginLeft: 'auto' }} />
          </>
        )}

        {/* Day / Week toggle */}
        <div style={{ display: 'flex', border: '1px solid #d8d8d8', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
          {[['day','Day'],['week','Week']].map(([v, label]) => (
            <button key={v} onClick={() => setViewMode(v)} style={{ padding: '5px 12px', border: 'none', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', background: viewMode === v ? '#3D95CE' : '#fff', color: viewMode === v ? '#fff' : '#555', fontWeight: viewMode === v ? 600 : 400 }}>
              {label}
            </button>
          ))}
        </div>

        {/* Queue button with waiting-count badge */}
        {(() => {
          const waiting = queueEntries.filter(e => e.status === 'waiting').length;
          return (
            <button onClick={() => setShowQueue(v => !v)} style={{
              position: 'relative', fontSize: 12, padding: '5px 10px', borderRadius: 6, flexShrink: 0,
              border: `1px solid ${showQueue ? '#2D7A5F' : '#d8d8d8'}`,
              background: showQueue ? '#f0faf6' : '#fff',
              color: showQueue ? '#2D7A5F' : '#555', cursor: 'pointer', fontFamily: 'inherit', fontWeight: showQueue ? 600 : 400,
            }}>
              📋 Queue
              {waiting > 0 && (
                <span style={{ position: 'absolute', top: -5, right: -5, width: 17, height: 17, borderRadius: '50%', background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {waiting}
                </span>
              )}
            </button>
          );
        })()}

        {/* Overflow menu — keeps the toolbar focused on daily controls
            (date nav, view toggle, queue) and tucks infrequent ones
            (Hours, Time Off) under a single ⚙ button. Closed by
            default; clicking outside dismisses it. */}
        {(isAdmin || isScheduler || isTech) && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setShowToolbarMenu(o => !o)}
              title="Schedule options"
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${showToolbarMenu ? '#3D95CE' : '#d8d8d8'}`, background: showToolbarMenu ? '#eff6ff' : '#fff', color: showToolbarMenu ? '#1e40af' : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>
              ⚙ Options
            </button>
            {showToolbarMenu && (
              <>
                {/* Click-away catcher */}
                <div onClick={() => setShowToolbarMenu(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 19, background: 'transparent' }} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                  background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 20,
                  minWidth: 200, padding: 4,
                }}>
                  {isAdmin && (
                    <button onClick={() => { setShowHours(true); setShowToolbarMenu(false); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: '#333', borderRadius: 6 }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f5f9ff'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <span>🕐</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>Store hours</div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>Open / close times by day</div>
                      </div>
                    </button>
                  )}
                  <button onClick={() => { setShowTimeOff(true); setShowToolbarMenu(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: '#333', borderRadius: 6 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f5f9ff'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <span>🌴</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>Time off</div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>Vacation / sick / personal</div>
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
          onClose={() => setShowTimeOff(false)}
        />
      )}

      {/* Turn roster — walk-in rotation (visible whenever the queue is open or when there's a roster) */}
      {(showQueue || (turnRoster.roster && turnRoster.roster.length > 0)) && date === todayStr() && (
        <TurnRosterPanel
          roster={turnRoster.roster || []}
          allTechs={(employees && employees.length > 0) ? employees : techs.map(n => ({ id: n, name: n }))}
          onAddTech={async tech => {
            const next = [...(turnRoster.roster || []), { techId: tech.id, techName: tech.name, clockInAt: new Date().toISOString(), turnsTaken: 0 }];
            await saveTurnRoster(todayStr(), next).catch(e => showToast('Save failed: ' + e.message, 3000));
            logActivity('turn_clockin', tech.name);
          }}
          onRemoveTech={async techId => {
            const next = (turnRoster.roster || []).filter(r => r.techId !== techId);
            await saveTurnRoster(todayStr(), next).catch(e => showToast('Save failed: ' + e.message, 3000));
          }}
          onResetDay={async () => {
            if (!window.confirm('Clear today\'s turn roster? Everyone will need to clock back in.')) return;
            await saveTurnRoster(todayStr(), []).catch(e => showToast('Save failed: ' + e.message, 3000));
          }}
          onRecount={async () => {
            try {
              const result = await recomputeTodayTurns();
              const lines = Object.entries(result.byTech).map(([n, c]) => `${n}: ${c}`).join(' · ');
              showToast(`Recounted ${result.recounted} done appts today${lines ? ' — ' + lines : ''}`, 5000);
            } catch (e) {
              showToast('Recount failed: ' + e.message, 3500);
            }
          }}
        />
      )}

      {/* Queue panel */}
      {showQueue && (
        <QueuePanel
          entries={queueEntries}
          turnRoster={turnRoster.roster || []}
          onAutoSeatNext={async (entry) => {
            const next = nextUpInRotation(turnRoster.roster || []);
            if (!next) {
              showToast('No techs in turn rotation. Clock someone in first.', 3500);
              return;
            }
            // Immediate +1 so the rotation visibly advances at seating time.
            // Mark the new appt as already-credited so the future checkout
            // doesn't double-count this same walk-in.
            const updatedRoster = (turnRoster.roster || []).map(r =>
              r.techId === next.techId ? { ...r, turnsTaken: (Number(r.turnsTaken) || 0) + 1 } : r
            );
            await saveTurnRoster(todayStr(), updatedRoster).catch(() => {});
            setShowQueue(false);
            setDate(todayStr());
            setViewMode('day');
            setModal({
              appt: {
                ...blankAppt(todayStr(), next.techName, null, entry.clientName, entry.serviceName),
                _turnCredited: new Date().toISOString(),
              },
              original: null,
              mode: 'edit',
            });
            updateWaitlistEntry(entry.id, { status: 'seated' }).catch(() => {});
            logActivity('walkin_auto_seated', `${entry.clientName} → ${next.techName}`);
          }}
          onSeat={entry => {
            setShowQueue(false);
            setDate(todayStr());
            setViewMode('day');
            setModal({ appt: blankAppt(todayStr(), entry.techName === 'Any' ? '' : entry.techName, null, entry.clientName, entry.serviceName), original: null, mode: 'edit' });
            updateWaitlistEntry(entry.id, { status: 'seated' }).catch(() => {});
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
        // Quick-filter helpers. "Working today" = the tech's per-day shift
        // (empWorkDays) is not explicitly off AND no all-day time-off block
        // covers today. "Working now" tightens that to: current clock time
        // falls inside the shift window AND no partial-day time-off covers
        // it. We derive on every render — no extra state — so the buttons
        // stay accurate as the day rolls forward.
        const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
        const techIsWorkingToday = (t) => {
          const wd = empWorkDays[t]?.[dow];
          if (wd && wd.on === false) return false;
          // All-day time off blocks count the tech as off today.
          const blocks = timeOffOnDate(timeOff, t, date);
          if (blocks.some(b => b.allDay !== false)) return false;
          return true;
        };
        const techIsWorkingNow = (t) => {
          if (!techIsWorkingToday(t)) return false;
          const wd = empWorkDays[t]?.[dow] || {};
          const start = wd.start ? strToMins(wd.start) : strToMins(settings.apptHours?.open  || '09:00');
          const end   = wd.end   ? strToMins(wd.end)   : strToMins(settings.apptHours?.close || '20:00');
          if (nowMins < start || nowMins >= end) return false;
          if (isSlotBlocked(timeOff, t, date, nowMins)) return false;
          return true;
        };
        const applyFilter = (predicate) => {
          const next = techs.filter(predicate);
          setVisibleTechNames(next.length ? next : techs);
          localStorage.setItem(OVERLAY_KEY, JSON.stringify(next.length ? next : techs));
        };
        const showAllTechs = () => { setVisibleTechNames(techs); localStorage.setItem(OVERLAY_KEY, JSON.stringify(techs)); };
        const isToday = date === todayStr();
        const Btn = ({ label, onClick, hint }) => (
          <button onClick={onClick} title={hint}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, border: '1.5px solid #d8d8d8', background: '#fff', color: '#444', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
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
                    border: `1.5px solid ${on ? col.solid : '#d8d8d8'}`,
                    background: on ? col.bg : '#f5f5f5',
                    color: on ? col.text : '#bbb',
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
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '7px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 14 }}>🚫</span>
          <span style={{ fontSize: 12, color: '#991b1b', fontWeight: 500 }}>Salon is closed today — appointments can still be booked manually</span>
        </div>
      )}

      {/* Client birthdays banner — day view only */}
      {viewMode === 'day' && birthdayClients.length > 0 && (
        <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '7px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>🎂</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#9A3412' }}>Client birthdays today:</span>
          {birthdayClients.map(c => (
            <span key={c.id} style={{ fontSize: 12, color: '#7C2D12', background: '#FFEDD5', borderRadius: 20, padding: '2px 10px', border: '1px solid #FED7AA' }}>
              {c.name}
            </span>
          ))}
        </div>
      )}

      {/* Staff birthdays banner — day view only */}
      {viewMode === 'day' && birthdayEmployees.length > 0 && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '7px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>🎊</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#14532D' }}>Staff birthdays today:</span>
          {birthdayEmployees.map(e => (
            <span key={e.id} style={{ fontSize: 12, color: '#166534', background: '#DCFCE7', borderRadius: 20, padding: '2px 10px', border: '1px solid #BBF7D0' }}>
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
          ? <div style={{ textAlign: 'center', color: '#bbb', padding: 40, fontSize: 13 }}>Loading…</div>
          : <WeekGrid
              weekStart={weekStart}
              appts={weekAppts}
              clients={clients}
              employees={employees}
              allTechs={techs}
              onApptClick={appt => { setDate(appt.date); openView(appt); }}
              onDayClick={d => { setDate(d); setViewMode('day'); }}
            />
        : loading
          ? <div style={{ textAlign: 'center', color: '#bbb', padding: 40, fontSize: 13 }}>Loading…</div>
          : <DayGrid
              date={date}
              appts={appts}
              timeOff={timeOff}
              techs={displayTechs}
              allTechs={techs}
              clients={clients}
              techExtended={techExtended}
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
          onSave={() => handleSave(modal.appt, modal.original)}
          onDelete={() => handleDelete(modal.appt)}
          onClose={() => setModal(null)}
          onCheckout={appt => { setModal(null); setCheckout({ appts: [appt], walkInClient: null }); }}
          onAddToTicket={appt => { setModal(null); addApptToTicket(appt); showToast(`Added ${appt.clientName || 'walk-in'} to ticket`); }}
          onRefund={appt => setRefund(appt)}
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
          appt={refund}
          onComplete={() => { setRefund(null); setModal(null); load(); }}
          onClose={() => setRefund(null)}
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

// ── Turn roster panel — today's walk-in rotation ──────
function TurnRosterPanel({ roster, allTechs, onAddTech, onRemoveTech, onResetDay, onRecount }) {
  const [showPicker, setShowPicker] = useState(false);
  const inRoster = new Set(roster.map(r => r.techId));
  const available = (allTechs || []).filter(t => !inRoster.has(t.id));
  const sorted = [...roster].sort((a, b) => {
    const ta = a.turnsTaken || 0, tb = b.turnsTaken || 0;
    if (ta !== tb) return ta - tb;
    return (a.clockInAt || '').localeCompare(b.clockInAt || '');
  });
  const next = sorted[0];

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, marginBottom: 12, overflow: 'visible', flexShrink: 0, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', flex: 1, minWidth: 0 }}>
          🎯 Walk-in turn order
          {next && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#2D7A5F', background: '#EDFAF3', borderRadius: 20, padding: '2px 10px', border: '1px solid #c6e8d5' }}>Next up: {next.techName}</span>}
        </span>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowPicker(o => !o)} disabled={available.length === 0}
            style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: available.length === 0 ? '#ccc' : 'var(--tm-primary, #2D7A5F)', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: available.length === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            + Clock in
          </button>
          {showPicker && available.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 50, minWidth: 180, maxHeight: 280, overflowY: 'auto' }}>
              {available.map(t => (
                <button key={t.id} onClick={() => { onAddTech(t); setShowPicker(false); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#333', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderBottom: '1px solid #f5f5f5' }}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {roster.length > 0 && (
          <button onClick={onRecount}
            title="Rebuild turn counts from today's completed appointments"
            style={{ fontSize: 11, color: '#1a5f8a', background: '#EBF4FB', border: '1px solid #bfdbfe', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
            ↺ Recount
          </button>
        )}
        {roster.length > 0 && (
          <button onClick={onResetDay}
            style={{ fontSize: 11, color: '#888', background: 'none', border: '1px solid #e0e0e0', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
            Reset day
          </button>
        )}
      </div>
      {roster.length === 0 ? (
        <div style={{ padding: '14px', fontSize: 12, color: '#bbb', textAlign: 'center' }}>
          No techs clocked in yet. Click <strong style={{ color: '#666' }}>+ Clock in</strong> as people arrive — the rotation order is determined by clock-in time.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 10 }}>
          {sorted.map((r, i) => (
            <div key={r.techId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 20, background: i === 0 ? '#EDFAF3' : '#fafafa', border: `1px solid ${i === 0 ? '#c6e8d5' : '#e8e8e8'}` }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? '#2D7A5F' : '#888' }}>#{i + 1}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>{r.techName}</span>
              <span style={{ fontSize: 10, color: '#aaa' }}>{fmtClockIn(r.clockInAt)} · {(r.turnsTaken || 0) % 1 === 0 ? (r.turnsTaken || 0) : (r.turnsTaken || 0).toFixed(1)} turn{(r.turnsTaken || 0) === 1 ? '' : 's'}</span>
              <button onClick={() => onRemoveTech(r.techId)} title="Clock out"
                style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, marginLeft: 2, fontFamily: 'inherit' }}>×</button>
            </div>
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
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, marginBottom: 12, overflow: 'hidden', flexShrink: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', flex: 1, minWidth: 0 }}>
          📋 Today's Queue
          {waiting.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#fff', background: '#ef4444', borderRadius: 20, padding: '1px 7px' }}>{waiting.length}</span>}
        </span>
        <a href={kioskUrl} target="_blank" rel="noreferrer"
          style={{ fontSize: 11, color: '#3D95CE', textDecoration: 'none', fontWeight: 600, padding: '4px 10px', border: '1px solid #3D95CE', borderRadius: 20 }}>
          Open Kiosk ↗
        </a>
      </div>

      {waiting.length === 0 && done.length === 0 ? (
        <div style={{ padding: '20px 14px', fontSize: 12, color: '#bbb', textAlign: 'center' }}>Queue is empty — clients can add themselves at <strong style={{ color: '#3D95CE' }}>/?queue</strong></div>
      ) : (
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {waiting.map((entry, i) => {
            const canCheckout = entry.hasAppointment && entry.apptId;
            return (
              <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid #f5f5f5' }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: entry.hasAppointment ? '#EBF4FB' : '#f0faf6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: entry.hasAppointment ? '#1a5f8a' : '#2D7A5F', flexShrink: 0 }}>
                  {entry.hasAppointment ? '📅' : i + 1 - arrived.filter((_, j) => j < arrived.indexOf(entry)).length}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{entry.clientName}</span>
                    {entry.hasAppointment && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: '#EBF4FB', color: '#1a5f8a', border: '1px solid #93C5FD' }}>Has appt</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>
                    {entry.serviceName || '—'}
                    {entry.techName && entry.techName !== 'Any' ? ` · ${entry.techName}` : ' · Any tech'}
                    <span style={{ marginLeft: 6, color: '#ccc' }}>· {waitTime(entry.addedAt)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {entry.isWalkIn && turnRoster && turnRoster.length > 0 && (
                    <button onClick={() => onAutoSeatNext(entry)} title={`Auto-seat with the next tech in rotation (${nextUpInRotation(turnRoster)?.techName || ''})`}
                      style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--tm-primary, #2D7A5F)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      🎯 Next
                    </button>
                  )}
                  {entry.isWalkIn && (
                    <button onClick={() => onSeat(entry)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #c6e8d5', background: '#f0faf6', color: '#2D7A5F', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Seat
                    </button>
                  )}
                  {canCheckout && (
                    <button onClick={() => onAddToTicket(entry)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #bfdbfe', background: '#EBF4FB', color: '#1a5f8a', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      🧾 Add to ticket
                    </button>
                  )}
                  <button onClick={() => onRemove(entry)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
          {done.length > 0 && (
            <div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 600, color: '#ccc', textTransform: 'uppercase', letterSpacing: '.06em', borderTop: '1px solid #f5f5f5', background: '#fafafa' }}>
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
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8, flexShrink: 0 }}>
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
            <div key={day} style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${isToday ? '#3D95CE' : '#e8e8e8'}`, borderRadius: 8, overflow: 'hidden', background: '#fff', minHeight: 0 }}>

              {/* Day header */}
              <div onClick={() => onDayClick(day)} style={{
                padding: '7px 8px', cursor: 'pointer', flexShrink: 0,
                background: isToday ? '#EBF4FB' : '#fafafa',
                borderBottom: `2px solid ${isToday ? '#3D95CE' : '#e8e8e8'}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: isToday ? '#1a5f8a' : '#333' }}>{headerFmt}</div>
                <div style={{ fontSize: 10, color: '#aaa', marginTop: 1 }}>
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
                  ? <div style={{ fontSize: 10, color: '#e8e8e8', textAlign: 'center', paddingTop: 14 }}>—</div>
                  : dayAppts.map(appt => {
                      const col         = getTechColor(appt.techName, allTechs || []);
                      const dot         = STATUS_DOT[appt.status] || STATUS_DOT.scheduled;
                      const isCancelled = appt.status === 'cancelled';
                      const isDone      = appt.status === 'done';
                      const blockBg     = isCancelled ? '#fef2f2' : isDone ? '#f3f4f6' : col.bg;
                      const blockBorder = isCancelled ? '#EF4444' : isDone ? '#9ca3af' : col.solid;
                      const blockText   = isCancelled ? '#991b1b' : isDone ? '#6b7280' : col.text;
                      // Allergy lookup — surfaces a ⚠ on the block so the
                      // tech sees it before opening the appt. Falls back
                      // to no-op for walk-ins / unlinked appts.
                      const apptAllergies = appt.clientId
                        ? (clients.find(c => c.id === appt.clientId)?.allergies || '')
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
              <div onClick={() => onDayClick(day)} style={{ padding: '4px 8px', borderTop: '1px solid #f0f0f0', fontSize: 10, color: '#3D95CE', cursor: 'pointer', textAlign: 'center', flexShrink: 0, background: '#fafafa' }}>
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
function DayGrid({ date, appts, timeOff = [], techs, allTechs, clients = [], techExtended, empWorkDays, slots, dayStart, walkInOpen, walkInClose, techColWidth, focusedTech, onToggleFocusTech, onSlotClick, onApptClick, onApptReschedule }) {
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

  const isToday = date === todayStr();
  const nowMins = isToday ? (new Date().getHours() * 60 + new Date().getMinutes()) : -1;
  const nowHour = isToday ? new Date().getHours() : -1;
  const nowLineTop = (isToday && nowMins >= dayStart && nowMins < dayStart + slots.length * 30)
    ? ((nowMins - dayStart) / 30) * SLOT_H
    : null;

  const hasApptOnlyZone = slots.some(m => m < walkInOpen || m >= walkInClose);

  return (
    <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', borderRadius: 10, border: '1px solid #e8e8e8', background: '#fff' }}>
      {/* Header row */}
      <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, background: '#fafafa', borderBottom: '2px solid #e8e8e8' }}>
        <div style={{ width: TIME_COL, flexShrink: 0 }} />
        {techs.map(tech => {
          const isOff = empWorkDays[tech]?.[dow]?.on === false;
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
              style={{ width: TECH_COL, flexShrink: 0, fontSize: 11, fontWeight: 600, color: isOff ? '#bbb' : col.text, textAlign: 'center', borderLeft: '1px solid #e8e8e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: isOff ? '#fafafa' : col.bg, paddingBottom: 6, cursor: canFocus ? 'pointer' : 'default', userSelect: 'none' }}>
              <div style={{ height: 3, background: isOff ? '#e0e0e0' : col.solid, marginBottom: 6 }} />
              <div style={{ padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: canFocus ? 'underline dotted' : 'none', textUnderlineOffset: 3, textDecorationColor: '#bbb' }}>
                {isFocused ? `← ${tech}` : tech}
              </div>
              {isOff && (
                <div style={{ fontSize: 8, color: '#d0d0d0', fontWeight: 500, letterSpacing: '.03em' }}>off today</div>
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
            borderBottom: isHourStart ? '1px solid #e8e8e8' : '1px solid #f5f5f5',
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
                <span style={{ fontSize: 12, color: isCurrentHr ? '#ef4444' : isPast ? '#ccc' : '#888', fontWeight: isCurrentHr ? 700 : 600 }}>
                  {minsToStr(slotMins)}
                </span>
              )}
              {isBoundary && (
                <span style={{ fontSize: 7, color: '#f59e0b', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', lineHeight: 1.2 }}>appt only</span>
              )}
            </div>

            {/* Tech cells */}
            {techs.map(tech => {
              const isOff  = empWorkDays[tech]?.[dow]?.on === false;
              const blockedBy = isSlotBlocked(timeOff, tech, date, slotMins);
              // `interactive` controls drag-drop reschedule (drop targets are
              // limited to slots where the tech is actually working).
              // `clickable` is broader — clicking an off / time-off slot still
              // works; we just gate the new-appt modal behind a confirm so
              // staff can't book over a tech's day off by mistake.
              const interactive = !isOff && !blockedBy;
              const clickable   = true;
              const inExtended  = !inWalkIn && techExtended[tech];
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
                    width: TECH_COL, flexShrink: 0, borderLeft: '1px solid #ececec',
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
                    <div style={{ position: 'absolute', inset: 0, transition: 'background .1s' }}
                         onMouseEnter={e => e.currentTarget.style.background = inWalkIn ? 'rgba(59,130,246,.08)' : 'rgba(59,130,246,.13)'}
                         onMouseLeave={e => e.currentTarget.style.background = ''} />
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
          // Build per-(tech, appt) layout: { laneIndex, laneCount }.
          // Standard sweep-line: sort by startTime, place each appt in the
          // lowest free lane, expand laneCount whenever a cluster grows.
          const layoutById = {};
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
              cluster.forEach(c => { layoutById[c.id] = { lane: c.lane, laneCount }; });
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
          const blockBg     = isCancelled ? '#fef2f2' : isDone ? '#f3f4f6' : col.bg;
          const blockBorder = isCancelled ? '#EF4444' : isDone ? '#9ca3af' : col.solid;
          const blockText   = isCancelled ? '#991b1b' : isDone ? '#6b7280' : col.text;

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
                    ? (clients.find(c => c.id === appt.clientId)?.allergies || '')
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
function ApptModal({ appt, mode, clients, services, techs, employees = [], onChange, onSwitchEdit, onSave, onDelete, onClose, onCheckout, onAddToTicket, onRefund, onOpenClient, onClientCreated, viewOnly, isAdmin, onReload }) {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const { gUser, settings } = useApp();
  const [saving,    setSaving]    = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Inline service-history panel — always rendered when an existing
  // appointment has a linked client. Fetched once on mount; appointments
  // + imported GG receipts joined client-side, newest-first.
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history,        setHistory]        = useState(null);
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
    const duration = svc ? (resolveServicePricing(svc, null, apptTech).duration || 60) : 60;
    patchService(i, { name, duration, price: svc?.basePrice || '' });
  }

  // Re-resolve every service's duration for the newly-assigned tech so their
  // per-service times take effect. Items carrying an explicit option override
  // (e.g. created via online booking) keep their resolved duration.
  function pickTechName(name) {
    const newTech = employees.find(e => e.name === name) || null;
    const next = (appt.services || []).map(sv => {
      if (sv.optionId) return sv;
      const svc = services.find(s => s.name === sv.name);
      if (!svc) return sv;
      return { ...sv, duration: resolveServicePricing(svc, null, newTech).duration || sv.duration || 60 };
    });
    onChange({ techName: name, services: next });
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

  const statusOpts = [
    { value: 'scheduled',    label: 'Scheduled' },
    { value: 'in-progress',  label: 'In Progress' },
    { value: 'done',         label: 'Done' },
    { value: 'cancelled',    label: 'Cancelled' },
    { value: 'no_show',      label: 'No-show' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '94%', maxWidth: 440, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {isNew ? 'New Appointment' : isView ? (appt.clientName || 'Walk-in') : 'Edit Appointment'}
            </span>
            {isView && !isNew && <ViewBadge />}
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
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
              background: blockers.length > 0 ? '#fef2f2' : '#fffbeb',
              border: `1px solid ${blockers.length > 0 ? '#fca5a5' : '#fde68a'}`,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700,
                color: blockers.length > 0 ? '#991b1b' : '#92400e',
                textTransform: 'uppercase', letterSpacing: '.05em',
                marginBottom: 6,
              }}>
                {blockers.length > 0
                  ? `Fix before saving (${blockers.length})`
                  : `Heads up (${warnings.length})`}
              </div>
              {blockers.map((b, i) => (
                <div key={`b${i}`} style={{ display: 'flex', gap: 8, fontSize: 12, color: '#991b1b', lineHeight: 1.45, padding: '2px 0' }}>
                  <span style={{ flexShrink: 0 }}>{b.icon}</span>
                  <span>{b.label}</span>
                </div>
              ))}
              {warnings.map((w, i) => (
                <div key={`w${i}`} style={{ display: 'flex', gap: 8, fontSize: 12, color: '#92400e', lineHeight: 1.45, padding: '2px 0' }}>
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
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }}>
                    ✓ Checked in
                  </span>
                )}
                {appt.recurringGroupId && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#f0f4ff', color: '#3D95CE', border: '1px solid #c7dff7' }}>
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
                      style={{ flex: 1, fontSize: 10, padding: '5px 4px', borderRadius: 6, border: `1.5px solid ${active ? colors.border : '#e0e0e0'}`, background: active ? colors.bg : '#fafafa', color: active ? colors.text : '#aaa', cursor: 'pointer', fontFamily: 'inherit', fontWeight: active ? 600 : 400 }}>
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

          {/* Banned-client warning — surfaces when the linked client has
              banned: true. Requires explicit override checkbox before save. */}
          {!isView && linkedBanned && (
            <div style={{
              marginBottom: 12,
              padding: '12px 14px',
              background: '#fef2f2',
              border: '1.5px solid #fca5a5',
              borderRadius: 10,
              fontSize: 13, color: '#991b1b', lineHeight: 1.5,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 18 }}>🚫</span>
                <strong style={{ fontSize: 14 }}>This client is banned</strong>
              </div>
              <div style={{ marginBottom: 10, color: '#b91c1c' }}>
                <strong>{linkedClient?.name}</strong> is flagged as banned in the client profile — bookings should not be accepted.
              </div>
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 9,
                padding: '8px 10px', background: '#fff',
                border: '1px solid #fca5a5', borderRadius: 8,
                cursor: 'pointer', fontSize: 12, color: '#991b1b',
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
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px dashed #fde68a', background: '#fffbeb', color: '#92400e', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                + Create new client contact
              </button>
            </div>
          )}
          {!isView && !appt.clientId && newClientOpen && dupeCandidates && (
            <div style={{ marginBottom: 10, padding: '12px', borderRadius: 10, background: '#fff7ed', border: '1px solid #fdba74' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#9a3412', fontWeight: 700 }}>
                  Possible duplicate{dupeCandidates.length > 1 ? 's' : ''} found ({dupeCandidates.length})
                </div>
                <button onClick={() => setDupeCandidates(null)} style={{ border: 'none', background: 'none', color: '#9a3412', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ fontSize: 11, color: '#9a3412', opacity: .85, marginBottom: 8 }}>
                A client with that {dupeCandidates[0].matchKind} is already on file. Pick which one to use for this appointment, or create a new record anyway.
              </div>
              <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #fed7aa', overflow: 'hidden', marginBottom: 8 }}>
                {dupeCandidates.map(({ client, matchKind }, i) => (
                  <div key={client.id} style={{ padding: '10px 12px', borderBottom: i < dupeCandidates.length - 1 ? '1px solid #fed7aa' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {client.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayPhone(client.phone) || '—'}{client.email ? ' · ' + client.email : ''}
                      </div>
                      <div style={{ fontSize: 10, color: '#9a3412', fontWeight: 600, marginTop: 2 }}>
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
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid #d0d0d0', background: '#fff', color: '#555', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
                <button onClick={() => {
                  const phoneInfo = normalizePhone(newClient.phone);
                  actuallyCreateClient((newClient.name || '').trim(), phoneInfo.empty ? '' : phoneInfo.formatted, (newClient.email || '').trim());
                }} disabled={newClientSaving}
                  style={{ flex: 2, padding: '8px 10px', border: '1.5px solid #ea580c', background: '#fff', color: '#9a3412', fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: newClientSaving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                  {newClientSaving ? 'Saving…' : 'Create new anyway'}
                </button>
              </div>
            </div>
          )}
          {!isView && !appt.clientId && newClientOpen && !dupeCandidates && (
            <div style={{ marginBottom: 10, padding: '12px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#92400e', fontWeight: 700 }}>New client profile</div>
                <button onClick={() => setNewClientOpen(false)} style={{ border: 'none', background: 'none', color: '#92400e', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
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
                    style={{ ...inp, width: '100%', borderColor: showEmailErr ? '#fca5a5' : '#d8d8d8' }} />
                  {emailSuggestionList.length > 0 && (
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 2px)', background: '#fff', border: '1px solid #d8d8d8', borderRadius: 8, zIndex: 220, maxHeight: 180, overflowY: 'auto', boxShadow: '0 6px 20px rgba(0,0,0,.12)' }}>
                      {emailSuggestionList.map(s => (
                        <div key={s}
                          onMouseDown={e => { e.preventDefault(); setNewClient(p => ({ ...p, email: s })); setEmailFocused(false); }}
                          style={{ padding: '7px 10px', fontSize: 12, color: '#1a1a1a', cursor: 'pointer', borderBottom: '1px solid #f5f5f5' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f5f9ff'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          {s}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {showEmailErr && (
                <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 6, marginTop: -2 }}>That email address looks invalid.</div>
              )}
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input type="date" placeholder="Birthday" value={newClient.birthday}
                  onChange={e => setNewClient(p => ({ ...p, birthday: e.target.value }))}
                  style={{ ...inp, flex: 1 }} />
              </div>
              <textarea placeholder="Notes (optional)" rows={2} value={newClient.notes}
                onChange={e => setNewClient(p => ({ ...p, notes: e.target.value }))}
                style={{ ...inp, resize: 'vertical', marginBottom: 8 }} />
              <div style={{ fontSize: 10, color: '#92400e', opacity: .7, marginBottom: 8 }}>Phone or email required.</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setNewClientOpen(false)} disabled={newClientSaving}
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid #d0d0d0', background: '#fff', color: '#555', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
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
                <select value={appt.techName} onChange={e => pickTechName(e.target.value)} style={inp}>
                  <option value="">Pick tech…</option>
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

          {/* "Client asked for this tech" — view-mode shows the active
              flag inline; the edit-mode checkbox lives under the
              "More options" disclosure further down (uncommon setting,
              kept off the default form to reduce clutter). */}
          {isView && appt.techRequestType === 'specific' && (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#1a1a1a', fontWeight: 600 }}>
              <span style={{ fontSize: 14, color: '#ef4444', fontWeight: 700 }}>★</span>
              Client asked for {appt.techName}
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
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 6 }}>
              Services {totalDur > 0 && <span style={{ color: '#bbb' }}>· {totalDur} min total</span>}
            </label>
            {(appt.services || []).map((svc, i) => (
              <div key={i} style={{ background: '#f8f9fa', borderRadius: 8, border: '1px solid #e8e8e8', padding: 8, marginBottom: 6 }}>
                {isView ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: '#1a1a1a' }}>{svc.name || '—'}</span>
                    <span style={{ fontSize: 12, color: '#888' }}>
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
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="number" min={5} step={5} value={svc.duration} onChange={e => patchService(i, { duration: Number(e.target.value) })}
                        placeholder="min" style={{ ...inp, width: 70 }} />
                      <span style={{ fontSize: 12, color: '#aaa', alignSelf: 'center' }}>min</span>
                      <input type="number" min={0} value={svc.price} onChange={e => patchService(i, { price: e.target.value })}
                        placeholder="price" style={{ ...inp, width: 70 }} />
                      <span style={{ fontSize: 12, color: '#aaa', alignSelf: 'center' }}>$</span>
                    </div>
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
            <div style={{ marginBottom: 10, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fafafa', overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: '#f3f4f6', borderBottom: '1px solid #e5e7eb', fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                Service History {history && `· ${history.length}`}
              </div>
              {historyLoading ? (
                <div style={{ padding: '14px', fontSize: 12, color: '#888', textAlign: 'center' }}>Loading…</div>
              ) : (history?.length ? (
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {history.map((v, i) => {
                    const svcs = (v.services || []).map(s => s.name || s.customName).filter(Boolean).join(', ');
                    const raw = v.raw || {};
                    const pay = raw.payment || {};
                    const total = pay.total ?? raw.total ?? v.revenue ?? null;
                    const isExpanded = expandedVisitId === v.id;
                    const STATUS_STYLE = {
                      scheduled:   { bg: '#dbeafe', fg: '#1e40af', label: 'Scheduled' },
                      'in-progress':{ bg: '#fef3c7', fg: '#92400e', label: 'In progress' },
                      done:        { bg: '#dcfce7', fg: '#166534', label: 'Done' },
                      cancelled:   { bg: '#fee2e2', fg: '#991b1b', label: 'Cancelled' },
                      no_show:     { bg: '#fef3c7', fg: '#92400e', label: 'No-show' },
                      refunded:    { bg: '#ffedd5', fg: '#9a3412', label: 'Refunded' },
                    };
                    const sStyle = STATUS_STYLE[v.status] || { bg: '#e5e7eb', fg: '#374151', label: v.status || '—' };
                    return (
                      <div key={v.id || i} style={{ borderBottom: i < history.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                        <div role="button" tabIndex={0}
                          onClick={() => setExpandedVisitId(prev => prev === v.id ? null : v.id)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedVisitId(prev => prev === v.id ? null : v.id); } }}
                          title={isExpanded ? 'Hide details' : 'Show details'}
                          style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer', background: isExpanded ? '#eff6ff' : 'transparent', userSelect: 'none' }}
                          onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = '#f8f9fa'; }}
                          onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 6 }}>
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
                          <div style={{ fontSize: 12, color: '#555', lineHeight: 1.4, paddingLeft: 14 }}>
                            {svcs || '(no services on file)'}
                            {v.techName ? <span style={{ color: '#888' }}> · {v.techName}</span> : null}
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
                          <div style={{ padding: '10px 14px 12px 26px', background: '#fff', borderTop: '1px solid #f0f0f0', fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
                            {/* Header row — source · duration · star tag */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 11 }}>
                              <span style={{ color: '#888' }}>{sourceLabel}</span>
                              {totalDur > 0 && <span style={{ color: '#888' }}>· {totalDur} min total{endStr ? ` (ends ${endStr})` : ''}</span>}
                              {raw.techRequestType === 'specific' && (
                                <span style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 4, padding: '0 6px', fontWeight: 700 }}>★ Requested {v.techName}</span>
                              )}
                              {raw.recurringGroupId && (
                                <span style={{ background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe', borderRadius: 4, padding: '0 6px', fontWeight: 600 }}>
                                  🔁 Recurring{raw.recurringIndex && raw.recurringTotal ? ` ${raw.recurringIndex}/${raw.recurringTotal}` : ''}
                                </span>
                              )}
                            </div>

                            {(v.services || []).length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <div style={{ fontWeight: 700, color: '#1a1a1a', marginBottom: 4, fontSize: 11 }}>Services</div>
                                {v.services.map((s, j) => (
                                  <div key={j} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0', borderBottom: j < v.services.length - 1 ? '1px dashed #f0f0f0' : 'none' }}>
                                    <span>
                                      {s.name || s.customName || '—'}
                                      {s.isRemoval && <span style={{ marginLeft: 4, fontSize: 9, color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>(removal)</span>}
                                    </span>
                                    <span style={{ color: '#666', fontVariantNumeric: 'tabular-nums' }}>
                                      {s.duration ? `${s.duration}m` : ''}
                                      {s.price ? ` · $${Number(s.price).toFixed(2)}` : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {(pay.subtotal != null || pay.tax != null || pay.tip != null || pay.total != null) && (
                              <div style={{ marginBottom: 8, padding: '6px 10px', background: '#f9fafb', borderRadius: 6, border: '1px solid #f0f0f0' }}>
                                <div style={{ fontWeight: 700, color: '#1a1a1a', marginBottom: 4, fontSize: 11 }}>Payment</div>
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
                              <div style={{ marginBottom: 8, padding: '6px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b' }}>
                                <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 2 }}>Refunded ${Number(raw.refund.amount || 0).toFixed(2)}</div>
                                {raw.refund.reason && <div style={{ fontSize: 11 }}>{raw.refund.reason}</div>}
                                {raw.refund.refundedAt && <div style={{ fontSize: 10, opacity: .8, marginTop: 2 }}>{fmtDateTime(raw.refund.refundedAt)}</div>}
                              </div>
                            )}
                            {raw.notes && (
                              <div style={{ marginBottom: 6 }}>
                                <div style={{ fontWeight: 700, color: '#1a1a1a', marginBottom: 2, fontSize: 11 }}>Notes</div>
                                <div style={{ whiteSpace: 'pre-wrap', color: '#555' }}>{raw.notes}</div>
                              </div>
                            )}
                            {/* Lifecycle stamps — keep at the bottom in a muted row */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 10, color: '#999', marginTop: 6, paddingTop: 6, borderTop: '1px dashed #f0f0f0' }}>
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
                <div style={{ padding: '14px', fontSize: 12, color: '#888', textAlign: 'center' }}>No prior visits on file.</div>
              ))}
            </div>
          )}

          {/* More options — disclosure for infrequent fields. Most
              bookings don't touch the "client asked for this tech" flag
              or recurring schedules, so they're hidden behind a single
              link to keep the default modal short. */}
          {!isView && (
            <div style={{ marginBottom: 10 }}>
              <button onClick={() => setAdvancedOpen(o => !o)} type="button"
                style={{ background: 'none', border: 'none', color: '#3D95CE', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
                {advancedOpen ? '▾ Hide more options' : '▸ More options · client asked for tech, repeat'}
              </button>
              {advancedOpen && (
                <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px dashed #e5e7eb' }}>
                  {/* "Client asked for this tech" checkbox */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${appt.techRequestType === 'specific' ? '#ef4444' : '#e8e8e8'}`, background: appt.techRequestType === 'specific' ? '#fef2f2' : '#fafafa', cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox"
                      checked={appt.techRequestType === 'specific'}
                      onChange={e => onChange({ techRequestType: e.target.checked ? 'specific' : 'scheduler' })}
                      style={{ accentColor: '#ef4444', cursor: 'pointer' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: appt.techRequestType === 'specific' ? '#991b1b' : '#444' }}>
                      <span style={{ color: '#ef4444', fontWeight: 700, marginRight: 4 }}>★</span>
                      Client asked for this tech
                    </span>
                  </label>
                  {/* Recurring repeat — new appointments only */}
                  {!appt.id && (
                    <RepeatSection
                      recurrence={appt.recurrence}
                      date={appt.date}
                      onChange={onChange}
                    />
                  )}
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
        <div style={{ padding: '12px 18px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          {isView ? (
            <>
              {!isNew && !viewOnly && (
                <button onClick={onDelete} style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fef2f2', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  Delete
                </button>
              )}
              {appt.id && (
                <button onClick={copyCheckinLink} title="Copy check-in link for client"
                  style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: `1px solid ${linkCopied ? '#bbf7d0' : '#d0d0d0'}`, background: linkCopied ? '#f0fdf4' : '#fff', color: linkCopied ? '#166534' : '#555', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {linkCopied ? '✓ Copied!' : '🔗 Check-in'}
                </button>
              )}
              {appt.id && isAdmin && !viewOnly && (
                <button onClick={() => setRestoreOpen(true)}
                  title="Restore an earlier version of this appointment from the BigQuery mirror"
                  style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid #d0d0d0', background: '#fff', color: '#666', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  ⏳ History
                </button>
              )}
              {!viewOnly && (
                <button onClick={onSwitchEdit} style={{ flex: 1, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE', whiteSpace: 'nowrap' }}>Edit</button>
              )}
              {!viewOnly && appt.id && appt.status !== 'done' && appt.status !== 'cancelled' && (
                <>
                  <button onClick={() => onAddToTicket(appt)}
                    style={{ flex: 1, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: '#fff', color: '#2D7A5F', border: '1.5px solid #2D7A5F', borderRadius: 8, padding: '8px 10px', whiteSpace: 'nowrap' }}>
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
                  style={{ flex: 1, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: '#fef2f2', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 10px' }}>
                  Refund
                </button>
              )}
              {appt.refund && (
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, marginBottom: appt.refund.reason || appt.refund.photo ? 6 : 0 }}>
                    Refunded ${appt.refund.amount.toFixed(2)}
                  </div>
                  {appt.refund.reason && (
                    <div style={{ fontSize: 11, color: '#888', lineHeight: 1.4 }}>{appt.refund.reason}</div>
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
        <label style={{ fontSize: 11, color: '#888' }}>🔁 Repeat</label>
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
        <div style={{ background: '#f0f7ff', borderRadius: 10, border: '1px solid #c7dff7', padding: '10px 12px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#5a8fba', fontWeight: 600, marginBottom: 4 }}>Frequency</div>
              <select value={weeks} onChange={e => patch({ weeks: Number(e.target.value) })} style={{ ...inp, fontSize: 12, padding: '5px 8px' }}>
                <option value={1}>Every week</option>
                <option value={2}>Every 2 weeks</option>
                <option value={3}>Every 3 weeks</option>
                <option value={4}>Every 4 weeks</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#5a8fba', fontWeight: 600, marginBottom: 4 }}>Occurrences</div>
              <select value={count} onChange={e => patch({ count: Number(e.target.value) })} style={{ ...inp, fontSize: 12, padding: '5px 8px' }}>
                {[2,3,4,5,6,8,10,12,16,24,52].map(n => (
                  <option key={n} value={n}>{n} appointments</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#1a5f8a', fontWeight: 500 }}>
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
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 6 }}>Delete recurring appointment</div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 20, lineHeight: 1.5 }}>
          This is appointment {appt.recurringIndex} of {appt.recurringTotal} in a series. What would you like to delete?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={onDeleteOne}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #e8e8e8', background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#1a1a1a', textAlign: 'left' }}>
            Just this appointment
          </button>
          <button onClick={onDeleteAll}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #fca5a5', background: '#fef2f2', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#ef4444', textAlign: 'left' }}>
            All {appt.recurringTotal} in this series
          </button>
          <button onClick={onCancel}
            style={{ padding: '8px', borderRadius: 10, border: 'none', background: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#aaa' }}>
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
      <div style={{ background: '#fff', borderRadius: 16, padding: 22, width: '94%', maxWidth: 460, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>Recurring series — conflicts found</div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 14, lineHeight: 1.5 }}>
          {conflictCount} of {dates.length} dates have a problem ({okCount} are clear).
        </div>
        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 10, marginBottom: 14, background: '#fafafa' }}>
          {dates.map((d, i) => {
            const human = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderBottom: i < dates.length - 1 ? '1px solid #f0f0f0' : 'none', background: d.ok ? 'transparent' : '#fef2f2' }}>
                <span style={{ fontSize: 14, lineHeight: 1.3, flexShrink: 0, color: d.ok ? '#22c55e' : '#ef4444' }}>{d.ok ? '✓' : '✕'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: d.ok ? '#1a1a1a' : '#991b1b' }}>{human}</div>
                  {!d.ok && (
                    <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 2 }}>{d.reasons.join(' · ')}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={onSkip} disabled={okCount === 0}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #2D7A5F', background: okCount === 0 ? '#f5f5f5' : '#EDFAF3', fontSize: 14, fontWeight: 600, cursor: okCount === 0 ? 'default' : 'pointer', fontFamily: 'inherit', color: okCount === 0 ? '#bbb' : '#166534', textAlign: 'left' }}>
            Skip the {conflictCount} conflicts — book {okCount} clear date{okCount === 1 ? '' : 's'}
          </button>
          <button onClick={onForce}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #f59e0b', background: '#fffbeb', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#92400e', textAlign: 'left' }}>
            Book all {dates.length} anyway (overlap allowed)
          </button>
          <button onClick={onCancel}
            style={{ padding: '8px', borderRadius: 10, border: 'none', background: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#aaa' }}>
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
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 360, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 6 }}>Edit recurring appointment</div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 20, lineHeight: 1.5 }}>
          This is appointment {appt.recurringIndex || '?'} of {appt.recurringTotal || '?'} in a series. Apply your changes to:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => onScope('this')}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #e8e8e8', background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#1a1a1a', textAlign: 'left' }}>
            Just this appointment
          </button>
          <button onClick={() => onScope('following')}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #c7dff7', background: '#f0f7ff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#1a5f8a', textAlign: 'left' }}>
            This and all following
          </button>
          <button onClick={() => onScope('all')}
            style={{ padding: '11px 14px', borderRadius: 10, border: '1px solid #c7dff7', background: '#f0f7ff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#1a5f8a', textAlign: 'left' }}>
            All {appt.recurringTotal || ''} in this series
          </button>
          <button onClick={onCancel}
            style={{ padding: '8px', borderRadius: 10, border: 'none', background: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#aaa' }}>
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
        <div style={{ fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>{label}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {photos.map((src, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={src} alt="" onClick={() => setLightbox({ src, label })}
                style={{ width: 68, height: 68, objectFit: 'cover', borderRadius: 8, border: '1px solid #e8e8e8', cursor: 'pointer', display: 'block' }} />
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
                style={{ width: 68, height: 68, borderRadius: 8, border: '2px dashed #d8d8d8', background: '#fafafa', cursor: 'pointer', fontSize: 22, color: '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}>
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
        <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 6 }}>📸 Photos</label>
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
function ClientSearch({ clients, clientId, clientName, onChange }) {
  const [query,   setQuery]   = useState('');
  const [open,    setOpen]    = useState(false);
  const wrapRef = useRef(null);

  const selected = clients.find(c => c.id === clientId);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Sort alphabetically client-side so the dropdown order is predictable
  // even if the upstream `clients` collection is unsorted.
  const sortedAll = [...clients].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const filtered = query.length >= 1
    ? sortedAll.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || (c.phone || '').includes(query)).slice(0, 50)
    : sortedAll.slice(0, 100);

  function selectClient(c) {
    onChange({ clientId: c.id, clientName: c.name });
    setQuery('');
    setOpen(false);
  }

  function clearClient() {
    onChange({ clientId: '', clientName: '' });
    setQuery('');
  }

  if (selected) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        ...inp, cursor: 'default', paddingTop: 6, paddingBottom: 6,
        ...(selected.banned ? { background: '#fef2f2', borderColor: '#fca5a5' } : {}),
      }}>
        {selected.banned && <span title="Banned client" style={{ fontSize: 14 }}>🚫</span>}
        <span style={{
          flex: 1, fontSize: 13,
          color: selected.banned ? '#b91c1c' : '#1a1a1a',
          fontWeight: selected.banned ? 600 : 400,
        }}>{selected.name}{selected.banned && ' · Banned'}</span>
        {selected.phone && <span style={{ fontSize: 11, color: '#aaa' }}>{displayPhone(selected.phone)}</span>}
        <button onClick={clearClient} style={{ border: 'none', background: 'none', color: '#bbb', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={clientId ? (clientName || '') : query}
        onChange={e => {
          const val = e.target.value;
          setQuery(val);
          setOpen(true);
          if (!clientId) onChange({ clientId: '', clientName: val });
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search clients by name…"
        style={inp}
      />
      {open && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 2px)', background: '#fff', border: '1px solid #d8d8d8', borderRadius: 8, zIndex: 200, maxHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', boxShadow: '0 6px 20px rgba(0,0,0,.12)' }}>
          {/* Walk-in / anonymous shortcut intentionally removed — every
              appointment must have a real client record (with phone) per
              the no-anonymous-customers rule. If the search returns no
              match, use the "+ Create new client contact" button below
              the picker to mint a real record on the spot. */}
          {filtered.length === 0 && (
            <div style={{ padding: '12px', fontSize: 12, color: '#888', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
              No matches{query ? ` for “${query}”` : ''}. Close this menu and tap <strong style={{ color: '#92400e' }}>+ Create new client contact</strong> below.
            </div>
          )}
          {filtered.map(c => (
            <div
              key={c.id}
              onMouseDown={() => selectClient(c)}
              style={{
                padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                borderBottom: '1px solid #f5f5f5',
                background: c.banned ? '#fef2f2' : 'transparent',
              }}
              onMouseEnter={e => e.currentTarget.style.background = c.banned ? '#fee2e2' : '#f5f9ff'}
              onMouseLeave={e => e.currentTarget.style.background = c.banned ? '#fef2f2' : ''}
            >
              {c.banned && <span title="Banned client — do not accept bookings" style={{ fontSize: 13 }}>🚫</span>}
              <span style={{
                flex: 1,
                color: c.banned ? '#b91c1c' : '#1a1a1a',
                fontWeight: c.banned ? 600 : 400,
              }}>
                {c.name}
                {c.banned && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>· Banned</span>}
              </span>
              {c.phone && <span style={{ fontSize: 11, color: c.banned ? '#dc2626' : '#bbb' }}>{displayPhone(c.phone)}</span>}
            </div>
          ))}
          {filtered.length === 0 && query && (
            <div style={{ padding: '8px 12px', fontSize: 12, color: '#bbb' }}>No clients found — will be recorded as walk-in with name "{query}"</div>
          )}
        </div>
      )}
    </div>
  );
}

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
  return <span style={{ fontSize: 10, background: '#f0f0f0', color: '#888', borderRadius: 20, padding: '2px 8px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>view</span>;
}

function NavBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #d8d8d8', background: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontFamily: 'inherit' }}>
      {children}
    </button>
  );
}

function NoTechsEmptyState() {
  return (
    <div style={{
      textAlign: 'center', padding: '60px 24px',
      background: '#fff', border: '1px dashed #d8d8d8', borderRadius: 12,
      marginTop: 20,
    }}>
      <div style={{ fontSize: 56, marginBottom: 12, opacity: 0.7 }}>👥</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: '#1a1a1a', marginBottom: 6 }}>
        No employees yet
      </div>
      <div style={{ fontSize: 13, color: '#666', maxWidth: 380, margin: '0 auto 18px', lineHeight: 1.55 }}>
        Add your first employee to start booking appointments. Each employee shows up as a column in the day grid.
      </div>
      <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>
        Open <strong>Employees</strong> from the sidebar to add one.
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 10, ...style }}>
      <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>{label}</label>
      {children}
    </div>
  );
}

function ViewVal({ children, style }) {
  return <div style={{ fontSize: 13, color: '#1a1a1a', padding: '5px 0', minHeight: 24, lineHeight: 1.5, ...style }}>{children}</div>;
}

// Compact label/value row used inside the expanded service-history detail
// view. `bold` highlights totals; `muted` greys out secondary fields.
function Row({ label, value, bold, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, padding: '1px 0', color: muted ? '#888' : '#374151' }}>
      <span>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

const inp     = { fontFamily: 'inherit', width: '100%', border: '1px solid #d8d8d8', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: '#333', outline: 'none', background: '#fafafa', boxSizing: 'border-box' };
const btnBase = { fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: '#fff', border: '1px solid #d0d0d0', borderRadius: 8, padding: '8px 14px', color: '#333' };

// ── Time Off modal (vacation / sick / personal) ────────
function TimeOffModal({ timeOff, techs, employees, services, clients = [], isAdmin, isScheduler, isTech, myTechName, gUser, onClose }) {
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

  const [showAdd, setShowAdd] = useState(false);
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
      <div style={{ background: '#fff', borderRadius: 16, width: '94%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>🌴 Time Off</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
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
              onCancel={() => setShowAdd(false)}
              onSaved={() => setShowAdd(false)}
            />
          ) : (
            <>
              {canAdd && (
                <button onClick={() => setShowAdd(true)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px dashed #2D7A5F', background: '#EDFAF3', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#166534', marginBottom: 14 }}>
                  + Add time off
                </button>
              )}

              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Upcoming</div>
              {upcoming.length === 0 ? (
                <div style={{ fontSize: 12, color: '#bbb', padding: '12px 4px' }}>None scheduled.</div>
              ) : upcoming.map(t => (
                <TimeOffRow key={t.id} t={t} typeLabel={typeLabel} fmtRange={fmtRange}
                  canEdit={canManageOthers || t.techName === myTechName}
                  onDelete={() => handleDelete(t)} />
              ))}

              {past.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 16, marginBottom: 6 }}>Recent past</div>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid #f0f0f0', background: muted ? '#fafafa' : '#fff', marginBottom: 6, opacity: muted ? .7 : 1 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{t.techName || '—'}</span>
          <span style={{ fontSize: 11, color: '#888', fontWeight: 500 }}>· {typeLabel(t.type)}</span>
        </div>
        <div style={{ fontSize: 12, color: '#666' }}>
          {fmtRange(t)}
          {t.allDay === false && t.startTime && t.endTime ? ` · ${t.startTime}–${t.endTime}` : ''}
        </div>
        {t.notes && (
          <div style={{ fontSize: 11, color: '#888', marginTop: 2, fontStyle: 'italic' }}>{t.notes}</div>
        )}
      </div>
      {canEdit && (
        <button onClick={onDelete} title="Delete"
          style={{ fontSize: 12, padding: '5px 9px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
          Delete
        </button>
      )}
    </div>
  );
}

function TimeOffForm({ techs, employees, services, clients = [], timeOff, isAdmin, isScheduler, isTech, myTechName, gUser, onCancel, onSaved }) {
  const canManageOthers = isAdmin || isScheduler;
  const defaultTech = canManageOthers ? '' : (myTechName || '');
  const [techName, setTechName] = useState(defaultTech);
  const [type, setType] = useState('vacation');
  const today = todayStr();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
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
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>New time off</div>
        <button onClick={onCancel} style={{ ...btnBase, padding: '5px 10px', fontSize: 12 }}>← Back</button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Tech</div>
        {canManageOthers ? (
          <select value={techName} onChange={e => setTechName(e.target.value)} style={inp}>
            <option value="">Pick a tech…</option>
            {techs.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <div style={{ ...inp, background: '#f5f5f5' }}>{myTechName || '—'}</div>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Type</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'vacation', label: '🌴 Vacation' },
            { id: 'sick',     label: '🩹 Sick' },
            { id: 'personal', label: '🏠 Personal' },
          ].map(opt => (
            <button key={opt.id} onClick={() => setType(opt.id)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: type === opt.id ? '1.5px solid #2D7A5F' : '1px solid #d8d8d8', background: type === opt.id ? '#EDFAF3' : '#fff', fontSize: 13, fontWeight: type === opt.id ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit', color: type === opt.id ? '#166534' : '#555' }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>From</div>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inp} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>To</div>
          <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} style={inp} />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid #e8e8e8', background: '#fafafa', cursor: 'pointer', marginBottom: 10 }}>
        <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
        <span style={{ fontSize: 13, color: '#444' }}>All day</span>
      </label>

      {!allDay && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Start time</div>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={inp} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>End time</div>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={inp} />
          </div>
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Note (optional)</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="e.g. Family trip — back the 18th" />
      </div>

      {err && (
        <div style={{ fontSize: 12, color: '#b91c1c', background: '#fee2e2', border: '1px solid #fca5a5', padding: '6px 10px', borderRadius: 8, marginBottom: 10 }}>{err}</div>
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
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>
          ⚠️ {affected.length} appointment{affected.length === 1 ? '' : 's'} affected
        </div>
        <button onClick={onCancel} disabled={saving} style={{ ...btnBase, padding: '5px 10px', fontSize: 12 }}>← Back</button>
      </div>

      <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
          <strong>It's up to you (or {draftEntry.techName}) to contact these clients</strong> to reschedule, or to find another tech to cover. The system <em>will not</em> auto-cancel or auto-notify the client. For appointments where the client did not specifically request {draftEntry.techName}, you can pick a coverage tech below — that change will be applied when you save.
          {specificCount > 0 && (
            <> {specificCount} appointment{specificCount === 1 ? '' : 's'} ⭐ specifically requested {draftEntry.techName}; we recommend reaching out to the client first before reassigning. You can override and auto-find another tech if needed.</>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em' }}>Conflicts</div>
        <button onClick={autoPickAll} disabled={saving}
          style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6, border: '1px solid #c7dff7', background: '#f0f7ff', color: '#1a5f8a', cursor: 'pointer', fontFamily: 'inherit' }}>
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
            <div key={a.id} style={{ border: `1px solid ${isSpecific ? '#fca5a5' : '#e8e8e8'}`, borderRadius: 10, padding: 10, background: isSpecific ? '#fef2f2' : '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {isSpecific && <span title="Client asked for this tech" style={{ color: '#ef4444', fontWeight: 700, fontSize: 14 }}>⭐</span>}
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', flex: 1 }}>
                  {a.clientName || 'Walk-in'}
                </div>
                <div style={{ fontSize: 11, color: '#666' }}>{fmt(a)}</div>
              </div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>{services}</div>

              {isSpecific && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#991b1b', marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!pick.overrideSpecific}
                    onChange={e => patch(a.id, { overrideSpecific: e.target.checked, newTech: e.target.checked ? pick.newTech : '' })} />
                  Override — let me reassign anyway (I'll contact the client)
                </label>
              )}

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#666', flexShrink: 0 }}>Cover with:</span>
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
                <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 6 }}>
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
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>📨 Notify clients</div>
        <button onClick={onClose} style={{ ...btnBase, padding: '5px 10px', fontSize: 12 }}>Done</button>
      </div>

      <div style={{ background: 'linear-gradient(135deg,#f3eafc,#eaf3fc)', border: '1px solid #d8d0e8', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#5b3b8c', lineHeight: 1.5 }}>
          <strong>AI-drafted outreach for {affected.length} affected client{affected.length === 1 ? '' : 's'}.</strong> Edit any message, then send via SMS or email. Reassigned appts get a "swap confirmation" message; un-reassigned appts get a "please reschedule" message.
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#888', fontSize: 13 }}>
          ✨ Drafting personalized messages…
        </div>
      )}

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#b91c1c', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {!loading && !error && drafts.length === 0 && (
        <div style={{ textAlign: 'center', padding: 16, fontSize: 12, color: '#888' }}>No drafts generated.</div>
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
          <div key={d.apptId} style={{ border: '1px solid #e8e8e8', borderRadius: 10, padding: 10, marginBottom: 10, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', flex: 1 }}>{appt.clientName || 'Client'}</div>
              <div style={{ fontSize: 11, color: '#666' }}>{dStr} · {tStr}</div>
            </div>

            <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
              {isReassigned
                ? <>↪ Reassigned: {appt.techName} → <strong>{r.newTech}</strong></>
                : <>⚠ No coverage — needs reschedule</>
              }
            </div>

            {/* SMS block */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>📱 SMS</div>
                <div style={{ fontSize: 10, color: appt.clientPhone ? '#22c55e' : '#999' }}>
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
                <div style={{ fontSize: 10, color: d.smsDraft.length > 160 ? '#92400e' : '#999' }}>
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
                <div style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>✉️ Email</div>
                <div style={{ fontSize: 10, color: appt.clientEmail ? '#22c55e' : '#999' }}>
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
  const [apptOpen,  setApptOpen]  = useState(settings.apptHours?.open  || '09:00');
  const [apptClose, setApptClose] = useState(settings.apptHours?.close || '20:00');
  const [saving,    setSaving]    = useState(false);

  function patch(day, delta) {
    setHours(h => ({ ...h, [day]: { ...h[day], ...delta } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateSettings({ ...settings, storeHours: hours, apptHours: { open: apptOpen, close: apptClose } });
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '94%', maxWidth: 440, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>🕐 Store Hours</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {/* Per-day hours */}
          {WEEK_DAYS.map((day, i) => {
            const h = hours[day];
            return (
              <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: i > 0 ? '1px solid #f5f5f5' : 'none' }}>
                <div style={{ width: 32, fontSize: 13, fontWeight: 500, color: h.closed ? '#bbb' : '#333' }}>{day}</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#888', cursor: 'pointer', userSelect: 'none', minWidth: 62 }}>
                  <input type="checkbox" checked={!!h.closed} onChange={e => patch(day, { closed: e.target.checked })} />
                  Closed
                </label>
                {!h.closed && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                    <input type="time" value={h.open}  onChange={e => patch(day, { open:  e.target.value })}
                      style={{ fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '5px 7px', fontSize: 12 }} />
                    <span style={{ color: '#bbb' }}>–</span>
                    <input type="time" value={h.close} onChange={e => patch(day, { close: e.target.value })}
                      style={{ fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '5px 7px', fontSize: 12 }} />
                  </div>
                )}
              </div>
            );
          })}

          {/* Extended appt hours */}
          <div style={{ marginTop: 16, padding: '12px', background: '#f0f7ff', borderRadius: 10, border: '1px solid #c7dff7' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1a5f8a', marginBottom: 8 }}>Extended appointment hours</div>
            <div style={{ fontSize: 11, color: '#5a8fba', marginBottom: 10 }}>Appointment-only slots outside published store hours. Set same as store open/close to disable.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="time" value={apptOpen}  onChange={e => setApptOpen(e.target.value)}
                style={{ fontFamily: 'inherit', border: '1px solid #c7dff7', borderRadius: 8, padding: '6px 8px', fontSize: 12, flex: 1 }} />
              <span style={{ color: '#bbb' }}>–</span>
              <input type="time" value={apptClose} onChange={e => setApptClose(e.target.value)}
                style={{ fontFamily: 'inherit', border: '1px solid #c7dff7', borderRadius: 8, padding: '6px 8px', fontSize: 12, flex: 1 }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
          <button onClick={onClose} style={{ flex: 1, ...btnBase }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 2, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE', opacity: saving ? .6 : 1 }}>
            {saving ? 'Saving…' : 'Save Hours'}
          </button>
        </div>
      </div>
    </div>
  );
}
