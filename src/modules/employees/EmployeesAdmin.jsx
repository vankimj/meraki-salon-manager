import { useState, useEffect, useRef } from 'react';
import { fetchEmployees, fetchEmployeesWithComp, createEmployee, saveEmployee, deleteEmployee, employeesExist, fetchServices } from '../../lib/firestore';
import TrashButton from '../../components/TrashButton';
import { TENANT_ID } from '../../lib/tenant';
import RestoreFromBQModal from '../../components/RestoreFromBQModal';
import { resizeImg } from '../../utils/helpers';
import { SEED_EMPLOYEES } from '../../data/seedEmployees';
import { useApp } from '../../context/AppContext';
import { logActivity, logError } from '../../lib/logger';
import EmptyState from '../../components/EmptyState';


const WORK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_WORK_DAY = { on: true, start: '09:00', end: '18:00' };

function blankEmployee() {
  return {
    name: '', photo: '', active: true, sortOrder: 0, notes: '',
    extendedHoursAllowed: false,
    phone: '', email: '',
    address: '', city: '', state: '', zip: '',
    tin: '',
    instagram: '', facebook: '', tiktok: '', venmo: '', homepage: '',
    rateType: 'commission', commissionPct: '', hourlyRate: '',
    paymentPref: 'cash', paymentNotes: '',
    workDays: {},
    serviceIds: [],
    serviceDurations: {},
    servicePrices: {},
  };
}

export default function EmployeesAdmin() {
  const { isAdmin, showToast, settings, updateSettings } = useApp();
  const [employees, setEmployees] = useState([]);
  const [services,  setServices]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [editing,   setEditing]   = useState(null);
  const [viewing,   setViewing]   = useState(null);
  const [seeding,   setSeeding]   = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      // Admin view needs comp data merged in; fetchEmployeesWithComp pulls
      // the private/comp sub-doc per employee and merges. Non-admin staff
      // who somehow reach this page would silently get the public-only
      // shape (sub-doc reads fail closed under the rule).
      const [emps, svcs] = await Promise.all([fetchEmployeesWithComp(), fetchServices()]);
      setEmployees(emps);
      setServices(svcs.filter(s => s.active !== false));
    }
    catch (e) { console.error('[Employees] load failed:', e); }
    finally { setLoading(false); }
  }

  async function handleSave(emp) {
    try {
      if (emp.id) {
        const { id, createdAt, ...data } = emp;
        await saveEmployee(id, data);
        logActivity('employee_updated', emp.name);
      } else {
        await createEmployee({ ...emp, sortOrder: employees.length });
        logActivity('employee_created', emp.name);
      }
      await load();
      setEditing(null);
    } catch (e) {
      console.error('[Employees] save failed:', e);
      showToast('Save failed — ' + (e.message || 'unknown error'), 4000);
    }
  }

  async function handleDelete(emp) {
    if (!confirm(`Remove ${emp.name} from the team?`)) return;
    await deleteEmployee(emp.id);
    logActivity('employee_deleted', emp.name);
    setEmployees(es => es.filter(e => e.id !== emp.id));
  }

  async function handleToggleActive(emp) {
    await saveEmployee(emp.id, { ...emp, active: !emp.active });
    logActivity(emp.active ? 'employee_deactivated' : 'employee_activated', emp.name);
    setEmployees(es => es.map(e => e.id === emp.id ? { ...e, active: !e.active } : e));
  }

  async function handleSendInvite(emp) {
    if (!emp.email) {
      showToast('Add an email to this employee first', 3000);
      return;
    }
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../lib/firebase');
      await httpsCallable(functions, 'emailEmployeeInvite')({ tenantId: TENANT_ID, employeeId: emp.id });
      logActivity('employee_invite_sent', `${emp.name} → ${emp.email}`);
      showToast(`Invite sent to ${emp.email}`);
      // Optimistic update so the badge flips locally
      setEmployees(es => es.map(e => e.id === emp.id ? { ...e, inviteSentAt: new Date().toISOString(), inviteSentTo: emp.email } : e));
    } catch (e) {
      showToast(`Could not send invite: ${e.message || 'unknown error'}`, 4000);
    }
  }

  async function seedEmployees() {
    setSeeding(true);
    try {
      const exists = await employeesExist();
      if (exists && !confirm('This will add the default staff list. Continue?')) { setSeeding(false); return; }
      for (const emp of SEED_EMPLOYEES) await createEmployee(emp);
      await load();
    } catch (e) { console.error('[Employees] seed failed:', e); }
    finally { setSeeding(false); }
  }

