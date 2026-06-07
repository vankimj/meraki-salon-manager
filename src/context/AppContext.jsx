import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getTheme, detectAutoTheme } from '../lib/themes';
import { onAuthStateChanged, GoogleAuthProvider, OAuthProvider, signInWithPopup, signOut as fbSignOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { auth, ALLOWED_EMAILS } from '../lib/firebase';
import { loadAll, saveSlides, saveUsers, saveSettings, submitAccessRequest, fetchAccessRequests, deleteAccessRequest, fetchHandbook, fetchMyHandbookSig, signHandbookDoc, fetchClientByEmail, subscribeToChats, subscribeToRecentNotifications, markNotificationRead, ensureStaffEmailsBackfill, healUsersFullIfMissing } from '../lib/firestore';
import { logActivity, setLoggerUser } from '../lib/logger';
import { phSVG } from '../utils/helpers';
import { isFeatureOn } from '../lib/featureFlags';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const DEFAULTS = {
  slides: [
    { img: phSVG('#4A7DB5'), name: 'Jane Smith',      vu: 'janesmith',  iu: 'janesmith',  fu: null, hu: null },
    { img: phSVG('#2D7A5F'), name: 'Robert Johnson',  vu: 'robertj',    iu: 'robertj',    fu: null, hu: null },
  ],
  def: 0,
  cur: 0,
};

export function AppProvider({ children }) {
  const [slides,   setSlides]   = useState([]);
  const [def,      setDef]      = useState(0);
  const [cur,      setCur]      = useState(0);
  const [users,    setUsers]    = useState([]);
  // Slim self-record (just the caller's own role + techName) fetched
  // via the `getMyTenantRole` Cloud Function for non-admin users.
  // Replaces the old data/users.byEmail map, which leaked every
  // coworker's (email, role) tuple to all staff. Empty for admin
  // users (they read the rich users[] from data/usersFull instead).
  const [myRecord, setMyRecord] = useState(null);
  const [settings, setSettings] = useState({ timeoutMin: 5 });
  const [gUser,           setGUser]           = useState(null);
  const [syncState,       setSyncState]       = useState('idle');
  // Online/offline state — driven by both the browser network event and
  // Firestore's own connection signal. Used to show the offline banner and
  // gate any operations that need a live network (e.g. Stripe charges).
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  useEffect(() => {
    const onUp   = () => setIsOnline(true);
    const onDown = () => setIsOnline(false);
    window.addEventListener('online',  onUp);
    window.addEventListener('offline', onDown);
    return () => {
      window.removeEventListener('online',  onUp);
      window.removeEventListener('offline', onDown);
    };
  }, []);
  const [toast,           setToast]           = useState(null);
  const [toastAction,     setToastAction]     = useState(null);
  const [loaded,          setLoaded]          = useState(false);
  const [magicLinkPending,setMagicLinkPending]= useState(false);
  const [handbookPending, setHandbookPending] = useState(false);
  const [handbookDoc,     setHandbookDoc]     = useState(null);
  const [portalClientId,    setPortalClientId]    = useState(null);
  const [totalChatUnread,   setTotalChatUnread]   = useState(0);
  const [recentNotifs,      setRecentNotifs]      = useState([]);

  // ── Per-user checkout ticket ───────────────────────────
  // Lives in localStorage so a refresh doesn't lose what's been added.
  // Shape: { appts: [Appointment], products: [{ product, qty }] }
  const TICKET_STORAGE_KEY = 'meraki:ticket:v1';
  const LEGACY_CART_STORAGE_KEY = 'meraki:cart:v1';
  const [ticket, setTicket] = useState(() => {
    try {
      let raw = localStorage.getItem(TICKET_STORAGE_KEY);
      if (!raw) {
        raw = localStorage.getItem(LEGACY_CART_STORAGE_KEY);
        if (raw) localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
      }
      if (!raw) return { appts: [], products: [] };
      const parsed = JSON.parse(raw);
      return {
        appts:    Array.isArray(parsed.appts)    ? parsed.appts    : [],
        products: Array.isArray(parsed.products) ? parsed.products : [],
      };
    } catch { return { appts: [], products: [] }; }
  });
  const [ticketCheckoutOpen, setTicketCheckoutOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(ticket)); } catch {}
  }, [ticket]);

  function addApptToTicket(appt) {
    if (!appt?.id) return;
    setTicket(t => {
      if (t.appts.some(a => a.id === appt.id)) return t;
      return { ...t, appts: [...t.appts, appt] };
    });
  }
  function removeApptFromTicket(apptId) {
    setTicket(t => ({ ...t, appts: t.appts.filter(a => a.id !== apptId) }));
  }
  function addProductToTicket(product) {
    if (!product?.id) return;
    setTicket(t => {
      const existing = t.products.find(p => p.product.id === product.id);
      if (existing) return { ...t, products: t.products.map(p => p.product.id === product.id ? { ...p, qty: p.qty + 1 } : p) };
      return { ...t, products: [...t.products, { product, qty: 1 }] };
    });
  }
  function setTicketProductQty(productId, qty) {
    setTicket(t => {
      if (qty < 1) return { ...t, products: t.products.filter(p => p.product.id !== productId) };
      return { ...t, products: t.products.map(p => p.product.id === productId ? { ...p, qty } : p) };
    });
  }
  function clearTicket() { setTicket({ appts: [], products: [] }); }
  const ticketCount = ticket.appts.length + ticket.products.reduce((s, p) => s + p.qty, 0);
  const [viewAs,            setViewAs]            = useState(null); // null | { role: 'tech', techName: string } | { role: 'scheduler' } | { role: 'readonly' }

  // ── PIN gate for sensitive views (HR, Reports) ─────────
  // Lives at the app level so the home grid AND the module-shell sidebar both
  // route through the same check (and the same per-session unlock cache).
  const PIN_LOCKED_VIEWS = useRef(new Set(['hr', 'reports'])).current;
  const unlockedViewsRef = useRef(new Set());
  const [pinPrompt, setPinPrompt] = useState(null); // null | { viewId, onUnlock }

  // requirePin(viewId, onUnlock) — calls onUnlock immediately if the view
  // doesn't need a PIN, isn't locked, or has already been unlocked this session.
  // Otherwise it raises the prompt; onUnlock fires only on correct PIN.
  const requirePin = useCallback((viewId, onUnlock) => {
    const pin = settings?.adminPin;
    if (!pin || !PIN_LOCKED_VIEWS.has(viewId) || unlockedViewsRef.current.has(viewId)) {
      onUnlock();
      return;
    }
    setPinPrompt({ viewId, onUnlock });
  }, [settings?.adminPin, PIN_LOCKED_VIEWS]);

  const acceptPinPrompt = useCallback(() => {
    if (!pinPrompt) return;
    unlockedViewsRef.current.add(pinPrompt.viewId);
    logActivity('sensitive_tile_accessed', `${gUser?.email || 'unknown'} unlocked ${pinPrompt.viewId}`);
    const cb = pinPrompt.onUnlock;
    setPinPrompt(null);
    cb();
  }, [pinPrompt, gUser?.email]);

  const dismissPinPrompt = useCallback(() => setPinPrompt(null), []);

  const logoutTimer    = useRef(null);
  const inactivityTimer= useRef(null);
  const toastTimer     = useRef(null);
  // Paused flag for the auto-logout timer. Long-running flows (onboarding
  // wizard, demo seed) flip this true so background effects can't silently
  // restart the timer while the flow is in progress. Ref (not state) so
  // changes don't trigger re-renders, and the check inside startLogoutTimer
  // is synchronous against the latest value.
  const logoutPausedRef = useRef(false);

  // ── Toast ──────────────────────────────────────────────
  const showToast = useCallback((msg, dur = 2200, action = null) => {
    setToast(msg);
    setToastAction(action);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => { setToast(null); setToastAction(null); }, dur);
  }, []);

  // ── Sync dot ───────────────────────────────────────────
  const setSyncDot = useCallback((s) => setSyncState(s), []);

  // ── Inactivity timer (return to default slide) ─────────
  const resetInactivity = useCallback(() => {
    clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => {
      setCur(prev => prev === def ? prev : def);
    }, 60000);
  }, [def]);

  // ── Auto-logout ────────────────────────────────────────
  const startLogoutTimer = useCallback((user, timeoutMin) => {
    if (logoutPausedRef.current) return;
    clearTimeout(logoutTimer.current);
    logoutTimer.current = setTimeout(() => {
      if (user) { fbSignOut(auth); showToast(`Auto-logged out after ${timeoutMin} min inactivity`); }
    }, (timeoutMin || 5) * 60 * 1000);
  }, [showToast]);

  const resetLogoutTimer = useCallback(() => {
    if (gUser) startLogoutTimer(gUser, settings.timeoutMin);
  }, [gUser, settings.timeoutMin, startLogoutTimer]);

  // Pause/resume the auto-logout timer entirely. Used by long-running
  // admin operations (demo seed, big imports, onboarding wizard) so a
  // 10-15-minute flow doesn't get killed by the default 5-minute inactivity
  // timeout. The pause flag lives in a ref that startLogoutTimer checks on
  // every call — this is the only thing keeping background effects (like
  // the settings.timeoutMin load resolving after wizard mount) from racing
  // ahead and restarting the timer behind the wizard's back.
  const pauseLogoutTimer  = useCallback(() => {
    logoutPausedRef.current = true;
    clearTimeout(logoutTimer.current);
    logoutTimer.current = null;
  }, []);
  const resumeLogoutTimer = useCallback(() => {
    logoutPausedRef.current = false;
    if (gUser) startLogoutTimer(gUser, settings.timeoutMin);
  }, [gUser, settings.timeoutMin, startLogoutTimer]);

  // ── Firestore load ─────────────────────────────────────
  useEffect(() => {
    (async () => {
      setSyncDot('syncing');
      try {
        const data = await loadAll();
        if (data.slides) {
          setSlides(data.slides);
          setDef(data.def);
          setCur(data.def);
        } else {
          setSlides(DEFAULTS.slides);
        }
        setUsers(data.users);
        setSettings(s => ({ ...s, ...data.settings }));
        setSyncDot('ok');
      } catch (e) {
        console.error('[AppContext] loadAll error:', e);
        setSyncDot('err');
        setSlides(DEFAULTS.slides);
      }
      setLoaded(true);
    })();
  }, []);

  // ── Auth state ─────────────────────────────────────────
  useEffect(() => {
    return onAuthStateChanged(auth, async user => {
      if (user) {
        await checkUserAccess(user);
      } else {
        clearTimeout(logoutTimer.current);
        setGUser(null);
        setLoggerUser(null);
        setPortalClientId(null);
      }
    });
  }, []); // eslint-disable-line

  async function checkUserAccess(user) {
    let currentUsers = users;
    let currentTimeoutMin = settings.timeoutMin || 5;
    let loadedData = null;
    try {
      loadedData = await loadAll();
      currentUsers = loadedData.users;
      currentTimeoutMin = loadedData.settings?.timeoutMin || currentTimeoutMin;
      // Auto-heal: data/usersFull missing while data/users.staffEmails is
      // populated means the rich array got dropped (Meraki incident
      // 2026-05-10). Rebuild it before the bootstrap-admin path below
      // runs — otherwise that path would persist a [Jonathan]-only array
      // and cement the data loss.
      const healed = await healUsersFullIfMissing(loadedData);
      if (healed) {
        currentUsers = healed;
        loadedData.users = healed;
      }
      setUsers(currentUsers);
      setSettings(s => ({ ...s, ...loadedData.settings }));
    } catch (_) {}

    // For non-admin staff (techs/scheduler/readonly), data/usersFull is
    // rules-blocked, so loadAll's `users` is empty. Fetch THIS USER'S
    // own slice via the `getMyTenantRole` callable (server-side, admin
    // SDK reads, returns only the caller's record). Synthesize a
    // 1-element stub so the access checks below + downstream `_rec`
    // lookup find the right record. The previous implementation read
    // a public `byEmail` map, which leaked every coworker's role.
    if (!currentUsers || !currentUsers.length) {
      try {
        const { httpsCallable } = await import('firebase/functions');
        const { functions } = await import('../lib/firebase');
        const res = await httpsCallable(functions, 'getMyTenantRole')({});
        const me = res?.data;
        if (me && me.role) {
          const stub = { email: user.email, role: me.role };
          if (me.techName) stub.techName = me.techName;
          if (me.scheduleAccess) stub.scheduleAccess = me.scheduleAccess;
          currentUsers = [stub];
          setMyRecord(stub);
        }
      } catch (_) { /* unauthenticated, denied, or pending — fall through */ }
    } else {
      // Admin path — `_rec` already comes from users[]; clear any stale
      // myRecord (e.g., a role-change since last login).
      setMyRecord(null);
    }

    if (ALLOWED_EMAILS.includes(user.email)) {
      let rec = currentUsers.find(u => u.email === user.email);
      if (!rec) {
        rec = { email: user.email, name: user.displayName || user.email, picture: user.photoURL || '', role: 'admin', requestedAt: new Date().toISOString(), grantedAt: new Date().toISOString() };
        const updated = [...currentUsers, rec];
        setUsers(updated);
        await saveUsers(updated);
      } else if (rec.role !== 'admin') {
        const updated = currentUsers.map(u => u.email === user.email ? { ...u, role: 'admin', grantedAt: new Date().toISOString() } : u);
        setUsers(updated);
        await saveUsers(updated);
      } else if (loadedData?.staffEmails == null || loadedData?.adminEmails == null) {
        // Self-heal: pre-rules-update tenants don't have staffEmails /
        // adminEmails yet — re-save so the new tenant-scoped rules can
        // authorize staff and recognize app-level admins.
        ensureStaffEmailsBackfill(currentUsers);
      }
      setGUser(user);
      setLoggerUser(user);
      startLogoutTimer(user, currentTimeoutMin);
      logActivity('user_login', `${user.email} (admin)`);
      return { ok: true };
    }

    const rec = currentUsers.find(u => u.email === user.email);
    if (!rec) {
      // Check if this email belongs to a client (customer portal)
      try {
        const clientRecord = await fetchClientByEmail(user.email);
        if (clientRecord) {
          setGUser(user);
          setLoggerUser(user);
          setPortalClientId(clientRecord.id);
          logActivity('portal_login', user.email);
          return { ok: true };
        }
      } catch (_) {}

      // Write to requests collection (any authenticated user can write their own)
      try {
        await submitAccessRequest(user.uid, {
          email:   user.email,
          name:    user.displayName || user.email,
          picture: user.photoURL || '',
        });
        logActivity('access_requested', user.email);
      } catch (e) {
        console.error('[Auth] access request write failed:', e);
      }
      await fbSignOut(auth);
      return { ok: false, reason: 'Access requested. An admin will grant you access.' };
    }
    if (rec.role === 'pending') { logActivity('login_blocked', 'pending', user.email); await fbSignOut(auth); return { ok: false, reason: 'Your access request is pending admin approval.' }; }
    if (rec.role === 'denied')  { logActivity('login_blocked', 'denied',  user.email); await fbSignOut(auth); return { ok: false, reason: 'Access denied. Contact an administrator.' }; }

    setGUser(user);
    setLoggerUser(user);
    startLogoutTimer(user, currentTimeoutMin);
    logActivity('user_login', `${user.email} (${rec.role})`);

    // Check if this non-admin user needs to sign (or re-sign) the handbook
    try {
      const hbk = await fetchHandbook();
      if (hbk?.content && hbk?.version) {
        const sig = await fetchMyHandbookSig(user.uid);
        if (!sig || sig.version !== hbk.version) {
          setHandbookDoc(hbk);
          setHandbookPending(true);
        }
      }
    } catch {}

    return { ok: true };
  }

  // ── Slide ops ──────────────────────────────────────────
  const persistSlides = useCallback(async (newSlides, newDef, newCur) => {
    setSlides(newSlides); setDef(newDef); setCur(newCur);
    setSyncDot('syncing');
    try { await saveSlides(newSlides, newDef, newCur); setSyncDot('ok'); }
    catch (e) { setSyncDot('err'); showToast('Save failed — ' + e.message, 4000); }
  }, [showToast]);

  const addSlide    = useCallback(async (slide) => { const ns = [...slides, slide]; await persistSlides(ns, def, ns.length - 1); }, [slides, def, persistSlides]);
  const updateSlide = useCallback(async (i, slide) => { const ns = slides.map((s, idx) => idx === i ? slide : s); await persistSlides(ns, def, cur); }, [slides, def, cur, persistSlides]);
  const deleteSlide = useCallback(async (i) => {
    const ns  = slides.filter((_, idx) => idx !== i);
    const nd  = ns.length ? Math.min(def, ns.length - 1) : 0;
    const nc  = ns.length ? Math.min(i, ns.length - 1)   : 0;
    await persistSlides(ns, nd, nc);
  }, [slides, def, persistSlides]);
  const setDefault  = useCallback(async (i) => { await persistSlides(slides, i, cur); }, [slides, cur, persistSlides]);

  // ── User ops ───────────────────────────────────────────
  // techName is preserved across role changes — an admin or scheduler
  // who's also a working tech can keep their tech identity, which the
  // HomeScreen "My tech view" toggle keys off of. Pass `techName: null`
  // explicitly to clear it.
  const grantAccess = useCallback(async (email, role, techName, scheduleAccess) => {
    const prev    = users.find(u => u.email === email)?.role;
    const updated = users.map(u => u.email === email ? {
      ...u, role,
      techName: techName !== undefined ? techName : (u.techName || null),
      // 'edit' (default) | 'view'. Only meaningful for the 'tech' role; the
      // rules' scheduleViewOnlyEmails projection ignores it for other roles.
      scheduleAccess: scheduleAccess !== undefined ? scheduleAccess : (u.scheduleAccess || 'edit'),
      grantedAt: new Date().toISOString(),
    } : u);
    setUsers(updated);
    logActivity('access_changed', `${email} ${prev}→${role}`);
    setSyncDot('syncing');
    try { await saveUsers(updated); setSyncDot('ok'); showToast('Access updated'); }
    catch (e) { setSyncDot('err'); showToast('Save failed: ' + e.message, 4000); }
  }, [users, showToast]);

  // ── Bulk: create tech user records for missing employees ──
  // Given a list of employees, creates a 'tech' user for each one that doesn't
  // already have a user record. Matching is done first by email (when set),
  // then by techName so we don't duplicate techs that already have access.
  // Employees without an email get a placeholder address the admin can replace
  // later — better than dropping them silently, since the rest of their profile
  // (name, photo, instagram, phone) is still useful for the user record.
  const addTechUsersForEmployees = useCallback(async (employeeList) => {
    const existingEmails    = new Set(users.map(u => (u.email || '').toLowerCase()).filter(Boolean));
    const existingTechNames = new Set(users.map(u => (u.techName || '').toLowerCase()).filter(Boolean));

    function slugify(name) {
      return (name || 'tech').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    }

    const candidates = (employeeList || []).filter(e => {
      const email = (e.email || '').trim().toLowerCase();
      const tn    = (e.name  || '').trim().toLowerCase();
      if (email && existingEmails.has(email)) return false;
      if (tn && existingTechNames.has(tn))    return false;
      return true;
    });
    if (candidates.length === 0) return { added: 0, placeholders: 0 };

    let placeholders = 0;
    const newUsers = candidates.map(e => {
      const realEmail = (e.email || '').trim();
      const email = realEmail || `${slugify(e.name)}@pending.meraki.local`;
      if (!realEmail) placeholders++;
      return {
        email,
        name:        e.name || email,
        picture:     e.photo || '',
        role:        'tech',
        techName:    e.name || null,
        phone:       e.phone || '',
        instagram:   e.instagram || '',
        emailPending: !realEmail || undefined,  // marker the admin can spot in the row
        grantedAt:   new Date().toISOString(),
      };
    });
    const updated = [...users, ...newUsers];
    setUsers(updated);
    setSyncDot('syncing');
    try {
      await saveUsers(updated);
      setSyncDot('ok');
      logActivity('tech_users_bulk_added', `${newUsers.length} techs: ${newUsers.map(u => u.techName || u.email).join(', ')}`);
      return { added: newUsers.length, placeholders };
    } catch (e) {
      setSyncDot('err');
      throw e;
    }
  }, [users]);

  // ── Pending access requests ────────────────────────────
  const loadPendingRequests = useCallback(() => fetchAccessRequests(), []);

  const grantPendingAccess = useCallback(async (req, role, techName) => {
    const newUser = {
      email:       req.email,
      name:        req.name,
      picture:     req.picture || '',
      role,
      techName:    role === 'tech' ? (techName || null) : null,
      requestedAt: req.requestedAt || new Date().toISOString(),
      grantedAt:   new Date().toISOString(),
    };
    const updated = [...users, newUser];
    setUsers(updated);
    logActivity('access_changed', `${req.email} pending→${role}`);
    setSyncDot('syncing');
    try {
      await saveUsers(updated);
      await deleteAccessRequest(req.uid);
      setSyncDot('ok');
      showToast('Access updated');
    } catch (e) {
      setSyncDot('err');
      showToast('Save failed: ' + e.message, 4000);
    }
  }, [users, showToast]);

  // ── Settings ops ───────────────────────────────────────
  const updateSettings = useCallback(async (next) => {
    setSettings(next);
    startLogoutTimer(gUser, next.timeoutMin);
    logActivity('settings_saved', `timeout=${next.timeoutMin}min, PIN=${next.adminPin ? 'enabled' : 'disabled'}`);
    setSyncDot('syncing');
    try { await saveSettings(next); setSyncDot('ok'); showToast('Settings saved'); }
    catch { setSyncDot('err'); showToast('Save failed', 3000); }
  }, [gUser, startLogoutTimer, showToast]);

  // ── Handbook signing ──────────────────────────────────
  const signHandbook = useCallback(async () => {
    if (!gUser || !handbookDoc) return;
    await signHandbookDoc(gUser.uid, {
      version: handbookDoc.version,
      email:   gUser.email,
      name:    gUser.displayName || gUser.email,
    });
    logActivity('handbook_signed', `v${handbookDoc.version} by ${gUser.email}`);
    setHandbookPending(false);
    setHandbookDoc(null);
  }, [gUser, handbookDoc]);

  // ── Magic link auth ────────────────────────────────────
  async function doCompleteMagicLink(email) {
    try {
      await signInWithEmailLink(auth, email, window.location.href);
      window.localStorage.removeItem('emailForSignIn');
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (e) {
      console.error('[MagicLink]', e);
      showToast('Sign-in link was invalid or expired.', 4000);
    } finally {
      setMagicLinkPending(false);
    }
  }

  useEffect(() => {
    if (!isSignInWithEmailLink(auth, window.location.href)) return;
    const savedEmail = window.localStorage.getItem('emailForSignIn');
    if (savedEmail) {
      doCompleteMagicLink(savedEmail);
    } else {
      setMagicLinkPending(true);
    }
  }, []); // eslint-disable-line

  const sendMagicLink = useCallback(async (email) => {
    await sendSignInLinkToEmail(auth, email, {
      url: window.location.origin,
      handleCodeInApp: true,
    });
    window.localStorage.setItem('emailForSignIn', email);
  }, []);

  const completeMagicLink = useCallback((email) => doCompleteMagicLink(email), []); // eslint-disable-line

  // ── Chat unread badge ──────────────────────────────────
  useEffect(() => {
    if (!gUser || portalClientId) return;
    const unsub = subscribeToChats(threads => {
      setTotalChatUnread(threads.reduce((s, t) => s + (t.unreadStaff || 0), 0));
    });
    return unsub;
  }, [gUser, portalClientId]); // eslint-disable-line

  // ── Top-bar notifications subscription ─────────────────
  useEffect(() => {
    if (!gUser || portalClientId) return;
    const unsub = subscribeToRecentNotifications(20, list => setRecentNotifs(list));
    return unsub;
  }, [gUser, portalClientId]); // eslint-disable-line

  const markNotifRead = useCallback(async (id) => {
    if (!gUser?.email || !id) return;
    try { await markNotificationRead(id, gUser.email); } catch (_) {}
  }, [gUser]);

  const unreadNotifCount = recentNotifs.filter(n => !(n.readBy || []).includes(gUser?.email)).length;

  // ── Sign in / out ──────────────────────────────────────
  const signIn = useCallback(async () => {
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      return await checkUserAccess(result.user);
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') return { ok: false, reason: 'Sign-in failed: ' + e.message };
      return { ok: false, reason: '' };
    }
  }, []); // eslint-disable-line

  // Sign in with Apple (web popup). Same access/role check as Google — works for
  // staff and clients. Needs the Apple provider enabled in the Firebase console
  // (Apple Services ID + key) before it succeeds.
  const appleSignIn = useCallback(async () => {
    try {
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      const result = await signInWithPopup(auth, provider);
      return await checkUserAccess(result.user);
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') return { ok: false, reason: 'Sign-in failed: ' + e.message };
      return { ok: false, reason: '' };
    }
  }, []); // eslint-disable-line

  const switchAccount = useCallback(async () => {
    clearTimeout(logoutTimer.current);
    await fbSignOut(auth);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      return await checkUserAccess(result.user);
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') showToast('Sign-in failed: ' + e.message, 4000);
      return { ok: false };
    }
  }, [showToast]); // eslint-disable-line

  const signOut = useCallback(async () => {
    logActivity('user_logout');
    clearTimeout(logoutTimer.current);
    await fbSignOut(auth);
    showToast('Signed out');
  }, [showToast]);

  const activeTheme = useMemo(() => {
    if (settings?.autoTheme) {
      const auto = detectAutoTheme();
      if (auto) return auto;
    }
    return getTheme(settings?.themeId);
  }, [settings?.themeId, settings?.autoTheme]);

  // Self-record lookup. Admin reads users[] (rich) from data/usersFull;
  // non-admin gets the slim record (`{ role, techName? }`) from the
  // `getMyTenantRole` callable in checkUserAccess, stored in myRecord.
  // Fall back to that when users[] doesn't contain the caller.
  const _rec = gUser
    ? (users.find(u => u.email === gUser.email) || myRecord || null)
    : null;
  const realIsAdmin = _rec?.role === 'admin';
  const isAdmin     = viewAs ? false : realIsAdmin;
  const isReadOnly  = viewAs ? viewAs.role === 'readonly' : ['admin', 'readonly'].includes(_rec?.role);
  const isTech      = viewAs?.role === 'tech'      ? true : _rec?.role === 'tech';
  const isScheduler = viewAs?.role === 'scheduler' ? true : _rec?.role === 'scheduler';
  const myTechName  = viewAs?.role === 'tech' ? (viewAs.techName || null) : (viewAs ? null : (_rec?.techName || null));
  const isPortalUser = !!portalClientId;

  // Per-tech schedule permission. Admins/schedulers always edit; only a
  // 'tech' explicitly set to view-only is restricted. The Firestore rules
  // enforce this server-side (scheduleViewOnlyEmails) — this flag just drives
  // the UI. viewAs impersonation carries its own scheduleAccess for preview.
  const effScheduleAccess = viewAs?.role === 'tech'
    ? (viewAs.scheduleAccess || 'edit')
    : (_rec?.scheduleAccess || 'edit');
  const canEditOwnSchedule = !(isTech && effScheduleAccess === 'view');

  // Canary tier + feature flags — see src/lib/featureFlags.js for the
  // resolution chain. Stored on data/settings (already loaded above),
  // so this is essentially free — no extra read. Tier defaults to
  // 'free' for new self-service tenants; existing tenants are
  // backfilled by scripts/backfill-tier.cjs.
  //
  // Consumers use `hasFeature('name')` from useApp(), which is just
  // isFeatureOn() pre-bound to the current tenant context.
  const tenantCtx  = { tier: settings?.tier || 'free', featureFlags: settings?.featureFlags || {} };
  const hasFeature = (name) => isFeatureOn(name, tenantCtx);

  return (
    <Ctx.Provider value={{
      slides, def, cur, setCur,
      users, settings, setSettings,
      gUser, syncState, toast, toastAction, loaded, isOnline,
      isAdmin, isReadOnly, isTech, isScheduler, myTechName, canEditOwnSchedule, realIsAdmin, viewAs, setViewAs,
      isPortalUser, portalClientId,
      showToast, resetInactivity, resetLogoutTimer, pauseLogoutTimer, resumeLogoutTimer,
      addSlide, updateSlide, deleteSlide, setDefault,
      grantAccess, grantPendingAccess, addTechUsersForEmployees, loadPendingRequests, updateSettings,
      signIn, appleSignIn, signOut, switchAccount, sendMagicLink, completeMagicLink, magicLinkPending,
      handbookPending, handbookDoc, signHandbook,
      totalChatUnread,
      recentNotifs, unreadNotifCount, markNotifRead,
      ticket, ticketCount, addApptToTicket, removeApptFromTicket, addProductToTicket, setTicketProductQty, clearTicket,
      ticketCheckoutOpen, setTicketCheckoutOpen,
      requirePin, pinPrompt, acceptPinPrompt, dismissPinPrompt,
      activeTheme,
      tenantCtx, hasFeature,
    }}>
      {children}
    </Ctx.Provider>
  );
}
