import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { CORE_THEMES, HOLIDAY_THEMES, detectAutoTheme } from '../../lib/themes';
import { buildExportBundle } from '../../lib/exportBundle';
import JSZip from 'jszip';
import { TENANT_ID, currentSubdomain } from '../../lib/tenant';
import { fetchLogs, fetchEmployees, createEmployee, saveEmployee,
         fetchFeedback, updateFeedbackStatus,
         fetchNotificationCenter,
         fetchAllForBackup, restoreFromBackup, fetchTenantRecord,
         fetchBookingConfig, saveBookingConfig,
         fetchWebfrontConfig, saveWebfrontConfig,
         fetchReviewReceived, fetchReviewRequests,
         saveReviewReceived, findBusinessByAddress,
         subscribeGoogleBusinessAuth, startGoogleBusinessAuth,
         syncGoogleBusinessReviews, disconnectGoogleBusiness,
         subscribeGoogleReviews } from '../../lib/firestore';
import { ASSIGNMENT_METHODS, ASSIGNMENT_METHOD_LABELS, ASSIGNMENT_METHOD_DESCRIPTIONS, DEFAULT_ASSIGNMENT_METHOD } from '../../lib/techAssignment';
import { FLOW_TEMPLATES, FLOW_DEFAULTS, getEffectiveFlow } from '../../lib/bookingFlow';
import { MODULES, effectivePlan, isModuleAvailableForPlan, isModuleEnabled, modulesLostOnDowngrade, PLAN_RANK, isInTrial, trialDaysRemaining } from '../../lib/modules';
import { fetchMemberships } from '../../lib/firestore';
import { formatTime } from '../../utils/helpers';
import { logActivity } from '../../lib/logger';
import { seedFullDemo, clearDemoData, addFutureAppointments } from '../../data/seedDemo';
import { fetchSeedState, fetchIntegrityReport, fetchDisputes, uploadPortfolioPhoto } from '../../lib/firestore';
import TrashPanel from '../../components/TrashPanel';
import FeedbackModal from '../../components/FeedbackModal';
import NotificationsBell from '../../components/NotificationsBell';
import SmsSetup from './SmsSetup';
import { subscribeOnboarding, completedCount, isOnboardingComplete, phaseStatus, PHASES as ONBOARDING_PHASES } from '../../lib/onboarding';
import CsvImportSection from '../../components/CsvImportSection';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import LocationsTab from './LocationsTab';

