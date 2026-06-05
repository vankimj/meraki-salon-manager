import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchEmployees, subscribeAttendance, saveAttendance } from '../../lib/firestore';
import { logActivity } from '../../lib/logger';
import { TENANT_ID } from '../../lib/tenant';
import { EmpAvatar } from '../employees/EmployeesAdmin';

const WORK_DAY_KEYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DEFAULT_WORK_DAY = { on: true, start: '09:00', end: '18:00' };

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtTimeStr(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function dayKey(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return WORK_DAY_KEYS[d.getDay()];
}

// "2026-05-02T09:00" (datetime-local) → ISO string. Handles missing.
function localToIso(local) {
  if (!local) return null;
  return new Date(local).toISOString();
}

// ISO → "2026-05-02T09:00" for datetime-local input.
function isoToLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function hoursWorked(clockIn, clockOut) {
  if (!clockIn || !clockOut) return 0;
  const ms = new Date(clockOut) - new Date(clockIn);
  if (ms <= 0) return 0;
  return ms / 3600000;
}

export default function AttendanceAdmin() {
  const { isAdmin, isReadOnly, isTech, isScheduler, showToast } = useApp();
  const [date, setDate] = useState(todayStr());
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState({ entries: [] });
  const [editing, setEditing] = useState(null); // { employeeId, employeeName, clockInAt, clockOutAt }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEmployees().then(es => {
      setEmployees(es.filter(e => e.active !== false).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const unsub = subscribeAttendance(date, setAttendance);
    return unsub;
  }, [date]);

  const entryByEmpId = useMemo(() => {
    const m = {};
    (attendance.entries || []).forEach(e => { m[e.employeeId] = e; });
    return m;
  }, [attendance]);

  if (isTech || isScheduler) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 20px', color: 'var(--pn-text-faint)', fontSize: 14 }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🔒</div>
        <div style={{ fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 8 }}>Access Restricted</div>
        <div>Attendance is available to admin and management staff only.</div>
      </div>
    );
  }

  const dow = dayKey(date);
  const sortedEmps = [...employees];

  async function saveEntry({ employeeId, employeeName, clockInAt, clockOutAt }) {
    if (!isAdmin) {
      showToast('Only admins can edit clock-in / clock-out times.', 3500);
      return;
    }
    const next = (attendance.entries || []).filter(e => e.employeeId !== employeeId);
    next.push({ employeeId, employeeName, clockInAt, clockOutAt });
    try {
      await saveAttendance(date, next);
      logActivity('attendance_edited', `${employeeName} on ${date} · in ${fmtTime(clockInAt)} · out ${fmtTime(clockOutAt)}`);
      showToast('Saved');
      setEditing(null);
    } catch (e) {
      showToast('Save failed: ' + e.message, 3500);
    }
  }

  async function clearEntry(employeeId) {
    if (!isAdmin) {
      showToast('Only admins can edit clock-in / clock-out times.', 3500);
      return;
    }
    const next = (attendance.entries || []).filter(e => e.employeeId !== employeeId);
    try { await saveAttendance(date, next); showToast('Cleared'); }
    catch (e) { showToast('Save failed: ' + e.message, 3500); }
  }

  // Salon-level totals
  const totals = useMemo(() => {
    let scheduledHrs = 0, workedHrs = 0, present = 0, absent = 0;
    sortedEmps.forEach(emp => {
      const wd = emp.workDays?.[dow] ?? DEFAULT_WORK_DAY;
      if (wd?.on) {
        const [sh, sm] = (wd.start || '09:00').split(':').map(Number);
        const [eh, em] = (wd.end   || '18:00').split(':').map(Number);
        scheduledHrs += ((eh + em / 60) - (sh + sm / 60));
      }
      const e = entryByEmpId[emp.id];
      if (e?.clockInAt && e?.clockOutAt) {
        present++;
        workedHrs += hoursWorked(e.clockInAt, e.clockOutAt);
      } else if (e?.clockInAt) {
        present++;
      } else if (wd?.on) {
        absent++;
      }
    });
    return { scheduledHrs, workedHrs, present, absent };
  }, [sortedEmps, entryByEmpId, dow]);

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', fontFamily: 'inherit', background: 'var(--pn-surface)', color: 'var(--pn-text)', outline: 'none' }} />
        <button onClick={() => setDate(todayStr())} disabled={date === todayStr()}
          style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: date === todayStr() ? 'var(--pn-surface-alt)' : 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: date === todayStr() ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          Today
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>
          {sortedEmps.length} active employees · {dow}
        </span>
      </div>

      {/* Live-now panel — only when viewing today */}
      {date === todayStr() && sortedEmps.length > 0 && (
        <LiveNowGrid
          employees={sortedEmps}
          entryByEmpId={entryByEmpId}
          isAdmin={isAdmin}
          showToast={showToast}
        />
      )}

      {/* KPI band */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Scheduled" value={`${totals.scheduledHrs.toFixed(1)} hr`} />
        <KPI label="Worked"    value={`${totals.workedHrs.toFixed(1)} hr`} />
        <KPI label="Present"   value={String(totals.present)} accent="#2D7A5F" />
        <KPI label="Absent"    value={String(totals.absent)}   accent={totals.absent > 0 ? '#ef4444' : '#888'} />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--pn-text-faint)' }}>Loading…</div>
      ) : sortedEmps.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--pn-text-faint)' }}>No active employees.</div>
      ) : (
        <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.4fr 1.4fr 1fr 1fr', padding: '10px 14px', fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', letterSpacing: '.05em', textTransform: 'uppercase', background: 'var(--pn-bg)', borderBottom: '1px solid var(--pn-border)' }}>
            <div>Employee</div>
            <div>Scheduled</div>
            <div>Clock In</div>
            <div>Clock Out</div>
            <div style={{ textAlign: 'right' }}>Hours</div>
            <div style={{ textAlign: 'right' }}>Action</div>
          </div>
          {sortedEmps.map(emp => {
            const wd = emp.workDays?.[dow] ?? DEFAULT_WORK_DAY;
            const e  = entryByEmpId[emp.id];
            const scheduled = wd?.on
              ? `${fmtTimeStr(wd.start || '09:00')} – ${fmtTimeStr(wd.end || '18:00')}`
              : 'Off';
            const hrs = e ? hoursWorked(e.clockInAt, e.clockOutAt) : 0;
            const noShow = wd?.on && !e?.clockInAt;
            return (
              <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.4fr 1.4fr 1fr 1fr', padding: '10px 14px', borderBottom: '1px solid var(--pn-surface-alt)', fontSize: 12, alignItems: 'center', background: noShow ? '#fffaf8' : 'var(--pn-surface)' }}>
                <div style={{ color: 'var(--pn-text)', fontWeight: 600 }}>{emp.name}</div>
                <div style={{ color: wd?.on ? 'var(--pn-text-muted)' : 'var(--pn-text-faint)' }}>{scheduled}</div>
                <div style={{ color: e?.clockInAt  ? 'var(--pn-text)' : noShow ? '#ef4444' : 'var(--pn-text-faint)' }}>{e?.clockInAt  ? fmtTime(e.clockInAt)  : noShow ? 'Not clocked in' : '—'}</div>
                <div style={{ color: e?.clockOutAt ? 'var(--pn-text)' : 'var(--pn-text-faint)' }}>{e?.clockOutAt ? fmtTime(e.clockOutAt) : '—'}</div>
                <div style={{ textAlign: 'right', color: hrs > 0 ? '#2D7A5F' : 'var(--pn-text-faint)', fontWeight: hrs > 0 ? 700 : 400 }}>{hrs > 0 ? `${hrs.toFixed(2)} hr` : '—'}</div>
                <div style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button onClick={() => setEditing({ employeeId: emp.id, employeeName: emp.name, clockInAt: e?.clockInAt || '', clockOutAt: e?.clockOutAt || '' })}
                    disabled={!isAdmin}
                    title={isAdmin ? 'Edit clock-in / out' : 'Admin only'}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: !isAdmin ? 'var(--pn-surface-alt)' : 'var(--pn-surface)', color: !isAdmin ? 'var(--pn-text-faint)' : 'var(--pn-text-muted)', cursor: isAdmin ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                    {e?.clockInAt ? 'Edit' : 'Set'}
                  </button>
                  {e && isAdmin && (
                    <button onClick={() => { if (window.confirm(`Clear ${emp.name}'s entry for ${date}?`)) clearEntry(emp.id); }}
                      style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit' }}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isAdmin && (
        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--pn-text-muted)', fontStyle: 'italic' }}>
          🔒 Read-only view. Only admins can edit clock-in / clock-out times.
        </div>
      )}

      {editing && (
        <EditEntryModal
          date={date}
          entry={editing}
          onCancel={() => setEditing(null)}
          onSave={saveEntry}
        />
      )}
    </div>
  );
}

function KPI({ label, value, accent }) {
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent || 'var(--pn-text)' }}>{value}</div>
    </div>
  );
}

