import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { BUILD_LABEL } from './lib/version';
import { TENANT_ID, isProductionTenant } from './lib/tenant';
import { startConnHealth, subscribeConnHealth, pingConn } from './lib/connHealth';
import { useStripeConnectOAuthCallback } from './hooks/useStripeConnectOAuthCallback';
import { recordNav } from './lib/diagnostics';
import Splash from './components/Splash';
import Toast from './components/Toast';
import ThemeProvider from './components/ThemeProvider';
import HomeScreen from './components/HomeScreen';
import ModuleShell from './components/ModuleShell';
import TicketCheckoutLauncher from './components/TicketCheckoutLauncher';
import PinModal from './components/PinModal';

// Code-split: heavy management modules + the distinct public/standalone surfaces
// load on demand, so a public booking/webfront visitor never downloads the
// whole staff app, and opening one module doesn't pull all 18. Each renders
// inside a <Suspense> (top-level for surfaces, and inside AppShell for modules).
const TipFlow          = lazy(() => import('./modules/tipflow/TipFlow'));
const Admin            = lazy(() => import('./modules/admin/Admin'));
const ScheduleAdmin    = lazy(() => import('./modules/schedule/ScheduleAdmin'));
const ClientsAdmin     = lazy(() => import('./modules/clients/ClientsAdmin'));
const ServicesAdmin    = lazy(() => import('./modules/services/ServicesAdmin'));
const EmployeesAdmin   = lazy(() => import('./modules/employees/EmployeesAdmin'));
const ReportsAdmin     = lazy(() => import('./modules/reports/ReportsAdmin'));
const ReceiptsAdmin    = lazy(() => import('./modules/receipts/ReceiptsAdmin'));
const HRAdmin          = lazy(() => import('./modules/hr/HRAdmin'));
const TechEarnings     = lazy(() => import('./modules/earnings/TechEarnings'));
const WalkinKiosk      = lazy(() => import('./modules/walkin/WalkinKiosk'));
const MembershipsAdmin = lazy(() => import('./modules/memberships/MembershipsAdmin'));
const IntakeAdmin      = lazy(() => import('./modules/intake/IntakeAdmin'));
const ProgramsAdmin    = lazy(() => import('./modules/programs/ProgramsAdmin'));
const StoreAdmin       = lazy(() => import('./modules/store/StoreAdmin'));
const AttendanceAdmin  = lazy(() => import('./modules/attendance/AttendanceAdmin'));
const GiftCardsAdmin   = lazy(() => import('./modules/giftcards/GiftCardsAdmin'));
const MeetingsAdmin    = lazy(() => import('./modules/meetings/MeetingsAdmin'));
const ProductsAdmin    = lazy(() => import('./modules/products/ProductsAdmin'));
const MarketingAdmin   = lazy(() => import('./modules/marketing/MarketingAdmin'));
const GrowGuide        = lazy(() => import('./modules/grow/GrowGuide'));
const ChatAdmin        = lazy(() => import('./modules/chat/ChatAdmin'));
const OnboardingWizard = lazy(() => import('./modules/onboarding/OnboardingWizard'));
const CheckInScreen    = lazy(() => import('./components/CheckInScreen'));
const BookingScreen    = lazy(() => import('./components/BookingScreen'));
const QueueKiosk       = lazy(() => import('./components/QueueKiosk'));
const HandbookModal    = lazy(() => import('./components/HandbookModal'));
const ClientPortal     = lazy(() => import('./components/ClientPortal'));
const SalonWebfront    = lazy(() => import('./modules/webfront/SalonWebfront'));
const OnboardingScreen = lazy(() => import('./components/OnboardingScreen'));
const TipFlowLanding   = lazy(() => import('./components/TipFlowLanding'));
const TimeClockKiosk   = lazy(() => import('./modules/timeclock/TimeClockKiosk'));
const RsvpScreen       = lazy(() => import('./components/RsvpScreen'));
const UnsubscribeScreen = lazy(() => import('./components/UnsubscribeScreen'));
const ManageAppointmentScreen = lazy(() => import('./components/ManageAppointmentScreen'));
const IntakeFormScreen = lazy(() => import('./components/IntakeFormScreen'));
const GearStorefront   = lazy(() => import('./components/GearStorefront'));
const ProductShop      = lazy(() => import('./components/ProductShop'));
const ReceiptViewPage  = lazy(() => import('./components/ReceiptViewPage'));
const StaffInviteScreen = lazy(() => import('./components/StaffInviteScreen'));
const GiftCardPurchaseScreen = lazy(() => import('./components/GiftCardPurchaseScreen'));
const TermsScreen      = lazy(() => import('./components/PolicyScreen').then(m => ({ default: m.TermsScreen })));
const PrivacyScreen    = lazy(() => import('./components/PolicyScreen').then(m => ({ default: m.PrivacyScreen })));
const SmsConsentScreen = lazy(() => import('./components/PolicyScreen').then(m => ({ default: m.SmsConsentScreen })));
import OnboardingBanner from './components/OnboardingBanner';
import { subscribeOnboarding, isOnboardingComplete } from './lib/onboarding';
import { isModuleAvailableForPlan, isModuleEnabled, effectivePlan } from './lib/modules';