export default function Admin({ onClose, onOpenWizard, initialTab, scrollTo }) {
  const { gUser, users, settings, grantAccess, grantPendingAccess, addTechUsersForEmployees, loadPendingRequests, updateSettings, signOut, isAdmin, syncState, showToast } = useApp();
  const [timeout,        setTimeoutVal]    = useState(settings.timeoutMin || 5);
  const [pin,            setPin]           = useState(settings.adminPin || '');
  const [reviewUrl,      setReviewUrl]     = useState(settings.googleReviewUrl || '');
  const [ein,            setEin]           = useState(settings.ein || '');
  const [reminderHour,   setReminderHour]  = useState(settings.reminderHour ?? 9);
  const [birthdayHour,   setBirthdayHour]  = useState(settings.birthdayHour ?? 10);
  const [lapsedHour,     setLapsedHour]    = useState(settings.lapsedHour   ?? 11);
  const [timezone,       setTimezone]      = useState(settings.timezone || 'America/New_York');
  // Time clock settings (settings.timeclock.*). Defaults match the backend
  // fallbacks so saving the form for the first time doesn't alter behavior.
  const tcCfg = settings.timeclock || {};
  const [tcDefaultBreak,     setTcDefaultBreak]     = useState(tcCfg.defaultBreakMinutes ?? 30);
  const [tcBreakWarning,     setTcBreakWarning]     = useState(tcCfg.breakWarningMinutes ?? 10);
  const [tcSmsOnIn,          setTcSmsOnIn]          = useState(tcCfg.smsOnClockIn      !== false);
  const [tcSmsOnOut,         setTcSmsOnOut]         = useState(tcCfg.smsOnClockOut     !== false);
  const [tcSmsOnBreakStart,  setTcSmsOnBreakStart]  = useState(tcCfg.smsOnBreakStart   === true);
  const [tcSmsOnBreakEnd,    setTcSmsOnBreakEnd]    = useState(tcCfg.smsOnBreakEnd     === true);
  const [tcSmsBreakReminder, setTcSmsBreakReminder] = useState(tcCfg.smsBreakReminder  !== false);
  const [tcSaving,           setTcSaving]           = useState(false);
  const [salonName,        setSalonName]        = useState(settings.salonName        || '');
  const [brandName,        setBrandName]        = useState(settings.brandName        || '');
  const [brandTagline,     setBrandTagline]     = useState(settings.brandTagline     || '');
  const [brandTaglineTop,  setBrandTaglineTop]  = useState(settings.brandTaglineTop  || '');
  const [brandColor,       setBrandColor]       = useState(settings.brandColor       || '#2D7A5F');
  const [brandLogoUrl,     setBrandLogoUrl]     = useState(settings.brandLogoUrl     || '');
  const [welcomeStyle,     setWelcomeStyle]     = useState(settings.welcomeStyle     || 'centered');
  const [showUrlSoon,      setShowUrlSoon]      = useState(false);
  const [tenantRecord,     setTenantRecord]     = useState(null);
  const tenantSubdomain = tenantRecord?.subdomain || currentSubdomain();
  const tenantAliases   = Array.isArray(tenantRecord?.aliases) ? tenantRecord.aliases : [];
  useEffect(() => {
    let cancelled = false;
    fetchTenantRecord(TENANT_ID).then(t => { if (!cancelled) setTenantRecord(t); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [receiptDelivery,        setReceiptDelivery]        = useState(settings.receiptDelivery        || 'auto');
  const [reviewRoutingThreshold, setReviewRoutingThreshold] = useState(settings.reviewRoutingThreshold ?? 4);
  const [emailRatingStyle,       setEmailRatingStyle]       = useState(settings.emailRatingStyle       || 'both');
  const [taxRate,        setTaxRate]       = useState(settings.taxRate ?? 7.5);
  const [ccFeePct,       setCcFeePct]      = useState(settings.ccFeePct ?? 2.9);
  const [ccFeeFlat,      setCcFeeFlat]     = useState(settings.ccFeeFlat ?? 0.30);
  const [removalPrice,   setRemovalPrice]  = useState(settings.removalPrice ?? 15);
  const [noCardTips,     setNoCardTips]    = useState(!!settings.noCardTips);
  const [terminalLocationId, setTerminalLocationId] = useState(settings.terminalLocationId ?? '');
  const [finSaving,      setFinSaving]     = useState(false);
  const [themeId,        setThemeId]       = useState(settings.themeId   || 'meraki');
  const [autoTheme,      setAutoTheme]     = useState(!!settings.autoTheme);
  const [themeSaving,    setThemeSaving]   = useState(false);
  const [bookingCfg,   setBookingCfg]  = useState(null);
  const [pendingReqs,  setPendingReqs] = useState([]);
  const [reqsLoading,  setReqsLoading] = useState(false);
  const [employees,    setEmployees]   = useState([]);
  const [logs,     setLogs]      = useState(null);
  const [feedback, setFeedback]  = useState(null);
  const [notifs,   setNotifs]    = useState(null);
  const [tab,          setTab]          = useState(initialTab || 'settings');
  const [showFeedback, setShowFeedback] = useState(false);
  const [webfrontCfg,  setWebfrontCfg] = useState(null);
  const [reviewsData,  setReviewsData]  = useState(null);
  const isSuperAdmin = gUser?.email === 'jvankim@gmail.com';
  const TABS = [
    { id: 'users',    label: 'Users'    },
    { id: 'notifs',   label: 'Notifs'   },
    { id: 'reviews',  label: 'Reviews'  },
    { id: 'settings', label: 'Settings' },
    ...(isAdmin ? [{ id: 'locations', label: 'Locations' }] : []),
    { id: 'webfront', label: 'Webfront' },
    { id: 'sms',      label: 'SMS'      },
    { id: 'onboarding', label: 'Onboarding' },
    { id: 'feedback', label: 'Feedback' },
    // Trash exposes tombstone records (including deleted client names,
    // deletion attribution). Admin-only — scheduler/readonly shouldn't
    // see who deleted what. Server-side rules still enforce per-write,
    // this is the UI-side narrowing.
    ...(isAdmin ? [{ id: 'trash', label: '🗑 Trash' }] : []),
    { id: 'logs',     label: 'Logs'     },
  ];

  useEffect(() => {
    if (!scrollTo) return;
    // Wait for the requested tab's content to mount (effects above can
    // trigger further loads; the section may not exist on first paint).
    const start = performance.now();
    const tryScroll = () => {
      const el = document.querySelector(`[data-anchor="${scrollTo}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.style.transition = 'background-color 1.2s ease';
        el.style.backgroundColor = '#fef9c3';
        setTimeout(() => { el.style.backgroundColor = ''; }, 1500);
        return;
      }
      if (performance.now() - start < 2000) requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  }, [scrollTo, tab]); // eslint-disable-line
  useEffect(() => { if (tab === 'settings' && !bookingCfg) fetchBookingConfig().then(setBookingCfg).catch(() => {}); }, [tab]); // eslint-disable-line
  useEffect(() => { if (tab === 'webfront' && !webfrontCfg) fetchWebfrontConfig().then(wf => setWebfrontCfg({ tagline: '', about: '', phone: '', address: '', mapsUrl: '', instagram: '', facebook: '', tiktok: '', hours: {}, showBookingCta: true, showServices: true, showTeam: true, hiddenEmployeeIds: [], ...wf })).catch(() => {}); }, [tab]); // eslint-disable-line
  useEffect(() => { if (tab === 'logs')     loadLogs(); },     [tab]);
  useEffect(() => { if (tab === 'feedback') loadFeedback(); }, [tab]); // eslint-disable-line
  useEffect(() => { if (tab === 'notifs')   loadNotifs(); },   [tab]); // eslint-disable-line
  useEffect(() => { if (tab === 'reviews')  loadReviews(); },  [tab]); // eslint-disable-line
  useEffect(() => {
    if (tab === 'users') {
      setReqsLoading(true);
      loadPendingRequests().then(setPendingReqs).catch(() => setPendingReqs([])).finally(() => setReqsLoading(false));
      fetchEmployees().then(emps => setEmployees(emps.filter(e => e.active !== false))).catch(() => {});
    }
  }, [tab]); // eslint-disable-line

  async function loadLogs() {
    setLogs(null);
    try { setLogs(await fetchLogs(100)); }
    catch { setLogs([]); }
  }

  async function loadNotifs() {
    setNotifs(null);
    try { setNotifs(await fetchNotificationCenter(200)); }
    catch { setNotifs([]); }
  }

  async function loadFeedback() {
    setFeedback(null);
    try { setFeedback(await fetchFeedback()); }
    catch { setFeedback([]); }
  }

  async function loadReviews() {
    setReviewsData(null);
    try {
      const [requests, received] = await Promise.all([fetchReviewRequests(), fetchReviewReceived()]);
      setReviewsData({ requests, received });
    } catch { setReviewsData({ requests: [], received: [] }); }
  }

  async function handleFeedbackStatus(id, status) {
    await updateFeedbackStatus(id, status);
    setFeedback(fb => fb.map(f => f.id === id ? { ...f, status } : f));
  }

  if (!isAdmin) return null;

  const others = users.filter(u => u.role !== 'pending');

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--pn-surface-alt)', zIndex: 50, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: 'var(--pn-surface)', borderBottom: '1px solid var(--pn-border)', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button onClick={onClose}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#3D95CE', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '8px 6px', borderRadius: 6, flexShrink: 0, minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Home
        </button>
        <span style={{ color: 'var(--pn-border)', fontSize: 16, flexShrink: 0 }}>›</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 16 }}>⚙</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--pn-text)' }}>Admin</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: { syncing: '#f59e0b', ok: '#22c55e', err: '#ef4444', idle: '#ddd' }[syncState] || '#ddd', transition: 'background .3s', animation: syncState === 'syncing' ? 'pulse .8s infinite' : 'none', marginRight: 2 }} />
          {isAdmin && <IntegrityBadge onJumpToTrash={() => setTab('trash')} />}
          <button onClick={() => setShowFeedback(true)}
            style={{ height: 40, borderRadius: 20, border: 'none', background: 'var(--pn-info-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', fontSize: 13, fontWeight: 600, color: 'var(--pn-info)', fontFamily: 'inherit' }}>
            <span style={{ fontSize: 15 }}>💬</span> Feedback
          </button>
          <NotificationsBell />
          {gUser?.photoURL && <img src={gUser.photoURL} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--pn-border)' }} />}
        </div>
      </div>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--pn-border)', background: 'var(--pn-surface)', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '10px 0', fontSize: 11, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? '#3D95CE' : 'var(--pn-text-muted)', background: 'none', border: 'none', borderBottom: tab === t.id ? '2px solid #3D95CE' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {tab === 'users' && (
          <>
            <Section title="👤 Pending Access Requests">
              {reqsLoading
                ? <Empty>Loading…</Empty>
                : pendingReqs.length
                  ? pendingReqs.map(req => (
                    <PendingRow
                      key={req.uid}
                      req={req}
                      employees={employees}
                      onGrant={(role, techName) =>
                        grantPendingAccess(req, role, techName)
                          .then(() => setPendingReqs(r => r.filter(x => x.uid !== req.uid)))
                      }
                    />
                  ))
                  : <Empty>No pending requests</Empty>
              }
            </Section>
            <Section title="👥 Users" action={<AddMissingTechUsersBtn employees={employees} users={users} addTechUsersForEmployees={addTechUsersForEmployees} showToast={showToast} />}>
              {others.length ? others.map(u => (
                <UserRow key={u.email} user={u}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <select value={u.role} onChange={e => grantAccess(u.email, e.target.value, u.techName)}
                      style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', fontFamily: 'inherit' }}>
                      <option value="readonly">View only</option>
                      <option value="tech">Tech</option>
                      <option value="scheduler">Front desk</option>
                      <option value="admin">Admin</option>
                      <option value="denied">Denied</option>
                    </select>
                    {/* Tech-name picker — required for 'tech' role, optional
                        for admin/scheduler/readonly so an owner who's also
                        a working tech can flip into their own tech view via
                        the HomeScreen "My tech view" toggle. */}
                    {(u.role === 'tech' || u.role === 'admin' || u.role === 'scheduler' || u.role === 'readonly') && (
                      <select value={u.techName || ''} onChange={async e => {
                        const newTechName = e.target.value || null;
                        grantAccess(u.email, u.role, newTechName);
                        const emp = newTechName && employees.find(ex => ex.name === newTechName);
                        if (emp) await saveEmployee(emp.id, { email: u.email });
                      }}
                        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', fontFamily: 'inherit' }}>
                        <option value="">{u.role === 'tech' ? 'Assign tech…' : 'Also a tech? (optional)'}</option>
                        {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                      </select>
                    )}
                    {/* Per-tech schedule permission. Edit (default) lets the
                        tech add/move/edit their own appointments; View only
                        restricts them to reading their day. Enforced in the
                        Firestore rules, not just here. */}
                    {u.role === 'tech' && (
                      <select value={u.scheduleAccess || 'edit'}
                        title="Whether this tech can edit their own schedule, or only view it"
                        onChange={e => grantAccess(u.email, u.role, u.techName, e.target.value)}
                        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', fontFamily: 'inherit' }}>
                        <option value="edit">Can edit schedule</option>
                        <option value="view">Schedule: view only</option>
                      </select>
                    )}
                  </div>
                </UserRow>
              )) : <Empty>No users yet</Empty>}
            </Section>
          </>
        )}

        {tab === 'notifs' && (
          <NotifsTab items={notifs} onRefresh={loadNotifs} />
        )}

        {tab === 'reviews' && (
          <ReviewsTab data={reviewsData} onRefresh={loadReviews} onMarkReceived={async (req) => {
            await saveReviewReceived({ clientId: req.clientId, clientName: req.clientName, techName: req.techName, rating: 5, text: '', source: 'google', confirmedAt: new Date().toISOString() });
            await loadReviews();
          }} />
        )}

        {tab === 'locations' && <LocationsTab />}

        {tab === 'webfront' && (
          <WebfrontTab cfg={webfrontCfg} setCfg={setWebfrontCfg} employees={employees} />
        )}

        {tab === 'sms' && (
          <SmsSetup />
        )}

        {tab === 'onboarding' && (
          <OnboardingTab onOpenWizard={onOpenWizard} />
        )}

        {tab === 'feedback' && (
          <FeedbackTab items={feedback} onStatus={handleFeedbackStatus} onRefresh={loadFeedback} />
        )}

        {tab === 'trash' && (
          <TrashPanel />
        )}

        {tab === 'logs' && (
          <Section title="📄 Activity Log" action={<Btn onClick={loadLogs}>Refresh</Btn>}>
            {logs === null
              ? <Empty>Loading…</Empty>
              : logs.length
                ? logs.map((log, i) => <LogRow key={i} log={log} />)
                : <Empty>No logs yet</Empty>
            }
          </Section>
        )}

        {tab === 'settings' && (
          <>
            {/* ── Brand & Identity (URL + every brand field, single Save) ── */}
            <Section title="🌐 Brand & Identity">
              {/* Salon URL — read-only display + coming-soon CTA. */}
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Your salon URL</div>
                <div style={{
                  padding: '10px 14px', background: 'var(--pn-bg)', border: '1px solid var(--pn-border)',
                  borderRadius: 10, marginBottom: 8,
                  fontSize: 14, fontWeight: 600, color: 'var(--pn-text)',
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                }}>
                  https://{tenantSubdomain}.plumenexus.com
                </div>
                {tenantAliases.length > 0 && (
                  <div style={{ padding: '8px 12px', background: '#f5f3fa', border: '1px solid #e6e0ee', borderRadius: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: '#6a4fa0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Previous URLs (still working as 301 redirects)</div>
                    {tenantAliases.map(a => (
                      <div key={a} style={{ fontSize: 11, color: '#6a4fa0', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
                        https://{a}.plumenexus.com → current
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => setShowUrlSoon(true)} style={{
                  padding: '6px 12px', fontSize: 12, fontWeight: 600,
                  background: 'var(--pn-surface)', color: '#6a4fa0', border: '1px solid #d8c8ec',
                  borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                }}>Change my URL</button>
                <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 8, lineHeight: 1.5 }}>
                  Your old URL keeps working forever as a 301 redirect — bookmarks, QR codes, and shared links never break.
                </div>
              </div>

              {/* Brand fields */}
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Salon name</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Full business name shown in the header, sidebar, and customer emails.</div>
                </div>
                <input value={salonName} onChange={e => setSalonName(e.target.value)} placeholder="e.g. Meraki Nail Studio" maxLength={80}
                  style={{ width: 220, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Brand name (short)</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Used in cursive on the launch splash. Often the first word of your salon name.</div>
                </div>
                <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="e.g. Meraki" maxLength={40}
                  style={{ width: 220, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Tagline (above brand)</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Small cursive line above the brand name on the splash. Optional.</div>
                </div>
                <input value={brandTaglineTop} onChange={e => setBrandTaglineTop(e.target.value)} placeholder="e.g. Welcome to" maxLength={40}
                  style={{ width: 220, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Tagline (below brand)</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Small caps under the brand name on the splash. Leave blank to hide.</div>
                </div>
                <input value={brandTagline} onChange={e => setBrandTagline(e.target.value)} placeholder="e.g. Nail Studio" maxLength={40}
                  style={{ width: 220, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Logo URL (optional)</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>If set, used in place of the default mark on the splash and shell.</div>
                </div>
                <input value={brandLogoUrl} onChange={e => setBrandLogoUrl(e.target.value)} placeholder="https://…/logo.png"
                  style={{ width: 220, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 12 }} />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Welcome screen style</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Layout of the pre-login welcome card. &ldquo;Centered&rdquo; is the default.</div>
                </div>
                <select value={welcomeStyle} onChange={e => setWelcomeStyle(e.target.value)}
                  style={{ width: 240, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: 'var(--pn-surface)', cursor: 'pointer' }}>
                  <option value="centered">Boutique &mdash; centered (default)</option>
                  <option value="hairlineSplit">Boutique &mdash; split (hairline)</option>
                  <option value="stacked">Boutique &mdash; stacked card</option>
                  <option value="photo">Photo backdrop &mdash; centered</option>
                  <option value="photoSplit">Photo backdrop &mdash; split</option>
                  <option value="merakiSite">Editorial homepage &mdash; full landing page</option>
                </select>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Brand color</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Primary accent for buttons, headers, and email gradients.</div>
                </div>
                <input type="color" value={brandColor} onChange={e => setBrandColor(e.target.value)}
                  style={{ width: 44, height: 34, border: '1px solid var(--pn-border-strong)', borderRadius: 8, cursor: 'pointer', padding: 2, background: 'var(--pn-surface)' }} />
              </div>
              <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--pn-border)', paddingTop: 12 }}>
                <Btn color="#3D95CE" savedLabel="✓ Saved" onClick={async () => {
                  const sName = salonName.trim()      || null;
                  const bName = brandName.trim()      || null;
                  const bTag  = brandTagline.trim()   || null;
                  const bTop  = brandTaglineTop.trim()|| null;
                  const bLogo = brandLogoUrl.trim()   || null;
                  // Branding fields go to BOTH stores so pre-login + public
                  // surfaces (booking page, check-in, kiosk) read the same
                  // values as the signed-in admin UI.
                  await Promise.all([
                    updateSettings({
                      ...settings,
                      salonName: sName, brandName: bName, brandTagline: bTag, brandTaglineTop: bTop,
                      brandColor, brandLogoUrl: bLogo, welcomeStyle,
                    }),
                    fetchWebfrontConfig().then(wf => saveWebfrontConfig({
                      ...(wf || {}),
                      salonName: sName, brandName: bName, brandTagline: bTag, brandTaglineTop: bTop,
                      brandColor, brandLogoUrl: bLogo, welcomeStyle,
                    })),
                  ]);
                  showToast('Brand saved');
                }}>Save</Btn>
              </div>
            </Section>

            {/* Coming-soon modal for "Change my URL" */}
            {showUrlSoon && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }} onClick={() => setShowUrlSoon(false)}>
                <div onClick={e => e.stopPropagation()} style={{ background: 'var(--pn-surface)', borderRadius: 14, padding: 24, maxWidth: 440, width: '100%', boxShadow: '0 16px 40px rgba(0,0,0,.2)' }}>
                  <div style={{ width: 52, height: 52, borderRadius: 12, background: 'linear-gradient(135deg, #6a4fa0, #3d95ce)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, marginBottom: 14 }}>🚧</div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--pn-text)', margin: '0 0 8px' }}>Self-serve URL change — coming soon</h3>
                  <p style={{ fontSize: 13, color: 'var(--pn-text-muted)', lineHeight: 1.6, margin: '0 0 14px' }}>
                    We're building a self-serve flow so you can change your salon URL anytime. Until then, email <a href="mailto:hello@plumenexus.com" style={{ color: '#6a4fa0', fontWeight: 600 }}>hello@plumenexus.com</a> and we'll handle it within one business day. Your old URL stays as a permanent 301 redirect so nothing breaks.
                  </p>
                  <button onClick={() => setShowUrlSoon(false)} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: '#6a4fa0', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>Got it</button>
                </div>
              </div>
            )}

            <Section title="⚙ App Settings">
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Auto-logout timeout</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Minutes of inactivity before signing out</div>
                </div>
                <input type="number" value={timeout} onChange={e => setTimeoutVal(Number(e.target.value))} min={1} max={60}
                  style={{ width: 80, textAlign: 'center', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }} />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>HR &amp; Reports PIN lock</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>4-digit PIN required to open HR and Reports. Leave blank to disable.</div>
                </div>
                <input type="password" inputMode="numeric" maxLength={4} value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="----"
                  style={{ width: 80, textAlign: 'center', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 12px', fontSize: 18, letterSpacing: 6 }} />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Google Review URL</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Included as a button in receipt emails sent to clients.</div>
                </div>
                <input type="url" value={reviewUrl} onChange={e => setReviewUrl(e.target.value)} placeholder="https://g.page/r/…/review"
                  style={{ width: 220, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 12 }} />
              </div>
<div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Business EIN</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Employer Identification Number — printed on 1099-NEC forms.</div>
                </div>
                <input value={ein} onChange={e => setEin(e.target.value)} placeholder="XX-XXXXXXX"
                  style={{ width: 140, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Reminder send time</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>What hour to send appointment reminders for tomorrow's appointments.</div>
                </div>
                <select value={reminderHour} onChange={e => setReminderHour(Number(e.target.value))}
                  style={{ width: 110, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: 'var(--pn-surface)' }}>
                  {Array.from({ length: 24 }, (_, h) => {
                    const ampm = h >= 12 ? 'PM' : 'AM';
                    const hh   = h === 0 ? 12 : (h > 12 ? h - 12 : h);
                    return <option key={h} value={h}>{hh}:00 {ampm}</option>;
                  })}
                </select>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Birthday campaign hour</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Hour to send birthday emails (auto-birthday campaign).</div>
                </div>
                <select value={birthdayHour} onChange={e => setBirthdayHour(Number(e.target.value))}
                  style={{ width: 110, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: 'var(--pn-surface)' }}>
                  {Array.from({ length: 24 }, (_, h) => {
                    const ampm = h >= 12 ? 'PM' : 'AM';
                    const hh   = h === 0 ? 12 : (h > 12 ? h - 12 : h);
                    return <option key={h} value={h}>{hh}:00 {ampm}</option>;
                  })}
                </select>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Lapsed-client hour (Mondays)</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Hour to send re-engagement emails (auto-lapsed campaign, Mondays).</div>
                </div>
                <select value={lapsedHour} onChange={e => setLapsedHour(Number(e.target.value))}
                  style={{ width: 110, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: 'var(--pn-surface)' }}>
                  {Array.from({ length: 24 }, (_, h) => {
                    const ampm = h >= 12 ? 'PM' : 'AM';
                    const hh   = h === 0 ? 12 : (h > 12 ? h - 12 : h);
                    return <option key={h} value={h}>{hh}:00 {ampm}</option>;
                  })}
                </select>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Time zone</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Used for reminder timing and date-based comparisons.</div>
                </div>
                <select value={timezone} onChange={e => setTimezone(e.target.value)}
                  style={{ width: 220, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: 'var(--pn-surface)' }}>
                  <option value="America/New_York">Eastern (New York)</option>
                  <option value="America/Chicago">Central (Chicago)</option>
                  <option value="America/Denver">Mountain (Denver)</option>
                  <option value="America/Phoenix">Mountain — Arizona (no DST)</option>
                  <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
                  <option value="America/Anchorage">Alaska</option>
                  <option value="Pacific/Honolulu">Hawaii</option>
                </select>
              </div>
              <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--pn-border)', paddingTop: 12 }}>
                <Btn color="#3D95CE" savedLabel="✓ Saved" onClick={() => updateSettings({ ...settings, timeoutMin: timeout, adminPin: pin || null, googleReviewUrl: reviewUrl.trim() || null, ein: ein.trim() || null, reminderHour, birthdayHour, lapsedHour, timezone })}>Save</Btn>
              </div>
            </Section>
            <Section title="🕐 Time Clock">
              {/* Break length + warning */}
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Default break length</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Used by the break-end reminder to know when a tech is "due back."</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" min={5} max={240} value={tcDefaultBreak}
                    onChange={e => setTcDefaultBreak(Number(e.target.value) || 30)}
                    style={{ width: 70, textAlign: 'center', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
                  <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>min</span>
                </div>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Break-end warning</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>SMS the tech this many minutes before the break length is up.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" min={1} max={60} value={tcBreakWarning}
                    onChange={e => setTcBreakWarning(Number(e.target.value) || 10)}
                    style={{ width: 70, textAlign: 'center', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
                  <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>min before</span>
                </div>
              </div>

              {/* SMS toggles */}
              <TcToggle border value={tcSmsOnIn}          onChange={setTcSmsOnIn}          label="Text tech on clock-in"  hint="“Clocked in at 9:01 AM…”" />
              <TcToggle border value={tcSmsOnOut}         onChange={setTcSmsOnOut}         label="Text tech on clock-out" hint="“Clocked out at 5:30 PM. 8h worked today.”" />
              <TcToggle border value={tcSmsBreakReminder} onChange={setTcSmsBreakReminder} label="Text break-end warning" hint="Heads-up before the break length is up." />
              <TcToggle border value={tcSmsOnBreakStart}  onChange={setTcSmsOnBreakStart}  label="Text tech on break start" hint="Verbose — default off." />
              <TcToggle border value={tcSmsOnBreakEnd}    onChange={setTcSmsOnBreakEnd}    label="Text tech on break end"   hint="Verbose — default off." />

              <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--pn-border)', paddingTop: 12 }}>
                <Btn color="#3D95CE" savedLabel={tcSaving ? '...' : '✓ Saved'} onClick={async () => {
                  setTcSaving(true);
                  try {
                    await updateSettings({
                      ...settings,
                      timeclock: {
                        ...(settings.timeclock || {}),
                        defaultBreakMinutes: Math.max(5, Math.min(240, Number(tcDefaultBreak) || 30)),
                        breakWarningMinutes: Math.max(1, Math.min(60,  Number(tcBreakWarning) || 10)),
                        smsOnClockIn:    tcSmsOnIn,
                        smsOnClockOut:   tcSmsOnOut,
                        smsBreakReminder: tcSmsBreakReminder,
                        smsOnBreakStart: tcSmsOnBreakStart,
                        smsOnBreakEnd:   tcSmsOnBreakEnd,
                      },
                    });
                  } finally { setTcSaving(false); }
                }}>Save</Btn>
              </div>
            </Section>
            <Section title="🧾 Receipts & Ratings">
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Receipt delivery</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>
                    Auto = email if email on file, SMS if phone on file (no double-send). Override to force one channel or send both.
                  </div>
                </div>
                <select value={receiptDelivery} onChange={e => setReceiptDelivery(e.target.value)}
                  style={{ width: 200, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: 'var(--pn-surface)' }}>
                  <option value="auto">Auto (recommended)</option>
                  <option value="email">Email only</option>
                  <option value="sms">SMS only</option>
                  <option value="both">Email + SMS (both)</option>
                </select>
              </div>

              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid #f7f7f7' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Public review threshold</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>
                    Ratings at or above this go to Google. Below it, the client lands on a private feedback form so you can address it before it's public.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="range" min={1} max={5} step={1}
                    value={reviewRoutingThreshold}
                    onChange={e => setReviewRoutingThreshold(Number(e.target.value))}
                    style={{ width: 120 }} />
                  <span style={{ fontSize: 13, color: 'var(--pn-text)', fontWeight: 600, minWidth: 24, textAlign: 'right' }}>
                    {'★'.repeat(reviewRoutingThreshold)}
                  </span>
                </div>
              </div>

              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid #f7f7f7' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Email rating CTA</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>
                    Stars = one tap from inbox to submitted. Button = opens the rating page. Both = stars on top, button below.
                  </div>
                </div>
                <select value={emailRatingStyle} onChange={e => setEmailRatingStyle(e.target.value)}
                  style={{ width: 200, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: 'var(--pn-surface)' }}>
                  <option value="inline_stars">Inline stars only</option>
                  <option value="single_button">Single button only</option>
                  <option value="both">Both (recommended)</option>
                </select>
              </div>

              <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--pn-border)', paddingTop: 12 }}>
                <Btn color="#3D95CE" savedLabel="✓ Saved" onClick={() => updateSettings({
                  ...settings,
                  receiptDelivery,
                  reviewRoutingThreshold: Math.max(1, Math.min(5, Math.round(Number(reviewRoutingThreshold) || 4))),
                  emailRatingStyle,
                })}>Save</Btn>
              </div>
            </Section>
            <Section title="💰 Financial">
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Sales tax rate</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Applied to services and retail products. Gift card sales are not taxed.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" value={taxRate} step="0.01" min={0} max={20}
                    onChange={e => setTaxRate(Number(e.target.value))}
                    style={{ width: 90, textAlign: 'right', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
                  <span style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>%</span>
                </div>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Card processing fee</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Stripe-style: percentage + flat amount. Recorded on each card transaction so reports can show your true take-home.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="number" value={ccFeePct} step="0.01" min={0} max={10}
                    onChange={e => setCcFeePct(Number(e.target.value))}
                    style={{ width: 70, textAlign: 'right', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
                  <span style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>%  +</span>
                  <span style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>$</span>
                  <input type="number" value={ccFeeFlat} step="0.01" min={0} max={5}
                    onChange={e => setCcFeeFlat(Number(e.target.value))}
                    style={{ width: 70, textAlign: 'right', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
                </div>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Stripe Terminal Location ID</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>For in-person card payments (Tap to Pay / reader). Create a Location in Stripe → Terminal → Locations and paste its <code>tml_…</code> ID. Must match the app's Stripe mode (test vs live).</div>
                </div>
                <input type="text" value={terminalLocationId} onChange={e => setTerminalLocationId(e.target.value.trim())} placeholder="tml_…"
                  style={{ width: 210, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Removal service price</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Charged when a customer says "yes" to the removal question on a service that allows it.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>$</span>
                  <input type="number" value={removalPrice} step="1" min={0} max={200}
                    onChange={e => setRemovalPrice(Number(e.target.value))}
                    style={{ width: 90, textAlign: 'right', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
                </div>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--pn-border)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Disable tips on credit card</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Hide the tip selector during checkout when payment method is card. Cash, Venmo, and other methods still prompt for a tip.</div>
                </div>
                <button onClick={() => setNoCardTips(v => !v)} style={{
                  width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', padding: 0,
                  background: noCardTips ? '#2D7A5F' : '#d1d5db', position: 'relative', transition: 'background .2s', flexShrink: 0,
                }}>
                  <div style={{
                    position: 'absolute', top: 3, left: noCardTips ? 22 : 2, width: 18, height: 18,
                    borderRadius: '50%', background: '#fff', transition: 'left .2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                  }} />
                </button>
              </div>
              <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--pn-border)', paddingTop: 12 }}>
                <Btn color="#2D7A5F" onClick={async () => {
                  setFinSaving(true);
                  await updateSettings({ ...settings, taxRate, ccFeePct, ccFeeFlat, removalPrice, noCardTips, terminalLocationId: terminalLocationId.trim() || null });
                  // Mirror removalPrice onto bookingConfig so the public-facing
                  // booking page can read it without admin permissions.
                  if (bookingCfg) {
                    const next = { ...bookingCfg, removalPrice };
                    setBookingCfg(next);
                    try { await saveBookingConfig(next); } catch (e) { console.warn('[bookingCfg removalPrice mirror]', e); }
                  }
                  setFinSaving(false);
                }}>{finSaving ? 'Saving…' : 'Save Financial Settings'}</Btn>
              </div>
            </Section>
            <BookingSection bookingCfg={bookingCfg} setBookingCfg={setBookingCfg} />
            <AppearanceSection
              themeId={themeId}    setThemeId={setThemeId}
              autoTheme={autoTheme} setAutoTheme={setAutoTheme}
              saving={themeSaving}
              onSave={async () => {
                setThemeSaving(true);
                await updateSettings({ ...settings, themeId, autoTheme });
                setThemeSaving(false);
              }}
            />
            <TechRemindersSection settings={settings} updateSettings={updateSettings} />
            <CancellationPolicySection settings={settings} updateSettings={updateSettings} />
            <PauseSection settings={settings} updateSettings={updateSettings} />
            <TileVisibilitySection settings={settings} updateSettings={updateSettings} />
            <ModulesSection />
            <NotesPreferenceSection settings={settings} updateSettings={updateSettings} />
            <div data-anchor="payments"><StripeConnectSection onOpenWizard={onOpenWizard} /></div>
            <UpgradeSection settings={settings} gUser={gUser} />
            <DisputesSection />
            <BackupRestoreSection />
            <Section title="📦 Data Imports">
              <div style={{ padding: '12px 14px' }}>
                <CsvImportSection />
              </div>
            </Section>
            {/* Super-admin-only demo seeder. Hidden from regular salon
                owners — these create / wipe sample records and aren't
                appropriate for production-tenant admin panels. */}
            {isSuperAdmin && <DemoSeedSection />}
          </>
        )}

        <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
          <button onClick={() => { signOut(); onClose(); }} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 20px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            ▶ Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

function BookingSection({ bookingCfg, setBookingCfg }) {
  const [saving,     setSaving]     = useState(false);
  const [copied,     setCopied]     = useState(false);
  const [geoLocating,setGeoLocating]= useState(false);
  const bookingUrl = `${window.location.origin}/book`;

  if (!bookingCfg) return null;

  async function save(patch) {
    const next = { ...bookingCfg, ...patch };
    setBookingCfg(next);
    setSaving(true);
    try {
      await saveBookingConfig(next);
      const parts = [];
      if ('enabled' in patch)    parts.push(`booking ${patch.enabled ? 'enabled' : 'disabled'}`);
      if ('geoEnabled' in patch) parts.push(`geo ${patch.geoEnabled ? 'enabled' : 'disabled'}`);
      if (patch.salonLat || patch.salonLng) parts.push('coordinates updated');
      if ('checkinRadius' in patch) parts.push(`radius ${patch.checkinRadius}m`);
      if ('note' in patch) parts.push('note updated');
      if (parts.length) logActivity('booking_config_saved', parts.join(', '));
    }
    catch { /* non-fatal */ }
    finally { setSaving(false); }
  }

  function copyUrl() {
    navigator.clipboard?.writeText(bookingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function detectLocation() {
    if (!navigator.geolocation) return;
    setGeoLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        save({ salonLat: pos.coords.latitude, salonLng: pos.coords.longitude });
        setGeoLocating(false);
      },
      () => setGeoLocating(false),
      { timeout: 10000 }
    );
  }

  const hasCoords = bookingCfg.salonLat && bookingCfg.salonLng;

  return (
    <>
    <Section title="🌐 Online Booking">
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Enable online booking</div>
          <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Clients can book appointments from the public booking page</div>
        </div>
        <Toggle active={bookingCfg.enabled} onChange={() => save({ enabled: !bookingCfg.enabled })} disabled={saving} />
      </div>
      {bookingCfg.enabled && (
        <>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--pn-border)' }}>
            <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginBottom: 6, fontWeight: 600 }}>BOOKING PAGE URL</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--pn-text-muted)', background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 8, padding: '7px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bookingUrl}
              </div>
              <button onClick={copyUrl} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: copied ? '#2D7A5F' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--pn-border)' }}>
            <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginBottom: 6, fontWeight: 600 }}>CUSTOM NOTE (shown to clients)</div>
            <input
              value={bookingCfg.note || ''}
              onChange={e => setBookingCfg(c => ({ ...c, note: e.target.value }))}
              onBlur={() => save({ note: bookingCfg.note || '' })}
              placeholder="e.g. Walk-ins also welcome! Call us for same-day slots."
              style={{ width: '100%', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 12px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <AutoAssignSection
            method={bookingCfg.assignmentMethod || DEFAULT_ASSIGNMENT_METHOD}
            onChange={m => save({ assignmentMethod: m })}
            saving={saving}
          />
        </>
      )}

      {/* Geo-location check-in — independent of online booking toggle */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Geo-location check-in</div>
          <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>Show clients how close they are to the salon when they check in</div>
        </div>
        <Toggle active={!!bookingCfg.geoEnabled} onChange={() => save({ geoEnabled: !bookingCfg.geoEnabled })} disabled={saving} />
      </div>
      {bookingCfg.geoEnabled && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--pn-border)' }}>
          <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginBottom: 10, fontWeight: 600 }}>SALON COORDINATES</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="number" step="any"
              value={bookingCfg.salonLat || ''}
              onChange={e => setBookingCfg(c => ({ ...c, salonLat: parseFloat(e.target.value) || null }))}
              onBlur={() => save({})}
              placeholder="Latitude"
              style={{ flex: 1, minWidth: 110, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none' }}
            />
            <input
              type="number" step="any"
              value={bookingCfg.salonLng || ''}
              onChange={e => setBookingCfg(c => ({ ...c, salonLng: parseFloat(e.target.value) || null }))}
              onBlur={() => save({})}
              placeholder="Longitude"
              style={{ flex: 1, minWidth: 110, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none' }}
            />
            <button onClick={detectLocation} disabled={geoLocating || !navigator.geolocation}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #3D95CE', background: 'var(--pn-info-bg)', color: 'var(--pn-info)', fontSize: 12, fontWeight: 600, cursor: geoLocating ? 'default' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
              {geoLocating ? '…' : '📍 Use my location'}
            </button>
          </div>
          {hasCoords && (
            <div style={{ fontSize: 11, color: '#16a34a', marginBottom: 8 }}>
              ✓ Coordinates set ({bookingCfg.salonLat?.toFixed(5)}, {bookingCfg.salonLng?.toFixed(5)})
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--pn-text-muted)', flexShrink: 0 }}>Check-in radius</span>
            <input
              type="number" min={50} max={2000} step={50}
              value={bookingCfg.checkinRadius || 200}
              onChange={e => setBookingCfg(c => ({ ...c, checkinRadius: Number(e.target.value) }))}
              onBlur={() => save({})}
              style={{ width: 80, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '5px 8px', fontSize: 12, outline: 'none', textAlign: 'center' }}
            />
            <span style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>meters</span>
          </div>
        </div>
      )}
    </Section>
    <BookingFlowSection bookingCfg={bookingCfg} setBookingCfg={setBookingCfg} save={save} saving={saving} />
    </>
  );
}

function Toggle({ active, onChange, disabled }) {
  return (
    <button onClick={onChange} disabled={disabled}
      style={{ width: 44, height: 26, borderRadius: 13, border: 'none', background: active ? '#2D7A5F' : '#d0d0d0', cursor: disabled ? 'default' : 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 3, left: active ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
    </button>
  );
}

function AutoAssignSection({ method, onChange, saving }) {
  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--pn-border)' }}>
      <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginBottom: 8, fontWeight: 600 }}>"NO PREFERENCE" AUTO-ASSIGNMENT</div>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
        When a customer picks "no preference" while booking, how should we choose which tech gets the appointment? Clients who ask for a specific tech are always honored — those bookings show a ⭐ on the schedule.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ASSIGNMENT_METHODS.map(m => {
          const selected = method === m;
          return (
            <label key={m} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: saving ? 'default' : 'pointer', border: `1.5px solid ${selected ? '#2D7A5F' : 'var(--pn-border)'}`, background: selected ? '#f0faf6' : 'var(--pn-surface)', transition: 'border-color .15s, background .15s' }}>
              <input type="radio" name="assignmentMethod" value={m}
                checked={selected}
                disabled={saving}
                onChange={() => onChange(m)}
                style={{ marginTop: 2, accentColor: '#2D7A5F', cursor: saving ? 'default' : 'pointer' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text)' }}>{ASSIGNMENT_METHOD_LABELS[m]}</div>
                <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.45 }}>{ASSIGNMENT_METHOD_DESCRIPTIONS[m]}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Booking Flow config (Tier 0 templates + Tier 1 toggles) ──────────
// Reads/writes bookingConfig.flow. Empty doc = use template defaults +
// system defaults. Template picker stamps preset values; individual
// toggles override the template per-field.
function BookingFlowSection({ bookingCfg, setBookingCfg, save, saving }) {
  const flow = bookingCfg.flow || {};
  const eff  = getEffectiveFlow(flow);

  function patchFlow(patch) {
    const nextFlow = { ...flow, ...patch };
    setBookingCfg(c => ({ ...c, flow: nextFlow }));
    save({ flow: nextFlow });
  }
  function applyTemplate(id) {
    if (!FLOW_TEMPLATES[id]) return;
    if (id === 'custom') {
      // Custom = wipe template, keep current explicit overrides as-is.
      patchFlow({ templateId: 'custom' });
      return;
    }
    // Setting a template wipes individual overrides so the template's
    // values are used directly. Tenant can re-override after.
    const nextFlow = { templateId: id };
    setBookingCfg(c => ({ ...c, flow: nextFlow }));
    save({ flow: nextFlow });
  }

  const activeTplId = flow.templateId || 'custom';

  return (
    <Section title="🧭 Booking Flow">
      <div style={{ padding: '12px 16px 6px', fontSize: 11, color: 'var(--pn-text-muted)', lineHeight: 1.5 }}>
        Pick a starting template, then fine-tune. Changes apply to the next page load on the public booking page.
      </div>

      {/* Template picker */}
      <div style={{ padding: '8px 16px 12px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
          Industry template
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          {Object.entries(FLOW_TEMPLATES).map(([id, t]) => {
            const active = activeTplId === id;
            return (
              <button key={id} onClick={() => applyTemplate(id)} disabled={saving}
                style={{
                  textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                  padding: '10px 12px', borderRadius: 10,
                  border: `2px solid ${active ? '#3D95CE' : 'var(--pn-border)'}`,
                  background: active ? '#EBF4FB' : 'var(--pn-surface)',
                  boxShadow: active ? '0 0 0 2px rgba(61,149,206,.15)' : 'none',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 18 }}>{t.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)' }}>{t.name}</span>
                  {active && <span style={{ fontSize: 10, fontWeight: 700, color: '#1a5f8a', background: '#d4e9f8', padding: '2px 6px', borderRadius: 3, letterSpacing: '.04em' }}>ACTIVE</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', lineHeight: 1.4 }}>{t.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step shape toggles */}
      <FlowSubGroup title="Step shape">
        <FlowRow label="Show 'How would you like to book?' chooser"
          desc="Step 0 — let customer pick between time-first and tech-first. Off → go straight to the chosen default."
          value={eff.showFlowChooser}
          control={<Toggle active={eff.showFlowChooser} onChange={() => patchFlow({ showFlowChooser: !eff.showFlowChooser })} disabled={saving} />} />
        <FlowRow label="Default flow"
          desc="Which path opens when the chooser is hidden, or pre-selects if it's shown."
          control={
            <select value={eff.defaultFlow} onChange={e => patchFlow({ defaultFlow: e.target.value })}
              style={{ fontFamily: 'inherit', fontSize: 13, padding: '6px 10px', border: '1px solid var(--pn-border-strong)', borderRadius: 6, background: 'var(--pn-surface)', cursor: 'pointer' }}>
              <option value="time">Time-first (pick services, then stylist)</option>
              <option value="tech">Tech-first (pick stylist, then services)</option>
            </select>
          } />
        <FlowRow label="Show notes field on the customer info step"
          desc="A textarea where the client can leave context for the stylist."
          control={<Toggle active={eff.showNotesField} onChange={() => patchFlow({ showNotesField: !eff.showNotesField })} disabled={saving} />} />
      </FlowSubGroup>

      {/* Identity */}
      <FlowSubGroup title="Identity & checkout">
        <FlowRow label="Require sign-in to book"
          desc="Customer must be signed in (Google, phone, or magic link) before they can submit. Off → can submit as guest."
          control={<Toggle active={eff.requireSignIn} onChange={() => patchFlow({ requireSignIn: !eff.requireSignIn })} disabled={saving} />} />
        <FlowRow label="Allow guest checkout"
          desc="If sign-in isn't required, this controls whether the customer can leave the auth step blank."
          control={<Toggle active={eff.allowGuestCheckout} onChange={() => patchFlow({ allowGuestCheckout: !eff.allowGuestCheckout })} disabled={saving || eff.requireSignIn} />} />
      </FlowSubGroup>

      {/* Multi-lane */}
      <FlowSubGroup title="Multi-lane (mani + pedi)">
        <FlowRow label="Schedule shape when cart has both"
          desc="Back-to-back = one tech does mani then a second does pedi after. Simultaneous = both techs work at once."
          control={
            <select value={eff.multiLaneShape} onChange={e => patchFlow({ multiLaneShape: e.target.value })}
              style={{ fontFamily: 'inherit', fontSize: 13, padding: '6px 10px', border: '1px solid var(--pn-border-strong)', borderRadius: 6, background: 'var(--pn-surface)', cursor: 'pointer' }}>
              <option value="back-to-back">Back-to-back</option>
              <option value="simultaneous">Simultaneous</option>
              <option value="ask">Ask the customer</option>
            </select>
          } />
        <FlowRow label="Removal prompt cadence"
          desc="When to ask 'are you wearing a previous gel/dip set?'. Always = every qualifying service. First-only = once per booking."
          control={
            <select value={eff.removalPromptMode} onChange={e => patchFlow({ removalPromptMode: e.target.value })}
              style={{ fontFamily: 'inherit', fontSize: 13, padding: '6px 10px', border: '1px solid var(--pn-border-strong)', borderRadius: 6, background: 'var(--pn-surface)', cursor: 'pointer' }}>
              <option value="always">Always</option>
              <option value="first-only">First-only</option>
              <option value="never">Never</option>
            </select>
          } />
      </FlowSubGroup>

      {/* Time window */}
      <FlowSubGroup title="Time window">
        <FlowRow label="Minimum lead time (minutes)"
          desc="Block slots earlier than this from 'now'. 0 = bookable now."
          control={
            <input type="number" min={0} max={1440} value={eff.minLeadTimeMinutes}
              onChange={e => patchFlow({ minLeadTimeMinutes: Math.max(0, Number(e.target.value) || 0) })}
              style={{ width: 90, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '6px 10px', fontSize: 13 }} />
          } />
        <FlowRow label="Booking window (days ahead)"
          desc="Furthest day visible in the calendar. Typical: 14-60."
          control={
            <input type="number" min={1} max={365} value={eff.maxLeadDays}
              onChange={e => patchFlow({ maxLeadDays: Math.max(1, Number(e.target.value) || 30) })}
              style={{ width: 90, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '6px 10px', fontSize: 13 }} />
          } />
      </FlowSubGroup>

      {/* Copy */}
      <FlowSubGroup title="Confirm button">
        <FlowRow label="Confirm CTA label"
          desc="The text on the final 'Confirm booking' button. Branded options: 'Book my chair', 'Reserve treatment'."
          control={
            <input type="text" maxLength={40} value={eff.confirmCtaLabel}
              onChange={e => patchFlow({ confirmCtaLabel: e.target.value })}
              placeholder={FLOW_DEFAULTS.confirmCtaLabel}
              style={{ width: 220, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '6px 10px', fontSize: 13 }} />
          } />
      </FlowSubGroup>
    </Section>
  );
}

function FlowSubGroup({ title, children }) {
  return (
    <div style={{ borderTop: '1px solid var(--pn-border)' }}>
      <div style={{ padding: '10px 16px 6px', fontSize: 10, fontWeight: 700, color: 'var(--pn-text-faint)', letterSpacing: '.1em', textTransform: 'uppercase' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function FlowRow({ label, desc, control }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 16px', borderTop: '1px solid var(--pn-border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2, lineHeight: 1.45 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

function ThemeCard({ th, isSelected, badge, onClick }) {
  return (
    <button onClick={onClick} style={{
      border: `2px solid ${isSelected ? 'var(--tm-accent, #3D95CE)' : 'var(--pn-border)'}`,
      borderRadius: 12, padding: 0, cursor: 'pointer', background: 'var(--pn-surface)',
      overflow: 'hidden',
      boxShadow: isSelected ? '0 0 0 3px rgba(61,149,206,.18)' : 'none',
      transition: 'border-color .15s, box-shadow .15s',
      position: 'relative', fontFamily: 'inherit', textAlign: 'left',
    }}>
      <div style={{ height: 38, background: `linear-gradient(135deg, ${th.gradStart} 0%, ${th.gradEnd} 100%)`, position: 'relative' }}>
        <span style={{ position: 'absolute', bottom: 4, right: 6, fontSize: 15 }}>{th.icon}</span>
        {badge && (
          <span style={{ position: 'absolute', top: 3, left: 4, fontSize: 8, background: 'rgba(255,255,255,.92)', borderRadius: 4, padding: '1px 4px', fontWeight: 700, color: 'var(--pn-text)', letterSpacing: '.02em' }}>{badge}</span>
        )}
      </div>
      <div style={{ padding: '5px 6px 6px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pn-text)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{th.name}</div>
      </div>
      {isSelected && (
        <div style={{ position: 'absolute', top: 4, left: 4, width: 16, height: 16, borderRadius: '50%', background: 'rgba(255,255,255,.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>✓</div>
      )}
    </button>
  );
}

function AppearanceSection({ themeId, setThemeId, autoTheme, setAutoTheme, saving, onSave }) {
  const autoDetected = detectAutoTheme();

  const grid = (themes) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
      {themes.map(th => (
        <ThemeCard
          key={th.id}
          th={th}
          isSelected={themeId === th.id}
          badge={autoTheme && autoDetected?.id === th.id ? 'NOW' : null}
          onClick={() => setThemeId(th.id)}
        />
      ))}
    </div>
  );

  return (
    <Section title="🎨 Appearance">
      {/* Auto-seasonal toggle */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Auto-seasonal themes</div>
          <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>
            {autoTheme && autoDetected
              ? `Active now: ${autoDetected.icon} ${autoDetected.name}`
              : 'Switches to holiday themes automatically based on the date'}
          </div>
        </div>
        <button onClick={() => setAutoTheme(v => !v)} style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', padding: 0,
          background: autoTheme ? 'var(--tm-primary, #2D7A5F)' : '#d1d5db',
          position: 'relative', transition: 'background .2s', flexShrink: 0,
        }}>
          <div style={{
            position: 'absolute', top: 3, left: autoTheme ? 22 : 2, width: 18, height: 18,
            borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
          }} />
        </button>
      </div>

      {/* Core palettes */}
      <div style={{ padding: '0 12px 14px', borderTop: '1px solid var(--pn-border)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pn-text-faint)', letterSpacing: '.07em', textTransform: 'uppercase', padding: '10px 4px 8px' }}>
          {autoTheme ? 'Default palette (when no holiday is active)' : 'Core palettes'}
        </div>
        {grid(CORE_THEMES)}
      </div>

      {/* Holiday / seasonal */}
      <div style={{ padding: '0 12px 14px', borderTop: '1px solid var(--pn-border)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pn-text-faint)', letterSpacing: '.07em', textTransform: 'uppercase', padding: '10px 4px 8px' }}>
          Holidays &amp; seasons{autoTheme ? ' — auto-activate by date' : ' — select to pin'}
        </div>
        {grid(HOLIDAY_THEMES)}
      </div>

      <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--pn-border)', paddingTop: 12 }}>
        <Btn color="var(--tm-accent, #3D95CE)" onClick={onSave}>{saving ? 'Saving…' : 'Save Appearance'}</Btn>
      </div>
    </Section>
  );
}

function AddMissingTechUsersBtn({ employees, users, addTechUsersForEmployees, showToast }) {
  const [working, setWorking] = useState(false);
  const userEmails    = new Set(users.map(u => (u.email    || '').toLowerCase()).filter(Boolean));
  const userTechNames = new Set(users.map(u => (u.techName || '').toLowerCase()).filter(Boolean));
  // A tech is "missing" if no user exists matching their email OR their techName.
  const candidates = employees.filter(e => {
    const em = (e.email || '').trim().toLowerCase();
    const nm = (e.name  || '').trim().toLowerCase();
    if (em && userEmails.has(em))    return false;
    if (nm && userTechNames.has(nm)) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  const withEmail    = candidates.filter(e => e.email && e.email.trim());
  const withoutEmail = candidates.filter(e => !e.email || !e.email.trim());

  async function run() {
    const lines = [];
    if (withEmail.length)   lines.push(`With email (${withEmail.length}):\n${withEmail.map(e => `• ${e.name} <${e.email}>`).join('\n')}`);
    if (withoutEmail.length) lines.push(`Need email later (${withoutEmail.length}):\n${withoutEmail.map(e => `• ${e.name}`).join('\n')}\n\nThese will get a placeholder email like name@pending.meraki.local — edit each user's email in this list once you have it.`);
    if (!confirm(`Add ${candidates.length} tech user${candidates.length === 1 ? '' : 's'}?\n\n${lines.join('\n\n')}`)) return;
    setWorking(true);
    try {
      const res = await addTechUsersForEmployees(candidates);
      const tail = res.placeholders ? ` (${res.placeholders} need real emails)` : '';
      showToast(`Added ${res.added} tech user${res.added === 1 ? '' : 's'}${tail}`);
    } catch (e) {
      showToast('Failed: ' + (e.message || 'unknown'), 4000);
    } finally {
      setWorking(false);
    }
  }

  return (
    <button onClick={run} disabled={working}
      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none', background: '#f59e0b', color: '#fff', cursor: working ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600, opacity: working ? 0.6 : 1 }}>
      {working ? 'Adding…' : `+ Add ${candidates.length} missing tech${candidates.length === 1 ? '' : 's'}`}
    </button>
  );
}

function Section({ title, children, action, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', marginBottom: 14, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: '12px 16px', borderBottom: open ? '1px solid var(--pn-border)' : 'none', fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', background: 'var(--pn-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s', fontSize: 10, color: 'var(--pn-text-faint)' }}>▶</span>
          {title}
        </span>
        {action && (
          // Stop bubbling so action-bar buttons don't toggle the section.
          <span onClick={e => e.stopPropagation()}>{action}</span>
        )}
      </div>
      {open && children}
    </div>
  );
}

function UserRow({ user, children }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--pn-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: 'var(--pn-text-muted)', overflow: 'hidden', flexShrink: 0 }}>
        {user.picture ? <img src={user.picture} alt="" style={{ width: 36, height: 36, objectFit: 'cover' }} /> : (user.name?.[0] || user.email?.[0])}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>
          {user.name || user.email}
          {' '}<RoleBadge role={user.role} />
          {user.emailPending && (
            <span title="Placeholder email — edit this user once you have their real address" style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: 'var(--pn-warning)', background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: 8, letterSpacing: '.04em' }}>
              EMAIL NEEDED
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>{user.email}</div>
        <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 2 }}>{user.grantedAt ? 'Granted: ' + formatTime(user.grantedAt) : 'Requested: ' + formatTime(user.requestedAt)}</div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>{children}</div>
    </div>
  );
}

