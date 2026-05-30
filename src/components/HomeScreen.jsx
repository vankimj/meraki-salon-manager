import { useApp } from '../context/AppContext';
import { useState, useEffect } from 'react';
import AuthModal from './AuthModal';
import FeedbackModal from './FeedbackModal';
import UserMenu from './UserMenu';
import NotificationsBell from './NotificationsBell';
import TicketPanel from './TicketPanel';
import HeroMerakiSite from './HeroMerakiSite';
import { MODULE_ICONS, IconLightbulb, IconChair, IconChevronRight, IconArrowUpRight, IconSettings, IconMessage } from './Icons';
import { MODULES, getVisibleModules, effectivePlan, isModuleAvailableForPlan } from '../lib/modules';
import { fetchWebfrontConfig, fetchEmployees } from '../lib/firestore';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function timeAware() {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Good morning',   icon: 'sun' };
  if (h < 17) return { text: 'Good afternoon', icon: 'sun' };
  return { text: 'Good evening', icon: 'moon' };
}

function splitBrandName(name) {
  if (!name) return ['Plume', 'Nexus'];
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return [words[0], ''];
  return [words[0], words.slice(1).join(' ')];
}

const WELCOME_STYLES = ['centered', 'hairlineSplit', 'stacked', 'photo', 'photoSplit', 'merakiSite'];

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
  const welcomeStyleRaw = settings?.welcomeStyle || webCfg?.welcomeStyle || 'centered';
  const welcomeStyle = WELCOME_STYLES.includes(welcomeStyleRaw) ? welcomeStyleRaw : 'centered';
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
      const tierLabel = mod.plan.charAt(0).toUpperCase() + mod.plan.slice(1);
      showToast(`Upgrade to ${tierLabel} to unlock ${mod.label}.`);
      return;
    }
    requirePin(viewId, () => onNavigate(viewId));
  }

  // Full-takeover homepage variant — pre-login only. Replaces every other
  // chrome (top bar, tiles, etc) with a single editorial landing page.
  if (!gUser && welcomeStyle === 'merakiSite') {
    return (
      <div style={{ height: '100%', overflowY: 'auto', background: '#fbfaf8' }}>
        <HeroMerakiSite webCfg={webCfg} onSignIn={() => setShowAuth(true)} />
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', background: 'var(--tm-bg, #f8f9fa)', overflowY: 'auto' }}>

      {/* Top bar */}
      <div style={{ background: '#fff', borderBottom: `1px solid var(--tm-border, #ebebeb)`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, width: '100%', boxSizing: 'border-box', gap: 8 }}>
        <div className="ms-brand-block" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--tm-grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 6px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.18)' }}>
            <span style={{ fontFamily: '"Cinzel", Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: 0, lineHeight: 1 }}>
              {(displayName?.trim()?.[0] || 'P').toUpperCase()}
            </span>
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

      {/* Hero — only shown when not signed in. Style switchable via
          settings/webfront `welcomeStyle`. Default = centered boutique. */}
      {!gUser && (
        <WelcomeHero
          style={welcomeStyle}
          heroBrand={heroBrand}
          onSignIn={() => setShowAuth(true)}
        />
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

        {/* Kiosk launchers moved to dedicated bookmarkable URLs:
            /tipflow and /queue. Bookmark them on the front-desk and
            walk-in iPads so the kiosks open directly without going
            through the admin home screen. See ARCHITECTURE.md →
            Client surfaces for the full URL inventory. */}
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

function KioskCard({ Icon, label, background, ArrowIcon, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background, border: 'none', borderRadius: 22,
        padding: '8px 14px 8px 8px', cursor: 'pointer', display: 'inline-flex',
        alignItems: 'center', gap: 10, fontFamily: 'inherit',
        boxShadow: hover ? '0 6px 16px rgba(0,0,0,.14)' : '0 2px 6px rgba(0,0,0,.08)',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'transform .18s ease, box-shadow .18s ease',
      }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff' }}>
        <Icon size={14} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', letterSpacing: '.01em' }}>{label}</span>
      <span style={{ marginLeft: 2, color: 'rgba(255,255,255,.85)', display: 'inline-flex', alignItems: 'center', transform: hover ? 'translateX(2px)' : 'translateX(0)', transition: 'transform .18s ease', flexShrink: 0 }}>
        <ArrowIcon size={13} />
      </span>
    </button>
  );
}

/* ── Pre-login welcome variants ─────────────────────────────────────── */

function useIsNarrow(threshold = 760) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < threshold);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < threshold);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [threshold]);
  return narrow;
}

function WelcomeHero({ style, heroBrand, onSignIn }) {
  const greet = timeAware();
  const [primary, script] = splitBrandName(heroBrand);
  const props = { greet, primary, script, onSignIn, heroBrand };
  if (style === 'hairlineSplit') return <HeroHairlineSplit {...props} />;
  if (style === 'stacked')       return <HeroStacked {...props} />;
  if (style === 'photo')         return <HeroPhoto {...props} />;
  if (style === 'photoSplit')    return <HeroPhotoSplit {...props} />;
  return <HeroCentered {...props} />;
}

function TimeIcon({ kind, light = false, size = 34 }) {
  const stop2 = light ? '#e1c8f0' : '#a288c9';
  const id = `tm-time-${kind}-${light ? 'l' : 'd'}`;
  if (kind === 'moon') {
    return (
      <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden style={{ marginBottom: 14, opacity: .92 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c19a4a"/>
            <stop offset="100%" stopColor={stop2}/>
          </linearGradient>
        </defs>
        <path d="M22 8 C16 8 11 13 11 19 C11 25 16 30 22 30 C24 30 26 29.5 27.5 28.5 C22 28.5 17 23.5 17 18 C17 12.5 22 7.5 27.5 7.5 C26 7.5 24 8 22 8 Z" fill={`url(#${id})`}/>
        <circle cx="6" cy="10" r="1" fill="#c19a4a" opacity={light ? 0.7 : 0.5}/>
        <circle cx="30" cy="6" r="1.3" fill={light ? '#fff' : '#a288c9'} opacity={light ? 0.7 : 0.5}/>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden style={{ marginBottom: 14, opacity: .92 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c19a4a"/>
          <stop offset="100%" stopColor="#e6c47e"/>
        </linearGradient>
      </defs>
      <circle cx="18" cy="18" r="5.5" fill={`url(#${id})`}/>
      <g stroke={light ? '#e6c47e' : '#c19a4a'} strokeWidth="1.5" strokeLinecap="round" opacity={light ? 0.85 : 1}>
        <line x1="18" y1="3.5"  x2="18" y2="7.5"/>
        <line x1="18" y1="28.5" x2="18" y2="32.5"/>
        <line x1="3.5"  y1="18" x2="7.5"  y2="18"/>
        <line x1="28.5" y1="18" x2="32.5" y2="18"/>
        <line x1="7.5"  y1="7.5"  x2="10.5" y2="10.5"/>
        <line x1="25.5" y1="25.5" x2="28.5" y2="28.5"/>
        <line x1="7.5"  y1="28.5" x2="10.5" y2="25.5"/>
        <line x1="25.5" y1="10.5" x2="28.5" y2="7.5"/>
      </g>
    </svg>
  );
}

function BoutiqueLockup({ primary, script, size = 'md', light = false }) {
  const sz = size === 'sm'
    ? { primary: 'clamp(30px, 4vw, 40px)', script: 'clamp(40px, 5.5vw, 56px)' }
    : { primary: 'clamp(34px, 5vw, 48px)', script: 'clamp(46px, 7vw, 64px)' };
  return (
    <>
      <h1 style={{
        fontFamily: '"Cinzel", Georgia, serif',
        fontWeight: 600,
        fontSize: sz.primary,
        color: light ? '#fff' : 'var(--tm-text, #1a1a1a)',
        margin: '18px 0 0',
        letterSpacing: '-.005em',
        lineHeight: 1,
        textShadow: light ? '0 2px 24px rgba(0,0,0,.35)' : 'none',
      }}>
        {primary}
      </h1>
      {script && (
        <div style={{
          fontFamily: '"Great Vibes", cursive',
          fontWeight: 400,
          fontSize: sz.script,
          color: light ? '#c19a4a' : 'var(--tm-primary, #5b3b8c)',
          lineHeight: .8,
          marginTop: 6,
          textShadow: light ? '0 2px 18px rgba(193,154,74,.3)' : 'none',
        }}>
          {script}
        </div>
      )}
    </>
  );
}

function Greeting({ greet, light = false }) {
  return (
    <div style={{
      fontFamily: '"Cinzel", Georgia, serif',
      fontSize: 11,
      fontWeight: 600,
      color: light ? 'rgba(255,255,255,.78)' : '#5b3b8c',
      letterSpacing: '.34em',
      textTransform: 'uppercase',
    }}>
      {greet.text}
    </div>
  );
}

function Tagline({ light = false }) {
  return (
    <p style={{
      fontFamily: '"Inter", sans-serif',
      fontStyle: 'italic',
      fontSize: 15,
      color: light ? 'rgba(255,255,255,.72)' : '#7a7a7a',
      margin: '22px auto 0',
      maxWidth: 380,
      lineHeight: 1.55,
    }}>
      A calm place to manage your day.
    </p>
  );
}

function BoutiqueLink({ onClick, label = 'Sign in' }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: '"Cinzel", Georgia, serif',
        fontSize: 13,
        fontWeight: 600,
        color: hover ? '#fff' : '#1a1a1a',
        background: hover ? '#c19a4a' : 'rgba(193, 154, 74, 0.07)',
        border: '1.5px solid #c19a4a',
        borderRadius: 30,
        padding: '13px 36px',
        cursor: 'pointer',
        letterSpacing: '.24em',
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: hover
          ? '0 10px 26px rgba(193, 154, 74, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.18)'
          : '0 3px 12px rgba(193, 154, 74, 0.10)',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'background .22s ease, color .22s ease, transform .22s ease, box-shadow .22s ease',
      }}>
      {label}
      <span style={{ display: 'inline-block', transform: hover ? 'translateX(4px)' : 'translateX(0)', transition: 'transform .2s ease' }}>&rarr;</span>
    </button>
  );
}

function PoweredBy({ heroBrand, light = false }) {
  if (heroBrand === 'Plume Nexus') return null;
  return (
    <div style={{
      marginTop: 48,
      fontSize: 10,
      color: light ? 'rgba(255,255,255,.55)' : '#a89776',
      letterSpacing: '.22em',
      textTransform: 'uppercase',
      fontWeight: 500,
    }}>
      Powered by{' '}
      <a href="https://plumenexus.com" target="_blank" rel="noopener noreferrer"
        style={{ color: light ? 'rgba(255,255,255,.78)' : '#7a6a4a', textDecoration: 'none', fontWeight: 600 }}>
        Plume Nexus
      </a>
    </div>
  );
}

function HeroCentered({ greet, primary, script, onSignIn, heroBrand }) {
  return (
    <div style={{ position: 'relative', padding: '72px 24px 56px', flexShrink: 0, maxWidth: 720, width: '100%', alignSelf: 'center', boxSizing: 'border-box', textAlign: 'center' }}>
      <div aria-hidden style={{ position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)', width: 640, height: 320, background: 'radial-gradient(ellipse 50% 60% at 50% 30%, rgba(91,59,140,.06) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <TimeIcon kind={greet.icon} />
        <Greeting greet={greet} />
        <BoutiqueLockup primary={primary} script={script} />
        <Tagline />
        <div style={{ marginTop: 28 }}>
          <BoutiqueLink onClick={onSignIn} />
        </div>
        <PoweredBy heroBrand={heroBrand} />
      </div>
    </div>
  );
}

function HeroHairlineSplit(props) {
  const narrow = useIsNarrow();
  if (narrow) return <HeroCentered {...props} />;
  const { greet, primary, script, onSignIn, heroBrand } = props;
  return (
    <div style={{ width: '100%', maxWidth: 1040, alignSelf: 'center', boxSizing: 'border-box', padding: '12px 16px 32px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1px 1fr', alignItems: 'stretch', minHeight: 420, background: 'transparent' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 36px', textAlign: 'center' }}>
          <TimeIcon kind={greet.icon} />
          <Greeting greet={greet} />
          <BoutiqueLockup primary={primary} script={script} size="sm" />
          <Tagline />
        </div>
        <div style={{ background: 'linear-gradient(180deg, transparent 8%, #c19a4a 50%, transparent 92%)', opacity: .4 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 28px', textAlign: 'center' }}>
          <div style={{ fontFamily: '"Cinzel", Georgia, serif', fontSize: 10, letterSpacing: '.32em', textTransform: 'uppercase', color: '#a89776', marginBottom: 24 }}>
            Sign in to continue
          </div>
          <BoutiqueLink onClick={onSignIn} label="Continue" />
          <PoweredBy heroBrand={heroBrand} />
        </div>
      </div>
    </div>
  );
}

function HeroStacked({ greet, primary, script, onSignIn, heroBrand }) {
  return (
    <div style={{ position: 'relative', padding: '64px 24px 48px', flexShrink: 0, maxWidth: 720, width: '100%', alignSelf: 'center', boxSizing: 'border-box', textAlign: 'center' }}>
      <div aria-hidden style={{ position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)', width: 640, height: 320, background: 'radial-gradient(ellipse 50% 60% at 50% 30%, rgba(91,59,140,.06) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <TimeIcon kind={greet.icon} />
        <Greeting greet={greet} />
        <BoutiqueLockup primary={primary} script={script} size="sm" />
        <Tagline />
        <div style={{ marginTop: 28, background: '#fff', border: '1px solid #eee7dc', borderRadius: 18, padding: '16px 24px', display: 'inline-flex', alignItems: 'center', gap: 18, boxShadow: '0 12px 28px rgba(58,44,26,.06)' }}>
          <div style={{ fontFamily: '"Cinzel", Georgia, serif', fontSize: 10, letterSpacing: '.28em', textTransform: 'uppercase', color: '#a89776' }}>
            Ready when you are
          </div>
          <div style={{ width: 1, height: 22, background: '#eee7dc' }} />
          <BoutiqueLink onClick={onSignIn} />
        </div>
        <PoweredBy heroBrand={heroBrand} />
      </div>
    </div>
  );
}

function HeroPhoto({ greet, primary, script, onSignIn, heroBrand }) {
  return (
    <div style={{ position: 'relative', width: '100%', flexShrink: 0, alignSelf: 'stretch', overflow: 'hidden', minHeight: 480, display: 'flex', flexDirection: 'column' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #3a2c4a 0%, #2a4858 50%, #1f3a4e 100%)' }} />
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 55% 50% at 30% 28%, rgba(193,154,74,.32) 0%, transparent 60%), radial-gradient(ellipse 50% 50% at 72% 78%, rgba(91,59,140,.45) 0%, transparent 62%)' }} />
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 24px 56px', textAlign: 'center', color: '#fff' }}>
        <TimeIcon kind={greet.icon} light />
        <Greeting greet={greet} light />
        <BoutiqueLockup primary={primary} script={script} light />
        <Tagline light />
        <button onClick={onSignIn}
          style={{ marginTop: 28, height: 48, padding: '0 38px', borderRadius: 24, border: 'none', background: '#fff', color: '#1a1a1a', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '.01em', boxShadow: '0 14px 32px rgba(0,0,0,.32)', transition: 'transform .18s ease, box-shadow .18s ease' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 18px 40px rgba(0,0,0,.38)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 14px 32px rgba(0,0,0,.32)'; }}>
          Sign in &rarr;
        </button>
        <PoweredBy heroBrand={heroBrand} light />
      </div>
    </div>
  );
}

function HeroPhotoSplit(props) {
  const narrow = useIsNarrow();
  if (narrow) return <HeroPhoto {...props} />;
  const { greet, primary, script, onSignIn, heroBrand } = props;
  return (
    <div style={{ width: '100%', alignSelf: 'stretch', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1px 1fr', alignItems: 'stretch', minHeight: 480 }}>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '56px 36px', textAlign: 'center', color: '#fff', overflow: 'hidden' }}>
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #3a2c4a 0%, #2a4858 60%, #1f3a4e 100%)' }} />
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 30% 30%, rgba(193,154,74,.32) 0%, transparent 60%), radial-gradient(ellipse 50% 60% at 75% 80%, rgba(91,59,140,.45) 0%, transparent 60%)' }} />
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <TimeIcon kind={greet.icon} light />
            <Greeting greet={greet} light />
            <BoutiqueLockup primary={primary} script={script} size="sm" light />
            <Tagline light />
          </div>
        </div>
        <div style={{ background: 'linear-gradient(180deg, transparent 8%, #c19a4a 50%, transparent 92%)', opacity: .55 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '56px 28px', textAlign: 'center', background: '#fbfaf8' }}>
          <div style={{ fontFamily: '"Cinzel", Georgia, serif', fontSize: 10, letterSpacing: '.32em', textTransform: 'uppercase', color: '#a89776', marginBottom: 24 }}>
            Sign in to continue
          </div>
          <BoutiqueLink onClick={onSignIn} label="Continue" />
          <PoweredBy heroBrand={heroBrand} />
        </div>
      </div>
    </div>
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
