import { useState, useEffect } from 'react';

// Soft, dismissable first-visit tip that appears at the bottom of a
// module the first time a user lands on it. Persists "seen" state in
// localStorage per-device, so a salon owner sees each tip once.
//
// Usage:
//   <CoachMark id="schedule_intro" title="Tap a slot to book"
//     body="Click any empty time slot to create an appointment. Drag an
//           existing one to reschedule. Click a tech name at the top
//           to zoom into just that tech's column." />
//
// Designed to be unobtrusive — fixed to bottom-right, dismissable
// with one tap, never reappears for the same id.
export default function CoachMark({ id, title, body, icon = '💡', delay = 800 }) {
  const storageKey = `meraki:seen:${id}`;
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(storageKey)) return; // already dismissed
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [storageKey, delay]);

  function dismiss() {
    setClosing(true);
    try { localStorage.setItem(storageKey, new Date().toISOString()); } catch (_) {}
    setTimeout(() => setVisible(false), 200);
  }

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: 20, bottom: 20,
        maxWidth: 360, width: 'calc(100% - 40px)',
        background: 'var(--pn-surface)',
        border: '1px solid #bfdbfe',
        borderLeft: '4px solid #3D95CE',
        borderRadius: 12,
        boxShadow: '0 12px 36px rgba(0,0,0,.18)',
        padding: '14px 16px',
        zIndex: 10000,
        opacity: closing ? 0 : 1,
        transform: closing ? 'translateY(8px)' : 'translateY(0)',
        transition: 'opacity .2s, transform .2s',
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {title && (
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4, lineHeight: 1.35 }}>
              {title}
            </div>
          )}
          {body && (
            <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.55 }}>{body}</div>
          )}
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={dismiss}
              style={{
                fontSize: 12, fontWeight: 700, padding: '6px 14px',
                borderRadius: 8, border: 'none',
                background: '#3D95CE', color: '#fff',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              Got it
            </button>
          </div>
        </div>
        <button onClick={dismiss} aria-label="Dismiss tip"
          style={{
            border: 'none', background: 'none',
            color: 'var(--pn-text-faint)', cursor: 'pointer',
            fontSize: 18, lineHeight: 1, padding: 0,
            flexShrink: 0,
          }}>×</button>
      </div>
    </div>
  );
}