const LOG_COLORS = { user_login: '#22c55e', user_logout: '#888', access_requested: '#f59e0b', access_changed: '#3D95CE', slide_added: '#22c55e', slide_edited: '#3D95CE', slide_deleted: '#ef4444', default_set: '#f59e0b', settings_saved: '#888', login_blocked: '#ef4444', sensitive_tile_accessed: '#8B5CF6', error: '#ef4444' };

function LogRow({ log }) {
  const [expanded, setExpanded] = useState(false);
  const isErr = log._error === true;
  const color = isErr ? '#ef4444' : (LOG_COLORS[log.action] || '#888');
  const hasDetail = isErr && (log._stack || log._ua || log._context);
  return (
    <div style={{ borderBottom: '1px solid var(--pn-border)', background: isErr ? '#fff8f8' : 'transparent' }}>
      <div style={{ padding: '10px 16px', cursor: hasDetail ? 'pointer' : 'default' }}
           onClick={() => hasDetail && setExpanded(x => !x)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {isErr ? '⚠ ' : ''}{log.action?.replace(/_/g, ' ')}
          </span>
          {hasDetail && <span style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>{expanded ? '▲' : '▼'}</span>}
          {log._version && <span style={{ fontSize: 9, color: 'var(--pn-text-faint)', background: 'var(--pn-surface-alt)', borderRadius: 6, padding: '1px 5px' }}>v{log._version}</span>}
        <span style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginLeft: 'auto' }}>{formatTime(log.timestamp)}</span>
        </div>
        <div style={{ fontSize: 12, color: isErr ? '#c00' : '#555' }}>
          {log.email || 'anonymous'}{log.details ? <span style={{ color: isErr ? '#c00' : '#888' }}> — {log.details}</span> : ''}
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 10px', fontSize: 11, color: '#c00', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#fff0f0', borderTop: '1px solid #fecaca' }}>
          {log._message && <div><strong>Error:</strong> {log._message}</div>}
          {log._context && <div><strong>Context:</strong> {log._context}</div>}
          {log.fileType  && <div><strong>File type:</strong> {log.fileType}</div>}
          {log.fileSize  && <div><strong>File size:</strong> {(log.fileSize / 1024).toFixed(0)} KB</div>}
          {log._ua       && <div style={{ marginTop: 4, color: 'var(--pn-text-faint)' }}><strong>UA:</strong> {log._ua}</div>}
          {log._stack    && <div style={{ marginTop: 4, color: 'var(--pn-text-faint)' }}><strong>Stack:</strong>{'\n'}{log._stack}</div>}
        </div>
      )}
    </div>
  );
}

function PendingRow({ req, employees, onGrant }) {
  const [role,      setRole]      = useState('readonly');
  const [techName,  setTechName]  = useState('');
  const [newName,   setNewName]   = useState(req.displayName || '');
  const [saving,    setSaving]    = useState(false);
  const sel = { fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', fontFamily: 'inherit' };

  const isNew = techName === '__new__';
  const resolvedName = isNew ? newName.trim() : techName;

  async function submit() {
    setSaving(true);
    try {
      if (role === 'tech') {
        if (isNew && newName.trim()) {
          await createEmployee({ name: newName.trim(), email: req.email, active: true, sortOrder: 999 });
        } else if (techName) {
          const emp = employees.find(e => e.name === techName);
          if (emp) await saveEmployee(emp.id, { email: req.email });
        }
      }
      await onGrant(role, role === 'tech' ? resolvedName : undefined);
    } finally { setSaving(false); }
  }

  const grantDisabled = saving || (role === 'tech' && (!techName || (isNew && !newName.trim())));

  return (
    <UserRow user={req}>
      <select value={role} onChange={e => setRole(e.target.value)} style={sel}>
        <option value="readonly">View only</option>
        <option value="tech">Tech</option>
        <option value="scheduler">Front desk</option>
        <option value="admin">Admin</option>
      </select>
      {role === 'tech' && (
        <>
          <select value={techName} onChange={e => setTechName(e.target.value)} style={sel}>
            <option value="">Assign tech…</option>
            {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
            <option value="__new__">＋ Create new employee</option>
          </select>
          {isNew && (
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Employee name"
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #3D95CE', background: '#f0f7ff', fontFamily: 'inherit', width: 130, outline: 'none' }}
            />
          )}
        </>
      )}
      <Btn color="#3D95CE" onClick={submit} disabled={grantDisabled}>
        {saving ? '…' : 'Grant'}
      </Btn>
      <Btn color="#ef4444" onClick={() => onGrant('denied')} disabled={saving}>Deny</Btn>
    </UserRow>
  );
}

// ── Onboarding tab ─────────────────────────────────────
// Re-entry point into the wizard. Shows current per-phase status
// (audit grid) and a button that closes Admin + reopens the wizard.
// Useful after `completedAt` is stamped — the auto-open + banner are
// hidden but the owner may want to revisit a phase.
function OnboardingTab({ onOpenWizard }) {
  const [onboarding, setOnboarding] = useState(undefined);
  useEffect(() => {
    let mounted = true;
    const unsub = subscribeOnboarding(o => { if (mounted) setOnboarding(o); });
    return () => { mounted = false; unsub?.(); };
  }, []);
  const completed = completedCount(onboarding);
  const done      = isOnboardingComplete(onboarding);

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--pn-text)', margin: 0 }}>🎯 Onboarding</h2>
        <span style={{ fontSize: 12, color: done ? '#10b981' : '#92400e', fontWeight: 700 }}>
          {done ? '✓ Complete' : `${completed}/${ONBOARDING_PHASES.length} complete`}
        </span>
      </div>

      <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        {done
          ? 'Your salon is launched. You can still revisit any phase below to tweak settings — re-opening the wizard never resets data.'
          : 'You haven\'t finished the onboarding wizard. Continue where you left off, or jump to a specific phase.'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 18 }}>
        {ONBOARDING_PHASES.map((p, i) => {
          const s = phaseStatus(onboarding, p.key);
          const icon  = s === 'done' ? '✓' : s === 'skipped' ? '○' : '⚠';
          const color = s === 'done' ? 'var(--pn-success)' : s === 'skipped' ? '#9ca3af' : 'var(--pn-warning)';
          const bg    = s === 'done' ? 'var(--pn-success-bg)' : s === 'skipped' ? 'var(--pn-bg)' : 'var(--pn-warning-bg)';
          const label = s === 'done' ? 'Complete' : s === 'skipped' ? 'Skipped' : 'Pending';
          return (
            <button
              key={p.key}
              onClick={() => onOpenWizard?.(p.key)}
              type="button"
              title={`Open ${p.label}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 12px', borderRadius: 8,
                border: `1px solid ${color}33`, background: bg,
                cursor: 'pointer', textAlign: 'left', font: 'inherit', width: '100%',
                transition: 'background 80ms, border-color 80ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = `${color}88`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = `${color}33`; }}>
              <span style={{ width: 24, fontSize: 11, color: 'var(--pn-text-muted)', textAlign: 'right' }}>{i + 1}.</span>
              <span style={{ width: 20, textAlign: 'center', fontSize: 14, color, fontWeight: 700 }}>{icon}</span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--pn-text)' }}>{p.label}</span>
              <span style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>›</span>
            </button>
          );
        })}
      </div>

      <Btn color="#6a4fa0" onClick={() => onOpenWizard?.()}>
        {done ? '🎯 Re-open wizard' : '🎯 Continue setup'}
      </Btn>
    </div>
  );
}

// ── Feedback tab ───────────────────────────────────────
function FeedbackTab({ items, onStatus, onRefresh }) {
  const [statusFilter, setStatusFilter] = useState('open');
  const [typeFilter,   setTypeFilter]   = useState('all');
  const [sortBy,       setSortBy]       = useState('newest');
  const [copied,       setCopied]       = useState(false);

  if (!items) return <Empty>Loading…</Empty>;

  const counts = {
    open:           items.filter(f => f.status === 'open').length,
    resolved:       items.filter(f => f.status === 'resolved').length,
    not_considered: items.filter(f => f.status === 'not_considered').length,
    bugs:           items.filter(f => f.type === 'bug').length,
    ideas:          items.filter(f => f.type === 'idea').length,
  };

  const visible = items
    .filter(f => {
      const statusOk = statusFilter === 'all' || f.status === statusFilter;
      const typeOk   = typeFilter   === 'all' || f.type   === typeFilter;
      return statusOk && typeOk;
    })
    .sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
      if (sortBy === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortBy === 'type')   return (a.type || '').localeCompare(b.type || '');
      if (sortBy === 'status') return (a.status || '').localeCompare(b.status || '');
      return 0;
    });

  function copyAll() {
    const src = visible.length ? visible : items;
    const lines = src.map((f, i) => {
      const date = new Date(f.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `${i + 1}. [${(f.type || '?').toUpperCase()}] [${f.status || 'open'}] ${date}\n   ${f.text}`;
    });
    const text = `Meraki Feedback — ${src.length} items\n${'='.repeat(40)}\n\n` + lines.join('\n\n');
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  const STATUS_FILTERS = [
    { id: 'all',            label: `All (${items.length})` },
    { id: 'open',           label: `Open (${counts.open})` },
    { id: 'resolved',       label: `Resolved (${counts.resolved})` },
    { id: 'not_considered', label: `Ignored (${counts.not_considered})` },
  ];
  const TYPE_FILTERS = [
    { id: 'all',  label: 'All types' },
    { id: 'bug',  label: `🐛 Bugs (${counts.bugs})` },
    { id: 'idea', label: `💡 Ideas (${counts.ideas})` },
  ];

  const pillStyle = (active) => ({
    fontSize: 11, padding: '4px 11px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${active ? '#3D95CE' : 'var(--pn-border)'}`,
    background: active ? '#EBF4FB' : 'var(--pn-surface)',
    color: active ? '#1a5f8a' : 'var(--pn-text-muted)',
    fontWeight: active ? 600 : 400,
  });

  return (
    <div>
      {/* Toolbar */}
      <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
        {/* Status filter */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--pn-border)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 4 }}>Status</span>
          {STATUS_FILTERS.map(f => (
            <button key={f.id} onClick={() => setStatusFilter(f.id)} style={pillStyle(statusFilter === f.id)}>{f.label}</button>
          ))}
        </div>
        {/* Type filter + sort + actions */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 4 }}>Type</span>
          {TYPE_FILTERS.map(f => (
            <button key={f.id} onClick={() => setTypeFilter(f.id)} style={pillStyle(typeFilter === f.id)}>{f.label}</button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontFamily: 'inherit', cursor: 'pointer' }}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="type">By type</option>
              <option value="status">By status</option>
            </select>
            <Btn onClick={copyAll} color={copied ? '#10B981' : undefined}>{copied ? '✓ Copied!' : '📋 Copy'}</Btn>
            <Btn onClick={onRefresh}>Refresh</Btn>
          </div>
        </div>
      </div>

      {visible.length === 0
        ? <Empty>{items.length === 0 ? 'No feedback yet.' : 'No items match current filters.'}</Empty>
        : visible.map(f => <FeedbackCard key={f.id} item={f} onStatus={onStatus} />)
      }
    </div>
  );
}

function FeedbackCard({ item, onStatus }) {
  const isOpen = item.status === 'open';
  const date = new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const typeBg    = item.type === 'bug' ? 'var(--pn-danger-bg)' : 'var(--pn-warning-bg)';
  const typeFg    = item.type === 'bug' ? 'var(--pn-danger)'   : 'var(--pn-warning)';
  const statusColors = { open: '#3B82F6', resolved: '#10B981', not_considered: '#9ca3af' };
  const statusLabel  = { open: 'Open', resolved: 'Resolved', not_considered: 'Not considered' };

  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: typeBg, color: typeFg, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {item.type === 'bug' ? '🐛 Bug' : '💡 Idea'}
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: `${statusColors[item.status]}22`, color: statusColors[item.status], textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {statusLabel[item.status] || item.status}
        </span>
        <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginLeft: 'auto' }}>{date}</span>
      </div>

      <p style={{ fontSize: 13, color: 'var(--pn-text)', lineHeight: 1.55, margin: '0 0 8px' }}>{item.text}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', flex: 1 }}>
          {item.submittedBy?.name || item.submittedBy?.email || 'Anonymous'}
        </span>
        {item.status !== 'resolved' && (
          <Btn color="#10B981" onClick={() => onStatus(item.id, 'resolved')}>✓ Resolve</Btn>
        )}
        {item.status !== 'not_considered' && (
          <Btn color="#9ca3af" onClick={() => onStatus(item.id, 'not_considered')}>✕ Ignore</Btn>
        )}
        {item.status !== 'open' && (
          <Btn onClick={() => onStatus(item.id, 'open')}>↩ Reopen</Btn>
        )}
      </div>
    </div>
  );
}

