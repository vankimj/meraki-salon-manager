import { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { BUILD_LABEL } from './lib/version';
import Splash from './components/Splash';
import Toast from './components/Toast';
import ThemeProvider from './components/ThemeProvider';
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
import GiftCardsAdmin from './modules/giftcards/GiftCardsAdmin';
import MeetingsAdmin from './modules/meetings/MeetingsAdmin';
import ProductsAdmin from './modules/products/ProductsAdmin';
import MarketingAdmin from './modules/marketing/MarketingAdmin';
import ChatAdmin from './modules/chat/ChatAdmin';
import CheckInScreen from './components/CheckInScreen';
import BookingScreen from './components/BookingScreen';
import QueueKiosk from './components/QueueKiosk';
import HandbookModal from './components/HandbookModal';
import ClientPortal from './components/ClientPortal';
import SalonWebfront from './modules/webfront/SalonWebfront';
import OnboardingScreen from './components/OnboardingScreen';
import TipFlowLanding from './components/TipFlowLanding';

const MODULE_TITLES = {
  schedule:   'Schedule',
  clients:    'Clients',
  services:   'Services',
  employees:  'Employees',
  reports:    'Reports',
  hr:         'HR',
  giftcards:  'Gift Cards & Promos',
  meetings:   'Meetings',
  products:   'Products & Inventory',
  marketing:  'Marketing',
  chat:       'Messages',
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
  const { slides, def, cur, magicLinkPending, handbookPending, isPortalUser } = useApp();

  if (isPortalUser) return <ClientPortal />;
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
            onHome={() => setView('home')}
          />
          <TipFlow />
        </>
      )}

      {/* Management modules */}
      {Object.keys(MODULE_TITLES).map(id => view === id && (
        <ModuleShell key={id} view={id} title={MODULE_TITLES[id]} onHome={() => setView('home')} onAdmin={() => setShowAdmin(true)} onNavigate={setView}>
          {id === 'schedule'  && <ScheduleAdmin />}
          {id === 'clients'   && <ClientsAdmin />}
          {id === 'services'  && <ServicesAdmin />}
          {id === 'employees' && <EmployeesAdmin />}
          {id === 'reports'    && <ReportsAdmin />}
          {id === 'hr'         && <HRAdmin />}
          {id === 'giftcards'  && <GiftCardsAdmin />}
          {id === 'meetings'   && <MeetingsAdmin />}
          {id === 'products'   && <ProductsAdmin />}
          {id === 'marketing'  && <MarketingAdmin />}
          {id === 'chat'       && <ChatAdmin />}
        </ModuleShell>
      ))}

      {/* Admin settings overlay */}
      {showAdmin && <Admin onClose={() => setShowAdmin(false)} />}

      {/* Handbook signing — shown to non-admin staff on first login after publish */}
      {handbookPending && <HandbookModal />}

      {/* Magic link completion — shown when user arrives via link on a different device */}
      {magicLinkPending && <MagicLinkPrompt />}
    </div>
  );
}

function VersionBadge() {
  return (
    <div style={{ position: 'fixed', bottom: 'calc(6px + env(safe-area-inset-bottom, 0px))', right: 10, zIndex: 9999 }}>
      <span title="Click to copy" onClick={() => { navigator.clipboard?.writeText(BUILD_LABEL); }}
        style={{ fontSize: 10, color: '#777', fontWeight: 500, letterSpacing: '.03em', background: 'rgba(255,255,255,.85)', padding: '3px 8px', borderRadius: 8, backdropFilter: 'blur(4px)', border: '1px solid rgba(0,0,0,.06)', cursor: 'pointer', userSelect: 'all' }}>
        {BUILD_LABEL}
      </span>
    </div>
  );
}

export default function App() {
  const { hostname } = window.location;

  let content;
  // tipflow.app root domain → marketing landing page
  if (hostname === 'tipflow.app' || hostname === 'www.tipflow.app') {
    content = <TipFlowLanding />;
  } else {
    const params = new URLSearchParams(window.location.search);
    const checkinId = params.get('checkin');
    const isBooking  = params.has('book');
    const isQueue    = params.has('queue');
    const isWeb      = params.has('web') || window.location.search === '?web';
    const isSignup   = params.has('signup');
    if      (checkinId) content = <CheckInScreen apptId={checkinId} />;
    else if (isBooking) content = <BookingScreen />;
    else if (isQueue)   content = <QueueKiosk />;
    else if (isWeb)     content = <SalonWebfront />;
    else if (isSignup)  content = <OnboardingScreen />;
    else content = (
      <AppProvider>
        <ThemeProvider>
          <div style={{ width: '100vw', height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef0f3', overflow: 'hidden' }}>
            <AppShell />
          </div>
        </ThemeProvider>
      </AppProvider>
    );
  }

  return <>{content}<VersionBadge /></>;
}
