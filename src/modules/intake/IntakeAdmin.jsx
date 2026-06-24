import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  subscribeIntakeForms, createIntakeForm, saveIntakeForm, deleteIntakeForm,
  subscribeIntakeResponses, deleteIntakeResponse, fetchClients,
} from '../../lib/firestore';
import { intakeTemplatesForVertical, QUESTION_KINDS } from '../../data/intakeTemplates';
import { logActivity } from '../../lib/logger';
import TrashButton from '../../components/TrashButton';

const TABS = [
  { id: 'forms',     label: 'Forms' },
  { id: 'responses', label: 'Responses' },
];

const NEEDS_OPTIONS = ['single_choice', 'multi_choice'];
let _localQid = 0;
const newQuestion = () => ({ id: `q_${Date.now()}_${++_localQid}`, kind: 'short_text', label: '', required: false, options: [] });

export default function IntakeAdmin() {
  const { isAdmin, showToast, vertical, terms } = useApp();
  const [tab,        setTab]        = useState('forms');
  const [forms,      setForms]      = useState([]);
  const [responses,  setResponses]  = useState([]);
  const [clients,    setClients]    = useState([]);
  const [editForm,   setEditForm]   = useState(null);    // form obj | 'new'
  const [viewResp,   setViewResp]   = useState(null);    // response obj
  const [sendFor,    setSendFor]    = useState(null);    // form obj to send

  // Hooks must run unconditionally (Rules of Hooks) — gate the bodies on isAdmin
  // so a non-admin render (e.g. an owner's "Preview as") doesn't fire denied
  // reads, and the early return below can flip without changing the hook count.
  useEffect(() => { if (!isAdmin) return; return subscribeIntakeForms(setForms); }, [isAdmin]);
  useEffect(() => { if (!isAdmin) return; return subscribeIntakeResponses(setResponses); }, [isAdmin]);
  useEffect(() => { if (!isAdmin) return; fetchClients().then(setClients).catch(() => {}); }, [isAdmin]);

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--pn-text-muted)' }}>Intake forms are managed by the salon owner.</div>;
  }

  async function importDefaults() {
    const seeds = intakeTemplatesForVertical(vertical);
    if (!seeds.length) { showToast('No default templates for this business type'); return; }
    const have = new Set(forms.map(f => f.name));
    let added = 0;
    for (const t of seeds) {
      if (have.has(t.name)) continue;
      await createIntakeForm({
        name: t.name, type: t.type, description: t.description,
        questions: t.questions, active: true,
      });
      added++;
    }
    logActivity('intake_templates_imported', `${added} form(s)`);
    showToast(added ? `Imported ${added} form${added > 1 ? 's' : ''}` : 'All default forms already exist');
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', paddingBottom: 32 }}>
      <div className="scroll-x" style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--pn-border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, background: 'none', border: 'none', cursor: 'pointer', color: tab === t.id ? 'var(--pn-text)' : 'var(--pn-text-muted)', borderBottom: tab === t.id ? '2px solid #6a4fa0' : '2px solid transparent', marginBottom: -1, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t.label}{t.id === 'responses' && responses.length > 0 && <span style={{ marginLeft: 6, color: 'var(--pn-text-faint)' }}>({responses.length})</span>}
          </button>
        ))}
      </div>

      {tab === 'forms' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, color: 'var(--pn-text-muted)' }}>
              Build intake questionnaires and waivers. Send them to a {terms.client} to complete and e-sign.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <TrashButton collections={['intakeForms', 'intakeResponses']} scope="Intake" />
              <button onClick={importDefaults} style={secondaryBtn}>Import defaults</button>
              <button onClick={() => setEditForm('new')} style={primaryBtn}>+ New form</button>
            </div>
          </div>

          {forms.length === 0 ? (
            <Empty>No forms yet. Click <b>Import defaults</b> for a ready-made PAR-Q, health history, and liability waiver — or build your own.</Empty>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
              {forms.map(f => (
                <div key={f.id} style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 14, padding: 18, opacity: f.active === false ? .55 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--pn-text)' }}>{f.name}</span>
                    <Badge type={f.type} />
                  </div>
                  {f.description && <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 8 }}>{f.description}</div>}
                  <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginBottom: 12 }}>
                    {(f.questions || []).length} question{(f.questions || []).length === 1 ? '' : 's'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => setSendFor(f)} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12, color: '#6a4fa0', borderColor: '#d8d0e8', background: '#f3eafc' }}>Send to {terms.client}</button>
                    <button onClick={() => setEditForm(f)} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12 }}>Edit</button>
                    <button onClick={async () => {
                      if (!confirm(`Delete the "${f.name}" form? Existing responses are kept.`)) return;
                      await deleteIntakeForm(f.id);
                      logActivity('intake_form_deleted', f.name);
                      showToast('Form deleted');
                    }} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12, color: '#ef4444', borderColor: '#fca5a5' }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'responses' && (
        <ResponsesTab responses={responses} onView={setViewResp} onDelete={async (r) => {
          if (!confirm(`Delete ${r.clientName || 'this'} response? This removes a signed record.`)) return;
          await deleteIntakeResponse(r.id);
          logActivity('intake_response_deleted', `${r.clientName} — ${r.formName}`);
          showToast('Response deleted');
        }} />
      )}

      {editForm && (
        <FormEditor
          form={editForm === 'new' ? null : editForm}
          onSave={async (data) => {
            try {
              if (editForm === 'new') {
                await createIntakeForm(data);
                logActivity('intake_form_created', data.name);
                showToast('Form created');
              } else {
                await saveIntakeForm(editForm.id, data);
                logActivity('intake_form_updated', data.name);
                showToast('Form updated');
              }
              setEditForm(null);
            } catch (e) { showToast(`Save failed: ${e.message}`, 4000); }
          }}
          onClose={() => setEditForm(null)}
        />
      )}

      {viewResp && <ResponseViewer response={viewResp} onClose={() => setViewResp(null)} />}

      {sendFor && (
        <SendLinkModal form={sendFor} clients={clients} onClose={() => setSendFor(null)} />
      )}
    </div>
  );
}

