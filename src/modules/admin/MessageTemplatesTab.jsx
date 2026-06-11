import { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchMessageTemplates, saveMessageTemplate, resetMessageTemplate } from '../../lib/firestore';
import { logActivity } from '../../lib/logger';
import {
  DEFAULT_TEMPLATES, TEMPLATE_GROUPS, renderMessage, segmentInfo,
  sampleVarsFor, PREVIEW_BRAND,
} from '../../lib/messageTemplates';

const INPUT = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
  border: '1px solid var(--pn-border-strong)', borderRadius: 8,
  padding: '8px 10px', fontSize: 13, background: 'var(--pn-surface)', color: 'var(--pn-text)',
};
const MONO = { ...INPUT, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', lineHeight: 1.6 };

export default function MessageTemplatesTab() {
  const { showToast, gUser } = useApp();
  const [overrides, setOverrides] = useState(null);   // { key: {subject,body,updatedAt,updatedBy} }
  const [selKey, setSelKey]       = useState(null);
  const [draft, setDraft]         = useState({ subject: '', body: '' });
  const [saving, setSaving]       = useState(false);
  const bodyRef    = useRef(null);
  const subjectRef = useRef(null);
  const activeRef  = useRef({ field: 'body', pos: 0 });

  useEffect(() => { fetchMessageTemplates().then(setOverrides).catch(() => setOverrides({})); }, []);

  const def = selKey ? DEFAULT_TEMPLATES[selKey] : null;

  // Load a template into the editor (override value or default).
  function open(key) {
    const o = (overrides && overrides[key]) || null;
    const d = DEFAULT_TEMPLATES[key];
    setSelKey(key);
    setDraft({
      subject: (o && typeof o.subject === 'string' && o.subject) || d.subject || '',
      body:    (o && typeof o.body === 'string' && o.body) || d.body || '',
    });
  }

  const isEdited = (key) => {
    const o = overrides && overrides[key];
    return !!(o && ((typeof o.subject === 'string' && o.subject) || (typeof o.body === 'string' && o.body)));
  };

  const draftIsDefault = def && draft.subject === (def.subject || '') && draft.body === (def.body || '');

  // Live preview from the CURRENT draft (exact server renderer).
  const preview = useMemo(() => {
    if (!def) return null;
    try {
      return renderMessage(selKey, sampleVarsFor(def), PREVIEW_BRAND, { subject: draft.subject, body: draft.body });
    } catch (e) {
      return { error: e.message };
    }
  }, [def, selKey, draft]);

  function insertVar(token) {
    const { field, pos } = activeRef.current;
    const key = field === 'subject' ? 'subject' : 'body';
    const cur = draft[key] || '';
    const at  = Math.min(pos ?? cur.length, cur.length);
    const next = cur.slice(0, at) + token + cur.slice(at);
    setDraft(d => ({ ...d, [key]: next }));
    const ref = field === 'subject' ? subjectRef : bodyRef;
    requestAnimationFrame(() => {
      if (ref.current) { ref.current.focus(); const p = at + token.length; ref.current.setSelectionRange(p, p); activeRef.current = { field, pos: p }; }
    });
  }

  function trackCaret(field) {
    return (e) => { activeRef.current = { field, pos: e.target.selectionStart || 0 }; };
  }

  async function save() {
    if (!selKey) return;
    setSaving(true);
    try {
      const payload = { subject: def.channel === 'email' ? (draft.subject || '') : '', body: draft.body || '', updatedBy: gUser?.email || '' };
      await saveMessageTemplate(selKey, payload);
      setOverrides(o => ({ ...(o || {}), [selKey]: { ...payload, updatedAt: new Date().toISOString() } }));
      logActivity('message_template_saved', `Edited template: ${def.label}`);
      showToast('Template saved');
    } catch (e) {
      showToast('Save failed: ' + (e.message || 'error'));
    } finally { setSaving(false); }
  }

  async function reset() {
    if (!selKey) return;
    if (!window.confirm(`Reset "${def.label}" to the built-in default? Your custom wording will be removed.`)) return;
    setSaving(true);
    try {
      await resetMessageTemplate(selKey);
      setOverrides(o => { const n = { ...(o || {}) }; delete n[selKey]; return n; });
      setDraft({ subject: def.subject || '', body: def.body || '' });
      logActivity('message_template_reset', `Reset template: ${def.label}`);
      showToast('Reset to default');
    } catch (e) {
      showToast('Reset failed: ' + (e.message || 'error'));
    } finally { setSaving(false); }
  }

  if (overrides === null) return <div style={{ padding: 24, color: 'var(--pn-text-muted)' }}>Loading templates…</div>;

  return (
    <div style={{ padding: '12px 16px 32px' }}>
      <div style={{ fontSize: 13, color: 'var(--pn-text)', fontWeight: 600 }}>Message Templates</div>
      <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', margin: '2px 0 14px', lineHeight: 1.5 }}>
        Edit the wording of every automated email and text. Blank fields use the built-in default, so your customers
        keep getting today's messages until you change them.
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* List */}
        <div style={{ flex: '1 1 240px', minWidth: 220 }}>
          {TEMPLATE_GROUPS.map(g => {
            const keys = Object.keys(DEFAULT_TEMPLATES).filter(k => DEFAULT_TEMPLATES[k].group === g.key);
            if (!keys.length) return null;
            return (
              <div key={g.key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--pn-text-faint)', margin: '0 0 6px' }}>{g.label}</div>
                {keys.map(k => {
                  const d = DEFAULT_TEMPLATES[k];
                  const active = k === selKey;
                  return (
                    <button key={k} onClick={() => open(k)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                      textAlign: 'left', padding: '9px 11px', marginBottom: 4, borderRadius: 8, cursor: 'pointer',
                      border: active ? '1px solid #3D95CE' : '1px solid var(--pn-border)',
                      background: active ? 'rgba(61,149,206,.08)' : 'var(--pn-surface)', fontFamily: 'inherit',
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 12 }}>{d.channel === 'sms' ? '💬' : '✉️'}</span>
                        <span style={{ fontSize: 12.5, color: 'var(--pn-text)' }}>{d.label}</span>
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: isEdited(k) ? '#2D7A5F' : 'var(--pn-text-faint)' }}>
                        {isEdited(k) ? 'Edited' : 'Default'}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Editor + preview */}
        <div style={{ flex: '2 1 420px', minWidth: 320 }}>
          {!def ? (
            <div style={{ padding: 24, color: 'var(--pn-text-faint)', fontSize: 13, border: '1px dashed var(--pn-border)', borderRadius: 10, textAlign: 'center' }}>
              Pick a message on the left to edit it.
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pn-text)' }}>{def.label}</div>
                {isEdited(selKey) && overrides[selKey]?.updatedBy && (
                  <div style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>Last edited by {overrides[selKey].updatedBy}</div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginBottom: 12 }}>{def.description}</div>

              {def.channel === 'email' && (
                <label style={{ display: 'block', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>Subject</span>
                  <input ref={subjectRef} value={draft.subject}
                    onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
                    onSelect={trackCaret('subject')} onClick={trackCaret('subject')} onKeyUp={trackCaret('subject')} onFocus={trackCaret('subject')}
                    style={{ ...INPUT, marginTop: 3 }} />
                </label>
              )}

              <label style={{ display: 'block', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>{def.channel === 'sms' ? 'Message' : 'Body'}</span>
                <textarea ref={bodyRef} value={draft.body} rows={def.channel === 'sms' ? 3 : 9}
                  onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
                  onSelect={trackCaret('body')} onClick={trackCaret('body')} onKeyUp={trackCaret('body')} onFocus={trackCaret('body')}
                  style={{ ...MONO, marginTop: 3, resize: 'vertical' }} />
              </label>

              {/* Variable chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                {(def.vars || []).map(v => (
                  <button key={v} onClick={() => insertVar(`{${v}}`)} title={`Insert {${v}}`} style={{
                    fontSize: 11, fontFamily: 'ui-monospace,monospace', padding: '3px 8px', borderRadius: 999,
                    border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: '#3D95CE', cursor: 'pointer',
                  }}>{`{${v}}`}</button>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--pn-text-faint)', lineHeight: 1.6, marginBottom: 14 }}>
                {def.channel === 'sms' ? (
                  <>Plain text only. Your salon name is added to the front and “Reply STOP to opt out.” to the end automatically — don’t repeat them.</>
                ) : (
                  <>Light formatting: <code>{'# heading'}</code>, <code>{'> small note'}</code>, <code>**bold**</code>, and a button on its own line as <code>{'[[Label|{link}]]'}</code>. Blank lines separate paragraphs.</>
                )}
              </div>

              {/* Preview */}
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--pn-text-faint)', marginBottom: 6 }}>Preview</div>
              {preview?.error ? (
                <div style={{ padding: 12, borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 12 }}>Preview error: {preview.error}</div>
              ) : def.channel === 'email' ? (
                <>
                  <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 6 }}><strong>Subject:</strong> {preview?.subject}</div>
                  <iframe title="email-preview" sandbox="" srcDoc={preview?.html}
                    style={{ width: '100%', height: 440, border: '1px solid var(--pn-border)', borderRadius: 10, background: '#fff' }} />
                </>
              ) : (
                <SmsPreview body={preview?.body} />
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                <button onClick={save} disabled={saving} style={{
                  padding: '9px 20px', borderRadius: 9, border: 'none', cursor: saving ? 'default' : 'pointer',
                  background: '#2D7A5F', color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', opacity: saving ? 0.6 : 1,
                }}>{saving ? 'Saving…' : 'Save'}</button>
                <button onClick={() => setDraft({ subject: def.subject || '', body: def.body || '' })} disabled={saving || draftIsDefault} style={{
                  padding: '9px 16px', borderRadius: 9, border: '1px solid var(--pn-border-strong)', cursor: 'pointer',
                  background: 'var(--pn-surface)', color: 'var(--pn-text)', fontSize: 13, fontFamily: 'inherit', opacity: draftIsDefault ? 0.5 : 1,
                }}>Load default text</button>
                {isEdited(selKey) && (
                  <button onClick={reset} disabled={saving} style={{
                    padding: '9px 16px', borderRadius: 9, border: '1px solid #e5b4b4', cursor: 'pointer',
                    background: 'var(--pn-surface)', color: '#b91c1c', fontSize: 13, fontFamily: 'inherit', marginLeft: 'auto',
                  }}>Reset to default</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SmsPreview({ body }) {
  const seg = segmentInfo(body || '');
  return (
    <div>
      <div style={{ background: '#e9e9eb', borderRadius: 18, padding: '10px 14px', maxWidth: 320, fontSize: 13.5, color: '#111', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
        <span style={{ color: '#9aa' }}>[Salon name] </span>{body}<span style={{ color: '#9aa' }}>{'\n'}Reply STOP to opt out.</span>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--pn-text-faint)', marginTop: 6 }}>
        {seg.length} chars · {seg.segments} segment{seg.segments === 1 ? '' : 's'} · {seg.encoding}
      </div>
    </div>
  );
}