async function assignAllServicesToAll() {
    if (!confirm(`Mark every employee as able to perform all ${services.length} services? You can fine-tune individual techs after.`)) return;
    const allIds = services.map(s => s.id);
    try {
      for (const emp of employees) {
        await saveEmployee(emp.id, { ...emp, serviceIds: allIds });
      }
      logActivity('employees_services_bulk_set', `${employees.length} techs → ${allIds.length} services`);
      showToast(`Assigned all services to ${employees.length} techs`);
      await load();
    } catch (e) {
      console.error('[Employees] bulk service assign failed:', e);
      showToast('Bulk update failed — ' + (e.message || 'unknown'), 4000);
    }
  }

  if (loading) return <Empty>Loading…</Empty>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, fontSize: 13, color: 'var(--pn-text-muted)' }}>{employees.length} team member{employees.length !== 1 ? 's' : ''}</div>
        {employees.length === 0 && (
          <Btn onClick={seedEmployees} disabled={seeding} color="#f59e0b">
            {seeding ? 'Adding…' : '↺ Seed from defaults'}
          </Btn>
        )}
        <TrashButton collections={['employees']} scope="Employees" />
        <Btn color="#3D95CE" onClick={() => setEditing(blankEmployee())}>+ Add</Btn>
      </div>

      {employees.length === 0 ? (
        <EmptyState
          icon="💇"
          title="Add your team"
          description="Each tech / stylist / barber gets a profile here — name, photo, services they perform, and (admin-only) compensation. The schedule renders one column per active employee."
          actions={[
            { label: '+ Add an employee',  onClick: () => setEditing(blankEmployee()) },
            { label: '↺ Use sample staff', onClick: seedEmployees },
          ]}
        />
      ) : (
        <div style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', overflow: 'hidden' }}>
          {employees.map((emp, i) => (
            <EmployeeRow
              key={emp.id}
              emp={emp}
              totalServices={services.length}
              last={i === employees.length - 1}
              onView={() => setViewing({ ...emp })}
              onEdit={() => setEditing({ ...emp })}
              onDelete={() => handleDelete(emp)}
              onToggleActive={() => handleToggleActive(emp)}
              onSendInvite={() => handleSendInvite(emp)}
            />
          ))}
        </div>
      )}

      {editing && (
        <EmployeeModal
          emp={editing}
          services={services}
          isAdmin={isAdmin}
          onChange={patch => setEditing(e => ({ ...e, ...patch }))}
          onSave={() => handleSave(editing)}
          onClose={() => setEditing(null)}
          onReload={load}
        />
      )}
      {viewing && (
        <EmployeeModal
          viewOnly
          emp={viewing}
          services={services}
          isAdmin={isAdmin}
          onChange={() => {}}
          onSave={() => {}}
          onClose={() => setViewing(null)}
          onSwitchToEdit={() => { setEditing({ ...viewing }); setViewing(null); }}
          onReload={load}
        />
      )}
    </div>
  );
}

function EmployeeRow({ emp, totalServices, last, onView, onEdit, onDelete, onToggleActive, onSendInvite }) {
  const svcCount = emp.serviceIds?.length || 0;
  const svcConfigured = svcCount > 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: last ? 'none' : '1px solid var(--pn-border)', opacity: emp.active ? 1 : .5 }}>
      <button onClick={onView}
        title="View profile"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
        <EmpAvatar emp={emp} size={40} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>
          <button onClick={onView}
            title="View profile"
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
            {emp.name}
          </button>
          {!emp.active && <span style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginLeft: 6, fontWeight: 400 }}>inactive</span>}
          {totalServices > 0 && (
            <span title={svcConfigured ? `Performs ${svcCount} of ${totalServices} services` : 'No services configured — defaults to all services'}
              style={{ fontSize: 10, marginLeft: 8, padding: '1px 7px', borderRadius: 10, fontWeight: 600, background: svcConfigured ? 'var(--pn-info-bg)' : 'var(--pn-warning-bg)', color: svcConfigured ? 'var(--pn-info)' : 'var(--pn-warning)', border: `1px solid ${svcConfigured ? '#bfdbfe' : '#fde68a'}` }}>
              {svcConfigured ? `${svcCount} svc` : 'all svc (default)'}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 1 }}>
          {[emp.phone, emp.email].filter(Boolean).join(' · ') || (emp.instagram ? emp.instagram : 'No contact info')}
        </div>
        {(emp.venmo || emp.instagram || emp.facebook || emp.tiktok) && (
          <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 1 }}>
            {[emp.venmo && `💸 ${emp.venmo}`, emp.instagram && `📸 ${emp.instagram}`, emp.facebook && `👥 ${emp.facebook}`, emp.tiktok && `🎵 ${emp.tiktok}`].filter(Boolean).join('  ')}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {emp.email && onSendInvite && (
          <button onClick={onSendInvite}
            title={emp.inviteSentAt ? `Resend sign-in link (last sent ${new Date(emp.inviteSentAt).toLocaleDateString()})` : 'Send sign-in invite to this employee'}
            style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid #d8d0e8', background: emp.inviteSentAt ? '#f3eafc' : 'var(--pn-surface)', color: '#5b3b8c', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            {emp.inviteSentAt ? '↻ Resend' : '📨 Invite'}
          </button>
        )}
        <button onClick={onToggleActive} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: emp.active ? 'var(--pn-success-bg)' : 'var(--pn-surface-muted)', color: emp.active ? 'var(--pn-success)' : 'var(--pn-text-faint)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
          {emp.active ? 'Active' : 'Inactive'}
        </button>
        <Btn onClick={onEdit}>Edit</Btn>
        <Btn color="#ef4444" onClick={onDelete}>Del</Btn>
      </div>
    </div>
  );
}

