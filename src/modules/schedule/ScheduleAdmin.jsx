import { useState, useEffect, useCallback } from 'react';
import { fetchAppointments, createAppointment, saveAppointment, deleteAppointment, fetchClients, fetchServices, fetchEmployees } from '../../lib/firestore';
import CheckoutModal from '../checkout/CheckoutModal';
import { useApp } from '../../context/AppContext';
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
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const STATUS_COLORS = {
  scheduled:   { bg: '#EBF4FB', border: '#3D95CE', text: '#1a5f8a' },
  'in-progress': { bg: '#FEF9EC', border: '#F59E0B', text: '#92400e' },
  done:        { bg: '#EDFAF3', border: '#22C55E', text: '#166534' },
  cancelled:   { bg: '#FEF2F2', border: '#EF4444', text: '#991b1b' },
};

const OVERLAY_KEY = 'meraki_visible_techs';

function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
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

function blankAppt(date, techName, startMins) {
  return {
    clientId: '',
    clientName: '',
    techName: techName || '',
    services: [{ name: '', duration: 60, price: '' }],
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
  const { settings, isTech, myTechName, gUser } = useApp();

  const walkInOpen  = strToMins(settings.walkIn?.open   || '09:00');
  const walkInClose = strToMins(settings.walkIn?.close  || '18:00');
  const apptOpen    = strToMins(settings.apptHours?.open  || '09:00');
  const apptClose   = strToMins(settings.apptHours?.close || '20:00');
  const dayStart    = Math.min(walkInOpen, apptOpen);
  const dayEnd      = Math.max(walkInClose, apptClose);
  const slots = [];
  for (let m = dayStart; m < dayEnd; m += 30) slots.push(m);

  const [date,         setDate]        = useState(todayStr());
  const [appts,        setAppts]       = useState([]);
  const [loading,      setLoading]     = useState(true);
  const [modal,        setModal]       = useState(null);
  const [checkout,     setCheckout]    = useState(null);
  const [clients,      setClients]     = useState([]);
  const [services,     setServices]    = useState([]);
  const [techs,        setTechs]       = useState(FALLBACK_TECHS);
  const [techExtended,     setTechExtended]     = useState({});
  const [showAll,          setShowAll]          = useState(false);
  const [visibleTechNames, setVisibleTechNames] = useState(null);
  const [empWorkDays,      setEmpWorkDays]      = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setAppts(await fetchAppointments(date)); }
    catch (e) { console.error('[Schedule] load failed:', e); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetchClients().then(setClients).catch(() => {});
    fetchServices().then(s => setServices(s.filter(sv => sv.active !== false))).catch(() => {});
    fetchEmployees().then(emps => {
      const active = emps.filter(e => e.active !== false);
      if (active.length) {
        const names = active.map(e => e.name);
        setTechs(names);
        setVisibleTechNames(loadOverlay(names));
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

  async function handleSave(appt, original) {
    try {
      const dur  = appt.services.reduce((sum, s) => sum + (Number(s.duration) || 0), 0) || 60;
      const full = { ...appt, duration: dur };
      if (appt.id) {
        const { id, createdAt, ...data } = full;
        await saveAppointment(id, data);
      } else {
        const newId = await createAppointment(full);
        full.id = newId;
      }
      notifyAffectedTechs(original, full, gUser).catch(e => console.error('[Notif]', e));
      await load();
      setModal(null);
    } catch (e) { console.error('[Schedule] save failed:', e); }
  }

  async function handleDelete(appt) {
    if (!confirm(`Delete this appointment for ${appt.clientName || 'walk-in'}?`)) return;
    await deleteAppointment(appt.id);
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
      return next;
    });
  }

  const dow            = dayOfWeek(date);
  const isStoreClosed  = !!settings.storeHours?.[dow]?.closed;
  const displayTechs   = isTech && !showAll
    ? techs.filter(t => t === myTechName)
    : visibleTechNames ? techs.filter(t => visibleTechNames.includes(t)) : techs;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Date nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0 }}>
        <NavBtn onClick={() => setDate(d => addDays(d, -1))}>‹</NavBtn>
        <button onClick={() => setDate(todayStr())} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: date === todayStr() ? '#3D95CE' : '#fff', color: date === todayStr() ? '#fff' : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>
          Today
        </button>
        <NavBtn onClick={() => setDate(d => addDays(d, 1))}>›</NavBtn>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{fmtDate(date)}</span>
        {isTech && (
          <button onClick={() => setShowAll(v => !v)} style={{
            fontSize: 11, padding: '5px 10px', borderRadius: 6, fontFamily: 'inherit', cursor: 'pointer',
            border: `1px solid ${showAll ? '#3D95CE' : '#d8d8d8'}`,
            background: showAll ? '#EBF4FB' : '#fff',
            color: showAll ? '#1a5f8a' : '#555', fontWeight: showAll ? 600 : 400,
          }}>
            {showAll ? '👥 All Techs' : '👤 My Column'}
          </button>
        )}
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ marginLeft: 'auto', fontSize: 12, border: '1px solid #d8d8d8', borderRadius: 6, padding: '5px 8px', fontFamily: 'inherit', background: '#fafafa' }} />
      </div>

      {/* Tech overlay filter pills */}
      {(!isTech || showAll) && visibleTechNames && (
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

      {/* Store closed banner */}
      {isStoreClosed && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '7px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 14 }}>🚫</span>
          <span style={{ fontSize: 12, color: '#991b1b', fontWeight: 500 }}>Salon is closed today — appointments can still be booked manually</span>
        </div>
      )}

      {/* Birthdays banner */}
      {birthdayClients.length > 0 && (
        <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '7px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>🎂</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#9A3412' }}>Birthdays today:</span>
          {birthdayClients.map(c => (
            <span key={c.id} style={{ fontSize: 12, color: '#7C2D12', background: '#FFEDD5', borderRadius: 20, padding: '2px 10px', border: '1px solid #FED7AA' }}>
              {c.name}
            </span>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading
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
        />
      )}

      {checkout && (
        <CheckoutModal
          appt={checkout}
          onComplete={() => { setCheckout(null); load(); }}
          onClose={() => setCheckout(null)}
        />
      )}
    </div>
  );
}