function CountBadge({ label, count, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--pn-text-muted)' }}>
      <span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: '50%', background: `${color}22`, color, fontSize: 10, fontWeight: 700, lineHeight: '18px', textAlign: 'center' }}>{count}</span>
      {label}
    </div>
  );
}

function RoleBadge({ role }) {
  const colors = { admin: ['rgba(61,149,206,.15)', '#3D95CE'], readonly: ['rgba(34,197,94,.15)', '#16a34a'], tech: ['rgba(245,158,11,.15)', '#d97706'], scheduler: ['rgba(139,92,246,.15)', '#7c3aed'], pending: ['rgba(245,158,11,.15)', '#d97706'], denied: ['rgba(239,68,68,.15)', '#ef4444'] };
  const [bg, fg] = colors[role] || ['var(--pn-surface-alt)', 'var(--pn-text-muted)'];
  return <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 20, letterSpacing: '.04em', textTransform: 'uppercase', background: bg, color: fg }}>{role}</span>;
}

// Toggle row matching the visual rhythm of the other settings rows in the
// ⚙ App Settings / 🕐 Time Clock sections. `border` adds a top divider so it
// can sit between other rows without a wrapper.
function TcToggle({ value, onChange, label, hint, border = false }) {
  return (
    <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: border ? '1px solid var(--pn-border)' : 'none' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>{hint}</div>}
      </div>
      <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: 'pointer', flexShrink: 0 }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 999,
          background: value ? '#10B981' : '#d0d0d0',
          transition: 'background .15s',
        }} />
        <span style={{
          position: 'absolute', top: 2, left: value ? 22 : 2, width: 20, height: 20,
          borderRadius: '50%', background: '#fff', transition: 'left .15s',
          boxShadow: '0 2px 6px rgba(0,0,0,.2)',
        }} />
      </label>
    </div>
  );
}

function Btn({ onClick, color, children, disabled, savedLabel }) {
  const [phase, setPhase] = useState('idle');
  const busy  = !!savedLabel && phase !== 'idle';
  const label = phase === 'saving' ? 'Saving…' : phase === 'saved' ? savedLabel : children;
  const bg    = phase === 'saved' ? '#10B981' : (color || 'var(--pn-surface-alt)');
  const fg    = (phase === 'saved' || color) ? '#fff' : '#666';

  const handleClick = async (e) => {
    if (!savedLabel) return onClick?.(e);
    if (phase !== 'idle') return;
    setPhase('saving');
    try {
      await onClick?.(e);
      setPhase('saved');
      setTimeout(() => setPhase('idle'), 1800);
    } catch (err) {
      setPhase('idle');
      throw err;
    }
  };

  return (
    <button onClick={handleClick} disabled={disabled || busy}
      style={{
        fontSize: 11, padding: '4px 8px', borderRadius: 6, border: 'none',
        background: bg, color: fg,
        cursor: disabled || busy ? 'default' : 'pointer',
        fontFamily: 'inherit', fontWeight: 500,
        opacity: disabled ? 0.5 : 1,
        transition: 'background .25s ease',
      }}>
      {label}
    </button>
  );
}

function Empty({ children }) {
  return <div style={{ padding: 16, textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 13 }}>{children}</div>;
}

