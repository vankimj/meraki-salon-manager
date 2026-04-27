import { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Splash from './components/Splash';
import Toast from './components/Toast';
import HomeScreen from './components/HomeScreen';
import ModuleShell from './components/ModuleShell';
import Header from './components/Header';
import TipFlow from './modules/tipflow/TipFlow';
import Admin from './modules/admin/Admin';
import ScheduleAdmin from './modules/schedule/ScheduleAdmin';
import ClientsAdmin from './modules/clients/ClientsAdmin';
import ServicesAdmin from './modules/services/ServicesAdmin';
import EmployeesAdmin from './modules/employees/EmployeesAdmin';
import ReportsAdmin from './modules/reports/ReportsAdmin';
import HRAdmin from './modules/hr/HRAdmin';

const MODULE_TITLES = {
  schedule:  'Schedule',
  clients:   'Clients',
  services:  'Services',
  employees: 'Employees',
  reports:   'Reports',
  hr:        'HR',
};

function MagicLinkPrompt() {
  const { completeMagicLink } = useApp();
  const [email,   setEmail]   = useState('');
  const [working, setWorking] = useState(false);
  const [error,   setError]   = useState('');

  async function submit() {
    if (!email.trim()) return;
    setWorking(true);
    setError('');
    try { await completeMagicLink(email.trim()); }
    catch (e) { setError(e.message || 'Sign-in failed.'); setWorking(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '90%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,.35)', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🔗</div>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Confirm your email</h3>
        <p style={{ fontSize: 12, color: '#888', lineHeight: 1.5, marginBottom: 18 }}>
          Enter the email address you used to request this sign-in link.
        </p>
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="you@example.com" autoFocus
          style={{ width: '100%', fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none', background: '#fafafa', boxSizing: 'border-box', marginBottom: 10 }}
        />
        <button onClick={submit} disabled={working || !email.trim()}
          style={{ width: '100%', padding: '11px', borderRadius: 10, border: 'none', background: working || !email.trim() ? '#d0d0d0' : '#2D7A5F', color: '#fff', fontSize: 14, fontWeight: 600, cursor: working || !email.trim() ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {working ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}

function AppShell() {
  const { slides, def, cur, magicLinkPending } = useApp();
  const [view,      setView]      = useState('home'); // 'home' | 'tipflow' | 'schedule' | 'clients' | 'services' | 'employees'
  const [showAdmin, setShowAdmin] = useState(false);

  const isTipFlow = view === 'tipflow';
  const isHome    = view === 'home';

  // TipFlow stays a fixed card; home + management fill the viewport
  const shellStyle = isTipFlow ? {
    position: 'relative', display: 'flex', flexDirection: 'column',
    width: 700, height: 620, flexShrink: 0,
    border: '1px solid #e0e0e0', borderRadius: 16,
    overflow: 'hidden', background: '#f5f5f5',
    boxShadow: '0 8px 40px rgba(0,0,0,.3)',
  } : {
    position: 'relative', display: 'flex', flexDirection: 'column',
    alignSelf: 'stretch', width: '100%', minHeight: '100dvh',
    overflow: 'hidden', background: '#f8f9fa',
  };

  return (
    <div id="deck-app" style={shellStyle}>
      <Splash />
      <Toast />

      {/* Home */}
      {isHome && (
        <HomeScreen
          onNavigate={v => setView(v)}
          onAdmin={() => setShowAdmin(true)}
        />
      )}

      {/* Tip Flow kiosk */}
      {isTipFlow && (
        <>
          <Header
            slides={slides} cur={cur} def={def}
            onOpenAdmin={() => setShowAdmin(true)}
            onHome={() => setView('home')}
          />
          <TipFlow onOpenAdmin={() => setShowAdmin(true)} />
        </>
      )}

      {/* Management modules */}
      {Object.keys(MODULE_TITLES).map(id => view === id && (
        <ModuleShell key={id} view={id} title={MODULE_TITLES[id]} onHome={() => setView('home')} onAdmin={() => setShowAdmin(true)}>
          {id === 'schedule'  && <ScheduleAdmin />}
          {id === 'clients'   && <ClientsAdmin />}
          {id === 'services'  && <ServicesAdmin />}
          {id === 'employees' && <EmployeesAdmin />}
          {id === 'reports'   && <ReportsAdmin />}
          {id === 'hr'        && <HRAdmin />}
        </ModuleShell>
      ))}

      {/* Admin settings overlay */}
      {showAdmin && <Admin onClose={() => setShowAdmin(false)} />}

      {/* Magic link completion — shown when user arrives via link on a different device */}
      {magicLinkPending && <MagicLinkPrompt />}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <div style={{ width: '100vw', height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef0f3', overflow: 'hidden' }}>
        <AppShell />
      </div>
    </AppProvider>
  );
}