function Badge({ type }) {
  const isWaiver = type === 'waiver';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5, background: isWaiver ? '#fde8e8' : '#eef4fb', color: isWaiver ? '#b3261e' : '#1f6ea3' }}>
      {isWaiver ? 'Waiver' : 'Intake'}
    </span>
  );
}

function ResponsesTab({ responses, onView, onDelete }) {
  if (responses.length === 0) return <Empty>No responses yet. They'll appear here once a client completes a form.</Empty>;
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--pn-bg)', borderBottom: '1px solid var(--pn-border)' }}>
            <th style={th}>Client</th><th style={th}>Form</th><th style={th}>Submitted</th><th style={th}>Signed</th><th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {responses.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--pn-border)' }}>
              <td style={td}><span style={{ fontWeight: 600 }}>{r.clientName || '—'}</span></td>
              <td style={td}>{r.formName} {r.formType === 'waiver' && <Badge type="waiver" />}</td>
              <td style={td}>{r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
              <td style={td}>{r.signature ? '✍️ Yes' : '—'}</td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button onClick={() => onView(r)} style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11 }}>View</button>
                <button onClick={() => onDelete(r)} style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11, marginLeft: 4, color: '#ef4444', borderColor: '#fca5a5' }}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormEditor({ form, onSave, onClose }) {
  const isNew = !form;
  const [name, setName]               = useState(form?.name || '');
  const [type, setType]               = useState(form?.type || 'intake');
  const [description, setDescription] = useState(form?.description || '');
  const [questions, setQuestions]     = useState(form?.questions?.length ? form.questions.map(q => ({ ...q })) : [newQuestion()]);
  const [active, setActive]           = useState(form?.active !== false);
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState('');

  function patchQ(i, patch) { setQuestions(qs => qs.map((q, idx) => idx === i ? { ...q, ...patch } : q)); }
  function moveQ(i, dir) {
    setQuestions(qs => {
      const j = i + dir;
      if (j < 0 || j >= qs.length) return qs;
      const copy = [...qs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  async function submit() {
    setErr('');
    if (!name.trim()) { setErr('Form name required'); return; }
    const cleaned = questions
      .map(q => ({ ...q, label: (q.label || '').trim() }))
      .filter(q => q.label || q.body);
    if (!cleaned.length) { setErr('Add at least one question'); return; }
    for (const q of cleaned) {
      if (NEEDS_OPTIONS.includes(q.kind) && (!q.options || !q.options.filter(Boolean).length)) {
        setErr(`"${q.label}" is a choice question — add at least one option`); return;
      }
    }
    if (type === 'waiver' && !cleaned.some(q => q.kind === 'signature')) {
      setErr('A waiver must include a Signature question'); return;
    }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(), type, description: description.trim(),
        questions: cleaned.map(q => ({
          id: q.id, kind: q.kind, label: q.label, required: !!q.required,
          ...(NEEDS_OPTIONS.includes(q.kind) ? { options: q.options.map(o => o.trim()).filter(Boolean) } : {}),
          ...(q.readOnly ? { readOnly: true, body: q.body || '' } : {}),
        })),
        active,
      });
    } finally { setSaving(false); }
  }

  return (
    <Modal title={isNew ? 'New form' : 'Edit form'} onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Form name" style={{ flex: 2 }}>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Health History" style={inp} />
        </Field>
        <Field label="Type" style={{ flex: 1 }}>
          <select value={type} onChange={e => setType(e.target.value)} style={inp}>
            <option value="intake">Intake</option>
            <option value="waiver">Waiver</option>
          </select>
        </Field>
      </div>
      <Field label="Description (optional)">
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Shown to the client at the top of the form" style={inp} />
      </Field>

      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '6px 0 8px' }}>Questions</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {questions.map((q, i) => (
          <div key={q.id} style={{ border: '1px solid var(--pn-border)', borderRadius: 10, padding: 12, background: 'var(--pn-bg)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <select value={q.kind} onChange={e => patchQ(i, { kind: e.target.value })} style={{ ...inp, width: 140, flex: 'none' }}>
                {QUESTION_KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <input value={q.label} onChange={e => patchQ(i, { label: e.target.value })} placeholder="Question label" style={{ ...inp, flex: 1 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button onClick={() => moveQ(i, -1)} disabled={i === 0} title="Move up" style={tinyBtn}>↑</button>
                <button onClick={() => moveQ(i, 1)} disabled={i === questions.length - 1} title="Move down" style={tinyBtn}>↓</button>
              </div>
              <button onClick={() => setQuestions(qs => qs.filter((_, idx) => idx !== i))} title="Remove" style={{ ...tinyBtn, color: '#ef4444' }}>×</button>
            </div>
            {NEEDS_OPTIONS.includes(q.kind) && (
              <textarea rows={2} value={(q.options || []).join('\n')} onChange={e => patchQ(i, { options: e.target.value.split('\n') })}
                placeholder="One option per line" style={{ ...inp, marginTop: 8, resize: 'vertical' }} />
            )}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!q.required} onChange={e => patchQ(i, { required: e.target.checked })} /> Required
            </label>
          </div>
        ))}
      </div>
      <button onClick={() => setQuestions(qs => [...qs, newQuestion()])} style={{ ...secondaryBtn, marginTop: 10, fontSize: 12 }}>+ Add question</button>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '12px 0 4px', cursor: 'pointer' }}>
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
        <span>Active <span style={{ color: 'var(--pn-text-muted)', fontSize: 11 }}>(uncheck to retire without deleting)</span></span>
      </label>
      {err && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <ModalFooter onCancel={onClose} onSave={submit} saving={saving} />
    </Modal>
  );
}

function ResponseViewer({ response, onClose }) {
  const questions = response.formVersion || [];
  const answers = response.answers || {};
  return (
    <Modal title={`${response.clientName || 'Response'} — ${response.formName}`} onClose={onClose} wide>
      <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 14 }}>
        Submitted {response.submittedAt ? new Date(response.submittedAt).toLocaleString() : '—'}
      </div>
      {questions.map(q => {
        if (q.kind === 'signature') return null;
        const a = answers[q.id];
        const display = Array.isArray(a) ? a.join(', ') : (a === true ? 'Yes' : a === false ? 'No' : (a ?? '—'));
        return (
          <div key={q.id} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text)' }}>{q.label}</div>
            <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', whiteSpace: 'pre-wrap' }}>{display === '' ? '—' : display}</div>
          </div>
        );
      })}
      {response.signature && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--pn-border)', paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Signature</div>
          {response.signature.dataUrl && (
            <img src={response.signature.dataUrl} alt="signature" style={{ maxWidth: 280, border: '1px solid var(--pn-border)', borderRadius: 8, background: '#fff' }} />
          )}
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 6 }}>
            Signed by <b>{response.signature.signedName || '—'}</b>
            {response.signature.signedAt ? ` on ${new Date(response.signature.signedAt).toLocaleString()}` : ''}
            {response.signature.ip ? ` · IP ${response.signature.ip}` : ''}
          </div>
        </div>
      )}
    </Modal>
  );
}

