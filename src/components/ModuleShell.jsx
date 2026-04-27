import { useApp } from '../context/AppContext';

const MODULE_ICONS = {
  schedule:  '📅',
  clients:   '👥',
  services:  '💅',
  employees: '👩‍💼',
  reports:   '📊',
  hr:        '💼',
};

export default function ModuleShell({ view, title, onHome, onAdmin, children }) {
  const { gUser, isAdmin, syncState } = useApp();
  const syncColor = { syncing: '#f59e0b', ok: '#22c55e', err: '#ef4444', idle: '#ddd' }[syncState] || '#ddd';
  const icon = MODULE_ICONS[view] || '◆';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '100dvh', background: '#f8f9fa' }}>
      {/* Top nav — taller on mobile for easier tapping */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #ebebeb',
        padding: '0 16px',
        height: 52,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        zIndex: 10,
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}>
        {/* Home button */}
        <button onClick={onHome}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#3D95CE', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '8px 6px', borderRadius: 6, flexShrink: 0, minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Home
        </button>

        <span style={{ color: '#e0e0e0', fontSize: 16, flexShrink: 0 }}>›</span>

        {/* Module title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: syncColor, transition: 'background .3s', animation: syncState === 'syncing' ? 'pulse .8s infinite' : 'none' }} />
          {isAdmin && (
            <button onClick={onAdmin} title="Admin Settings"
              style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid #e8e8e8', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>
              ⚙
            </button>
          )}
          {gUser?.photoURL && (
            <img src={gUser.photoURL} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />
          )}
        </div>
      </div>

      {/* Content — safe-area padding at bottom for iPhone home indicator */}
      <div style={{
        flex: 1,
        overflowY: view === 'schedule' ? 'hidden' : 'auto',
        overflowX: 'hidden',
        padding: 16,
        paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        display: view === 'schedule' ? 'flex' : 'block',
        flexDirection: 'column',
        WebkitOverflowScrolling: 'touch',
      }}>
        {children}
      </div>
    </div>
  );
}
