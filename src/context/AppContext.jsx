import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getTheme, detectAutoTheme } from '../lib/themes';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { auth, ALLOWED_EMAILS } from '../lib/firebase';
import { loadAll, saveSlides, saveUsers, saveSettings, submitAccessRequest, fetchAccessRequests, deleteAccessRequest, fetchHandbook, fetchMyHandbookSig, signHandbookDoc, fetchClientByEmail, subscribeToChats, subscribeToRecentNotifications, markNotificationRead } from '../lib/firestore';
import { migrateFromLegacy } from '../lib/migration';
import { logActivity, setLoggerUser } from '../lib/logger';
import { phSVG } from '../utils/helpers';

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
  const [settings, setSettings] = useState({ timeoutMin: 5 });
  const [gUser,           setGUser]           = useState(null);
  const [syncState,       setSyncState]       = useState('idle');
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
    clearTimeout(logoutTimer.current);
    logoutTimer.current = setTimeout(() => {
      if (user) { fbSignOut(auth); showToast(`Auto-logged out after ${timeoutMin} min inactivity`); }
    }, (timeoutMin || 5) * 60 * 1000);
  }, [showToast]);

  const resetLogoutTimer = useCallback(() => {
    if (gUser) startLogoutTimer(gUser, settings.timeoutMin);
  }, [gUser, settings.timeoutMin, startLogoutTimer]);

  // ── Firestore load ─────────────────────────────────────
  useEffect(() => {
    (async () => {
      setSyncDot('syncing');
      await migrateFromLegacy();
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
    try {
      const data = await loadAll();
      currentUsers = data.users;
      currentTimeoutMin = data.settings?.timeoutMin || currentTimeoutMin;
      setUsers(currentUsers);
      setSettings(s => ({ ...s, ...data.settings }));
    } catch (_) {}

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
  const grantAccess = useCallback(async (email, role, techName) => {
    const prev    = users.find(u => u.email === email)?.role;
    const updated = users.map(u => u.email === email ? {
      ...u, role,
      techName: role === 'tech' ? (techName !== undefined ? techName : u.techName) : null,
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

  const _rec        = gUser ? users.find(u => u.email === gUser.email) : null;
  const realIsAdmin = _rec?.role === 'admin';
  const isAdmin     = viewAs ? false : realIsAdmin;
  const isReadOnly  = viewAs ? viewAs.role === 'readonly' : ['admin', 'readonly'].includes(_rec?.role);
  const isTech      = viewAs?.role === 'tech'      ? true : _rec?.role === 'tech';
  const isScheduler = viewAs?.role === 'scheduler' ? true : _rec?.role === 'scheduler';
  const myTechName  = viewAs?.role === 'tech' ? (viewAs.techName || null) : (viewAs ? null : (_rec?.techName || null));
  const isPortalUser = !!portalClientId;

  return (
    <Ctx.Provider value={{
      slides, def, cur, setCur,
      users, settings,
      gUser, syncState, toast, toastAction, loaded,
      isAdmin, isReadOnly, isTech, isScheduler, myTechName, realIsAdmin, viewAs, setViewAs,
      isPortalUser, portalClientId,
      showToast, resetInactivity, resetLogoutTimer,
      addSlide, updateSlide, deleteSlide, setDefault,
      grantAccess, grantPendingAccess, addTechUsersForEmployees, loadPendingRequests, updateSettings,
      signIn, signOut, switchAccount, sendMagicLink, completeMagicLink, magicLinkPending,
      handbookPending, handbookDoc, signHandbook,
      totalChatUnread,
      recentNotifs, unreadNotifCount, markNotifRead,
      ticket, ticketCount, addApptToTicket, removeApptFromTicket, addProductToTicket, setTicketProductQty, clearTicket,
      ticketCheckoutOpen, setTicketCheckoutOpen,
      requirePin, pinPrompt, acceptPinPrompt, dismissPinPrompt,
      activeTheme,
    }}>
      {children}
    </Ctx.Provider>
  );
}