const MODULE_TITLES = {
  schedule:   'Schedule',
  clients:    'Clients',
  services:   'Services',
  employees:  'Employees',
  reports:    'Reports',
  receipts:   'Sales & Receipts',
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
  intake:      'Intake & Waivers',
  programs:    'Programs',
  store:       'Store',
  grow:        'Launch & Grow',
};

// Fallback shown while a lazily code-split surface/module chunk downloads.
function ChunkFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: '60vh', color: 'var(--pn-text-faint, #9aa3ad)', fontSize: 13 }}>
      Loading…
    </div>
  );
}

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
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, padding: 28, width: '90%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,.35)', textAlign: 'center' }}>
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
  const { magicLinkPending, handbookPending, isPortalUser, settings, updateSettings, isAdmin, gUser, pinPrompt, acceptPinPrompt, dismissPinPrompt, showToast } = useApp();

  if (isPortalUser) return <ClientPortal />;
  const [view,      setViewState] = useState(initialView); // 'home' | 'tipflow' | 'schedule' | 'clients' | 'services' | 'employees'
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminInitial, setAdminInitial] = useState(null); // { tab?, scrollTo? } when deep-linked

  // Cross-module deep-link into Admin: a child fires window.dispatchEvent(
  // new CustomEvent('open-admin', { detail: { tab, scrollTo } })) and we
  // open the overlay on the requested tab + scroll a named section into
  // view. Used by Marketing → Local Ranking to jump to Webfront → Google
  // Reviews so admins can paste a Place ID without hunting for the gear.
  useEffect(() => {
    const handler = (e) => {
      setAdminInitial(e.detail || {});
      setShowAdmin(true);
    };
    window.addEventListener('open-admin', handler);
    return () => window.removeEventListener('open-admin', handler);
  }, []);

  // When set, OnboardingWizard opens at this phase instead of resuming
  // at the next pending phase. Used by the OAuth callback flow to drop
  // the user back where they were when they clicked Connect.
  const [wizardInitialPhase, setWizardInitialPhase] = useState(null);

  // Stripe Connect Standard OAuth callback handler. Behaviour is covered
  // by src/hooks/useStripeConnectOAuthCallback.test.jsx — including the
  // race against Firebase Auth's async resolution. onSuccess re-opens the
  // wizard at the phase that initiated OAuth (stored in sessionStorage by
  // Phase3Money before redirecting to Stripe) and shows a confirmation
  // toast, so the user doesn't land on the home tile grid wondering if
  // anything happened.
  // Land the salon back in Admin → Settings → Payments after the OAuth
  // round-trip, with a clear success/failure toast — the Payments section
  // shows the live status, so they always see the outcome (previously a
  // success relied on a fleeting toast + a wizard re-open that didn't surface,
  // and failures were silent).
  const finishConnectCallback = (toastMsg, toastMs) => {
    sessionStorage.removeItem('connect-return-to-wizard');
    showToast?.(toastMsg, toastMs);
    setShowAdmin(true);
    setAdminInitial({ tab: 'settings', scrollTo: 'payments' });
  };
  useStripeConnectOAuthCallback({
    gUser, settings, updateSettings,
    onSuccess: (status) => {
      const live = status?.chargesEnabled && status?.payoutsEnabled;
      finishConnectCallback(
        live
          ? '✓ Stripe connected — card payments are ready.'
          : '✓ Stripe connected — finish a couple details in Payments to enable payouts.',
        6500,
      );
    },
    onError: (e) => {
      finishConnectCallback(`✗ Stripe connection didn’t finish — ${e?.message || 'try again from Settings → Payments.'}`, 8000);
    },
  });

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
      if (v !== prev) recordNav(v, skipPushRef.current ? 'back' : 'user');
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

  // Global navigate handle — the AI assistant uses this to take the user
  // to a different module/view from inside the chat. Bounded to known
  // views so a hallucinated target can't break the app.
  useEffect(() => {
    const VALID = new Set(['home','tipflow','schedule','clients','services','employees','reports','marketing','meetings','memberships','products','attendance','communications','reviews','hr','grow']);
    window.__plumeNavigate = (target, opts = {}) => {
      const v = String(target || '').trim();
      if (v === 'admin') { setShowAdmin(true); if (opts.tab) setAdminInitial({ tab: opts.tab, scrollTo: opts.scrollTo }); return true; }
      if (!VALID.has(v)) return false;
      setView(v);
      recordNav(v, 'ai');
      return true;
    };
    return () => { delete window.__plumeNavigate; };
  }, [setView]);

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

      <Suspense fallback={<ChunkFallback />}>
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
        (!isModuleAvailableForPlan(id, effectivePlan(settings)) || !isModuleEnabled(settings, id)) ? (
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
          {id === 'receipts'   && <ReceiptsAdmin />}
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
          {id === 'intake'     && <IntakeAdmin />}
          {id === 'programs'   && <ProgramsAdmin />}
          {id === 'store'      && <StoreAdmin />}
          {id === 'grow' && (
            <GrowGuide
              onOpenWizard={(phaseKey) => { setWizardInitialPhase(phaseKey || null); setShowWizard(true); setDismissedThisSession(false); }}
              onOpenAdmin={(detail) => { setAdminInitial(detail || {}); setShowAdmin(true); }}
              onNavigate={setView}
            />
          )}
        </ModuleShell>
        )
      ))}
      </Suspense>

      {/* Admin settings overlay */}
      {showAdmin && <Suspense fallback={null}><Admin
        initialTab={adminInitial?.tab}
        scrollTo={adminInitial?.scrollTo}
        onClose={() => { setShowAdmin(false); setAdminInitial(null); }}
        onOpenWizard={(phaseKey) => {
          // Keep Admin open underneath — the wizard (z-index 200) renders over
          // the Admin overlay (z-index 50), so Settings stays put behind the
          // dimmed backdrop instead of flashing the home grid. Closing the
          // wizard returns the user to where they were in Settings.
          setWizardInitialPhase(phaseKey || null);
          setShowWizard(true);
          setDismissedThisSession(false);
        }}
      /></Suspense>}

      {showWizard && (
        <Suspense fallback={null}>
        <OnboardingWizard
          initialPhase={wizardInitialPhase}
          onDismiss={() => {
            setShowWizard(false);
            setDismissedThisSession(true);
            setWizardInitialPhase(null);
          }}
        />
        </Suspense>
      )}

      {/* Handbook signing — shown to non-admin staff on first login after publish */}
      {handbookPending && <Suspense fallback={null}><HandbookModal /></Suspense>}

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
  const [conn, setConn] = useState({ status: 'unknown', latencyMs: null });
  useEffect(() => { startConnHealth(); return subscribeConnHealth(setConn); }, []);
  const COLOR = { good: '#22c55e', slow: '#f59e0b', bad: '#ef4444', offline: '#ef4444', error: '#ef4444', unknown: '#9ca3af' };
  const color = COLOR[conn.status] || COLOR.unknown;
  const lat = conn.latencyMs != null ? `${conn.latencyMs}ms`
    : conn.status === 'offline' ? 'offline'
    : conn.status === 'error'   ? 'conn err'
    : '…';
  const pill = { fontSize: 10, color: '#777', fontWeight: 500, letterSpacing: '.03em', background: 'rgba(255,255,255,.85)', padding: '3px 8px', borderRadius: 8, backdropFilter: 'blur(4px)', border: '1px solid rgba(0,0,0,.06)', cursor: 'pointer' };
  return (
    <div style={{ position: 'fixed', bottom: 'calc(6px + env(safe-area-inset-bottom, 0px))', right: 10, zIndex: 9999, display: 'flex', gap: 6, alignItems: 'center' }}>
      <span onClick={() => pingConn()}
        title={`Firestore round-trip latency (click to re-test). Green < 1.2s, amber < 3s, red = slow/offline.${conn.latencyMs != null ? ` Last: ${conn.latencyMs}ms` : ''}`}
        style={{ ...pill, display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: color, flexShrink: 0 }} />
        {lat}
      </span>
      <span title="Click to copy" onClick={() => { navigator.clipboard?.writeText(BUILD_LABEL); }}
        style={{ ...pill, userSelect: 'all' }}>
        {BUILD_LABEL}
      </span>
    </div>
  );
}