function EditEntryModal({ date, entry, onCancel, onSave }) {
  const [inLocal,  setInLocal]  = useState(isoToLocal(entry.clockInAt)  || `${date}T09:00`);
  const [outLocal, setOutLocal] = useState(isoToLocal(entry.clockOutAt) || '');

  function submit() {
    onSave({
      employeeId:   entry.employeeId,
      employeeName: entry.employeeName,
      clockInAt:    localToIso(inLocal),
      clockOutAt:   localToIso(outLocal),
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
         onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, padding: '20px 22px', width: '92%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4 }}>Edit clock-in / out</div>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 18 }}>{entry.employeeName} · {date}</div>

        <Field label="Clock in">
          <input type="datetime-local" value={inLocal} onChange={e => setInLocal(e.target.value)}
            style={inputStyle} />
        </Field>
        <Field label="Clock out">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="datetime-local" value={outLocal} onChange={e => setOutLocal(e.target.value)}
              style={{ ...inputStyle, flex: 1 }} />
            {outLocal && (
              <button onClick={() => setOutLocal('')} title="Clear clock out"
                style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Clear
              </button>
            )}
          </div>
        </Field>

        {inLocal && outLocal && new Date(outLocal) > new Date(inLocal) && (
          <div style={{ fontSize: 12, color: '#2D7A5F', fontWeight: 600, marginBottom: 14 }}>
            Total: {((new Date(outLocal) - new Date(inLocal)) / 3600000).toFixed(2)} hr
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={!inLocal}
            style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: inLocal ? '#2D7A5F' : '#d0d0d0', color: '#fff', fontSize: 13, fontWeight: 700, cursor: inLocal ? 'pointer' : 'default', fontFamily: 'inherit' }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  borderRadius: 8, border: '1px solid var(--pn-border-strong)', fontSize: 13,
  fontFamily: 'inherit', background: 'var(--pn-bg)', outline: 'none',
};

// ── Live-now grid (admin override) ──────────────────────────────────────
// Mirror of the kiosk grid but with admin actions — no PIN required because
// the user is already authenticated via Firebase Auth, and clockEvent's
// admin_override path verifies admin/scheduler role server-side. Tiles
// surface aging colors so a 47-min break stands out and the admin can
// correct or close it in one tap.

function computeStateLive(events) {
  if (!Array.isArray(events) || events.length === 0) return 'out';
  const last = events[events.length - 1];
  switch (last && last.kind) {
    case 'in':          return 'in';
    case 'break_start': return 'on_break';
    case 'break_end':   return 'in';
    default:            return 'out';
  }
}

function chipForState(state, events) {
  if (state === 'out' || !events || !events.length) return null;
  const last = events[events.length - 1];
  const mins = Math.max(0, Math.floor((Date.now() - new Date(last.at).getTime()) / 60000));
  if (state === 'on_break') {
    const fg = mins >= 60 ? '#b91c1c' : mins >= 30 ? '#b45309' : '#7c5400';
    const bg = mins >= 60 ? '#fee2e2' : mins >= 30 ? '#fff7ed' : '#fef9c3';
    return { label: `☕ Break ${mins}m`, bg, fg };
  }
  if (state === 'in') {
    return { label: `🟢 In since ${fmtTime(last.at)}`, bg: '#ecfdf5', fg: '#166534' };
  }
  return null;
}

function actionsForState(state) {
  switch (state) {
    case 'out':      return [{ kind: 'in',          label: 'Clock In',    color: '#2D7A5F' }];
    case 'in':       return [
      { kind: 'break_start', label: 'Start Break', color: '#d97706' },
      { kind: 'out',         label: 'Clock Out',   color: '#1f2937' },
    ];
    case 'on_break': return [
      { kind: 'break_end',   label: 'End Break',   color: '#2D7A5F' },
      { kind: 'out',         label: 'Clock Out',   color: '#1f2937' },
    ];
    default:         return [];
  }
}

function LiveNowGrid({ employees, entryByEmpId, isAdmin, showToast }) {
  const [picked, setPicked] = useState(null);
  // Tick every 30s so aging chips refresh ("Break 47m" → "Break 48m") even
  // when no underlying event lands.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ marginBottom: 18, padding: 14, background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)' }}>
          🕐 Live now
        </div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>tap a tech to override</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {employees.map(emp => {
          const events = entryByEmpId[emp.id]?.events || [];
          const state  = computeStateLive(events);
          const chip   = chipForState(state, events);
          return (
            <button key={emp.id}
              onClick={() => setPicked(emp)}
              disabled={!isAdmin}
              title={isAdmin ? 'Override clock state' : 'Admin only'}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                padding: '14px 8px 12px',
                background: state === 'out' ? 'var(--pn-bg)' : state === 'on_break' ? '#fffbeb' : '#f0fdf4',
                border: `1px solid ${state === 'out' ? 'var(--pn-border)' : state === 'on_break' ? '#fde68a' : '#bbf7d0'}`,
                borderRadius: 10,
                cursor: isAdmin ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                textAlign: 'center',
                opacity: isAdmin ? 1 : 0.6,
              }}>
              <EmpAvatar emp={emp} size={44} />
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--pn-text)', lineHeight: 1.2 }}>{emp.name}</div>
              {chip ? (
                <div style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: chip.bg, color: chip.fg }}>{chip.label}</div>
              ) : (
                <div style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>Out</div>
              )}
            </button>
          );
        })}
      </div>
      {picked && (
        <AdminOverrideModal
          emp={picked}
          events={entryByEmpId[picked.id]?.events || []}
          onClose={() => setPicked(null)}
          onDone={(msg) => { setPicked(null); showToast?.(msg); }}
        />
      )}
    </div>
  );
}

