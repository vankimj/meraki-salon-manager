import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut as fbSignOut,
         sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
         RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { auth, callFn } from '../lib/firebase';
import { TENANT_ID } from '../lib/tenant';
import {
  fetchServices, fetchEmployees, fetchBookingConfig, fetchWebfrontConfig,
  fetchAppointments, fetchAppointmentsByRange, createAppointment, createClient,
  saveBookingConfig, fetchTurnRoster, callMyClientRecord,
} from '../lib/firestore';
import { getTheme, detectAutoTheme } from '../lib/themes';
import { groupByCategory, formatPrice, formatDuration, resolveServicePricing } from '../utils/serviceHelpers';
import {
  strToMins,
  techCanDo, techsForService, techsForServices,
  cartTotalDuration, isTechFreeAt, firstFreeTech, getSlots,
} from '../lib/booking';
import { pickTech, startOfWeek, endOfWeek, DEFAULT_ASSIGNMENT_METHOD } from '../lib/techAssignment';

// ── constants ──────────────────────────────────────────

const CATEGORY_COLORS = {
  'Manicures': 'var(--tm-primary, #2D7A5F)', 'Pedicures': 'var(--tm-accent, #3D95CE)', 'Gel Nails': '#8B5CF6',
  'Acrylics':  '#F59E0B', 'Nail Art':  '#EC4899', 'Waxing':    '#14B8A6',
  'Eyebrows':  '#6366F1',
};
const CATEGORY_ICONS = {
  'Manicures': '💅', 'Pedicures': '🦶', 'Gel Nails': '✨',
  'Acrylics':  '💎', 'Nail Art':  '🎨', 'Waxing':    '🌸',
  'Eyebrows':  '👁️',
};

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// Cart rules — fully admin-driven via per-service flags in the Services tile:
//   • maxInCart      (Number, default 1) — max copies of this service per booking
//   • categoryExclusive (Boolean)        — block adding while another exclusive
//                                          service from the same category is in cart
// Sensible defaults: most services 1×, Removal 2× (set via maxInCart=2),
// Manicures + Pedicures = categoryExclusive (one set of hands, one of feet).

