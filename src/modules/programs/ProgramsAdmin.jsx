import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  subscribeProgramTemplates, createProgramTemplate, saveProgramTemplate, deleteProgramTemplate,
  subscribeClientPrograms, createClientProgram, saveClientProgram, deleteClientProgram,
  subscribeSessionPacks, grantSessionPack, fetchClients,
} from '../../lib/firestore';
import { blankProgram, newWeek, newDay, newExercise, programStats, assignProgram } from '../../lib/programs';
import { logActivity } from '../../lib/logger';
import TrashButton from '../../components/TrashButton';

const TABS = [
  { id: 'templates', label: 'Templates' },
  { id: 'assigned',  label: 'Assigned' },
  { id: 'packs',     label: 'Session Packs' },
];

export default function ProgramsAdmin() {
  const { showToast, terms } = useApp();
  const [tab,        setTab]        = useState('templates');
  const [templates,  setTemplates]  = useState([]);
  const [assigned,   setAssigned]   = useState([]);
  const [clients,    setClients]    = useState([]);
  const [packs,      setPacks]      = useState([]);
  const [editTpl,    setEditTpl]    = useState(null);   // template obj | 'new'
  const [editCp,     setEditCp]     = useState(null);   // client-program obj
  const [assignTpl,  setAssignTpl]  = useState(null);   // template to assign
  const [granting,   setGranting]   = useState(false);  // grant-pack modal open

  useEffect(() => subscribeProgramTemplates(setTemplates), []);
  useEffect(() => subscribeClientPrograms(setAssigned), []);
  useEffect(() => subscribeSessionPacks(setPacks), []);
  useEffect(() => { fetchClients().then(setClients).catch(() => {}); }, []);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', paddingBottom: 32 }}>
      <div className="scroll-x" style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--pn-border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, background: 'none', border: 'none', cursor: 'pointer', color: tab === t.id ? 'var(--pn-text)' : 'var(--pn-text-muted)', borderBottom: tab === t.id ? '2px solid #6a4fa0' : '2px solid transparent', marginBottom: -1, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t.label}{t.id === 'assigned' && assigned.length > 0 && <span style={{ marginLeft: 6, color: 'var(--pn-text-faint)' }}>({assigned.length})</span>}
            {t.id === 'packs' && packs.filter(p => p.status === 'active').length > 0 && <span style={{ marginLeft: 6, color: 'var(--pn-text-faint)' }}>({packs.filter(p => p.status === 'active').length})</span>}
          </button>
        ))}
      </div>

      {tab === 'templates' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, color: 'var(--pn-text-muted)' }}>Build reusable training plans, then assign them to a {terms.client} and customize per person.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <TrashButton collections={['programTemplates', 'clientPrograms']} scope="Programs" />
              <button onClick={() => setEditTpl('new')} style={primaryBtn}>+ New program</button>
            </div>
          </div>
          {templates.length === 0 ? (
            <Empty>No programs yet. Create your first — e.g. "12-Week Strength" or "Beginner Fat-Loss".</Empty>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              {templates.map(t => {
                const s = programStats(t);
                return (
                  <div key={t.id} style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 14, padding: 18, opacity: t.active === false ? .55 : 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4 }}>{t.name}</div>
                    {t.description && <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 8 }}>{t.description}</div>}
                    <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginBottom: 12 }}>{s.weeks} wk · {s.days} days · {s.exercises} exercises</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => setAssignTpl(t)} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12, color: '#6a4fa0', borderColor: '#d8d0e8', background: '#f3eafc' }}>Assign</button>
                      <button onClick={() => setEditTpl(t)} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12 }}>Edit</button>
                      <button onClick={async () => {
                        if (!confirm(`Delete "${t.name}"? Assigned copies are kept.`)) return;
                        await deleteProgramTemplate(t.id); logActivity('program_template_deleted', t.name); showToast('Program deleted');
                      }} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12, color: '#ef4444', borderColor: '#fca5a5' }}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'assigned' && (
        <AssignedTab assigned={assigned} onEdit={setEditCp} onDelete={async (cp) => {
          if (!confirm(`Remove ${cp.clientName}'s "${cp.name}" program?`)) return;
          await deleteClientProgram(cp.id); logActivity('client_program_removed', `${cp.clientName} — ${cp.name}`); showToast('Removed');
        }} />
      )}

      {tab === 'packs' && <PacksTab packs={packs} onGrant={() => setGranting(true)} />}

      {granting && (
        <GrantPackModal clients={clients}
          onGrant={async ({ clientId, clientName, name, totalSessions }) => {
            try {
              await grantSessionPack(clientId, name, totalSessions);
              logActivity('session_pack_granted', `${clientName} — ${totalSessions} sessions`);
              showToast(`Granted ${totalSessions}-session pack to ${clientName}`);
              setGranting(false);
            } catch (e) { showToast(`Grant failed: ${e.message}`, 4000); }
          }}
          onClose={() => setGranting(false)} />
      )}

      {editTpl && (
        <ProgramEditor
          title={editTpl === 'new' ? 'New program' : 'Edit program'}
          initial={editTpl === 'new' ? blankProgram() : editTpl}
          onSave={async (data) => {
            try {
              if (editTpl === 'new') { await createProgramTemplate(data); logActivity('program_template_created', data.name); showToast('Program created'); }
              else { await saveProgramTemplate(editTpl.id, data); logActivity('program_template_updated', data.name); showToast('Program updated'); }
              setEditTpl(null);
            } catch (e) { showToast(`Save failed: ${e.message}`, 4000); }
          }}
          onClose={() => setEditTpl(null)}
        />
      )}

      {editCp && (
        <ProgramEditor
          title={`${editCp.clientName} — ${editCp.name}`}
          initial={editCp}
          showAssignmentFields
          onSave={async (data) => {
            try { await saveClientProgram(editCp.id, data); logActivity('client_program_updated', `${editCp.clientName} — ${data.name}`); showToast('Saved'); setEditCp(null); }
            catch (e) { showToast(`Save failed: ${e.message}`, 4000); }
          }}
          onClose={() => setEditCp(null)}
        />
      )}

      {assignTpl && (
        <AssignModal template={assignTpl} clients={clients} existing={assigned}
          onAssign={async (client) => {
            try {
              await createClientProgram(assignProgram(assignTpl, client));
              logActivity('program_assigned', `${client.name} → ${assignTpl.name}`);
              showToast(`Assigned to ${client.name}`);
              setAssignTpl(null); setTab('assigned');
            } catch (e) { showToast(`Assign failed: ${e.message}`, 4000); }
          }}
          onClose={() => setAssignTpl(null)} />
      )}
    </div>
  );
}

