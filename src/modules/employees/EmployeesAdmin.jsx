import { useState, useEffect, useRef } from 'react';
import { fetchEmployees, createEmployee, saveEmployee, deleteEmployee, employeesExist, fetchServices } from '../../lib/firestore';
import { resizeImg } from '../../utils/helpers';
import { SEED_EMPLOYEES } from '../../data/seedEmployees';
import { useApp } from '../../context/AppContext';
import { logActivity, logError } from '../../lib/logger';


const WORK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_WORK_DAY = { on: true, start: '09:00', end: '18:00' };

function blankEmployee() {
  return {
    name: '', photo: '', active: true, sortOrder: 0, notes: '',
    extendedHoursAllowed: false,
    phone: '', email: '', address: '',
    instagram: '', facebook: '', tiktok: '', venmo: '', homepage: '',
    rateType: 'commission', commissionPct: '', hourlyRate: '',
    paymentPref: 'cash', paymentNotes: '',
    workDays: {},
    serviceIds: [],
  };
}

export default function EmployeesAdmin() {
  const { isAdmin, showToast } = useApp();
  const [employees, setEmployees] = useState([]);
  const [services,  setServices]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [editing,   setEditing]   = useState(null);
  const [seeding,   setSeeding]   = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [emps, svcs] = await Promise.all([fetchEmployees(), fetchServices()]);
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
        <div style={{ flex: 1, fontSize: 13, color: '#888' }}>{employees.length} team member{employees.length !== 1 ? 's' : ''}</div>
        {employees.length === 0 && (
          <Btn onClick={seedEmployees} disabled={seeding} color="#f59e0b">
            {seeding ? 'Adding…' : '↺ Seed from defaults'}
          </Btn>
        )}
        {employees.length > 0 && services.length > 0 && (
          <Btn onClick={assignAllServicesToAll} color="#7c3aed">↺ Assign all services to all</Btn>
        )}
        <Btn color="#3D95CE" onClick={() => setEditing(blankEmployee())}>+ Add</Btn>
      </div>

      {employees.length === 0 ? (
        <Empty>No employees yet — seed the default staff list or add manually.</Empty>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', overflow: 'hidden' }}>
          {employees.map((emp, i) => (
            <EmployeeRow
              key={emp.id}
              emp={emp}
              totalServices={services.length}
              last={i === employees.length - 1}
              onEdit={() => setEditing({ ...emp })}
              onDelete={() => handleDelete(emp)}
              onToggleActive={() => handleToggleActive(emp)}
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
        />
      )}
    </div>
  );
}

function EmployeeRow({ emp, totalServices, last, onEdit, onDelete, onToggleActive }) {
  const svcCount = emp.serviceIds?.length || 0;
  const svcConfigured = svcCount > 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: last ? 'none' : '1px solid #f0f0f0', opacity: emp.active ? 1 : .5 }}>
      <EmpAvatar emp={emp} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>
          {emp.name}
          {!emp.active && <span style={{ fontSize: 10, color: '#bbb', marginLeft: 6, fontWeight: 400 }}>inactive</span>}
          {totalServices > 0 && (
            <span title={svcConfigured ? `Performs ${svcCount} of ${totalServices} services` : 'No services configured — defaults to all services'}
              style={{ fontSize: 10, marginLeft: 8, padding: '1px 7px', borderRadius: 10, fontWeight: 600, background: svcConfigured ? '#EBF4FB' : '#fef3c7', color: svcConfigured ? '#1a5f8a' : '#92400e', border: `1px solid ${svcConfigured ? '#bfdbfe' : '#fde68a'}` }}>
              {svcConfigured ? `${svcCount} svc` : 'all svc (default)'}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
          {[emp.phone, emp.email].filter(Boolean).join(' · ') || (emp.instagram ? emp.instagram : 'No contact info')}
        </div>
        {(emp.venmo || emp.instagram || emp.facebook || emp.tiktok) && (
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 1 }}>
            {[emp.venmo && `💸 ${emp.venmo}`, emp.instagram && `📸 ${emp.instagram}`, emp.facebook && `👥 ${emp.facebook}`, emp.tiktok && `🎵 ${emp.tiktok}`].filter(Boolean).join('  ')}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button onClick={onToggleActive} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid #d8d8d8', background: emp.active ? '#f0fdf4' : '#f5f5f5', color: emp.active ? '#16a34a' : '#aaa', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
          {emp.active ? 'Active' : 'Inactive'}
        </button>
        <Btn onClick={onEdit}>Edit</Btn>
        <Btn color="#ef4444" onClick={onDelete}>Del</Btn>
      </div>
    </div>
  );
}

function EmployeeModal({ emp, services, isAdmin, onChange, onSave, onClose }) {
  const { showToast } = useApp();
  const [tab,    setTab]    = useState('profile');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const isNew   = !emp.id;
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
      <div style={{ background: '#fff', borderRadius: 16, width: '94%', maxWidth: 440, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{isNew ? 'New Employee' : 'Edit Employee'}</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e8e8e8', flexShrink: 0 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '9px 0', fontSize: 12, fontWeight: tab === t ? 600 : 400, color: tab === t ? '#3D95CE' : '#888', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #3D95CE' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>

          {/* ── Profile ── */}
          {tab === 'profile' && (
            <>
              <div style={{ display: 'flex', gap: 14, marginBottom: 14, alignItems: 'flex-start' }}>
                <div style={{ flexShrink: 0 }}>
                  <div onClick={() => fileRef.current?.click()} style={{ width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', background: '#f0f0f0', cursor: 'pointer', border: '2px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {emp.photo
                      ? <img src={emp.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <EmpAvatar emp={emp} size={72} />
                    }
                  </div>
                  <div style={{ fontSize: 10, color: '#aaa', textAlign: 'center', marginTop: 3, cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>photo</div>
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

              <label style={{ fontSize: 12, color: '#555', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                <input type="checkbox" checked={!!emp.active} onChange={e => onChange({ active: e.target.checked })} />
                Active (shows on schedule & tip flow)
              </label>
              <label style={{ fontSize: 12, color: '#555', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 8 }}>
                <input type="checkbox" checked={!!emp.extendedHoursAllowed} onChange={e => onChange({ extendedHoursAllowed: e.target.checked })} />
                Available during appointment-only hours
              </label>
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
              <Field label="Address">
                <input value={emp.address || ''} onChange={e => onChange({ address: e.target.value })} placeholder="123 Main St, City, State" style={inp} />
              </Field>
            </>
          )}

          {/* ── Schedule ── */}
          {tab === 'schedule' && (
            <>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 14, lineHeight: 1.5 }}>
                Days marked off are grayed out in the schedule view.
              </div>
              {WORK_DAYS.map(day => {
                const d = emp.workDays?.[day] ?? DEFAULT_WORK_DAY;
                return (
                  <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 34, fontSize: 13, fontWeight: 500, color: d.on ? '#333' : '#bbb' }}>{day}</div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#888', cursor: 'pointer', userSelect: 'none', minWidth: 48 }}>
                      <input type="checkbox" checked={d.on} onChange={e => patchWorkDay(day, { on: e.target.checked })} />
                      {d.on ? 'On' : 'Off'}
                    </label>
                    {d.on ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                        <input type="time" value={d.start} onChange={e => patchWorkDay(day, { start: e.target.value })}
                          style={{ fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 6, padding: '4px 6px', fontSize: 12 }} />
                        <span style={{ color: '#bbb', fontSize: 12 }}>–</span>
                        <input type="time" value={d.end} onChange={e => patchWorkDay(day, { end: e.target.value })}
                          style={{ fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 6, padding: '4px 6px', fontSize: 12 }} />
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: '#d0d0d0', marginLeft: 'auto' }}>not working</span>
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
            />
          )}

          {/* ── Compensation (admin-only) ── */}
          {tab === 'compensation' && (
            <>
              <Field label="Rate type">
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['commission', 'Commission'], ['hourly', 'Hourly'], ['both', 'Both']].map(([v, l]) => (
                    <button key={v} onClick={() => onChange({ rateType: v })}
                      style={{ flex: 1, padding: '7px 4px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1.5px solid ${emp.rateType === v ? '#3D95CE' : '#e0e0e0'}`, background: emp.rateType === v ? '#EBF4FB' : '#fafafa', color: emp.rateType === v ? '#1a5f8a' : '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
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
                      style={{ flex: 1, padding: '7px 4px', fontSize: 11, fontWeight: 600, borderRadius: 8, border: `1.5px solid ${emp.paymentPref === v ? '#2D7A5F' : '#e0e0e0'}`, background: emp.paymentPref === v ? '#EDFAF3' : '#fafafa', color: emp.paymentPref === v ? '#166534' : '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
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
                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #d8d8d8', borderRadius: 8, background: '#fafafa', overflow: 'hidden' }}>
                      <span style={{ padding: '8px 0 8px 12px', fontSize: 14, fontWeight: 500, color: '#aaa', userSelect: 'none' }}>{prefix}</span>
                      <input value={emp[key] || ''} onChange={e => onChange({ [key]: e.target.value })} placeholder={placeholder}
                        style={{ flex: 1, border: 'none', background: 'transparent', padding: '8px 12px 8px 3px', fontSize: 13, color: '#333', outline: 'none', fontFamily: 'inherit' }} />
                    </div>
                  ) : (
                    <input value={emp[key] || ''} onChange={e => onChange({ [key]: e.target.value })} placeholder={placeholder} style={inp} />
                  )}
                </Field>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={{ flex: 1, ...btnBase }}>Cancel</button>
          <button onClick={submit} disabled={saving || !emp.name?.trim()}
            style={{ flex: 2, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE', opacity: (saving || !emp.name?.trim()) ? .6 : 1 }}>
            {saving ? 'Saving…' : isNew ? 'Add Employee' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServicesPicker({ services, selectedIds, onChange }) {
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

  return (
    <>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.5 }}>
        Pick which services this tech can perform. {isAll && <strong style={{ color: '#16a34a' }}>Empty = can do every service.</strong>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={selectAll} style={{ ...btnBase, fontSize: 11, padding: '5px 10px' }}>Select all</button>
        <button onClick={clearAll}  style={{ ...btnBase, fontSize: 11, padding: '5px 10px' }}>Clear all</button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa', alignSelf: 'center' }}>
          {isAll ? 'all' : `${selectedIds.length} of ${services.length}`}
        </div>
      </div>
      {services.length === 0 ? (
        <div style={{ fontSize: 12, color: '#aaa', padding: 16, textAlign: 'center' }}>No services configured yet.</div>
      ) : Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 6, letterSpacing: '.04em', textTransform: 'uppercase' }}>{cat}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
            {items.map(s => {
              const checked = selectedIds.includes(s.id);
              return (
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 8, border: `1px solid ${checked ? '#3D95CE' : '#e0e0e0'}`, background: checked ? '#EBF4FB' : '#fafafa', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(s.id)} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: checked ? '#1a5f8a' : '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                </label>
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
      <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>{label}</label>
      {children}
    </div>
  );
}

function Btn({ onClick, color, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none', background: color || '#e8e8e8', color: color ? '#fff' : '#555', cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 500, opacity: disabled ? .6 : 1 }}>
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <div style={{ padding: 20, textAlign: 'center', color: '#bbb', fontSize: 13 }}>{children}</div>;
}

const inp     = { fontFamily: 'inherit', width: '100%', border: '1px solid #d8d8d8', borderRadius: 8, padding: '7px 11px', fontSize: 13, color: '#333', outline: 'none', background: '#fafafa', boxSizing: 'border-box' };
const btnBase = { fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: '#fff', border: '1px solid #d0d0d0', borderRadius: 8, padding: '8px 14px', color: '#333' };

// Export EmpAvatar for use in SlideModal
export { EmpAvatar };
