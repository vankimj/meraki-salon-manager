import { useApp } from '../context/AppContext';
import { useState, useRef } from 'react';
import AuthModal from './AuthModal';
import FeedbackModal from './FeedbackModal';
import UserMenu from './UserMenu';
import NotificationsBell from './NotificationsBell';
import CartPanel from './CartPanel';
import { logActivity } from '../lib/logger';
import { MODULE_ICONS, IconLightbulb, IconChair, IconChevronRight, IconArrowUpRight, IconSettings, IconMessage } from './Icons';

const MODULES = [
  { id: 'schedule',  label: 'Schedule',  desc: 'Appointments & calendar',  adminOnly: false },
  { id: 'clients',   label: 'Clients',   desc: 'Profiles & visit history', adminOnly: false },
  { id: 'services',  label: 'Services',  desc: 'Menu & pricing',           adminOnly: false },
  { id: 'employees', label: 'Employees', desc: 'Team & profiles',          adminOnly: true  },
  { id: 'reports',   label: 'Reports',   desc: 'Revenue & analytics',      adminOnly: false },
  { id: 'hr',        label: 'HR',        desc: 'Payroll & compensation',   adminOnly: true  },
  { id: 'giftcards', label: 'Gift Cards', desc: 'Gift cards & promo codes', adminOnly: true  },
  { id: 'meetings',  label: 'Meetings',  desc: 'Internal team meetings',   adminOnly: true  },
  { id: 'products',  label: 'Products',  desc: 'Retail inventory & stock', adminOnly: true  },
  { id: 'marketing', label: 'Marketing', desc: 'Email campaigns & outreach', adminOnly: true, proOnly: true },
  { id: 'chat',      label: 'Messages',  desc: 'Client messages & replies', adminOnly: false },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const PIN_LOCKED_VIEWS = new Set(['hr', 'reports']);

export default function HomeScreen({ onNavigate, onAdmin }) {
  const { gUser, isAdmin, isReadOnly, isTech, isScheduler, settings, totalChatUnread, activeTheme: t, showToast, realIsAdmin, viewAs, setViewAs, users } = useApp();
  const [showAuth,     setShowAuth]     = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [pinTarget,    setPinTarget]    = useState(null);
  const unlockedRef = useRef(new Set());
  const canManage = isAdmin || isReadOnly;
  const isPro = !settings?.plan || settings.plan === 'pro';
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

  function navigate(viewId) {
    const mod = MODULES.find(m => m.id === viewId);
    if (mod?.proOnly && !isPro) {
      showToast('Upgrade to Pro to unlock Marketing campaigns.');
      return;
    }
    const pin = settings?.adminPin;
    if (pin && PIN_LOCKED_VIEWS.has(viewId) && !unlockedRef.current.has(viewId)) {
      setPinTarget(viewId);
    } else {
      onNavigate(viewId);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', background: 'var(--tm-bg, #f8f9fa)', overflowY: 'auto' }}>

      {/* Top bar */}
      <div style={{ background: '#fff', borderBottom: `1px solid var(--tm-border, #ebebeb)`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--tm-grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 60 60" fill="none" width={18} height={18}><circle cx="30" cy="22" r="7" fill="white"/><path d="M14 50c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="white" strokeWidth="3.5" strokeLinecap="round"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text, #1a1a1a)', lineHeight: 1.2 }}>Meraki Nail Studio</div>
            <div style={{ fontSize: 11, color: 'var(--tm-muted, #aaa)' }}>
              Salon Manager{t?.seasonal ? ` · ${t.seasonal.emoji}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isAdmin && (
            <button onClick={onAdmin} title="Admin Settings"
              style={{ height: 40, borderRadius: 20, border: 'none', background: 'var(--tm-primary, #2D7A5F)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,.25)' }}>
              <IconSettings size={16} /> Admin
            </button>
          )}
          {realIsAdmin && viewAs && (
            <button onClick={() => setViewAs(null)} title="Exit preview"
              style={{ height: 40, borderRadius: 20, border: 'none', background: '#f59e0b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>
              ← Exit {previewLabel(viewAs)}
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
          {gUser && <CartPanel />}
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
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1a1a1a', margin: 0, letterSpacing: '-.5px' }}>Welcome to Meraki</h1>
          <p style={{ fontSize: 14, color: '#888', marginTop: 8, marginBottom: 24, lineHeight: 1.6 }}>
            Sign in to manage appointments, clients, and your team.
          </p>
          <button onClick={() => setShowAuth(true)}
            style={{ fontSize: 15, fontWeight: 700, padding: '13px 40px', borderRadius: 12, border: 'none', background: 'var(--tm-primary, #2D7A5F)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 6px 18px rgba(45,122,95,.28)', letterSpacing: '.02em', transition: 'transform .15s, box-shadow .15s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 22px rgba(45,122,95,.32)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(45,122,95,.28)'; }}>
            Sign in
          </button>
        </div>
      )}

      {/* Module tiles */}
      <div style={{ padding: '16px 24px 0', flex: 1, maxWidth: gUser ? 1040 : 720, width: '100%', alignSelf: 'center', boxSizing: 'border-box' }}>
        {isTech ? (
          <>
            <SectionLabel>My Tools</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
              <ModuleTile id="schedule"  label="My Schedule" desc="Your appointments & checkout"  onClick={() => navigate('schedule')}  />
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
              <ModuleTile id="clients"  label="Clients"   desc="Profiles & visit history"  onClick={() => navigate('clients')}   />
              <ModuleTile id="services" label="Services"  desc="Menu & pricing"             onClick={() => navigate('services')}  />
              <ModuleTile id="chat"     label="Messages"  desc="Client messages & replies"  onClick={() => navigate('chat')}      badge={totalChatUnread} />
            </div>
          </>
        ) : canManage ? (
          <>
            <SectionLabel>Manage</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
              {MODULES.filter(m => !m.adminOnly || isAdmin).map(m => (
                <ModuleTile key={m.id} {...m} onClick={() => navigate(m.id)} badge={m.id === 'chat' ? totalChatUnread : 0} locked={m.proOnly && !isPro} />
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
      {pinTarget && (
        <PinModal
          correctPin={settings.adminPin}
          onSuccess={() => {
            unlockedRef.current.add(pinTarget);
            const target = pinTarget;
            setPinTarget(null);
            logActivity('sensitive_tile_accessed', `${gUser?.email || 'unknown'} unlocked ${target}`);
            onNavigate(target);
          }}
          onClose={() => setPinTarget(null)}
        />
      )}
    </div>
  );
}

function PinModal({ correctPin, onSuccess, onClose }) {
  const [entered, setEntered] = useState('');
  const [shake,   setShake]   = useState(false);

  function press(digit) {
    if (entered.length >= 4) return;
    const next = entered + digit;
    setEntered(next);
    if (next.length === 4) {
      if (next === correctPin) {
        onSuccess();
      } else {
        setShake(true);
        setTimeout(() => { setShake(false); setEntered(''); }, 600);
      }
    }
  }

  function del() { setEntered(e => e.slice(0, -1)); }

  const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px', width: 280, boxShadow: '0 20px 60px rgba(0,0,0,.3)', textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 6 }}>Enter PIN</div>
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 20 }}>Required to access this section</div>

        {/* Dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginBottom: 24,
          animation: shake ? 'pinShake .5s' : 'none' }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: i < entered.length ? '#1a1a1a' : '#e0e0e0', transition: 'background .1s' }} />
          ))}
        </div>

        {/* Keypad */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {KEYS.map((k, i) => k === '' ? (
            <div key={i} />
          ) : k === '⌫' ? (
            <button key={i} onClick={del}
              style={{ height: 56, borderRadius: 12, border: '1px solid #e8e8e8', background: '#fafafa', fontSize: 20, color: '#555', cursor: 'pointer', fontFamily: 'inherit' }}>
              {k}
            </button>
          ) : (
            <button key={i} onClick={() => press(k)}
              style={{ height: 56, borderRadius: 12, border: '1px solid #e8e8e8', background: '#fff', fontSize: 22, fontWeight: 600, color: '#1a1a1a', cursor: 'pointer', fontFamily: 'inherit' }}>
              {k}
            </button>
          ))}
        </div>

        <button onClick={onClose} style={{ marginTop: 16, fontSize: 12, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
      <style>{`@keyframes pinShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
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
