import { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import Slide from './Slide';

// Display-only TipFlow kiosk: a slider of tech headshots + tip/social QRs.
// Slides are managed in Admin → Settings → TipFlow Kiosk Slides (no inline
// editing here, so the kiosk can't be modified by a passer-by).
export default function TipFlow() {
  const { slides, def, cur, setCur, resetInactivity } = useApp();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const trackRef   = useRef(null);
  const swipeStart = useRef(null);

  // ── Fullscreen state mirroring (so the icon flips correctly) ──
  useEffect(() => {
    const sync = () => setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  // ── Navigation ─────────────────────────────────────────
  const navigate = useCallback((dir) => {
    setCur(c => {
      const next = c + dir;
      return next >= 0 && next < slides.length ? next : c;
    });
    resetInactivity();
  }, [slides.length, setCur, resetInactivity]);

  // ── Keyboard ───────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowLeft')  navigate(-1);
      if (e.key === 'ArrowRight') navigate(1);
      if (e.key === 'f' || e.key === 'F') toggleFS();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // ── Swipe ──────────────────────────────────────────────
  function onPointerDown(e) {
    swipeStart.current = { x: e.clientX || e.touches?.[0]?.clientX, y: e.clientY || e.touches?.[0]?.clientY };
  }
  function onPointerUp(e) {
    if (!swipeStart.current) return;
    const dx = (e.clientX || e.changedTouches?.[0]?.clientX || 0) - swipeStart.current.x;
    const dy = (e.clientY || e.changedTouches?.[0]?.clientY || 0) - swipeStart.current.y;
    swipeStart.current = null;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 48) navigate(dx < 0 ? 1 : -1);
  }

  // ── Track position ─────────────────────────────────────
  useEffect(() => {
    if (trackRef.current) trackRef.current.style.transform = `translateX(-${cur * 100}%)`;
  }, [cur]);

  return (
    <>
      {/* Top bar — Fullscreen toggle only */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '8px 14px', borderBottom: '1px solid #e8e8e8', background: '#fff', minHeight: 48, userSelect: 'none', zIndex: 2 }}>
        <button className="btn-icon" onClick={toggleFS} title="Fullscreen"
          style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#333' }}>
          {isFullscreen ? COL_ICON : EXP_ICON}
        </button>
      </div>

      {/* Slider */}
      <div style={{ flex: 1, overflow: 'hidden', cursor: 'grab', userSelect: 'none', minHeight: 0 }}
           onMouseDown={onPointerDown} onMouseUp={onPointerUp}
           onTouchStart={onPointerDown} onTouchEnd={onPointerUp}>
        <div ref={trackRef} style={{ display: 'flex', height: '100%', transition: 'transform .42s cubic-bezier(.25,.46,.45,.94)', willChange: 'transform' }}>
          {slides.length
            ? slides.map((sl, i) => <Slide key={i} slide={sl} isDefault={i === def} />)
            : <div style={{ minWidth: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.3" strokeLinecap="round"><circle cx="12" cy="9" r="5"/><path d="M3 21c0-5 4-9 9-9s9 4 9 9"/></svg>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#aaa' }}>No slides yet — add them in Admin → Settings</div>
              </div>
          }
        </div>
      </div>

      {/* Bottom nav — prev / next only */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '10px 16px', borderTop: '1px solid #e8e8e8', background: '#fff', zIndex: 2 }}>
        <button onClick={() => navigate(-1)} disabled={cur === 0 || !slides.length} style={circleBtn}>
          <svg width={13} height={13} viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8.5 1.5l-4 5 4 5"/></svg>
        </button>
        <span style={{ fontSize: 11, fontWeight: 500, color: '#888', minWidth: 44, textAlign: 'center' }}>
          {slides.length ? `${cur + 1} / ${slides.length}` : '—'}
        </span>
        <button onClick={() => navigate(1)} disabled={cur === slides.length - 1 || !slides.length} style={circleBtn}>
          <svg width={13} height={13} viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4.5 1.5l4 5-4 5"/></svg>
        </button>
      </div>
    </>
  );
}

const EXP_ICON = <svg width={15} height={15} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1 5V2h3M11 2h3v3M14 10v3h-3M4 13H1v-3"/></svg>;
const COL_ICON = <svg width={15} height={15} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 1v3H1M11 1v3h3M11 14v-3h3M4 14v-3H1"/></svg>;

function toggleFS() {
  const a = document.getElementById('deck-app');
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    a.requestFullscreen ? a.requestFullscreen() : a.webkitRequestFullscreen?.();
  }
}

const circleBtn = { width: 34, height: 34, borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', background: '#fff', border: '1px solid #d0d0d0', color: '#333' };
