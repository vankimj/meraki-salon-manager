import { useState, useEffect, useRef, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

// Public intake / waiver fill page. Reached via the HMAC-signed link
// `/?intake=<formId>&tid=&c=&t=&exp=` sent by sendIntakeLink. Loads the form
// through getPublicIntakeForm and submits through submitPublicIntake — the
// intakeResponses collection is server-only, so all I/O goes through callables.

const C = {
  ink: '#1a1410', muted: '#6b6258', rule: '#e2ddd2', bg: '#fbf8f1', card: '#ffffff',
  plum: '#6a4fa0', plumDeep: '#3f2767', danger: '#b3261e', ok: '#2D7A5F',
};

export default function IntakeFormScreen() {
  const params  = new URLSearchParams(window.location.search);
  const formId  = params.get('intake');
  const tid     = params.get('tid');
  const clientId = params.get('c');
  const token   = params.get('t');
  const exp     = params.get('exp');

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [answers, setAnswers] = useState({});
  const [signature, setSignature] = useState(null); // { dataUrl, signedName }
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]       = useState(false);

  useEffect(() => {
    if (!formId || !tid || !clientId || !token || !exp) {
      setError('This link is invalid.'); setLoading(false); return;
    }
    httpsCallable(functions, 'getPublicIntakeForm')({ tid, formId, c: clientId, t: token, exp })
      .then(res => setData(res?.data || null))
      .catch(e => setError(e?.message || 'Could not load this form.'))
      .finally(() => setLoading(false));
  }, [formId, tid, clientId, token, exp]);

  const setAnswer = useCallback((qid, value) => setAnswers(a => ({ ...a, [qid]: value })), []);

  async function submit() {
    setError('');
    const form = data?.form;
    if (!form) return;
    // Client-side required-field check (server re-validates).
    for (const q of form.questions || []) {
      if (q.readOnly || q.kind === 'signature') continue;
      if (!q.required) continue;
      const a = answers[q.id];
      const empty = q.kind === 'yes_no' ? (a !== true && a !== false)
        : q.kind === 'multi_choice' ? !(Array.isArray(a) && a.length)
        : (a == null || a === '');
      if (empty) { setError(`Please answer: ${q.label}`); return; }
    }
    const sigQ = (form.questions || []).find(q => q.kind === 'signature');
    if ((form.type === 'waiver' || sigQ?.required) && (!signature?.dataUrl || !signature?.signedName?.trim())) {
      setError('Please sign and type your name.'); return;
    }
    setSubmitting(true);
    try {
      await httpsCallable(functions, 'submitPublicIntake')({ tid, formId, c: clientId, t: token, exp, answers, signature });
      setDone(true);
    } catch (e) {
      setError(e?.message || 'Could not submit. Please try again.');
    } finally { setSubmitting(false); }
  }

  if (loading) return <Frame><div style={{ textAlign: 'center', color: C.muted, padding: 40 }}>Loading…</div></Frame>;
  if (error && !data) return <Frame><Banner kind="error">{error}</Banner></Frame>;
  if (done) return (
    <Frame salonName={data?.salonName}>
      <div style={{ textAlign: 'center', padding: '24px 8px' }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>✓</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 6 }}>All done — thank you!</div>
        <div style={{ fontSize: 14, color: C.muted }}>Your {data?.form?.type === 'waiver' ? 'signed waiver' : 'form'} was submitted to {data?.salonName || 'your trainer'}.</div>
      </div>
    </Frame>
  );

  const form = data.form;
  return (
    <Frame salonName={data.salonName}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.ink, fontFamily: 'Georgia, serif' }}>{form.name}</div>
        {data.clientName && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>For {data.clientName}</div>}
        {form.description && <div style={{ fontSize: 14, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>{form.description}</div>}
      </div>

      {(form.questions || []).map((q, i) => (
        <Question key={q.id || i} q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)}
                  signature={signature} onSign={setSignature} />
      ))}

      {error && <Banner kind="error">{error}</Banner>}
      <button onClick={submit} disabled={submitting}
        style={{ width: '100%', marginTop: 18, padding: '13px 18px', borderRadius: 12, border: 'none', background: C.plum, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: submitting ? .6 : 1 }}>
        {submitting ? 'Submitting…' : (form.type === 'waiver' ? 'Sign & submit' : 'Submit')}
      </button>
      <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 12 }}>🔒 Secure link · your responses are private to your trainer.</div>
    </Frame>
  );
}

function Question({ q, value, onChange, signature, onSign }) {
  if (q.readOnly) {
    return (
      <div style={{ marginBottom: 16 }}>
        {q.label && <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 6 }}>{q.label}</div>}
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, whiteSpace: 'pre-wrap', background: C.bg, border: `1px solid ${C.rule}`, borderRadius: 10, padding: 14, maxHeight: 240, overflowY: 'auto' }}>{q.body}</div>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 14, fontWeight: 600, color: C.ink, display: 'block', marginBottom: 7 }}>
        {q.label} {q.required && <span style={{ color: C.danger }}>*</span>}
      </label>
      <QuestionInput q={q} value={value} onChange={onChange} signature={signature} onSign={onSign} />
    </div>
  );
}