function BackupRestoreSection() {
  const { pauseLogoutTimer, resumeLogoutTimer } = useApp();
  const [busy,   setBusy]   = useState(false);
  const [status, setStatus] = useState('');

  // Complete bundle: CSV + JSON + photos + settings + README, zipped.
  // Per Plume Nexus principle #8 — data export is always free, on every plan,
  // forever. Self-serve, one-click, no support ticket needed.
  async function handleExport() {
    setBusy(true); setStatus('Preparing your data…');
    try {
      const result = await buildExportBundle({ onProgress: setStatus });
      setStatus(`Done. ${result.fileCount} files, ${result.photoCount} photos, ${(result.bytes / 1024 / 1024).toFixed(1)} MB.`);
      logActivity('export_downloaded', `${result.fileCount} files, ${result.photoCount} photos`);
    } catch (e) {
      console.error('[export] failed', e);
      setStatus('Export failed: ' + e.message + ' — please email hello@plumenexus.com and we\'ll send you the bundle directly.');
    } finally {
      setBusy(false);
    }
  }

  // Legacy JSON-only download — keeps the original behavior available for
  // power users who specifically want the single JSON file.
  async function handleJsonOnly() {
    setBusy(true); setStatus('Exporting JSON…');
    try {
      const data = await fetchAllForBackup();
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tenant: 'meraki', data }, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `meraki-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('JSON download started.');
      logActivity('backup_exported_json_only', new Date().toISOString().slice(0, 10));
    } catch (e) { setStatus('Export failed: ' + e.message); }
    finally { setBusy(false); }
  }

  async function handleRestore(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('Restore will overwrite all existing data. This cannot be undone. Continue?')) return;
    setBusy(true); setStatus('Reading file…');
    pauseLogoutTimer?.();  // restore can be 30s-2min for a big tenant; don't let 5-min idle timer kill it
    try {
      // Accept either:
      //   - .json  → parsed directly
      //   - .zip   → the export bundle; unzip and pull everything.json
      // Detect by extension first; fall back to magic-bytes check for files
      // dragged in without an extension.
      const lowerName = (file.name || '').toLowerCase();
      let parsed;
      if (lowerName.endsWith('.zip') || file.type === 'application/zip' || await isProbablyZip(file)) {
        setStatus('Unzipping bundle…');
        const zip = await JSZip.loadAsync(file);
        const jsonEntry = zip.file('everything.json');
        if (!jsonEntry) throw new Error('ZIP does not contain everything.json (expected from a Plume Nexus export)');
        const text = await jsonEntry.async('string');
        parsed = JSON.parse(text);
      } else {
        const text = await file.text();
        parsed = JSON.parse(text);
      }
      const data = parsed.data || parsed;
      setStatus('Writing to Firestore…');
      await restoreFromBackup(data, setStatus);
      setStatus('Restore complete. Reload the page to see changes.');
      logActivity('backup_restored', file.name);
    } catch (e) { setStatus('Restore failed: ' + e.message); }
    finally { setBusy(false); resumeLogoutTimer?.(); e.target.value = ''; }
  }

  // Magic-byte sniff for ZIP files (PK\x03\x04). Catches the case where
  // a user renames or strips the .zip extension. Cheap — 4-byte read.
  async function isProbablyZip(file) {
    try {
      const head = await file.slice(0, 4).arrayBuffer();
      const b = new Uint8Array(head);
      return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
    } catch { return false; }
  }

  return (
    <Section title="🗄 Your Data — Export &amp; Restore">
      <div style={{ padding: '12px 16px' }}>
        {/* Principle #8 callout */}
        <div style={{
          padding: '10px 14px', marginBottom: 14,
          background: 'rgba(45,122,95,.08)',
          border: '1px solid rgba(45,122,95,.22)',
          borderRadius: 10, fontSize: 12, color: '#1f4e3a', lineHeight: 1.55,
        }}>
          <strong>Data export is free, complete, and one click. Forever.</strong>{' '}
          On every plan, including Free Solo, including Founders' Members, including paused accounts, including the 90-day post-cancellation grace. If our service ever stops working for you, walking out the door with everything intact is not a feature we'll ever paywall.
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={handleExport} disabled={busy}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: busy ? '#cbb6e0' : '#6a4fa0', fontSize: 13, color: '#fff', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            ⬇ Download Everything (CSV + JSON + photos)
          </button>
          <button onClick={handleJsonOnly} disabled={busy}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', fontSize: 12, color: 'var(--pn-text-muted)', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            JSON only
          </button>
          <label style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #fca5a5', background: busy ? 'var(--pn-bg)' : 'var(--pn-danger-bg)', fontSize: 12, color: busy ? 'var(--pn-text-faint)' : 'var(--pn-danger)', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            ⬆ Restore from ZIP or JSON
            <input type="file" accept=".zip,.json,application/zip,application/json" style={{ display: 'none' }} onChange={handleRestore} disabled={busy} />
          </label>
        </div>

        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', lineHeight: 1.5 }}>
          The full export is a ZIP with: <code style={{ background: '#f5f3fa', padding: '0 4px', borderRadius: 3 }}>everything.json</code> (full snapshot for re-import),
          one CSV per data table (Excel/Sheets-friendly), every photo as a real image file, all settings, and a plain-English README.
        </div>

        {status && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--pn-text-muted)' }}>{status}</div>
        )}
      </div>
    </Section>
  );
}

function DemoSeedSection() {
  const { gUser, settings, updateSettings, pauseLogoutTimer, resumeLogoutTimer } = useApp();
  const [status,  setStatus]  = useState('');
  const [running, setRunning] = useState(false);
  const [phase,   setPhase]   = useState('idle');
  const [seedState, setSeedState] = useState(null);

  // Refresh checkpoint state on mount + after every seed/clear so the
  // resume banner shows the current truth.
  async function refreshSeedState() {
    setSeedState(await fetchSeedState());
  }
  useEffect(() => { refreshSeedState(); }, []);

  async function runSeed() {
    const cur = await fetchSeedState();
    const isResume = cur?.phase === 'running' || cur?.phase === 'failed';
    const completedCount = cur?.completedSteps?.length || 0;
    const totalSteps = 12;

    const prompt = isResume
      ? `Resume previous seed (paused at step ${completedCount + 1}/${totalSteps})? Already-completed steps will be skipped to avoid duplicates.`
      : 'Populate the demo tenant with: 25 retail products · 1,000 clients · ~2,500 appointments · receipts · 6 promos · 1 membership plan + 20 members · 5 time-off · 8 reviews · 5 bonuses · 20 walk-ins · 3 campaigns · admin-as-tech + missing techs from seed + contact/TIN/profile backfill. Takes 10–15 min. Continue?';
    if (!confirm(prompt)) return;

    setRunning(true); setPhase('idle'); setStatus(isResume ? 'Resuming previous seed…' : '');
    pauseLogoutTimer?.();  // 10-15 min job vs. 5-min default timeout — pause so we don't get logged out mid-flight
    try {
      const stats = await seedFullDemo(msg => setStatus(msg), { gUser, settings, updateSettings });
      const adminTechNote = stats.adminAsTech === 'created' ? ' · admin-as-tech created' : stats.adminAsTech === 'already_existed' ? ' · admin-as-tech existed' : '';
      setStatus(`Seeded: ${stats.clients} clients · ${stats.appointments} appts · ${stats.receipts} receipts · ${stats.products} products · ${stats.promos} promos · ${stats.memberships} members · ${stats.timeOff} time-off · ${stats.reviews} reviews · ${stats.bonuses} bonuses · ${stats.waitlist} walk-ins · ${stats.campaigns} campaigns${adminTechNote} · ${stats.employeesFilled || 0} techs filled (${stats.fieldsFilled || 0} fields).`);
      setPhase('seeded');
      logActivity('demo_seeded', `full seed: ${JSON.stringify(stats)}`);
    } catch (e) {
      setStatus('Error: ' + e.message + ' — re-click "Resume seed" to pick up from this step'); setPhase('error');
    } finally {
      setRunning(false);
      resumeLogoutTimer?.();
      await refreshSeedState();
    }
  }

  async function runAddFuture() {
    setRunning(true); setPhase('idle'); setStatus('');
    try {
      const result = await addFutureAppointments(msg => setStatus(msg));
      setStatus(`Added ${result.appointments} appointments for days 31–60.`);
      setPhase('seeded');
    } catch (e) {
      setStatus('Error: ' + e.message); setPhase('error');
    } finally { setRunning(false); }
  }

  async function runClear() {
    if (!confirm('Permanently delete ALL demo data: clients · appointments · receipts · gift cards · products · promos · memberships · time off · bonuses · waitlist · campaigns · cached Google reviews?')) return;
    setRunning(true); setPhase('idle'); setStatus('');
    pauseLogoutTimer?.();
    try {
      const r = await clearDemoData(msg => setStatus(msg));
      setStatus(`Removed: ${r.clients}c · ${r.appointments}a · ${r.receipts}r · ${r.giftCards}gc · ${r.products}prod · ${r.promos}promo · ${r.memberships}m · ${r.memPlans}plans · ${r.timeOff}to · ${r.bonuses}b · ${r.waitlist}wl · ${r.campaigns}camp · ${r.reviews}rev.`);
      setPhase('cleared');
      logActivity('demo_cleared', JSON.stringify(r));
    } catch (e) {
      setStatus('Error: ' + e.message); setPhase('error');
    } finally {
      setRunning(false);
      resumeLogoutTimer?.();
      await refreshSeedState();
    }
  }

  const busy = running && phase === 'idle';
  const interrupted = (seedState?.phase === 'running' || seedState?.phase === 'failed') && !running;
  const completedCount = seedState?.completedSteps?.length || 0;

  return (
    <Section title="🧪 Demo Data">
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 10 }}>
          One-click populate every module with realistic sample data: clients, appointments, receipts, products, promo codes, memberships, time off, Google reviews, HR bonuses, walk-in queue, and marketing campaigns. Use this to show the platform off without exposing real customer data.
        </div>
        {interrupted && (
          <div style={{ background: 'var(--pn-warning-bg)', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontSize: 12, color: 'var(--pn-warning)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              ⚠ Previous seed was interrupted at step {completedCount + 1}/11{seedState?.currentStep ? ` (${seedState.currentStep})` : ''}
            </div>
            <div>Started by {seedState?.startedBy || 'unknown'} at {seedState?.startedAt ? new Date(seedState.startedAt).toLocaleString() : '—'}. {seedState?.lastError ? `Error: ${seedState.lastError}` : ''}</div>
            <div style={{ marginTop: 4, color: 'var(--pn-warning)' }}>Resume below — already-completed steps will be skipped.</div>
          </div>
        )}
        {status && (
          <div style={{ fontSize: 12, color: phase === 'error' ? '#ef4444' : phase === 'cleared' || phase === 'seeded' ? '#16a34a' : '#888', marginBottom: 10, fontStyle: 'italic' }}>
            {status}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn color={interrupted ? '#f59e0b' : '#f59e0b'} onClick={runSeed} disabled={running}>
            {busy ? 'Running…' : interrupted ? `▶ Resume seed (${completedCount}/11 done)` : '↓ Seed Full Demo'}
          </Btn>
          <Btn color="#3D95CE" onClick={runAddFuture} disabled={running}>
            {busy ? 'Running…' : '+ Top-up Future Appts'}
          </Btn>
          <Btn color="#ef4444" onClick={runClear} disabled={running}>
            {busy ? 'Removing…' : interrupted ? '× Start Over (Clear)' : '× Remove All Demo'}
          </Btn>
        </div>
      </div>
    </Section>
  );
}

// ── Webfront tab ──────────────────────────────────────
const DAY_LABELS = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'],
  ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];

function WebfrontTab({ cfg, setCfg, employees }) {
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [reviews,      setReviews]      = useState(null);
  const [editIdx,      setEditIdx]      = useState(null);  // index being edited, -1 = new
  const [draft,        setDraft]        = useState(null);
  const [refreshing,   setRefreshing]   = useState(false);
  const [refreshMsg,   setRefreshMsg]   = useState(null);
  const [detecting,    setDetecting]    = useState(false);
  const [detectMsg,    setDetectMsg]    = useState(null);
  const [candidates,   setCandidates]   = useState(null);
  const [gbpAuth,      setGbpAuth]      = useState(null);
  const [gbpConnecting,setGbpConnecting]= useState(false);
  const [gbpSyncing,   setGbpSyncing]   = useState(false);
  const [gbpMsg,       setGbpMsg]       = useState(null);
  const [gReviews,     setGReviews]     = useState(null);

  useEffect(() => {
    const unsub = subscribeGoogleBusinessAuth(setGbpAuth);
    return unsub;
  }, []);

  useEffect(() => subscribeGoogleReviews(setGReviews), []);

  useEffect(() => {
    function onMessage(e) {
      if (e.data?.type === 'google-business-auth') {
        setGbpConnecting(false);
        setGbpMsg(e.data.ok ? '✓ Connected — reviews will sync automatically.' : '✗ Connection failed.');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  async function handleConnectGbp() {
    setGbpMsg(null);
    setGbpConnecting(true);
    try {
      const { authUrl } = await startGoogleBusinessAuth();
      const w = window.open(authUrl, 'gbp-auth', 'width=540,height=720');
      if (!w) { setGbpMsg('✗ Popup blocked. Allow popups and try again.'); setGbpConnecting(false); }
    } catch (e) {
      setGbpMsg('✗ ' + (e.message || 'Connect failed'));
      setGbpConnecting(false);
    }
  }
  async function handleSyncGbp() {
    setGbpMsg(null);
    setGbpSyncing(true);
    try {
      const result = await syncGoogleBusinessReviews();
      setGbpMsg(`✓ Synced ${result?.written ?? 0} reviews from Google.`);
    } catch (e) {
      setGbpMsg('✗ ' + (e.message || 'Sync failed'));
    }
    setGbpSyncing(false);
  }
  async function handleDisconnectGbp() {
    if (!confirm('Disconnect Google Business Profile? Reviews already synced will remain in the database.')) return;
    setGbpMsg(null);
    try {
      await disconnectGoogleBusiness();
      setGbpMsg('✓ Disconnected.');
    } catch (e) {
      setGbpMsg('✗ ' + (e.message || 'Disconnect failed'));
    }
  }

  useEffect(() => {
    fetchReviewReceived().then(setReviews).catch(() => setReviews([]));
  }, []);

  if (!cfg) return <Empty>Loading…</Empty>;

  function patch(key, val) { setCfg(c => ({ ...c, [key]: val })); }
  function patchHour(day, val) { setCfg(c => ({ ...c, hours: { ...c.hours, [day]: val } })); }

  const testimonials = cfg.testimonials || [];

  function openNew() {
    setDraft({ name: '', rating: 5, text: '', techName: '', date: '' });
    setEditIdx(-1);
  }
  function openEdit(i) {
    setDraft({ ...testimonials[i] });
    setEditIdx(i);
  }
  function cancelEdit() { setEditIdx(null); setDraft(null); }

  function saveTestimonial() {
    if (!draft.text?.trim() && !draft.name?.trim()) return;
    const entry = { name: draft.name || '', rating: Number(draft.rating) || 5, text: draft.text || '', techName: draft.techName || '', date: draft.date || '' };
    const next = editIdx === -1
      ? [...testimonials, entry]
      : testimonials.map((t, i) => i === editIdx ? entry : t);
    patch('testimonials', next);
    cancelEdit();
  }

  function removeTestimonial(i) {
    patch('testimonials', testimonials.filter((_, idx) => idx !== i));
  }

  function promoteReview(r) {
    const name = r.clientName ? r.clientName.split(' ')[0] + (r.clientName.includes(' ') ? ' ' + r.clientName.split(' ').slice(-1)[0][0] + '.' : '') : 'Happy Client';
    const entry = {
      name,
      rating:   r.rating   || 5,
      text:     r.text     || '',
      techName: r.techName || '',
      date:     r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '',
    };
    patch('testimonials', [...testimonials, entry]);
  }

  async function handleRefreshGoogleReviews() {
    const placeId = cfg.googlePlaceId?.trim();
    if (!placeId) { alert('Enter a Google Place ID first.'); return; }
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const { callFn } = await import('../../lib/firebase.js');
      const result = await callFn('refreshGoogleReviews')({ tenantId: TENANT_ID, placeId });
      const { count, rating, total } = result.data;
      const ts = new Date().toISOString();
      patch('googleReviewsRefreshedAt', ts);
      setRefreshMsg(`✓ Pulled ${count} reviews · ${rating}★ (${total} total)`);
    } catch (e) {
      setRefreshMsg('✗ ' + (e.message || 'Refresh failed'));
    }
    setRefreshing(false);
  }

  async function handleDetectPlaceId() {
    const address = cfg.address?.trim();
    setCandidates(null);
    setDetectMsg(null);
    if (!address) { setDetectMsg('✗ Enter a salon address above first.'); return; }
    setDetecting(true);
    try {
      const data = await findBusinessByAddress(address);
      if (!data?.placeId) {
        setDetectMsg('✗ No nail salon found at that address — paste the Place ID manually.');
      } else {
        patch('googlePlaceId', data.placeId);
        if (data.mapsUrl) patch('mapsUrl', data.mapsUrl);
        if (data.candidates?.length > 1) {
          setCandidates(data.candidates);
          setDetectMsg(`✓ Auto-filled ${data.name}${data.mapsUrl ? ' + Maps URL' : ''}. ${data.candidates.length - 1} other matches below if this is wrong.`);
        } else {
          setDetectMsg(`✓ Found: ${data.name}${data.rating ? ` · ${data.rating}★ (${data.userRatingCount} reviews)` : ''}${data.mapsUrl ? ' · Maps URL filled' : ''}`);
        }
      }
    } catch (e) {
      setDetectMsg('✗ ' + (e.message || 'Detection failed'));
    }
    setDetecting(false);
  }

  async function save() {
    setSaving(true);
    try {
      await saveWebfrontConfig(cfg);
      logActivity('webfront_saved', 'webfront config updated');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setSaving(false); }
  }

  const webUrl = window.location.origin;
  const inp = { fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' };
  const TA  = { ...inp, resize: 'vertical', minHeight: 80 };

  return (
    <div>
      {/* Preview URL */}
      <Section title="🌐 Public Website">
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--pn-text-muted)', background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 8, padding: '7px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{webUrl}</div>
          <button onClick={() => window.open(webUrl, '_blank')} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #3D95CE', background: 'var(--pn-info-bg)', color: 'var(--pn-info)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
            Open ↗
          </button>
        </div>
        <div style={{ padding: '0 16px 12px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[
            ['showBookingCta', 'Show "Book Now"'],
            ['showServices',   'Show Services'],
            ['showTeam',       'Show Team'],
            ['showReviews',    'Show Reviews'],
          ].map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--pn-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!cfg[key]} onChange={e => patch(key, e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} />
              {label}
            </label>
          ))}
        </div>
      </Section>

      {/* Hero copy */}
      <Section title="✏️ Hero Text">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Tagline</div>
            <input value={cfg.tagline || ''} onChange={e => patch('tagline', e.target.value)} placeholder="Where nails become art." style={inp} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>About / Our Story paragraph</div>
            <textarea value={cfg.about || ''} onChange={e => patch('about', e.target.value)} placeholder="Welcome to Meraki Nail Studio…" style={TA} />
          </div>
        </div>
      </Section>

      {/* Editorial layout copy — only relevant when layout === 'merakiSite'.
          These strings drive every prose-y block on the editorial homepage.
          Edit + Save (button at bottom of Webfront tab) writes to webfront
          doc; component reads live, no redeploy needed. */}
      {cfg.layout === 'merakiSite' && (
        <Section title="✨ Editorial Layout Copy">
          <div style={{ padding: '8px 16px 4px', fontSize: 11, color: 'var(--pn-text-muted)' }}>
            Per-section prose for the Editorial homepage. Leave a field blank to fall back to the default. Changes go live on the next page load — no redeploy.
          </div>

          {/* Live Google rating block — the homepage's ⭐ rating and review count
              pull from the googleReviews cache (refreshed below in the Google
              Reviews section), so there's no manual field here. */}
          <div style={{ margin: '8px 16px 0', padding: '10px 14px', background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Live from Google</div>
            <div style={{ fontSize: 14, color: 'var(--pn-text)' }}>
              {gReviews?.rating != null ? (
                <>
                  <strong>{Number(gReviews.rating).toFixed(1)}★</strong>
                  <span style={{ color: 'var(--pn-text-muted)' }}> · {gReviews.userRatingCount ?? 0} reviews</span>
                </>
              ) : (
                <span style={{ color: 'var(--pn-text-faint)' }}>Not yet fetched — set the Place ID below and click Refresh.</span>
              )}
            </div>
            {gReviews?.refreshedAt && (
              <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>Refreshed {new Date(gReviews.refreshedAt).toLocaleString()}</span>
            )}
            <a href="#google-reviews"
              onClick={(e) => { e.preventDefault(); document.querySelector('[data-anchor="google-reviews"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              style={{ marginLeft: 'auto', fontSize: 12, color: '#2D7A5F', fontWeight: 600, textDecoration: 'none' }}>
              Manage ↓
            </a>
          </div>

          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              ['heroCopy',       'Hero paragraph',           'A quiet studio for considered nail work — meraki is the Greek soul…', true],
              ['meaningDef',     '"meraki" definition',      'when you do something soul, creativity, or love…',                    true],
              ['servicesIntro',  'Services intro',           'A curated set of signature treatments. Considered work, quiet rooms, no rush.', true],
              ['portfolioIntro', 'Portfolio intro',          'A small sample. The full feed lives on Instagram.',                    true],
              ['teamIntro',      'Team intro',               'Each of our techs brings their own hand and their own specialty…',     true],
              ['visitIntro',     'Visit intro',              'Two blocks north of the Olentangy Trail. Parking out front…',          true],
              ['walkInLine',     'Hero ticker — walk‑ins',   'Walk‑ins every day',                                                   false],
              ['heroCredit',     'Hero photo credit caption','Nail art by Samantha · @gelxbysammy',                                  false],
              ['established',    'Established (year)',       '2019',                                                                 false],
            ].map(([key, label, ph, multiline]) => (
              <div key={key}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
                {multiline
                  ? <textarea value={cfg[key] || ''} onChange={e => patch(key, e.target.value)} placeholder={ph} style={TA} />
                  : <input    value={cfg[key] || ''} onChange={e => patch(key, e.target.value)} placeholder={ph} style={inp} />}
              </div>
            ))}

            {/* Team photo shape — applies to all tech avatars in the Team section. */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Team photo shape
              </div>
              <select value={cfg.teamPhotoShape || 'rectangle'} onChange={e => patch('teamPhotoShape', e.target.value)} style={inp}>
                <option value="rectangle">Rectangle (default · subtle 3px corners)</option>
                <option value="rounded">Rounded rectangle (22px corners)</option>
                <option value="circle">Circle</option>
                <option value="asymmetric">Asymmetric blob (organic, each tech unique)</option>
              </select>
              <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 4, lineHeight: 1.45 }}>
                Asymmetric gives each tech a hand-tuned organic outline that varies by position — feels editorial, less stamped-out.
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* Portfolio grid (editorial layout only) */}
      {cfg.layout === 'merakiSite' && (
        <PortfolioGridEditor cfg={cfg} patch={patch} />
      )}

      {/* Contact */}
      <Section title="📞 Contact Info">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['phone',       'Phone',           '(614) 555-0100 or +16145550100'],
            ['publicEmail', 'Public email',    'hello@merakinailstudio.com'],
            ['address',     'Address',         '5029 Olentangy River Rd, Columbus, OH 43214'],
            ['mapsUrl',     'Google Maps URL', 'https://maps.google.com/…'],
          ].map(([key, label, ph]) => (
            <div key={key}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
              {key === 'address' ? (
                <AddressAutocomplete
                  value={cfg.address || ''}
                  onChange={(v) => patch('address', v)}
                  onPlaceSelected={(place) => patch('address', place.formatted || place.street || '')}
                  placeholder={ph}
                  style={inp}
                />
              ) : (
                <input value={cfg[key] || ''} onChange={e => patch(key, e.target.value)} placeholder={ph} style={inp} />
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Hours */}
      <Section title="🕐 Business Hours">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DAY_LABELS.map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--pn-text-muted)', width: 90, flexShrink: 0 }}>{label}</span>
              <input value={cfg.hours?.[key] || ''} onChange={e => patchHour(key, e.target.value)} placeholder="Closed" style={{ ...inp, flex: 1 }} />
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 4 }}>Format: "10:00 AM – 7:00 PM" or "Closed"</div>
        </div>
      </Section>

      {/* Social */}
      <Section title="📱 Social Links">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['instagram',       'Instagram',       'meraki_cbus'],
            ['facebook',        'Facebook',        'page name or handle'],
            ['tiktok',          'TikTok',          'handle without @'],
            ['googleReviewUrl', 'Google Review URL','https://g.page/r/…/review'],
          ].map(([key, label, ph]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--pn-text-muted)', width: 120, flexShrink: 0 }}>{label}</span>
              <input value={cfg[key] || ''} onChange={e => patch(key, e.target.value)} placeholder={ph} style={{ ...inp, flex: 1 }} />
            </div>
          ))}
        </div>
      </Section>

      {/* Google Reviews */}
      <div data-anchor="google-reviews">
      <Section title="⭐ Google Reviews">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Google Place ID</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <input value={cfg.googlePlaceId || ''} onChange={e => patch('googlePlaceId', e.target.value)} placeholder="ChIJ…" style={{ ...inp, flex: 1 }} />
              <button type="button" onClick={handleDetectPlaceId} disabled={detecting || !cfg.address?.trim()}
                title={!cfg.address?.trim() ? 'Enter the salon address above first' : 'Find the Place ID from the salon address'}
                style={{ padding: '0 14px', borderRadius: 8, border: '1px solid #2D7A5F', background: detecting ? '#aaa' : '#fff', color: detecting ? '#fff' : '#2D7A5F', fontSize: 12, fontWeight: 600, cursor: detecting || !cfg.address?.trim() ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: !cfg.address?.trim() ? 0.5 : 1 }}>
                {detecting ? 'Detecting…' : '🔍 Auto-detect from address'}
              </button>
            </div>
            {detectMsg && (
              <div style={{ fontSize: 12, color: detectMsg.startsWith('✓') ? '#2D7A5F' : '#ef4444', fontWeight: 500, marginTop: 6 }}>{detectMsg}</div>
            )}
            {candidates && candidates.length > 1 && (
              <div style={{ marginTop: 8, border: '1px solid var(--pn-border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', padding: '6px 10px', background: 'var(--pn-bg)', borderBottom: '1px solid var(--pn-border)' }}>Other candidates — click to switch</div>
                {candidates.map(c => (
                  <button key={c.placeId} type="button"
                    onClick={() => { patch('googlePlaceId', c.placeId); if (c.mapsUrl) patch('mapsUrl', c.mapsUrl); setDetectMsg(`✓ Switched to ${c.name}${c.mapsUrl ? ' + Maps URL' : ''}`); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: cfg.googlePlaceId === c.placeId ? '#f0fdf4' : 'var(--pn-surface)', border: 'none', borderBottom: '1px solid var(--pn-border)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--pn-text)' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>{c.address}</div>
                  </button>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 4 }}>
              Or paste manually from <span style={{ color: '#3D95CE' }}>developers.google.com/maps/documentation/places/web-service/place-id</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={handleRefreshGoogleReviews} disabled={refreshing}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: refreshing ? '#aaa' : '#2D7A5F', color: '#fff', fontSize: 13, fontWeight: 600, cursor: refreshing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {refreshing ? 'Fetching…' : '↻ Refresh from Google'}
            </button>
            {cfg.googleReviewsRefreshedAt && !refreshMsg && (
              <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>Last updated: {new Date(cfg.googleReviewsRefreshedAt).toLocaleString()}</span>
            )}
            {refreshMsg && (
              <span style={{ fontSize: 12, color: refreshMsg.startsWith('✓') ? '#2D7A5F' : '#ef4444', fontWeight: 500 }}>{refreshMsg}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', lineHeight: 1.5 }}>
            Reviews are cached in Firestore and displayed on the public webfront. Refresh periodically to pull the latest from Google.
          </div>

          {/* Google Business Profile OAuth — pulls ALL reviews, not just 5 */}
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px dashed var(--pn-border)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 6 }}>
              📈 Full review history via Google Business Profile
            </div>
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
              The "Refresh from Google" button above uses the public Places API, which caps at <strong>5 reviews</strong>. To pull every review (174+ for Meraki), connect the Business Profile that owns the listing — this lets you OAuth in as the verified salon owner and authorizes us to read the full history. Reviews sync nightly thereafter.
            </div>

            {!gbpAuth ? (
              <button onClick={handleConnectGbp} disabled={gbpConnecting}
                style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: gbpConnecting ? '#aaa' : '#4285f4', color: '#fff', fontSize: 13, fontWeight: 600, cursor: gbpConnecting ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                {gbpConnecting ? 'Opening Google…' : '🔗 Connect Google Business Profile'}
              </button>
            ) : (
              <div style={{ background: 'var(--pn-success-bg)', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-success)' }}>
                      ✓ Connected · {gbpAuth.locationTitle || gbpAuth.locationName}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--pn-success)', marginTop: 2 }}>
                      {gbpAuth.lastSyncAt ? `Last synced ${new Date(gbpAuth.lastSyncAt).toLocaleString()} · ${gbpAuth.lastSyncCount || 0} reviews` : 'Not synced yet — click "Sync now"'}
                    </div>
                    {gbpAuth.lastSyncError && (
                      <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>
                        Last sync error: {gbpAuth.lastSyncError}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button onClick={handleSyncGbp} disabled={gbpSyncing}
                      style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: gbpSyncing ? '#aaa' : '#2D7A5F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: gbpSyncing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                      {gbpSyncing ? 'Syncing…' : '↻ Sync now'}
                    </button>
                    <button onClick={handleDisconnectGbp}
                      style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Disconnect
                    </button>
                  </div>
                </div>
              </div>
            )}

            {gbpMsg && (
              <div style={{ fontSize: 12, color: gbpMsg.startsWith('✓') ? '#2D7A5F' : '#b91c1c', fontWeight: 500, marginTop: 8 }}>{gbpMsg}</div>
            )}
            <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 8, lineHeight: 1.5 }}>
              Requires GCP setup (see <code style={{ fontFamily: 'ui-monospace, Menlo, monospace', background: 'var(--pn-bg)', padding: '0 4px', borderRadius: 3 }}>docs/GOOGLE_BUSINESS_PROFILE_SETUP.md</code>). Refresh token is encrypted at rest via Cloud KMS.
            </div>
          </div>
        </div>
      </Section>
      </div>

      {/* Manual Testimonials */}
      <Section title={`💬 Manual Testimonials (${testimonials.length})`}>
        {/* Existing testimonials */}
        {testimonials.length > 0 && (
          <div style={{ padding: '8px 16px 0' }}>
            {testimonials.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--pn-border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text)' }}>{t.name || 'Anonymous'}</span>
                    <span style={{ fontSize: 11, color: '#f59e0b' }}>{'★'.repeat(t.rating || 5)}</span>
                    {t.techName && <span style={{ fontSize: 11, color: '#2D7A5F' }}>· {t.techName}</span>}
                    {t.date && <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>· {t.date}</span>}
                  </div>
                  {t.text && <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>"{t.text}"</div>}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <Btn onClick={() => openEdit(i)}>Edit</Btn>
                  <Btn color="#ef4444" onClick={() => removeTestimonial(i)}>✕</Btn>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit / Add form */}
        {editIdx !== null && draft && (
          <div style={{ margin: '10px 16px', background: 'var(--pn-bg)', borderRadius: 10, padding: '14px', border: '1px solid var(--pn-border)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 10 }}>{editIdx === -1 ? 'Add Testimonial' : 'Edit Testimonial'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Client name (e.g. Sarah K.)" style={{ ...inp, flex: 2 }} />
                <input value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} placeholder="Date (e.g. Jan 2025)" style={{ ...inp, flex: 1 }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={draft.techName} onChange={e => setDraft(d => ({ ...d, techName: e.target.value }))} placeholder="Technician name (optional)" style={{ ...inp, flex: 1 }} />
                <select value={draft.rating} onChange={e => setDraft(d => ({ ...d, rating: Number(e.target.value) }))}
                  style={{ ...inp, flex: 0, width: 90 }}>
                  {[5,4,3,2,1].map(n => <option key={n} value={n}>{n} ★</option>)}
                </select>
              </div>
              <textarea value={draft.text} onChange={e => setDraft(d => ({ ...d, text: e.target.value }))} placeholder="Review text…" style={{ ...TA, minHeight: 70 }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Btn onClick={cancelEdit}>Cancel</Btn>
                <Btn color="#2D7A5F" onClick={saveTestimonial}>
                  {editIdx === -1 ? 'Add' : 'Save'}
                </Btn>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '10px 16px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn color="#2D7A5F" onClick={openNew}>＋ Add Testimonial</Btn>
        </div>

        {/* Promote from recorded reviews */}
        {reviews && reviews.length > 0 && (
          <>
            <div style={{ padding: '0 16px 8px', fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Promote from recorded reviews
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto', borderTop: '1px solid var(--pn-border)' }}>
              {reviews.filter(r => r.text).map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 16px', borderBottom: '1px solid var(--pn-border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text)' }}>{r.clientName || '—'}</span>
                      <span style={{ fontSize: 11, color: '#f59e0b' }}>{'★'.repeat(r.rating || 5)}</span>
                      {r.techName && <span style={{ fontSize: 11, color: '#2D7A5F' }}>· {r.techName}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{r.text}"</div>
                  </div>
                  <Btn color="#3D95CE" onClick={() => promoteReview(r)}>Feature</Btn>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* Appearance — layout + theme for the public website */}
      <Section title="🎨 Appearance">
        {/* Layout picker */}
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-faint)', letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 10 }}>Layout</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
            {[
              { id: 'classic',    icon: '🌑', name: 'Classic',   desc: 'Dark hero, bold & dramatic' },
              { id: 'boutique',   icon: '🌸', name: 'Boutique',  desc: 'Light & airy, soft tones' },
              { id: 'minimal',    icon: '◻',  name: 'Minimal',   desc: 'Clean, wide-open, editorial' },
              { id: 'merakiSite', icon: '✦',  name: 'Editorial', desc: 'Full magazine-style homepage' },
            ].map(l => (
              <button key={l.id} onClick={() => patch('layout', l.id)} style={{
                border: `2px solid ${(cfg.layout || 'classic') === l.id ? '#3D95CE' : 'var(--pn-border)'}`,
                borderRadius: 10, padding: '10px 8px', cursor: 'pointer', background: 'var(--pn-surface)',
                boxShadow: (cfg.layout || 'classic') === l.id ? '0 0 0 3px rgba(61,149,206,.18)' : 'none',
                fontFamily: 'inherit', textAlign: 'center', transition: 'border-color .15s',
                position: 'relative',
              }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{l.icon}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text)' }}>{l.name}</div>
                <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 2, lineHeight: 1.3 }}>{l.desc}</div>
                {(cfg.layout || 'classic') === l.id && (
                  <div style={{ position: 'absolute', top: 4, right: 6, fontSize: 10, color: '#3D95CE', fontWeight: 700 }}>✓</div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Theme picker — auto-seasonal toggle */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Auto-seasonal themes</div>
            <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>
              {cfg.autoTheme && detectAutoTheme() ? `Active now: ${detectAutoTheme().icon} ${detectAutoTheme().name}` : 'Switches to holiday themes by date'}
            </div>
          </div>
          <button onClick={() => patch('autoTheme', !cfg.autoTheme)} style={{
            width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', padding: 0,
            background: cfg.autoTheme ? '#2D7A5F' : '#d1d5db', position: 'relative', transition: 'background .2s', flexShrink: 0,
          }}>
            <div style={{ position: 'absolute', top: 3, left: cfg.autoTheme ? 22 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
          </button>
        </div>

        {/* Core palettes */}
        <div style={{ padding: '0 12px 14px', borderTop: '1px solid var(--pn-border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pn-text-faint)', letterSpacing: '.07em', textTransform: 'uppercase', padding: '10px 4px 8px' }}>
            {cfg.autoTheme ? 'Default palette (when no holiday active)' : 'Core palettes'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {CORE_THEMES.map(th => (
              <ThemeCard key={th.id} th={th} isSelected={(cfg.themeId || 'meraki') === th.id}
                badge={cfg.autoTheme && detectAutoTheme()?.id === th.id ? 'NOW' : null}
                onClick={() => patch('themeId', th.id)} />
            ))}
          </div>
        </div>

        {/* Holidays & seasonal */}
        <div style={{ padding: '0 12px 14px', borderTop: '1px solid var(--pn-border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pn-text-faint)', letterSpacing: '.07em', textTransform: 'uppercase', padding: '10px 4px 8px' }}>
            Holidays &amp; seasons{cfg.autoTheme ? ' — auto-activate by date' : ' — select to pin'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {HOLIDAY_THEMES.map(th => (
              <ThemeCard key={th.id} th={th} isSelected={(cfg.themeId || 'meraki') === th.id}
                badge={cfg.autoTheme && detectAutoTheme()?.id === th.id ? 'NOW' : null}
                onClick={() => patch('themeId', th.id)} />
            ))}
          </div>
        </div>
      </Section>

      {/* Save */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, marginBottom: 16 }}>
        <button onClick={() => window.open(webUrl, '_blank')}
          style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', fontSize: 13, color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
          Preview
        </button>
        <button onClick={save} disabled={saving}
          style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: saved ? '#2D7A5F' : saving ? '#aaa' : '#3D95CE', fontSize: 13, fontWeight: 700, color: '#fff', cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

// ── Portfolio Grid editor (editorial layout) ───────────
// Lets the salon owner curate the 16-ish photos that appear in the
// editorial homepage's "Recent Work" section. Source pool is the 44
// compressed photos under /public/brand/meraki/portfolio/. Saves to
// webfront.portfolio = [{src, cls}, …] which the public site reads.
const PORTFOLIO_TOTAL = 44;
const PORTFOLIO_TILE_SIZES = [
  { id: 't-wide', label: 'Wide  · 6×2' },
  { id: 't-tall', label: 'Tall  · 3×3' },
  { id: 't-lg',   label: 'Large · 6×3' },
  { id: 't-md2',  label: 'Med+  · 5×2' },
  { id: 't-mid',  label: 'Med   · 4×2' },
  { id: 't-sq',   label: 'Sq    · 3×2' },
];
// Magazine-rhythm pattern. Mixing one wide/tall accent every few tiles
// against squares + mids creates editorial pacing. Used by the "Auto-
// arrange" button and as the default size for newly-added photos.
// Tile-rhythm presets. Each defines a cls pattern that cycles through the
// selected photos. Picking one stamps every tile + sets the default for
// any photo added afterward. Three distinct "professional" looks.
const PORTFOLIO_PRESETS = [
  {
    id:       'magazine',
    name:     'Magazine',
    desc:     'Editorial mix · varied sizes',
    accent:   '#6a4fa0',
    pattern: ['t-wide','t-tall','t-sq','t-mid','t-md2','t-sq','t-mid','t-tall',
              't-sq','t-md2','t-wide','t-sq','t-mid','t-tall','t-sq','t-md2'],
  },
  {
    id:       'aesop',
    name:     'Boutique',
    desc:     'Restrained rectangles · breathing',
    accent:   '#c19a4a',
    pattern: ['t-mid','t-mid','t-mid','t-mid','t-mid','t-mid','t-mid','t-mid',
              't-mid','t-mid','t-mid','t-mid','t-mid','t-mid','t-mid','t-mid'],
  },
  {
    id:       'instagram',
    name:     'Instagram',
    desc:     'Uniform squares · social-grid feel',
    accent:   '#3D95CE',
    pattern: ['t-sq','t-sq','t-sq','t-sq','t-sq','t-sq','t-sq','t-sq',
              't-sq','t-sq','t-sq','t-sq','t-sq','t-sq','t-sq','t-sq'],
  },
];
function patternForId(id) {
  return (PORTFOLIO_PRESETS.find(p => p.id === id) || PORTFOLIO_PRESETS[0]).pattern;
}
function patternAt(i, presetId) {
  const p = patternForId(presetId);
  return p[i % p.length];
}
// CSS Grid span values per tile cls — kept in sync with HeroMerakiSite's
// portfolio renderer. Used for the preview mockups below.
const PREVIEW_SPANS = {
  't-wide': { col: 6, row: 2 },
  't-tall': { col: 3, row: 3 },
  't-lg':   { col: 6, row: 3 },
  't-md2':  { col: 5, row: 2 },
  't-mid':  { col: 4, row: 2 },
  't-sq':   { col: 3, row: 2 },
};
const photoSrc   = (n) => `/brand/meraki/portfolio/hero/photo-${String(n).padStart(2,'0')}.jpg`;
const photoThumb = (n) => `/brand/meraki/portfolio/grid/photo-${String(n).padStart(2,'0')}.jpg`;
function srcToNum(src) {
  const m = String(src || '').match(/photo-(\d{2})\.jpg/);
  return m ? parseInt(m[1], 10) : null;
}

function PortfolioGridEditor({ cfg, patch }) {
  const selected = Array.isArray(cfg.portfolio) ? cfg.portfolio : [];
  const uploads  = Array.isArray(cfg.portfolioUploads) ? cfg.portfolioUploads : [];
  const selectedSrcs = new Set(selected.map(p => p.src));
  const selectedNums = new Set(selected.map(p => srcToNum(p.src)).filter(Boolean));
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState(null);
  const fileRef = useRef(null);

  function setPortfolio(next) { patch('portfolio', next); }
  function setUploads(next)   { patch('portfolioUploads', next); }
  const activePresetId = cfg.portfolioPattern || 'magazine';
  function addSrc(src) {
    if (selectedSrcs.has(src)) return;
    // Auto-pick a tile size based on the next slot in the ACTIVE pattern —
    // gives newcomers an instant editorial rhythm without thinking about it.
    setPortfolio([...selected, { src, cls: patternAt(selected.length, activePresetId) }]);
  }
  function applyPreset(presetId) {
    patch('portfolioPattern', presetId);
    if (selected.length) {
      setPortfolio(selected.map((p, i) => ({ ...p, cls: patternAt(i, presetId) })));
    }
  }
  function addPhoto(n) { addSrc(photoSrc(n)); }
  function removeAt(i) { setPortfolio(selected.filter((_, idx) => idx !== i)); }
  function setSizeAt(i, cls) { setPortfolio(selected.map((p, idx) => idx === i ? { ...p, cls } : p)); }
  function moveAt(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j], next[i]];
    setPortfolio(next);
  }
  function resetToDefaults() {
    if (!window.confirm('Clear your custom portfolio and use the default 16-photo grid?')) return;
    setPortfolio([]);
  }
  function removeUpload(url) {
    if (!window.confirm('Remove this uploaded photo from your library? (Photo stays in Storage but is no longer available to add.)')) return;
    setUploads(uploads.filter(u => u !== url));
    // Also strip it from the active grid if present.
    if (selectedSrcs.has(url)) setPortfolio(selected.filter(p => p.src !== url));
  }

  async function onFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setUploadErr(null);
    const added = [];
    for (const f of files) {
      try {
        const url = await uploadPortfolioPhoto(f);
        added.push(url);
      } catch (err) {
        console.warn('[upload]', err);
        setUploadErr(err?.message || 'Upload failed');
      }
    }
    if (added.length) setUploads([...uploads, ...added]);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';  // allow re-picking same file
  }

  const inp = { fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '4px 6px', fontSize: 12, background: 'var(--pn-surface)', cursor: 'pointer' };

  return (
    <Section title={`🖼 Portfolio Grid${selected.length ? ` · ${selected.length} photos` : ' · using default 16'}`}>
      <div style={{ padding: '8px 16px 4px', fontSize: 11, color: 'var(--pn-text-muted)' }}>
        Curate which photos appear in the "Recent Work" section of the editorial homepage. Pick a style preset for instant magazine-rhythm, or hand-tune per-tile sizes below.
      </div>

      {/* Style presets */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--pn-border)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
          Tile Style
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {PORTFOLIO_PRESETS.map(p => (
            <PortfolioPresetCard
              key={p.id}
              preset={p}
              active={p.id === activePresetId}
              onApply={() => applyPreset(p.id)}
            />
          ))}
        </div>
      </div>

      {/* Selected list */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--pn-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
            Selected ({selected.length})
          </div>
          {selected.length > 0 && (
            <button onClick={resetToDefaults} style={{ ...inp, color: '#a00', borderColor: '#fecaca', background: 'var(--pn-surface)' }}>
              Reset to default
            </button>
          )}
        </div>
        {selected.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', padding: '14px 8px', textAlign: 'center', background: 'var(--pn-bg)', borderRadius: 6 }}>
            No custom selection — the site shows the built-in 16-photo default. Click any photo below to start curating.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {selected.map((p, i) => {
              const n = srcToNum(p.src);
              return (
                <div key={`${p.src}-${i}`} style={{ border: '1px solid var(--pn-border)', borderRadius: 8, padding: 8, background: 'var(--pn-surface)', position: 'relative' }}>
                  <div style={{ position: 'relative', aspectRatio: '1', borderRadius: 4, overflow: 'hidden', background: '#f5f0e7', marginBottom: 6 }}>
                    <img src={photoThumb(n)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{i + 1}</div>
                    <button onClick={() => removeAt(i)} title="Remove" style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(220,38,38,.9)', color: '#fff', border: 'none', borderRadius: 12, width: 20, height: 20, fontSize: 12, cursor: 'pointer', fontWeight: 700, lineHeight: 1 }}>✕</button>
                  </div>
                  <select value={p.cls} onChange={e => setSizeAt(i, e.target.value)} style={{ ...inp, width: '100%', fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
                    {PORTFOLIO_TILE_SIZES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <button onClick={() => moveAt(i, -1)} disabled={i === 0} style={{ ...inp, flex: 1, opacity: i === 0 ? .35 : 1 }} title="Move up">↑</button>
                    <button onClick={() => moveAt(i, +1)} disabled={i === selected.length - 1} style={{ ...inp, flex: 1, opacity: i === selected.length - 1 ? .35 : 1 }} title="Move down">↓</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Your uploads */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--pn-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
            Your Uploads ({uploads.length})
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {uploading && <span style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>Uploading…</span>}
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={onFiles} disabled={uploading} style={{ display: 'none' }} id="portfolio-upload" />
            <label htmlFor="portfolio-upload" style={{
              ...inp, padding: '6px 14px', borderColor: '#c19a4a', color: '#c19a4a', background: '#fffbf2',
              fontWeight: 700, cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? .6 : 1,
            }}>
              + Upload photos
            </label>
          </div>
        </div>
        {uploadErr && <div style={{ fontSize: 11, color: '#a00', marginBottom: 8 }}>⚠ {uploadErr}</div>}
        {uploads.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', padding: '14px 8px', textAlign: 'center', background: 'var(--pn-bg)', borderRadius: 6 }}>
            No uploads yet — click "Upload photos" to add your own. They'll appear here and become selectable below.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6 }}>
            {uploads.map(url => {
              const used = selectedSrcs.has(url);
              return (
                <div key={url} style={{ position: 'relative', aspectRatio: '1', border: used ? '2px solid #c19a4a' : '1px solid var(--pn-border)', borderRadius: 6, overflow: 'hidden', background: '#f5f0e7' }}>
                  <button
                    onClick={() => !used && addSrc(url)}
                    disabled={used}
                    title={used ? 'Already in grid' : 'Add to grid'}
                    style={{ position: 'absolute', inset: 0, padding: 0, border: 'none', background: 'transparent', cursor: used ? 'default' : 'pointer', opacity: used ? .55 : 1 }}>
                    <img src={url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </button>
                  <button
                    onClick={() => removeUpload(url)}
                    title="Delete from library"
                    style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(220,38,38,.92)', color: '#fff', border: 'none', borderRadius: 12, width: 20, height: 20, fontSize: 12, cursor: 'pointer', fontWeight: 700, lineHeight: 1 }}>✕</button>
                  {used && (
                    <div style={{ position: 'absolute', bottom: 4, left: 4, background: '#c19a4a', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3 }}>✓ In grid</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bundled photo pool */}
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
          Bundled Library ({PORTFOLIO_TOTAL} photos)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6 }}>
          {Array.from({ length: PORTFOLIO_TOTAL }, (_, i) => i + 1).map(n => {
            const used = selectedNums.has(n);
            return (
              <button
                key={n}
                onClick={() => !used && addPhoto(n)}
                disabled={used}
                title={used ? `Photo ${n} (already in grid)` : `Add photo ${n}`}
                style={{
                  position: 'relative',
                  aspectRatio: '1',
                  border: used ? '2px solid #c19a4a' : '1px solid var(--pn-border)',
                  borderRadius: 6, padding: 0, background: '#f5f0e7',
                  cursor: used ? 'default' : 'pointer',
                  overflow: 'hidden',
                  opacity: used ? .45 : 1,
                  transition: 'opacity .15s, transform .15s',
                }}
                onMouseEnter={e => { if (!used) e.currentTarget.style.transform = 'scale(1.04)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <img src={photoThumb(n)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <div style={{ position: 'absolute', bottom: 3, left: 3, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3 }}>{n}</div>
                {used && (
                  <div style={{ position: 'absolute', top: 4, right: 4, background: '#c19a4a', color: '#fff', fontSize: 10, fontWeight: 700, width: 18, height: 18, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✓</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

// Mini preview of a portfolio preset — renders the first 6 tiles of the
// pattern at thumbnail scale so the user can see the rhythm before
// applying. Uses the exact same span values the public site uses, so
// what you see here matches what gets rendered there.
function PortfolioPresetCard({ preset, active, onApply }) {
  const [hover, setHover] = useState(false);
  const tiles = preset.pattern.slice(0, 6).map(c => PREVIEW_SPANS[c] || PREVIEW_SPANS['t-sq']);
  const showAccent = active ? preset.accent : (hover ? preset.accent : 'var(--pn-border)');
  return (
    <button
      onClick={onApply}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: 10,
        border: `2px solid ${showAccent}`,
        borderRadius: 10,
        background: active ? `${preset.accent}0d` : 'var(--pn-surface)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        transition: 'border-color .15s, background .15s, transform .15s',
        boxShadow: active ? `0 0 0 3px ${preset.accent}22` : 'none',
        transform: hover && !active ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      {/* Pattern preview — 12-col grid in miniature */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(12, 1fr)',
        gridAutoRows: 12,
        gap: 2,
        marginBottom: 10,
        gridAutoFlow: 'dense',
      }}>
        {tiles.map((t, i) => (
          <div key={i} style={{
            gridColumn: `span ${t.col}`,
            gridRow:    `span ${t.row}`,
            background: active ? preset.accent : '#cbd5e1',
            borderRadius: 2,
            opacity: active ? 0.85 : 0.55,
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)' }}>{preset.name}</div>
        {active && <span style={{ fontSize: 10, fontWeight: 700, color: preset.accent, background: `${preset.accent}1f`, padding: '2px 6px', borderRadius: 3, letterSpacing: '.04em' }}>ACTIVE</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.4 }}>{preset.desc}</div>
    </button>
  );
}

// ── Notification Center ────────────────────────────────
// ── Reviews Tab ───────────────────────────────────────
function ReviewsTab({ data, onRefresh, onMarkReceived }) {
  const [marking, setMarking] = useState(null);
  const [filter,  setFilter]  = useState('all');

  if (!data) return <Empty>Loading…</Empty>;

  const { requests, received } = data;
  const receivedIds = new Set(received.map(r => r.clientId).filter(Boolean));

  const filtered = requests.filter(r => {
    if (filter === 'pending')  return !r.clickedAt && !receivedIds.has(r.clientId);
    if (filter === 'clicked')  return !!r.clickedAt && !receivedIds.has(r.clientId);
    if (filter === 'received') return receivedIds.has(r.clientId);
    return true;
  });

  const sent     = requests.length;
  const clicked  = requests.filter(r => r.clickedAt).length;
  const recvd    = received.length;
  const clickPct = sent ? Math.round((clicked / sent) * 100) : 0;
  const convPct  = sent ? Math.round((recvd   / sent) * 100) : 0;

  async function handleMark(req) {
    setMarking(req.id);
    try { await onMarkReceived(req); } catch { /* noop */ }
    setMarking(null);
  }

  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: '14px 16px 2px' }}>
        {[
          { label: 'Requests sent',   value: sent,      accent: '#3D95CE' },
          { label: `Clicked (${clickPct}%)`, value: clicked, accent: '#f59e0b' },
          { label: `Reviewed (${convPct}%)`, value: recvd,   accent: '#2D7A5F' },
        ].map(({ label, value, accent }) => (
          <div key={label} style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>{value}</div>
            <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filter + Refresh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', flexWrap: 'wrap' }}>
        {[['all','All'],['pending','Not clicked'],['clicked','Clicked'],['received','Reviewed']].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)}
            style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${filter === id ? '#2D7A5F' : 'var(--pn-border)'}`, background: filter === id ? '#f0faf6' : 'var(--pn-surface)', color: filter === id ? '#2D7A5F' : 'var(--pn-text-muted)', fontSize: 12, fontWeight: filter === id ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
            {label}
          </button>
        ))}
        <button onClick={onRefresh} style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 20, border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', color: 'var(--pn-text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          ↻ Refresh
        </button>
      </div>

      {/* List */}
      {filtered.length === 0
        ? <Empty>No requests in this filter</Empty>
        : filtered.map(req => {
            const isReceived = receivedIds.has(req.clientId);
            const wasClicked = !!req.clickedAt;
            return (
              <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--pn-border)', background: 'var(--pn-surface)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{req.clientName || 'Client'}</span>
                    {req.techName && <span style={{ fontSize: 11, color: '#2D7A5F' }}>· {req.techName}</span>}
                    {isReceived
                      ? <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: 'var(--pn-success-bg)', color: 'var(--pn-success)', border: '1px solid #bbf7d0' }}>✓ Reviewed</span>
                      : wasClicked
                        ? <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: 'var(--pn-warning-bg)', color: 'var(--pn-warning)', border: '1px solid #fde68a' }}>Clicked</span>
                        : <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: 'var(--pn-bg)', color: 'var(--pn-text-faint)', border: '1px solid var(--pn-border)' }}>Sent</span>
                    }
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 3 }}>
                    Sent {fmtDate(req.createdAt)}
                    {req.clickedAt ? ` · Clicked ${fmtDate(req.clickedAt)}` : ''}
                  </div>
                </div>
                {!isReceived && (
                  <button onClick={() => handleMark(req)} disabled={marking === req.id}
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #c6e8d5', background: '#f0faf6', color: '#2D7A5F', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                    {marking === req.id ? '…' : '✓ Mark reviewed'}
                  </button>
                )}
              </div>
            );
          })
      }
    </div>
  );
}

