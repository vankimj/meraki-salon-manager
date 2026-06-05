import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { createFeedback } from '../lib/firestore';

export default function FeedbackModal({ onClose }) {
  const { gUser } = useApp();
  const [type,    setType]    = useState('idea');
  const [text,    setText]    = useState('');
  const [sending, setSending] = useState(false);
  const [done,    setDone]    = useState(false);

  async function handleSubmit() {
    if (!text.trim()) return;
    setSending(true);
    try {
      await createFeedback({
        type,
        text: text.trim(),
        submittedBy: { email: gUser?.email || '', name: gUser?.displayName || '' },
      });
      setDone(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '92%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,.25)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--pn-border)' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Report a bug or idea</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ padding: '18px 18px 20px' }}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>{type === 'bug' ? '🐛' : '💡'}</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Thanks!</div>
              <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', lineHeight: 1.5, marginBottom: 18 }}>
                Your {type === 'bug' ? 'bug report' : 'idea'} has been submitted.
              </div>
              <button onClick={onClose} style={btnStyle('#3D95CE')}>Close</button>
            </div>
          ) : (
            <>
              {/* Type selector */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {[['bug', '🐛 Bug'], ['idea', '💡 Idea']].map(([val, label]) => (
                  <button key={val} onClick={() => setType(val)} style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: type === val ? 600 : 400,
                    border: `1px solid ${type === val ? '#3D95CE' : 'var(--pn-border-strong)'}`,
                    background: type === val ? 'var(--pn-info-bg)' : 'var(--pn-bg)',
                    color: type === val ? 'var(--pn-info)' : 'var(--pn-text-muted)',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Text */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 5 }}>
                  {type === 'bug' ? 'What went wrong? What did you expect?' : 'Describe your idea'}
                </label>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={4}
                  placeholder={type === 'bug' ? 'e.g. When I click Save on a client, nothing happens…' : 'e.g. It would be great if we could…'}
                  style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, border: `1px solid ${text.trim() ? 'var(--pn-border-strong)' : '#fca5a5'}`, borderRadius: 8, padding: '8px 12px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: 1.5 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onClose} style={btnStyle('var(--pn-surface-alt)', 'var(--pn-text)')}>Cancel</button>
                <button onClick={handleSubmit} disabled={sending || !text.trim()} style={btnStyle('#3D95CE', '#fff', sending || !text.trim())}>
                  {sending ? 'Sending…' : 'Submit'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function btnStyle(bg, color = '#fff', disabled = false) {
  return {
    flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
    background: disabled ? 'var(--pn-surface-muted)' : bg,
    color: disabled ? 'var(--pn-text-faint)' : color,
    fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'inherit',
  };
}
