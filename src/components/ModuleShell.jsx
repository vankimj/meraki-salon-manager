import { useState } from 'react';
import { useApp } from '../context/AppContext';
import FeedbackModal from './FeedbackModal';
import UserMenu from './UserMenu';
import NotificationsBell from './NotificationsBell';
import TicketPanel from './TicketPanel';
import { MODULE_ICONS, IconHome, IconSettings, IconMessage } from './Icons';
import { MODULES, getVisibleModules, isModuleAvailableForPlan, effectivePlan } from '../lib/modules';

export default function ModuleShell({ view, title, onHome, onAdmin, onNavigate, children }) {
  const { isAdmin, isReadOnly, isTech, isScheduler, settings, totalChatUnread, realIsAdmin, viewAs, setViewAs, syncState, isOnline, activeTheme: t, users, requirePin } = useApp();
  const guardedNavigate = (id) => requirePin(id, () => onNavigate?.(id));
  const plan = effectivePlan(settings);
  const canManage = isAdmin || isReadOnly;

  // Build the per-role sidebar list. Single catalog (src/lib/modules.js) is
  // the source of truth for plan gating + admin-only flags + per-tile hide
  // preferences, matching HomeScreen's logic so the sidebar and dashboard
  // never disagree.
  const sidebarItems = (() => {
    if (isTech) {
      return ['schedule','clients','services','employees','hr']
        .map(id => MODULES.find(m => m.id === id)).filter(Boolean)
        .filter(m => isModuleAvailableForPlan(m, plan));
    }
    if (isScheduler) {
      return ['schedule','clients','services','chat']
        .map(id => MODULES.find(m => m.id === id)).filter(Boolean)
        .filter(m => isModuleAvailableForPlan(m, plan));
    }
    if (canManage) {
      return getVisibleModules(settings, { isAdmin, hiddenTiles: settings?.hiddenTiles });
    }
    return [];
  })();
  const techUsers = users.filter(u => u.role === 'tech' && u.techName);

  function previewLabel(va) {
    if (!va) return '';
    if (va.role === 'tech') return va.techName;
    if (va.role === 'scheduler') return 'Scheduler';
    return 'Read-only';
  }

  function parsePreview(val) {
    if (!val) return null;
    if (val === 'scheduler') return { role: 'scheduler' };
    if (val === 'readonly') return { role: 'readonly' };
    if (val.startsWith('tech:')) return { role: 'tech', techName: val.slice(5) };
    return null;
  }
  const [showFeedback, setShowFeedback] = useState(false);
  const syncColor = { syncing: '#f59e0b', ok: '#22c55e', err: '#ef4444', idle: '#ddd' }[syncState] || '#ddd';
  const ModuleIcon = MODULE_ICONS[view];

  return (
    <div className="ms-root" style={{ display: 'flex', flexDirection: 'row', height: '100%', minHeight: '100dvh', background: 'var(--tm-bg, #f8f9fa)' }}>
      {/* Desktop left-rail navigation */}
      {sidebarItems.length > 0 && (
        <nav className="ms-sidebar" style={{
          width: 220, flexShrink: 0, background: '#fff',
          borderRight: '1px solid var(--tm-border, #ebebeb)',
          display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100dvh',
          overflowY: 'auto',
        }}>
          <button onClick={onHome}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid #f0f0f0', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--tm-grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg viewBox="0 0 60 60" fill="none" width={16} height={16}><circle cx="30" cy="22" r="7" fill="white"/><path d="M14 50c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="white" strokeWidth="3.5" strokeLinecap="round"/></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2 }}>Meraki</div>
              <div style={{ fontSize: 10, color: 'var(--tm-muted, #aaa)' }}>Salon Manager</div>
            </div>
          </button>
          <div style={{ flex: 1, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sidebarItems.map(m => {
              const Icon   = MODULE_ICONS[m.id];
              const active = m.id === view;
              const locked = false; // gated upstream — locked items already filtered out
              const badge  = m.id === 'chat' ? totalChatUnread : 0;
              return (
                <button key={m.id} onClick={() => guardedNavigate(m.id)}
                  title={m.label}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderRadius: 10,
                    border: 'none', background: active ? 'var(--tm-primary, #2D7A5F)' : 'transparent',
                    color: active ? '#fff' : locked ? '#bbb' : '#444',
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 13, fontWeight: active ? 700 : 500, textAlign: 'left',
                    transition: 'background .15s, color .15s',
                    opacity: locked && !active ? 0.7 : 1,
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f5f5f5'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                  {Icon ? <Icon size={16} /> : <span style={{ width: 16 }} />}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                  {locked && <span style={{ fontSize: 9, fontWeight: 800, color: active ? 'rgba(255,255,255,.85)' : '#7c3aed', background: active ? 'rgba(255,255,255,.18)' : '#ede9fe', padding: '2px 6px', borderRadius: 6, letterSpacing: '.04em' }}>PRO</span>}
                  {!locked && badge > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#ef4444', borderRadius: 10, padding: '1px 6px', minWidth: 16, textAlign: 'center' }}>
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {isAdmin && (
            <button onClick={onAdmin} title="Admin Settings"
              style={{ margin: 12, padding: '10px 12px', borderRadius: 10, border: 'none', background: 'var(--tm-grad)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <IconSettings size={14} /> Admin Settings
            </button>
          )}
        </nav>
      )}
      <style>{`@media (max-width: 899px) { .ms-sidebar { display: none !important; } }`}</style>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100dvh', minWidth: 0 }}>
      {/* Top nav — taller on mobile for easier tapping. position:relative
          activates the zIndex so this stacking context lifts above the
          schedule's sticky tech-header row (z-index 10 there). */}
      <div style={{
        background: '#fff',
        borderBottom: `1px solid var(--tm-border, #ebebeb)`,
        padding: '0 16px',
        height: 52,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        position: 'relative',
        zIndex: 100,
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}>
        {/* Home button */}
        <button onClick={onHome}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--tm-accent, #3D95CE)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '8px 6px', borderRadius: 6, flexShrink: 0, minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <IconHome size={15} />
          Home
        </button>

        <span style={{ color: '#e0e0e0', fontSize: 16, flexShrink: 0 }}>›</span>

        {/* Module title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, color: '#555' }}>
          {ModuleIcon ? <ModuleIcon size={18} /> : <span style={{ fontSize: 16 }}>◆</span>}
          <span style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: syncColor, transition: 'background .3s', animation: syncState === 'syncing' ? 'pulse .8s infinite' : 'none' }} />
          {realIsAdmin && viewAs && (
            <button onClick={() => setViewAs(null)} title="Exit preview"
              style={{ height: 40, borderRadius: 20, border: 'none', background: '#f59e0b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>
              ← Exit {previewLabel(viewAs)}
            </button>
          )}
          {isAdmin && (
            <button onClick={onAdmin} title="Admin Settings"
              style={{ height: 40, borderRadius: 20, border: 'none', background: 'var(--tm-primary, #2D7A5F)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,.25)' }}>
              <IconSettings size={16} /> Admin
            </button>
          )}
          {realIsAdmin && !viewAs && (
            <select value="" onChange={e => { const v = parsePreview(e.target.value); if (v) setViewAs(v); }}
              style={{ height: 40, borderRadius: 20, border: '1px solid #e0e0e0', background: '#fafafa', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#888', fontFamily: 'inherit', padding: '0 12px', outline: 'none' }}>
              <option value="">👤 Preview as…</option>
              {techUsers.map(u => (
                <option key={u.email} value={`tech:${u.techName}`}>👩‍💼 {u.techName}</option>
              ))}
              <option value="scheduler">📅 Scheduler</option>
              <option value="readonly">👁 Read-only</option>
            </select>
          )}
          <button onClick={() => setShowFeedback(true)} title="Report a bug or idea"
            style={{ height: 40, borderRadius: 20, border: 'none', background: 'var(--tm-accent, #3D95CE)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>
            <IconMessage size={16} /> Feedback
          </button>
          <TicketPanel />
          <NotificationsBell />
          <UserMenu />
        </div>
      </div>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      {/* Tech-view impersonation banner */}
      {realIsAdmin && viewAs && (
        <div style={{ background: '#fef3c7', borderBottom: '1px solid #fcd34d', padding: '6px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, fontSize: 12, color: '#92400e' }}>
          <span>👤 Previewing as: <strong>{previewLabel(viewAs)}</strong> — changes are real; only the UI is restricted</span>
          <button onClick={() => setViewAs(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, color: '#92400e', fontFamily: 'inherit', fontSize: 12, padding: '0 4px' }}>✕ Exit</button>
        </div>
      )}

      {/* Content — safe-area padding at bottom for iPhone home indicator */}
      {!isOnline && (
        <div style={{
          background: '#fef3c7',
          borderBottom: '1px solid #fcd34d',
          color: '#92400e',
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'center',
          justifyContent: 'center',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
          Offline — your changes are being saved locally and will sync when you reconnect.
        </div>
      )}
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
    </div>
  );
}