function AssignedTab({ assigned, onEdit, onDelete }) {
  const [filter, setFilter] = useState('active');
  const filtered = filter === 'all' ? assigned : assigned.filter(a => (a.status || 'active') === filter);
  if (assigned.length === 0) return <Empty>No programs assigned yet. Assign one from the Templates tab.</Empty>;
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {['active', 'paused', 'completed', 'all'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '5px 12px', fontFamily: 'inherit', fontSize: 12, borderRadius: 8, border: filter === f ? '1px solid #6a4fa0' : '1px solid var(--pn-border-strong)', background: filter === f ? '#f3eafc' : 'var(--pn-surface)', color: filter === f ? '#6a4fa0' : 'var(--pn-text-muted)', cursor: 'pointer', fontWeight: filter === f ? 600 : 400 }}>
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? <Empty>No {filter} programs.</Empty> : (
        <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: 'var(--pn-bg)', borderBottom: '1px solid var(--pn-border)' }}>
              <th style={th}>Client</th><th style={th}>Program</th><th style={th}>Week</th><th style={th}>Status</th><th style={th}>Started</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {filtered.map(cp => {
                const s = programStats(cp);
                const color = cp.status === 'active' ? 'var(--pn-success)' : cp.status === 'completed' ? '#6a4fa0' : 'var(--pn-text-muted)';
                return (
                  <tr key={cp.id} style={{ borderBottom: '1px solid var(--pn-border)' }}>
                    <td style={td}><b>{cp.clientName}</b></td>
                    <td style={td}>{cp.name} <span style={{ color: 'var(--pn-text-faint)' }}>· {s.weeks} wk</span></td>
                    <td style={td}>{cp.currentWeek || 1}/{s.weeks}</td>
                    <td style={td}><span style={{ color, fontWeight: 600, textTransform: 'capitalize' }}>{cp.status || 'active'}</span></td>
                    <td style={td}>{cp.startDate || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => onEdit(cp)} style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11 }}>Edit</button>
                      <button onClick={() => onDelete(cp)} style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11, marginLeft: 4, color: '#ef4444', borderColor: '#fca5a5' }}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AssignModal({ template, clients, existing, onAssign, onClose }) {
  const { terms } = useApp();
  const [clientId, setClientId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const sorted = [...clients].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  async function go() {
    setErr('');
    const client = clients.find(c => c.id === clientId);
    if (!client) { setErr(`Pick a ${terms.client}`); return; }
    if (existing.some(a => a.clientId === clientId && a.templateId === template.id && (a.status || 'active') === 'active')) {
      setErr(`${client.name} already has this program active.`); return;
    }
    setBusy(true);
    try { await onAssign(client); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Assign "${template.name}"`} onClose={onClose}>
      <Field label={terms.client.charAt(0).toUpperCase() + terms.client.slice(1)}>
        <select value={clientId} onChange={e => setClientId(e.target.value)} style={inp}>
          <option value="">Pick a {terms.client}…</option>
          {sorted.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ''}</option>)}
        </select>
      </Field>
      <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 8 }}>A personal copy is created — edits to it won't change the template.</div>
      {err && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={go} disabled={busy} style={{ ...primaryBtn, flex: 2, padding: '10px 14px' }}>{busy ? 'Assigning…' : 'Assign'}</button>
        <button onClick={onClose} disabled={busy} style={{ ...secondaryBtn, flex: 1, padding: '10px 14px' }}>Cancel</button>
      </div>
    </Modal>
  );
}

function ProgramEditor({ title, initial, onSave, onClose, showAssignmentFields }) {
  const [name, setName]               = useState(initial.name || '');
  const [description, setDescription] = useState(initial.description || '');
  const [weeks, setWeeks]             = useState(initial.weeks?.length ? initial.weeks : [newWeek(1)]);
  const [active, setActive]           = useState(initial.active !== false);
  const [status, setStatus]           = useState(initial.status || 'active');
  const [currentWeek, setCurrentWeek] = useState(initial.currentWeek || 1);
  const [notes, setNotes]             = useState(initial.notes || '');
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState('');
  const [openWeek, setOpenWeek]       = useState(0);

  function mutWeek(wi, fn) { setWeeks(ws => ws.map((w, i) => i === wi ? fn({ ...w }) : w)); }
  function patchExercise(wi, di, ei, patch) {
    mutWeek(wi, w => ({ ...w, days: w.days.map((d, j) => j !== di ? d : { ...d, exercises: d.exercises.map((ex, k) => k === ei ? { ...ex, ...patch } : ex) }) }));
  }

  async function submit() {
    setErr('');
    if (!name.trim()) { setErr('Program name required'); return; }
    const clean = weeks.map(w => ({
      id: w.id, name: w.name,
      days: (w.days || []).map(d => ({
        id: d.id, name: d.name,
        exercises: (d.exercises || []).filter(ex => (ex.name || '').trim()).map(ex => ({
          id: ex.id, name: ex.name.trim(), sets: ex.sets || '', reps: ex.reps || '', load: ex.load || '',
          tempo: ex.tempo || '', rest: ex.rest || '', videoUrl: (ex.videoUrl || '').trim(), notes: ex.notes || '',
        })),
      })),
    }));
    setSaving(true);
    try {
      const payload = { name: name.trim(), description: description.trim(), weeks: clean };
      if (showAssignmentFields) Object.assign(payload, { status, currentWeek: Number(currentWeek) || 1, notes: notes.trim() });
      else payload.active = active;
      await onSave(payload);
    } finally { setSaving(false); }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Program name" style={{ flex: 2 }}>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 12-Week Strength" style={inp} />
        </Field>
        {showAssignmentFields && (
          <Field label="Status" style={{ flex: 1 }}>
            <select value={status} onChange={e => setStatus(e.target.value)} style={inp}>
              <option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option>
            </select>
          </Field>
        )}
      </div>
      <Field label="Description (optional)">
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="One-line summary" style={inp} />
      </Field>
      {showAssignmentFields && (
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Current week" style={{ flex: 1 }}>
            <input type="number" min={1} value={currentWeek} onChange={e => setCurrentWeek(e.target.value)} style={inp} />
          </Field>
          <Field label="Coach notes" style={{ flex: 2 }}>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes for this client" style={inp} />
          </Field>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '8px 0' }}>Plan</div>
      {weeks.map((w, wi) => (
        <div key={w.id} style={{ border: '1px solid var(--pn-border)', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--pn-bg)' }}>
            <button onClick={() => setOpenWeek(openWeek === wi ? -1 : wi)} style={{ ...tinyBtn, width: 22 }}>{openWeek === wi ? '▾' : '▸'}</button>
            <input value={w.name} onChange={e => mutWeek(wi, ww => ({ ...ww, name: e.target.value }))} style={{ ...inp, fontWeight: 600 }} />
            <button onClick={() => setWeeks(ws => ws.filter((_, i) => i !== wi))} title="Remove week" style={{ ...tinyBtn, color: '#ef4444' }}>×</button>
          </div>
          {openWeek === wi && (
            <div style={{ padding: 10 }}>
              {(w.days || []).map((d, di) => (
                <div key={d.id} style={{ marginBottom: 10, border: '1px solid var(--pn-border)', borderRadius: 8, padding: 8 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input value={d.name} onChange={e => mutWeek(wi, ww => ({ ...ww, days: ww.days.map((dd, j) => j === di ? { ...dd, name: e.target.value } : dd) }))} style={{ ...inp, fontWeight: 600 }} />
                    <button onClick={() => mutWeek(wi, ww => ({ ...ww, days: ww.days.filter((_, j) => j !== di) }))} title="Remove day" style={{ ...tinyBtn, color: '#ef4444' }}>×</button>
                  </div>
                  {(d.exercises || []).map((ex, ei) => (
                    <div key={ex.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr .6fr .6fr .8fr 1fr auto', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                      <input value={ex.name} onChange={e => patchExercise(wi, di, ei, { name: e.target.value })} placeholder="Exercise" style={miniInp} />
                      <input value={ex.sets} onChange={e => patchExercise(wi, di, ei, { sets: e.target.value })} placeholder="Sets" style={miniInp} />
                      <input value={ex.reps} onChange={e => patchExercise(wi, di, ei, { reps: e.target.value })} placeholder="Reps" style={miniInp} />
                      <input value={ex.load} onChange={e => patchExercise(wi, di, ei, { load: e.target.value })} placeholder="Load" style={miniInp} />
                      <input value={ex.videoUrl} onChange={e => patchExercise(wi, di, ei, { videoUrl: e.target.value })} placeholder="Video URL" style={miniInp} />
                      <button onClick={() => mutWeek(wi, ww => ({ ...ww, days: ww.days.map((dd, j) => j === di ? { ...dd, exercises: dd.exercises.filter((_, k) => k !== ei) } : dd) }))} title="Remove" style={{ ...tinyBtn, color: '#ef4444' }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => mutWeek(wi, ww => ({ ...ww, days: ww.days.map((dd, j) => j === di ? { ...dd, exercises: [...dd.exercises, newExercise()] } : dd) }))} style={{ ...secondaryBtn, fontSize: 11, padding: '4px 10px', marginTop: 4 }}>+ Exercise</button>
                </div>
              ))}
              <button onClick={() => mutWeek(wi, ww => ({ ...ww, days: [...(ww.days || []), newDay((ww.days?.length || 0) + 1)] }))} style={{ ...secondaryBtn, fontSize: 12 }}>+ Day</button>
            </div>
          )}
        </div>
      ))}
      <button onClick={() => { setWeeks(ws => [...ws, newWeek(ws.length + 1)]); setOpenWeek(weeks.length); }} style={{ ...secondaryBtn, fontSize: 12 }}>+ Week</button>

      {!showAssignmentFields && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '12px 0 4px', cursor: 'pointer' }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
        </label>
      )}
      {err && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>{err}</div>}
      <ModalFooter onCancel={onClose} onSave={submit} saving={saving} />
    </Modal>
  );
}

function PacksTab({ packs, onGrant }) {
  const { terms } = useApp();
  const [filter, setFilter] = useState('active');
  const filtered = filter === 'all' ? packs : packs.filter(p => (p.status || 'active') === filter);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: 'var(--pn-text-muted)' }}>Prepaid session packs auto-decrement when a {terms.appointment} is marked done.</div>
        <button onClick={onGrant} style={primaryBtn}>+ Grant pack</button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {['active', 'depleted', 'all'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '5px 12px', fontFamily: 'inherit', fontSize: 12, borderRadius: 8, border: filter === f ? '1px solid #6a4fa0' : '1px solid var(--pn-border-strong)', background: filter === f ? '#f3eafc' : 'var(--pn-surface)', color: filter === f ? '#6a4fa0' : 'var(--pn-text-muted)', cursor: 'pointer', fontWeight: filter === f ? 600 : 400 }}>
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <Empty>No {filter === 'all' ? '' : filter} packs. Grant a pack (e.g. "10-Session Pack") to a {terms.client}.</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          {filtered.map(p => {
            const pct = p.totalSessions ? Math.round((p.remaining / p.totalSessions) * 100) : 0;
            const low = p.status === 'active' && p.remaining <= 2;
            return (
              <div key={p.id} style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 14, padding: 16, opacity: p.status === 'depleted' ? .6 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{p.clientName}</div>
                  {low && <span style={{ fontSize: 10, fontWeight: 700, color: '#b45309', background: '#fef3c7', borderRadius: 5, padding: '2px 7px' }}>LOW</span>}
                  {p.status === 'depleted' && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--pn-text-muted)', background: 'var(--pn-surface-alt)', borderRadius: 5, padding: '2px 7px' }}>USED UP</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 10 }}>{p.name}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#6a4fa0', lineHeight: 1 }}>{p.remaining}<span style={{ fontSize: 14, color: 'var(--pn-text-muted)', fontWeight: 500 }}> / {p.totalSessions} left</span></div>
                <div style={{ height: 6, background: 'var(--pn-surface-alt)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: low ? '#f59e0b' : '#6a4fa0' }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GrantPackModal({ clients, onGrant, onClose }) {
  const { terms } = useApp();
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('10-Session Pack');
  const [total, setTotal] = useState(10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const sorted = [...clients].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  async function go() {
    setErr('');
    const client = clients.find(c => c.id === clientId);
    if (!client) { setErr(`Pick a ${terms.client}`); return; }
    if (!(Number(total) > 0)) { setErr('Sessions must be > 0'); return; }
    setBusy(true);
    try { await onGrant({ clientId, clientName: client.name, name: name.trim() || 'Session Pack', totalSessions: Number(total) }); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="Grant session pack" onClose={onClose}>
      <Field label={terms.client.charAt(0).toUpperCase() + terms.client.slice(1)}>
        <select value={clientId} onChange={e => setClientId(e.target.value)} style={inp}>
          <option value="">Pick a {terms.client}…</option>
          {sorted.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ''}</option>)}
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Pack name" style={{ flex: 2 }}><input value={name} onChange={e => setName(e.target.value)} style={inp} /></Field>
        <Field label="Sessions" style={{ flex: 1 }}><input type="number" min={1} value={total} onChange={e => setTotal(e.target.value)} style={inp} /></Field>
      </div>
      <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 8 }}>Collect payment at checkout as usual — this just tracks the credit balance, which counts down as sessions are completed.</div>
      {err && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={go} disabled={busy} style={{ ...primaryBtn, flex: 2, padding: '10px 14px' }}>{busy ? 'Granting…' : 'Grant pack'}</button>
        <button onClick={onClose} disabled={busy} style={{ ...secondaryBtn, flex: 1, padding: '10px 14px' }}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Reusable bits (match MembershipsAdmin / IntakeAdmin conventions) ──
function Empty({ children }) {
  return <div style={{ background: 'var(--pn-bg)', border: '1px dashed var(--pn-border-strong)', borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13 }}>{children}</div>;
}
function Modal({ title, children, onClose, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: wide ? 680 : 460, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--pn-surface)', zIndex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}
function ModalFooter({ onCancel, onSave, saving }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
      <button onClick={onSave} disabled={saving} style={{ ...primaryBtn, flex: 2, padding: '10px 14px' }}>{saving ? 'Saving…' : 'Save'}</button>
      <button onClick={onCancel} disabled={saving} style={{ ...secondaryBtn, flex: 1, padding: '10px 14px' }}>Cancel</button>
    </div>
  );
}
function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      {children}
    </div>
  );
}
const inp = { width: '100%', fontFamily: 'inherit', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', outline: 'none', boxSizing: 'border-box' };
const miniInp = { width: '100%', fontFamily: 'inherit', fontSize: 12, padding: '5px 7px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', outline: 'none', boxSizing: 'border-box' };
const primaryBtn = { padding: '8px 16px', borderRadius: 10, border: 'none', background: '#6a4fa0', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const secondaryBtn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const tinyBtn = { width: 24, height: 24, borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0, flex: 'none' };
const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 };
const td = { padding: '10px 14px', fontSize: 13, color: 'var(--pn-text)' };