const NOTIF_META = {
  appt_added:      { icon: '📅', label: 'Appt added',       color: '#22c55e' },
  appt_removed:    { icon: '📅', label: 'Appt removed',     color: '#f59e0b' },
  appt_assigned:   { icon: '📅', label: 'Assigned',         color: '#3D95CE' },
  appt_modified:   { icon: '📅', label: 'Appt updated',     color: '#8B5CF6' },
  client_checkin:  { icon: '📍', label: 'Check-in',         color: '#2D7A5F' },
  online_booking:  { icon: '🌐', label: 'Online booking',   color: '#3D95CE' },
  receipt:         { icon: '🧾', label: 'Receipt',           color: '#3D95CE' },
  review_request:  { icon: '⭐', label: 'Review request',   color: '#f59e0b' },
};

function statusBadge(item) {
  if (item.error)   return { label: item.error === 'no_email' ? 'No email' : 'Failed', bg: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', border: '#fca5a5' };
  if (item.sent)    return { label: 'Sent',    bg: 'var(--pn-success-bg)', color: 'var(--pn-success)', border: '#bbf7d0' };
  return               { label: 'Pending', bg: 'var(--pn-bg)', color: 'var(--pn-text-muted)',    border: 'var(--pn-border)' };
}

function NotifsTab({ items, onRefresh }) {
  const [filter, setFilter] = useState('all');

  const filters = [
    { id: 'all',      label: 'All' },
    { id: 'online',   label: 'Online' },
    { id: 'appt',     label: 'Schedule' },
    { id: 'checkin',  label: 'Check-ins' },
    { id: 'receipt',  label: 'Receipts' },
    { id: 'reviews',  label: 'Reviews' },
    { id: 'failed',   label: 'Failed' },
  ];

  const filtered = (items || []).filter(item => {
    if (filter === 'all')     return true;
    if (filter === 'online')  return item.changeType === 'online_booking';
    if (filter === 'appt')    return item._kind === 'notif' && item.changeType !== 'client_checkin' && item.changeType !== 'online_booking';
    if (filter === 'checkin') return item.changeType === 'client_checkin';
    if (filter === 'receipt') return item._kind === 'receipt';
    if (filter === 'reviews') return item._kind === 'review_request';
    if (filter === 'failed')  return !!item.error;
    return true;
  });

  const sent    = (items || []).filter(i => i.sent).length;
  const failed  = (items || []).filter(i => i.error).length;
  const pending = (items || []).filter(i => !i.sent && !i.error).length;

  return (
    <>
      {/* Summary KPIs */}
      {items && items.length > 0 && (
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--pn-border)', flexWrap: 'wrap' }}>
          {[
            { label: 'Total',   val: items.length,  bg: 'var(--pn-bg)',  color: 'var(--pn-text)'    },
            { label: 'Sent',    val: sent,           bg: 'var(--pn-success-bg)',  color: 'var(--pn-success)' },
            { label: 'Failed',  val: failed,         bg: 'var(--pn-danger-bg)',   color: 'var(--pn-danger)'  },
            { label: 'Pending', val: pending,        bg: 'var(--pn-warning-bg)',  color: 'var(--pn-warning)' },
          ].map(k => (
            <div key={k.label} style={{ background: k.bg, borderRadius: 8, padding: '6px 14px', textAlign: 'center', minWidth: 60 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: k.color }}>{k.val}</div>
              <div style={{ fontSize: 10, color: 'var(--pn-text-muted)', marginTop: 1 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter pills + refresh */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 16px', borderBottom: '1px solid var(--pn-border)', flexWrap: 'wrap', alignItems: 'center' }}>
        {filters.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            fontSize: 11, padding: '4px 11px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${filter === f.id ? '#3D95CE' : 'var(--pn-border)'}`,
            background: filter === f.id ? '#EBF4FB' : 'var(--pn-surface)',
            color: filter === f.id ? '#1a5f8a' : 'var(--pn-text-muted)',
            fontWeight: filter === f.id ? 600 : 400,
          }}>{f.label}{f.id === 'failed' && failed > 0 ? ` (${failed})` : ''}</button>
        ))}
        <Btn onClick={onRefresh} style={{ marginLeft: 'auto' }}>Refresh</Btn>
      </div>

      {/* List */}
      {items === null ? (
        <Empty>Loading…</Empty>
      ) : filtered.length === 0 ? (
        <Empty>{filter === 'all' ? 'No notifications yet' : 'None in this category'}</Empty>
      ) : (
        filtered.map((item, i) => <NotifRow key={item.id} item={item} last={i === filtered.length - 1} />)
      )}
    </>
  );
}

function NotifRow({ item, last }) {
  const isReceipt       = item._kind === 'receipt';
  const isReview        = item._kind === 'review_request';
  const isOnlineBooking = item.changeType === 'online_booking';
  const meta      = isReceipt       ? NOTIF_META.receipt
                  : isReview        ? NOTIF_META.review_request
                  : (NOTIF_META[item.changeType] || { icon: '📧', label: item.changeType, color: 'var(--pn-text-muted)' });
  const badge     = statusBadge(item);

  const recipient = (isReceipt || isReview || isOnlineBooking)
    ? `${item.clientName || '—'}${item.clientPhone ? ' · ' + item.clientPhone : item.clientEmail ? ' · ' + item.clientEmail : ''}`
    : `${item.techName || '—'}${item.sentTo ? ` · ${item.sentTo}` : ''}`;

  const description = isReceipt ? `Receipt · $${Number(item.payment?.total || 0).toFixed(2)} via ${item.payment?.method || '—'}`
                    : isReview  ? 'Google review request'
                    : (item.message || item.changeType || '—');

  const ts = item.sentAt || item.createdAt;
  const timeStr = ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 16px', borderBottom: last ? 'none' : '1px solid var(--pn-border)' }}>
      {/* Type icon */}
      <div style={{ width: 32, height: 32, borderRadius: 8, background: meta.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
        {meta.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: meta.color }}>{meta.label}</span>
          <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, fontWeight: 500 }}>
            {badge.label}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--pn-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {recipient}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {description}
        </div>
        {item.error && item.error !== 'no_email' && (
          <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>Error: {item.error}</div>
        )}
      </div>

      {/* Time */}
      <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', flexShrink: 0, textAlign: 'right', paddingTop: 2 }}>{timeStr}</div>
    </div>
  );
}

// ── Tech appointment reminders settings ───────────────────────────────────────
function TechRemindersSection({ settings, updateSettings }) {
  const cfg = settings.techReminders || {};
  const [enabled,  setEnabled]  = useState(cfg.enabled !== false); // default ON
  const [saving,   setSaving]   = useState(false);
  const [savedAt,  setSavedAt]  = useState(null);

  async function save(next) {
    setSaving(true);
    try {
      // Preserve any existing leadMinutes/channel keys for backwards compat
      // (legacy installs that haven't migrated to per-tech yet).
      await updateSettings({
        ...settings,
        techReminders: { ...(settings.techReminders || {}), enabled: next },
      });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2200);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="🔔 Tech Appointment Reminders">
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
          Sends each tech a heads-up before every scheduled appointment. Each tech sets their own lead time and notification channel (email / SMS / push) on their <strong>employee record → Profile → Notifications</strong>. Defaults: 15 min before, email. Runs every 5 minutes server-side; per-appt dedupe.
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled}
            onChange={e => { setEnabled(e.target.checked); save(e.target.checked); }} disabled={saving} />
          <span style={{ fontSize: 13, color: 'var(--pn-text-muted)', fontWeight: 600 }}>Enabled</span>
          <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>· tenant-wide on/off switch</span>
          {savedAt && <span style={{ fontSize: 12, color: '#22c55e', marginLeft: 'auto' }}>✓ Saved</span>}
        </label>
      </div>
    </Section>
  );
}