// ── Day grid ──────────────────────────────────────────
function DayGrid({ date, appts, techs, techExtended, empWorkDays, slots, dayStart, walkInOpen, walkInClose, onSlotClick, onApptClick }) {
  const TIME_COL = 54;
  const TECH_COL = 120;
  const dow = dayOfWeek(date);

  // appointment-only zone exists when appt hours extend beyond walk-in hours
  const hasApptOnlyZone = slots.some(m => m < walkInOpen || m >= walkInClose);

  return (
    <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', borderRadius: 10, border: '1px solid #e8e8e8', background: '#fff' }}>
      {/* Header row */}
      <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
        <div style={{ width: TIME_COL, flexShrink: 0 }} />
        {techs.map(tech => {
          const isOff = empWorkDays[tech]?.[dow]?.on === false;
          return (
            <div key={tech} style={{ width: TECH_COL, flexShrink: 0, padding: '8px 4px', fontSize: 11, fontWeight: 600, color: isOff ? '#bbb' : '#555', textAlign: 'center', borderLeft: '1px solid #f0f0f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: isOff ? '#fafafa' : undefined }}>
              {tech}
              {isOff && (
                <div style={{ fontSize: 8, color: '#d0d0d0', fontWeight: 500, letterSpacing: '.03em' }}>off today</div>
              )}
              {!isOff && hasApptOnlyZone && techExtended[tech] && (
                <div style={{ fontSize: 8, color: '#3D95CE', fontWeight: 500, letterSpacing: '.03em' }}>extended</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time slots */}
      <div style={{ position: 'relative' }}>
        {slots.map((slotMins) => {
          const inWalkIn   = slotMins >= walkInOpen && slotMins < walkInClose;
          const isBoundary = slotMins === walkInClose && hasApptOnlyZone;

          return (
          <div key={slotMins} style={{ display: 'flex', height: SLOT_H, borderBottom: '1px solid #f5f5f5', position: 'relative' }}>
            {/* Walk-in → appt-only separator */}
            {isBoundary && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,rgba(245,158,11,.6),rgba(245,158,11,.1))', zIndex: 6, pointerEvents: 'none' }} />
            )}

            {/* Time label */}
            <div style={{ width: TIME_COL, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'flex-start', paddingRight: 6, paddingTop: 3, position: 'relative' }}>
              {slotMins % 60 === 0 && (
                <span style={{ fontSize: 10, color: '#bbb', fontWeight: 500 }}>{minsToStr(slotMins)}</span>
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
                    width: TECH_COL, flexShrink: 0, borderLeft: '1px solid #f0f0f0',
                    cursor: allowed ? 'pointer' : 'default',
                    position: 'relative',
                    background: isOff
                      ? 'repeating-linear-gradient(45deg,#fafafa,#fafafa 4px,#f4f4f4 4px,#f4f4f4 8px)'
                      : (!inWalkIn ? (allowed ? 'rgba(61,149,206,.04)' : '#f4f4f4') : undefined),
                  }}
                  title={isOff ? `${tech} · off today` : (allowed ? `${tech} · ${minsToStr(slotMins)}` : `${tech} · appointment-only hours`)}
                >
                  {allowed && (
                    <div style={{ position: 'absolute', inset: 0, transition: 'background .1s' }}
                         onMouseEnter={e => e.currentTarget.style.background = inWalkIn ? '#f0f7ff' : 'rgba(61,149,206,.1)'}
                         onMouseLeave={e => e.currentTarget.style.background = ''} />
                  )}
                </div>
              );
            })}
          </div>
          );
        })}

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
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: colors.text, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {appt.clientName || 'Walk-in'}
              </div>
              <div style={{ fontSize: 10, color: colors.text, opacity: .8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
function ApptModal({ appt, mode, clients, services, techs, onChange, onSwitchEdit, onSave, onDelete, onClose, onCheckout, viewOnly }) {
  const [saving, setSaving] = useState(false);
  const isView = mode === 'view';
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
              <StatusChip status={appt.status} />
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
              <select value={appt.clientId || ''} onChange={e => pickClient(e.target.value)} style={inp}>
                <option value="">Walk-in / no client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
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