// Admin action modal — same layout as the kiosk's action sheet but without
// PIN entry, plus a back-date control for fixing forgotten clock events.
function AdminOverrideModal({ emp, events, onClose, onDone }) {
  const [working, setWorking] = useState(false);
  const [err,     setErr]     = useState('');
  const [customAt, setCustomAt] = useState('');  // 'YYYY-MM-DDTHH:MM' (local) — blank = now
  const state = computeStateLive(events);
  const actions = actionsForState(state);
  const lastEvent = events.length ? events[events.length - 1] : null;

  async function run(action) {
    setWorking(true);
    setErr('');
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions }     = await import('../../lib/firebase');
      const fn = httpsCallable(functions, 'clockEvent');
      const payload = {
        tenantId:   TENANT_ID,
        employeeId: emp.id,
        kind:       action.kind,
        via:        'admin_override',
      };
      if (customAt) payload.at = new Date(customAt).toISOString();
      const res = await fn(payload);
      const dup = res?.data?.duplicate ? ' (already recorded)' : '';
      onDone(`${emp.name} → ${action.label}${dup}`);
    } catch (e) {
      const code = e?.code || '';
      const msg  = (e?.message || '').replace(/^.*?: /, '');
      if (code === 'functions/failed-precondition') setErr(msg);
      else setErr(msg || 'Could not record');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 380, padding: 22, boxShadow: '0 18px 50px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <EmpAvatar emp={emp} size={48} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{emp.name}</div>
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2 }}>
              {state === 'out'      && 'Not clocked in today'}
              {state === 'in'       && lastEvent && `In since ${fmtTime(lastEvent.at)}`}
              {state === 'on_break' && lastEvent && `On break since ${fmtTime(lastEvent.at)}`}
            </div>
          </div>
        </div>

        {actions.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', padding: 12, textAlign: 'center' }}>No actions available.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {actions.map(a => (
              <button key={a.kind} onClick={() => run(a)} disabled={working}
                style={{ padding: '14px', fontSize: 15, fontWeight: 700, borderRadius: 12, border: 'none', background: a.color, color: '#fff', cursor: working ? 'default' : 'pointer', fontFamily: 'inherit', opacity: working ? .6 : 1 }}>
                {working ? 'Working…' : a.label}
              </button>
            ))}
          </div>
        )}

        {/* Back-date — for fixing "Ana actually went on break at 12:15" */}
        <div style={{ background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4, fontWeight: 600 }}>Use a different time (optional)</div>
          <input type="datetime-local" value={customAt} onChange={e => setCustomAt(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', fontFamily: 'inherit', fontSize: 12 }} />
          <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 4 }}>Blank = now. Useful for "Tess started break at 12:15" corrections.</div>
        </div>

        {err && <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 10, textAlign: 'center' }}>{err}</div>}

        <button onClick={onClose} disabled={working}
          style={{ width: '100%', padding: '10px 14px', fontSize: 13, fontWeight: 600, borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
