import { useState } from 'react';
import { useApp } from '../context/AppContext';
import AuthModal from './AuthModal';

const EXP = <svg width={15} height={15} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1 5V2h3M11 2h3v3M14 10v3h-3M4 13H1v-3"/></svg>;
const COL = <svg width={15} height={15} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 1v3H1M11 1v3h3M11 14v-3h3M4 14v-3H1"/></svg>;

function isFS() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

export default function Header({ slides, cur, def, onHome }) {
  const { gUser, syncState, isAdmin, signOut } = useApp();
  const [fs,        setFs]        = useState(false);
  const [showAuth,  setShowAuth]  = useState(false);

  function toggleFS() {
    const a = document.getElementById('deck-app');
    if (isFS()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
    else { a.requestFullscreen ? a.requestFullscreen() : a.webkitRequestFullscreen?.(); }
  }

  const syncColor = { syncing: '#f59e0b', ok: '#22c55e', err: '#ef4444', idle: '#ccc' }[syncState] || '#ccc';

  function handleUserChip() {
    if (!gUser) { setShowAuth(true); return; }
  }

  return (
    <>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '1px solid #e8e8e8', background: '#fff', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {onHome && (
            <button className="btn-icon" onClick={onHome} title="Back to home">
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </button>
          )}
          <button className="btn-icon" onClick={toggleFS} title="Fullscreen" onClickCapture={() => setTimeout(() => setFs(isFS()), 100)}>
            {fs ? COL : EXP}
          </button>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: syncColor, flexShrink: 0, transition: 'background .3s', animation: syncState === 'syncing' ? 'pulse .8s infinite' : 'none' }} />
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', paddingTop: 1 }}>
          {slides.map((_, i) => {
            const active   = i === cur;
            const isDefault = i === def;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ height: 6, borderRadius: 3, width: active ? 18 : 6, background: active ? '#333' : '#ccc', transition: 'width .25s, background .25s', outline: isDefault && !active ? '1.5px solid #f59e0b' : 'none', outlineOffset: 1 }} />
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: isDefault ? '#f59e0b' : 'transparent' }} />
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {gUser ? (
            <div onClick={handleUserChip} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#666', cursor: 'pointer', padding: '4px 8px', borderRadius: 20, border: '1px solid #e8e8e8' }}>
              {gUser.photoURL && <img src={gUser.photoURL} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} />}
              <span style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(gUser.displayName || gUser.email).split(' ')[0]}
              </span>
            </div>
          ) : (
            <button className="btn-icon" onClick={() => setShowAuth(true)} title="Sign in">
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            </button>
          )}
          <span style={{ fontSize: 11, fontWeight: 500, color: '#888', minWidth: 30, textAlign: 'right' }}>
            {slides.length ? `${cur + 1} / ${slides.length}` : '—'}
          </span>
        </div>
      </div>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