function EmployeeModal({ emp, services, isAdmin, onChange, onSave, onClose, viewOnly = false, onSwitchToEdit, onReload }) {
  const { showToast, users, grantAccess } = useApp();
  const [tab,    setTab]    = useState('profile');
  const [saving, setSaving] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const fileRef = useRef(null);
  const isNew   = !emp.id;

  // Find the user record linked to this employee (by techName or by email)
  // so the Schedule tab can mirror the per-tech "Can edit / View only"
  // toggle that lives canonically in Admin → Users. Both surfaces edit
  // the same `scheduleAccess` field on the user record so there's no
  // drift between them.
  const linkedUser = users?.find(u =>
    (u.techName && emp.name && u.techName.toLowerCase() === emp.name.toLowerCase()) ||
    (u.email && emp.email && u.email.toLowerCase() === emp.email.toLowerCase())
  ) || null;
  function setScheduleAccess(next) {
    if (!linkedUser) return;
    grantAccess(linkedUser.email, linkedUser.role, linkedUser.techName, next);
    showToast?.(next === 'view' ? `${emp.name} can now only view their schedule` : `${emp.name} can now edit their schedule`);
  }
  const TABS    = isAdmin
    ? ['profile', 'contact', 'social', 'schedule', 'services', 'compensation']
    : ['profile', 'contact', 'social', 'schedule', 'services'];

  function patchWorkDay(day, patch) {
    const current = emp.workDays?.[day] ?? DEFAULT_WORK_DAY;
    onChange({ workDays: { ...(emp.workDays || {}), [day]: { ...current, ...patch } } });
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { onChange({ photo: await resizeImg(file, 300, 300, 0.82) }); }
    catch (err) {
      logError('employee_photo', err, { fileType: file.type, fileSize: file.size });
      showToast(`Could not process photo (${file.type || 'unknown'})`, 5000);
    }
  }

  async function submit() {
    if (!emp.name?.trim()) return;
    setSaving(true);
    try { await onSave(); } finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 440, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{isNew ? 'New Employee' : viewOnly ? (emp.name || 'Employee') : 'Edit Employee'}</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '9px 0', fontSize: 12, fontWeight: tab === t ? 600 : 400, color: tab === t ? '#3D95CE' : 'var(--pn-text-muted)', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #3D95CE' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>

        {/* Body — `fieldset disabled` flips every nested input/select/textarea/
            button into the readOnly variant in one line, so view-mode doesn't
            require touching each form control. Tab buttons live OUTSIDE the
            fieldset so the user can still switch tabs while viewing. */}
        <fieldset disabled={viewOnly} style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', border: 'none', margin: 0, minWidth: 0 }}>

          {/* ── Profile ── */}
          {tab === 'profile' && (
            <>
              <div style={{ display: 'flex', gap: 14, marginBottom: 14, alignItems: 'flex-start' }}>
                <div style={{ flexShrink: 0 }}>
                  <div onClick={viewOnly ? undefined : () => fileRef.current?.click()} style={{ width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', background: 'var(--pn-surface-alt)', cursor: viewOnly ? 'default' : 'pointer', border: '2px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {emp.photo
                      ? <img src={emp.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <EmpAvatar emp={emp} size={72} />
                    }
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', textAlign: 'center', marginTop: 3, cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>photo</div>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handlePhoto} />
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Full name *">
                    <input value={emp.name} onChange={e => onChange({ name: e.target.value })} placeholder="Jane Smith" style={{ ...inp, borderColor: emp.name?.trim() ? undefined : '#fca5a5' }} autoFocus />
                  </Field>
                  <Field label="Login email *">
                    <input type="email" value={emp.email || ''} onChange={e => onChange({ email: e.target.value })} placeholder="jane@example.com" style={{ ...inp, borderColor: emp.email?.trim() ? undefined : '#fca5a5' }} />
                  </Field>
                  <Field label="Sort order" style={{ marginBottom: 0 }}>
                    <input type="number" min={0} value={emp.sortOrder ?? 0} onChange={e => onChange({ sortOrder: Number(e.target.value) })} style={{ ...inp, width: 80 }} />
                  </Field>
                </div>
              </div>

              <Field label="Notes / bio">
                <textarea value={emp.notes || ''} onChange={e => onChange({ notes: e.target.value })} rows={3}
                  placeholder="Specialties, bio, anything to note…" style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
              </Field>

              <label style={{ fontSize: 12, color: 'var(--pn-text-muted)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                <input type="checkbox" checked={!!emp.active} onChange={e => onChange({ active: e.target.checked })} />
                Active (shows on schedule & tip flow)
              </label>
              <label style={{ fontSize: 12, color: 'var(--pn-text-muted)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 8 }}>
                <input type="checkbox" checked={!!emp.extendedHoursAllowed} onChange={e => onChange({ extendedHoursAllowed: e.target.checked })} />
                Available during appointment-only hours
              </label>

              {/* ── Notifications (per-tech reminder prefs) ────────────
                  Tenant-wide on/off switch lives in Admin → Settings →
                  Tech Appointment Reminders. These three fields let each
                  tech tune timing / channel / opt-out individually.
                  Server-side `sendTechAppointmentReminders` reads these
                  with fallback defaults: 15 min before, email. */}
              <div style={{ marginTop: 18, padding: '12px 14px', background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>🔔 Notifications</div>
                <label style={{ fontSize: 12, color: 'var(--pn-text-muted)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!emp.techReminderOptOut}
                    onChange={e => onChange({ techReminderOptOut: e.target.checked })} />
                  Opt out of appointment reminders
                </label>
                {!emp.techReminderOptOut && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4 }}>Lead time</div>
                      <select value={emp.techReminderLeadMinutes ?? 15}
                        onChange={e => onChange({ techReminderLeadMinutes: Number(e.target.value) })}
                        style={{ ...inp, padding: '7px 10px' }}>
                        {[5, 10, 15, 20, 30, 45, 60].map(n => (
                          <option key={n} value={n}>{n} min before</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4 }}>Channel</div>
                      <select value={emp.techReminderChannel || 'email'}
                        onChange={e => onChange({ techReminderChannel: e.target.value })}
                        style={{ ...inp, padding: '7px 10px' }}>
                        <option value="email">Email</option>
                        <option value="sms">SMS</option>
                        <option value="push">Push (mobile app)</option>
                        <option value="email+push">Email + Push</option>
                        <option value="sms+push">SMS + Push</option>
                        <option value="email+sms">Email + SMS</option>
                        <option value="all">All three</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Contact ── */}
          {tab === 'contact' && (
            <>
              <Field label="Phone">
                <input value={emp.phone || ''} onChange={e => onChange({ phone: e.target.value })} placeholder="(555) 000-0000" style={inp} />
              </Field>
              <Field label="Email">
                <input type="email" value={emp.email || ''} onChange={e => onChange({ email: e.target.value })} placeholder="jane@example.com" style={inp} />
              </Field>
              <Field label="Street address">
                <input value={emp.address || ''} onChange={e => onChange({ address: e.target.value })} placeholder="123 Main St" style={inp} />
              </Field>
              <div style={{ display: 'flex', gap: 10 }}>
                <Field label="City" style={{ flex: 2 }}>
                  <input value={emp.city || ''} onChange={e => onChange({ city: e.target.value })} placeholder="Columbus" style={inp} />
                </Field>
                <Field label="State" style={{ flex: 1 }}>
                  <input value={emp.state || ''} maxLength={2} onChange={e => onChange({ state: e.target.value.toUpperCase() })} placeholder="OH" style={inp} />
                </Field>
                <Field label="ZIP" style={{ flex: 1 }}>
                  <input value={emp.zip || ''} maxLength={10} onChange={e => onChange({ zip: e.target.value })} placeholder="43214" style={inp} />
                </Field>
              </div>
              <Field label="Taxpayer ID (TIN / SSN)">
                <input value={emp.tin || ''} onChange={e => onChange({ tin: e.target.value })}
                  placeholder="XXX-XX-XXXX or XX-XXXXXXX" style={inp} />
                <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 4 }}>
                  Used on the contractor's 1099-NEC summary. Stored encrypted at rest by Firestore.
                </div>
              </Field>
            </>
          )}

          {/* ── Schedule ── */}
          {tab === 'schedule' && (
            <>
              {/* Per-tech schedule edit permission — mirror of the toggle
                  in Admin → Users. Only meaningful for tech-role users;
                  for everyone else (admin/scheduler/readonly) we show a
                  soft hint instead. */}
              {isAdmin && (
                <div style={{ background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
                    Schedule access (when this tech logs in)
                  </div>
                  {!linkedUser ? (
                    <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.5 }}>
                      No app access yet for this employee. Grant access from <strong>Admin → Users</strong> first; the toggle will appear here once they're a tech-role user.
                    </div>
                  ) : linkedUser.role !== 'tech' ? (
                    <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.5 }}>
                      This employee logs in as <strong>{linkedUser.role}</strong>. Schedule edit permission only applies to tech-role users — admins and schedulers can already edit any schedule.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[['edit', 'Can edit own schedule', '#2D7A5F'], ['view', 'View only', '#888']].map(([v, label, color]) => {
                        const active = (linkedUser.scheduleAccess || 'edit') === v;
                        return (
                          <button key={v} onClick={() => setScheduleAccess(v)}
                            style={{
                              flex: 1, minWidth: 160, padding: '8px 12px', borderRadius: 8,
                              border: `1.5px solid ${active ? color : 'var(--pn-border)'}`,
                              background: active ? (v === 'edit' ? '#f0fdf4' : 'var(--pn-surface-muted)') : 'var(--pn-surface)',
                              color: active ? color : 'var(--pn-text-muted)',
                              fontSize: 12, fontWeight: active ? 700 : 500,
                              cursor: 'pointer', fontFamily: 'inherit',
                              textAlign: 'left',
                            }}>
                            <div>{active ? '✓ ' : ''}{label}</div>
                            <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--pn-text-faint)', marginTop: 2 }}>
                              {v === 'edit' ? 'Add, move, edit appointments on their own day' : 'Read-only schedule view, no edits'}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 8, lineHeight: 1.5 }}>
                    Saves immediately. Also editable at <strong>Admin → Users</strong> — both surfaces edit the same field.
                  </div>
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
                Days marked off are grayed out in the schedule view.
              </div>
              {WORK_DAYS.map(day => {
                const d = emp.workDays?.[day] ?? DEFAULT_WORK_DAY;
                return (
                  <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 34, fontSize: 13, fontWeight: 500, color: d.on ? 'var(--pn-text)' : 'var(--pn-text-faint)' }}>{day}</div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--pn-text-muted)', cursor: 'pointer', userSelect: 'none', minWidth: 48 }}>
                      <input type="checkbox" checked={d.on} onChange={e => patchWorkDay(day, { on: e.target.checked })} />
                      {d.on ? 'On' : 'Off'}
                    </label>
                    {d.on ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                        <input type="time" value={d.start} onChange={e => patchWorkDay(day, { start: e.target.value })}
                          style={{ fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '4px 6px', fontSize: 12 }} />
                        <span style={{ color: 'var(--pn-text-faint)', fontSize: 12 }}>–</span>
                        <input type="time" value={d.end} onChange={e => patchWorkDay(day, { end: e.target.value })}
                          style={{ fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '4px 6px', fontSize: 12 }} />
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginLeft: 'auto' }}>not working</span>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* ── Services this tech can perform ── */}
          {tab === 'services' && (
            <ServicesPicker
              services={services}
              selectedIds={emp.serviceIds || []}
              onChange={ids => onChange({ serviceIds: ids })}
              durations={emp.serviceDurations || {}}
              onDurationsChange={map => onChange({ serviceDurations: map })}
              prices={emp.servicePrices || {}}
              onPricesChange={map => onChange({ servicePrices: map })}
            />
          )}

          {/* ── Compensation (admin-only) ── */}
          {tab === 'compensation' && (
            <>
              <Field label="Rate type">
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['commission', 'Commission'], ['hourly', 'Hourly'], ['both', 'Both']].map(([v, l]) => (
                    <button key={v} onClick={() => onChange({ rateType: v })}
                      style={{ flex: 1, padding: '7px 4px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1.5px solid ${emp.rateType === v ? '#3D95CE' : 'var(--pn-border)'}`, background: emp.rateType === v ? 'var(--pn-info-bg)' : 'var(--pn-bg)', color: emp.rateType === v ? 'var(--pn-info)' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </Field>

              {(emp.rateType === 'commission' || emp.rateType === 'both') && (
                <Field label="Commission %">
                  <input type="number" min={0} max={100} value={emp.commissionPct || ''} onChange={e => onChange({ commissionPct: e.target.value })} placeholder="e.g. 40" style={inp} />
                </Field>
              )}

              {(emp.rateType === 'hourly' || emp.rateType === 'both') && (
                <Field label="Hourly rate ($)">
                  <input type="number" min={0} value={emp.hourlyRate || ''} onChange={e => onChange({ hourlyRate: e.target.value })} placeholder="e.g. 15.00" style={inp} />
                </Field>
              )}

              <Field label="Payment preference">
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['cash', 'Cash'], ['check', 'Check'], ['direct_deposit', 'Direct Deposit']].map(([v, l]) => (
                    <button key={v} onClick={() => onChange({ paymentPref: v })}
                      style={{ flex: 1, padding: '7px 4px', fontSize: 11, fontWeight: 600, borderRadius: 8, border: `1.5px solid ${emp.paymentPref === v ? '#2D7A5F' : 'var(--pn-border)'}`, background: emp.paymentPref === v ? 'var(--pn-success-bg)' : 'var(--pn-bg)', color: emp.paymentPref === v ? 'var(--pn-success)' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Tax ID / SSN (for 1099)">
                <input value={emp.taxId || ''} onChange={e => onChange({ taxId: e.target.value })} placeholder="XXX-XX-XXXX"
                  style={inp} />
              </Field>

              <Field label="Payment notes (banking info, instructions)">
                <textarea value={emp.paymentNotes || ''} onChange={e => onChange({ paymentNotes: e.target.value })} rows={3}
                  placeholder="Routing #, account #, Venmo handle, etc." style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
              </Field>

              {/* Time-clock PIN — admin-only kiosk credential. Stored as
                  scrypt(salt+pin) server-side; the UI only ever sees a
                  hash-set flag, never the digits themselves. */}
              {!isNew && (
                <TimeClockPinSection emp={emp} onPinChanged={onReload} showToast={showToast} />
              )}
            </>
          )}

          {/* ── Social ── */}
          {tab === 'social' && (
            <>
              {[
                { key: 'venmo',     label: '💸 Venmo',     prefix: '@', placeholder: 'username' },
                { key: 'instagram', label: '📸 Instagram', prefix: '@', placeholder: 'username' },
                { key: 'facebook',  label: '👥 Facebook',  prefix: '',  placeholder: 'username or profile URL' },
                { key: 'tiktok',    label: '🎵 TikTok',    prefix: '@', placeholder: 'username' },
                { key: 'homepage',  label: '🔗 Homepage',  prefix: '',  placeholder: 'https://…' },
              ].map(({ key, label, prefix, placeholder }) => (
                <Field key={key} label={label}>
                  {prefix ? (
                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--pn-border-strong)', borderRadius: 8, background: 'var(--pn-bg)', overflow: 'hidden' }}>
                      <span style={{ padding: '8px 0 8px 12px', fontSize: 14, fontWeight: 500, color: 'var(--pn-text-faint)', userSelect: 'none' }}>{prefix}</span>
                      <input value={emp[key] || ''} onChange={e => onChange({ [key]: e.target.value })} placeholder={placeholder}
                        style={{ flex: 1, border: 'none', background: 'transparent', padding: '8px 12px 8px 3px', fontSize: 13, color: 'var(--pn-text)', outline: 'none', fontFamily: 'inherit' }} />
                    </div>
                  ) : (
                    <input value={emp[key] || ''} onChange={e => onChange({ [key]: e.target.value })} placeholder={placeholder} style={inp} />
                  )}
                </Field>
              ))}
            </>
          )}
        </fieldset>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--pn-border)', display: 'flex', gap: 8, flexShrink: 0 }}>
          {viewOnly ? (
            <>
              <button onClick={onClose} style={{ flex: 1, ...btnBase }}>Close</button>
              {!isNew && isAdmin && (
                <button onClick={() => setRestoreOpen(true)}
                  title="Restore an earlier version of this employee from the BigQuery mirror"
                  style={{ ...btnBase, padding: '8px 12px', fontSize: 12, color: 'var(--pn-text-muted)' }}>
                  ⏳ History
                </button>
              )}
              {onSwitchToEdit && (
                <button onClick={onSwitchToEdit}
                  style={{ flex: 2, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE' }}>
                  Edit
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={onClose} style={{ flex: 1, ...btnBase }}>Cancel</button>
              <button onClick={submit} disabled={saving || !emp.name?.trim()}
                style={{ flex: 2, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE', opacity: (saving || !emp.name?.trim()) ? .6 : 1 }}>
                {saving ? 'Saving…' : isNew ? 'Add Employee' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>
      {restoreOpen && emp.id && (
        <RestoreFromBQModal
          collection="employees"
          docId={emp.id}
          label={emp.name}
          onClose={() => setRestoreOpen(false)}
          onRestored={async () => { setRestoreOpen(false); await onReload?.(); onClose(); }}
        />
      )}
    </div>
  );
}

function ServicesPicker({ services, selectedIds, onChange, durations = {}, onDurationsChange, prices = {}, onPricesChange }) {
  const isAll = !selectedIds || selectedIds.length === 0;
  const grouped = {};
  services.forEach(s => {
    const cat = s.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(s);
  });

  function toggle(id) {
    const set = new Set(selectedIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    onChange(Array.from(set));
  }
  function selectAll() { onChange(services.map(s => s.id)); }
  function clearAll()  { onChange([]); }

  // Per-tech override minutes. Empty/0/invalid clears the override (falls
  // back to the service's base duration). Only stores explicit overrides.
  function setDuration(id, raw) {
    const next = { ...durations };
    const n = Math.round(Number(raw));
    if (raw === '' || !Number.isFinite(n) || n <= 0) delete next[id];
    else next[id] = n;
    onDurationsChange?.(next);
  }

  // Per-tech price override (dollars). Empty/invalid/negative clears it (falls
  // back to the service's standard price). $0 is a valid override (comp/free).
  function setPrice(id, raw) {
    const next = { ...prices };
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n) || n < 0) delete next[id];
    else next[id] = n;
    onPricesChange?.(next);
  }

  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
        Pick which services this tech can perform, and optionally set how long <em>this tech</em> takes ($ and minutes) per service.
        Leave a field blank to use the service's standard price / time. {isAll && <strong style={{ color: '#16a34a' }}>No services checked = can do every service.</strong>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={selectAll} style={{ ...btnBase, fontSize: 11, padding: '5px 10px' }}>Select all</button>
        <button onClick={clearAll}  style={{ ...btnBase, fontSize: 11, padding: '5px 10px' }}>Clear all</button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--pn-text-faint)', alignSelf: 'center' }}>
          {isAll ? 'all' : `${selectedIds.length} of ${services.length}`}
        </div>
      </div>
      {services.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', padding: 16, textAlign: 'center' }}>No services configured yet.</div>
      ) : Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 6, letterSpacing: '.04em', textTransform: 'uppercase' }}>{cat}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6 }}>
            {items.map(s => {
              const checked = selectedIds.includes(s.id);
              const canDo   = isAll || checked;
              const override = durations[s.id];
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px', borderRadius: 8, border: `1px solid ${checked ? '#3D95CE' : 'var(--pn-border)'}`, background: checked ? 'var(--pn-info-bg)' : 'var(--pn-bg)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit', flex: 1, minWidth: 0 }}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(s.id)} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: checked ? 'var(--pn-info)' : 'var(--pn-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  </label>
                  {canDo && (() => {
                    const priceOverride = prices[s.id];
                    const stdPrice = s.basePrice ?? s.price ?? 0;
                    return (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                        <span style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>$</span>
                        <input
                          type="number" min={0} step="0.01" inputMode="decimal"
                          value={priceOverride ?? ''}
                          onChange={e => setPrice(s.id, e.target.value)}
                          placeholder={String(stdPrice)}
                          title={`Standard: $${stdPrice}`}
                          style={{ width: 52, fontFamily: 'inherit', border: `1px solid ${priceOverride != null ? '#3D95CE' : 'var(--pn-border-strong)'}`, borderRadius: 6, padding: '3px 5px', fontSize: 11, textAlign: 'right', color: 'var(--pn-text)', background: 'var(--pn-surface)', outline: 'none' }}
                        />
                        <input
                          type="number" min={1} inputMode="numeric"
                          value={override ?? ''}
                          onChange={e => setDuration(s.id, e.target.value)}
                          placeholder={String(s.duration ?? '')}
                          title={`Standard: ${s.duration ?? '?'} min`}
                          style={{ width: 46, fontFamily: 'inherit', border: `1px solid ${override ? '#3D95CE' : 'var(--pn-border-strong)'}`, borderRadius: 6, padding: '3px 5px', fontSize: 11, textAlign: 'right', color: 'var(--pn-text)', background: 'var(--pn-surface)', outline: 'none' }}
                        />
                        <span style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>min</span>
                      </span>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

function EmpAvatar({ emp, size = 36 }) {
  const [err, setErr] = useState(false);
  const photo = emp.photo || '';
  if (photo && !err) {
    return <img src={photo} alt="" onError={() => setErr(true)} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, display: 'block' }} />;
  }
  const initials = emp.name?.trim().split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const colors   = ['#4A7DB5', '#2D7A5F', '#B57A4A', '#7A4AB5', '#B54A7A', '#3D95CE', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6'];
  const bg       = colors[emp.name?.charCodeAt(0) % colors.length] || '#888';
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.33, fontWeight: 600, color: '#fff' }}>
      {initials}
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

function Btn({ onClick, color, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none', background: color || 'var(--pn-surface-muted)', color: color ? '#fff' : 'var(--pn-text-muted)', cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 500, opacity: disabled ? .6 : 1 }}>
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <div style={{ padding: 20, textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 13 }}>{children}</div>;
}

const inp     = { fontFamily: 'inherit', width: '100%', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 11px', fontSize: 13, color: 'var(--pn-text)', outline: 'none', background: 'var(--pn-bg)', boxSizing: 'border-box' };
const btnBase = { fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'var(--pn-surface)', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 14px', color: 'var(--pn-text)' };

// Export EmpAvatar for use in SlideModal
export { EmpAvatar };

// Inline PIN management for the EmployeeModal → Compensation tab. Three
// visual states (set / unset / editing) with the callable hidden behind a
// thin wrapper so a parse-failure-on-deploy can't blow up the modal.
// PIN itself never leaves the browser as anything other than the request
// body — setEmployeePin scrypt-hashes server-side.
function TimeClockPinSection({ emp, onPinChanged, showToast }) {
  const [editing, setEditing] = useState(false);
  const [pin,     setPin]     = useState('');
  const [saving,  setSaving]  = useState(false);
  const [working, setWorking] = useState(false); // for Clear
  const hasPin = !!emp.pinHash;

  async function callable(name, payload) {
    const { httpsCallable } = await import('firebase/functions');
    const { functions }     = await import('../../lib/firebase');
    return httpsCallable(functions, name)(payload);
  }

  async function save() {
    const clean = String(pin || '').trim();
    if (!/^\d{4}$/.test(clean)) {
      showToast?.('PIN must be exactly 4 digits');
      return;
    }
    setSaving(true);
    try {
      await callable('setEmployeePin', { tenantId: TENANT_ID, employeeId: emp.id, pin: clean });
      showToast?.(`PIN saved for ${emp.name}`);
      setEditing(false);
      setPin('');
      onPinChanged && onPinChanged();
    } catch (e) {
      showToast?.(`Could not save PIN: ${e.message || e.code}`, 5000);
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirm(`Clear ${emp.name}'s time clock PIN? They won't be able to clock in from the kiosk until a new PIN is set.`)) return;
    setWorking(true);
    try {
      await callable('clearEmployeePin', { tenantId: TENANT_ID, employeeId: emp.id });
      showToast?.(`PIN cleared for ${emp.name}`);
      onPinChanged && onPinChanged();
    } catch (e) {
      showToast?.(`Could not clear PIN: ${e.message || e.code}`, 5000);
    } finally {
      setWorking(false);
    }
  }

  return (
    <Field label="🕐 Time clock PIN">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 8 }}>
        {!editing && (
          <>
            <div style={{ flex: 1, fontSize: 12, color: hasPin ? '#166534' : 'var(--pn-text-faint)' }}>
              {hasPin ? '✓ PIN set' : 'No PIN — kiosk locked out'}
            </div>
            <Btn onClick={() => { setPin(''); setEditing(true); }}>{hasPin ? 'Change' : 'Set PIN'}</Btn>
            {hasPin && <Btn onClick={clear} disabled={working}>Clear</Btn>}
          </>
        )}
        {editing && (
          <>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={4}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              style={{ width: 80, fontFamily: 'inherit', fontSize: 18, letterSpacing: 6, textAlign: 'center', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '6px 8px', background: 'var(--pn-surface)', outline: 'none' }}
            />
            <Btn onClick={save} color="#2D7A5F" disabled={saving || pin.length !== 4}>
              {saving ? 'Saving…' : 'Save'}
            </Btn>
            <Btn onClick={() => { setEditing(false); setPin(''); }} disabled={saving}>Cancel</Btn>
          </>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 4 }}>
        4 digits. The tech enters this at the iPad kiosk to clock in/out and start/end breaks.
      </div>
    </Field>
  );
}
