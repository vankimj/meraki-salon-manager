import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchAppointments, fetchAppointmentsByRange, fetchAppointmentById, subscribeToAppointments, subscribeToAppointmentsByRange, createAppointment, saveAppointment, deleteAppointment, deleteRecurringGroup, fetchClients, fetchServices, fetchEmployees, fetchUserPrefs, saveUserPrefs, subscribeQueue, updateWaitlistEntry, removeWaitlistEntry, subscribeTurnRoster, saveTurnRoster } from '../../lib/firestore';
import CheckoutModal from '../checkout/CheckoutModal';
import RefundModal from '../checkout/RefundModal';
import { useApp } from '../../context/AppContext';
import { logActivity } from '../../lib/logger';
import { applyTurnCredit, recomputeTodayTurns } from '../../lib/turnCredit';
import { notifyAffectedTechs } from '../../lib/notifications';
import { resizeImg } from '../../utils/helpers';

const FALLBACK_TECHS = ['Yasmin D', 'Audriana L', 'Samantha T', 'Tess D', 'Elizabeth L', 'Yan W', 'Jen T', 'Marisela I', 'Ana P', 'Jenesis B'];

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
export default function ScheduleAdmin() {
  const { settings, updateSettings, isTech, isAdmin, myTechName, gUser, showToast, addApptToTicket } = useApp();

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
  const [visibleTechNames, setVisibleTechNames] = useState(null);
  const [empWorkDays,      setEmpWorkDays]      = useState({});
  const [employees,        setEmployeesData]    = useState([]);
  const [viewMode,         setViewMode]         = useState('day');
  const [weekAppts,        setWeekAppts]        = useState([]);
  const [weekLoading,      setWeekLoading]      = useState(false);
  const [showQueue,        setShowQueue]        = useState(false);
  const [queueEntries,     setQueueEntries]     = useState([]);
  const [turnRoster,       setTurnRoster]       = useState({ date: '', roster: [] });
  const [deleteDialog,     setDeleteDialog]     = useState(null); // appt with recurringGroupId

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

  // Real-time queue listener — always on so badge stays current
  useEffect(() => {
    const unsub = subscribeQueue(todayStr(), setQueueEntries);
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
      const dur = appt.services.reduce((sum, s) => sum + (Number(s.duration) || 0), 0) || 60;

      // Out-of-hours guard — prompt before saving when the time falls outside
      // the day's store hours (or the day is closed). Skipped when editing
      // and neither date nor start time has changed (so re-saving an old
      // appointment doesn't keep re-prompting).
      const timeChanged = !original?.id || appt.date !== original.date || appt.startTime !== original.startTime;
      if (timeChanged && appt.date && appt.startTime) {
        const apptDow = dayOfWeek(appt.date);
        const day = settings.storeHours?.[apptDow] || {};
        const startMins = strToMins(appt.startTime);
        const endMins   = startMins + dur;
        const fmtMins = (m) => {
          const h = Math.floor(m / 60), mm = m % 60;
          const ampm = h >= 12 ? 'PM' : 'AM';
          const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
          return `${hh}:${String(mm).padStart(2, '0')} ${ampm}`;
        };
        let warning = null;
        if (day.closed) {
          warning = `The salon is marked closed on ${apptDow.charAt(0).toUpperCase() + apptDow.slice(1)}.`;
        } else {
          const openMins  = strToMins(day.open  || settings.apptHours?.open  || '09:00');
          const closeMins = strToMins(day.close || settings.apptHours?.close || '20:00');
          if (startMins < openMins) {
            warning = `Appointment starts at ${fmtMins(startMins)}, before the salon opens (${fmtMins(openMins)}).`;
          } else if (endMins > closeMins) {
            warning = `Appointment ends at ${fmtMins(endMins)} (${dur}-minute duration), after the salon closes (${fmtMins(closeMins)}).`;
          }
        }
        if (warning) {
          const proceed = window.confirm(`${warning}\n\nBook this appointment anyway?`);
          if (!proceed) return;
        }
      }

      const { recurrence, ...apptBase } = appt;
      const full = { ...apptBase, duration: dur };
      const svcSummary = (full.services || []).map(s => s.name || s.customName).filter(Boolean).join(', ') || 'no services';
      const totalPrice = (full.services || []).reduce((s, sv) => s + Number(sv.price || 0), 0);
      const logDetail  = `${appt.clientName || 'walk-in'} with ${appt.techName} on ${appt.date} at ${appt.startTime} — ${svcSummary}${totalPrice > 0 ? ` ($${totalPrice.toFixed(2)})` : ''}`;

      if (appt.id) {
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
        const groupId = crypto.randomUUID();
        for (let i = 0; i < recurrence.count; i++) {
          await createAppointment({
            ...full,
            date: addDays(full.date, i * recurrence.weeks * 7),
            recurringGroupId: groupId,
            recurringIndex: i + 1,
            recurringTotal: recurrence.count,
          });
        }
        logActivity('appt_series_created', `${recurrence.count}× ${logDetail}`);
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

function openNew(techName, slotMins) {
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
    : visibleTechNames ? techs.filter(t => visibleTechNames.includes(t)) : techs;

  const personalView   = isTech && !showAll;
  const techColWidth   = displayTechs.length === 1 ? 360 : displayTechs.length <= 3 ? 180 : 120;

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

        {isAdmin && (
          <button onClick={() => setShowHours(true)} title="Edit store hours"
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fff', color: '#555', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
            🕐 Hours
          </button>
        )}
      </div>
      {showHours && <HoursModal settings={settings} updateSettings={updateSettings} onClose={() => setShowHours(false)} />}

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

      {/* Tech overlay filter pills — day view only */}
      {viewMode === 'day' && (!isTech || showAll) && visibleTechNames && (
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
      )}

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
      {viewMode === 'week'
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
              techs={displayTechs}
              allTechs={techs}
              techExtended={techExtended}
              empWorkDays={empWorkDays}
              slots={slots}
              dayStart={dayStart}
              walkInOpen={walkInOpen}
              walkInClose={walkInClose}
              techColWidth={techColWidth}
              onSlotClick={openNew}
              onApptClick={openView}
              onApptReschedule={(apptId, newTech, newMins) => {
                const original = appts.find(a => a.id === apptId);
                if (!original) return;
                const newStartTime = minsToStr(newMins);
                if (newStartTime === original.startTime && newTech === original.techName) return;
                handleSave({ ...original, techName: newTech, startTime: newStartTime }, original);
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
          onChange={patch => setModal(m => ({ ...m, appt: { ...m.appt, ...patch } }))}
          onSwitchEdit={() => setModal(m => ({ ...m, mode: 'edit' }))}
          onSave={() => handleSave(modal.appt, modal.original)}
          onDelete={() => handleDelete(modal.appt)}
          onClose={() => setModal(null)}
          onCheckout={appt => { setModal(null); setCheckout({ appts: [appt], walkInClient: null }); }}
          onAddToTicket={appt => { setModal(null); addApptToTicket(appt); showToast(`Added ${appt.clientName || 'walk-in'} to ticket`); }}
          onRefund={appt => setRefund(appt)}
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
                      return (
                        <div key={appt.id} onClick={e => { e.stopPropagation(); onApptClick(appt); }}
                          style={{ padding: '3px 5px', borderRadius: 5, background: blockBg, borderLeft: `3px solid ${blockBorder}`, cursor: 'pointer', opacity: isCancelled ? 0.6 : 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: blockText, lineHeight: 1.2, flex: 1 }}>
                              {minsToStr(strToMins(appt.startTime))}
                            </div>
                            {appt.techRequestType === 'specific' ? (
                              <span title="Client specifically requested this tech" style={{ fontSize: 13, color: '#ef4444', lineHeight: 1, fontWeight: 700 }}>★</span>
                            ) : appt.techRequestType === 'auto' ? (
                              <span title="No preference — auto-assigned" style={{ fontSize: 10, lineHeight: 1 }}>🎲</span>
                            ) : (
                              <span title="Scheduler assigned this tech" style={{ fontSize: 10, lineHeight: 1 }}>📋</span>
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
function DayGrid({ date, appts, techs, allTechs, techExtended, empWorkDays, slots, dayStart, walkInOpen, walkInClose, techColWidth, onSlotClick, onApptClick, onApptReschedule }) {
  // Drag-to-reschedule state. id of the appointment currently being dragged
  // and the slot+tech being hovered for drop preview. Reset on dragend/drop.
  const [dragging, setDragging] = useState(null);     // appt.id or null
  const [hoverKey, setHoverKey] = useState(null);     // `${tech}:${slotMins}` or null
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
          return (
            <div key={tech} style={{ width: TECH_COL, flexShrink: 0, fontSize: 11, fontWeight: 600, color: isOff ? '#bbb' : col.text, textAlign: 'center', borderLeft: '1px solid #e8e8e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: isOff ? '#fafafa' : col.bg, paddingBottom: 6 }}>
              <div style={{ height: 3, background: isOff ? '#e0e0e0' : col.solid, marginBottom: 6 }} />
              <div style={{ padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tech}</div>
              {isOff && (
                <div style={{ fontSize: 8, color: '#d0d0d0', fontWeight: 500, letterSpacing: '.03em' }}>off today</div>
              )}
              {!isOff && hasApptOnlyZone && techExtended[tech] && (
                <div style={{ fontSize: 8, color: col.solid, fontWeight: 600, letterSpacing: '.03em', opacity: .8 }}>extended hrs</div>
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
              const allowed = !isOff && (inWalkIn || techExtended[tech]);
              const slotKey = `${tech}:${slotMins}`;
              const isDropHover = dragging && hoverKey === slotKey && allowed;
              return (
                <div
                  key={tech}
                  onClick={() => allowed && onSlotClick(tech, slotMins)}
                  onDragOver={e => {
                    if (!dragging || !allowed) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (hoverKey !== slotKey) setHoverKey(slotKey);
                  }}
                  onDragLeave={() => { if (hoverKey === slotKey) setHoverKey(null); }}
                  onDrop={e => {
                    if (!dragging || !allowed) return;
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/appt');
                    if (id) onApptReschedule && onApptReschedule(id, tech, slotMins);
                    setDragging(null); setHoverKey(null);
                  }}
                  style={{
                    width: TECH_COL, flexShrink: 0, borderLeft: '1px solid #ececec',
                    cursor: allowed ? 'pointer' : 'default',
                    position: 'relative',
                    background: isDropHover
                      ? 'rgba(45,122,95,.18)'
                      : isOff
                      ? 'repeating-linear-gradient(45deg,#fafafa,#fafafa 4px,#f0f0f0 4px,#f0f0f0 8px)'
                      : !inWalkIn
                      ? (allowed ? 'rgba(59,130,246,.06)' : 'rgba(0,0,0,.025)')
                      : 'transparent',
                    outline: isDropHover ? '2px dashed #2D7A5F' : 'none',
                    outlineOffset: -2,
                  }}
                  title={isOff ? `${tech} · off today` : (allowed ? `${tech} · ${minsToStr(slotMins)}` : `${tech} · appointment-only hours`)}
                >
                  {allowed && !dragging && (
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

        {/* Appointment overlays */}
        {appts.map(appt => {
          const techIdx = techs.indexOf(appt.techName);
          if (techIdx === -1) return null;
          const startMins = strToMins(appt.startTime);
          const topOffset = ((startMins - dayStart) / 30) * SLOT_H;
          const height    = Math.max((appt.duration / 30) * SLOT_H - 2, SLOT_H - 2);
          const left      = TIME_COL + techIdx * TECH_COL + 2;
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
          const isBeingDragged = dragging === appt.id;
          return (
            <div
              key={appt.id}
              onClick={e => { e.stopPropagation(); onApptClick(appt); }}
              draggable={isDraggable}
              onDragStart={e => {
                e.dataTransfer.setData('text/appt', appt.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragging(appt.id);
              }}
              onDragEnd={() => { setDragging(null); setHoverKey(null); }}
              style={{
                position: 'absolute',
                top: topOffset + 1,
                left,
                width: TECH_COL - 4,
                height,
                background: blockBg,
                border: `1px solid ${isCancelled ? '#fca5a5' : isDone ? '#d1d5db' : col.solid}`,
                borderLeft: `3px solid ${blockBorder}`,
                borderRadius: 6,
                padding: '3px 5px',
                cursor: isDraggable ? 'grab' : 'pointer',
                overflow: 'hidden',
                zIndex: isBeingDragged ? 7 : 5,
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                opacity: isCancelled ? 0.55 : isBeingDragged ? 0.4 : 1,
                pointerEvents: isBeingDragged ? 'none' : 'auto',
                transition: 'opacity .12s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {appt.techRequestType === 'specific' ? (
                  <span title="Client specifically requested this tech" style={{ fontSize: 14, color: '#ef4444', flexShrink: 0, lineHeight: 1, fontWeight: 700 }}>★</span>
                ) : appt.techRequestType === 'auto' ? (
                  <span title="No preference — auto-assigned" style={{ fontSize: 11, flexShrink: 0, lineHeight: 1 }}>🎲</span>
                ) : (
                  <span title="Scheduler assigned this tech" style={{ fontSize: 11, flexShrink: 0, lineHeight: 1 }}>📋</span>
                )}
                <div style={{ fontSize: 13, fontWeight: 700, color: blockText, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {appt.clientName || 'Walk-in'}
                </div>
                <span title={appt.status} style={{ fontSize: 10, color: dot.color, flexShrink: 0, lineHeight: 1 }}>{dot.label}</span>
                {appt.source === 'online_booking' && (
                  <span title="Online booking" style={{ fontSize: 10, background: blockBorder, color: '#fff', borderRadius: 4, padding: '1px 5px', fontWeight: 700, flexShrink: 0, lineHeight: 1.5 }}>WEB</span>
                )}
                {appt.checkedInAt && (
                  <span title="Client checked in" style={{ fontSize: 10, background: blockBorder, color: '#fff', borderRadius: 4, padding: '1px 5px', fontWeight: 700, flexShrink: 0, lineHeight: 1.5 }}>IN</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: blockText, opacity: .85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {appt.services?.map(s => s.name).filter(Boolean).join(', ') || '—'}
              </div>
              {height > SLOT_H && (
                <div style={{ fontSize: 11, color: blockText, opacity: .65 }}>
                  {minsToStr(startMins)} · {appt.duration} min
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Appointment modal ─────────────────────────────────
function ApptModal({ appt, mode, clients, services, techs, onChange, onSwitchEdit, onSave, onDelete, onClose, onCheckout, onAddToTicket, onRefund, viewOnly }) {
  const [saving,    setSaving]    = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const isView = mode === 'view';

  function copyCheckinLink() {
    const url = `${window.location.origin}?checkin=${appt.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }
  const isNew  = !appt.id;

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

  function pickService(i, name) {
    const svc = services.find(s => s.name === name);
    patchService(i, { name, duration: svc?.duration || 60, price: svc?.basePrice || '' });
  }

  async function submit() {
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
              <ViewVal>{appt.clientName || 'Walk-in'}</ViewVal>
            ) : (
              <ClientSearch
                clients={clients}
                clientId={appt.clientId}
                clientName={appt.clientName}
                onChange={patch => onChange(patch)}
              />
            )}
          </Field>

          {/* Tech + Date + Time row */}
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="Tech" style={{ flex: 2 }}>
              {isView ? (
                <ViewVal>{appt.techName || '—'}</ViewVal>
              ) : (
                <select value={appt.techName} onChange={e => onChange({ techName: e.target.value })} style={inp}>
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

          {/* Specifically requested toggle (manual override of techRequestType) */}
          {isView ? (
            (appt.techRequestType === 'specific') && (
              <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#1a1a1a', fontWeight: 600 }}>
                <span style={{ fontSize: 14, color: '#ef4444', fontWeight: 700 }}>★</span>
                Client specifically requested {appt.techName}
              </div>
            )
          ) : (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${appt.techRequestType === 'specific' ? '#ef4444' : '#e8e8e8'}`, background: appt.techRequestType === 'specific' ? '#fef2f2' : '#fafafa', cursor: 'pointer', marginBottom: 10 }}>
              <input type="checkbox"
                checked={appt.techRequestType === 'specific'}
                onChange={e => onChange({ techRequestType: e.target.checked ? 'specific' : 'scheduler' })}
                style={{ accentColor: '#ef4444', cursor: 'pointer' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: appt.techRequestType === 'specific' ? '#991b1b' : '#444' }}>
                <span style={{ color: '#ef4444', fontWeight: 700, marginRight: 4 }}>★</span>
                Client specifically requested this tech
              </span>
            </label>
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

          {/* Notes */}
          <Field label="Notes">
            {isView ? (
              <ViewVal style={{ whiteSpace: 'pre-wrap' }}>{appt.notes || '—'}</ViewVal>
            ) : (
              <textarea value={appt.notes || ''} onChange={e => onChange({ notes: e.target.value })} rows={2}
                placeholder="Special requests, reminders…" style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
            )}
          </Field>

          {/* Repeat — new appointments only */}
          {!appt.id && !isView && (
            <RepeatSection
              recurrence={appt.recurrence}
              date={appt.date}
              onChange={onChange}
            />
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
              {!viewOnly && (
                <button onClick={onSwitchEdit} style={{ flex: 1, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE', whiteSpace: 'nowrap' }}>Edit</button>
              )}
              {appt.id && appt.status !== 'done' && appt.status !== 'cancelled' && (
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
              {appt.id && appt.status === 'done' && !appt.refund && (
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
              <button onClick={submit} disabled={saving}
                style={{ flex: 2, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE', opacity: saving ? .6 : 1 }}>
                {saving ? 'Saving…' : isNew ? 'Book Appointment' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </div>
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

  const filtered = query.length >= 1
    ? clients.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || (c.phone || '').includes(query)).slice(0, 15)
    : clients.slice(0, 10);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...inp, cursor: 'default', paddingTop: 6, paddingBottom: 6 }}>
        <span style={{ flex: 1, fontSize: 13, color: '#1a1a1a' }}>{selected.name}</span>
        {selected.phone && <span style={{ fontSize: 11, color: '#aaa' }}>{selected.phone}</span>}
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
        placeholder="Search clients by name, or type walk-in name…"
        style={inp}
      />
      {open && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 2px)', background: '#fff', border: '1px solid #d8d8d8', borderRadius: 8, zIndex: 200, maxHeight: 220, overflowY: 'auto', boxShadow: '0 6px 20px rgba(0,0,0,.12)' }}>
          <div
            onMouseDown={() => { onChange({ clientId: '', clientName: query || '' }); setOpen(false); }}
            style={{ padding: '8px 12px', fontSize: 12, color: '#888', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontSize: 14 }}>👤</span>
            Walk-in{query ? ` — record name "${query}"` : ' (anonymous)'}
          </div>
          {filtered.map(c => (
            <div
              key={c.id}
              onMouseDown={() => selectClient(c)}
              style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f5f5f5' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f5f9ff'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <span style={{ flex: 1, color: '#1a1a1a' }}>{c.name}</span>
              {c.phone && <span style={{ fontSize: 11, color: '#bbb' }}>{c.phone}</span>}
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

const inp     = { fontFamily: 'inherit', width: '100%', border: '1px solid #d8d8d8', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: '#333', outline: 'none', background: '#fafafa', boxSizing: 'border-box' };
const btnBase = { fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: '#fff', border: '1px solid #d0d0d0', borderRadius: 8, padding: '8px 14px', color: '#333' };

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
