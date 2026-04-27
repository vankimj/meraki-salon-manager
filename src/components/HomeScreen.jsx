import { useApp } from '../context/AppContext';
import { useState } from 'react';
import AuthModal from './AuthModal';

const MODULES = [
  { id: 'schedule',  icon: '📅', label: 'Schedule',  desc: 'Appointments & calendar',  adminOnly: false },
  { id: 'clients',   icon: '👥', label: 'Clients',   desc: 'Profiles & visit history', adminOnly: false },
  { id: 'services',  icon: '💅', label: 'Services',  desc: 'Menu & pricing',           adminOnly: false },
  { id: 'employees', icon: '👩‍💼', label: 'Employees', desc: 'Team & profiles',          adminOnly: true  },
  { id: 'reports',   icon: '📊', label: 'Reports',   desc: 'Revenue & analytics',      adminOnly: false },
  { id: 'hr',        icon: '💼', label: 'HR',        desc: 'Payroll & compensation',   adminOnly: true  },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen({ onNavigate, onAdmin }) {
  const { gUser, isAdmin, isReadOnly, isTech } = useApp();
  const [showAuth, setShowAuth] = useState(false);
  const canManage = isAdmin || isReadOnly;

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
              style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e8e8e8', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
              ⚙
            </button>
          )}
          {gUser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', padding: '5px 10px', borderRadius: 20, border: '1px solid #e8e8e8', background: '#fff' }}>
              {gUser.photoURL && <img src={gUser.photoURL} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />}
              <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(gUser.displayName || gUser.email).split(' ')[0]}
              </span>
            </div>
          )}
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
              <ModuleTile id="schedule"  icon="📅"  label="My Schedule" desc="Your appointments & checkout"  onClick={() => onNavigate('schedule')}  />
              <ModuleTile id="clients"   icon="👥"  label="Clients"     desc="Profiles & visit history"      onClick={() => onNavigate('clients')}   />
              <ModuleTile id="services"  icon="💅"  label="Services"    desc="Menu & pricing"                onClick={() => onNavigate('services')}  />
              <ModuleTile id="employees" icon="👩‍💼" label="Team"        desc="Staff profiles"               onClick={() => onNavigate('employees')} />
            </div>
          </>
        ) : canManage ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10, paddingLeft: 4 }}>
              Manage
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              {MODULES.filter(m => !m.adminOnly || isAdmin).map(m => (
                <ModuleTile key={m.id} {...m} onClick={() => onNavigate(m.id)} />
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
            <button onClick={() => onNavigate('tipflow')}
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

      <div style={{ height: 16, flexShrink: 0 }} />
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}

function ModuleTile({ icon, label, desc, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ background: hover ? '#fff' : '#fff', border: `1.5px solid ${hover ? '#3D95CE' : '#e8e8e8'}`, borderRadius: 14, padding: '16px 14px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'border-color .15s, box-shadow .15s', boxShadow: hover ? '0 4px 16px rgba(61,149,206,.15)' : '0 1px 4px rgba(0,0,0,.05)' }}
    >
      <div style={{ fontSize: 26, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.4 }}>{desc}</div>
    </button>
  );
}
