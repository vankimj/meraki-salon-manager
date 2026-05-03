import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchEmployees, subscribeAttendance, saveAttendance } from '../../lib/firestore';
import { logActivity } from '../../lib/logger';

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
      <div style={{ textAlign: 'center', padding: '64px 20px', color: '#aaa', fontSize: 14 }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🔒</div>
        <div style={{ fontWeight: 600, color: '#555', marginBottom: 8 }}>Access Restricted</div>
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
          style={{ fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid #d8d8d8', fontFamily: 'inherit', background: '#fff', color: '#333', outline: 'none' }} />
        <button onClick={() => setDate(todayStr())} disabled={date === todayStr()}
          style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: date === todayStr() ? '#f5f5f5' : '#fff', color: '#555', cursor: date === todayStr() ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          Today
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#888' }}>
          {sortedEmps.length} active employees · {dow}
        </span>
      </div>

      {/* KPI band */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Scheduled" value={`${totals.scheduledHrs.toFixed(1)} hr`} />
        <KPI label="Worked"    value={`${totals.workedHrs.toFixed(1)} hr`} />
        <KPI label="Present"   value={String(totals.present)} accent="#2D7A5F" />
        <KPI label="Absent"    value={String(totals.absent)}   accent={totals.absent > 0 ? '#ef4444' : '#888'} />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>Loading…</div>
      ) : sortedEmps.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>No active employees.</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.4fr 1.4fr 1fr 1fr', padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '.05em', textTransform: 'uppercase', background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
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
              <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.4fr 1.4fr 1fr 1fr', padding: '10px 14px', borderBottom: '1px solid #f5f5f5', fontSize: 12, alignItems: 'center', background: noShow ? '#fffaf8' : '#fff' }}>
                <div style={{ color: '#1a1a1a', fontWeight: 600 }}>{emp.name}</div>
                <div style={{ color: wd?.on ? '#555' : '#bbb' }}>{scheduled}</div>
                <div style={{ color: e?.clockInAt  ? '#1a1a1a' : noShow ? '#ef4444' : '#bbb' }}>{e?.clockInAt  ? fmtTime(e.clockInAt)  : noShow ? 'Not clocked in' : '—'}</div>
                <div style={{ color: e?.clockOutAt ? '#1a1a1a' : '#bbb' }}>{e?.clockOutAt ? fmtTime(e.clockOutAt) : '—'}</div>
                <div style={{ textAlign: 'right', color: hrs > 0 ? '#2D7A5F' : '#bbb', fontWeight: hrs > 0 ? 700 : 400 }}>{hrs > 0 ? `${hrs.toFixed(2)} hr` : '—'}</div>
                <div style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button onClick={() => setEditing({ employeeId: emp.id, employeeName: emp.name, clockInAt: e?.clockInAt || '', clockOutAt: e?.clockOutAt || '' })}
                    disabled={!isAdmin}
                    title={isAdmin ? 'Edit clock-in / out' : 'Admin only'}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: !isAdmin ? '#f5f5f5' : '#fff', color: !isAdmin ? '#bbb' : '#555', cursor: isAdmin ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
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
        <div style={{ marginTop: 14, fontSize: 11, color: '#888', fontStyle: 'italic' }}>
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
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: '#aaa', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent || '#1a1a1a' }}>{value}</div>
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
      <div style={{ background: '#fff', borderRadius: 16, padding: '20px 22px', width: '92%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>Edit clock-in / out</div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 18 }}>{entry.employeeName} · {date}</div>

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
                style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', color: '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
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
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #d8d8d8', background: '#fff', color: '#555', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
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
      <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  borderRadius: 8, border: '1px solid #d8d8d8', fontSize: 13,
  fontFamily: 'inherit', background: '#fafafa', outline: 'none',
};
