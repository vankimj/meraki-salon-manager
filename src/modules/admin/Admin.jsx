import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { CORE_THEMES, HOLIDAY_THEMES, detectAutoTheme } from '../../lib/themes';
import { fetchLogs, fetchEmployees, createEmployee, saveEmployee,
         fetchFeedback, updateFeedbackStatus,
         fetchNotificationCenter,
         fetchAllForBackup, restoreFromBackup,
         fetchBookingConfig, saveBookingConfig,
         fetchWebfrontConfig, saveWebfrontConfig,
         fetchReviewReceived, fetchReviewRequests,
         saveReviewReceived,
         fetchTenants, createTenantRecord, updateTenantRecord,
         provisionNewTenant, fetchTenantStats } from '../../lib/firestore';
import { formatTime } from '../../utils/helpers';
import { logActivity } from '../../lib/logger';
import { seedDemoData, clearDemoData, addFutureAppointments } from '../../data/seedDemo';
import { seedProducts, clearSeedProducts } from '../../data/seedProducts';
import FeedbackModal from '../../components/FeedbackModal';

export default function Admin({ onClose }) {
  const { gUser, users, settings, grantAccess, grantPendingAccess, loadPendingRequests, updateSettings, signOut, isAdmin, syncState } = useApp();
  const [timeout,        setTimeoutVal]    = useState(settings.timeoutMin || 5);
  const [pin,            setPin]           = useState(settings.adminPin || '');
  const [reviewUrl,      setReviewUrl]     = useState(settings.googleReviewUrl || '');
  const [ein,            setEin]           = useState(settings.ein || '');
  const [autoBirthday,   setAutoBirthday]  = useState(!!settings.autoBirthday);
  const [autoLapsed,     setAutoLapsed]    = useState(!!settings.autoLapsed);
  const [autoLapsedDays, setAutoLapsedDays]= useState(settings.autoLapsedDays || 60);
  const [autoSaving,     setAutoSaving]    = useState(false);
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
  const [tab,          setTab]          = useState('users');
  const [showFeedback, setShowFeedback] = useState(false);
  const [webfrontCfg,  setWebfrontCfg] = useState(null);
  const [reviewsData,  setReviewsData]  = useState(null);
  const [tenants,      setTenants]      = useState(null);
  const isSuperAdmin = gUser?.email === 'jvankim@gmail.com';
  const TABS = [
    { id: 'users',    label: 'Users'    },
    { id: 'notifs',   label: 'Notifs'   },
    { id: 'reviews',  label: 'Reviews'  },
    { id: 'settings', label: 'Settings' },
    { id: 'webfront', label: 'Webfront' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'logs',     label: 'Logs'     },
    ...(isSuperAdmin ? [{ id: 'tenants', label: 'Tenants' }] : []),
  ];

  useEffect(() => { if (tab === 'settings' && !bookingCfg) fetchBookingConfig().then(setBookingCfg).catch(() => {}); }, [tab]); // eslint-disable-line
  useEffect(() => { if (tab === 'webfront' && !webfrontCfg) fetchWebfrontConfig().then(wf => setWebfrontCfg({ tagline: '', about: '', phone: '', address: '', mapsUrl: '', instagram: '', facebook: '', tiktok: '', hours: {}, showBookingCta: true, showServices: true, showTeam: true, hiddenEmployeeIds: [], ...wf })).catch(() => {}); }, [tab]); // eslint-disable-line
  useEffect(() => { if (tab === 'logs')     loadLogs(); },     [tab]);
  useEffect(() => { if (tab === 'feedback') loadFeedback(); }, [tab]); // eslint-disable-line
  useEffect(() => { if (tab === 'notifs')   loadNotifs(); },   [tab]); // eslint-disable-line
  useEffect(() => { if (tab === 'reviews')  loadReviews(); },  [tab]); // eslint-disable-line
  useEffect(() => { if (tab === 'tenants' && isSuperAdmin) loadTenants(); }, [tab]); // eslint-disable-line
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

  async function loadTenants() {
    setTenants(null);
    try { setTenants(await fetchTenants()); }
    catch { setTenants([]); }
  }

  async function handleFeedbackStatus(id, status) {
    await updateFeedbackStatus(id, status);
    setFeedback(fb => fb.map(f => f.id === id ? { ...f, status } : f));
  }

  if (!isAdmin) return null;

  const others = users.filter(u => u.role !== 'pending');

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#f5f5f5', zIndex: 50, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #ebebeb', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button onClick={onClose}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#3D95CE', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '8px 6px', borderRadius: 6, flexShrink: 0, minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Home
        </button>
        <span style={{ color: '#e0e0e0', fontSize: 16, flexShrink: 0 }}>›</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 16 }}>⚙</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>Admin</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: { syncing: '#f59e0b', ok: '#22c55e', err: '#ef4444', idle: '#ddd' }[syncState] || '#ddd', transition: 'background .3s', animation: syncState === 'syncing' ? 'pulse .8s infinite' : 'none' }} />
          <button onClick={() => setShowFeedback(true)}
            style={{ height: 34, borderRadius: 20, border: 'none', background: '#EBF5FF', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: '0 13px', fontSize: 12, fontWeight: 600, color: '#1a5f8a', fontFamily: 'inherit' }}>
            <span style={{ fontSize: 15 }}>💬</span> Feedback
          </button>
          {gUser?.photoURL && <img src={gUser.photoURL} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />}
        </div>
      </div>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e8e8e8', background: '#fff', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '10px 0', fontSize: 11, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? '#3D95CE' : '#888', background: 'none', border: 'none', borderBottom: tab === t.id ? '2px solid #3D95CE' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
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
            <Section title="👥 Users">
              {others.length ? others.map(u => (
                <UserRow key={u.email} user={u}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <select value={u.role} onChange={e => grantAccess(u.email, e.target.value, u.techName)}
                      style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', fontFamily: 'inherit' }}>
                      <option value="readonly">Read only</option>
                      <option value="tech">Tech</option>
                      <option value="scheduler">Scheduler</option>
                      <option value="admin">Admin</option>
                      <option value="denied">Denied</option>
                    </select>
                    {u.role === 'tech' && (
                      <select value={u.techName || ''} onChange={async e => {
                        const newTechName = e.target.value;
                        grantAccess(u.email, 'tech', newTechName);
                        const emp = employees.find(ex => ex.name === newTechName);
                        if (emp) await saveEmployee(emp.id, { email: u.email });
                      }}
                        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', fontFamily: 'inherit' }}>
                        <option value="">Assign tech…</option>
                        {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
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

        {tab === 'webfront' && (
          <WebfrontTab cfg={webfrontCfg} setCfg={setWebfrontCfg} employees={employees} />
        )}

        {tab === 'feedback' && (
          <FeedbackTab items={feedback} onStatus={handleFeedbackStatus} onRefresh={loadFeedback} />
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
            <Section title="⚙ Settings">
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: '#333' }}>Auto-logout timeout</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>Minutes of inactivity before signing out</div>
                </div>
                <input type="number" value={timeout} onChange={e => setTimeoutVal(Number(e.target.value))} min={1} max={60}
                  style={{ width: 80, textAlign: 'center', fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '8px 12px', fontSize: 13 }} />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid #f0f0f0' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#333' }}>HR &amp; Reports PIN lock</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>4-digit PIN required to open HR and Reports. Leave blank to disable.</div>
                </div>
                <input
                  type="password" inputMode="numeric" maxLength={4} value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="----"
                  style={{ width: 80, textAlign: 'center', fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '8px 12px', fontSize: 18, letterSpacing: 6 }}
                />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid #f0f0f0' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#333' }}>Google Review URL</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>Included as a button in receipt emails sent to clients.</div>
                </div>
                <input
                  type="url" value={reviewUrl}
                  onChange={e => setReviewUrl(e.target.value)}
                  placeholder="https://g.page/r/…/review"
                  style={{ width: 220, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}
                />
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid #f0f0f0' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#333' }}>Business EIN</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>Employer Identification Number — printed on 1099-NEC forms.</div>
                </div>
                <input
                  value={ein}
                  onChange={e => setEin(e.target.value)}
                  placeholder="XX-XXXXXXX"
                  style={{ width: 140, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}
                />
              </div>
              <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                <Btn color="#3D95CE" onClick={() => updateSettings({ ...settings, timeoutMin: timeout, adminPin: pin || null, googleReviewUrl: reviewUrl.trim() || null, ein: ein.trim() || null })}>Save</Btn>
              </div>
            </Section>
            <Section title="🤖 Automations">
              {[
                { key: 'birthday', label: 'Birthday emails', val: autoBirthday, set: setAutoBirthday,
                  desc: 'Sends a happy birthday email at 10am on each client\'s birthday.' },
                { key: 'lapsed',   label: 'Lapsed client emails', val: autoLapsed,   set: setAutoLapsed,
                  desc: `Sends a "we miss you" re-engagement email every Monday to clients with no visit in the last ${autoLapsedDays} days.` },
              ].map(({ key, label, val, set, desc }) => (
                <div key={key} style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: '#333' }}>{label}</div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{desc}</div>
                  </div>
                  <button onClick={() => set(v => !v)} style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', padding: 0,
                    background: val ? '#2D7A5F' : '#d1d5db', position: 'relative', transition: 'background .2s', flexShrink: 0,
                  }}>
                    <div style={{
                      position: 'absolute', top: 3, left: val ? 22 : 2, width: 18, height: 18,
                      borderRadius: '50%', background: '#fff', transition: 'left .2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                    }} />
                  </button>
                </div>
              ))}
              {autoLapsed && (
                <div style={{ padding: '8px 16px 12px', display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid #f0f0f0' }}>
                  <span style={{ fontSize: 12, color: '#555' }}>Lapse threshold:</span>
                  <input type="number" min={14} max={365} value={autoLapsedDays}
                    onChange={e => setAutoLapsedDays(Math.max(14, Number(e.target.value)))}
                    style={{ width: 70, textAlign: 'center', fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '6px 10px', fontSize: 13 }} />
                  <span style={{ fontSize: 12, color: '#aaa' }}>days</span>
                </div>
              )}
              <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                <Btn color="#2D7A5F" onClick={async () => {
                  setAutoSaving(true);
                  await updateSettings({ ...settings, autoBirthday, autoLapsed, autoLapsedDays });
                  setAutoSaving(false);
                }}>{autoSaving ? 'Saving…' : 'Save Automations'}</Btn>
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
            <Section title="ℹ Store &amp; appointment hours are edited from the Calendar view.">
              <div style={{ padding: '10px 16px', fontSize: 12, color: '#aaa' }}>
                Open the Calendar module and click the <strong>🕐 Hours</strong> button in the toolbar.
              </div>
            </Section>
            <BrandingSection settings={settings} updateSettings={updateSettings} />
            <UpgradeSection settings={settings} gUser={gUser} />
            <BackupRestoreSection />
            <ProductSeedSection />
            <DemoSeedSection />
          </>
        )}

        {tab === 'tenants' && isSuperAdmin && (
          <TenantsTab
            tenants={tenants}
            onRefresh={loadTenants}
            onCreate={createTenantRecord}
            onUpdate={updateTenantRecord}
          />
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
  const bookingUrl = `${window.location.origin}/?book=1`;

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
    <Section title="🌐 Online Booking">
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: '#333' }}>Enable online booking</div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>Clients can book appointments from the public booking page</div>
        </div>
        <Toggle active={bookingCfg.enabled} onChange={() => save({ enabled: !bookingCfg.enabled })} disabled={saving} />
      </div>
      {bookingCfg.enabled && (
        <>
          <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6, fontWeight: 600 }}>BOOKING PAGE URL</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, fontSize: 12, color: '#555', background: '#f8f9fa', border: '1px solid #e8e8e8', borderRadius: 8, padding: '7px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bookingUrl}
              </div>
              <button onClick={copyUrl} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 8, border: '1px solid #d0d0d0', background: '#fff', color: copied ? '#2D7A5F' : '#555', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6, fontWeight: 600 }}>CUSTOM NOTE (shown to clients)</div>
            <input
              value={bookingCfg.note || ''}
              onChange={e => setBookingCfg(c => ({ ...c, note: e.target.value }))}
              onBlur={() => save({ note: bookingCfg.note || '' })}
              placeholder="e.g. Walk-ins also welcome! Call us for same-day slots."
              style={{ width: '100%', fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '8px 12px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        </>
      )}

      {/* Geo-location check-in — independent of online booking toggle */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: '#333' }}>Geo-location check-in</div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>Show clients how close they are to the salon when they check in</div>
        </div>
        <Toggle active={!!bookingCfg.geoEnabled} onChange={() => save({ geoEnabled: !bookingCfg.geoEnabled })} disabled={saving} />
      </div>
      {bookingCfg.geoEnabled && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 12, color: '#aaa', marginBottom: 10, fontWeight: 600 }}>SALON COORDINATES</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="number" step="any"
              value={bookingCfg.salonLat || ''}
              onChange={e => setBookingCfg(c => ({ ...c, salonLat: parseFloat(e.target.value) || null }))}
              onBlur={() => save({})}
              placeholder="Latitude"
              style={{ flex: 1, minWidth: 110, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none' }}
            />
            <input
              type="number" step="any"
              value={bookingCfg.salonLng || ''}
              onChange={e => setBookingCfg(c => ({ ...c, salonLng: parseFloat(e.target.value) || null }))}
              onBlur={() => save({})}
              placeholder="Longitude"
              style={{ flex: 1, minWidth: 110, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none' }}
            />
            <button onClick={detectLocation} disabled={geoLocating || !navigator.geolocation}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #3D95CE', background: '#EBF4FB', color: '#1a5f8a', fontSize: 12, fontWeight: 600, cursor: geoLocating ? 'default' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
              {geoLocating ? '…' : '📍 Use my location'}
            </button>
          </div>
          {hasCoords && (
            <div style={{ fontSize: 11, color: '#16a34a', marginBottom: 8 }}>
              ✓ Coordinates set ({bookingCfg.salonLat?.toFixed(5)}, {bookingCfg.salonLng?.toFixed(5)})
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#555', flexShrink: 0 }}>Check-in radius</span>
            <input
              type="number" min={50} max={2000} step={50}
              value={bookingCfg.checkinRadius || 200}
              onChange={e => setBookingCfg(c => ({ ...c, checkinRadius: Number(e.target.value) }))}
              onBlur={() => save({})}
              style={{ width: 80, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '5px 8px', fontSize: 12, outline: 'none', textAlign: 'center' }}
            />
            <span style={{ fontSize: 12, color: '#aaa' }}>meters</span>
          </div>
        </div>
      )}
    </Section>
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

function ThemeCard({ th, isSelected, badge, onClick }) {
  return (
    <button onClick={onClick} style={{
      border: `2px solid ${isSelected ? 'var(--tm-accent, #3D95CE)' : '#e8e8e8'}`,
      borderRadius: 12, padding: 0, cursor: 'pointer', background: '#fff',
      overflow: 'hidden',
      boxShadow: isSelected ? '0 0 0 3px rgba(61,149,206,.18)' : 'none',
      transition: 'border-color .15s, box-shadow .15s',
      position: 'relative', fontFamily: 'inherit', textAlign: 'left',
    }}>
      <div style={{ height: 38, background: `linear-gradient(135deg, ${th.gradStart} 0%, ${th.gradEnd} 100%)`, position: 'relative' }}>
        <span style={{ position: 'absolute', bottom: 4, right: 6, fontSize: 15 }}>{th.icon}</span>
        {badge && (
          <span style={{ position: 'absolute', top: 3, left: 4, fontSize: 8, background: 'rgba(255,255,255,.92)', borderRadius: 4, padding: '1px 4px', fontWeight: 700, color: '#333', letterSpacing: '.02em' }}>{badge}</span>
        )}
      </div>
      <div style={{ padding: '5px 6px 6px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{th.name}</div>
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
          <div style={{ fontSize: 13, color: '#333' }}>Auto-seasonal themes</div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
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
      <div style={{ padding: '0 12px 14px', borderTop: '1px solid #f0f0f0' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#bbb', letterSpacing: '.07em', textTransform: 'uppercase', padding: '10px 4px 8px' }}>
          {autoTheme ? 'Default palette (when no holiday is active)' : 'Core palettes'}
        </div>
        {grid(CORE_THEMES)}
      </div>

      {/* Holiday / seasonal */}
      <div style={{ padding: '0 12px 14px', borderTop: '1px solid #f0f0f0' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#bbb', letterSpacing: '.07em', textTransform: 'uppercase', padding: '10px 4px 8px' }}>
          Holidays &amp; seasons{autoTheme ? ' — auto-activate by date' : ' — select to pin'}
        </div>
        {grid(HOLIDAY_THEMES)}
      </div>

      <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
        <Btn color="var(--tm-accent, #3D95CE)" onClick={onSave}>{saving ? 'Saving…' : 'Save Appearance'}</Btn>
      </div>
    </Section>
  );
}

function Section({ title, children, action }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', marginBottom: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e8e8e8', fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: '.06em', textTransform: 'uppercase', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {title}{action}
      </div>
      {children}
    </div>
  );
}

function UserRow({ user, children }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: '#888', overflow: 'hidden', flexShrink: 0 }}>
        {user.picture ? <img src={user.picture} alt="" style={{ width: 36, height: 36, objectFit: 'cover' }} /> : (user.name?.[0] || user.email?.[0])}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>
          {user.name || user.email}
          {' '}<RoleBadge role={user.role} />
        </div>
        <div style={{ fontSize: 11, color: '#888' }}>{user.email}</div>
        <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>{user.grantedAt ? 'Granted: ' + formatTime(user.grantedAt) : 'Requested: ' + formatTime(user.requestedAt)}</div>
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
    <div style={{ borderBottom: '1px solid #f0f0f0', background: isErr ? '#fff8f8' : 'transparent' }}>
      <div style={{ padding: '10px 16px', cursor: hasDetail ? 'pointer' : 'default' }}
           onClick={() => hasDetail && setExpanded(x => !x)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {isErr ? '⚠ ' : ''}{log.action?.replace(/_/g, ' ')}
          </span>
          {hasDetail && <span style={{ fontSize: 10, color: '#bbb' }}>{expanded ? '▲' : '▼'}</span>}
          {log._version && <span style={{ fontSize: 9, color: '#d0d0d0', background: '#f5f5f5', borderRadius: 6, padding: '1px 5px' }}>v{log._version}</span>}
        <span style={{ fontSize: 10, color: '#bbb', marginLeft: 'auto' }}>{formatTime(log.timestamp)}</span>
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
          {log._ua       && <div style={{ marginTop: 4, color: '#aaa' }}><strong>UA:</strong> {log._ua}</div>}
          {log._stack    && <div style={{ marginTop: 4, color: '#aaa' }}><strong>Stack:</strong>{'\n'}{log._stack}</div>}
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
  const sel = { fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', fontFamily: 'inherit' };

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
        <option value="readonly">Read only</option>
        <option value="tech">Tech</option>
        <option value="scheduler">Scheduler</option>
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
    border: `1px solid ${active ? '#3D95CE' : '#e0e0e0'}`,
    background: active ? '#EBF4FB' : '#fff',
    color: active ? '#1a5f8a' : '#666',
    fontWeight: active ? 600 : 400,
  });

  return (
    <div>
      {/* Toolbar */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
        {/* Status filter */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 4 }}>Status</span>
          {STATUS_FILTERS.map(f => (
            <button key={f.id} onClick={() => setStatusFilter(f.id)} style={pillStyle(statusFilter === f.id)}>{f.label}</button>
          ))}
        </div>
        {/* Type filter + sort + actions */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 4 }}>Type</span>
          {TYPE_FILTERS.map(f => (
            <button key={f.id} onClick={() => setTypeFilter(f.id)} style={pillStyle(typeFilter === f.id)}>{f.label}</button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #e0e0e0', background: '#fff', color: '#555', fontFamily: 'inherit', cursor: 'pointer' }}>
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
  const typeBg    = item.type === 'bug' ? '#FEE2E2' : '#FEF3C7';
  const typeFg    = item.type === 'bug' ? '#991b1b'  : '#78350f';
  const statusColors = { open: '#3B82F6', resolved: '#10B981', not_considered: '#9ca3af' };
  const statusLabel  = { open: 'Open', resolved: 'Resolved', not_considered: 'Not considered' };

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: typeBg, color: typeFg, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {item.type === 'bug' ? '🐛 Bug' : '💡 Idea'}
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: `${statusColors[item.status]}22`, color: statusColors[item.status], textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {statusLabel[item.status] || item.status}
        </span>
        <span style={{ fontSize: 11, color: '#bbb', marginLeft: 'auto' }}>{date}</span>
      </div>

      <p style={{ fontSize: 13, color: '#333', lineHeight: 1.55, margin: '0 0 8px' }}>{item.text}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#bbb', flex: 1 }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#555' }}>
      <span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: '50%', background: `${color}22`, color, fontSize: 10, fontWeight: 700, lineHeight: '18px', textAlign: 'center' }}>{count}</span>
      {label}
    </div>
  );
}

function RoleBadge({ role }) {
  const colors = { admin: ['rgba(61,149,206,.15)', '#3D95CE'], readonly: ['rgba(34,197,94,.15)', '#16a34a'], tech: ['rgba(245,158,11,.15)', '#d97706'], scheduler: ['rgba(139,92,246,.15)', '#7c3aed'], pending: ['rgba(245,158,11,.15)', '#d97706'], denied: ['rgba(239,68,68,.15)', '#ef4444'] };
  const [bg, fg] = colors[role] || ['#eee', '#888'];
  return <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 20, letterSpacing: '.04em', textTransform: 'uppercase', background: bg, color: fg }}>{role}</span>;
}

function Btn({ onClick, color, children }) {
  return (
    <button onClick={onClick} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: 'none', background: color || '#e8e8e8', color: color ? '#fff' : '#666', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <div style={{ padding: 16, textAlign: 'center', color: '#bbb', fontSize: 13 }}>{children}</div>;
}

function BackupRestoreSection() {
  const [busy,   setBusy]   = useState(false);
  const [status, setStatus] = useState('');

  async function handleBackup() {
    setBusy(true); setStatus('Exporting…');
    try {
      const data = await fetchAllForBackup();
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tenant: 'meraki', data }, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `meraki-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Download started.');
      logActivity('backup_exported', new Date().toISOString().slice(0, 10));
    } catch (e) { setStatus('Export failed: ' + e.message); }
    finally { setBusy(false); }
  }

  async function handleRestore(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('Restore will overwrite all existing data. This cannot be undone. Continue?')) return;
    setBusy(true); setStatus('Reading file…');
    try {
      const text   = await file.text();
      const parsed = JSON.parse(text);
      const data   = parsed.data || parsed;
      setStatus('Writing to Firestore…');
      await restoreFromBackup(data);
      setStatus('Restore complete. Reload the page to see changes.');
      logActivity('backup_restored', file.name);
    } catch (e) { setStatus('Restore failed: ' + e.message); }
    finally { setBusy(false); e.target.value = ''; }
  }

  return (
    <Section title="🗄 Backup &amp; Restore">
      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={handleBackup} disabled={busy}
          style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #d0d0d0', background: '#fafafa', fontSize: 12, color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          ⬇ Download Backup
        </button>
        <label style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #fca5a5', background: busy ? '#fafafa' : '#fff1f1', fontSize: 12, color: busy ? '#aaa' : '#ef4444', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          ⬆ Restore from File
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleRestore} disabled={busy} />
        </label>
        {status && <span style={{ fontSize: 11, color: '#888' }}>{status}</span>}
      </div>
    </Section>
  );
}

function ProductSeedSection() {
  const [status,  setStatus]  = useState('');
  const [running, setRunning] = useState(false);
  const [phase,   setPhase]   = useState('idle');

  async function runSeed() {
    setRunning(true); setPhase('idle'); setStatus('');
    try {
      const count = await seedProducts(msg => setStatus(msg));
      setStatus(`Added ${count} demo products.`);
      setPhase('seeded');
    } catch (e) {
      setStatus('Error: ' + e.message); setPhase('error');
    } finally { setRunning(false); }
  }

  async function runClear() {
    if (!confirm('Remove all demo products?')) return;
    setRunning(true); setPhase('idle'); setStatus('');
    try {
      const count = await clearSeedProducts(msg => setStatus(msg));
      setStatus(`Removed ${count} demo products.`);
      setPhase('cleared');
    } catch (e) {
      setStatus('Error: ' + e.message); setPhase('error');
    } finally { setRunning(false); }
  }

  return (
    <Section title="🛍 Product Catalog Seed">
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 10 }}>
          Populate the Products module with 25 demo nail retail products (OPI, Essie, CND, Gelish, etc.) including prices, costs, and stock counts.
        </div>
        {status && (
          <div style={{ fontSize: 12, color: phase === 'error' ? '#ef4444' : phase === 'cleared' || phase === 'seeded' ? '#16a34a' : '#888', marginBottom: 10, fontStyle: 'italic' }}>
            {status}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn color="#2D7A5F" onClick={runSeed} disabled={running}>
            {running && phase === 'idle' ? 'Adding…' : '↓ Seed Products'}
          </Btn>
          <Btn color="#ef4444" onClick={runClear} disabled={running}>
            {running && phase === 'idle' ? 'Removing…' : '× Clear Demo Products'}
          </Btn>
        </div>
      </div>
    </Section>
  );
}

function DemoSeedSection() {
  const [status,  setStatus]  = useState('');
  const [running, setRunning] = useState(false);
  const [phase,   setPhase]   = useState('idle');

  async function runSeed() {
    if (!confirm('Populate with 500 regular + 500 celebrity clients and ~2,500 appointments (400 days past + today + 30 days future). Takes 10–15 min. Continue?')) return;
    setRunning(true); setPhase('idle'); setStatus('');
    try {
      await seedDemoData(msg => setStatus(msg));
      setPhase('seeded');
      logActivity('demo_seeded', 'full seed');
    } catch (e) {
      setStatus('Error: ' + e.message); setPhase('error');
    } finally { setRunning(false); }
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
    if (!confirm('Permanently delete all demo clients and appointments?')) return;
    setRunning(true); setPhase('idle'); setStatus('');
    try {
      const result = await clearDemoData(msg => setStatus(msg));
      setStatus(`Removed ${result.clients} clients and ${result.appointments} appointments.`);
      setPhase('cleared');
      logActivity('demo_cleared', `${result.clients} clients · ${result.appointments} appts`);
    } catch (e) {
      setStatus('Error: ' + e.message); setPhase('error');
    } finally { setRunning(false); }
  }

  const busy = running && phase === 'idle';

  return (
    <Section title="🧪 Demo Data">
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 10 }}>
          Seed 500 regular + 500 celebrity clients with 400 days past (~13 months) + today + 30 days future appointments, or top-up with days 31–60 future without re-seeding.
        </div>
        {status && (
          <div style={{ fontSize: 12, color: phase === 'error' ? '#ef4444' : phase === 'cleared' || phase === 'seeded' ? '#16a34a' : '#888', marginBottom: 10, fontStyle: 'italic' }}>
            {status}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn color="#f59e0b" onClick={runSeed} disabled={running}>
            {busy ? 'Running…' : '↓ Seed Demo Data'}
          </Btn>
          <Btn color="#3D95CE" onClick={runAddFuture} disabled={running}>
            {busy ? 'Running…' : '+ Add 1 Month Future'}
          </Btn>
          <Btn color="#ef4444" onClick={runClear} disabled={running}>
            {busy ? 'Removing…' : '× Remove All Demo'}
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
      const result = await callFn('refreshGoogleReviews')({ placeId });
      const { count, rating, total } = result.data;
      const ts = new Date().toISOString();
      patch('googleReviewsRefreshedAt', ts);
      setRefreshMsg(`✓ Pulled ${count} reviews · ${rating}★ (${total} total)`);
    } catch (e) {
      setRefreshMsg('✗ ' + (e.message || 'Refresh failed'));
    }
    setRefreshing(false);
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

  const webUrl = `${window.location.origin}/?web`;
  const inp = { fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' };
  const TA  = { ...inp, resize: 'vertical', minHeight: 80 };

  return (
    <div>
      {/* Preview URL */}
      <Section title="🌐 Public Website">
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, fontSize: 12, color: '#555', background: '#f8f9fa', border: '1px solid #e8e8e8', borderRadius: 8, padding: '7px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{webUrl}</div>
          <button onClick={() => window.open(webUrl, '_blank')} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #3D95CE', background: '#EBF4FB', color: '#1a5f8a', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
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
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#333', cursor: 'pointer' }}>
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
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Tagline</div>
            <input value={cfg.tagline || ''} onChange={e => patch('tagline', e.target.value)} placeholder="Where nails become art." style={inp} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>About / Our Story paragraph</div>
            <textarea value={cfg.about || ''} onChange={e => patch('about', e.target.value)} placeholder="Welcome to Meraki Nail Studio…" style={TA} />
          </div>
        </div>
      </Section>

      {/* Contact */}
      <Section title="📞 Contact Info">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['phone',    'Phone',                   '(614) 555-0100'],
            ['address',  'Address',                 '5029 Olentangy River Rd, Columbus, OH 43214'],
            ['mapsUrl',  'Google Maps URL',         'https://maps.google.com/…'],
          ].map(([key, label, ph]) => (
            <div key={key}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
              <input value={cfg[key] || ''} onChange={e => patch(key, e.target.value)} placeholder={ph} style={inp} />
            </div>
          ))}
        </div>
      </Section>

      {/* Hours */}
      <Section title="🕐 Business Hours">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DAY_LABELS.map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: '#555', width: 90, flexShrink: 0 }}>{label}</span>
              <input value={cfg.hours?.[key] || ''} onChange={e => patchHour(key, e.target.value)} placeholder="Closed" style={{ ...inp, flex: 1 }} />
            </div>
          ))}
          <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>Format: "10:00 AM – 7:00 PM" or "Closed"</div>
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
              <span style={{ fontSize: 13, color: '#555', width: 120, flexShrink: 0 }}>{label}</span>
              <input value={cfg[key] || ''} onChange={e => patch(key, e.target.value)} placeholder={ph} style={{ ...inp, flex: 1 }} />
            </div>
          ))}
        </div>
      </Section>

      {/* Google Reviews */}
      <Section title="⭐ Google Reviews">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Google Place ID</div>
            <input value={cfg.googlePlaceId || ''} onChange={e => patch('googlePlaceId', e.target.value)} placeholder="ChIJ…" style={inp} />
            <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>
              Find it at <span style={{ color: '#3D95CE' }}>developers.google.com/maps/documentation/places/web-service/place-id</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={handleRefreshGoogleReviews} disabled={refreshing}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: refreshing ? '#aaa' : '#2D7A5F', color: '#fff', fontSize: 13, fontWeight: 600, cursor: refreshing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {refreshing ? 'Fetching…' : '↻ Refresh from Google'}
            </button>
            {cfg.googleReviewsRefreshedAt && !refreshMsg && (
              <span style={{ fontSize: 11, color: '#aaa' }}>Last updated: {new Date(cfg.googleReviewsRefreshedAt).toLocaleString()}</span>
            )}
            {refreshMsg && (
              <span style={{ fontSize: 12, color: refreshMsg.startsWith('✓') ? '#2D7A5F' : '#ef4444', fontWeight: 500 }}>{refreshMsg}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.5 }}>
            Reviews are cached in Firestore and displayed on the public webfront. Refresh periodically to pull the latest from Google.
          </div>
        </div>
      </Section>

      {/* Manual Testimonials */}
      <Section title={`💬 Manual Testimonials (${testimonials.length})`}>
        {/* Existing testimonials */}
        {testimonials.length > 0 && (
          <div style={{ padding: '8px 16px 0' }}>
            {testimonials.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>{t.name || 'Anonymous'}</span>
                    <span style={{ fontSize: 11, color: '#f59e0b' }}>{'★'.repeat(t.rating || 5)}</span>
                    {t.techName && <span style={{ fontSize: 11, color: '#2D7A5F' }}>· {t.techName}</span>}
                    {t.date && <span style={{ fontSize: 11, color: '#bbb' }}>· {t.date}</span>}
                  </div>
                  {t.text && <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>"{t.text}"</div>}
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
          <div style={{ margin: '10px 16px', background: '#f8f9fa', borderRadius: 10, padding: '14px', border: '1px solid #e0e0e0' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 10 }}>{editIdx === -1 ? 'Add Testimonial' : 'Edit Testimonial'}</div>
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
            <div style={{ padding: '0 16px 8px', fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Promote from recorded reviews
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto', borderTop: '1px solid #f0f0f0' }}>
              {reviews.filter(r => r.text).map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 16px', borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>{r.clientName || '—'}</span>
                      <span style={{ fontSize: 11, color: '#f59e0b' }}>{'★'.repeat(r.rating || 5)}</span>
                      {r.techName && <span style={{ fontSize: 11, color: '#2D7A5F' }}>· {r.techName}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{r.text}"</div>
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
          <div style={{ fontSize: 11, fontWeight: 700, color: '#bbb', letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 10 }}>Layout</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
            {[
              { id: 'classic',  icon: '🌑', name: 'Classic',  desc: 'Dark hero, bold & dramatic' },
              { id: 'boutique', icon: '🌸', name: 'Boutique', desc: 'Light & airy, soft tones' },
              { id: 'minimal',  icon: '◻',  name: 'Minimal',  desc: 'Clean, wide-open, editorial' },
            ].map(l => (
              <button key={l.id} onClick={() => patch('layout', l.id)} style={{
                border: `2px solid ${(cfg.layout || 'classic') === l.id ? '#3D95CE' : '#e8e8e8'}`,
                borderRadius: 10, padding: '10px 8px', cursor: 'pointer', background: '#fff',
                boxShadow: (cfg.layout || 'classic') === l.id ? '0 0 0 3px rgba(61,149,206,.18)' : 'none',
                fontFamily: 'inherit', textAlign: 'center', transition: 'border-color .15s',
                position: 'relative',
              }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{l.icon}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#1a1a1a' }}>{l.name}</div>
                <div style={{ fontSize: 10, color: '#aaa', marginTop: 2, lineHeight: 1.3 }}>{l.desc}</div>
                {(cfg.layout || 'classic') === l.id && (
                  <div style={{ position: 'absolute', top: 4, right: 6, fontSize: 10, color: '#3D95CE', fontWeight: 700 }}>✓</div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Theme picker — auto-seasonal toggle */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: '#333' }}>Auto-seasonal themes</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
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
        <div style={{ padding: '0 12px 14px', borderTop: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#bbb', letterSpacing: '.07em', textTransform: 'uppercase', padding: '10px 4px 8px' }}>
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
        <div style={{ padding: '0 12px 14px', borderTop: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#bbb', letterSpacing: '.07em', textTransform: 'uppercase', padding: '10px 4px 8px' }}>
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
          style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #e0e0e0', background: '#fafafa', fontSize: 13, color: '#555', cursor: 'pointer', fontFamily: 'inherit' }}>
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
          <div key={label} style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>{value}</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filter + Refresh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', flexWrap: 'wrap' }}>
        {[['all','All'],['pending','Not clicked'],['clicked','Clicked'],['received','Reviewed']].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)}
            style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${filter === id ? '#2D7A5F' : '#e0e0e0'}`, background: filter === id ? '#f0faf6' : '#fff', color: filter === id ? '#2D7A5F' : '#555', fontSize: 12, fontWeight: filter === id ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
            {label}
          </button>
        ))}
        <button onClick={onRefresh} style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 20, border: '1px solid #e0e0e0', background: '#fafafa', color: '#555', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
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
              <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: '1px solid #f5f5f5', background: '#fff' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{req.clientName || 'Client'}</span>
                    {req.techName && <span style={{ fontSize: 11, color: '#2D7A5F' }}>· {req.techName}</span>}
                    {isReceived
                      ? <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>✓ Reviewed</span>
                      : wasClicked
                        ? <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}>Clicked</span>
                        : <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: '#f8f9fa', color: '#aaa', border: '1px solid #e8e8e8' }}>Sent</span>
                    }
                  </div>
                  <div style={{ fontSize: 11, color: '#bbb', marginTop: 3 }}>
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
  if (item.error)   return { label: item.error === 'no_email' ? 'No email' : 'Failed', bg: '#fef2f2', color: '#ef4444', border: '#fca5a5' };
  if (item.sent)    return { label: 'Sent',    bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' };
  return               { label: 'Pending', bg: '#f8f9fa', color: '#888',    border: '#e0e0e0' };
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
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap' }}>
          {[
            { label: 'Total',   val: items.length,  bg: '#f8f9fa',  color: '#333'    },
            { label: 'Sent',    val: sent,           bg: '#f0fdf4',  color: '#16a34a' },
            { label: 'Failed',  val: failed,         bg: '#fef2f2',  color: '#ef4444' },
            { label: 'Pending', val: pending,        bg: '#fffbeb',  color: '#b45309' },
          ].map(k => (
            <div key={k.label} style={{ background: k.bg, borderRadius: 8, padding: '6px 14px', textAlign: 'center', minWidth: 60 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: k.color }}>{k.val}</div>
              <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter pills + refresh */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 16px', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap', alignItems: 'center' }}>
        {filters.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            fontSize: 11, padding: '4px 11px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${filter === f.id ? '#3D95CE' : '#e0e0e0'}`,
            background: filter === f.id ? '#EBF4FB' : '#fff',
            color: filter === f.id ? '#1a5f8a' : '#666',
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
                  : (NOTIF_META[item.changeType] || { icon: '📧', label: item.changeType, color: '#888' });
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
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 16px', borderBottom: last ? 'none' : '1px solid #f5f5f5' }}>
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
        <div style={{ fontSize: 12, color: '#333', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {recipient}
        </div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {description}
        </div>
        {item.error && item.error !== 'no_email' && (
          <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>Error: {item.error}</div>
        )}
      </div>

      {/* Time */}
      <div style={{ fontSize: 10, color: '#bbb', flexShrink: 0, textAlign: 'right', paddingTop: 2 }}>{timeStr}</div>
    </div>
  );
}

// ── Branding ──────────────────────────────────────────────────────────────────
function BrandingSection({ settings, updateSettings }) {
  const [name,     setName]     = useState(settings.brandName     || '');
  const [tagline,  setTagline]  = useState(settings.brandTagline  || '');
  const [tagTop,   setTagTop]   = useState(settings.brandTaglineTop || '');
  const [color,    setColor]    = useState(settings.brandColor    || '#2D7A5F');
  const [logoUrl,  setLogoUrl]  = useState(settings.brandLogoUrl  || '');
  const [saving,   setSaving]   = useState(false);

  async function handleSave() {
    setSaving(true);
    await updateSettings({ ...settings, brandName: name.trim() || null, brandTagline: tagline.trim() || null, brandTaglineTop: tagTop.trim() || null, brandColor: color, brandLogoUrl: logoUrl.trim() || null });
    setSaving(false);
  }

  return (
    <Section title="🎨 Brand &amp; Identity">
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Salon name (shown on splash &amp; emails)</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Meraki"
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0e0e0', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Tagline (below name on splash)</div>
            <input value={tagline} onChange={e => setTagline(e.target.value)} placeholder="Nail Studio"
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0e0e0', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Logo URL (optional)</div>
            <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://…/logo.png"
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0e0e0', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Brand color</div>
            <input type="color" value={color} onChange={e => setColor(e.target.value)}
              style={{ width: 44, height: 34, border: '1px solid #e0e0e0', borderRadius: 8, cursor: 'pointer', padding: 2 }} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Btn onClick={handleSave} color="#2D7A5F">{saving ? 'Saving…' : 'Save Branding'}</Btn>
        </div>
      </div>
    </Section>
  );
}

// ── Plan & Billing ────────────────────────────────────────────────────────────
function UpgradeSection({ settings, gUser }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const plan = settings.plan || 'starter';

  async function handleUpgrade() {
    setLoading(true); setError('');
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions }     = await import('../../lib/firebase');
      const fn  = httpsCallable(functions, 'createCheckoutSession');
      const res = await fn({ plan: 'pro', successUrl: window.location.href + '?stripe=success', cancelUrl: window.location.href });
      if (res.data?.url) window.location.href = res.data.url;
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const PLAN_LABELS = { starter: 'Starter (Free)', pro: 'Pro', enterprise: 'Enterprise' };
  const PLAN_COLORS = { starter: '#888', pro: '#2563eb', enterprise: '#7c3aed' };

  return (
    <Section title="💳 Plan &amp; Billing">
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: '#333' }}>Current plan</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: PLAN_COLORS[plan] || '#888', marginTop: 2 }}>{PLAN_LABELS[plan] || plan}</div>
          </div>
          {plan === 'starter' && (
            <button onClick={handleUpgrade} disabled={loading}
              style={{ background: loading ? '#ccc' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {loading ? 'Loading…' : 'Upgrade to Pro'}
            </button>
          )}
          {plan !== 'starter' && (
            <a href="https://billing.stripe.com/p/login/test" target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: '#3D95CE' }}>Manage subscription →</a>
          )}
        </div>
        {plan === 'starter' && (
          <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6 }}>
            Pro includes: unlimited staff, marketing campaigns, AI chatbot, full HR &amp; payroll tools — $49/mo.
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{error}</div>}
      </div>
    </Section>
  );
}

// ── Tenant management (super-admin only) ─────────────────────────────────────
const PLANS = ['starter', 'pro', 'enterprise'];

function PlanBadge({ p }) {
  const colors = { starter: ['#f0fdf4','#16a34a'], pro: ['#eff6ff','#2563eb'], enterprise: ['#faf5ff','#7c3aed'] };
  const [bg, c] = colors[p] || ['#f5f5f5','#888'];
  return <span style={{ background: bg, color: c, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, textTransform: 'uppercase' }}>{p}</span>;
}

function TenantsTab({ tenants, onRefresh, onCreate, onUpdate }) {
  const [modal,        setModal]       = useState(null); // null | 'new' | tenantObject
  const [saving,       setSaving]      = useState(false);
  const [provisioning, setProvisioning]= useState(null); // tenantId currently being provisioned
  const [stats,        setStats]       = useState({});   // { [tenantId]: { provisioned, userCount, apptCount } }
  const [id,    setId]    = useState('');
  const [name,  setName]  = useState('');
  const [owner, setOwner] = useState('');
  const [plan,  setPlan]  = useState('starter');
  const [active,setActive]= useState(true);

  // Load stats in parallel whenever tenant list refreshes
  useEffect(() => {
    if (!tenants?.length) return;
    Promise.allSettled(
      tenants.map(t => fetchTenantStats(t.id).then(s => [t.id, s]))
    ).then(results => {
      const map = {};
      results.forEach(r => { if (r.status === 'fulfilled') { const [tid, s] = r.value; map[tid] = s; } });
      setStats(map);
    });
  }, [tenants]); // eslint-disable-line

  function openNew() {
    setId(''); setName(''); setOwner(''); setPlan('starter'); setActive(true);
    setModal('new');
  }

  function openEdit(t) {
    setId(t.id); setName(t.name || ''); setOwner(t.ownerEmail || ''); setPlan(t.plan || 'starter'); setActive(t.active !== false);
    setModal(t);
  }

  async function handleSave() {
    if (!id.trim() || !name.trim()) return;
    setSaving(true);
    try {
      const slugId = id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const data   = { name: name.trim(), ownerEmail: owner.trim(), plan, active };
      if (modal === 'new') {
        await onCreate(slugId, data);
        await provisionNewTenant(slugId, owner.trim(), name.trim());
      } else {
        await onUpdate(modal.id, data);
      }
      await onRefresh();
      setModal(null);
    } finally { setSaving(false); }
  }

  async function handleProvision(t) {
    setProvisioning(t.id);
    try {
      await provisionNewTenant(t.id, t.ownerEmail, t.name);
      const s = await fetchTenantStats(t.id);
      setStats(prev => ({ ...prev, [t.id]: s }));
    } finally { setProvisioning(null); }
  }

  return (
    <>
      <Section title="🏢 Tenant Registry" action={
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn onClick={onRefresh}>Refresh</Btn>
          <Btn onClick={openNew} color="#2D7A5F">+ New Tenant</Btn>
        </div>
      }>
        {tenants === null
          ? <Empty>Loading…</Empty>
          : tenants.length === 0
            ? <Empty>No tenants yet. Click "+ New Tenant" to add one.</Empty>
            : tenants.map(t => {
                const s = stats[t.id];
                return (
                  <div key={t.id} style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Name row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{t.name || t.id}</span>
                          <PlanBadge p={t.plan || 'starter'} />
                          {t.active === false && (
                            <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, background: '#fef2f2', padding: '1px 6px', borderRadius: 8 }}>INACTIVE</span>
                          )}
                          {s && (s.provisioned
                            ? <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 700 }}>✓ Provisioned</span>
                            : <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>⚠ Not provisioned</span>
                          )}
                        </div>
                        {/* Meta row */}
                        <div style={{ fontSize: 11, color: '#888', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                          <span>ID: <code style={{ background: '#f5f5f5', padding: '1px 5px', borderRadius: 4, fontSize: 10 }}>{t.id}</code></span>
                          {t.ownerEmail && <span>{t.ownerEmail}</span>}
                          {s?.userCount > 0 && <span>👤 {s.userCount} user{s.userCount !== 1 ? 's' : ''}</span>}
                          {s?.apptCount > 0 && <span>📅 {s.apptCount}+ appts</span>}
                          {t.createdAt && <span>Created {t.createdAt.slice(0, 10)}</span>}
                        </div>
                      </div>
                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginTop: 2 }}>
                        {s && !s.provisioned && (
                          <button
                            onClick={() => handleProvision(t)}
                            disabled={provisioning === t.id}
                            style={{ fontSize: 11, color: '#fff', background: provisioning === t.id ? '#ccc' : '#f59e0b', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: provisioning === t.id ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                          >
                            {provisioning === t.id ? 'Provisioning…' : 'Provision'}
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(t)}
                          style={{ fontSize: 11, color: '#3D95CE', background: 'none', border: '1px solid #d0e8f8', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
        }
      </Section>

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 380, boxShadow: '0 8px 40px rgba(0,0,0,.18)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>
              {modal === 'new' ? '🏢 New Tenant' : `Edit: ${modal.id}`}
            </div>

            {modal === 'new' && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Tenant ID <span style={{ color: '#bbb' }}>(slug — becomes the subdomain)</span></div>
                <input value={id} onChange={e => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="e.g. luxenails"
                  style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0e0e0', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit' }} />
                {id && <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>URL: {id}.tipflow.app</div>}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Salon Name</div>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Luxe Nails Studio"
                style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0e0e0', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit' }} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Owner Email</div>
              <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="owner@email.com"
                style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0e0e0', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit' }} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Plan</div>
              <select value={plan} onChange={e => setPlan(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0e0e0', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
                {PLANS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <input type="checkbox" id="tActive" checked={active} onChange={e => setActive(e.target.checked)} />
              <label htmlFor="tActive" style={{ fontSize: 13, color: '#333', cursor: 'pointer' }}>Active</label>
            </div>

            {modal === 'new' && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 12, color: '#166534', lineHeight: 1.5 }}>
                Saving will auto-provision Firestore data for this tenant: default settings, empty slide deck, and the owner email set as admin.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)}
                style={{ border: '1px solid #e0e0e0', background: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !id.trim() || !name.trim()}
                style={{ background: saving || !id.trim() || !name.trim() ? '#aaa' : '#2D7A5F', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                {saving ? 'Creating…' : modal === 'new' ? 'Create & Provision' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
