import { useState } from 'react';

// Multi-entry notes editor used by appointment + client profiles.
//
// Two entry templates:
//   - Free-form (default): plain textarea, quick capture
//   - SOAP: clinical format used by med spas / lash / brow — splits the
//     entry into Subjective, Objective, Assessment, Plan. Stored as both a
//     joined `text` (so it renders cleanly in legacy contexts that just
//     read `entry.text`) AND a structured `soap` object for rich display.
//
// Data model on the parent (appointment / client):
//   `notesLog` — array of { text, createdAt, author?, soap? }, newest first
//   `notes`    — legacy single-string field; kept in sync at save time on
//                the parent so existing email templates / AI tools / reports
//                that read `appt.notes` keep working.
//
// Append-only by design (delete is allowed; in-place edit is not).
//
// `enableSoap` gates the SOAP-format composer — most salons (nail, hair,
// barbershop) don't need clinical notes, and the extra button adds noise.
// Med spas / lash / brow / treatment-heavy shops can opt in via Settings
// → "Enable clinical (SOAP) notes". When false, only free-form notes can
// be composed; existing SOAP-typed entries still render fully.
export default function NotesEditor({ entries, legacy, onChange, viewOnly, author, enableSoap = false }) {
  const [composer, setComposer] = useState(null); // null | 'free' | 'soap'
  const [draft,    setDraft]    = useState('');
  const [soap,     setSoap]     = useState({ s: '', o: '', a: '', p: '' });

  const list = entries || [];
  const hasLegacy = !!(legacy && legacy.trim());

  function reset() { setComposer(null); setDraft(''); setSoap({ s: '', o: '', a: '', p: '' }); }

  function commitFree() {
    const text = draft.trim();
    if (!text) { reset(); return; }
    onChange([{ text, createdAt: new Date().toISOString(), author: author || '' }, ...list]);
    reset();
  }

  function commitSoap() {
    const fields = [
      ['Subjective', soap.s.trim()],
      ['Objective',  soap.o.trim()],
      ['Assessment', soap.a.trim()],
      ['Plan',       soap.p.trim()],
    ];
    if (fields.every(([, v]) => !v)) { reset(); return; }
    const text = fields.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
    onChange([{
      text,
      createdAt: new Date().toISOString(),
      author:    author || '',
      soap:      { s: soap.s.trim(), o: soap.o.trim(), a: soap.a.trim(), p: soap.p.trim() },
    }, ...list]);
    reset();
  }

  function deleteEntry(i) {
    if (!confirm('Delete this note? This can\'t be undone.')) return;
    onChange(list.filter((_, idx) => idx !== i));
  }

  function fmt(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return iso; }
  }

  const inp = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5 };

  return (
    <div>
      {!viewOnly && composer === 'free' && (
        <div style={{ marginBottom: 8, padding: 10, border: '1px solid #bfdbfe', borderRadius: 8, background: 'var(--pn-info-bg)' }}>
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitFree(); }
              if (e.key === 'Escape') { e.preventDefault(); reset(); }
            }}
            rows={3}
            placeholder="Add a note — allergies, preferences, what happened today…"
            style={{ ...inp, resize: 'vertical', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={reset} style={btnSecondary}>Cancel</button>
            <button onClick={commitFree} disabled={!draft.trim()}
              style={{ ...btnPrimary, background: draft.trim() ? '#3D95CE' : '#cbd5e1', cursor: draft.trim() ? 'pointer' : 'default' }}>
              Save note
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--pn-text-muted)', marginTop: 4, textAlign: 'right' }}>⌘↵ to save · esc to cancel</div>
        </div>
      )}

      {!viewOnly && composer === 'soap' && (
        <div style={{ marginBottom: 8, padding: 10, border: '1px solid #c7d2fe', borderRadius: 8, background: 'var(--pn-info-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#3730a3', letterSpacing: '.05em', textTransform: 'uppercase' }}>SOAP note</div>
            <a href="https://en.wikipedia.org/wiki/SOAP_note" target="_blank" rel="noopener" style={{ fontSize: 10, color: '#6366f1' }}>What's this?</a>
          </div>
          <SoapField label="S — Subjective" hint="What the client tells you (concerns, sensations, requests)" value={soap.s} onChange={v => setSoap(p => ({ ...p, s: v }))} autoFocus />
          <SoapField label="O — Objective"  hint="What you observed (nail/skin condition, redness, growth, etc.)" value={soap.o} onChange={v => setSoap(p => ({ ...p, o: v }))} />
          <SoapField label="A — Assessment" hint="Your interpretation (diagnosis, what you concluded)" value={soap.a} onChange={v => setSoap(p => ({ ...p, a: v }))} />
          <SoapField label="P — Plan"       hint="Treatment performed + plan for next visit / homecare" value={soap.p} onChange={v => setSoap(p => ({ ...p, p: v }))} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={reset} style={btnSecondary}>Cancel</button>
            <button onClick={commitSoap} style={{ ...btnPrimary, background: '#6366f1' }}>Save SOAP note</button>
          </div>
        </div>
      )}

      {!viewOnly && composer == null && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button onClick={() => setComposer('free')}
            style={{ flex: enableSoap ? 2 : 1, padding: '8px 10px', borderRadius: 8, border: '1px dashed #bfdbfe', background: 'var(--pn-info-bg)', color: 'var(--pn-info)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            + Add note
          </button>
          {enableSoap && <button onClick={() => setComposer('soap')} title="Clinical SOAP-format note: Subjective / Objective / Assessment / Plan"
            style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px dashed #c7d2fe', background: 'var(--pn-info-bg)', color: 'var(--pn-info)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            + SOAP note
          </button>}
        </div>
      )}

      {list.length === 0 && !hasLegacy && (
        <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--pn-text-faint)', textAlign: 'center', fontStyle: 'italic' }}>
          No notes yet.
        </div>
      )}

      {list.map((e, i) => (
        <div key={i} style={{ marginBottom: 6, padding: '8px 10px', borderRadius: 8, background: e.soap ? '#fafaff' : 'var(--pn-bg)', border: `1px solid ${e.soap ? '#e0e7ff' : 'var(--pn-border)'}` }}>
          {e.soap ? (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#4338ca', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>SOAP</div>
              {[['S', 'Subjective', e.soap.s], ['O', 'Objective', e.soap.o], ['A', 'Assessment', e.soap.a], ['P', 'Plan', e.soap.p]].map(([k, lbl, v]) => v ? (
                <div key={k} style={{ marginBottom: 3, fontSize: 13, lineHeight: 1.45 }}>
                  <span style={{ fontWeight: 700, color: '#3730a3' }}>{k}:</span>{' '}
                  <span style={{ whiteSpace: 'pre-wrap' }}>{v}</span>
                </div>
              ) : null)}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--pn-text)', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{e.text}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, fontSize: 10, color: 'var(--pn-text-faint)' }}>
            <span>
              {e.createdAt ? fmt(e.createdAt) : ''}
              {e.author ? ` · ${e.author}` : ''}
            </span>
            {!viewOnly && (
              <button onClick={() => deleteEntry(i)} title="Delete note"
                style={{ border: 'none', background: 'none', color: 'var(--pn-text-faint)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 4px' }}>
                ×
              </button>
            )}
          </div>
        </div>
      ))}

      {hasLegacy && (
        <div style={{ marginBottom: 6, padding: '8px 10px', borderRadius: 8, background: 'var(--pn-warning-bg)', border: '1px dashed #fde68a' }}>
          <div style={{ fontSize: 13, color: 'var(--pn-text)', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{legacy}</div>
          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--pn-warning)', letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 700 }}>Older note · pre-log</div>
        </div>
      )}
    </div>
  );
}

function SoapField({ label, hint, value, onChange, autoFocus }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#4338ca', letterSpacing: '.04em', marginBottom: 2 }}>{label}</div>
      <textarea
        autoFocus={autoFocus}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        placeholder={hint}
        style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '6px 9px', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.4, resize: 'vertical' }}
      />
    </div>
  );
}

const btnSecondary = { fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 };
const btnPrimary   = { fontSize: 12, padding: '6px 12px', borderRadius: 6, border: 'none', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 };
