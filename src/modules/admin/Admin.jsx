import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchLogs, fetchEmployees } from '../../lib/firestore';
import { formatTime } from '../../utils/helpers';
import { seedDemoData, clearDemoData, addFutureAppointments } from '../../data/seedDemo';

const STORE_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_DAY_HOURS = { open: '09:00', close: '18:00', closed: false };

function initStoreHours(settings) {
  const saved = settings.storeHours || {};
  const result = {};
  STORE_DAYS.forEach(d => { result[d] = { ...DEFAULT_DAY_HOURS, ...saved[d] }; });
  return result;
}

export default function Admin({ onClose }) {
  const { gUser, users, settings, grantAccess, grantPendingAccess, loadPendingRequests, updateSettings, signOut, isAdmin } = useApp();
  const [timeout,      setTimeoutVal]  = useState(settings.timeoutMin || 5);
  const [pendingReqs,  setPendingReqs] = useState([]);
  const [reqsLoading,  setReqsLoading] = useState(false);
  const [employees,    setEmployees]   = useState([]);
  const [walkInOpen,  setWalkInOpen]  = useState(settings.walkIn?.open   || '09:00');
  const [walkInClose, setWalkInClose] = useState(settings.walkIn?.close  || '18:00');
  const [apptOpen,    setApptOpen]    = useState(settings.apptHours?.open  || '09:00');
  const [apptClose,   setApptClose]   = useState(settings.apptHours?.close || '20:00');
  const [storeHours,   setStoreHours]  = useState(() => initStoreHours(settings));
  const [logs,    setLogs]       = useState(null);
  const [tab,     setTab]        = useState('users');
  const TABS = ['users', 'logs', 'settings'];

  function patchStoreDay(day, patch) {
    setStoreHours(prev => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  }

  useEffect(() => { if (tab === 'logs') loadLogs(); }, [tab]);
  useEffect(() => {
    if (tab === 'users') {
      setReqsLoading(true);
      loadPendingRequests().then(setPendingReqs).catch(() => setPendingReqs([])).finally(() => setReqsLoading(false));
      fetchEmployees().then(emps => setEmployees(emps.filter(e => e.active !== false))).catch(() => {});
    }
  }, [tab]); // eslint-disable-line

  async function loadLogs() {
    setLogs(null);
    try { setLogs(await fetchLogs(100)); }
    catch { setLogs([]); }
  }

  if (!isAdmin) return null;

  const others = users.filter(u => u.role !== 'pending');

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#f5f5f5', zIndex: 50, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e8e8e8', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>⚙ Admin</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#888' }}>{gUser?.displayName || gUser?.email}</span>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid #d0d0d0', background: '#fff', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e8e8e8', background: '#fff', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '10px 0', fontSize: 12, fontWeight: tab === t ? 600 : 400, color: tab === t ? '#3D95CE' : '#888', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #3D95CE' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {tab === 'users' && (
          <>
            <Section title="👤 Pending Access Requests">
              {reqsLoading
                ? <Empty>Loading…</Empty>
                : pendingReqs.length
                  ? pendingReqs.map(req => (
                    <PendingRow
                      key={req.uid}
                      req={req}
                      employees={employees}
                      onGrant={(role, techName) =>
                        grantPendingAccess(req, role, techName)
                          .then(() => setPendingReqs(r => r.filter(x => x.uid !== req.uid)))
                      }
                    />
                  ))
                  : <Empty>No pending requests</Empty>
              }
            </Section>
            <Section title="👥 Users">
              {others.length ? others.map(u => (
                <UserRow key={u.email} user={u}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <select value={u.role} onChange={e => grantAccess(u.email, e.target.value, u.techName)}
                      style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', fontFamily: 'inherit' }}>
                      <option value="readonly">Read only</option>
                      <option value="tech">Tech</option>
                      <option value="admin">Admin</option>
                      <option value="denied">Denied</option>
                    </select>
                    {u.role === 'tech' && (
                      <select value={u.techName || ''} onChange={e => grantAccess(u.email, 'tech', e.target.value)}
                        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', fontFamily: 'inherit' }}>
                        <option value="">Assign tech…</option>
                        {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                      </select>
                    )}
                  </div>
                </UserRow>
              )) : <Empty>No users yet</Empty>}
            </Section>
          </>
        )}

        {tab === 'logs' && (
          <Section title="📄 Activity Log" action={<Btn onClick={loadLogs}>Refresh</Btn>}>
            {logs === null
              ? <Empty>Loading…</Empty>
              : logs.length
                ? logs.map((log, i) => <LogRow key={i} log={log} />)
                : <Empty>No logs yet</Empty>
            }
          </Section>
        )}

        {tab === 'settings' && (
          <>
            <Section title="⚙ Settings">
              {/* Timeout */}
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: '#333' }}>Auto-logout timeout</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>Minutes of inactivity before signing out</div>
                </div>
                <input type="number" value={timeout} onChange={e => setTimeoutVal(Number(e.target.value))} min={1} max={60}
                  style={{ width: 80, textAlign: 'center', fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '8px 12px', fontSize: 13 }} />
              </div>

              {/* Walk-in hours */}
              <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: '#333' }}>Walk-in hours</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>All techs accept walk-ins during these hours</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <input type="time" value={walkInOpen}  onChange={e => setWalkInOpen(e.target.value)}
                    style={{ fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '6px 8px', fontSize: 12 }} />
                  <span style={{ color: '#bbb', fontSize: 12 }}>–</span>
                  <input type="time" value={walkInClose} onChange={e => setWalkInClose(e.target.value)}
                    style={{ fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '6px 8px', fontSize: 12 }} />
                </div>
              </div>

              {/* Appointment hours */}
              <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: '#333' }}>Appointment hours</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>Extended hours outside walk-in = appointment-only</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <input type="time" value={apptOpen}  onChange={e => setApptOpen(e.target.value)}
                    style={{ fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '6px 8px', fontSize: 12 }} />
                  <span style={{ color: '#bbb', fontSize: 12 }}>–</span>
                  <input type="time" value={apptClose} onChange={e => setApptClose(e.target.value)}
                    style={{ fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '6px 8px', fontSize: 12 }} />
                </div>
              </div>

              <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                <Btn color="#3D95CE" onClick={() => updateSettings({
                  ...settings,
                  timeoutMin: timeout,
                  walkIn:     { open: walkInOpen,  close: walkInClose },
                  apptHours:  { open: apptOpen,    close: apptClose   },
                  storeHours,
                })}>Save Settings</Btn>
              </div>
            </Section>

            <Section title="🕐 Store Hours">
              {STORE_DAYS.map((day, idx) => {
                const h = storeHours[day];
                return (
                  <div key={day} style={{ padding: '9px 16px', borderTop: idx > 0 ? '1px solid #f0f0f0' : 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, fontSize: 13, color: h.closed ? '#bbb' : '#333', fontWeight: 500 }}>{day}</div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#888', cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={!!h.closed} onChange={e => patchStoreDay(day, { closed: e.target.checked })} />
                      Closed
                    </label>
                    {!h.closed && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                        <input type="time" value={h.open}  onChange={e => patchStoreDay(day, { open:  e.target.value })}
                          style={{ fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '5px 7px', fontSize: 12 }} />
                        <span style={{ color: '#bbb', fontSize: 12 }}>–</span>
                        <input type="time" value={h.close} onChange={e => patchStoreDay(day, { close: e.target.value })}
                          style={{ fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '5px 7px', fontSize: 12 }} />
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ padding: '10px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end' }}>
                <Btn color="#3D95CE" onClick={() => updateSettings({ ...settings, storeHours })}>Save Hours</Btn>
              </div>
            </Section>
            <DemoSeedSection />
          </>
        )}

        <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
          <button onClick={() => { signOut(); onClose(); }} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 20px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            ▶ Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, action }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', marginBottom: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e8e8e8', fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: '.06em', textTransform: 'uppercase', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {title}{action}
      </div>
      {children}
    </div>
  );
}