function maxInCart(svc) {
  const n = Number(svc?.maxInCart);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Returns null if the service can be added, or a reason code if it can't.
// Reasons drive different greyed-out labels in the ServiceRow.
function whyCantAddService(svc, cart) {
  if (!svc) return 'invalid';
  const count = cart.filter(i => i.service.id === svc.id).length;
  if (count >= maxInCart(svc)) return 'duplicate';
  if (svc.categoryExclusive && svc.category) {
    const clash = cart.some(i =>
      i.service.id !== svc.id
      && i.service.category === svc.category
      && i.service.categoryExclusive === true
    );
    if (clash) return 'category-exclusive';
  }
  return null;
}
function canAddService(svc, cart) { return whyCantAddService(svc, cart) === null; }

// Lane assignment — splits a cart into mani / pedi lanes so two stylists
// can each take a back-to-back appointment for one client.
//
// Rules:
//   • categoryExclusive=true services live in their own category's lane
//   • Other items (Removal, Nail Art, etc.) join the lane of their
//     parentSvcId if linked; otherwise they fall back to whichever lane
//     has a base service (mani preferred when both exist).
function getLane(item, cart) {
  if (!item?.service) return null;
  // Base services use their own category.
  if (item.service.categoryExclusive === true) {
    return item.service.category || null;
  }
  // Linked add-ons follow their parent.
  if (item.parentSvcId) {
    const parent = cart.find(i => i.service.id === item.parentSvcId);
    if (parent?.service?.category) return parent.service.category;
  }
  // Orphan add-ons: prefer mani, then pedi, else null.
  const hasMani = cart.some(i => i.service.categoryExclusive && i.service.category === 'Manicures');
  if (hasMani) return 'Manicures';
  const hasPedi = cart.some(i => i.service.categoryExclusive && i.service.category === 'Pedicures');
  if (hasPedi) return 'Pedicures';
  return null;
}

// Returns { Manicures: items[], Pedicures: items[], _orphan: items[] }.
function cartLanes(cart) {
  const out = { Manicures: [], Pedicures: [], _orphan: [] };
  for (const item of cart) {
    const lane = getLane(item, cart);
    if (lane === 'Manicures' || lane === 'Pedicures') out[lane].push(item);
    else out._orphan.push(item);
  }
  return out;
}

// Does this cart need TWO stylists picked (one per lane)? True only when
// BOTH a Manicures base service AND a Pedicures base service are present.
function isMultiLane(cart) {
  const hasMani = cart.some(i => i.service.categoryExclusive && i.service.category === 'Manicures');
  const hasPedi = cart.some(i => i.service.categoryExclusive && i.service.category === 'Pedicures');
  return hasMani && hasPedi;
}

// ── helpers ────────────────────────────────────────────
function minsToStr(m) {
  const h = Math.floor(m / 60), min = m % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${min.toString().padStart(2, '0')} ${ampm}`;
}
function fmtDate(str) {
  if (!str) return '';
  return new Date(str + 'T12:00:00').toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric' });
}
function todayDate() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function dateStr(d) { return d.toISOString().slice(0, 10); }

function firstName(s) {
  return (s || '').trim().split(/\s+/)[0].toLowerCase();
}

// Detect whether the user is typing an email vs a phone vs nothing yet.
// Anything containing '@' is treated as email (covers partially-typed). If
// the trimmed string has any digit and no '@', treat as phone. Empty falls
// through to 'unknown' so we can show both call-to-actions.
function detectAuthInputKind(s) {
  const v = (s || '').trim();
  if (!v) return 'unknown';
  if (v.includes('@')) return 'email';
  if (/\d/.test(v))    return 'phone';
  return 'unknown';
}

// Normalize a US-style phone to E.164 (+1XXXXXXXXXX). Returns null for
// anything that isn't a clean 10-digit (or 11-digit-leading-1) number.
// We deliberately don't try to support international yet — the salon's
// client base is local and Firebase Phone Auth bills per-region. Tighten
// rather than guess.
function toE164(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  return null;
}

function applyThemeVars(theme) {
  const r = document.documentElement;
  r.style.setProperty('--tm-primary',   theme.primary);
  r.style.setProperty('--tm-accent',    theme.accent);
  r.style.setProperty('--tm-grad',      `linear-gradient(135deg,${theme.gradStart},${theme.gradEnd})`);
  r.style.setProperty('--tm-grad-dark', `linear-gradient(135deg,${theme.dark},${theme.gradStart})`);
  r.style.setProperty('--tm-dark',      theme.dark);
}


// ── main component ─────────────────────────────────────
export default function BookingScreen() {
  const [loading,  setLoading]  = useState(true);
  const [cfg,      setCfg]      = useState(null);
  const [services, setServices] = useState([]);
  const [techs,    setTechs]    = useState([]);
  const [theme,    setTheme]    = useState(getTheme('meraki'));
  const [webCfg,   setWebCfg]   = useState(null);

  // auth
  const [gUser,   setGUser]   = useState(undefined); // undefined=loading, null=signed out
  const [client,  setClient]  = useState(null);      // matching client record if found

  // wizard. step 0 = flow chooser, 1..5 = steps. Default to 0 so the user
  // explicitly picks a path; once chosen, flow is locked for this session.
  const [step,    setStep]    = useState(0);
  const [flow,    setFlow]    = useState(null);   // 'time-first' | 'tech-first'
  const [pickedTech, setPickedTech] = useState(null); // populated in tech-first mode
  // Multi-service cart. Each item: { id, service, option, removal }.
  // The whole cart is booked as ONE appointment with a single tech, single
  // date, single start time and a summed duration — see cartTech / cartDate /
  // cartSlot below.
  const [cart, setCart] = useState([]);
  // Cart-level tech / date / slot (shared by every service in the cart).
  // cartTech: undefined=not picked, null=no preference, {…}=specific tech.
  // Used for single-lane carts (mani-only OR pedi-only OR add-ons-only).
  const [cartTech, setCartTech] = useState(undefined);
  // cartTechByLane: only populated when cart has BOTH a manicure and a
  // pedicure base service. Each lane gets its own pick — mani tech does the
  // mani services + linked Removal, pedi tech does the pedi services + linked
  // Removal, back-to-back at the booked start time. Same semantics as
  // cartTech (undefined/null/{...}) per lane.
  const [cartTechByLane, setCartTechByLane] = useState({ Manicures: undefined, Pedicures: undefined });
  const [cartDate, setCartDate] = useState('');
  const [cartSlot, setCartSlot] = useState(null);
  // Per-date appointment cache for the slot picker.
  const [apptsByDate, setApptsByDate] = useState({});
  const [form,    setForm]    = useState({ name: '', phone: '', email: '', notes: '', optInSms: false, optInEmail: false });
  const [submitting,      setSubmitting]      = useState(false);
  const [bookingError,    setBookingError]    = useState('');
  const [confirmed,       setConfirmed]       = useState(null);
  const [emailLinkState,  setEmailLinkState]  = useState(null); // null|'sending'|'sent'|'error'
  const [emailLinkDevice, setEmailLinkDevice] = useState(false); // cross-device: need email to finish
  // SMS OTP state. otpState: null|'sending'|'awaiting-code'|'verifying'|'error'
  const [otpState,        setOtpState]        = useState(null);
  const [otpError,        setOtpError]        = useState('');
  const [otpPhonePretty,  setOtpPhonePretty]  = useState('');
  const otpConfirmation   = useRef(null);
  const recaptchaVerifier = useRef(null);
  // When the booking auth matches an existing client but they haven't been
  // seen in >180 days AND we matched on phone alone, the server withholds
  // ALL client PII (phone-recycling defense) and returns only a first
  // initial. We surface a modal informing the visitor — no PII has been or
  // will be released to this session; the modal is transparency + UX, not
  // a security gate.
  const [pendingFirstInitial, setPendingFirstInitial] = useState(null);

  // Complete email-link sign-in if returning from magic link
  useEffect(() => {
    if (!isSignInWithEmailLink(auth, window.location.href)) return;
    const stored = localStorage.getItem('meraki_booking_email');
    if (stored) {
      signInWithEmailLink(auth, stored, window.location.href)
        .then(() => {
          localStorage.removeItem('meraki_booking_email');
          window.history.replaceState({}, '', '/book');
        })
        .catch(e => console.error('[EmailLink]', e.message));
    } else {
      setEmailLinkDevice(true);
    }
  }, []); // eslint-disable-line

  async function sendEmailLink(email) {
    setEmailLinkState('sending');
    try {
      await sendSignInLinkToEmail(auth, email.trim(), {
        url: `${window.location.origin}/book`,
        handleCodeInApp: true,
      });
      localStorage.setItem('meraki_booking_email', email.trim());
      setEmailLinkState('sent');
    } catch (e) {
      console.error('[EmailLink send]', e.message);
      setEmailLinkState('error');
    }
  }

  // SMS OTP — lazy-initialize the invisible reCAPTCHA verifier on first send,
  // then signInWithPhoneNumber stashes a ConfirmationResult we use to verify
  // the user-entered 6-digit code. The verifier MUST attach to a DOM node
  // that exists at call time — we render a hidden #recaptcha-container near
  // the auth UI for this.
  async function sendOtp(phoneRaw) {
    const e164 = toE164(phoneRaw);
    if (!e164) {
      setOtpError('Please enter a 10-digit US phone number.');
      setOtpState('error');
      return;
    }
    setOtpError('');
    setOtpState('sending');
    try {
      if (!recaptchaVerifier.current) {
        recaptchaVerifier.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible',
        });
      }
      const conf = await signInWithPhoneNumber(auth, e164, recaptchaVerifier.current);
      otpConfirmation.current = conf;
      const last4 = e164.slice(-4);
      setOtpPhonePretty(`•••-${last4}`);
      setOtpState('awaiting-code');
    } catch (e) {
      console.error('[OTP send]', e.code, e.message);
      // Reset verifier on failure so a retry creates a fresh one — stale
      // verifiers throw on second use after some error states.
      try { recaptchaVerifier.current?.clear(); } catch (_) {}
      recaptchaVerifier.current = null;
      // Map a couple of common Firebase error codes to friendlier copy;
      // everything else falls through to a generic message.
      if (e.code === 'auth/invalid-phone-number')      setOtpError('That number doesn\'t look right. Check the digits.');
      else if (e.code === 'auth/too-many-requests')    setOtpError('Too many attempts. Try again in a few minutes.');
      else if (e.code === 'auth/quota-exceeded')       setOtpError('SMS quota reached for now. Use email or Google instead.');
      else                                             setOtpError('Couldn\'t send code. Use email or Google instead.');
      setOtpState('error');
    }
  }

  async function verifyOtp(code) {
    if (!otpConfirmation.current) return;
    const trimmed = (code || '').replace(/\D/g, '');
    if (trimmed.length !== 6) {
      setOtpError('Enter the 6-digit code from the text.');
      return;
    }
    setOtpState('verifying');
    setOtpError('');
    try {
      await otpConfirmation.current.confirm(trimmed);
      // Success — onAuthStateChanged will pick up the new auth user and
      // run the client lookup. We clear OTP-local state but leave the
      // verifier in place; sign-out will clear it.
      otpConfirmation.current = null;
      setOtpState(null);
    } catch (e) {
      console.error('[OTP verify]', e.code, e.message);
      if (e.code === 'auth/invalid-verification-code') setOtpError('That code didn\'t match. Try again.');
      else if (e.code === 'auth/code-expired')         setOtpError('Code expired. Send a new one.');
      else                                             setOtpError('Couldn\'t verify code. Try again or use email.');
      setOtpState('awaiting-code');
    }
  }

  function resetOtp() {
    otpConfirmation.current = null;
    try { recaptchaVerifier.current?.clear(); } catch (_) {}
    recaptchaVerifier.current = null;
    setOtpState(null);
    setOtpError('');
    setOtpPhonePretty('');
  }

  // listen for auth state (Google / magic link / SMS OTP all land here).
  // The booking page can't read `clients` directly — rules gate that to
  // staff. We go through the `getMyClientRecord` callable, which trusts
  // the token's verified email/phone claims and returns the caller's own
  // slim record.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      setGUser(user || null);
      if (!user) { setClient(null); setPendingFirstInitial(null); return; }
      try {
        const res = await callMyClientRecord();
        if (res?.banned) {
          // Server flagged this caller as banned. Don't pre-fill; the
          // booking-submit path also re-checks server-side and rejects.
          setClient({ banned: true });
          return;
        }
        if (res?.requiresIdentityConfirm) {
          // Server withheld PII because the matched record is stale (>180d)
          // and we authed by phone alone. No client object is ever delivered
          // in this case — we just notify the visitor with a first initial.
          setClient(null);
          setPendingFirstInitial(res.firstInitial || '?');
          setForm(f => ({
            ...f,
            phone: f.phone || user.phoneNumber || '',
          }));
          return;
        }
        const c = res?.client || null;
        if (!c) {
          // Authed but no matching client record yet — pre-fill what the
          // auth provider gives us (Google displayName / email; phone for
          // OTP) and let Step4 collect the rest.
          setClient(null);
          setForm(f => ({
            ...f,
            name:  f.name  || user.displayName || '',
            email: f.email || user.email       || '',
            phone: f.phone || user.phoneNumber || '',
          }));
          return;
        }
        // Defensive name-match for Google sign-in: if displayName disagrees
        // with the matched client's stored name, the email was likely typo'd
        // onto someone else's record. Don't prefill PII in that case.
        const googleNameClash =
          !!user.email && user.displayName &&
          firstName(c.name) !== firstName(user.displayName);
        if (googleNameClash) {
          setClient(null);
          setForm(f => ({
            ...f,
            name:  f.name  || user.displayName || '',
            email: f.email || user.email       || '',
          }));
          return;
        }
        setClient(c);
        setForm(f => ({
          ...f,
          name:  f.name  || c.name  || user.displayName || '',
          phone: f.phone || c.phone || user.phoneNumber || '',
          email: f.email || c.email || user.email       || '',
        }));
      } catch (e) {
        console.warn('[booking auth lookup]', e?.message);
        setClient(null);
      }
    });
    return unsub;
  }, []);

  function dismissPendingIdentity() {
    // No-op beyond hiding the modal. The server never released PII for this
    // session — the visitor proceeds with manual entry. If their typed phone
    // matches an existing record at book-submit, findOrCreateClient dedups
    // server-side (the existing accepted dedup boundary).
    setPendingFirstInitial(null);
  }

  useEffect(() => {
    Promise.all([fetchBookingConfig(), fetchServices(), fetchEmployees(), fetchWebfrontConfig()])
      .then(([c, svcs, emps, wf]) => {
        setCfg(c);
        setServices(svcs.filter(s => s.active !== false));
        setTechs(emps.filter(e => e.active !== false).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
        setWebCfg(wf || null);
        const t = wf?.autoTheme
          ? (detectAutoTheme() || getTheme(wf.themeId || 'meraki'))
          : getTheme(wf?.themeId || 'meraki');
        setTheme(t);
        applyThemeVars(t);
      })
      .catch(() => setCfg({ enabled: false }))
      .finally(() => setLoading(false));
  }, []);

  // Cart helpers ─────────────────────────────────────────
  // Removal-prompt state. Fires when a service with canRequireRemoval=true
  // gets added, UNLESS:
  //   • the user has already declined the prompt for that specific service, OR
  //   • any cart item already has removal:true (one removal covers the visit)
  // This way, adding Dip after declining Gel-X re-prompts (different
  // service), but adding Gel Manicure after accepting Gel-X stays quiet.
  const [removalPrompt, setRemovalPrompt] = useState(null);            // { cartItemId, svcName }
  const [declinedRemoval, setDeclinedRemoval] = useState(() => new Set()); // service ids the user said "No" to

  // The salon's actual "Removal" service from the menu (Add-ons category).
  // We add THIS as a separate cart item when a customer confirms they're
  // wearing a previous set — rather than toggling a side-flag — so the
  // booking carries real pricing + duration + options from the catalog.
  const removalSvc = services.find(s => /^removal$/i.test((s.name || '').trim()));

  function addToCart(svc, opt, extras = {}) {
    // Defense-in-depth: the ServiceRow + Add button is greyed out when the
    // service can't be added, but if any other path calls addToCart
    // (keyboard, deep-link, future code), enforce the rules here too.
    if (!canAddService(svc, cart)) return;
    const id = `cart_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    // extras.parentSvcId links a Removal cart item back to the mani/pedi it
    // was added for, so the booking flow can put each Removal in the right
    // lane when a customer has BOTH a mani and a pedi with different techs.
    setCart(c => [...c, { id, service: svc, option: opt || null, removal: false, parentSvcId: extras.parentSvcId || null }]);
    setCartTech(t => (t === undefined ? t : t));
    setCartSlot(null);
    // Removal prompt — only fires for "base" services (categoryExclusive +
    // canRequireRemoval). These represent a fresh set going onto hands or
    // feet, which is exactly when a previous removal would matter. Add-ons
    // (categoryExclusive=false) don't trigger because they're applied on top
    // of a base service whose removal already covers them.
    const isAddingRemoval = removalSvc && svc.id === removalSvc.id;
    const isBaseService   = svc.categoryExclusive === true && svc.canRequireRemoval;
    // How many base services (counting the new one) need removal vs how many
    // Removals are already booked? Prompt only if there's a gap.
    const baseInCart      = cart.filter(i => i.service.categoryExclusive === true && i.service.canRequireRemoval).length
                          + (isBaseService ? 1 : 0);
    const removalsInCart  = removalSvc ? cart.filter(i => i.service.id === removalSvc.id).length : 0;
    if (isBaseService && !isAddingRemoval && !declinedRemoval.has(svc.id) && removalsInCart < baseInCart) {
      // Pass the parent service id along so Yes adds a Removal LINKED to it.
      setRemovalPrompt({ svcName: svc.name, svcId: svc.id, parentSvcId: svc.id });
    }
  }
  function removeFromCart(itemId) {
    setCart(c => c.filter(i => i.id !== itemId));
    setCartSlot(null);
  }
  function updateCartItem(itemId, patch) {
    setCart(c => c.map(i => i.id === itemId ? { ...i, ...patch } : i));
    if (Object.prototype.hasOwnProperty.call(patch, 'removal')) setCartSlot(null);
  }

  // Lazy-fetch + cache appointments per date for any cart item that needs them.
  async function ensureApptsForDate(d) {
    if (!d || apptsByDate[d]) return;
    // Public booking page goes through the Cloud Function callable —
    // direct Firestore reads on the appointments collection are gated
    // to tenant staff (the doc holds full client PII). The callable
    // returns a minimal busy-slot slice with no client info.
    try {
      const res  = await callFn('getPublicAvailability')({ tenantId: TENANT_ID, dateStart: d, dateEnd: d });
      const list = res?.data?.appts || [];
      setApptsByDate(prev => ({ ...prev, [d]: list }));
    } catch {
      setApptsByDate(prev => ({ ...prev, [d]: [] }));
    }
  }

  async function handleGoogleSignIn() {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch { /* user cancelled */ }
  }
  async function handleSignOut() {
    await fbSignOut(auth);
    setClient(null);
    setPendingFirstInitial(null);
    resetOtp();
    setForm({ name: '', phone: '', email: '', notes: '', optInSms: false, optInEmail: false });
  }

  async function handleBook() {
    if (cart.length === 0 || !cartDate || cartSlot == null) return;
    setBookingError('');
    // Local-cached banned flag (set by callMyClientRecord on auth) — the
    // server also re-checks on book submit, so this is just a fast path.
    if (client?.banned) {
      setBookingError("We're not able to accept this booking online. Please call the salon to discuss.");
      return;
    }
    setSubmitting(true);
    try {
      // Resolve the booking to the right client record. We delegate to a
      // server-side findOrCreateClient because the public booking page
      // can't read the clients collection directly (firestore.rules
      // gate it to tenant staff). The function dedupes by email +
      // phone, refuses banned clients, and returns either an existing
      // client's id or a freshly minted one — preventing duplicate
      // records like Sonny / Son and blocking banned-customer booking
      // even if they try a different email or sign-in method.
      let clientId = client?.id || '';
      if (!clientId && form.name.trim() && (form.phone.trim() || form.email.trim() || gUser?.email)) {
        try {
          const res = await callFn('findOrCreateClient')({
            tenantId: TENANT_ID,
            name:     form.name.trim(),
            phone:    form.phone.trim(),
            email:    form.email.trim() || gUser?.email || '',
            extra: {
              picture: gUser?.photoURL || '',
              commPreferences: {
                // Transactional (appointment confirmations + reminders) is
                // always allowed under TCPA for clients we have a booking
                // relationship with. The toggles control MARKETING only.
                appointmentSms:   true,
                appointmentEmail: true,
                appointmentVoice: false,
                marketingSms:     form.optInSms   === true,
                marketingEmail:   form.optInEmail === true,
                marketingVoice:   false,
              },
              // Audit trail for TCPA / Twilio TFN verification. We record
              // the timestamp of explicit marketing opt-in so a reviewer
              // can confirm the consent moment for any given client.
              marketingOptInSmsAt:   form.optInSms   === true ? new Date().toISOString() : null,
              marketingOptInEmailAt: form.optInEmail === true ? new Date().toISOString() : null,
            },
          });
          if (res?.data?.banned) {
            setBookingError("We're not able to accept this booking online. Please call the salon to discuss.");
            setSubmitting(false);
            return;
          }
          clientId = res?.data?.id || '';
        } catch (e) { console.error('[Booking] findOrCreateClient failed:', e); }
      }

      const removalDur = 15;
      const removalPrice = Number(cfg?.removalPrice ?? 15);
      const dayAppts = apptsByDate[cartDate] || [];

      // Builds the merged services[] array (with legacy-flag removal lines
      // appended). Used per-lane in the multi-lane case and once for the
      // whole cart in the single-lane case.
      function buildServicesForItems(items, tech) {
        const out = [];
        items.forEach(item => {
          const { service: svc, option: opt } = item;
          const resolved = resolveServicePricing(svc, opt, tech);
          out.push({
            id: svc.id,
            name: opt?.name ? `${svc.name} — ${opt.name}` : svc.name,
            price: resolved.price || 0,
            duration: resolved.duration || 60,
            optionId: opt?.id || null,
            optionName: opt?.name || null,
            taxable: svc.taxable !== false,
          });
          // Legacy in-line removal flag (kept for back-compat). Modern
          // bookings use the standalone Removal cart item, which already
          // flows in via the items[] loop above.
          if (item.removal && svc.canRequireRemoval && removalPrice > 0) {
            out.push({
              id: 'removal',
              name: `Removal (${svc.name})`,
              price: removalPrice,
              duration: removalDur,
              isRemoval: true,
            });
          }
        });
        return out;
      }

      // Resolve a single tech for a set of cart items: explicit pick or
      // auto-assign via configured assignment method. Returns the resolved
      // tech (object or null) + updated round-robin index + requestType.
      const method = cfg?.assignmentMethod || DEFAULT_ASSIGNMENT_METHOD;
      let rrIdx = cfg?.roundRobinIndex || 0;
      const startingRrIdx = rrIdx;
      async function resolveTechForItems(items, pickedTech, startSlot) {
        let assigned = pickedTech;
        let requestType = 'specific';
        if (pickedTech === null) {
          requestType = 'auto';
          const elig = techsForServices(techs, items.map(c => c.service));
          const free = elig.filter(t => isTechFreeAt(t, startSlot, cartTotalDuration(items, removalDur, t), dayAppts));
          let weekAppts = [];
          if (method === 'leastBusyWeek' || method === 'lowestRevenueWeek') {
            const wk = startOfWeek(cartDate);
            weekAppts = await callFn('getPublicAvailability')({ tenantId: TENANT_ID, dateStart: wk, dateEnd: endOfWeek(wk) })
              .then(r => r?.data?.appts || []).catch(() => []);
          }
          let turnRoster = null;
          const today = dateStr(todayDate());
          if (method === 'turnQueue' && cartDate === today) {
            const r = await fetchTurnRoster(today).catch(() => null);
            turnRoster = (r && r.roster) || [];
          }
          const result = pickTech({ method, freeTechs: free, dayAppts, weekAppts, turnRoster, roundRobinIndex: rrIdx });
          assigned = result.tech || firstFreeTech(elig, startSlot, cartTotalDuration(items, removalDur), dayAppts);
          rrIdx = result.nextRoundRobinIndex;
        }
        return { tech: assigned, requestType };
      }

      // Build the appointment doc for one lane.
      function makeApptForLane(items, tech, requestType, startSlot) {
        const dur = cartTotalDuration(items, removalDur, tech);
        const h = Math.floor(startSlot / 60), m = startSlot % 60;
        return {
          date:        cartDate,
          startTime:   `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
          duration:    dur,
          techId:      tech?.id   || null,
          techName:    tech?.name || 'TBD',
          techRequestType: requestType,
          clientId,
          clientName:  form.name.trim(),
          clientPhone: form.phone.trim(),
          clientEmail: form.email.trim() || gUser?.email || null,
          services:    buildServicesForItems(items, tech),
          status:      'scheduled',
          notes:       form.notes.trim() || null,
          source:      'online_booking',
          createdAt:   new Date().toISOString(),
          updatedAt:   new Date().toISOString(),
        };
      }

      // Multi-lane: split into two appointments back-to-back. The mani
      // appointment runs first from cartSlot; the pedi appointment starts
      // immediately after the mani's duration. Linked via a shared
      // bookingGroupId so reports can recognize them as one client visit.
      const writtenAppts = [];
      let primaryTech = null;
      let primaryAppt = null;
      if (isMultiLane(cart)) {
        const lanes = cartLanes(cart);
        const maniItems = [...lanes.Manicures, ...lanes._orphan]; // orphans default to mani
        const pediItems = lanes.Pedicures;
        const { tech: maniTech, requestType: maniReq } = await resolveTechForItems(maniItems, cartTechByLane.Manicures, cartSlot);
        const maniDur = cartTotalDuration(maniItems, removalDur, maniTech);
        const pediStart = cartSlot + maniDur;
        const { tech: pediTech, requestType: pediReq } = await resolveTechForItems(pediItems, cartTechByLane.Pedicures, pediStart);
        const groupId = `bg_${Date.now()}_${Math.floor(Math.random()*9999)}`;
        const maniAppt = { ...makeApptForLane(maniItems, maniTech, maniReq, cartSlot), bookingGroupId: groupId, lane: 'Manicures' };
        const pediAppt = { ...makeApptForLane(pediItems, pediTech, pediReq, pediStart), bookingGroupId: groupId, lane: 'Pedicures' };
        await createAppointment(maniAppt);
        await createAppointment(pediAppt);
        writtenAppts.push(maniAppt, pediAppt);
        primaryTech = maniTech;
        primaryAppt = maniAppt;
      } else {
        // Single-lane: original flow, one tech, one appointment.
        const { tech, requestType } = await resolveTechForItems(cart, cartTech, cartSlot);
        const appt = makeApptForLane(cart, tech, requestType, cartSlot);
        await createAppointment(appt);
        writtenAppts.push(appt);
        primaryTech = tech;
        primaryAppt = appt;
      }

      // Persist round-robin counter so the next booking continues the cycle.
      if (rrIdx !== startingRrIdx && cfg) {
        try { await saveBookingConfig({ ...cfg, roundRobinIndex: rrIdx }); }
        catch (e) { console.warn('[Booking] roundRobin persist failed:', e); }
      }

      setConfirmed({ ...primaryAppt, _tech: primaryTech, _cartItems: cart, _allAppts: writtenAppts });
    } catch (e) {
      console.error('[Booking] failed:', e);
      alert('Booking failed. Please try again or call us.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || gUser === undefined) return <FullCenter><Spinner /></FullCenter>;
  if (!cfg?.enabled) return (
    <FullCenter>
      <div style={{ textAlign: 'center', maxWidth: 340, padding: 24 }}>
        <div style={{ fontSize: 44, marginBottom: 14 }}>📅</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>Online booking unavailable</div>
        <div style={{ fontSize: 14, color: '#888', lineHeight: 1.7 }}>Please call us or stop by to schedule your appointment.</div>
      </div>
    </FullCenter>
  );
  if (confirmed) return <SuccessScreen appts={confirmed} techs={techs} webCfg={webCfg} />;

  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', overflowX: 'hidden', background: '#f5f6f8', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>
      <Header
        step={step} cfg={cfg} flow={flow} webCfg={webCfg}
        gUser={gUser} client={client}
        onSignIn={handleGoogleSignIn}
        onSignOut={handleSignOut}
      />

      {emailLinkDevice && (
        <CrossDevicePrompt onDone={() => setEmailLinkDevice(false)} />
      )}

      {pendingFirstInitial && (
        <IdentityConfirmPrompt
          firstInitial={pendingFirstInitial}
          onDismiss={dismissPendingIdentity}
        />
      )}

      {removalPrompt && removalSvc && (
        <RemovalSuggestionModal
          svcName={removalPrompt.svcName}
          removalPrice={Number(resolveServicePricing(removalSvc, null).price || cfg?.removalPrice || 10)}
          editorial={webCfg?.layout === 'merakiSite'}
          onYes={() => {
            // Add the Removal service as a separate cart item — uses the
            // catalog's actual pricing + duration + (default) option. The
            // parentSvcId links this Removal back to the mani/pedi that
            // prompted it, so lane-based scheduling can keep them together.
            addToCart(removalSvc, removalSvc.options?.[0] || null, { parentSvcId: removalPrompt.parentSvcId });
            setRemovalPrompt(null);
          }}
          onNo={() => {
            setDeclinedRemoval(prev => {
              const next = new Set(prev);
              next.add(removalPrompt.svcId);
              return next;
            });
            setRemovalPrompt(null);
          }}
        />
      )}

      {/* Hidden DOM anchor for the invisible reCAPTCHA used by Phone Auth.
          Must exist at the time signInWithPhoneNumber is called. */}
      <div id="recaptcha-container" style={{ display: 'none' }} />

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '14px 12px 48px' }}>
        {/* Returning customer welcome */}
        {gUser && client && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f0f9f5', border: '1px solid #c3e6d8', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
            {gUser.photoURL
              ? <img src={gUser.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--tm-primary, #2D7A5F)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, flexShrink: 0 }}>
                  {client.name?.[0] || '?'}
                </div>
            }
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a6040' }}>Welcome back, {gUser.displayName?.split(' ')[0] || client.name?.split(' ')[0]}!</div>
              <div style={{ fontSize: 11, color: '#4a9070' }}>Your info will be pre-filled at checkout</div>
            </div>
          </div>
        )}

        {step === 0 && (
          <FlowChooser
            onPick={f => {
              setFlow(f);
              setStep(1);
              if (f === 'time-first') { setPickedTech(null); setCartTech(undefined); }
            }}
          />
        )}
        {step === 1 && flow === 'time-first' && (
          <Step1Cart
            services={services}
            cart={cart}
            onAdd={addToCart}
            onRemove={removeFromCart}
            onProceed={() => setStep(2)}
            onSwitchFlow={() => { setStep(0); setCart([]); setCartTech(undefined); setCartDate(''); setCartSlot(null); }}
            removalPrice={Number(cfg?.removalPrice ?? 15)}
          />
        )}
        {step === 1 && flow === 'tech-first' && (
          <Step1PickStylist
            techs={techs}
            picked={pickedTech}
            onPick={t => { setPickedTech(t); setCartTech(t); }}
            onProceed={() => setStep(2)}
            onSwitchFlow={() => { setStep(0); setCart([]); setPickedTech(null); setCartTech(undefined); setCartDate(''); setCartSlot(null); }}
          />
        )}
        {step === 2 && flow === 'time-first' && (
          <Step2PickTech
            cart={cart} allTechs={techs}
            cartTech={cartTech} setCartTech={setCartTech}
            cartTechByLane={cartTechByLane} setCartTechByLane={setCartTechByLane}
            onProceed={() => {
              // Phase 1: multi-lane carts pick two techs but Steps 3-5 still
              // operate against the single cartTech. Sync cartTech to the
              // mani lane's choice so the slot picker + confirm screen pick
              // up the user's selection. Phase 2 will fully split lanes.
              if (isMultiLane(cart)) setCartTech(cartTechByLane.Manicures);
              setStep(3);
            }}
            onBack={() => setStep(1)}
          />
        )}
        {step === 2 && flow === 'tech-first' && (
          <Step1Cart
            services={services.filter(s => techCanDo(pickedTech, s.id))}
            cart={cart}
            onAdd={addToCart}
            onRemove={removeFromCart}
            onProceed={() => setStep(3)}
            techFirstNote={pickedTech ? `Booking with ${pickedTech.name}. Showing only the services they offer.` : null}
            removalPrice={Number(cfg?.removalPrice ?? 15)}
          />
        )}
        {step === 3 && (
          <Step3PickSlot
            cart={cart} cartTech={cartTech} cartTechByLane={cartTechByLane} allTechs={techs}
            cartDate={cartDate} setCartDate={setCartDate}
            cartSlot={cartSlot} setCartSlot={setCartSlot}
            apptsByDate={apptsByDate} ensureApptsForDate={ensureApptsForDate}
            removalDur={15}
            onProceed={() => {
              const haveAll = form.name.trim() && form.phone.trim();
              setStep(haveAll ? 5 : 4);
            }}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <Step4Info
            form={form} webCfg={webCfg}
            gUser={gUser} client={client}
            emailLinkState={emailLinkState}
            onSendEmailLink={sendEmailLink}
            otpState={otpState}
            otpError={otpError}
            otpPhonePretty={otpPhonePretty}
            onSendOtp={sendOtp}
            onVerifyOtp={verifyOtp}
            onResetOtp={resetOtp}
            onGoogleSignIn={handleGoogleSignIn}
            onChange={patch => setForm(f => ({ ...f, ...patch }))}
            onNext={() => setStep(5)}
            onBack={() => setStep(3)}
          />
        )}
        {step === 5 && (
          <Step5Confirm
            cart={cart} allTechs={techs}
            cartTech={cartTech} cartTechByLane={cartTechByLane}
            cartDate={cartDate} cartSlot={cartSlot}
            apptsByDate={apptsByDate}
            form={form} submitting={submitting} bookingError={bookingError}
            removalPrice={Number(cfg?.removalPrice ?? 15)}
            updateCartItem={updateCartItem}
            editorial={webCfg?.layout === 'merakiSite'}
            onEditInfo={() => setStep(4)}
            onConfirm={handleBook}
            onBack={() => setStep(form.name.trim() && form.phone.trim() ? 3 : 4)}
          />
        )}
      </div>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────
function Header({ step, cfg, flow, webCfg, gUser, client, onSignIn, onSignOut }) {
  const labels = flow === 'tech-first'
    ? ['Stylist','Services','Schedule','Info','Confirm']
    : ['Cart','Stylists','Schedule','Info','Confirm'];

  // Editorial mode (when this tenant uses the merakiSite homepage) flips
  // the header to a light cream surface with ink text + brand fonts so it
  // feels like a continuation of HeroMerakiSite's floating nav.
  const editorial = webCfg?.layout === 'merakiSite';
  const FONT_SERIF   = '"Cormorant Garamond", Georgia, serif';
  const FONT_DISPLAY = '"Cinzel", Georgia, serif';
  const INK = '#302c29', INK_SOFT = '#5a534d', INK_FAINT = '#8a827a', GOLD = '#c19a4a', RULE = 'rgba(48,44,41,.10)';

  if (editorial) {
    return (
      <div style={{ background: '#fbfaf8', position: 'sticky', top: 0, zIndex: 10, borderBottom: `1px solid ${RULE}` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '14px 16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none' }}>
              <img src="/brand/meraki/circle-badge.svg" alt={webCfg?.salonName || 'Meraki'} style={{ width: 52, height: 52 }} />
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 10, fontWeight: 500, letterSpacing: '.36em', textTransform: 'uppercase', color: INK_FAINT, marginBottom: 4 }}>
                  Book an Appointment
                </div>
                <div style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 400, color: INK, lineHeight: 1, letterSpacing: '.005em' }}>
                  {webCfg?.salonName || 'Meraki Nail Studio'}
                </div>
              </div>
            </a>
            {gUser ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {gUser.photoURL && <img src={gUser.photoURL} alt="" style={{ width: 32, height: 32, borderRadius: '50%' }} />}
                <button onClick={onSignOut} style={{ fontFamily: FONT_DISPLAY, fontSize: 10, fontWeight: 500, letterSpacing: '.28em', textTransform: 'uppercase', color: INK_FAINT, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                  Sign out
                </button>
              </div>
            ) : (
              <button onClick={onSignIn} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(193,154,74,.07)', border: `1.5px solid ${GOLD}`, borderRadius: 30, padding: '9px 20px', cursor: 'pointer', fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 500, letterSpacing: '.28em', textTransform: 'uppercase', color: INK }}>
                <GoogleIcon />
                Sign in
              </button>
            )}
          </div>

          {cfg?.note && (
            <div style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 14, color: INK_SOFT, background: 'rgba(193,154,74,.08)', border: `1px solid ${RULE}`, borderRadius: 4, padding: '8px 14px', marginBottom: 12 }}>
              {cfg.note}
            </div>
          )}

          {step >= 1 && (
            <>
              <div style={{ display: 'flex', gap: 4, paddingBottom: 2 }}>
                {[1,2,3,4,5].map(s => (
                  <div key={s} style={{ flex: s === step ? 2 : 1, height: 2, borderRadius: 1, background: s <= step ? GOLD : 'rgba(48,44,41,.08)', transition: 'all .25s' }} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingBottom: 2 }}>
                {labels.map((label, i) => (
                  <div key={i} style={{ flex: 1, textAlign: 'center', fontFamily: FONT_DISPLAY, fontSize: 9, fontWeight: 500, color: i + 1 <= step ? INK : INK_FAINT, opacity: i + 1 <= step ? 1 : 0.5, letterSpacing: '.28em', textTransform: 'uppercase' }}>
                    {label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Original dark-gradient header (other tenants / layouts).
  return (
    <div style={{ background: 'var(--tm-grad-dark, linear-gradient(135deg,#1e6b50,#2D7A5F 40%,#3D7FBF))', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 2px 12px rgba(0,0,0,.18)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '14px 12px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg viewBox="0 0 60 60" fill="none" width={20} height={20}><circle cx="30" cy="22" r="7" fill="white"/><path d="M14 50c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="white" strokeWidth="3.5" strokeLinecap="round"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', letterSpacing: '-.2px' }}>{webCfg?.salonName || 'Plume Nexus'}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)' }}>Book an Appointment</div>
            </div>
          </div>
          {gUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {gUser.photoURL && <img src={gUser.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />}
              <button onClick={onSignOut} style={{ fontSize: 11, color: 'rgba(255,255,255,.8)', background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                Sign out
              </button>
            </div>
          ) : (
            <button onClick={onSignIn} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: 'none', borderRadius: 20, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#333', fontFamily: 'inherit', boxShadow: '0 1px 4px rgba(0,0,0,.15)' }}>
              <GoogleIcon />
              Sign in
            </button>
          )}
        </div>

        {cfg?.note && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.85)', background: 'rgba(255,255,255,.12)', borderRadius: 8, padding: '7px 12px', marginBottom: 10 }}>
            {cfg.note}
          </div>
        )}

        {step >= 1 && (
          <>
            <div style={{ display: 'flex', gap: 4, paddingBottom: 2 }}>
              {[1,2,3,4,5].map(s => (
                <div key={s} style={{ flex: s === step ? 2 : 1, height: 3, borderRadius: 2, background: s <= step ? '#fff' : 'rgba(255,255,255,.25)', transition: 'all .25s' }} />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, paddingBottom: 2 }}>
              {labels.map((label, i) => (
                <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, fontWeight: i + 1 <= step ? 700 : 400, color: i + 1 <= step ? '#fff' : 'rgba(255,255,255,.4)', letterSpacing: '.03em', textTransform: 'uppercase' }}>
                  {label}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Flow chooser (step 0) ─────────────────────────────
function FlowChooser({ onPick }) {
  const opts = [
    { id: 'time-first', emoji: '📅', title: 'Pick a time that works for me',  desc: 'Choose your services first, then we\'ll show you available stylists and times.' },
    { id: 'tech-first', emoji: '⭐', title: 'Book with a specific stylist',    desc: 'Pick your favorite nail tech, then see only their services and openings.' },
  ];
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 0' }}>
      <StepTitle>How would you like to book?</StepTitle>
      <div style={{ fontSize: 13, color: '#888', marginTop: -10, marginBottom: 22, lineHeight: 1.5 }}>
        Pick whichever feels right — you can always switch back.
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {opts.map(o => (
          <button key={o.id} onClick={() => onPick(o.id)}
            style={{ background: '#fff', border: '1.5px solid #e8e8e8', borderRadius: 14, padding: '18px 22px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 18, transition: 'border-color .15s, box-shadow .15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--tm-primary, #2D7A5F)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(45,122,95,.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8e8e8'; e.currentTarget.style.boxShadow = 'none'; }}>
            <div style={{ fontSize: 32, flexShrink: 0 }}>{o.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>{o.title}</div>
              <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5 }}>{o.desc}</div>
            </div>
            <div style={{ fontSize: 18, color: 'var(--tm-primary, #2D7A5F)', flexShrink: 0 }}>→</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Step 1 (tech-first): Pick a stylist ────────────────
function Step1PickStylist({ techs, picked, onPick, onProceed, onSwitchFlow }) {
  const list = (techs || []).filter(t => t.active !== false);
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: picked ? 110 : 16 }}>
      <StepTitle>Pick your stylist</StepTitle>
      <div style={{ fontSize: 13, color: '#888', marginTop: -10, marginBottom: 6, lineHeight: 1.5 }}>
        We'll then show you only their services and openings.
      </div>
      <button onClick={onSwitchFlow}
        style={{ fontSize: 11, color: 'var(--tm-accent, #3D95CE)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, marginBottom: 18 }}>
        ← Or pick a time first
      </button>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {list.map(t => {
          const sel = picked?.id === t.id;
          return (
            <button key={t.id} onClick={() => onPick(t)}
              style={{ background: '#fff', border: `2px solid ${sel ? 'var(--tm-primary, #2D7A5F)' : '#e8e8e8'}`, borderRadius: 14, padding: 14, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8, transition: 'border-color .15s, box-shadow .15s', boxShadow: sel ? '0 4px 12px rgba(45,122,95,.18)' : 'none' }}>
              <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 10, overflow: 'hidden', background: '#f0f0f0' }}>
                {t.photo
                  ? <img src={t.photo} alt={t.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#bbb' }}>👩‍💼</div>}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{t.name}</div>
                {t.instagram && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{t.instagram.startsWith('@') ? t.instagram : `@${t.instagram}`}</div>
                )}
                {t.notes && (
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {t.notes}
                  </div>
                )}
              </div>
              {sel && (
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-primary, #2D7A5F)' }}>✓ Selected</div>
              )}
            </button>
          );
        })}
      </div>
      {picked && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(255,255,255,.97)', backdropFilter: 'blur(8px)', borderTop: '1px solid #e0e0e0', padding: '14px 20px', zIndex: 20 }}>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
              Booking with <span style={{ color: 'var(--tm-primary, #2D7A5F)' }}>{picked.name}</span>
            </div>
            <button onClick={onProceed}
              style={{ background: 'var(--tm-primary, #2D7A5F)', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: 999, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}>
              Continue →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 1: Cart (browse + add) ────────────────────────
function Step1Cart({ services, cart, onAdd, onRemove, onProceed, onSwitchFlow, techFirstNote, removalPrice = 15 }) {
  const groups = groupByCategory(services);
  // Per-row selected option (local UI state) — picking a variant chip just
  // remembers it so 'Add to cart' adds the right one.
  const [pendingOptions, setPendingOptions] = useState({}); // svc.id → option
  // Cart total includes the per-item removal charge for services that
  // canRequireRemoval AND have the customer-confirmed `removal` flag set.
  // Same formula Step 5 uses; we mirror it here so the sticky bar's price
  // matches the final confirmation total.
  const cartTotal = cart.reduce((sum, item) => {
    const { price } = resolveServicePricing(item.service, item.option);
    const removal  = item.removal && item.service.canRequireRemoval ? Number(removalPrice) || 0 : 0;
    return sum + (price || 0) + removal;
  }, 0);
  // How many removals are bundled — surfaced in the chip line so the
  // customer sees that "yes, Removal was added" without going to Step 5.
  const removalCount = cart.filter(i => i.removal && i.service.canRequireRemoval).length;
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: cart.length ? 110 : 16 }}>
      <StepTitle>Choose your services</StepTitle>
      <div style={{ fontSize: 13, color: '#888', marginTop: -10, marginBottom: 6, lineHeight: 1.5 }}>
        {techFirstNote || 'Add as many services as you\'d like — you\'ll pick a stylist and time for each one in the next step.'}
      </div>
      {onSwitchFlow && (
        <button onClick={onSwitchFlow}
          style={{ fontSize: 11, color: 'var(--tm-accent, #3D95CE)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, marginBottom: 14 }}>
          ← Or pick a stylist first
        </button>
      )}
      <div style={{ marginBottom: 12 }} />
      {groups.map(({ category, services: svcs }) => {
        const color = CATEGORY_COLORS[category] || '#1a1a1a';
        return (
          <div key={category} style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #ececec' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-.1px' }}>{category}</span>
              <span style={{ fontSize: 11, color: '#bbb', fontWeight: 500 }}>{svcs.length} {svcs.length === 1 ? 'service' : 'services'}</span>
            </div>
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #ececec', overflow: 'hidden' }}>
              {svcs.map((s, i) => (
                <ServiceRow key={s.id} svc={s} color={color}
                  selectedOption={pendingOptions[s.id] || null}
                  divider={i < svcs.length - 1}
                  blockedReason={whyCantAddService(s, cart)}
                  onSelectOption={(opt) => setPendingOptions(p => ({ ...p, [s.id]: opt }))}
                  onAdd={(opt) => {
                    onAdd(s, opt || pendingOptions[s.id] || (s.options?.[0] ?? null));
                    setPendingOptions(p => ({ ...p, [s.id]: null }));
                  }} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Sticky cart strip */}
      {cart.length > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(255,255,255,.97)', backdropFilter: 'blur(8px)', borderTop: '1px solid #e0e0e0', padding: '14px 20px', zIndex: 20 }}>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
                {cart.length} {cart.length === 1 ? 'service' : 'services'} · ${cartTotal}
              </div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cart.map(item => item.option?.name || item.service.name).join(' · ')}
              </div>
            </div>
            <button onClick={onProceed}
              style={{ background: 'var(--tm-primary, #2D7A5F)', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: 999, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}>
              Continue →
            </button>
          </div>
          {/* Mini cart list (compact) */}
          <div style={{ maxWidth: 720, margin: '8px auto 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {cart.map(item => (
              <span key={item.id} style={{ fontSize: 11, background: '#f0f0f0', color: '#444', padding: '4px 10px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {item.option?.name || item.service.name}
                <button onClick={() => onRemove(item.id)} title="Remove"
                  style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceRow({ svc, color, selectedOption, divider, onSelectOption, onAdd, blockedReason }) {
  // Display state for the Add button:
  //   • null              → enabled "+ Add"
  //   • 'duplicate'       → "✓ Added" (this exact service is already chosen)
  //   • 'category-exclusive' → greyed "+ Add" (another exclusive service in the same category is in cart)
  const isBlocked = !!blockedReason;
  const isInCart  = blockedReason === 'duplicate';
  const [hover,  setHover]  = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const hasImg = svc.image && !imgErr;
  const opts   = svc.options || [];
  const hasOptions = opts.length > 0;

  const minOptPrice = hasOptions
    ? opts.reduce((m, o) => {
        const { price } = resolveServicePricing(svc, o);
        return m == null || price < m ? price : m;
      }, null)
    : null;

  function handleAddClick(e) {
    e.stopPropagation();
    const opt = hasOptions ? (selectedOption || opts[0]) : null;
    onAdd(opt);
  }

  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 16,
        textAlign: 'left', fontFamily: 'inherit', width: '100%',
        background: hover ? '#fafafa' : '#fff',
        borderBottom: divider ? '1px solid #f1f1f1' : 'none',
        padding: '18px 20px',
        transition: 'background .15s',
      }}>
      {/* Thumbnail */}
      <div style={{ width: 180, height: 180, flexShrink: 0, borderRadius: 16, overflow: 'hidden', background: hasImg ? '#f0f0f0' : `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {hasImg
          ? <img src={svc.image} alt={svc.name} onError={() => setImgErr(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 72 }}>{CATEGORY_ICONS[svc.category] || '💅'}</span>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-.1px', marginBottom: svc.description ? 6 : 0 }}>{svc.name}</div>
        {svc.description && (
          <div style={{ fontSize: 13, color: '#666', lineHeight: 1.55, whiteSpace: 'pre-line' }}>
            {svc.description}
          </div>
        )}

        {hasOptions && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
            {opts.map(opt => {
              const isOptSel = selectedOption?.id === opt.id;
              const { price, duration } = resolveServicePricing(svc, opt);
              return (
                <button key={opt.id} onClick={e => { e.stopPropagation(); onSelectOption(opt); }}
                  style={{
                    background: isOptSel ? color : '#fff',
                    border: `1.5px solid ${isOptSel ? color : '#e0e0e0'}`,
                    borderRadius: 12, padding: '10px 12px',
                    fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
                    color: isOptSel ? '#fff' : '#1a1a1a',
                    transition: 'background .15s, border-color .15s',
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {isOptSel && <span style={{ fontSize: 11 }}>✓</span>}
                    {opt.name || 'Option'}
                  </div>
                  <div style={{ fontSize: 11, opacity: isOptSel ? 0.95 : 0.65, fontWeight: 500 }}>
                    ${price}{opt.priceFrom ? '+' : ''} · {duration} min
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!hasOptions && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#999', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>⏱ {formatDuration(svc.duration, svc.durationMin)}</span>
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, paddingTop: 2 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#1a1a1a', letterSpacing: '-.2px', whiteSpace: 'nowrap' }}>
          {hasOptions ? `from $${minOptPrice}` : formatPrice(svc)}
        </span>
        <button onClick={handleAddClick} disabled={isBlocked}
          title={blockedReason === 'category-exclusive' ? `Already chose a service in ${svc.category}` : (blockedReason === 'duplicate' ? 'Already in cart' : undefined)}
          style={{
            fontSize: 12, fontWeight: 700,
            color: isBlocked ? '#aaa' : '#fff',
            border: isBlocked ? '1px solid #e5e5e5' : 'none',
            background: isBlocked ? '#f4f4f4' : 'var(--tm-primary, #2D7A5F)',
            padding: '7px 16px', borderRadius: 999,
            letterSpacing: '.04em', whiteSpace: 'nowrap',
            boxShadow: isBlocked ? 'none' : '0 2px 6px rgba(0,0,0,.10)',
            cursor: isBlocked ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            opacity: blockedReason === 'category-exclusive' ? 0.55 : 1,
            transition: 'background .15s',
          }}>
          {isInCart ? '✓ Added' : '+ Add'}
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Assign a stylist to each cart item ─────────
function Step2PickTech({ cart, allTechs, cartTech, setCartTech, cartTechByLane, setCartTechByLane, onProceed, onBack }) {
  const multiLane = isMultiLane(cart);
  const lanes = multiLane ? cartLanes(cart) : null;

  // For single-lane carts: one picker, all services done by one tech.
  // For multi-lane carts: one picker PER LANE, each lane gets its own tech.
  const eligibleMani = multiLane ? techsForServices(allTechs, lanes.Manicures.map(c => c.service)) : null;
  const eligiblePedi = multiLane ? techsForServices(allTechs, lanes.Pedicures.map(c => c.service)) : null;
  const eligibleAll  = !multiLane ? techsForServices(allTechs, cart.map(c => c.service)) : null;

  const pickedSingle = !multiLane && cartTech !== undefined;
  const pickedDual   = multiLane && cartTechByLane.Manicures !== undefined && cartTechByLane.Pedicures !== undefined;
  const picked       = pickedSingle || pickedDual;

  const totalDur = cartTotalDuration(cart, 15, cartTech || undefined);
  const cartLabel = cart.length === 1 ? '1 service' : `${cart.length} services`;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <StepTitle>{multiLane ? 'Choose your stylists' : 'Choose your stylist'}</StepTitle>
      <div style={{ fontSize: 13, color: '#888', marginTop: -10, marginBottom: 18, lineHeight: 1.5 }}>
        {multiLane
          ? `Pick one stylist for your manicure and another for your pedicure. They'll work back-to-back on the same visit (${totalDur} min total).`
          : `One stylist will perform all ${cartLabel} (${totalDur} min total) back-to-back. Pick a favorite or let us assign someone available.`}
      </div>

      {multiLane ? (
        <>
          <LanePicker
            laneName="Manicure"
            laneSubtitle={`${lanes.Manicures.map(i => i.service.name).join(' · ')}`}
            eligible={eligibleMani}
            value={cartTechByLane.Manicures}
            onChange={(v) => setCartTechByLane(p => ({ ...p, Manicures: v }))} />
          <div style={{ height: 18 }} />
          <LanePicker
            laneName="Pedicure"
            laneSubtitle={`${lanes.Pedicures.map(i => i.service.name).join(' · ')}`}
            eligible={eligiblePedi}
            value={cartTechByLane.Pedicures}
            onChange={(v) => setCartTechByLane(p => ({ ...p, Pedicures: v }))} />
        </>
      ) : eligibleAll.length === 0 ? (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: 18, textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🤝</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#7c2d12', marginBottom: 6 }}>No single stylist offers all of these services</div>
          <div style={{ fontSize: 12, color: '#9a3412', lineHeight: 1.6 }}>
            To keep your visit on one chair with one stylist, please go back and remove a service, or call us to split it across multiple appointments.
          </div>
        </div>
      ) : (
        <>
          <button onClick={() => setCartTech(null)} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
            borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
            marginBottom: 12,
            border: `1.5px solid ${cartTech === null ? 'var(--tm-primary, #2D7A5F)' : '#e8e8e8'}`,
            background: cartTech === null ? '#f0f9f5' : '#fff',
          }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>💅</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>No preference</div>
              <div style={{ fontSize: 11, color: '#888' }}>We'll pick an available stylist for you</div>
            </div>
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
            {eligibleAll.map(t => (
              <TechCard key={t.id} tech={t}
                selected={cartTech?.id === t.id}
                onSelect={() => setCartTech(t)} />
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={onBack} style={{ flex: 1, padding: '14px', borderRadius: 12, border: '1px solid #d8d8d8', background: '#fff', color: '#555', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          ← Back
        </button>
        <button onClick={onProceed} disabled={!picked}
          style={{ flex: 2, padding: '14px', borderRadius: 12, border: 'none', background: picked ? 'var(--tm-primary, #2D7A5F)' : '#d0d0d0', color: '#fff', fontSize: 15, fontWeight: 700, cursor: picked ? 'pointer' : 'default', fontFamily: 'inherit' }}>
          Continue →
        </button>
      </div>
    </div>
  );
}

function LanePicker({ laneName, laneSubtitle, eligible, value, onChange }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, padding: '16px 16px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '.08em', textTransform: 'uppercase' }}>For your</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', marginTop: 2 }}>{laneName}</div>
        </div>
        <div style={{ fontSize: 11, color: '#888', textAlign: 'right', maxWidth: '60%', lineHeight: 1.4 }}>{laneSubtitle}</div>
      </div>

      {eligible.length === 0 ? (
        <div style={{ fontSize: 12, color: '#a3a3a3', textAlign: 'center', padding: '14px 8px', background: '#fafafa', borderRadius: 8 }}>
          No stylist offers all the {laneName.toLowerCase()} services in your cart.
        </div>
      ) : (
        <>
          <button onClick={() => onChange(null)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
            marginBottom: 10,
            border: `1.5px solid ${value === null ? 'var(--tm-primary, #2D7A5F)' : '#e8e8e8'}`,
            background: value === null ? '#f0f9f5' : '#fff',
          }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>💅</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>No preference</div>
              <div style={{ fontSize: 10, color: '#888' }}>We'll pick an available stylist for you</div>
            </div>
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
            {eligible.map(t => (
              <TechCard key={t.id} tech={t} selected={value?.id === t.id} onSelect={() => onChange(t)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TechCard({ tech, selected, onSelect }) {
  return (
    <button onClick={onSelect} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 8px',
      borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
      border: `1.5px solid ${selected ? 'var(--tm-primary, #2D7A5F)' : '#e8e8e8'}`,
      background: selected ? '#f0f9f5' : '#fff',
      boxShadow: selected ? '0 0 0 2px var(--tm-primary, #2D7A5F)30' : '0 1px 4px rgba(0,0,0,.05)',
      position: 'relative',
    }}>
      {selected && (
        <div style={{ position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: '50%', background: 'var(--tm-primary, #2D7A5F)', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
      )}
      <TechAvatar tech={tech} size={48} />
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a', marginTop: 6, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{tech.name}</div>
      {tech.title && <div style={{ fontSize: 10, color: '#aaa', marginTop: 1 }}>{tech.title}</div>}
    </button>
  );
}

// ── Step 3: Pick a date + start time for the whole cart ─
function Step3PickSlot({ cart, cartTech, cartTechByLane, allTechs, cartDate, setCartDate, cartSlot, setCartSlot, apptsByDate, ensureApptsForDate, removalDur, onProceed, onBack }) {
  const multiLane = isMultiLane(cart);
  const eligible = techsForServices(allTechs, cart.map(c => c.service));
  const dayAppts = cartDate ? apptsByDate[cartDate] : null;

  // For multi-lane carts, compute per-lane items + eligible techs once so
  // the availability check (called per slot) doesn't re-derive them.
  const lanes        = multiLane ? cartLanes(cart) : null;
  const maniItems    = multiLane ? [...lanes.Manicures, ...lanes._orphan] : null;
  const pediItems    = multiLane ? lanes.Pedicures : null;
  const maniEligible = multiLane ? techsForServices(allTechs, maniItems.map(c => c.service)) : null;
  const pediEligible = multiLane ? techsForServices(allTechs, pediItems.map(c => c.service)) : null;

  // Total duration depends on lane mode. Use a representative tech per lane
  // (the picked one, or any eligible) for duration calc — the actual booking
  // re-resolves with the real tech, but display + slot stepping needs a
  // concrete number now.
  const totalDur = multiLane
    ? cartTotalDuration(maniItems, removalDur, cartTechByLane?.Manicures || maniEligible[0])
      + cartTotalDuration(pediItems, removalDur, cartTechByLane?.Pedicures || pediEligible[0])
    : cartTotalDuration(cart, removalDur, cartTech || undefined);
  const allSlots = getSlots(totalDur);

  useEffect(() => { if (cartDate) ensureApptsForDate(cartDate); }, [cartDate]); // eslint-disable-line

  // Slot availability — single-lane: any eligible tech free for the whole
  // span. Multi-lane: mani-tech free in [slot, slot+maniDur] AND pedi-tech
  // free in [slot+maniDur, slot+maniDur+pediDur]. "No preference" on a lane
  // means we accept the slot if SOMEONE eligible for that lane is free.
  function isAvailable(slotMins) {
    if (!dayAppts) return false;
    if (multiLane) {
      // Mani window starts at the slot.
      const maniTech = cartTechByLane?.Manicures || null;
      const checkMani = (t) => isTechFreeAt(t, slotMins, cartTotalDuration(maniItems, removalDur, t), dayAppts);
      const maniOk = maniTech ? checkMani(maniTech) : maniEligible.some(checkMani);
      if (!maniOk) return false;
      // Pedi window starts after mani finishes — use a representative mani
      // duration to compute the offset. If we have a specific mani tech, use
      // theirs; otherwise pick a candidate that's actually free (so the pedi
      // window is realistic against availability).
      const maniRep = maniTech || maniEligible.find(checkMani) || maniEligible[0];
      const maniDur = cartTotalDuration(maniItems, removalDur, maniRep);
      const pediStart = slotMins + maniDur;
      const pediTech = cartTechByLane?.Pedicures || null;
      const checkPedi = (t) => isTechFreeAt(t, pediStart, cartTotalDuration(pediItems, removalDur, t), dayAppts);
      return pediTech ? checkPedi(pediTech) : pediEligible.some(checkPedi);
    }
    if (cartTech) return isTechFreeAt(cartTech, slotMins, totalDur, dayAppts);
    return eligible.some(t => isTechFreeAt(t, slotMins, cartTotalDuration(cart, removalDur, t), dayAppts));
  }
  const hasAny = dayAppts && allSlots.some(s => isAvailable(s));
  const techLabel = multiLane
    ? `${cartTechByLane?.Manicures?.name || 'any stylist'} (mani) & ${cartTechByLane?.Pedicures?.name || 'any stylist'} (pedi)`
    : (cartTech ? cartTech.name : 'No preference');
  const cartLabel = cart.length === 1 ? '1 service' : `${cart.length} services`;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <StepTitle>Pick a date &amp; start time</StepTitle>
      <div style={{ fontSize: 13, color: '#888', marginTop: -10, marginBottom: 18, lineHeight: 1.5 }}>
        Your {cartLabel} ({totalDur} min total){multiLane ? ' will be done back-to-back, mani first then pedi' : ' will be done back-to-back'} with <strong>{techLabel}</strong>.
      </div>

      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <BookingCalendar value={cartDate} onChange={d => { setCartDate(d); setCartSlot(null); }} />
          </div>
          {cartDate && (
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#555', marginBottom: 12 }}>{fmtDate(cartDate)}</div>
              {dayAppts == null ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>
              ) : hasAny ? (
                <>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                    Showing slots that fit the full {totalDur} min visit.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(75px, 1fr))', gap: 6 }}>
                    {allSlots.map(m => {
                      const avail = isAvailable(m);
                      const isSel = cartSlot === m;
                      return (
                        <button key={m} onClick={() => avail && setCartSlot(m)} disabled={!avail}
                          style={{
                            padding: '12px 4px', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                            border: `1.5px solid ${isSel ? 'var(--tm-primary, #2D7A5F)' : avail ? '#c3e6d8' : '#ececec'}`,
                            background: isSel ? 'var(--tm-primary, #2D7A5F)' : avail ? '#f0f9f5' : '#fafafa',
                            color: isSel ? '#fff' : avail ? '#1a6040' : '#ccc',
                            cursor: avail ? 'pointer' : 'default',
                          }}>
                          {minsToStr(m)}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '24px 16px', background: '#fafafa', borderRadius: 12, border: '1px solid #ececec' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#555' }}>No availability on this date</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>Try a different day</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={onBack} style={{ flex: 1, padding: '14px', borderRadius: 12, border: '1px solid #d8d8d8', background: '#fff', color: '#555', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          ← Back
        </button>
        <button onClick={onProceed} disabled={!cartDate || cartSlot == null}
          style={{ flex: 2, padding: '14px', borderRadius: 12, border: 'none', background: (cartDate && cartSlot != null) ? 'var(--tm-primary, #2D7A5F)' : '#d0d0d0', color: '#fff', fontSize: 15, fontWeight: 700, cursor: (cartDate && cartSlot != null) ? 'pointer' : 'default', fontFamily: 'inherit' }}>
          Continue →
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Info ───────────────────────────────────────
function Step4Info({
  form, webCfg, gUser, client,
  emailLinkState, onSendEmailLink,
  otpState, otpError, otpPhonePretty,
  onSendOtp, onVerifyOtp, onResetOtp, onGoogleSignIn,
  onChange, onNext, onBack,
}) {
  const salonName = webCfg?.salonName || 'our salon';
  // Required: name + phone (signed-in users skip this step entirely so they bypass the validation)
  const valid = form.name.trim() && form.phone.trim();

  const formCard = (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
      {[
        { key: 'name',  label: 'Name',  type: 'text',  placeholder: 'Your full name',                 required: true  },
        { key: 'phone', label: 'Phone', type: 'tel',   placeholder: '(555) 000-0000',                 required: true  },
        { key: 'email', label: 'Email', type: 'email', placeholder: 'For confirmation & sign-in',     required: false },
        { key: 'notes', label: 'Notes', type: 'text',  placeholder: 'Any requests or preferences?',   required: false },
      ].map(({ key, label, type, placeholder, required }, i, arr) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', padding: '13px 16px', borderBottom: i < arr.length - 1 ? '1px solid #f0f0f0' : 'none', gap: 12 }}>
          <div style={{ width: 52, fontSize: 12, color: '#aaa', fontWeight: 600, flexShrink: 0 }}>
            {label}{required && <span style={{ color: '#ef4444' }}> *</span>}
          </div>
          <input
            type={type} value={form[key]} onChange={e => onChange({ [key]: e.target.value })}
            placeholder={placeholder}
            style={{ flex: 1, fontFamily: 'inherit', border: 'none', outline: 'none', fontSize: 16, background: 'transparent', color: '#1a1a1a' }}
          />
        </div>
      ))}
    </div>
  );

  // SMS / email opt-in for marketing + reminders. Defaults are
  // UNCHECKED — required by TCPA + Twilio Toll-Free Verification
  // (carrier reviewers will reject pre-checked consent boxes). The
  // SMS label uses verbatim consent language that mirrors what the
  // public /?sms-consent=1 page advertises, so a reviewer landing
  // there sees the same checkbox text the customer sees.
  const optInCard = (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#666', marginBottom: 8 }}>How can we reach you?</div>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', cursor: 'pointer', color: '#333' }}>
        <input type="checkbox" checked={form.optInSms === true} onChange={e => onChange({ optInSms: e.target.checked })} style={{ marginTop: 3, flexShrink: 0 }} />
        <span style={{ lineHeight: 1.5 }}>
          <strong>Yes, send me text reminders and occasional promotions from {salonName}.</strong>{' '}
          Message frequency varies. Message and data rates may apply.
          Reply <strong>STOP</strong> to opt out, <strong>HELP</strong> for help.{' '}
          View our <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tm-primary, #2D7A5F)', fontWeight: 600 }}>privacy policy</a>.
        </span>
      </label>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', cursor: 'pointer', color: '#333' }}>
        <input type="checkbox" checked={form.optInEmail === true} onChange={e => onChange({ optInEmail: e.target.checked })} style={{ marginTop: 3, flexShrink: 0 }} />
        <span style={{ lineHeight: 1.5 }}>
          Email me appointment reminders + occasional offers from {salonName}.
          Unsubscribe link in every email.
        </span>
      </label>

      <div style={{ fontSize: 11, color: '#888', marginTop: 6, lineHeight: 1.5 }}>
        Appointment confirmation + day-before reminders are sent automatically (transactional) regardless of these toggles. Toggles above control marketing.
      </div>
    </div>
  );

  // Signed-in: skip the sign-in card. Either editing existing info or
  // a brand-new auth user whose email isn't in the client list yet —
  // show the form so they can supply name/phone.
  if (gUser) {
    const isFirstTime = !form.phone.trim();
    return (
      <div>
        <StepTitle>{isFirstTime ? "Just a couple details" : 'Your information'}</StepTitle>
        {isFirstTime && (
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#9a3412', lineHeight: 1.5 }}>
            We don't have you in our client list yet. Add your name and phone so we can confirm and contact you about this appointment.
          </div>
        )}
        {formCard}
        {optInCard}
        <button onClick={onNext} disabled={!valid}
          style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', background: valid ? 'var(--tm-primary, #2D7A5F)' : '#d0d0d0', color: '#fff', fontSize: 16, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'inherit', marginBottom: 10 }}>
          Review Booking →
        </button>
        <BackBtn onClick={onBack} />
      </div>
    );
  }

  // Not signed in: present sign-in as the primary path with manual form below.
  return (
    <div>
      <StepTitle>Sign in or continue as guest</StepTitle>

      <div style={{ background: '#fff', border: '1.5px solid var(--tm-primary, #2D7A5F)', borderRadius: 14, overflow: 'hidden', marginBottom: 16, boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
        <div style={{ padding: '14px 16px', background: '#f0f9f5', borderBottom: '1px solid #e8f5ee' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a6040' }}>Sign in for a faster checkout</div>
          <div style={{ fontSize: 12, color: '#4a9070', marginTop: 2 }}>We'll auto-fill your info from your account.</div>
        </div>

        {/* Google sign-in */}
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>Sign in with Google</div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>One tap, no password</div>
          </div>
          <GoogleSignInBtn onClick={onGoogleSignIn} />
        </div>

        {/* Phone OR email — auto-detects what the user is typing */}
        <UnifiedAuthRow
          form={form}
          onChange={onChange}
          emailLinkState={emailLinkState}
          onSendEmailLink={onSendEmailLink}
          otpState={otpState}
          otpError={otpError}
          otpPhonePretty={otpPhonePretty}
          onSendOtp={onSendOtp}
          onVerifyOtp={onVerifyOtp}
          onResetOtp={onResetOtp}
        />
      </div>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0' }}>
        <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
        <div style={{ fontSize: 11, fontWeight: 600, color: '#bbb', letterSpacing: '.08em', textTransform: 'uppercase' }}>or continue as guest</div>
        <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
      </div>

      {formCard}
      {optInCard}

      <button onClick={onNext} disabled={!valid}
        style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', background: valid ? 'var(--tm-primary, #2D7A5F)' : '#d0d0d0', color: '#fff', fontSize: 16, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'inherit', marginBottom: 10 }}>
        Review Booking →
      </button>
      <BackBtn onClick={onBack} />
    </div>
  );
}

// ── Step 5: Confirm (multi-item) ────────────────────────
function Step5Confirm({ cart, allTechs, cartTech, cartTechByLane, cartDate, cartSlot, apptsByDate, form, submitting, bookingError, removalPrice, updateCartItem, editorial, onConfirm, onBack, onEditInfo }) {
  const removalDur = 15;
  const totalPrice = cart.reduce((sum, item) => {
    const base = resolveServicePricing(item.service, item.option).price || 0;
    return sum + base + (item.removal && item.service.canRequireRemoval ? Number(removalPrice) || 0 : 0);
  }, 0);
  // Resolve "no preference" to whichever tech is actually free for the full
  // window — checked against each candidate's own per-service durations.
  const eligible = techsForServices(allTechs, cart.map(c => c.service));
  const dayAppts = apptsByDate[cartDate] || [];
  const assignedTech = cartTech !== null
    ? cartTech
    : (eligible.find(t => isTechFreeAt(t, cartSlot, cartTotalDuration(cart, removalDur, t), dayAppts)) || null);

  // Multi-lane breakdown (mani+pedi carts) — assemble per-lane info so the
  // confirmation card can show two stylists, two time blocks, and which
  // services land in each lane.
  const multiLane = isMultiLane(cart);
  let maniLaneInfo = null, pediLaneInfo = null;
  if (multiLane) {
    const lanes = cartLanes(cart);
    const maniItems = [...lanes.Manicures, ...lanes._orphan];
    const pediItems = lanes.Pedicures;
    function resolveLaneTech(items, picked) {
      if (picked && picked !== null) return picked;
      const e = techsForServices(allTechs, items.map(c => c.service));
      return e.find(t => isTechFreeAt(t, cartSlot, cartTotalDuration(items, removalDur, t), dayAppts)) || null;
    }
    const maniTech = resolveLaneTech(maniItems, cartTechByLane?.Manicures);
    const pediTech = resolveLaneTech(pediItems, cartTechByLane?.Pedicures);
    const maniDur  = cartTotalDuration(maniItems, removalDur, maniTech);
    const pediDur  = cartTotalDuration(pediItems, removalDur, pediTech);
    maniLaneInfo = { items: maniItems, tech: maniTech, start: cartSlot, end: cartSlot + maniDur, dur: maniDur };
    pediLaneInfo = { items: pediItems, tech: pediTech, start: cartSlot + maniDur, end: cartSlot + maniDur + pediDur, dur: pediDur };
  }
  // Total duration: in multi-lane, sum the two lanes' actual per-tech
  // durations; otherwise the cart-wide computation using assignedTech.
  const totalDur = multiLane
    ? (maniLaneInfo.dur + pediLaneInfo.dur)
    : cartTotalDuration(cart, removalDur, assignedTech);
  const endSlot = (cartSlot ?? 0) + totalDur;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <StepTitle>Confirm booking</StepTitle>

      {/* Combined appointment card */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, overflow: 'hidden', marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
        {editorial ? (
          // Editorial header — leads with TOTAL + TIME RANGE, the two
          // decisions the customer is about to commit to. Date + duration
          // are smaller below; per-service breakdown is in the section below.
          <div style={{ background: '#fbfaf8', padding: '32px 24px 28px', textAlign: 'center', borderBottom: `1px solid rgba(193,154,74,.22)` }}>
            <div style={{ fontFamily: '"Cinzel", Georgia, serif', fontSize: 10, fontWeight: 500, letterSpacing: '.36em', textTransform: 'uppercase', color: '#8a827a', marginBottom: 16 }}>
              Your visit
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 300, fontSize: 'clamp(48px, 7vw, 76px)', color: '#302c29', lineHeight: 1, letterSpacing: '-.005em' }}>
                  ${totalPrice}
                </div>
                <div style={{ fontFamily: '"Cinzel", Georgia, serif', fontSize: 9, letterSpacing: '.32em', textTransform: 'uppercase', color: '#8a827a', marginTop: 6 }}>
                  Total
                </div>
              </div>
              <div style={{ width: 1, height: 56, background: 'rgba(193,154,74,.32)' }} />
              <div>
                <div style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 300, fontSize: 'clamp(28px, 4vw, 38px)', color: '#302c29', lineHeight: 1.05, letterSpacing: '.002em' }}>
                  {minsToStr(cartSlot)} – {minsToStr(endSlot)}
                </div>
                <div style={{ fontFamily: '"Cinzel", Georgia, serif', fontSize: 9, letterSpacing: '.32em', textTransform: 'uppercase', color: '#8a827a', marginTop: 6 }}>
                  {fmtDate(cartDate)} · {totalDur} min
                </div>
              </div>
            </div>
            <div style={{ marginTop: 22, fontFamily: '"Cormorant Garamond", Georgia, serif', fontStyle: 'italic', fontSize: 16, color: '#5a534d' }}>
              {multiLane ? (
                <>
                  manicure with <span style={{ fontStyle: 'normal', color: '#302c29', fontWeight: 500 }}>{maniLaneInfo.tech?.name || 'any available stylist'}</span>
                  <span style={{ margin: '0 8px', color: '#c19a4a' }}>·</span>
                  pedicure with <span style={{ fontStyle: 'normal', color: '#302c29', fontWeight: 500 }}>{pediLaneInfo.tech?.name || 'any available stylist'}</span>
                </>
              ) : (
                <>with <span style={{ fontStyle: 'normal', color: '#302c29', fontWeight: 500 }}>{assignedTech?.name || 'any available stylist'}</span></>
              )}
            </div>
          </div>
        ) : (
          <>
            <div style={{ background: `linear-gradient(135deg,${CATEGORY_COLORS[cart[0]?.service?.category] || 'var(--tm-primary, #2D7A5F)'},var(--tm-accent, #3D95CE))`, padding: '22px 18px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.7)', letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 10 }}>Your visit</div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 18, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 44, fontWeight: 800, color: '#fff', lineHeight: 1, letterSpacing: '-.5px' }}>${totalPrice}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.7)', letterSpacing: '.18em', textTransform: 'uppercase', marginTop: 4 }}>Total</div>
                </div>
                <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,.3)' }} />
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>{minsToStr(cartSlot)} – {minsToStr(endSlot)}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.7)', letterSpacing: '.18em', textTransform: 'uppercase', marginTop: 4 }}>{fmtDate(cartDate)} · {totalDur} min</div>
                </div>
              </div>
              <div style={{ marginTop: 14, fontSize: 13, color: 'rgba(255,255,255,.95)' }}>
                with <strong>{assignedTech?.name || 'any available stylist'}</strong>
              </div>
            </div>
          </>
        )}

        {/* Service breakdown — flat list for single-lane, two stacked
            lane cards (mani + pedi) when both are present so the customer
            sees who does what at which time. */}
        {multiLane ? (
          <div style={{ borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
            <LaneBreakdownCard
              eyebrow="Manicure"
              tech={maniLaneInfo.tech}
              startMins={maniLaneInfo.start}
              endMins={maniLaneInfo.end}
              items={maniLaneInfo.items}
              editorial={editorial}
            />
            <div style={{ height: 1, background: 'rgba(193,154,74,.22)', margin: '0 18px' }} />
            <LaneBreakdownCard
              eyebrow="Pedicure"
              tech={pediLaneInfo.tech}
              startMins={pediLaneInfo.start}
              endMins={pediLaneInfo.end}
              items={pediLaneInfo.items}
              editorial={editorial}
            />
          </div>
        ) : (
          <div style={{ borderTop: '1px solid #f0f0f0', padding: '10px 18px', background: '#fafafa' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Services</div>
            {cart.map((item, idx) => {
              const resolved = resolveServicePricing(item.service, item.option);
              const dur = resolved.duration || 60;
              const itemLabel = item.option?.name ? `${item.service.name} — ${item.option.name}` : item.service.name;
              return (
                <div key={item.id} style={{ marginBottom: idx === cart.length - 1 ? 0 : 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 600 }}>{itemLabel}</span>
                    <span style={{ fontSize: 12, color: '#888' }}>${resolved.price} · {dur} min</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Customer info */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
        {[
          { icon: '👤',  label: 'Name',  value: form.name },
          { icon: '📞',  label: 'Phone', value: form.phone },
          form.email && { icon: '✉️', label: 'Email', value: form.email },
          form.notes && { icon: '📝', label: 'Notes', value: form.notes },
        ].filter(Boolean).map(({ icon, label, value }, i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', padding: '10px 18px', borderTop: i === 0 ? 'none' : '1px solid #f0f0f0', gap: 10 }}>
            <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
            <span style={{ fontSize: 11, color: '#aaa', width: 56, flexShrink: 0 }}>{label}</span>
            <span style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>{value}</span>
          </div>
        ))}
        {onEditInfo && (
          <div style={{ padding: '8px 18px', borderTop: '1px solid #f0f0f0', textAlign: 'right' }}>
            <button onClick={onEditInfo} style={{ background: 'none', border: 'none', color: 'var(--tm-accent, #3D95CE)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              ✎ Edit my info
            </button>
          </div>
        )}
      </div>

      {bookingError && (
        <div style={{ padding: '12px 14px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 13, lineHeight: 1.45, marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>⚠️</span>
          <span>{bookingError}</span>
        </div>
      )}
      <button onClick={onConfirm} disabled={submitting || !!bookingError}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: (submitting || bookingError) ? '#aaa' : 'var(--tm-primary, #2D7A5F)', color: '#fff', fontSize: 16, fontWeight: 800, cursor: (submitting || bookingError) ? 'default' : 'pointer', fontFamily: 'inherit', marginBottom: 10, letterSpacing: '.01em' }}>
        {submitting ? 'Booking…' : bookingError ? 'Booking unavailable' : '✓ Confirm Booking'}
      </button>
      <BackBtn onClick={onBack} />
      <div style={{ fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
        By booking, you agree to our cancellation policy. A deposit may be required for new clients.
      </div>
    </div>
  );
}

// ── Success ────────────────────────────────────────────
function LaneBreakdownCard({ eyebrow, tech, startMins, endMins, items, editorial }) {
  const FONT_DISPLAY = '"Cinzel", Georgia, serif';
  const FONT_SERIF   = '"Cormorant Garamond", Georgia, serif';
  const totalDuration = endMins - startMins;
  return (
    <div style={{ padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: editorial ? '#8a827a' : '#888',
            fontFamily: editorial ? FONT_DISPLAY : 'inherit',
          }}>
            {eyebrow}
          </div>
          <div style={{
            fontSize: editorial ? 18 : 14,
            fontWeight: editorial ? 400 : 700,
            color: editorial ? '#302c29' : '#1a1a1a',
            marginTop: 2,
            fontFamily: editorial ? FONT_SERIF : 'inherit',
          }}>
            with {tech?.name || 'any available stylist'}
          </div>
        </div>
        <div style={{
          fontSize: 12, color: editorial ? '#5a534d' : '#888', textAlign: 'right',
          fontFamily: editorial ? FONT_DISPLAY : 'inherit',
          letterSpacing: editorial ? '.06em' : 'normal',
        }}>
          {minsToStr(startMins)} – {minsToStr(endMins)} · {totalDuration} min
        </div>
      </div>
      {items.map((item, idx) => {
        const resolved = resolveServicePricing(item.service, item.option);
        const dur = resolved.duration || 60;
        const itemLabel = item.option?.name ? `${item.service.name} — ${item.option.name}` : item.service.name;
        return (
          <div key={item.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            marginBottom: idx === items.length - 1 ? 0 : 6, paddingLeft: 6,
          }}>
            <span style={{ fontSize: 13, color: '#302c29' }}>{itemLabel}</span>
            <span style={{ fontSize: 12, color: '#8a827a' }}>${resolved.price} · {dur} min</span>
          </div>
        );
      })}
    </div>
  );
}

function SuccessScreen({ appts, techs, webCfg }) {
  const a = Array.isArray(appts) ? appts[0] : appts;
  const tech = a?._tech || techs?.find(t => t.id === a?.techId) || null;
  const cartItems = a?._cartItems || [];
  const firstSvc = cartItems[0]?.service;
  const color = CATEGORY_COLORS[firstSvc?.category] || 'var(--tm-primary, #2D7A5F)';
  const address = webCfg?.address || '5029 Olentangy River Rd\nColumbus, OH 43214';
  const addressOneLine = address.replace(/\n/g, ', ');
  const mapsUrl = webCfg?.mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(addressOneLine)}`;
  const phone = webCfg?.phone?.trim();
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : null;
  const sendEmail = a?.clientEmail;

  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', overflowX: 'hidden', background: '#f5f6f8', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'var(--tm-grad-dark, linear-gradient(135deg,#1e6b50,#2D7A5F 40%,#3D7FBF))', padding: '20px 20px 40px' }}>
        <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{webCfg?.salonName || 'Plume Nexus'}</div>
        </div>
      </div>
      <div style={{ maxWidth: 600, margin: '-24px auto 0', padding: '0 16px 48px', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px', boxShadow: '0 8px 32px rgba(0,0,0,.1)', textAlign: 'center', marginBottom: 16 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#f0f9f5', border: '3px solid var(--tm-primary, #2D7A5F)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 30, color: 'var(--tm-primary, #2D7A5F)' }}>
            ✓
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#1a1a1a', marginBottom: 6 }}>You're booked!</div>
          <div style={{ fontSize: 14, color: '#888', lineHeight: 1.7 }}>
            See you on <strong style={{ color: '#333' }}>{fmtDate(a?.date)}</strong> at <strong style={{ color: '#333' }}>{minsToStr(strToMins(a?.startTime))}</strong>
            {sendEmail && (
              <><br /><span style={{ fontSize: 12, color: '#bbb' }}>Confirmation sent to {sendEmail}</span></>
            )}
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 14, padding: '14px 18px', boxShadow: '0 2px 8px rgba(0,0,0,.06)', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <ServiceThumb svc={firstSvc} color={color} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>
                {cartItems.length === 1
                  ? (cartItems[0].option?.name ? `${firstSvc?.name} — ${cartItems[0].option.name}` : firstSvc?.name)
                  : `${cartItems.length} services · ${a?.duration} min`}
              </div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{fmtDate(a?.date)} · {minsToStr(strToMins(a?.startTime))}</div>
            </div>
          </div>
          {cartItems.length > 1 && (
            <div style={{ borderTop: '1px solid #f5f5f5', paddingTop: 8, marginBottom: 4 }}>
              {cartItems.map((it, i) => {
                const lbl = it.option?.name ? `${it.service.name} — ${it.option.name}` : it.service.name;
                return (
                  <div key={it.id} style={{ fontSize: 12, color: '#666', padding: '3px 0', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{i + 1}. {lbl}</span>
                  </div>
                );
              })}
            </div>
          )}
          {a?.techName && a.techName !== 'TBD' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #f5f5f5' }}>
              {tech ? <TechAvatar tech={tech} size={28} /> : <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>👩‍💼</span>}
              <span style={{ fontSize: 12, color: '#666' }}>with {a.techName}</span>
            </div>
          )}
        </div>

        {/* Salon contact card */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '8px 20px', boxShadow: '0 2px 8px rgba(0,0,0,.06)', marginBottom: 16 }}>
          {[
            { icon: '📍', text: addressOneLine, href: mapsUrl, external: true },
            phone
              ? { icon: '📞', text: phone, href: telHref }
              : { icon: '💬', text: 'Have a question? Chat with us', href: '/#chat' },
          ].map(({ icon, text, href, external }, i, arr) => {
            const inner = (
              <>
                <span style={{ fontSize: 18, width: 26, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                <span style={{ fontSize: 13, color: href ? 'var(--tm-accent, #3D95CE)' : '#555', textDecoration: href ? 'underline' : 'none' }}>{text}</span>
              </>
            );
            const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid #f5f5f5' : 'none' };
            return href ? (
              <a key={text} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                style={{ ...rowStyle, textDecoration: 'none' }}>
                {inner}
              </a>
            ) : (
              <div key={text} style={rowStyle}>{inner}</div>
            );
          })}
        </div>

        <a href="/" style={{ display: 'block', textAlign: 'center', fontSize: 15, fontWeight: 700, color: '#fff', textDecoration: 'none', background: 'var(--tm-accent, #3D95CE)', borderRadius: 14, padding: '15px', boxShadow: '0 2px 8px rgba(61,149,206,.35)' }}>
          ← Back to {webCfg?.salonName || 'site'}
        </a>
      </div>
    </div>
  );
}

// ── Calendar ───────────────────────────────────────────
function BookingCalendar({ value, onChange }) {
  const today   = todayDate();
  const maxDate = new Date(today); maxDate.setDate(today.getDate() + 60);
  const initD   = value ? new Date(value + 'T12:00:00') : today;
  const [yr,  setYr]  = useState(initD.getFullYear());
  const [mon, setMon] = useState(initD.getMonth());

  function prevMonth() { if (mon === 0) { setMon(11); setYr(y => y-1); } else setMon(m => m-1); }
  function nextMonth() { if (mon === 11) { setMon(0); setYr(y => y+1); } else setMon(m => m+1); }

  const firstDow = new Date(yr, mon, 1).getDay();
  const daysInMonth = new Date(yr, mon + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(yr, mon, d));

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 16, padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <button onClick={prevMonth}
          style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: '#f0f0f0', color: '#555', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}>
          ‹
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>{MONTH_NAMES[mon]} {yr}</span>
        <button onClick={nextMonth}
          style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: '#f0f0f0', color: '#555', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}>
          ›
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#bbb', padding: '4px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const ds      = dateStr(d);
          const isPast  = d < today;
          const isFar   = d > maxDate;
          const isSel   = value === ds;
          const isToday = d.getTime() === today.getTime();
          const disabled = isPast || isFar;
          return (
            <button key={i} onClick={() => !disabled && onChange(ds)} disabled={disabled}
              style={{
                aspectRatio: '1', borderRadius: 10,
                border: `1.5px solid ${isSel ? 'var(--tm-primary, #2D7A5F)' : isToday ? '#c3e6d8' : 'transparent'}`,
                background: isSel ? 'var(--tm-primary, #2D7A5F)' : isToday ? '#f0f9f5' : 'transparent',
                color: isSel ? '#fff' : disabled ? '#d8d8d8' : '#1a1a1a',
                fontSize: 13, fontWeight: isSel || isToday ? 700 : 400,
                cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
              }}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Removal suggestion modal ───────────────────────────
// Fires once per session when the first qualifying service (gel/dip /
// canRequireRemoval=true) gets added. Saves customers the embarrassment of
// arriving with a previous set still on their nails and being short on
// time. Editorial mode swaps to the cream/gold/ink palette and brand fonts
// so it matches HeroMerakiSite's design language.
function RemovalSuggestionModal({ svcName, removalPrice, editorial, onYes, onNo }) {
  if (editorial) {
    const INK = '#302c29', INK_SOFT = '#5a534d', INK_FAINT = '#8a827a', GOLD = '#c19a4a';
    const FONT_SERIF   = '"Cormorant Garamond", Georgia, serif';
    const FONT_DISPLAY = '"Cinzel", Georgia, serif';
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(48,44,41,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
        <div style={{ background: '#fbfaf8', borderRadius: 4, padding: '40px 36px 32px', width: '100%', maxWidth: 460, boxShadow: '0 30px 80px rgba(48,44,41,.35)', textAlign: 'center', border: `1px solid rgba(193,154,74,.22)` }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 10, fontWeight: 500, letterSpacing: '.36em', textTransform: 'uppercase', color: INK_FAINT, marginBottom: 18 }}>
            A quick note
          </div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 30, fontWeight: 400, lineHeight: 1.15, color: INK, marginBottom: 18, letterSpacing: '.005em' }}>
            Wearing a previous gel or dip set?
          </div>
          <div style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 17, color: INK_SOFT, lineHeight: 1.55, marginBottom: 28, maxWidth: 360, margin: '0 auto 28px' }}>
            We'll need a few extra minutes to remove it before starting your <em>{svcName}</em>. Add Removal so we set aside the right amount of time.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={onYes}
              style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 500, letterSpacing: '.28em', textTransform: 'uppercase', background: GOLD, color: '#fff', border: `1.5px solid ${GOLD}`, borderRadius: 30, padding: '14px 28px', cursor: 'pointer' }}>
              Yes, add Removal · ${Number(removalPrice).toFixed(0)}
            </button>
            <button onClick={onNo}
              style={{ fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 500, letterSpacing: '.28em', textTransform: 'uppercase', background: 'transparent', color: INK_FAINT, border: 'none', cursor: 'pointer', padding: '10px' }}>
              No — coming in with bare nails
            </button>
          </div>
        </div>
      </div>
    );
  }
  // Fallback (non-editorial tenants).
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 380, boxShadow: '0 20px 60px rgba(0,0,0,.3)', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>💅</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#1a1a1a' }}>
          Wearing a previous set?
        </div>
        <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5, marginBottom: 20 }}>
          We'll need extra time to remove gel or dip before your {svcName}. Add Removal so we book the right amount of time.
        </div>
        <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
          <button onClick={onYes}
            style={{ background: 'var(--tm-primary, #2D7A5F)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Yes, add Removal · ${Number(removalPrice).toFixed(0)}
          </button>
          <button onClick={onNo}
            style={{ background: '#fff', color: '#666', border: '1px solid #e0e0e0', borderRadius: 10, padding: '9px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            No — fresh nails
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Identity confirmation modal ────────────────────────
// Shown when a phone-auth caller matched an existing client record that
// hasn't been used in >180 days. The server has already WITHHELD all
// account PII for this session (phone-recycling defense). This modal is
// transparency-only: it tells the visitor we recognized the number, asks
// them to manually re-enter their info, and links them to their history
// at book-submit time via the existing server-side dedup.
function IdentityConfirmPrompt({ firstInitial, onDismiss }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 360, boxShadow: '0 20px 60px rgba(0,0,0,.3)', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>👋</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
          Welcome back{firstInitial ? `, ${firstInitial}.` : ''}
        </div>
        <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5, marginBottom: 18 }}>
          We recognize this phone number from a past visit. For your privacy, we'll have you re-enter your name and email — we'll connect this booking to your history once you complete it.
        </div>
        <button onClick={onDismiss}
          style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: 'var(--tm-primary, #2D7A5F)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Continue
        </button>
      </div>
    </div>
  );
}

// ── Cross-device email link prompt ────────────────────
// Shown when user clicks a magic link on a different device than where they requested it
function CrossDevicePrompt({ onDone }) {
  const [email,   setEmail]   = useState('');
  const [working, setWorking] = useState(false);
  const [error,   setError]   = useState('');

  async function complete() {
    if (!email.trim()) return;
    setWorking(true); setError('');
    try {
      await signInWithEmailLink(auth, email.trim(), window.location.href);
      localStorage.removeItem('meraki_booking_email');
      window.history.replaceState({}, '', '/book');
      onDone();
    } catch (e) {
      setError('That email didn\'t match. Please try again.');
      setWorking(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,.3)', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🔗</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Confirm your email</div>
        <div style={{ fontSize: 13, color: '#888', lineHeight: 1.5, marginBottom: 18 }}>
          Enter the email address you used to request this sign-in link.
        </div>
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && complete()}
          placeholder="you@example.com" autoFocus
          style={{ width: '100%', fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 10, padding: '11px 14px', fontSize: 16, outline: 'none', background: '#fafafa', boxSizing: 'border-box', marginBottom: 10 }}
        />
        <button onClick={complete} disabled={working || !email.trim()}
          style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: working || !email.trim() ? '#d0d0d0' : 'var(--tm-primary, #2D7A5F)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: working || !email.trim() ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {working ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}

// ── Shared UI ──────────────────────────────────────────
// One input that auto-detects whether the user is typing an email (sends a
// magic link) or a phone number (sends an SMS one-time code). Once a code is
// in flight we swap the input for a 6-digit code entry. Anything else (Google)
// is offered as a sibling button by the parent.
function UnifiedAuthRow({
  form, onChange,
  emailLinkState, onSendEmailLink,
  otpState, otpError, otpPhonePretty,
  onSendOtp, onVerifyOtp, onResetOtp,
}) {
  const [local, setLocal] = useState(form.email || form.phone || '');
  const [code,  setCode]  = useState('');
  const kind = detectAuthInputKind(local);
  const isValidEmail = kind === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(local.trim());
  const isValidPhone = kind === 'phone' && !!toE164(local);

  const otpActive = otpState === 'sending' || otpState === 'awaiting-code' || otpState === 'verifying';
  const sendBusy  = emailLinkState === 'sending' || otpState === 'sending';
  const canSend   = !sendBusy && (isValidEmail || isValidPhone);

  function send() {
    if (!canSend) return;
    if (isValidEmail) {
      onChange({ email: local.trim() });
      onSendEmailLink(local.trim());
    } else if (isValidPhone) {
      onChange({ phone: local.trim() });
      onSendOtp(local.trim());
    }
  }

  if (emailLinkState === 'sent') {
    return (
      <div style={{ padding: '14px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ fontSize: 22, marginTop: 2 }}>📬</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 3 }}>Check your email!</div>
          <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5 }}>
            We sent a sign-in link to <strong>{local}</strong>. Click it to come back and finish.
          </div>
        </div>
      </div>
    );
  }

  if (otpActive) {
    const verifying = otpState === 'verifying';
    return (
      <div style={{ padding: '14px 16px', borderTop: '1px solid #f0f0f0' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>Enter the 6-digit code</div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          {otpPhonePretty ? <>Texted to <strong>{otpPhonePretty}</strong>.</> : <>We texted you a code.</>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input
            type="tel" inputMode="numeric" autoComplete="one-time-code"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => e.key === 'Enter' && onVerifyOtp(code)}
            placeholder="123456" autoFocus disabled={verifying}
            style={{ flex: 1, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 10, padding: '10px 12px', fontSize: 18, letterSpacing: '0.3em', textAlign: 'center', outline: 'none', background: '#fafafa', color: '#1a1a1a', minWidth: 0 }}
          />
          <button onClick={() => onVerifyOtp(code)} disabled={verifying || code.length !== 6}
            style={{ flexShrink: 0, padding: '0 16px', borderRadius: 10, border: 'none', background: !verifying && code.length === 6 ? 'var(--tm-primary, #2D7A5F)' : '#d0d0d0', color: '#fff', fontSize: 13, fontWeight: 700, cursor: !verifying && code.length === 6 ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {verifying ? 'Verifying…' : 'Verify →'}
          </button>
        </div>
        {otpError && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 6 }}>{otpError}</div>}
        <button onClick={() => { setCode(''); onResetOtp(); }}
          style={{ marginTop: 8, background: 'none', border: 'none', color: '#888', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0, textDecoration: 'underline' }}>
          Use a different number or email
        </button>
      </div>
    );
  }

  // Default: one smart input. Button label flips based on what they're typing.
  const btnLabel = isValidEmail ? 'Send link ✉️'
                : isValidPhone ? 'Send code 📱'
                : kind === 'email' ? 'Send link ✉️'
                : kind === 'phone' ? 'Send code 📱'
                : 'Send';
  return (
    <div style={{ padding: '14px 16px', borderTop: '1px solid #f0f0f0' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 8 }}>
        Sign in with phone or email
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          type="text"
          value={local}
          onChange={e => setLocal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="(555) 555-0100  or  you@example.com"
          autoComplete="email"
          style={{ flex: 1, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 10, padding: '10px 12px', fontSize: 16, outline: 'none', background: '#fafafa', color: '#1a1a1a', minWidth: 0 }}
        />
        <button onClick={send} disabled={!canSend}
          style={{ flexShrink: 0, padding: '0 16px', borderRadius: 10, border: 'none', background: canSend ? 'var(--tm-primary, #2D7A5F)' : '#d0d0d0', color: '#fff', fontSize: 13, fontWeight: 700, cursor: canSend ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          {sendBusy ? 'Sending…' : btnLabel}
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>
        We'll text or email a one-time link — no password needed.
      </div>
      {emailLinkState === 'error' && (
        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 6 }}>Couldn't send link. Try a different method.</div>
      )}
      {otpState === 'error' && otpError && (
        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 6 }}>{otpError}</div>
      )}
    </div>
  );
}

function ServiceThumb({ svc, color, size = 36 }) {
  const [err, setErr] = useState(false);
  if (svc?.image && !err) {
    return <img src={svc.image} alt={svc.name || ''} onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />;
  }
  const icon = CATEGORY_ICONS[svc?.category] || '💅';
  return (
    <div style={{ width: size, height: size, borderRadius: 8, background: `${typeof color === 'string' && color.startsWith('#') ? color + '20' : 'rgba(45,122,95,.12)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.55, flexShrink: 0 }}>
      {icon}
    </div>
  );
}

function TechAvatar({ tech, size = 56 }) {
  const [err, setErr] = useState(false);
  if (tech.photo && !err) {
    return <img src={tech.photo} alt={tech.name} onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid #e8e8e8' }} />;
  }
  const ini = (tech.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,var(--tm-primary, #2D7A5F),var(--tm-accent, #3D95CE))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: size * 0.28, fontWeight: 700, flexShrink: 0 }}>
      {ini}
    </div>
  );
}
function GoogleSignInBtn({ onClick }) {
  async function go() {
    if (onClick) return onClick();
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch { /* cancelled */ }
  }
  return (
    <button onClick={go} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #d8d8d8', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#333', fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
      <GoogleIcon />
      Sign in
    </button>
  );
}
function GoogleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}
function StepTitle({ children }) {
  return <div style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a', marginBottom: 18, letterSpacing: '-.3px' }}>{children}</div>;
}
function BackBtn({ onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--tm-accent, #3D95CE)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, padding: '6px 0' }}>
      ← Back
    </button>
  );
}
function FullCenter({ children }) {
  return <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8' }}>{children}</div>;
}
function Spinner() {
  return <div style={{ width: 32, height: 32, border: '3px solid #e0e0e0', borderTop: '3px solid var(--tm-primary, #2D7A5F)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />;
}
