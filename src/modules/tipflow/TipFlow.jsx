import { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import Slide from './Slide';
import SlideModal from './SlideModal';
import AuthModal from '../../components/AuthModal';
import { logActivity } from '../../lib/logger';

export default function TipFlow() {
  const { slides, def, cur, setCur, deleteSlide, setDefault, isReadOnly, gUser, showToast, resetInactivity } = useApp();

  const [actionsVisible, setActionsVisible]   = useState(false);
  const [showSlideModal, setShowSlideModal]   = useState(false);
  const [editIndex,      setEditIndex]        = useState(-1);
  const [authPending,    setAuthPending]      = useState(null);
  const [showAuth,       setShowAuth]         = useState(false);
  const [isFullscreen,   setIsFullscreen]     = useState(false);

  const actionsTimer = useRef(null);
  const trackRef     = useRef(null);
  const swipeStart   = useRef(null);

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

  // ── Actions panel: 5s auto-hide after reveal ──────────
  const showActions = useCallback(() => {
    setActionsVisible(true);
    clearTimeout(actionsTimer.current);
    actionsTimer.current = setTimeout(() => setActionsVisible(false), 5000);
  }, []);
  const hideActions = useCallback(() => { setActionsVisible(false); clearTimeout(actionsTimer.current); }, []);
  const toggleActions = useCallback(() => actionsVisible ? hideActions() : showActions(), [actionsVisible, showActions, hideActions]);

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
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); toggleActions(); }
      if (e.key === 'f' || e.key === 'F') toggleFS();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, toggleActions]);

  // ── Swipe ──────────────────────────────────────────────
  function onPointerDown(e) {
    swipeStart.current = { x: e.clientX || e.touches?.[0]?.clientX, y: e.clientY || e.touches?.[0]?.clientY };
  }
  function onPointerUp(e) {
    if (!swipeStart.current) return;
    const dx = (e.clientX || e.changedTouches?.[0]?.clientX || 0) - swipeStart.current.x;
    const dy = (e.clientY || e.changedTouches?.[0]?.clientY || 0) - swipeStart.current.y;
    swipeStart.current = null;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 38) { toggleActions(); return; }
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 48) navigate(dx < 0 ? 1 : -1);
  }

  // ── Track position ─────────────────────────────────────
  useEffect(() => {
    if (trackRef.current) trackRef.current.style.transform = `translateX(-${cur * 100}%)`;
  }, [cur]);

  // ── Auth guard ─────────────────────────────────────────
  function requireAuth(cb) {
    if (isReadOnly) { cb(); return; }
    setAuthPending(() => cb);
    setShowAuth(true);
  }

  function handleDelete() {
    requireAuth(async () => {
      const name = slides[cur]?.name || 'unnamed';
      await deleteSlide(cur);
      logActivity('slide_deleted', name);
      hideActions();
    });
  }
  function handleEdit() {
    requireAuth(() => { setEditIndex(cur); setShowSlideModal(true); hideActions(); });
  }
  function handleAdd() {
    requireAuth(() => { setEditIndex(-1); setShowSlideModal(true); hideActions(); });
  }
  async function handleSetDefault() {
    requireAuth(async () => {
      await setDefault(cur);
      logActivity('default_set', slides[cur]?.name || `slide ${cur + 1}`);
      showToast('Default slide set');
      hideActions();
    });
  }

  const isDefault = cur === def;

  return (
    <>
      {/* Top bar — Fullscreen on the left, tap anywhere to reveal action buttons */}
      <div onClick={showActions}
        style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #e8e8e8', background: '#fff', minHeight: 48, cursor: 'pointer', userSelect: 'none', zIndex: 2 }}>
        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); toggleFS(); }} title="Fullscreen"
          style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#333' }}>
          {isFullscreen ? COL_ICON : EXP_ICON}
        </button>

        <div style={{
          display: 'flex', gap: 6,
          opacity: actionsVisible ? 1 : 0,
          transform: actionsVisible ? 'translateY(0)' : 'translateY(-4px)',
          pointerEvents: actionsVisible ? 'auto' : 'none',
          transition: 'opacity .28s ease, transform .28s ease',
        }}>
          <ActionBtn onClick={handleDelete}>🗑 Delete</ActionBtn>
          <ActionBtn onClick={handleEdit}>✎ Edit</ActionBtn>
          <ActionBtn onClick={handleAdd}>+ Add</ActionBtn>
          <ActionBtn onClick={handleSetDefault}>{isDefault ? '★ Default ✓' : '★ Default'}</ActionBtn>
        </div>
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
                <div style={{ fontSize: 14, fontWeight: 500, color: '#aaa' }}>No slides yet</div>
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

      {showSlideModal && <SlideModal editIndex={editIndex} onClose={() => setShowSlideModal(false)} />}

      {showAuth && (
        <AuthModal
          onClose={() => { setShowAuth(false); setAuthPending(null); }}
          onSuccess={() => { if (authPending) { authPending(); setAuthPending(null); } }}
        />
      )}
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

function ActionBtn({ onClick, children }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      style={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 500, cursor: 'pointer', background: '#fff', border: '1px solid #d0d0d0', borderRadius: 8, padding: '0 9px', height: 28, color: '#333' }}>
      {children}
    </button>
  );
}