function UserRow({ user, children }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: '#888', overflow: 'hidden', flexShrink: 0 }}>
        {user.picture ? <img src={user.picture} alt="" style={{ width: 36, height: 36, objectFit: 'cover' }} /> : (user.name?.[0] || user.email?.[0])}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>
          {user.name || user.email}
          {' '}<RoleBadge role={user.role} />
        </div>
        <div style={{ fontSize: 11, color: '#888' }}>{user.email}</div>
        <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>{user.grantedAt ? 'Granted: ' + formatTime(user.grantedAt) : 'Requested: ' + formatTime(user.requestedAt)}</div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>{children}</div>
    </div>
  );
}

const LOG_COLORS = { user_login: '#22c55e', user_logout: '#888', access_requested: '#f59e0b', access_changed: '#3D95CE', slide_added: '#22c55e', slide_edited: '#3D95CE', slide_deleted: '#ef4444', default_set: '#f59e0b', settings_saved: '#888', login_blocked: '#ef4444' };

function LogRow({ log }) {
  const color = LOG_COLORS[log.action] || '#888';
  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '.04em' }}>{log.action?.replace(/_/g, ' ')}</span>
        <span style={{ fontSize: 10, color: '#bbb', marginLeft: 'auto' }}>{formatTime(log.timestamp)}</span>
      </div>
      <div style={{ fontSize: 12, color: '#555' }}>
        {log.email || 'anonymous'}{log.details ? <span style={{ color: '#888' }}> — {log.details}</span> : ''}
      </div>
    </div>
  );
}

