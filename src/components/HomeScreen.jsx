import { useApp } from '../context/AppContext';
import { useState, useRef } from 'react';
import AuthModal from './AuthModal';
import FeedbackModal from './FeedbackModal';
import UserMenu from './UserMenu';
import { logActivity } from '../lib/logger';

const MODULES = [
  { id: 'schedule',  icon: '📅', label: 'Schedule',  desc: 'Appointments & calendar',  adminOnly: false },
  { id: 'clients',   icon: '👥', label: 'Clients',   desc: 'Profiles & visit history', adminOnly: false },
  { id: 'services',  icon: '💅', label: 'Services',  desc: 'Menu & pricing',           adminOnly: false },
  { id: 'employees', icon: '👩‍💼', label: 'Employees', desc: 'Team & profiles',          adminOnly: true  },
  { id: 'reports',   icon: '📊', label: 'Reports',   desc: 'Revenue & analytics',      adminOnly: false },
  { id: 'hr',        icon: '💼', label: 'HR',        desc: 'Payroll & compensation',   adminOnly: true  },
  { id: 'giftcards', icon: '🎁', label: 'Gift Cards', desc: 'Gift cards & promo codes',  adminOnly: true  },
  { id: 'meetings',  icon: '🗓️', label: 'Meetings',  desc: 'Internal team meetings',    adminOnly: true  },
  { id: 'products',  icon: '🛍', label: 'Products',  desc: 'Retail inventory & stock',   adminOnly: true  },
  { id: 'marketing', icon: '📣', label: 'Marketing', desc: 'Email campaigns & outreach',  adminOnly: true  },
  { id: 'chat',      icon: '💬', label: 'Messages',  desc: 'Client messages & replies',   adminOnly: false },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const PIN_LOCKED_VIEWS = new Set(['hr', 'reports']);

export default function HomeScreen({ onNavigate, onAdmin }) {
  const { gUser, isAdmin, isReadOnly, isTech, settings, totalChatUnread } = useApp();
  const [showAuth,     setShowAuth]     = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [pinTarget,    setPinTarget]    = useState(null);
  const unlockedRef = useRef(new Set());
  const canManage = isAdmin || isReadOnly;

  function navigate(viewId) {
    const pin = settings?.adminPin;
    if (pin && PIN_LOCKED_VIEWS.has(viewId) && !unlockedRef.current.has(viewId)) {
      setPinTarget(viewId);
    } else {
      onNavigate(viewId);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', background: '#f8f9fa', overflowY: 'auto' }}>

      {/* Top bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #ebebeb', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#2D7A5F,#4A7DB5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 60 60" fill="none" width={18} height={18}><circle cx="30" cy="22" r="7" fill="white"/><path d="M14 50c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="white" strokeWidth="3.5" strokeLinecap="round"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2 }}>Meraki Nail Studio</div>
            <div style={{ fontSize: 11, color: '#aaa' }}>Salon Manager</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isAdmin && (
            <button onClick={onAdmin} title="Admin Settings"
              style={{ height: 40, borderRadius: 20, border: 'none', background: '#2D7A5F', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(45,122,95,.35)' }}>
              <span style={{ fontSize: 17 }}>⚙</span> Admin
            </button>
          )}
          <button onClick={() => setShowFeedback(true)} title="Report a bug or idea"
            style={{ height: 40, borderRadius: 20, border: 'none', background: '#3D95CE', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(61,149,206,.35)' }}>
            <span style={{ fontSize: 17 }}>💬</span> Feedback
          </button>
          {gUser && <UserMenu />}
        </div>
      </div>

      {/* Greeting */}
      {gUser && (
        <div style={{ padding: '18px 20px 4px', flexShrink: 0, maxWidth: 760, width: '100%', alignSelf: 'center', boxSizing: 'border-box' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>{greeting()}, {(gUser.displayName || gUser.email).split(' ')[0]} 👋</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>
      )}

      {/* Module tiles */}
      <div style={{ padding: '16px 16px 0', flex: 1, maxWidth: 760, width: '100%', alignSelf: 'center', boxSizing: 'border-box' }}>
        {isTech ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10, paddingLeft: 4 }}>
              My Tools
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <ModuleTile id="schedule"  icon="📅"  label="My Schedule" desc="Your appointments & checkout"  onClick={() => navigate('schedule')}  />
              <ModuleTile id="clients"   icon="👥"  label="Clients"     desc="Profiles & visit history"      onClick={() => navigate('clients')}   />
              <ModuleTile id="services"  icon="💅"  label="Services"    desc="Menu & pricing"                onClick={() => navigate('services')}  />
              <ModuleTile id="employees" icon="👩‍💼" label="Team"        desc="Staff profiles"               onClick={() => navigate('employees')} />
              <ModuleTile id="hr"        icon="📋"  label="Tax Forms"   desc="Your 1099s"                    onClick={() => navigate('hr')}        />
            </div>
          </>
        ) : canManage ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10, paddingLeft: 4 }}>
              Manage
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              {MODULES.filter(m => !m.adminOnly || isAdmin).map(m => (
                <ModuleTile key={m.id} {...m} onClick={() => navigate(m.id)} badge={m.id === 'chat' ? totalChatUnread : 0} />
              ))}
            </div>
          </>
        ) : !gUser ? (
          <div style={{ textAlign: 'center', padding: '32px 20px' }}>
            <div style={{ fontSize: 13, color: '#aaa', marginBottom: 16 }}>Sign in to access management tools.</div>
            <button onClick={() => setShowAuth(true)}
              style={{ fontSize: 17, fontWeight: 700, padding: '16px 48px', borderRadius: 14, border: 'none', background: '#3D95CE', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', width: '100%', maxWidth: 320 }}>
              Sign in
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa', fontSize: 13 }}>
            Your access is pending admin approval.
          </div>
        )}

        {/* Tip Flow launch — not shown to techs */}
        {!isTech && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10, paddingLeft: 4 }}>
              Kiosk
            </div>
            <button onClick={() => navigate('tipflow')}
              style={{ width: '100%', background: 'linear-gradient(135deg, #2D7A5F 0%, #3D95CE 100%)', border: 'none', borderRadius: 14, padding: '18px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, fontFamily: 'inherit', textAlign: 'left' }}>
              <div style={{ fontSize: 28, flexShrink: 0 }}>💡</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 2 }}>Launch Tip Flow</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.75)' }}>Full-screen kiosk for front desk iPad</div>
              </div>
              <div style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.6)', fontSize: 20 }}>›</div>
            </button>
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

function ModuleTile({ icon, label, desc, onClick, badge }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ background: hover ? '#fff' : '#fff', border: `1.5px solid ${hover ? '#3D95CE' : '#e8e8e8'}`, borderRadius: 14, padding: '16px 14px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'border-color .15s, box-shadow .15s', boxShadow: hover ? '0 4px 16px rgba(61,149,206,.15)' : '0 1px 4px rgba(0,0,0,.05)' }}
    >
      <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
        <div style={{ fontSize: 26 }}>{icon}</div>
        {badge > 0 && (
          <div style={{ position: 'absolute', top: -4, right: -10, background: '#ef4444', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center', lineHeight: '14px' }}>
            {badge > 9 ? '9+' : badge}
          </div>
        )}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.4 }}>{desc}</div>
    </button>
  );
}
