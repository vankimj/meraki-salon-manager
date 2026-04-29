import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchAppointments, fetchAppointmentsByRange, createAppointment, saveAppointment, deleteAppointment, fetchClients, fetchServices, fetchEmployees, fetchUserPrefs, saveUserPrefs, subscribeQueue, updateWaitlistEntry, removeWaitlistEntry } from '../../lib/firestore';
import CheckoutModal from '../checkout/CheckoutModal';
import RefundModal from '../checkout/RefundModal';
import { useApp } from '../../context/AppContext';
import { logActivity } from '../../lib/logger';
import { notifyAffectedTechs } from '../../lib/notifications';

const FALLBACK_TECHS = ['Yasmin D', 'Audriana L', 'Samantha T', 'Tess D', 'Elizabeth L', 'Yan W', 'Jen T', 'Marisela I', 'Ana P', 'Jenesis B'];

const SLOT_H = 40; // px per 30-min slot

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
  const { settings, updateSettings, isTech, isAdmin, myTechName, gUser } = useApp();

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

  const load = useCallback(async () => {
    setLoading(true);
    try { setAppts(await fetchAppointments(date)); }
    catch (e) { console.error('[Schedule] load failed:', e); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const weekStart = weekStartOf(date);
  const loadWeek = useCallback(async () => {
    setWeekLoading(true);
    try { setWeekAppts(await fetchAppointmentsByRange(weekStart, addDays(weekStart, 6))); }
    catch { setWeekAppts([]); }
    finally { setWeekLoading(false); }
  }, [weekStart]);

  useEffect(() => { if (viewMode === 'week') loadWeek(); }, [viewMode, loadWeek]);

  // Real-time queue listener — always on so badge stays current
  useEffect(() => {
    const unsub = subscribeQueue(todayStr(), setQueueEntries);
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
      const dur  = appt.services.reduce((sum, s) => sum + (Number(s.duration) || 0), 0) || 60;
      const full = { ...appt, duration: dur };
      const svcSummary = (full.services || []).map(s => s.name || s.customName).filter(Boolean).join(', ') || 'no services';
      const totalPrice = (full.services || []).reduce((s, sv) => s + Number(sv.price || 0), 0);
      const logDetail  = `${appt.clientName || 'walk-in'} with ${appt.techName} on ${appt.date} at ${appt.startTime} — ${svcSummary}${totalPrice > 0 ? ` ($${totalPrice.toFixed(2)})` : ''}`;
      if (appt.id) {
        const { id, createdAt, ...data } = full;
        await saveAppointment(id, data);
        logActivity('appt_updated', logDetail);
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
    if (!confirm(`Delete this appointment for ${appt.clientName || 'walk-in'}?`)) return;
    await deleteAppointment(appt.id);
    const svcNames = (appt.services || []).map(s => s.name || s.customName).filter(Boolean).join(', ') || 'no services';
    logActivity('appt_deleted', `${appt.clientName || 'walk-in'} with ${appt.techName} on ${appt.date} — ${svcNames}`);
    setAppts(a => a.filter(x => x.id !== appt.id));
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

      {/* Queue panel */}
      {showQueue && (
        <QueuePanel
          entries={queueEntries}
          onSeat={entry => {
            setShowQueue(false);
            setDate(todayStr());
            setViewMode('day');
            setModal({ appt: blankAppt(todayStr(), entry.techName === 'Any' ? '' : entry.techName, null, entry.clientName, entry.serviceName), original: null, mode: 'edit' });
            updateWaitlistEntry(entry.id, { status: 'seated' }).catch(() => {});
          }}
          onRemove={async entry => { await removeWaitlistEntry(entry.id).catch(() => {}); }}
          onDone={async entry => { await updateWaitlistEntry(entry.id, { status: 'done' }).catch(() => {}); }}
        />
      )}

      {/* Tech overlay filter pills — day view only */}
      {viewMode === 'day' && (!isTech || showAll) && visibleTechNames && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap', flexShrink: 0 }}>
          {techs.map(t => {
            const on = visibleTechNames.includes(t);
            return (
              <button key={t} onClick={() => toggleTechVisible(t)} style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 20,
                border: `1px solid ${on ? '#3D95CE' : '#d8d8d8'}`,
                background: on ? '#EBF4FB' : '#f5f5f5',
                color: on ? '#1a5f8a' : '#bbb',
                cursor: 'pointer', fontFamily: 'inherit', fontWeight: on ? 600 : 400,
              }}>
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
              onApptClick={appt => { setDate(appt.date); openView(appt); }}
              onDayClick={d => { setDate(d); setViewMode('day'); }}
            />
        : loading
          ? <div style={{ textAlign: 'center', color: '#bbb', padding: 40, fontSize: 13 }}>Loading…</div>
          : <DayGrid
              date={date}
              appts={appts}
              techs={displayTechs}
              techExtended={techExtended}
              empWorkDays={empWorkDays}
              slots={slots}
              dayStart={dayStart}
              walkInOpen={walkInOpen}
              walkInClose={walkInClose}
              techColWidth={techColWidth}
              onSlotClick={openNew}
              onApptClick={openView}
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
          onCheckout={appt => { setModal(null); setCheckout(appt); }}
          onRefund={appt => setRefund(appt)}
        />
      )}

      {checkout && (
        <CheckoutModal
          appt={checkout}
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
    </div>
  );
}

// ── Queue panel ───────────────────────────────────────
function QueuePanel({ entries, onSeat, onRemove, onDone }) {
  const waiting  = entries.filter(e => e.status === 'waiting');
  const arrived  = entries.filter(e => e.status === 'waiting' && e.hasAppointment);
  const walkIns  = entries.filter(e => e.status === 'waiting' && e.isWalkIn);
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
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', flex: 1 }}>
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
          {waiting.map((entry, i) => (
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
                {entry.isWalkIn && (
                  <button onClick={() => onSeat(entry)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #c6e8d5', background: '#f0faf6', color: '#2D7A5F', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Seat
                  </button>
                )}
                {entry.hasAppointment && (
                  <button onClick={() => onDone(entry)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#16a34a', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ✓ Done
                  </button>
                )}
                <button onClick={() => onRemove(entry)}
                  style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✕
                </button>
              </div>
            </div>
          ))}
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
function WeekGrid({ weekStart, appts, clients, employees, onApptClick, onDayClick }) {
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
                      const colors = STATUS_COLORS[appt.status] || STATUS_COLORS.scheduled;
                      return (
                        <div key={appt.id} onClick={e => { e.stopPropagation(); onApptClick(appt); }}
                          style={{ padding: '3px 5px', borderRadius: 5, background: colors.bg, borderLeft: `3px solid ${colors.border}`, cursor: 'pointer' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: colors.text, lineHeight: 1.2 }}>
                            {minsToStr(strToMins(appt.startTime))}
                          </div>
                          <div style={{ fontSize: 10, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {appt.clientName || 'Walk-in'}
                          </div>
                          <div style={{ fontSize: 9, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
function DayGrid({ date, appts, techs, techExtended, empWorkDays, slots, dayStart, walkInOpen, walkInClose, techColWidth, onSlotClick, onApptClick }) {
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
          return (
            <div key={tech} style={{ width: TECH_COL, flexShrink: 0, padding: '8px 4px', fontSize: 11, fontWeight: 600, color: isOff ? '#bbb' : '#555', textAlign: 'center', borderLeft: '1px solid #e8e8e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: isOff ? '#fafafa' : undefined }}>
              {tech}
              {isOff && (
                <div style={{ fontSize: 8, color: '#d0d0d0', fontWeight: 500, letterSpacing: '.03em' }}>off today</div>
              )}
              {!isOff && hasApptOnlyZone && techExtended[tech] && (
                <div style={{ fontSize: 8, color: '#3B82F6', fontWeight: 500, letterSpacing: '.03em' }}>extended</div>
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
                <span style={{ fontSize: 10, color: isCurrentHr ? '#ef4444' : isPast ? '#ccc' : '#aaa', fontWeight: isCurrentHr ? 700 : 500 }}>
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
              return (
                <div
                  key={tech}
                  onClick={() => allowed && onSlotClick(tech, slotMins)}
                  style={{
                    width: TECH_COL, flexShrink: 0, borderLeft: '1px solid #ececec',
                    cursor: allowed ? 'pointer' : 'default',
                    position: 'relative',
                    background: isOff
                      ? 'repeating-linear-gradient(45deg,#fafafa,#fafafa 4px,#f0f0f0 4px,#f0f0f0 8px)'
                      : !inWalkIn
                      ? (allowed ? 'rgba(59,130,246,.06)' : 'rgba(0,0,0,.025)')
                      : 'transparent',
                  }}
                  title={isOff ? `${tech} · off today` : (allowed ? `${tech} · ${minsToStr(slotMins)}` : `${tech} · appointment-only hours`)}
                >
                  {allowed && (
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
          const colors    = STATUS_COLORS[appt.status] || STATUS_COLORS.scheduled;

          return (
            <div
              key={appt.id}
              onClick={e => { e.stopPropagation(); onApptClick(appt); }}
              style={{
                position: 'absolute',
                top: topOffset + 1,
                left,
                width: TECH_COL - 4,
                height,
                background: colors.bg,
                border: `1.5px solid ${colors.border}`,
                borderRadius: 6,
                padding: '3px 5px',
                cursor: 'pointer',
                overflow: 'hidden',
                zIndex: 5,
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors.text, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {appt.clientName || 'Walk-in'}
                </div>
                {appt.source === 'online_booking' && (
                  <span title="Online booking" style={{ fontSize: 9, background: '#3D95CE', color: '#fff', borderRadius: 4, padding: '1px 4px', fontWeight: 700, flexShrink: 0, lineHeight: 1.5 }}>WEB</span>
                )}
                {appt.checkedInAt && (
                  <span title="Client checked in" style={{ fontSize: 9, background: '#2D7A5F', color: '#fff', borderRadius: 4, padding: '1px 4px', fontWeight: 700, flexShrink: 0, lineHeight: 1.5 }}>IN</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: colors.text, opacity: .85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {appt.services?.map(s => s.name).filter(Boolean).join(', ') || '—'}
              </div>
              {height > SLOT_H && (
                <div style={{ fontSize: 10, color: colors.text, opacity: .65 }}>
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
function ApptModal({ appt, mode, clients, services, techs, onChange, onSwitchEdit, onSave, onDelete, onClose, onCheckout, onRefund, viewOnly }) {
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
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8, flexShrink: 0 }}>
          {isView ? (
            <>
              {!isNew && !viewOnly && (
                <button onClick={onDelete} style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fef2f2', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                  Delete
                </button>
              )}
              {appt.id && (
                <button onClick={copyCheckinLink} title="Copy check-in link for client"
                  style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: `1px solid ${linkCopied ? '#bbf7d0' : '#d0d0d0'}`, background: linkCopied ? '#f0fdf4' : '#fff', color: linkCopied ? '#166534' : '#555', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, flexShrink: 0 }}>
                  {linkCopied ? '✓ Copied!' : '🔗 Check-in'}
                </button>
              )}
              <button onClick={onClose} style={{ flex: 1, ...btnBase }}>Close</button>
              {!viewOnly && (
                <button onClick={onSwitchEdit} style={{ flex: 1, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE' }}>Edit</button>
              )}
              {appt.id && appt.status !== 'done' && appt.status !== 'cancelled' && (
                <button onClick={() => onCheckout(appt)}
                  style={{ flex: 2, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg,#2D7A5F 0%,#3D95CE 100%)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px' }}>
                  Checkout
                </button>
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