// Visual marker shown on any tenant NOT flagged live/production (Admin →
// Settings → "This tenant is live"). Production-flagged tenants show nothing;
// everyone else (demo, staging, and any tenant not yet taken live) gets a
// pre-production ribbon. Driven by the public slugs/{slug}.isProduction flag
// resolved at boot, so it's correct even on the logged-out booking page.
function EnvBanner() {
  if (isProductionTenant()) return null;
  const label = TENANT_ID === 'merakinailstudio-staging' ? 'STAGING' : TENANT_ID.toUpperCase();
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
        ⚠ {label} · PRE-PRODUCTION — not yet live
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
    // Public routes accept the clean path form (/book, /privacy, ...) and the
    // legacy query-flag form (?book=1, ?privacy=1, ...) for back-compat with
    // already-sent emails / SMS / business cards / bookmarks.
    // The bare domain (/) IS the customer-facing salon webfront; the staff
    // management app lives at /manage.
    const isBooking     = params.has('book')        || path === '/book';
    const isQueue       = params.has('queue')       || path === '/queue';
    const isTipFlow     = params.has('tipflow')     || path === '/tipflow';
    const isTimeClock   = params.has('timeclock')   || path === '/timeclock';
    const isManageApp   = path === '/manage';
    // Stripe Connect Standard OAuth registers `https://<tenant>.plumenexus.com/?connect=oauth-callback`
    // as its return URL — Stripe requires exact pre-registration of redirect URIs and
    // we don't want to register a different URI per surface. So any landing at root
    // with ?connect=oauth-callback is a Stripe round-trip; route to the management
    // app so the callback handler can claim the OAuth code.
    const isConnectCallback = params.get('connect') === 'oauth-callback';
    const isSignup      = params.has('signup')      || path === '/signup';
    const isTerms       = params.has('terms')       || path === '/terms';
    const isPrivacy     = params.has('privacy')     || path === '/privacy';
    const isSmsConsent  = params.has('sms-consent') || path === '/sms-consent';
    // Staff SMS invite claim — `/invite?token=…` texted to a new hire.
    const isStaffInvite = params.has('invite')      || path === '/invite';
    // Public "Buy a Gift Card" page.
    const isGiftCard    = params.has('giftcard')    || path === '/gift';
    // Hosted receipt view — `/r/{token}` is the canonical SMS/email link.
    // Path is dynamic, so we match by prefix rather than equality.
    const isReceiptView = /^\/r\/[A-Za-z0-9_-]{16,128}\/?$/.test(path) || params.has('r');
    // rsvp / unsub / manage(=token) carry tokens in the query string — they
    // stay query-only (no clean path equivalent). `?manage=<token>` is the
    // appointment-management magic link, distinct from the `/manage` path.
    const isRsvp     = params.has('rsvp');
    const isUnsub    = params.has('unsub');
    const isManageToken = params.has('manage');
    // `?intake=<formId>&tid=&c=&t=&exp=` — HMAC-signed intake / waiver fill link.
    const isIntake   = params.has('intake');
    // `?gear` (optionally &tid=) — public "Recommended Gear" affiliate storefront.
    const isGear     = params.has('gear');
    // `?store` (optionally &tid=) — public product shop (Stripe Connect checkout).
    const isStore    = params.has('store');
    if      (isManageToken) content = <ManageAppointmentScreen />;
    else if (isIntake)  content = <IntakeFormScreen />;
    else if (isGear)    content = <GearStorefront />;
    else if (isStore)   content = <ProductShop />;
    else if (isUnsub)   content = <UnsubscribeScreen />;
    else if (isTerms)      content = <TermsScreen />;
    else if (isPrivacy)    content = <PrivacyScreen />;
    else if (isSmsConsent) content = <SmsConsentScreen />;
    else if (isStaffInvite) content = <StaffInviteScreen />;
    else if (isGiftCard)    content = <GiftCardPurchaseScreen />;
    else if (isReceiptView) content = <ReceiptViewPage />;
    else if (isRsvp)    content = <RsvpScreen />;
    else if (checkinId) content = <CheckInScreen apptId={checkinId} />;
    else if (isBooking) content = <BookingScreen />;
    else if (isQueue)   content = <QueueKiosk />;
    else if (isTimeClock) content = <TimeClockKiosk />;
    else if (isSignup)  content = <OnboardingScreen />;
    else if (isManageApp || isTipFlow || isConnectCallback) content = (
      <AppProvider>
        <ThemeProvider>
          <div style={{ width: '100vw', height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef0f3', overflow: 'hidden' }}>
            <AppShell initialView={isTipFlow ? 'tipflow' : 'home'} />
          </div>
        </ThemeProvider>
      </AppProvider>
    );
    else content = <SalonWebfront />;
  }

  return <><EnvBanner /><Suspense fallback={<ChunkFallback />}>{content}</Suspense><VersionBadge /></>;
}
