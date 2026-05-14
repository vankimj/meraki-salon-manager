import { useEffect, useRef, useState } from 'react';
import { signOutNow } from '../lib/firebase.js';
import { C, radius } from '../theme.js';

// Auto-signs out after IDLE_MIN minutes of no user activity. Mirrors the
// salon-app pattern (settings.timeoutMin) but harder-coded here since
// every platform-admin session is high-privilege.
//
// 60s before logout, surfaces a non-blocking warning toast that the
// admin can dismiss (resetting the idle clock). Activity events
// (mousemove, keydown, scroll, touchstart, click) reset the clock.
//
// Render: invisible when idle countdown > warning threshold; renders a
// small fixed-bottom toast in the warning window.

const IDLE_MS    = 15 * 60 * 1000; // 15 min
const WARN_MS    =  1 * 60 * 1000; // surface 60s before logout

export default function SessionTimeout() {
  const [showWarning, setShowWarning] = useState(false);
  const lastActivity = useRef(Date.now());
  const timerId      = useRef(null);

  function reset() {
    lastActivity.current = Date.now();
    if (showWarning) setShowWarning(false);
  }

  useEffect(() => {
    function tick() {
      const idle = Date.now() - lastActivity.current;
      if (idle >= IDLE_MS) {
        signOutNow().finally(() => window.location.reload());
        return;
      }
      setShowWarning(idle >= IDLE_MS - WARN_MS);
    }
    const events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    for (const ev of events) window.addEventListener(ev, reset, { passive: true });
    timerId.current = setInterval(tick, 5000);
    return () => {
      clearInterval(timerId.current);
      for (const ev of events) window.removeEventListener(ev, reset);
    };
  }, [showWarning]);

  if (!showWarning) return null;
  const remainingSec = Math.max(0, Math.floor((IDLE_MS - (Date.now() - lastActivity.current)) / 1000));
  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20,
      padding: '12px 16px',
      background: C.danger, color: '#fff',
      borderRadius: radius.md,
      fontSize: 13, fontWeight: 600,
      boxShadow: '0 8px 24px rgba(220,38,38,.35)',
      zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 12,
      maxWidth: 360,
    }}>
      <div>Signing you out in {remainingSec}s of inactivity. Move your mouse to stay signed in.</div>
      <button onClick={reset} style={{
        background: 'rgba(255,255,255,.2)', color: '#fff',
        border: '1px solid rgba(255,255,255,.4)',
        padding: '4px 10px', borderRadius: 6,
        fontSize: 12, fontWeight: 700, cursor: 'pointer',
        fontFamily: 'inherit',
      }}>Stay</button>
    </div>
  );
}