function SendLinkModal({ form, clients, onClose }) {
  const { showToast, terms } = useApp();
  const [clientId, setClientId] = useState('');
  const [channel, setChannel]   = useState('email');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');

  async function send() {
    setErr('');
    if (!clientId) { setErr(`Pick a ${terms.client}`); return; }
    setBusy(true);
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../lib/firebase');
      const res = await httpsCallable(functions, 'sendIntakeLink')({ formId: form.id, clientId, channel });
      if (res?.data?.sandboxed) {
        showToast('Sandbox mode — link generated but not actually sent', 4500);
      } else {
        showToast(`Intake link sent via ${channel}`);
      }
      onClose();
    } catch (e) {
      setErr(e.message || 'Send failed');
    } finally { setBusy(false); }
  }

  const sorted = [...clients].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return (
    <Modal title={`Send "${form.name}"`} onClose={onClose}>
      <Field label={terms.client.charAt(0).toUpperCase() + terms.client.slice(1)}>
        <select value={clientId} onChange={e => setClientId(e.target.value)} style={inp}>
          <option value="">Pick a {terms.client}…</option>
          {sorted.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : c.phone ? ` · ${c.phone}` : ''}</option>)}
        </select>
      </Field>
      <Field label="Send via">
        <select value={channel} onChange={e => setChannel(e.target.value)} style={inp}>
          <option value="email">Email</option>
          <option value="sms">Text (SMS)</option>
        </select>
      </Field>
      <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 8 }}>
        The {terms.client} gets a secure link to complete and {form.type === 'waiver' ? 'e-sign ' : ''}this form. No login required.
      </div>
      {err && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={send} disabled={busy} style={{ ...primaryBtn, flex: 2, padding: '10px 14px' }}>{busy ? 'Sending…' : 'Send link'}</button>
        <button onClick={onClose} disabled={busy} style={{ ...secondaryBtn, flex: 1, padding: '10px 14px' }}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Reusable bits (match MembershipsAdmin conventions) ──
function Empty({ children }) {
  return <div style={{ background: 'var(--pn-bg)', border: '1px dashed var(--pn-border-strong)', borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13 }}>{children}</div>;
}
function Modal({ title, children, onClose, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: wide ? 640 : 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--pn-surface)' }}>
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
const primaryBtn = { padding: '8px 16px', borderRadius: 10, border: 'none', background: '#6a4fa0', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const secondaryBtn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const tinyBtn = { width: 24, height: 20, borderRadius: 5, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0 };
const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 };
const td = { padding: '10px 14px', fontSize: 13, color: 'var(--pn-text)' };