function PendingRow({ req, employees, onGrant }) {
  const [role,     setRole]     = useState('readonly');
  const [techName, setTechName] = useState('');
  const [saving,   setSaving]   = useState(false);
  const sel = { fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', fontFamily: 'inherit' };

  async function submit() {
    setSaving(true);
    try { await onGrant(role, role === 'tech' ? techName : undefined); }
    finally { setSaving(false); }
  }

  return (
    <UserRow user={req}>
      <select value={role} onChange={e => setRole(e.target.value)} style={sel}>
        <option value="readonly">Read only</option>
        <option value="tech">Tech</option>
        <option value="admin">Admin</option>
      </select>
      {role === 'tech' && (
        <select value={techName} onChange={e => setTechName(e.target.value)} style={sel}>
          <option value="">Assign tech…</option>
          {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
        </select>
      )}
      <Btn color="#3D95CE" onClick={submit} disabled={saving || (role === 'tech' && !techName)}>
        {saving ? '…' : 'Grant'}
      </Btn>
      <Btn color="#ef4444" onClick={() => onGrant('denied')} disabled={saving}>Deny</Btn>
    </UserRow>
  );
}

function RoleBadge({ role }) {
  const colors = { admin: ['rgba(61,149,206,.15)', '#3D95CE'], readonly: ['rgba(34,197,94,.15)', '#16a34a'], tech: ['rgba(245,158,11,.15)', '#d97706'], pending: ['rgba(245,158,11,.15)', '#d97706'], denied: ['rgba(239,68,68,.15)', '#ef4444'] };
  const [bg, fg] = colors[role] || ['#eee', '#888'];
  return <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 20, letterSpacing: '.04em', textTransform: 'uppercase', background: bg, color: fg }}>{role}</span>;
}

function Btn({ onClick, color, children }) {
  return (
    <button onClick={onClick} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: 'none', background: color || '#e8e8e8', color: color ? '#fff' : '#666', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <div style={{ padding: 16, textAlign: 'center', color: '#bbb', fontSize: 13 }}>{children}</div>;
}

function DemoSeedSection() {
  const [status,  setStatus]  = useState('');
  const [running, setRunning] = useState(false);
  const [phase,   setPhase]   = useState('idle');

  async function runSeed() {
    if (!confirm('Populate with 500 regular + 100 celebrity clients and ~1,200 appointments (3 months past + future). Takes 10–15 min. Continue?')) return;
    setRunning(true); setPhase('idle'); setStatus('');
    try {
      await seedDemoData(msg => setStatus(msg));
      setPhase('seeded');
    } catch (e) {
      setStatus('Error: ' + e.message); setPhase('error');
    } finally { setRunning(false); }
  }

  async function runAddFuture() {
    setRunning(true); setPhase('idle'); setStatus('');
    try {
      const result = await addFutureAppointments(msg => setStatus(msg));
      setStatus(`Added ${result.appointments} appointments for month 4.`);
      setPhase('seeded');
    } catch (e) {
      setStatus('Error: ' + e.message); setPhase('error');
    } finally { setRunning(false); }
  }

  async function runClear() {
    if (!confirm('Permanently delete all demo clients and appointments?')) return;
    setRunning(true); setPhase('idle'); setStatus('');
    try {
      const result = await clearDemoData(msg => setStatus(msg));
      setStatus(`Removed ${result.clients} clients and ${result.appointments} appointments.`);
      setPhase('cleared');
    } catch (e) {
      setStatus('Error: ' + e.message); setPhase('error');
    } finally { setRunning(false); }
  }

  const busy = running && phase === 'idle';

  return (
    <Section title="🧪 Demo Data">
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 10 }}>
          Seed 500 regular + 100 celebrity clients with 3 months of appointments, or top-up with an extra month of future bookings without re-seeding.
        </div>
        {status && (
          <div style={{ fontSize: 12, color: phase === 'error' ? '#ef4444' : phase === 'cleared' || phase === 'seeded' ? '#16a34a' : '#888', marginBottom: 10, fontStyle: 'italic' }}>
            {status}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn color="#f59e0b" onClick={runSeed} disabled={running}>
            {busy ? 'Running…' : '↓ Seed Demo Data'}
          </Btn>
          <Btn color="#3D95CE" onClick={runAddFuture} disabled={running}>
            {busy ? 'Running…' : '+ Add 1 Month Future'}
          </Btn>
          <Btn color="#ef4444" onClick={runClear} disabled={running}>
            {busy ? 'Removing…' : '× Remove All Demo'}
          </Btn>
        </div>
      </div>
    </Section>
  );
}