// ── Cancellation Policy ───────────────────────────────────────────────────
// After N cancellations in M days, the booking flow requires the client to
// have a card on file before they can book again. Tenant-wide opt-in;
// per-client admin override available in the client modal.
//
// Schema lives on settings.cancellationPolicy — see src/lib/cancellationPolicy.js
// for the full evaluator. The booking page (BookingScreen.handleBook) calls
// evaluateCancellationPolicy() before allowing a new appointment.
function CancellationPolicySection({ settings, updateSettings }) {
  const cfg = settings.cancellationPolicy || {};
  const [enabled,        setEnabled]        = useState(cfg.enabled === true);
  const [thresholdCount, setThresholdCount] = useState(cfg.thresholdCount ?? 3);
  const [windowDays,     setWindowDays]     = useState(cfg.windowDays     ?? 90);
  const [countNoShows,   setCountNoShows]   = useState(cfg.countNoShows !== false);
  const [saving,         setSaving]         = useState(false);
  const [savedAt,        setSavedAt]        = useState(null);

  async function save(patch) {
    setSaving(true);
    try {
      const next = {
        enabled,
        thresholdCount: Math.max(1, Math.floor(Number(thresholdCount) || 3)),
        windowDays:     Math.max(1, Math.floor(Number(windowDays)     || 90)),
        countNoShows,
        ...patch,
      };
      await updateSettings({ ...settings, cancellationPolicy: next });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2200);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="🚫 Cancellation Policy">
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
          After this many cancellations within the window, the booking page will require the client to have a card on file before they can book again. Clients who already have a card on file aren't affected. Admins can override per-client in the client modal.
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', cursor: 'pointer', marginBottom: 10 }}>
          <input type="checkbox" checked={enabled}
            onChange={e => { setEnabled(e.target.checked); save({ enabled: e.target.checked }); }} disabled={saving} />
          <span style={{ fontSize: 13, color: 'var(--pn-text-muted)', fontWeight: 600 }}>Enable policy</span>
          {savedAt && <span style={{ fontSize: 12, color: '#22c55e', marginLeft: 'auto' }}>✓ Saved</span>}
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? 'auto' : 'none' }}>
          <label style={{ fontSize: 12, color: 'var(--pn-text-muted)', display: 'block' }}>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>Threshold</div>
            <input
              type="number" min={1} step={1}
              value={thresholdCount}
              onChange={e => setThresholdCount(e.target.value)}
              onBlur={() => save({ thresholdCount: Math.max(1, Math.floor(Number(thresholdCount) || 3)) })}
              disabled={saving}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--pn-border)', fontSize: 13, fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2 }}>cancellations</div>
          </label>
          <label style={{ fontSize: 12, color: 'var(--pn-text-muted)', display: 'block' }}>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>Window</div>
            <input
              type="number" min={1} step={1}
              value={windowDays}
              onChange={e => setWindowDays(e.target.value)}
              onBlur={() => save({ windowDays: Math.max(1, Math.floor(Number(windowDays) || 90)) })}
              disabled={saving}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--pn-border)', fontSize: 13, fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2 }}>days back</div>
          </label>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginTop: 10, fontSize: 12, color: 'var(--pn-text-muted)', cursor: 'pointer', opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? 'auto' : 'none' }}>
          <input type="checkbox" checked={countNoShows}
            onChange={e => { setCountNoShows(e.target.checked); save({ countNoShows: e.target.checked }); }} disabled={saving} />
          Also count <strong style={{ margin: '0 2px' }}>no-shows</strong> toward the threshold (recommended)
        </label>

        <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 12, lineHeight: 1.5 }}>
          Salon-initiated cancellations (e.g. tech called in sick) don't count against the client.
        </div>
      </div>
    </Section>
  );
}

// ── Pause / Closure ───────────────────────────────────────────────────────────
// Lets the salon temporarily go offline (vacation, slow season, etc.).
// While paused: inbound SMS gets an auto-reply (mode A, default) OR is
// forwarded to the admin's personal phone for emergencies (mode B, opt-in).
// Pause is enforced server-side in the twilioInboundSms cloud function.
function PauseSection({ settings, updateSettings }) {
  const cfg = settings.pause || {};
  const [until,         setUntil]         = useState(cfg.until || '');
  const [forwardPhone,  setForwardPhone]  = useState(cfg.forwardPhone || '');
  const [customMessage, setCustomMessage] = useState(cfg.customMessage || '');
  const [saving,        setSaving]        = useState(false);
  const [savedAt,       setSavedAt]       = useState(null);

  const today = new Date().toISOString().slice(0, 10);
  const isActive = !!(until && until >= today);

  const friendlyDate = (() => {
    if (!until) return '';
    try {
      return new Date(until + 'T12:00:00').toLocaleDateString('en-US',
        { month: 'long', day: 'numeric', year: 'numeric' });
    } catch { return until; }
  })();
  const defaultPreview = `Thanks for reaching out! We're temporarily closed and will reopen on ${friendlyDate || '[date]'}. Online booking will be available again then. We appreciate your patience!`;
  const livePreview = (customMessage || defaultPreview).replace(/\{date\}/gi, friendlyDate || '[date]');

  async function save() {
    setSaving(true);
    try {
      await updateSettings({
        ...settings,
        pause: {
          until:         until || null,
          forwardPhone:  forwardPhone.trim() || null,
          customMessage: customMessage.trim() || null,
        },
      });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2200);
    } finally {
      setSaving(false);
    }
  }

  async function clearPause() {
    if (!confirm('Resume normal operations now? Inbound SMS will start hitting the regular flow again.')) return;
    setUntil('');
    setSaving(true);
    try {
      await updateSettings({
        ...settings,
        pause: { until: null, forwardPhone: forwardPhone.trim() || null, customMessage: customMessage.trim() || null },
      });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2200);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="⏸️ Pause / Vacation Mode">
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
          Temporarily close the salon (vacation, slow season, renovation, etc.). While paused, inbound texts get an auto-reply that says when you reopen — or, if you opt in, get forwarded to your personal phone so you stay reachable for emergencies.
        </div>

        {isActive && (
          <div style={{
            padding: '10px 12px', marginBottom: 14,
            background: 'var(--pn-warning-bg)', border: '1px solid #fcd34d',
            borderRadius: 8, fontSize: 13, color: 'var(--pn-warning)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
            <div>
              <strong>Currently paused</strong> · resumes <strong>{friendlyDate}</strong>
            </div>
            <button onClick={clearPause} style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: 'var(--pn-surface)', color: 'var(--pn-warning)',
              border: '1px solid #fcd34d', borderRadius: 6, cursor: 'pointer',
            }}>Resume now</button>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4 }}>Closed through (last day closed)</div>
          <input type="date" value={until} min={today} onChange={e => setUntil(e.target.value)}
            style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', outline: 'none' }} />
          <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 4 }}>Leave blank to disable pause. Salon reopens the day after this date.</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4 }}>
            Custom auto-reply <span style={{ color: 'var(--pn-text-faint)' }}>· optional · use {'{date}'} for the resume date</span>
          </div>
          <textarea value={customMessage} onChange={e => setCustomMessage(e.target.value)}
            placeholder={defaultPreview}
            rows={3} maxLength={1500}
            style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        {/* Forward toggle */}
        <details style={{ marginBottom: 12 }}>
          <summary style={{ fontSize: 12, color: '#6a4fa0', fontWeight: 600, cursor: 'pointer', padding: '6px 0' }}>
            ⚙️ Forward inbound to my personal phone instead (emergencies)
          </summary>
          <div style={{ paddingTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
              When set, inbound texts during pause are forwarded to this number instead of getting an auto-reply. Costs ~$0.008/text via Twilio. Leave blank to use the auto-reply (default).
            </div>
            <input type="tel" value={forwardPhone} onChange={e => setForwardPhone(e.target.value)}
              placeholder="+16145551234"
              style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', outline: 'none' }} />
          </div>
        </details>

        {/* Live preview */}
        {until && !forwardPhone && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Auto-reply preview</div>
            <div style={{
              maxWidth: 320,
              padding: '10px 14px',
              background: 'var(--pn-surface)',
              border: '1px solid var(--pn-border)',
              borderRadius: '14px 14px 14px 4px',
              fontSize: 13, color: 'var(--pn-text)', lineHeight: 1.5,
            }}>{livePreview}</div>
          </div>
        )}
        {until && forwardPhone && (
          <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--pn-info-bg)', border: '1px solid #c7dff7', borderRadius: 8, fontSize: 12, color: 'var(--pn-info)' }}>
            ➤ Inbound texts will forward to <code style={{ background: 'var(--pn-surface)', padding: '1px 5px', borderRadius: 3 }}>{forwardPhone}</code>. The client gets no auto-reply.
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Btn color="#6a4fa0" onClick={save}>{saving ? 'Saving…' : (until ? 'Save pause settings' : 'Save')}</Btn>
          {savedAt && <span style={{ fontSize: 12, color: '#22c55e' }}>✓ Saved</span>}
        </div>
      </div>
    </Section>
  );
}

