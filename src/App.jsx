import { useState, useEffect, useCallback, useRef } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { BUILD_LABEL } from './lib/version';
import { TENANT_ID } from './lib/tenant';
import Splash from './components/Splash';
import Toast from './components/Toast';
import ThemeProvider from './components/ThemeProvider';
import HomeScreen from './components/HomeScreen';
import ModuleShell from './components/ModuleShell';
import TipFlow from './modules/tipflow/TipFlow';
import Admin from './modules/admin/Admin';
import ScheduleAdmin from './modules/schedule/ScheduleAdmin';
import ClientsAdmin from './modules/clients/ClientsAdmin';
import ServicesAdmin from './modules/services/ServicesAdmin';
import EmployeesAdmin from './modules/employees/EmployeesAdmin';
import ReportsAdmin from './modules/reports/ReportsAdmin';
import HRAdmin from './modules/hr/HRAdmin';
import TechEarnings from './modules/earnings/TechEarnings';
import WalkinKiosk from './modules/walkin/WalkinKiosk';
import MembershipsAdmin from './modules/memberships/MembershipsAdmin';
import AttendanceAdmin from './modules/attendance/AttendanceAdmin';
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
import TicketCheckoutLauncher from './components/TicketCheckoutLauncher';
import RsvpScreen from './components/RsvpScreen';
import UnsubscribeScreen from './components/UnsubscribeScreen';
import ManageAppointmentScreen from './components/ManageAppointmentScreen';
import { TermsScreen, PrivacyScreen } from './components/PolicyScreen';
import PinModal from './components/PinModal';
import OnboardingWizard from './modules/onboarding/OnboardingWizard';
import OnboardingBanner from './components/OnboardingBanner';
import { subscribeOnboarding, isOnboardingComplete } from './lib/onboarding';
import { isModuleAvailableForPlan, effectivePlan } from './lib/modules';

