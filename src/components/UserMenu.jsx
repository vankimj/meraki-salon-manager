import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function UserMenu() {
  const { gUser, signOut, switchAccount } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!gUser) return null;

  const displayName = gUser.displayName || gUser.email;
  const firstName   = displayName.split(' ')[0];

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', padding: '5px 10px', borderRadius: 20, border: `1px solid ${open ? '#3D95CE' : '#e8e8e8'}`, background: open ? '#EBF4FB' : '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        {gUser.photoURL && (
          <img src={gUser.photoURL} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />
        )}
        <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {firstName}
        </span>
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <path d="M2 3.5l3 3 3-3" stroke="#aaa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.12)', width: 220, zIndex: 200, overflow: 'hidden' }}>
          {/* User info header */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {gUser.photoURL
                ? <img src={gUser.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                    {firstName[0].toUpperCase()}
                  </div>
              }
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
                <div style={{ fontSize: 11, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gUser.email}</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ padding: '6px 0' }}>
            <MenuItem
              icon="🔄"
              label="Sign in as another user"
              onClick={async () => { setOpen(false); await switchAccount(); }}
            />
            <MenuItem
              icon="↩"
              label="Sign out"
              color="#ef4444"
              onClick={() => { setOpen(false); signOut(); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, color, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', background: hover ? '#f8f9fa' : 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: color || '#333', textAlign: 'left' }}
    >
      <span style={{ fontSize: 15, width: 20, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
}
