import { useApp } from '../context/AppContext';
import { useState, useEffect } from 'react';
import AuthModal from './AuthModal';
import FeedbackModal from './FeedbackModal';
import UserMenu from './UserMenu';
import NotificationsBell from './NotificationsBell';
import TicketPanel from './TicketPanel';
import { MODULE_ICONS, IconLightbulb, IconChair, IconChevronRight, IconArrowUpRight, IconSettings, IconMessage } from './Icons';
import { MODULES, getVisibleModules, effectivePlan, isModuleAvailableForPlan } from '../lib/modules';
import { fetchWebfrontConfig, fetchEmployees } from '../lib/firestore';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen({ onNavigate, onAdmin }) {
  const { gUser, isAdmin, isReadOnly, isTech, isScheduler, settings, totalChatUnread, activeTheme: t, showToast, realIsAdmin, viewAs, setViewAs, users, requirePin, hasFeature } = useApp();
  const [showAuth,     setShowAuth]     = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [webCfg,       setWebCfg]       = useState(null);
  // Decide whether to show the one-click "My tech view" button. Two
  // independent signals — either is sufficient:
  //   1. The admin's user record has a `techName` set explicitly (Admin →
  //      Users → "Also a tech?" picker). Preserved across role changes by
  //      AppContext.grantAccess.
  //   2. The admin's email matches an active employee's email (auto-detect
  //      for tenants where the owner forgot the manual link).
  const myUserRec = users.find(u => (u.email || '').toLowerCase() === (gUser?.email || '').toLowerCase());
  const techNameFromUserRec = myUserRec?.techName || null;
  const [techNameFromEmployee, setTechNameFromEmployee] = useState(null);
  useEffect(() => {
    if (!gUser?.email || !realIsAdmin || techNameFromUserRec) {
      setTechNameFromEmployee(null);
      return;
    }
    fetchEmployees().then(emps => {
      const me = emps.find(e => (e.email || '').toLowerCase() === gUser.email.toLowerCase() && (e.active !== false));
      setTechNameFromEmployee(me?.name || null);
    }).catch(() => setTechNameFromEmployee(null));
  }, [gUser?.email, realIsAdmin, techNameFromUserRec]);
  const myTechEmpName = techNameFromUserRec || techNameFromEmployee;
  const canManage = isAdmin || isReadOnly;
  const plan = effectivePlan(settings);

  // Pre-login, settings is rules-blocked (staff-only). Fall back to the
  // publicly-readable webfront config so the header / hero show the
  // tenant's actual brand instead of "Plume Nexus" / "Meraki" defaults.
  useEffect(() => {
    if (!gUser && !webCfg) fetchWebfrontConfig().then(setWebCfg).catch(() => {});
  }, [gUser, webCfg]);
  // Resolution order: settings (signed-in) > webfront (public) > generic.
  const displayName = settings?.salonName || webCfg?.salonName || 'Plume Nexus';
  const heroBrand   = settings?.brandName || settings?.salonName || webCfg?.salonName || 'Plume Nexus';
  const techUsers = users.filter(u => u.role === 'tech' && u.techName);

  function previewLabel(va) {
    if (!va) return '';
    if (va.role === 'tech') return va.techName;
    if (va.role === 'scheduler') return 'Front desk';
    return 'View only';
  }

  function parsePreview(val) {
    if (!val) return null;
    if (val === 'scheduler') return { role: 'scheduler' };
    if (val === 'readonly') return { role: 'readonly' };
    if (val.startsWith('tech:')) return { role: 'tech', techName: val.slice(5) };
    return null;
  }

  function navigate(viewId) {
    const mod = MODULES.find(m => m.id === viewId);
    if (mod && !isModuleAvailableForPlan(mod, plan)) {
      showToast(`Upgrade to ${mod.plan === 'pro' ? 'Pro' : 'Enterprise'} to unlock ${mod.label}.`);
      return;
    }
    requirePin(viewId, () => onNavigate(viewId));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', background: 'var(--tm-bg, #f8f9fa)', overflowY: 'auto' }}>

      {/* Top bar */}
      <div style={{ background: '#fff', borderBottom: `1px solid var(--tm-border, #ebebeb)`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, width: '100%', boxSizing: 'border-box', gap: 8 }}>
        <div className="ms-brand-block" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--tm-grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 60 60" fill="none" width={18} height={18}><circle cx="30" cy="22" r="7" fill="white"/><path d="M14 50c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="white" strokeWidth="3.5" strokeLinecap="round"/></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="ms-brand-title" style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text, #1a1a1a)', lineHeight: 1.2 }}>{displayName}</div>
            <div className="ms-brand-subtitle" style={{ fontSize: 11, color: 'var(--tm-muted, #aaa)' }}>
              Salon Manager{t?.seasonal ? ` · ${t.seasonal.emoji}` : ''}
            </div>
          </div>
        </div>
        <div className="ms-topnav-right" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {isAdmin && (
            <button onClick={onAdmin} title="Admin Settings" className="ms-action-btn"
              style={{ height: 40, borderRadius: 20, border: 'none', background: 'var(--tm-primary, #2D7A5F)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,.25)' }}>
              <IconSettings size={16} /> <span className="ms-action-label">Admin</span>
            </button>
          )}
          {realIsAdmin && viewAs && (
            <button onClick={() => setViewAs(null)} title={`Exit preview: ${previewLabel(viewAs)}`}
              style={{ height: 40, borderRadius: 20, border: 'none', background: '#f59e0b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>
              ← Exit <span className="ms-impersonate-name">{previewLabel(viewAs)}</span>
            </button>
          )}
          {realIsAdmin && !viewAs && myTechEmpName && (
            <button onClick={() => setViewAs({ role: 'tech', techName: myTechEmpName })}
              title={`See your day as ${myTechEmpName}`} className="ms-action-btn"
              style={{ height: 40, borderRadius: 20, border: '1px solid #5b3b8c', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', fontSize: 13, fontWeight: 700, color: '#5b3b8c', fontFamily: 'inherit' }}>
              👩‍💼 <span className="ms-action-label">My tech view</span>
            </button>
          )}
          {realIsAdmin && !viewAs && (
            <select value="" onChange={e => { const v = parsePreview(e.target.value); if (v) setViewAs(v); }}
              className="ms-preview-select"
              style={{ height: 40, borderRadius: 20, border: '1px solid #e0e0e0', background: '#fafafa', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#888', fontFamily: 'inherit', padding: '0 12px', outline: 'none' }}>
              <option value="">👤 Preview as…</option>
              {techUsers.map(u => (
                <option key={u.email} value={`tech:${u.techName}`}>👩‍💼 {u.techName}</option>
              ))}
              <option value="scheduler">📅 Scheduler</option>
              <option value="readonly">👁 Read-only</option>
            </select>
          )}
          <button onClick={() => setShowFeedback(true)} title="Report a bug or idea" className="ms-action-btn"
            style={{ height: 40, borderRadius: 20, border: 'none', background: 'var(--tm-accent, #3D95CE)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>
            <IconMessage size={16} /> <span className="ms-action-label">Feedback</span>
          </button>
          {gUser && <TicketPanel />}
          {gUser && <NotificationsBell />}
          {gUser && <UserMenu />}
        </div>
      </div>

      {/* Preview-as banner */}
      {realIsAdmin && viewAs && (
        <div style={{ background: '#fef3c7', borderBottom: '1px solid #fcd34d', padding: '6px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, fontSize: 12, color: '#92400e', width: '100%', boxSizing: 'border-box' }}>
          <span>👤 Previewing as: <strong>{previewLabel(viewAs)}</strong> — changes are real; only the UI is restricted</span>
          <button onClick={() => setViewAs(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, color: '#92400e', fontFamily: 'inherit', fontSize: 12, padding: '0 4px' }}>✕ Exit</button>
        </div>
      )}

      {/* Greeting */}
      {gUser && (
        <div style={{ padding: '24px 24px 8px', flexShrink: 0, maxWidth: 1040, width: '100%', alignSelf: 'center', boxSizing: 'border-box' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-.3px' }}>
            {greeting()}, {(gUser.displayName || gUser.email).split(' ')[0]}
            <span style={{ marginLeft: 6 }}>👋</span>
          </div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4, letterSpacing: '.02em' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>
      )}

      {/* Hero — only shown when not signed in */}
      {!gUser && (
        <div style={{ padding: '40px 24px 32px', flexShrink: 0, maxWidth: 720, width: '100%', alignSelf: 'center', boxSizing: 'border-box', textAlign: 'center' }}>
          <div style={{ width: 76, height: 76, borderRadius: 22, background: 'var(--tm-grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', boxShadow: '0 12px 32px rgba(45,122,95,.25)' }}>
            <svg viewBox="0 0 60 60" fill="none" width={42} height={42}><circle cx="30" cy="22" r="7" fill="white"/><path d="M14 50c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="white" strokeWidth="3.5" strokeLinecap="round"/></svg>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1a1a1a', margin: 0, letterSpacing: '-.5px' }}>Welcome to {heroBrand}</h1>
          <p style={{ fontSize: 14, color: '#888', marginTop: 8, marginBottom: 24, lineHeight: 1.6 }}>
            Sign in to manage appointments, clients, and your team.
          </p>
          <button onClick={() => setShowAuth(true)}
            style={{ fontSize: 15, fontWeight: 700, padding: '13px 40px', borderRadius: 12, border: 'none', background: 'var(--tm-primary, #2D7A5F)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 6px 18px rgba(45,122,95,.28)', letterSpacing: '.02em', transition: 'transform .15s, box-shadow .15s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 22px rgba(45,122,95,.32)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(45,122,95,.28)'; }}>
            Sign in
          </button>
          {/* SaaS "Powered by" mark — only on the pre-login surface so it
              feels like a footer credit rather than in-app chrome. Hidden
              when the tenant IS Plume Nexus itself (would be redundant). */}
          {heroBrand !== 'Plume Nexus' && (
            <div style={{ marginTop: 36, fontSize: 11, color: '#aaa', letterSpacing: '.04em' }}>
              Powered by{' '}
              <a href="https://plumenexus.com" target="_blank" rel="noopener noreferrer"
                style={{ color: '#888', textDecoration: 'none', fontWeight: 600 }}
                onMouseEnter={e => { e.currentTarget.style.color = '#2D7A5F'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#888'; }}>
                Plume Nexus Salon Manager
              </a>
            </div>
          )}
        </div>
      )}

      {/* Module tiles */}
      <div style={{ padding: '16px 24px 0', flex: 1, maxWidth: gUser ? 1040 : 720, width: '100%', alignSelf: 'center', boxSizing: 'border-box' }}>
        {isTech ? (
          <>
            <SectionLabel>My Tools</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
              <ModuleTile id="schedule"  label="My Schedule" desc="Your appointments & checkout"  onClick={() => navigate('schedule')}  />
              <ModuleTile id="earnings"  label="My Earnings" desc="Tips, services & take-home"   onClick={() => navigate('earnings')}  />
              <ModuleTile id="clients"   label="Clients"     desc="Profiles & visit history"      onClick={() => navigate('clients')}   />
              <ModuleTile id="services"  label="Services"    desc="Menu & pricing"                onClick={() => navigate('services')}  />
              <ModuleTile id="employees" label="Team"        desc="Staff profiles"                onClick={() => navigate('employees')} />
              <ModuleTile id="hr"        label="Tax Forms"   desc="Your 1099s"                    onClick={() => navigate('hr')}        />
            </div>
          </>
        ) : isScheduler ? (
          <>
            <SectionLabel>Scheduling</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
              <ModuleTile id="schedule" label="Schedule"  desc="Appointments & calendar"   onClick={() => navigate('schedule')}  />
              <ModuleTile id="walkin"   label="Walk-in Kiosk" desc="Live turn rotation + waitlist" onClick={() => navigate('walkin')} />
              <ModuleTile id="clients"  label="Clients"   desc="Profiles & visit history"  onClick={() => navigate('clients')}   />
              <ModuleTile id="services" label="Services"  desc="Menu & pricing"             onClick={() => navigate('services')}  />
              <ModuleTile id="chat"     label="Communications" desc="SMS, email & in-app messages" onClick={() => navigate('chat')}      badge={totalChatUnread} />
            </div>
          </>
        ) : canManage ? (
          <>
            <SectionLabel>Manage</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
              {getVisibleModules(settings, { isAdmin, hiddenTiles: settings?.hiddenTiles }).map(m => (
                <ModuleTile key={m.id} {...m} onClick={() => navigate(m.id)} badge={m.id === 'chat' ? totalChatUnread : 0} />
              ))}
            </div>
          </>
        ) : !gUser ? null : (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa', fontSize: 13 }}>
            Your access is pending admin approval.
          </div>
        )}

        {/* Kiosk launchers — not shown to techs or schedulers */}
        {!isTech && !isScheduler && (
          <div style={{ marginBottom: 24 }}>
            <SectionLabel>Kiosk</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              <KioskCard
                Icon={IconLightbulb}
                label="Launch Tip Flow"
                desc="Full-screen kiosk for front desk iPad"
                background="var(--tm-grad)"
                ArrowIcon={IconChevronRight}
                onClick={() => navigate('tipflow')}
              />
              <KioskCard
                Icon={IconChair}
                label="Walk-in Queue Kiosk"
                desc="Self check-in for walk-ins & arrivals"
                background="var(--tm-grad-dark)"
                ArrowIcon={IconArrowUpRight}
                onClick={() => window.open('/?queue', '_blank')}
              />
            </div>
          </div>
        )}
      </div>


      {showAuth     && <AuthModal    onClose={() => setShowAuth(false)} />}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      {/* Canary ribbon — demonstrates the feature-flag pipeline end-to-end.
          Visible only for tenants where the `canaryRibbon` flag resolves
          to true (see src/lib/featureFlags.js — currently `demo` tier only).
          Safe to remove once the team is comfortable with feature flags. */}
      {hasFeature?.('canaryRibbon') && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(90deg,#f59e0b,#fbbf24)',
          color: '#78350f', fontSize: 11, fontWeight: 700,
          padding: '5px 12px', textAlign: 'center', letterSpacing: '.05em',
          textTransform: 'uppercase', zIndex: 1000,
          boxShadow: '0 -2px 8px rgba(0,0,0,.08)',
        }}>
          Canary release — testing pre-release features
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 12, paddingLeft: 2 }}>
      {children}
    </div>
  );
}

function KioskCard({ Icon, label, desc, background, ArrowIcon, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', background, border: 'none', borderRadius: 16,
        padding: '20px 22px', cursor: 'pointer', display: 'flex',
        alignItems: 'center', gap: 16, fontFamily: 'inherit', textAlign: 'left',
        boxShadow: hover ? '0 12px 32px rgba(0,0,0,.18)' : '0 4px 14px rgba(0,0,0,.10)',
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform .18s ease, box-shadow .18s ease',
      }}>
      <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, backdropFilter: 'blur(4px)', color: '#fff' }}>
        <Icon size={24} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 2, letterSpacing: '-.1px' }}>{label}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.78)', lineHeight: 1.4 }}>{desc}</div>
      </div>
      <div style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.85)', display: 'flex', alignItems: 'center', transform: hover ? 'translateX(3px)' : 'translateX(0)', transition: 'transform .18s ease', flexShrink: 0 }}>
        <ArrowIcon size={20} />
      </div>
    </button>
  );
}

function ModuleTile({ id, label, desc, onClick, badge, locked }) {
  const [hover, setHover] = useState(false);
  const Icon = MODULE_ICONS[id];
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', background: locked ? '#fafafa' : '#fff',
        border: `1px solid ${locked ? '#ececec' : hover ? 'var(--tm-accent, #3D95CE)' : '#ececec'}`,
        borderRadius: 16, padding: '18px 16px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
        transition: 'border-color .18s, box-shadow .18s, transform .18s',
        boxShadow: hover ? '0 8px 24px rgba(0,0,0,.10)' : '0 1px 3px rgba(0,0,0,.04)',
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
        opacity: locked ? 0.78 : 1,
      }}
    >
      {locked && (
        <div style={{ position: 'absolute', top: 10, right: 10, background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 20, letterSpacing: '.06em', boxShadow: '0 2px 6px rgba(124,58,237,.3)' }}>PRO</div>
      )}
      <div style={{ position: 'relative', width: 44, height: 44, borderRadius: 12, background: locked ? '#f0f0f0' : 'var(--tm-grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, boxShadow: locked ? 'none' : '0 4px 10px rgba(45,122,95,.18)', color: locked ? '#aaa' : '#fff' }}>
        {Icon ? <Icon size={22} /> : <span style={{ fontSize: 22 }}>◆</span>}
        {badge > 0 && (
          <div style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center', lineHeight: '14px', border: '2px solid #fff', boxShadow: '0 2px 4px rgba(0,0,0,.15)' }}>
            {badge > 9 ? '9+' : badge}
          </div>
        )}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: locked ? '#aaa' : '#1a1a1a', marginBottom: 3, letterSpacing: '-.1px' }}>{label}</div>
      <div style={{ fontSize: 12, color: '#888', lineHeight: 1.45 }}>{desc}</div>
    </button>
  );
}