// ── Tile visibility ───────────────────────────────────────────────────────────
// Lets the salon owner hide individual home-screen tiles for features they
// don't use. Plan-locked features (above their tier) are shown as disabled
// with an "Upgrade required" hint — included so they know what's available
// at the next tier without being surprised at billing.
function TileVisibilitySection({ settings, updateSettings }) {
  const plan   = effectivePlan(settings);
  const hidden = new Set(settings?.hiddenTiles || []);
  const [saving, setSaving] = useState(false);

  async function toggle(id) {
    setSaving(true);
    try {
      const next = new Set(hidden);
      if (next.has(id)) next.delete(id); else next.add(id);
      await updateSettings({ ...settings, hiddenTiles: Array.from(next) });
      logActivity('tiles_visibility_changed', `${id} → ${hidden.has(id) ? 'shown' : 'hidden'}`);
    } finally { setSaving(false); }
  }

  const PLAN_LABEL = { starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' };

  return (
    <Section title="🧩 Home Tiles · what shows up on the dashboard">
      <div style={{ padding: '10px 16px 14px' }}>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          Toggle off tiles you don't use to keep the dashboard simple.
          You can turn them back on any time. Greyed-out tiles are part of a
          higher plan — upgrade to unlock.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {MODULES.map(m => {
            const available = isModuleAvailableForPlan(m, plan);
            const isHidden  = hidden.has(m.id);
            const lockedReason = !available ? `Available on ${PLAN_LABEL[m.plan]} plan` : null;
            return (
              <label key={m.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 12px', borderRadius: 10,
                  border: `1px solid ${!available ? 'var(--pn-border)' : isHidden ? 'var(--pn-border)' : '#bfdbfe'}`,
                  background: !available ? 'var(--pn-bg)' : isHidden ? 'var(--pn-surface)' : '#eff6ff',
                  cursor: available ? 'pointer' : 'not-allowed',
                  opacity: available ? 1 : 0.6,
                }}>
                <input type="checkbox"
                  checked={available && !isHidden}
                  disabled={!available || saving}
                  onChange={() => available && toggle(m.id)}
                  style={{ width: 16, height: 16, cursor: available ? 'pointer' : 'not-allowed', accentColor: '#3D95CE', flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: available ? 'var(--pn-text)' : 'var(--pn-text-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {m.label}
                    {!available && (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'var(--pn-warning-bg)', color: 'var(--pn-warning)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                        🔒 {PLAN_LABEL[m.plan]}
                      </span>
                    )}
                    {m.adminOnly && (
                      <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'var(--pn-surface-alt)', color: 'var(--pn-text-muted)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                        Admin only
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                    {lockedReason || m.desc}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        {hidden.size > 0 && (
          <button onClick={() => updateSettings({ ...settings, hiddenTiles: [] })}
            style={{ marginTop: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            Show all tiles ({hidden.size} hidden)
          </button>
        )}
      </div>
    </Section>
  );
}

// ── Module on/off toggles ─────────────────────────────────────────────────────
// Higher-tier features the current plan includes can be turned off here.
// Turning off Memberships is gated server-side (setModuleEnabled) on having
// zero still-billing client memberships — the same teardown the downgrade flow
// enforces — so the owner can't strand recurring client charges.
function ModulesSection() {
  const { settings, setSettings, showToast } = useApp();
  const plan = effectivePlan(settings);
  const [busy, setBusy] = useState('');
  const toggleable = MODULES.filter(m => m.plan !== 'starter' && isModuleAvailableForPlan(m, plan));
  if (toggleable.length === 0) return null;

  async function toggle(m, enable) {
    setBusy(m.id);
    try {
      const res = await callFn('setModuleEnabled', { moduleId: m.id, enabled: enable });
      setSettings(s => ({ ...s, disabledModules: res.disabledModules }));
      logActivity('module_toggled', `${m.id} → ${enable ? 'on' : 'off'}`);
    } catch (e) { showToast(friendlyFnError(e), 4500); }
    finally { setBusy(''); }
  }

  return (
    <Section title="🧩 Modules · turn features on or off">
      <div style={{ padding: '10px 16px 14px' }}>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          Turn off features you don't use. Some need cleanup first — Memberships
          can't be turned off while clients still have active subscriptions.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {toggleable.map(m => {
            const enabled = isModuleEnabled(settings, m.id);
            return (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10,
                border: `1px solid ${enabled ? '#bfdbfe' : 'var(--pn-border)'}`, background: enabled ? '#eff6ff' : 'var(--pn-surface)',
              }}>
                <button onClick={() => toggle(m, !enabled)} disabled={busy === m.id}
                  style={{
                    flexShrink: 0, marginTop: 1, minWidth: 44, padding: '4px 0', borderRadius: 999,
                    border: 'none', fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                    cursor: busy === m.id ? 'wait' : 'pointer',
                    background: enabled ? '#3D95CE' : '#e5e7eb', color: enabled ? '#fff' : '#6b7280',
                  }}>
                  {busy === m.id ? '…' : enabled ? 'On' : 'Off'}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {m.label}
                    {m.adminOnly && (
                      <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'var(--pn-surface-alt)', color: 'var(--pn-text-muted)', letterSpacing: '.04em', textTransform: 'uppercase' }}>Admin only</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.4 }}>{m.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

// ── Notes preferences ─────────────────────────────────────────────────────────
// Single toggle for clinical (SOAP) note format. Off by default — most
// salons (nail, hair, barbershop) capture quick free-form notes.
// Med spas / lash / brow / treatment-heavy shops can opt in to also
// surface the SOAP composer (Subjective / Objective / Assessment / Plan)
// inside appointment + client modals. Existing SOAP-typed entries
// always render; this toggle only controls whether a NEW entry can be
// composed in SOAP format.
function NotesPreferenceSection({ settings, updateSettings }) {
  const enabled = settings?.clinicalNotes === true;
  return (
    <Section title="📋 Notes preferences">
      <div style={{ padding: '10px 16px 14px' }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1px solid ${enabled ? '#c7d2fe' : 'var(--pn-border)'}`, background: enabled ? '#eef2ff' : 'var(--pn-bg)', cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled}
            onChange={e => updateSettings({ ...settings, clinicalNotes: e.target.checked })}
            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#4338ca', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: enabled ? '#3730a3' : '#374151' }}>
              Enable clinical (SOAP) notes
            </div>
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.45 }}>
              Adds a "+ SOAP note" button alongside "+ Add note" inside appointment + client modals. SOAP splits an entry into <strong>Subjective</strong> / <strong>Objective</strong> / <strong>Assessment</strong> / <strong>Plan</strong> — common in med spas, lash, brow, and any treatment-heavy practice. Free-form notes work the same regardless.
            </div>
          </div>
        </label>
      </div>
    </Section>
  );
}

// ── Chargeback / dispute list ─────────────────────────────────────────────
// Surfaces open disputes urgently (red, deadline countdown, Stripe Dashboard
// link) and shows closed disputes as history. Tenants get the same Stripe
// email when a dispute opens, but the email is easy to miss — this section
// is a persistent reminder until the dispute closes. Section renders nothing
// when there are zero disputes (no clutter for the common case).
function DisputesSection() {
  const [disputes, setDisputes] = useState(null);   // null = loading, [] = empty
  const [error,    setError]    = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchDisputes()
      .then(rows => { if (!cancelled) setDisputes(rows); })
      .catch(e   => { if (!cancelled) { setError(e.message); setDisputes([]); } });
    return () => { cancelled = true; };
  }, []);

  if (disputes === null) return null;     // first fetch in flight; UpgradeSection covers the empty state
  if (disputes.length === 0) return null; // nothing to show — keep the UI clean

  const isOpen = d => d.status === 'needs_response' || d.status === 'warning_needs_response' || d.status === 'under_review' || d.status === 'warning_under_review';
  const open    = disputes.filter(isOpen);
  const closed  = disputes.filter(d => !isOpen(d));

  return (
    <Section title={`⚠ Chargebacks${open.length ? ` (${open.length} open)` : ''}`} defaultOpen={open.length > 0}>
      <div style={{ padding: '14px 16px' }}>
        {error && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{error}</div>}
        {open.length > 0 && (
          <div style={{ marginBottom: closed.length ? 18 : 0 }}>
            <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Action required</div>
            {open.map(d => <DisputeRow key={d.id} d={d} variant="open" />)}
          </div>
        )}
        {closed.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>History</div>
            {closed.map(d => <DisputeRow key={d.id} d={d} variant="closed" />)}
          </div>
        )}
      </div>
    </Section>
  );
}

function DisputeRow({ d, variant }) {
  const amount  = (d.amount / 100).toFixed(2);
  const dueDate = d.evidenceDueBy ? new Date(d.evidenceDueBy) : null;
  const daysLeft = dueDate ? Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const urgent   = variant === 'open' && daysLeft != null && daysLeft <= 3;
  const wonOrLost = d.status === 'won' ? 'won' : d.status === 'lost' ? 'lost' : null;

  const border = variant === 'open'
    ? (urgent ? '2px solid #ef4444' : '1px solid #fed7aa')
    : '1px solid var(--pn-border)';
  const bg = variant === 'open'
    ? (urgent ? 'var(--pn-danger-bg)' : 'var(--pn-warning-bg)')
    : (wonOrLost === 'won' ? 'var(--pn-success-bg)' : wonOrLost === 'lost' ? 'var(--pn-danger-bg)' : 'var(--pn-bg)');
  const statusColor = wonOrLost === 'won' ? 'var(--pn-success)' : wonOrLost === 'lost' ? 'var(--pn-danger)' : (urgent ? 'var(--pn-danger)' : 'var(--pn-warning)');

  const stripeUrl = `https://dashboard.stripe.com/disputes/${d.disputeId}`;

  return (
    <div style={{ border, background: bg, borderRadius: 10, padding: '12px 14px', marginBottom: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--pn-text)' }}>${amount} {(d.currency || 'usd').toUpperCase()}</span>
          <span style={{ fontSize: 11, color: statusColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {wonOrLost === 'won' && '✓ Won'}
            {wonOrLost === 'lost' && '✗ Lost'}
            {!wonOrLost && variant === 'open' && (urgent ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'open')}
            {!wonOrLost && variant === 'closed' && (d.status || 'closed')}
          </span>
          {d.isMembership && (
            <span style={{ fontSize: 10, background: '#e0e7ff', color: '#3730a3', padding: '2px 6px', borderRadius: 4, fontWeight: 700, letterSpacing: 0.5 }}>MEMBER</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 4, lineHeight: 1.5 }}>
          <strong>Reason:</strong> {d.reason || 'not provided'}
          {d.isMembership && d.clientName && <> · <strong>Client:</strong> {d.clientName}</>}
        </div>
        {variant === 'open' && dueDate && (
          <div style={{ fontSize: 11, color: statusColor, marginTop: 4, fontWeight: 600 }}>
            Evidence due {dueDate.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        )}
        {variant === 'closed' && d.updatedAt && (
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 4 }}>
            Closed {new Date(d.updatedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}
          </div>
        )}
      </div>
      <a href={stripeUrl} target="_blank" rel="noreferrer"
        style={{
          flexShrink: 0,
          background: variant === 'open' ? '#ef4444' : 'var(--pn-surface)',
          color: variant === 'open' ? '#fff' : 'var(--pn-text-muted)',
          border: variant === 'open' ? 'none' : '1px solid var(--pn-border)',
          borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600,
          textDecoration: 'none', whiteSpace: 'nowrap',
        }}>
        {variant === 'open' ? 'Submit evidence →' : 'View in Stripe →'}
      </a>
    </div>
  );
}

// ── Plan & Billing ────────────────────────────────────────────────────────────
// Lazy callable invoker (matches the dynamic-import pattern used elsewhere
// in this file so firebase/functions isn't pulled into the initial bundle).
async function callFn(name, data) {
  const { httpsCallable } = await import('firebase/functions');
  const { functions }     = await import('../../lib/firebase');
  const res = await httpsCallable(functions, name)(data || {});
  return res.data;
}

// HttpsError messages from our gated callables are JSON.stringify({message,...});
// surface the human message, falling back to the raw text.
function friendlyFnError(e) {
  const msg = e?.message || 'Something went wrong';
  try { const p = JSON.parse(msg); if (p && p.message) return p.message; } catch { /* plain message */ }
  return msg;
}

const PLAN_TIERS = [
  {
    id:      'starter',
    label:   'Starter',
    price:   '$19/mo',
    color:   '#888',
    features:['Schedule & appointments', 'Clients & profiles', 'Services menu', 'Employees', 'Walk-in kiosk'],
  },
  {
    id:      'studio',
    label:   'Studio',
    price:   '$49/mo',
    color:   '#3D9E8A',
    features:['Everything in Starter', 'Reports & analytics', 'Earnings dashboard', 'Gift cards & promos', 'Retail inventory', 'Attendance tracking'],
  },
  {
    id:      'pro',
    label:   'Pro',
    price:   '$149/mo',
    color:   '#2563eb',
    features:['Everything in Studio', 'SMS + email comms', 'Marketing campaigns', 'HR & payroll (Gusto)', 'Membership subscriptions', 'AI chatbot on webfront'],
  },
];

// Stripe Connect status + onboarding entry point for the Settings tab. The
// full onboarding flow (Express/Standard picker + embedded form) lives in the
// wizard's Money phase; this surfaces live status and deep-links there, so a
// salon can set up / manage payments without hunting for the wizard. Card
// checkout is gated on chargesEnabled, so this is the place that unblocks it.
function StripeConnectSection({ onOpenWizard }) {
  const { settings, updateSettings } = useApp();
  const sc = settings?.stripeConnect || null;
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const data = await callFn('getStripeConnectStatus', { tenantId: TENANT_ID });
      if (data?.status) {
        const s = data.status;
        await updateSettings({ ...settings, stripeConnect: {
          accountId: s.accountId, accountType: s.accountType,
          chargesEnabled: s.chargesEnabled, payoutsEnabled: s.payoutsEnabled,
          detailsSubmitted: s.detailsSubmitted, businessName: s.businessName,
          statementDescriptor: s.statementDescriptor,
          requirementsCurrentlyDue: s.requirementsCurrentlyDue, updatedAt: s.updatedAt,
        } });
      } else if (data && data.connected === false && sc) {
        const next = { ...settings }; delete next.stripeConnect; await updateSettings(next);
      }
    } catch { /* keep cached status */ }
    finally { setRefreshing(false); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const connected = !!sc?.accountId;
  const live      = !!(sc?.chargesEnabled && sc?.payoutsEnabled);
  const dueCount  = sc?.requirementsCurrentlyDue?.length || 0;
  const needsMore = connected && (!live || dueCount > 0 || !sc?.detailsSubmitted);
  const badge = !connected ? { t: 'Not set up',      bg: 'var(--pn-surface-alt)', fg: 'var(--pn-text-muted)' }
              : live       ? { t: 'Active',          bg: 'var(--pn-success-bg)', fg: 'var(--pn-success)' }
              :              { t: 'Setup incomplete', bg: 'var(--pn-warning-bg)', fg: 'var(--pn-warning)' };

  return (
    <Section title="💸 Payments · Stripe Connect">
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 6, background: badge.bg, color: badge.fg, textTransform: 'uppercase', letterSpacing: '.04em' }}>{badge.t}</span>
            {refreshing && <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>checking…</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 6, lineHeight: 1.5, maxWidth: 440 }}>
            {!connected
              ? 'Connect a Stripe account so card payments settle to your bank — required before you can take cards at checkout.'
              : live
              ? `Accepting card payments${sc.accountType ? ` · ${sc.accountType} account` : ''}. Funds settle to your Stripe.`
              : `Your Stripe account needs a few more details before it can accept cards${dueCount ? ` (${dueCount} item${dueCount === 1 ? '' : 's'} due)` : ''}.`}
          </div>
        </div>
        <button onClick={() => onOpenWizard?.('money')}
          style={{ background: live ? '#fff' : '#635bff', color: live ? '#635bff' : '#fff', border: live ? '1px solid #d8d0f0' : 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          {!connected ? 'Set up payments →' : needsMore ? 'Finish setup →' : 'Manage →'}
        </button>
      </div>
    </Section>
  );
}

function UpgradeSection({ settings, gUser }) {
  const [loading, setLoading] = useState('');   // plan id currently loading
  const [error,   setError]   = useState('');
  // The stored plan (what they're nominally on or trialling) — distinct
  // from the effectivePlan (which downgrades to starter when trial
  // expires without payment).
  const { showToast, setSettings } = useApp();
  const [downgradeTarget, setDowngradeTarget] = useState(null); // tier object or null
  const storedPlan    = settings.plan || 'starter';
  const visiblePlan   = effectivePlan(settings);
  const inTrial       = isInTrial(settings);
  const trialDays     = trialDaysRemaining(settings);
  const hasPaidSubscription = !!settings.stripeSubscriptionId;

  async function handleCheckout(planId) {
    setLoading(planId); setError('');
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions }     = await import('../../lib/firebase');
      const fn  = httpsCallable(functions, 'createCheckoutSession');
      const res = await fn({ plan: planId });
      if (res.data?.url) window.location.href = res.data.url;
    } catch (e) { setError(e.message); }
    finally { setLoading(''); }
  }

  // Upgrade an existing paid subscription in-app (immediate, prorated). Falls
  // back to checkout if there's no live subscription yet (trial / new tenant).
  async function handleUpgrade(tier) {
    setLoading(tier.id); setError('');
    try {
      const res = await callFn('changeTenantPlan', { targetPlan: tier.id });
      if (res?.needsCheckout) { await handleCheckout(tier.id); return; }
      if (res?.ok) { setSettings(s => ({ ...s, plan: tier.id })); showToast(`Now on ${tier.label}`); }
    } catch (e) { setError(friendlyFnError(e)); }
    finally { setLoading(''); }
  }

  async function handleManageBilling() {
    setLoading('portal'); setError('');
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions }     = await import('../../lib/firebase');
      const fn  = httpsCallable(functions, 'createTenantBillingPortal');
      const res = await fn({});
      if (res.data?.url) window.location.href = res.data.url;
    } catch (e) { setError(e.message); }
    finally { setLoading(''); }
  }

  const currentTier = PLAN_TIERS.find(t => t.id === visiblePlan) || PLAN_TIERS[0];

  return (
    <Section title="💳 Plan &amp; Billing">
      <div style={{ padding: '14px 16px' }}>
        {/* Current plan + trial banner */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>Current plan</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: currentTier.color, marginTop: 2 }}>{currentTier.label}</div>
          </div>
          {hasPaidSubscription && (
            <button onClick={handleManageBilling} disabled={loading === 'portal'}
              style={{ background: 'var(--pn-surface)', color: '#3D95CE', border: '1px solid #d4e5f3', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: loading === 'portal' ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {loading === 'portal' ? 'Loading…' : 'Manage billing →'}
            </button>
          )}
        </div>

        {inTrial && (
          <div style={{ background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--pn-warning)' }}>
            <strong>{trialDays} {trialDays === 1 ? 'day' : 'days'} left</strong> in your Pro trial. Pick a plan below to continue uninterrupted — no charge until the trial ends.
          </div>
        )}

        {settings.cancelAtPeriodEnd && settings.currentPeriodEnd && (
          <div style={{ background: 'var(--pn-danger-bg)', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--pn-danger)' }}>
            <strong>Your subscription is set to cancel on {new Date(settings.currentPeriodEnd).toLocaleDateString()}.</strong> Click <em>Manage billing</em> above to keep it active.
          </div>
        )}

        {settings.subscriptionStatus === 'past_due' && (
          <div style={{ background: 'var(--pn-warning-bg)', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--pn-warning)' }}>
            <strong>Payment past due.</strong> Update your card via <em>Manage billing</em> to avoid losing access.
          </div>
        )}

        {/* 3-tier picker */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {PLAN_TIERS.map(tier => {
            const isCurrent = tier.id === storedPlan && !inTrial && (tier.id === 'starter' ? !hasPaidSubscription : hasPaidSubscription);
            const isLoading = loading === tier.id;
            // No paid sub yet (trial / new tenant): every non-current tier is a
            // checkout. With a live subscription: compare rank → in-app upgrade
            // (immediate) or guarded downgrade (opens the teardown modal).
            const rankDelta = PLAN_RANK[tier.id] - PLAN_RANK[storedPlan];
            const action = isCurrent ? null
              : (!hasPaidSubscription || inTrial) ? 'checkout'
              : rankDelta > 0 ? 'upgrade'
              : 'downgrade';
            return (
              <div key={tier.id}
                style={{
                  border: isCurrent ? `2px solid ${tier.color}` : '1px solid var(--pn-border)',
                  borderRadius: 12, padding: 12, background: isCurrent ? '#fafdff' : 'var(--pn-surface)',
                  display: 'flex', flexDirection: 'column', gap: 8, position: 'relative',
                }}>
                {isCurrent && (
                  <div style={{ position: 'absolute', top: -10, right: 12, background: tier.color, color: '#fff', fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 8, letterSpacing: 0.5 }}>
                    CURRENT
                  </div>
                )}
                <div style={{ fontSize: 14, fontWeight: 700, color: tier.color }}>{tier.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pn-text)' }}>{tier.price}</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0', fontSize: 11, color: 'var(--pn-text-muted)', lineHeight: 1.7, flex: 1 }}>
                  {tier.features.map(f => <li key={f}>✓ {f}</li>)}
                </ul>
                {action && (
                  <button
                    onClick={() => action === 'checkout' ? handleCheckout(tier.id)
                                 : action === 'upgrade'  ? handleUpgrade(tier)
                                 : setDowngradeTarget(tier)}
                    disabled={isLoading}
                    style={{
                      background: isLoading ? '#ccc' : action === 'downgrade' ? 'var(--pn-surface)' : tier.color,
                      color: action === 'downgrade' ? 'var(--pn-text-muted)' : '#fff',
                      border: action === 'downgrade' ? '1px solid var(--pn-border-strong)' : 'none',
                      borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600,
                      cursor: isLoading ? 'wait' : 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
                    {isLoading ? 'Working…'
                      : action === 'checkout' ? `Choose ${tier.label}`
                      : action === 'upgrade'  ? `Upgrade to ${tier.label}`
                      : `Downgrade to ${tier.label}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {error && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 10 }}>{error}</div>}
      </div>

      {downgradeTarget && (
        <DowngradeModal
          tier={downgradeTarget}
          currentPlan={storedPlan}
          onClose={() => setDowngradeTarget(null)}
          onDone={() => { setSettings(s => ({ ...s, plan: downgradeTarget.id })); showToast(`Now on ${downgradeTarget.label}`); setDowngradeTarget(null); }}
        />
      )}
    </Section>
  );
}

// Guided teardown for a downgrade. Reads readiness from changeTenantPlan
// (dryRun) and lets the owner clear each blocker inline — cancel each still-
// billing membership, turn off each higher-tier module — before confirming.
function DowngradeModal({ tier, currentPlan, onClose, onDone }) {
  const { setSettings, showToast } = useApp();
  const [blockers, setBlockers] = useState(null); // null = loading
  const [members,  setMembers]  = useState([]);    // active memberships when blocked
  const [busy,     setBusy]     = useState('');
  const [error,    setError]    = useState('');

  async function refresh() {
    setError('');
    try {
      const res = await callFn('changeTenantPlan', { targetPlan: tier.id, dryRun: true });
      const b = res?.blockers || [];
      setBlockers(b);
      if (b.some(x => x.moduleId === 'memberships')) {
        const all = await fetchMemberships();
        setMembers(all.filter(m => ['active', 'past_due', 'paused', 'trialing'].includes(String(m.status || '').toLowerCase())));
      } else { setMembers([]); }
    } catch (e) { setError(friendlyFnError(e)); setBlockers([]); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  async function turnOff(moduleId) {
    setBusy(moduleId); setError('');
    try {
      const res = await callFn('setModuleEnabled', { moduleId, enabled: false });
      setSettings(s => ({ ...s, disabledModules: res.disabledModules }));
      await refresh();
    } catch (e) { setError(friendlyFnError(e)); }
    finally { setBusy(''); }
  }

  async function cancelMember(id) {
    setBusy(id); setError('');
    try { await callFn('cancelMembership', { membershipId: id }); await refresh(); }
    catch (e) { setError(friendlyFnError(e)); }
    finally { setBusy(''); }
  }

  async function confirmDowngrade() {
    setBusy('confirm'); setError('');
    try {
      const res = await callFn('changeTenantPlan', { targetPlan: tier.id });
      if (res?.needsCheckout) { setError('No active subscription to change. Use Manage billing.'); return; }
      if (res?.ok) onDone();
    } catch (e) { setError(friendlyFnError(e)); await refresh(); }
    finally { setBusy(''); }
  }

  const ready = blockers !== null && blockers.length === 0;
  const memBlocker = (blockers || []).find(b => b.moduleId === 'memberships');
  const moduleBlockers = (blockers || []).filter(b => b.moduleId !== 'memberships');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--pn-surface)', borderRadius: 14, maxWidth: 520, width: '100%', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--pn-border)' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--pn-text)' }}>Downgrade to {tier.label}</div>
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 3 }}>
            These features aren't on {tier.label}. Turn them off — and cancel any active memberships — before downgrading. Data stays saved and returns if you upgrade again.
          </div>
        </div>
        <div style={{ padding: 18 }}>
          {blockers === null ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13 }}>Checking…</div>
          ) : ready ? (
            <div style={{ background: 'var(--pn-success-bg)', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: 'var(--pn-success)' }}>
              ✓ Everything's clear. You can downgrade to {tier.label} now.
            </div>
          ) : (
            <>
              {memBlocker && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#991b1b', marginBottom: 6 }}>
                    Memberships — {memBlocker.count} still billing
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 8 }}>Cancel each client's subscription. This stops their recurring charge in Stripe.</div>
                  {members.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', border: '1px solid #fee2e2', borderRadius: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 12 }}>
                        <div style={{ fontWeight: 600, color: 'var(--pn-text)' }}>{m.clientName || 'Member'}</div>
                        <div style={{ color: 'var(--pn-text-faint)', fontSize: 11 }}>{m.planName} · ${Number(m.price || 0).toFixed(0)}/{m.billingPeriod === 'yearly' ? 'yr' : 'mo'}</div>
                      </div>
                      <button onClick={() => cancelMember(m.id)} disabled={!!busy}
                        style={{ background: busy === m.id ? '#ccc' : '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                        {busy === m.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {moduleBlockers.map(b => (
                <div key={b.moduleId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: '1px solid var(--pn-border)', borderRadius: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 13 }}>
                    <div style={{ fontWeight: 600, color: 'var(--pn-text)' }}>{b.label}</div>
                    <div style={{ color: 'var(--pn-text-faint)', fontSize: 11 }}>{b.reason}</div>
                  </div>
                  <button onClick={() => turnOff(b.moduleId)} disabled={!!busy}
                    style={{ background: busy === b.moduleId ? '#ccc' : '#6b7280', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                    {busy === b.moduleId ? 'Turning off…' : 'Turn off'}
                  </button>
                </div>
              ))}
            </>
          )}
          {error && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 10 }}>{error}</div>}
        </div>
        <div style={{ padding: '14px 18px', borderTop: '1px solid var(--pn-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={confirmDowngrade} disabled={!ready || busy === 'confirm'}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: ready ? tier.color : '#d1d5db', color: '#fff', fontSize: 13, fontWeight: 700, cursor: ready && busy !== 'confirm' ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            {busy === 'confirm' ? 'Downgrading…' : `Downgrade to ${tier.label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tenant management (super-admin only) ─────────────────────────────────────
const PLANS = ['starter', 'studio', 'pro', 'enterprise'];

// ── Integrity badge ──────────────────────────────────────────────────────
// Reads tenants/{id}/data/integrityReport (written nightly by the
// runIntegrityScan cron) and renders green/yellow/red. Click for details.
// Read-only — admin can't fake a green badge (rules deny client writes).
function IntegrityBadge({ onJumpToTrash }) {
  const [report,   setReport]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [open,     setOpen]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchIntegrityReport()
      .then(r => { if (!cancelled) { setReport(r); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;

  const overall = report?.overall || 'gray';
  const colors = {
    green:  { bg: 'var(--pn-success-bg)', fg: 'var(--pn-success)', label: '✓' },
    yellow: { bg: 'var(--pn-warning-bg)', fg: 'var(--pn-warning)', label: '⚠' },
    red:    { bg: 'var(--pn-danger-bg)',  fg: 'var(--pn-danger)',  label: '⚠' },
    gray:   { bg: 'var(--pn-surface-alt)', fg: 'var(--pn-text-muted)',    label: '?' },
  };
  const c = colors[overall] || colors.gray;
  const title = report
    ? `Integrity: ${overall.toUpperCase()} (last scan ${new Date(report.ranAt).toLocaleString()})`
    : 'Integrity: no scan yet (runs nightly)';

  return (
    <>
      <button onClick={() => setOpen(true)} title={title}
        style={{ height: 28, padding: '0 9px', borderRadius: 14, border: `1px solid ${c.fg}33`, background: c.bg, color: c.fg, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
        {c.label} health
      </button>
      {open && (
        <IntegrityReportModal report={report} onClose={() => setOpen(false)} onJumpToTrash={onJumpToTrash} />
      )}
    </>
  );
}

function IntegrityReportModal({ report, onClose, onJumpToTrash }) {
  if (!report) {
    return (
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div onClick={e => e.stopPropagation()}
          style={{ background: 'var(--pn-surface)', borderRadius: 14, width: '100%', maxWidth: 480, padding: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Integrity report</div>
          <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', lineHeight: 1.5 }}>
            No scan has run yet. The <code>runIntegrityScan</code> cron runs nightly at 4am ET and writes a report doc the next morning.
          </div>
          <button onClick={onClose} style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
        </div>
      </div>
    );
  }
  const checks = report.checks || {};
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--pn-surface)', borderRadius: 14, width: '100%', maxWidth: 600, maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Integrity report — {report.overall?.toUpperCase()}</div>
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2 }}>Scanned {new Date(report.ranAt).toLocaleString()}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--pn-text-muted)' }}>×</button>
        </div>
        <div style={{ padding: '12px 20px' }}>
          <IntegrityCheckRow name="data/usersFull sync" check={checks.usersFullSync} renderDetail={c => `${c.staffEmails} staff in slim projection, ${c.usersFullStaff} in rich array`} />
          <IntegrityCheckRow name="Orphaned appointments" check={checks.orphanedAppointments} renderDetail={c => `${c.orphaned}/${c.total} (${c.pct}%) reference missing clients`} sampleKey="apptId" />
          <IntegrityCheckRow name="Orphaned receipts" check={checks.orphanedReceipts} renderDetail={c => `${c.orphaned}/${c.total} (${c.pct}%) reference missing appointments`} sampleKey="receiptId" />
          <IntegrityCheckRow name="Employees without comp" check={checks.employeesWithoutComp} renderDetail={c => `${c.missing}/${c.total} (${c.pct}%) active employees missing tax/payroll info`} sampleKey="name" />
          <IntegrityCheckRow name="Stale tombstones" check={checks.staleTombstones} renderDetail={c => c.total === 0 ? 'All purged on schedule' : `${c.total} tombstones older than 35 days — purge cron may not be running`} />
          <div style={{ marginTop: 16, padding: 10, fontSize: 11, color: 'var(--pn-text-muted)', background: 'var(--pn-bg)', borderRadius: 8, lineHeight: 1.55 }}>
            For specific deleted records, use the <button onClick={() => { onClose(); onJumpToTrash?.(); }} style={{ background: 'none', border: 'none', color: '#3D95CE', cursor: 'pointer', padding: 0, font: 'inherit' }}>Trash tab</button> or each detail view's ⏳ History button. Scanner runs nightly at 4am ET.
          </div>
        </div>
      </div>
    </div>
  );
}

function IntegrityCheckRow({ name, check, renderDetail, sampleKey }) {
  if (!check) return null;
  const colors = {
    green:  { bg: 'var(--pn-success-bg)', fg: 'var(--pn-success)' },
    yellow: { bg: 'var(--pn-warning-bg)', fg: 'var(--pn-warning)' },
    red:    { bg: 'var(--pn-danger-bg)',  fg: 'var(--pn-danger)'  },
  };
  const c = colors[check.status] || colors.green;
  return (
    <div style={{ padding: '10px 12px', marginBottom: 8, background: c.bg, borderRadius: 8, border: `1px solid ${c.fg}33` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{name}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: c.fg, textTransform: 'uppercase' }}>{check.status}</div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 4 }}>
        {check.error ? `Error: ${check.error}` : (renderDetail ? renderDetail(check) : JSON.stringify(check))}
      </div>
      {check.sample && check.sample.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--pn-text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
          Sample: {check.sample.slice(0, 5).map(s => sampleKey ? s[sampleKey] : s.apptId || s.receiptId || s.empId || s.name).filter(Boolean).join(', ')}
        </div>
      )}
    </div>
  );
}

function PlanBadge({ p }) {
  const colors = { starter: ['var(--pn-success-bg)','var(--pn-success)'], pro: ['var(--pn-info-bg)','var(--pn-info)'], enterprise: ['#faf5ff','#7c3aed'] };
  const [bg, c] = colors[p] || ['var(--pn-surface-alt)','var(--pn-text-muted)'];
  return <span style={{ background: bg, color: c, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, textTransform: 'uppercase' }}>{p}</span>;
}

// The trash/restore UI now lives in the reusable <TrashPanel> component
// (src/components/TrashPanel.jsx) so the calendar + each module can embed a
// scoped copy. The Admin tab renders <TrashPanel /> with no collections
// filter (the global, all-collections view).