function QuestionInput({ q, value, onChange, signature, onSign }) {
  const inp = { width: '100%', fontFamily: 'inherit', fontSize: 14, padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.rule}`, background: C.card, outline: 'none', boxSizing: 'border-box' };
  switch (q.kind) {
    case 'long_text':
      return <textarea rows={3} value={value || ''} onChange={e => onChange(e.target.value)} style={{ ...inp, resize: 'vertical' }} />;
    case 'number':
      return <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value)} style={inp} />;
    case 'date':
      return <input type="date" value={value || ''} onChange={e => onChange(e.target.value)} style={inp} />;
    case 'yes_no':
      return (
        <div style={{ display: 'flex', gap: 8 }}>
          {[['Yes', true], ['No', false]].map(([label, val]) => (
            <button key={label} onClick={() => onChange(val)} type="button"
              style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1.5px solid ${value === val ? C.plum : C.rule}`, background: value === val ? '#f3eafc' : C.card, color: value === val ? C.plumDeep : C.muted, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {label}
            </button>
          ))}
        </div>
      );
    case 'single_choice':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(q.options || []).map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, padding: '8px 11px', borderRadius: 9, border: `1px solid ${value === opt ? C.plum : C.rule}`, background: value === opt ? '#f3eafc' : C.card, cursor: 'pointer' }}>
              <input type="radio" checked={value === opt} onChange={() => onChange(opt)} /> {opt}
            </label>
          ))}
        </div>
      );
    case 'multi_choice': {
      const arr = Array.isArray(value) ? value : [];
      const toggle = (opt) => onChange(arr.includes(opt) ? arr.filter(o => o !== opt) : [...arr, opt]);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(q.options || []).map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, padding: '8px 11px', borderRadius: 9, border: `1px solid ${arr.includes(opt) ? C.plum : C.rule}`, background: arr.includes(opt) ? '#f3eafc' : C.card, cursor: 'pointer' }}>
              <input type="checkbox" checked={arr.includes(opt)} onChange={() => toggle(opt)} /> {opt}
            </label>
          ))}
        </div>
      );
    }
    case 'signature':
      return <SignaturePad signature={signature} onSign={onSign} />;
    default:
      return <input value={value || ''} onChange={e => onChange(e.target.value)} style={inp} />;
  }
}

function SignaturePad({ signature, onSign }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [name, setName] = useState(signature?.signedName || '');

  const pos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e) => { e.preventDefault(); drawing.current = true; last.current = pos(e); };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const c = canvasRef.current; const ctx = c.getContext('2d');
    const p = pos(e);
    ctx.strokeStyle = '#1a1410'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    commit(name);
  };
  const commit = (nm) => {
    const c = canvasRef.current;
    onSign({ dataUrl: c.toDataURL('image/png'), signedName: nm });
  };
  const clear = () => {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    onSign(name ? { dataUrl: '', signedName: name } : null);
  };

  return (
    <div>
      <canvas ref={canvasRef} width={520} height={150}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        style={{ width: '100%', height: 150, border: `1.5px dashed ${C.rule}`, borderRadius: 10, background: C.card, touchAction: 'none', cursor: 'crosshair' }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <input value={name} onChange={e => { setName(e.target.value); if (signature?.dataUrl) commit(e.target.value); }}
          placeholder="Type your full name" style={{ flex: 1, fontFamily: 'inherit', fontSize: 14, padding: '9px 11px', borderRadius: 9, border: `1px solid ${C.rule}`, background: C.card, outline: 'none', boxSizing: 'border-box' }} />
        <button type="button" onClick={clear} style={{ padding: '9px 14px', borderRadius: 9, border: `1px solid ${C.rule}`, background: C.card, color: C.muted, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Clear</button>
      </div>
    </div>
  );
}

function Frame({ children, salonName }) {
  return (
    <div style={{ minHeight: '100dvh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 16px', fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,sans-serif" }}>
      {salonName && <div style={{ fontSize: 15, fontWeight: 700, color: C.plumDeep, marginBottom: 14, letterSpacing: '.02em' }}>{salonName}</div>}
      <div style={{ width: '100%', maxWidth: 560, background: C.card, border: `1px solid ${C.rule}`, borderRadius: 18, padding: '26px 24px', boxShadow: '0 12px 40px rgba(15,25,35,.08)' }}>
        {children}
      </div>
    </div>
  );
}

function Banner({ kind, children }) {
  const isErr = kind === 'error';
  return (
    <div style={{ fontSize: 13, color: isErr ? C.danger : C.ok, background: isErr ? '#fdecea' : '#eef7f1', border: `1px solid ${isErr ? '#f5c6c0' : '#bfe3cd'}`, borderRadius: 10, padding: '10px 13px', marginTop: 12 }}>
      {children}
    </div>
  );
}