const MODULE_TITLES = {
  schedule:   'Schedule',
  clients:    'Clients',
  services:   'Services',
  employees:  'Employees',
  reports:    'Reports',
  attendance: 'Attendance',
  hr:         'HR',
  giftcards:  'Gift Cards & Promos',
  meetings:   'Meetings',
  products:   'Products & Inventory',
  marketing:  'Marketing',
  chat:       'Communications',
  earnings:   'Earnings',
  walkin:     'Walk-in Kiosk',
  memberships: 'Memberships',
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

function AppShell({ initialView = 'home' }) {
  const { magicLinkPending, handbookPending, isPortalUser, settings, updateSettings, isAdmin, gUser, pinPrompt, acceptPinPrompt, dismissPinPrompt } = useApp();

  if (isPortalUser) return <ClientPortal />;
  const [view,      setViewState] = useState(initialView); // 'home' | 'tipflow' | 'schedule' | 'clients' | 'services' | 'employees'
  const [showAdmin, setShowAdmin] = useState(false);
  const [showWizard, setShowWizard]   = useState(false);
  // `undefined` = subscription hasn't fired yet (loading).
  // `null`      = subscription fired and the tenant has no onboarding doc.
  // `object`    = doc exists; check completedAt for done state.
  const [onboarding, setOnboarding]   = useState(undefined);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  // Cross-module deep-link: when set, clicking a client name in Schedule
  // jumps to the Clients module and auto-opens that client's profile.
  // ClientsAdmin clears it once it's consumed the value.
  const [openClientId, setOpenClientId] = useState(null);

  // Browser back-button integration. The app uses internal `view` state
  // for navigation (no URL changes), so the browser back button used to
  // exit the app entirely. We push a history entry every time `view`
  // changes from a user nav so back walks back through the stack, and
  // listen for popstate to apply the prior state without re-pushing.
  const skipPushRef = useRef(false);
  const setView = useCallback((next) => {
    setViewState(prev => {
      const v = typeof next === 'function' ? next(prev) : next;
      if (v !== prev && !skipPushRef.current) {
        window.history.pushState({ view: v }, '', window.location.search);
      }
      skipPushRef.current = false;
      return v;
    });
  }, []);
  useEffect(() => {
    if (!window.history.state || !window.history.state.view) {
      window.history.replaceState({ view: 'home' }, '', window.location.search);
    }
    const onPopState = (e) => {
      const v = e.state?.view || 'home';
      skipPushRef.current = true;
      setViewState(v);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openClientProfile = (id) => { if (!id) return; setOpenClientId(id); setView('clients'); };

  // Subscribe to onboarding state for the banner + auto-open logic.
  useEffect(() => {
    if (!gUser || !isAdmin) { setOnboarding(undefined); return; }
    return subscribeOnboarding(setOnboarding);
  }, [gUser?.uid, isAdmin]);

  // Auto-open the onboarding wizard when:
  //   - the signed-in user is admin
  //   - they haven't dismissed it this session
  //   - onboarding is not yet complete (no doc = also not complete)
  // After dismissal the persistent OnboardingBanner takes over until
  // they finish. Existing tenants (Meraki) hit this once on next sign-in
  // and run through audit mode (mostly ✓/skip).
  useEffect(() => {
    if (!gUser || !isAdmin)             return;
    if (dismissedThisSession)           return;
    if (onboarding === undefined)       return; // subscription still loading
    if (isOnboardingComplete(onboarding)) return;
    setShowWizard(true);
  }, [gUser?.uid, isAdmin, onboarding, dismissedThisSession]);

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

      {/* Persistent onboarding banner — hidden when complete or while the
          subscription is still loading. Shows for both "doc-exists but
          incomplete" and "no doc yet" so dismissing the wizard leaves a
          clear way back in. Hidden in TipFlow kiosk view. */}
      {gUser && isAdmin && onboarding !== undefined && !isOnboardingComplete(onboarding) && !isTipFlow && (
        <OnboardingBanner onboarding={onboarding} onOpen={() => { setShowWizard(true); setDismissedThisSession(false); }} />
      )}

      {/* Home */}
      {isHome && (
        <HomeScreen
          onNavigate={v => setView(v)}
          onAdmin={() => setShowAdmin(true)}
        />
      )}

      {/* Tip Flow kiosk — TipFlow renders its own minimal top bar (FS + tap-reveal actions). */}
      {isTipFlow && <TipFlow />}

      {/* Management modules — defense-in-depth: a plan-locked module
          shouldn't render even if `view` somehow points at it (stale
          state, URL hash, etc). The home-screen tile filter is the
          primary gate; this guard catches anything that slips through. */}
      {Object.keys(MODULE_TITLES).map(id => view === id && (
        !isModuleAvailableForPlan(id, effectivePlan(settings)) ? (
          <ModuleShell key={id} view="home" title="Upgrade required" onHome={() => setView('home')} onAdmin={() => setShowAdmin(true)} onNavigate={setView}>
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', marginBottom: 6 }}>This feature isn't on your current plan</div>
              <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>Upgrade to unlock it. Talk to your account manager or visit Admin → Plan & Billing.</div>
              <button onClick={() => setView('home')}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Back to home
              </button>
            </div>
          </ModuleShell>
        ) : (
        <ModuleShell key={id} view={id} title={MODULE_TITLES[id]} onHome={() => setView('home')} onAdmin={() => setShowAdmin(true)} onNavigate={setView}>
          {id === 'schedule'  && <ScheduleAdmin onOpenClient={openClientProfile} />}
          {id === 'clients'   && <ClientsAdmin initialClientId={openClientId} onInitialClientOpened={() => setOpenClientId(null)} />}
          {id === 'services'  && <ServicesAdmin />}
          {id === 'employees' && <EmployeesAdmin />}
          {id === 'reports'    && <ReportsAdmin />}
          {id === 'attendance' && <AttendanceAdmin />}
          {id === 'hr'         && <HRAdmin />}
          {id === 'giftcards'  && <GiftCardsAdmin />}
          {id === 'meetings'   && <MeetingsAdmin />}
          {id === 'products'   && <ProductsAdmin />}
          {id === 'marketing'  && <MarketingAdmin />}
          {id === 'chat'       && <ChatAdmin />}
          {id === 'earnings'   && <TechEarnings />}
          {id === 'walkin'     && <WalkinKiosk />}
          {id === 'memberships' && <MembershipsAdmin />}
        </ModuleShell>
        )
      ))}

      {/* Admin settings overlay */}
      {showAdmin && <Admin
        onClose={() => setShowAdmin(false)}
        onOpenWizard={() => { setShowAdmin(false); setShowWizard(true); setDismissedThisSession(false); }}
      />}

      {showWizard && (
        <OnboardingWizard onDismiss={() => {
          setShowWizard(false);
          setDismissedThisSession(true);
        }} />
      )}

      {/* Handbook signing — shown to non-admin staff on first login after publish */}
      {handbookPending && <HandbookModal />}

      {/* Magic link completion — shown when user arrives via link on a different device */}
      {magicLinkPending && <MagicLinkPrompt />}

      {/* PIN prompt — guards sensitive views (HR, Reports) from any nav entry point */}
      {pinPrompt && (
        <PinModal correctPin={settings?.adminPin} onSuccess={acceptPinPrompt} onClose={dismissPinPrompt} />
      )}

      {/* Ticket-driven checkout — opens from any module when the ticket panel's Continue button fires */}
      <TicketCheckoutLauncher />
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

// Visual marker so it's obvious when you're not on prod (e.g. on the staging
// preview channel reading from the meraki-staging tenant).
function EnvBanner() {
  if (TENANT_ID === 'meraki') return null;
  const label = TENANT_ID === 'meraki-staging' ? 'STAGING' : TENANT_ID.toUpperCase();
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      paddingTop: 'env(safe-area-inset-top, 0px)',
      background: 'repeating-linear-gradient(45deg, #f59e0b, #f59e0b 12px, #fbbf24 12px, #fbbf24 24px)',
      zIndex: 10000, pointerEvents: 'none',
    }}>
      <div style={{
        textAlign: 'center', fontSize: 11, fontWeight: 800, color: '#1a1a1a',
        letterSpacing: '.18em', padding: '4px 10px',
        background: 'rgba(255,255,255,.55)',
        borderBottom: '1px solid rgba(0,0,0,.1)',
      }}>
        ⚠ {label} ENVIRONMENT — data writes here will not affect production
      </div>
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
    const path   = (window.location.pathname || '/').toLowerCase();
    const checkinId = params.get('checkin');
    const isBooking  = params.has('book');
    // Queue + TipFlow routes — accept either `?queue` / `?tipflow` query
    // params OR clean paths `/queue` / `/tipflow`. The path forms read
    // better as kiosk-iPad bookmarks; the query forms keep working for
    // any existing internal links.
    const isQueue    = params.has('queue')   || path === '/queue';
    const isTipFlow  = params.has('tipflow') || path === '/tipflow';
    const isWeb      = params.has('web') || window.location.search === '?web';
    const isSignup   = params.has('signup');
    const isRsvp     = params.has('rsvp');
    const isUnsub    = params.has('unsub');
    const isManage   = params.has('manage');
    const isTerms    = params.has('terms');
    const isPrivacy  = params.has('privacy');
    if      (isManage)  content = <ManageAppointmentScreen />;
    else if (isUnsub)   content = <UnsubscribeScreen />;
    else if (isTerms)   content = <TermsScreen />;
    else if (isPrivacy) content = <PrivacyScreen />;
    else if (isRsvp)    content = <RsvpScreen />;
    else if (checkinId) content = <CheckInScreen apptId={checkinId} />;
    else if (isBooking) content = <BookingScreen />;
    else if (isQueue)   content = <QueueKiosk />;
    else if (isWeb)     content = <SalonWebfront />;
    else if (isSignup)  content = <OnboardingScreen />;
    else content = (
      <AppProvider>
        <ThemeProvider>
          <div style={{ width: '100vw', height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef0f3', overflow: 'hidden' }}>
            <AppShell initialView={isTipFlow ? 'tipflow' : 'home'} />
          </div>
        </ThemeProvider>
      </AppProvider>
    );
  }

  return <><EnvBanner />{content}<VersionBadge /></>;
}
