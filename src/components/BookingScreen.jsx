import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut as fbSignOut,
         sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  fetchServices, fetchEmployees, fetchBookingConfig, fetchWebfrontConfig,
  fetchAppointments, fetchAppointmentsByRange, createAppointment, fetchClientByEmail, createClient,
  saveBookingConfig,
} from '../lib/firestore';
import { getTheme, detectAutoTheme } from '../lib/themes';
import { groupByCategory, formatPrice, formatDuration, resolveServicePricing } from '../utils/serviceHelpers';
import { pickTech, startOfWeek, endOfWeek, DEFAULT_ASSIGNMENT_METHOD } from '../lib/techAssignment';

// ── constants ──────────────────────────────────────────
const BOOKING_START = 9 * 60;
const BOOKING_END   = 20 * 60;
const SLOT_STEP     = 30;

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

// ── helpers ────────────────────────────────────────────
function strToMins(str) {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}
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

function applyThemeVars(theme) {
  const r = document.documentElement;
  r.style.setProperty('--tm-primary',   theme.primary);
  r.style.setProperty('--tm-accent',    theme.accent);
  r.style.setProperty('--tm-grad',      `linear-gradient(135deg,${theme.gradStart},${theme.gradEnd})`);
  r.style.setProperty('--tm-grad-dark', `linear-gradient(135deg,${theme.dark},${theme.gradStart})`);
  r.style.setProperty('--tm-dark',      theme.dark);
}

function techCanDo(tech, serviceId) {
  // Empty/missing serviceIds means "can do all" (backward compatible default)
  if (!tech.serviceIds || tech.serviceIds.length === 0) return true;
  return tech.serviceIds.includes(serviceId);
}
function techsForService(techs, service) {
  if (!service) return techs;
  return techs.filter(t => techCanDo(t, service.id));
}
function isTechFreeAt(tech, slotMins, durationMins, appts) {
  const relevant = appts.filter(a => a.techId === tech.id || a.techName === tech.name);
  const end = slotMins + durationMins;
  return !relevant.some(a => {
    const aStart = strToMins(a.startTime);
    const aDur = (a.services || []).reduce((s, sv) => s + (Number(sv.duration) || 0), 0) || (a.duration || 60);
    return aStart < end && (aStart + aDur) > slotMins;
  });
}
function firstFreeTech(techs, slotMins, durationMins, appts) {
  return techs.find(t => isTechFreeAt(t, slotMins, durationMins, appts)) || null;
}
function getSlots(dur) {
  const slots = [];
  for (let m = BOOKING_START; m + dur <= BOOKING_END; m += SLOT_STEP) slots.push(m);
  return slots;
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
  // Multi-service cart. Each item: { id, service, option, tech, date, slot, removal }
  // tech: undefined=not picked, null=no preference, {…}=specific tech
  const [cart, setCart] = useState([]);
  // Per-date appointment cache so each cart item's date picker can check
  // availability without refetching every render.
  const [apptsByDate, setApptsByDate] = useState({});
  const [form,    setForm]    = useState({ name: '', phone: '', email: '', notes: '' });
  const [submitting,      setSubmitting]      = useState(false);
  const [confirmed,       setConfirmed]       = useState(null);
  const [emailLinkState,  setEmailLinkState]  = useState(null); // null|'sending'|'sent'|'error'
  const [emailLinkDevice, setEmailLinkDevice] = useState(false); // cross-device: need email to finish

  // Complete email-link sign-in if returning from magic link
  useEffect(() => {
    if (!isSignInWithEmailLink(auth, window.location.href)) return;
    const stored = localStorage.getItem('meraki_booking_email');
    if (stored) {
      signInWithEmailLink(auth, stored, window.location.href)
        .then(() => {
          localStorage.removeItem('meraki_booking_email');
          window.history.replaceState({}, '', '/?book=1');
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
        url: `${window.location.origin}/?book=1`,
        handleCodeInApp: true,
      });
      localStorage.setItem('meraki_booking_email', email.trim());
      setEmailLinkState('sent');
    } catch (e) {
      console.error('[EmailLink send]', e.message);
      setEmailLinkState('error');
    }
  }

  // listen for Google auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      setGUser(user || null);
      if (user?.email) {
        fetchClientByEmail(user.email).then(c => {
          // Defensive: only treat as a returning client if the names plausibly match.
          // Guards against shared/typo'd email entries pointing at someone else's record.
          const matches = c && (!user.displayName || firstName(c.name) === firstName(user.displayName));
          setClient(matches ? c : null);
          if (matches) setForm(f => ({
            ...f,
            name:  f.name  || c.name  || user.displayName || '',
            phone: f.phone || c.phone || '',
            email: user.email,
          }));
          else setForm(f => ({
            ...f,
            name:  f.name  || user.displayName || '',
            email: f.email || user.email,
          }));
        }).catch(() => {});
      } else {
        setClient(null);
      }
    });
    return unsub;
  }, []);

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
  // In tech-first mode, the chosen tech is auto-assigned to every new line.
  function addToCart(svc, opt) {
    const id = `cart_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    const initialTech = flow === 'tech-first' && pickedTech ? pickedTech : undefined;
    setCart(c => [...c, { id, service: svc, option: opt || null, tech: initialTech, date: '', slot: null, removal: false }]);
  }
  function removeFromCart(itemId) {
    setCart(c => c.filter(i => i.id !== itemId));
  }
  function updateCartItem(itemId, patch) {
    setCart(c => c.map(i => i.id === itemId ? { ...i, ...patch } : i));
  }

  // Lazy-fetch + cache appointments per date for any cart item that needs them.
  async function ensureApptsForDate(d) {
    if (!d || apptsByDate[d]) return;
    try {
      const list = await fetchAppointments(d);
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
    setForm({ name: '', phone: '', email: '', notes: '' });
  }

  async function handleBook() {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      // Auto-create a client record once per booking session.
      let clientId = client?.id || '';
      if (!clientId && gUser?.email && form.name.trim() && form.phone.trim()) {
        try {
          clientId = await createClient({
            name:    form.name.trim(),
            phone:   form.phone.trim(),
            email:   form.email.trim() || gUser.email,
            picture: gUser.photoURL || '',
            source:  'online_booking',
          });
        } catch (e) { console.error('[Booking] auto-create client failed:', e); }
      }

      // Pre-fetch week appointments once per unique week the cart spans —
      // needed for leastBusyWeek and lowestRevenueWeek assignment methods.
      const method = cfg?.assignmentMethod || DEFAULT_ASSIGNMENT_METHOD;
      const weekCache = {};
      if (method === 'leastBusyWeek' || method === 'lowestRevenueWeek') {
        const weeks = [...new Set(cart.map(it => startOfWeek(it.date)))];
        await Promise.all(weeks.map(async wk => {
          weekCache[wk] = await fetchAppointmentsByRange(wk, endOfWeek(wk)).catch(() => []);
        }));
      }
      let rrIdx = cfg?.roundRobinIndex || 0;
      const startingRrIdx = rrIdx;

      const created = [];
      for (const item of cart) {
        const { service: svc, option: opt, tech: itemTech, date: itemDate, slot: itemSlot } = item;
        const resolved = resolveServicePricing(svc, opt);
        const dur   = resolved.duration || 60;
        const price = resolved.price    || 0;
        const dayAppts = apptsByDate[itemDate] || [];
        const eligible = techsForService(techs, svc);
        let assignedTech = itemTech;
        let techRequestType = 'specific';
        if (itemTech === null) {
          techRequestType = 'auto';
          const free = eligible.filter(t => isTechFreeAt(t, itemSlot, dur, dayAppts));
          const weekAppts = weekCache[startOfWeek(itemDate)] || [];
          const result = pickTech({
            method, freeTechs: free,
            dayAppts, weekAppts, roundRobinIndex: rrIdx,
          });
          assignedTech = result.tech || firstFreeTech(eligible, itemSlot, dur, dayAppts);
          rrIdx = result.nextRoundRobinIndex;
        }
        const h = Math.floor(itemSlot / 60), m = itemSlot % 60;

        // Build service line + optional removal line. Removal price comes from
        // bookingConfig (mirror of settings.removalPrice). Removal duration
        // defaults to 15 min — adjust if needed in a future setting.
        const removalAddPrice = item.removal && svc.canRequireRemoval ? Number(cfg?.removalPrice ?? 15) : 0;
        const services = [{
          id: svc.id,
          name: opt?.name ? `${svc.name} — ${opt.name}` : svc.name,
          price, duration: dur,
          optionId: opt?.id || null, optionName: opt?.name || null,
        }];
        if (removalAddPrice > 0) {
          services.push({
            id: 'removal',
            name: `Removal (${svc.name})`,
            price: removalAddPrice,
            duration: 15,
            isRemoval: true,
          });
        }
        const totalDur = services.reduce((s, sv) => s + (Number(sv.duration) || 0), 0);

        const appt = {
          date:        itemDate,
          startTime:   `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
          duration:    totalDur,
          techId:      assignedTech?.id   || null,
          techName:    assignedTech?.name || 'TBD',
          techRequestType,
          clientId,
          clientName:  form.name.trim(),
          clientPhone: form.phone.trim(),
          clientEmail: form.email.trim() || gUser?.email || null,
          services,
          status:      'scheduled',
          notes:       form.notes.trim() || null,
          source:      'online_booking',
          createdAt:   new Date().toISOString(),
          updatedAt:   new Date().toISOString(),
        };
        await createAppointment(appt);
        created.push({ ...appt, _service: svc, _option: opt, _tech: assignedTech });
      }

      // Persist round-robin counter so the next booking continues the cycle.
      if (rrIdx !== startingRrIdx && cfg) {
        try { await saveBookingConfig({ ...cfg, roundRobinIndex: rrIdx }); }
        catch (e) { console.warn('[Booking] roundRobin persist failed:', e); }
      }

      setConfirmed(created);
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
        step={step} cfg={cfg} flow={flow}
        gUser={gUser} client={client}
        onSignIn={handleGoogleSignIn}
        onSignOut={handleSignOut}
      />

      {emailLinkDevice && (
        <CrossDevicePrompt onDone={() => setEmailLinkDevice(false)} />
      )}

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
              if (f === 'time-first') setPickedTech(null);
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
            onSwitchFlow={() => { setStep(0); setCart([]); }}
          />
        )}
        {step === 1 && flow === 'tech-first' && (
          <Step1PickStylist
            techs={techs}
            picked={pickedTech}
            onPick={t => setPickedTech(t)}
            onProceed={() => setStep(2)}
            onSwitchFlow={() => { setStep(0); setCart([]); setPickedTech(null); }}
          />
        )}
        {step === 2 && flow === 'time-first' && (
          <Step2AssignTechs
            cart={cart} allTechs={techs}
            updateCartItem={updateCartItem}
            onProceed={() => setStep(3)}
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
          />
        )}
        {step === 3 && (
          <Step3ScheduleEach
            cart={cart} allTechs={techs}
            apptsByDate={apptsByDate}
            ensureApptsForDate={ensureApptsForDate}
            updateCartItem={updateCartItem}
            onProceed={() => {
              const haveAll = form.name.trim() && form.phone.trim();
              setStep(haveAll ? 5 : 4);
            }}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <Step4Info
            form={form}
            gUser={gUser} client={client}
            emailLinkState={emailLinkState}
            onSendEmailLink={sendEmailLink}
            onChange={patch => setForm(f => ({ ...f, ...patch }))}
            onNext={() => setStep(5)}
            onBack={() => setStep(3)}
          />
        )}
        {step === 5 && (
          <Step5Confirm
            cart={cart} allTechs={techs}
            apptsByDate={apptsByDate}
            form={form} submitting={submitting}
            removalPrice={Number(cfg?.removalPrice ?? 15)}
            updateCartItem={updateCartItem}
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
function Header({ step, cfg, flow, gUser, client, onSignIn, onSignOut }) {
  const labels = flow === 'tech-first'
    ? ['Stylist','Services','Schedule','Info','Confirm']
    : ['Cart','Stylists','Schedule','Info','Confirm'];
  return (
    <div style={{ background: 'var(--tm-grad-dark, linear-gradient(135deg,#1e6b50,#2D7A5F 40%,#3D7FBF))', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 2px 12px rgba(0,0,0,.18)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '14px 12px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg viewBox="0 0 60 60" fill="none" width={20} height={20}><circle cx="30" cy="22" r="7" fill="white"/><path d="M14 50c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="white" strokeWidth="3.5" strokeLinecap="round"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', letterSpacing: '-.2px' }}>Meraki Nail Studio</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)' }}>Book an Appointment</div>
            </div>
          </div>
          {/* Auth button */}
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

        {/* Step progress (hidden on the flow chooser) */}
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
function Step1Cart({ services, cart, onAdd, onRemove, onProceed, onSwitchFlow, techFirstNote }) {
  const groups = groupByCategory(services);
  // Per-row selected option (local UI state) — picking a variant chip just
  // remembers it so 'Add to cart' adds the right one.
  const [pendingOptions, setPendingOptions] = useState({}); // svc.id → option
  const cartTotal = cart.reduce((sum, item) => {
    const { price } = resolveServicePricing(item.service, item.option);
    return sum + (price || 0);
  }, 0);
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

function ServiceRow({ svc, color, selectedOption, divider, onSelectOption, onAdd }) {
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
          {hasOptions ? `from $${minOptPrice}` : formatPrice(svc.basePrice, svc.priceFrom)}
        </span>
        <button onClick={handleAddClick}
          style={{
            fontSize: 12, fontWeight: 700,
            color: '#fff', border: 'none',
            background: 'var(--tm-primary, #2D7A5F)',
            padding: '7px 16px', borderRadius: 999,
            letterSpacing: '.04em', whiteSpace: 'nowrap',
            boxShadow: '0 2px 6px rgba(0,0,0,.10)',
            cursor: 'pointer', fontFamily: 'inherit',
            transition: 'background .15s',
          }}>
          + Add
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Assign a stylist to each cart item ─────────
function Step2AssignTechs({ cart, allTechs, updateCartItem, onProceed, onBack }) {
  const allTechsAssigned = cart.every(item => item.tech !== undefined);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <StepTitle>Choose a stylist for each service</StepTitle>
      <div style={{ fontSize: 13, color: '#888', marginTop: -10, marginBottom: 18, lineHeight: 1.5 }}>
        Each service can have its own stylist (or pick "no preference" and we'll assign someone).
      </div>
      {cart.map((item, idx) => {
        const eligible = techsForService(allTechs, item.service);
        const filteredOut = allTechs.length - eligible.length;
        const itemLabel = item.option?.name ? `${item.service.name} — ${item.option.name}` : item.service.name;
        return (
          <div key={item.id} style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #f1f1f1' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', letterSpacing: '.06em', textTransform: 'uppercase' }}>Service {idx + 1}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginTop: 2 }}>{itemLabel}</div>
              </div>
              {item.tech !== undefined && (
                <div style={{ fontSize: 12, color: 'var(--tm-primary, #2D7A5F)', fontWeight: 700 }}>
                  ✓ {item.tech === null ? 'No preference' : item.tech.name}
                </div>
              )}
            </div>

            {eligible.length === 0 ? (
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#7c2d12' }}>No stylists perform this service</div>
                <div style={{ fontSize: 11, color: '#9a3412', marginTop: 3 }}>Remove it from your cart to continue.</div>
              </div>
            ) : (
              <>
                {filteredOut > 0 && (
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
                    Showing only stylists who perform this service.
                  </div>
                )}
                <button onClick={() => updateCartItem(item.id, { tech: null })} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                  borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
                  marginBottom: 10,
                  border: `1.5px solid ${item.tech === null ? 'var(--tm-primary, #2D7A5F)' : '#e8e8e8'}`,
                  background: item.tech === null ? '#f0f9f5' : '#fff',
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>💅</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>No preference</div>
                    <div style={{ fontSize: 11, color: '#888' }}>We'll pick an available stylist</div>
                  </div>
                </button>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                  {eligible.map(t => (
                    <TechCard key={t.id} tech={t}
                      selected={item.tech?.id === t.id}
                      onSelect={() => updateCartItem(item.id, { tech: t })} />
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={onBack} style={{ flex: 1, padding: '14px', borderRadius: 12, border: '1px solid #d8d8d8', background: '#fff', color: '#555', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          ← Back
        </button>
        <button onClick={onProceed} disabled={!allTechsAssigned}
          style={{ flex: 2, padding: '14px', borderRadius: 12, border: 'none', background: allTechsAssigned ? 'var(--tm-primary, #2D7A5F)' : '#d0d0d0', color: '#fff', fontSize: 15, fontWeight: 700, cursor: allTechsAssigned ? 'pointer' : 'default', fontFamily: 'inherit' }}>
          Continue →
        </button>
      </div>
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

// ── Step 3: Schedule each cart item ────────────────────
function Step3ScheduleEach({ cart, allTechs, apptsByDate, ensureApptsForDate, updateCartItem, onProceed, onBack }) {
  const allScheduled = cart.every(item => item.date && item.slot != null);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <StepTitle>Pick a date &amp; time for each service</StepTitle>
      <div style={{ fontSize: 13, color: '#888', marginTop: -10, marginBottom: 18, lineHeight: 1.5 }}>
        Schedule each service individually — same day or different days, your call.
      </div>
      {cart.map((item, idx) => (
        <CartItemSchedule
          key={item.id}
          item={item} idx={idx}
          allTechs={allTechs}
          apptsByDate={apptsByDate}
          ensureApptsForDate={ensureApptsForDate}
          updateCartItem={updateCartItem}
        />
      ))}

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={onBack} style={{ flex: 1, padding: '14px', borderRadius: 12, border: '1px solid #d8d8d8', background: '#fff', color: '#555', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          ← Back
        </button>
        <button onClick={onProceed} disabled={!allScheduled}
          style={{ flex: 2, padding: '14px', borderRadius: 12, border: 'none', background: allScheduled ? 'var(--tm-primary, #2D7A5F)' : '#d0d0d0', color: '#fff', fontSize: 15, fontWeight: 700, cursor: allScheduled ? 'pointer' : 'default', fontFamily: 'inherit' }}>
          Continue →
        </button>
      </div>
    </div>
  );
}

function CartItemSchedule({ item, idx, allTechs, apptsByDate, ensureApptsForDate, updateCartItem }) {
  const dur = resolveServicePricing(item.service, item.option).duration || 60;
  const allSlots = getSlots(dur);
  const eligible = techsForService(allTechs, item.service);
  const dayAppts = item.date ? apptsByDate[item.date] : null;

  useEffect(() => { if (item.date) ensureApptsForDate(item.date); }, [item.date]); // eslint-disable-line

  function isAvailable(slotMins) {
    if (!dayAppts) return false;
    if (item.tech) return isTechFreeAt(item.tech, slotMins, dur, dayAppts);
    // No preference — at least one eligible tech must be free.
    return eligible.some(t => isTechFreeAt(t, slotMins, dur, dayAppts));
  }
  const hasAny = dayAppts && allSlots.some(s => isAvailable(s));
  const itemLabel = item.option?.name ? `${item.service.name} — ${item.option.name}` : item.service.name;
  const techLabel = item.tech ? item.tech.name : 'No preference';

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #f1f1f1' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', letterSpacing: '.06em', textTransform: 'uppercase' }}>Service {idx + 1} · {dur} min</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginTop: 2 }}>{itemLabel}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Stylist: {techLabel}</div>
        </div>
        {item.date && item.slot != null && (
          <div style={{ fontSize: 12, color: 'var(--tm-primary, #2D7A5F)', fontWeight: 700, textAlign: 'right' }}>
            ✓ {fmtDate(item.date)}<br/>{minsToStr(item.slot)}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <BookingCalendar value={item.date} onChange={d => updateCartItem(item.id, { date: d, slot: null })} />
        </div>
        {item.date && (
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#555', marginBottom: 12 }}>{fmtDate(item.date)}</div>
            {dayAppts == null ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>
            ) : hasAny ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(75px, 1fr))', gap: 6 }}>
                {allSlots.map(m => {
                  const avail = isAvailable(m);
                  const isSel = item.slot === m;
                  return (
                    <button key={m} onClick={() => avail && updateCartItem(item.id, { slot: m })} disabled={!avail}
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
  );
}

// ── Step 4: Info ───────────────────────────────────────
function Step4Info({ form, gUser, client, emailLinkState, onSendEmailLink, onChange, onNext, onBack }) {
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
          <GoogleSignInBtn />
        </div>

        {/* Email magic link */}
        <EmailLinkRow
          form={form}
          onChange={onChange}
          emailLinkState={emailLinkState}
          onSendEmailLink={onSendEmailLink}
        />
      </div>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0' }}>
        <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
        <div style={{ fontSize: 11, fontWeight: 600, color: '#bbb', letterSpacing: '.08em', textTransform: 'uppercase' }}>or continue as guest</div>
        <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
      </div>

      {formCard}

      <button onClick={onNext} disabled={!valid}
        style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', background: valid ? 'var(--tm-primary, #2D7A5F)' : '#d0d0d0', color: '#fff', fontSize: 16, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'inherit', marginBottom: 10 }}>
        Review Booking →
      </button>
      <BackBtn onClick={onBack} />
    </div>
  );
}

// ── Step 5: Confirm (multi-item) ────────────────────────
function Step5Confirm({ cart, allTechs, apptsByDate, form, submitting, removalPrice, updateCartItem, onConfirm, onBack, onEditInfo }) {
  const removalCount = cart.filter(it => it.removal).length;
  const totalPrice = cart.reduce((sum, item) => {
    const base = resolveServicePricing(item.service, item.option).price || 0;
    return sum + base + (item.removal ? Number(removalPrice) || 0 : 0);
  }, 0);
  const totalDur   = cart.reduce((sum, item) => sum + (resolveServicePricing(item.service, item.option).duration || 0), 0);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <StepTitle>Confirm booking</StepTitle>

      {/* Per-item summary cards */}
      {cart.map((item, idx) => {
        const resolved = resolveServicePricing(item.service, item.option);
        const dur = resolved.duration || 60;
        const eligible = techsForService(allTechs, item.service);
        const dayAppts = apptsByDate[item.date] || [];
        const assignedTech = item.tech !== null ? item.tech : firstFreeTech(eligible, item.slot, dur, dayAppts);
        const itemLabel = item.option?.name ? `${item.service.name} — ${item.option.name}` : item.service.name;
        return (
          <div key={item.id} style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, overflow: 'hidden', marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
            <div style={{ background: `linear-gradient(135deg,${CATEGORY_COLORS[item.service?.category] || 'var(--tm-primary, #2D7A5F)'},var(--tm-accent, #3D95CE))`, padding: '14px 18px' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Service {idx + 1}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 2 }}>{itemLabel}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,.9)', background: 'rgba(255,255,255,.15)', borderRadius: 6, padding: '2px 8px' }}>${resolved.price}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,.9)', background: 'rgba(255,255,255,.15)', borderRadius: 6, padding: '2px 8px' }}>⏱ {dur} min</span>
              </div>
            </div>
            {[
              { icon: '👩‍💼', label: 'Stylist', value: assignedTech?.name || 'Any available' },
              { icon: '📅',  label: 'Date',    value: fmtDate(item.date) },
              { icon: '🕐',  label: 'Time',    value: minsToStr(item.slot) },
            ].map(({ icon, label, value }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', padding: '10px 18px', borderTop: '1px solid #f0f0f0', gap: 10 }}>
                <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                <span style={{ fontSize: 11, color: '#aaa', width: 56, flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>{value}</span>
              </div>
            ))}
            {item.service.canRequireRemoval && (
              <div style={{ padding: '12px 18px', borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>Do you need a removal first?</div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.5 }}>
                  Remove an existing set of {item.service.category === 'Acrylics' ? 'acrylics' : 'gel/dip'} before this service. Adds <strong>${Number(removalPrice).toFixed(2)}</strong>.
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[true, false].map(v => {
                    const sel = item.removal === v;
                    return (
                      <button key={String(v)} onClick={() => updateCartItem(item.id, { removal: v })}
                        style={{ flex: 1, padding: '8px 10px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1.5px solid ${sel ? (v ? '#2D7A5F' : '#3D95CE') : '#e0e0e0'}`, background: sel ? (v ? '#EDFAF3' : '#EBF4FB') : '#fff', color: sel ? (v ? '#166534' : '#1a5f8a') : '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
                        {v ? `✓ Yes — add removal (+$${Number(removalPrice).toFixed(2)})` : 'No removal'}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Total + customer info */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{cart.length} {cart.length === 1 ? 'service' : 'services'} · {totalDur} min total</span>
          <span style={{ fontSize: 17, fontWeight: 800, color: '#1a1a1a' }}>${totalPrice}</span>
        </div>
        {[
          { icon: '👤',  label: 'Name',  value: form.name },
          { icon: '📞',  label: 'Phone', value: form.phone },
          form.email && { icon: '✉️', label: 'Email', value: form.email },
          form.notes && { icon: '📝', label: 'Notes', value: form.notes },
        ].filter(Boolean).map(({ icon, label, value }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', padding: '10px 18px', borderTop: '1px solid #f0f0f0', gap: 10 }}>
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

      <button onClick={onConfirm} disabled={submitting}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: submitting ? '#aaa' : 'var(--tm-primary, #2D7A5F)', color: '#fff', fontSize: 16, fontWeight: 800, cursor: submitting ? 'default' : 'pointer', fontFamily: 'inherit', marginBottom: 10, letterSpacing: '.01em' }}>
        {submitting ? 'Booking…' : `✓ Confirm ${cart.length} ${cart.length === 1 ? 'Appointment' : 'Appointments'}`}
      </button>
      <BackBtn onClick={onBack} />
      <div style={{ fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
        By booking, you agree to our cancellation policy. A deposit may be required for new clients.
      </div>
    </div>
  );
}

// ── Success ────────────────────────────────────────────
function SuccessScreen({ appts, techs, webCfg }) {
  const list = Array.isArray(appts) ? appts : [appts];
  const address = webCfg?.address || '5029 Olentangy River Rd\nColumbus, OH 43214';
  const addressOneLine = address.replace(/\n/g, ', ');
  const mapsUrl = webCfg?.mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(addressOneLine)}`;
  const phone = webCfg?.phone?.trim();
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : null;
  const sendEmail = list.find(a => a.clientEmail)?.clientEmail;
  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', overflowX: 'hidden', background: '#f5f6f8', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'var(--tm-grad-dark, linear-gradient(135deg,#1e6b50,#2D7A5F 40%,#3D7FBF))', padding: '20px 20px 40px' }}>
        <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Meraki Nail Studio</div>
        </div>
      </div>
      <div style={{ maxWidth: 600, margin: '-24px auto 0', padding: '0 16px 48px', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px', boxShadow: '0 8px 32px rgba(0,0,0,.1)', textAlign: 'center', marginBottom: 16 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#f0f9f5', border: '3px solid var(--tm-primary, #2D7A5F)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 30, color: 'var(--tm-primary, #2D7A5F)' }}>
            ✓
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#1a1a1a', marginBottom: 6 }}>You're booked!</div>
          <div style={{ fontSize: 14, color: '#888', lineHeight: 1.7 }}>
            {list.length === 1
              ? <>See you on <strong style={{ color: '#333' }}>{fmtDate(list[0].date)}</strong> at <strong style={{ color: '#333' }}>{minsToStr(strToMins(list[0].startTime))}</strong></>
              : <>{list.length} appointments confirmed.</>}
            {sendEmail && (
              <><br /><span style={{ fontSize: 12, color: '#bbb' }}>Confirmation sent to {sendEmail}</span></>
            )}
          </div>
        </div>

        {list.map((a, idx) => {
          const svc  = a._service;
          const opt  = a._option;
          const tech = a._tech || techs?.find(t => t.id === a.techId) || null;
          const color = CATEGORY_COLORS[svc?.category] || 'var(--tm-primary, #2D7A5F)';
          const label = opt?.name ? `${svc?.name} — ${opt.name}` : svc?.name;
          return (
            <div key={idx} style={{ background: '#fff', borderRadius: 14, padding: '14px 18px', boxShadow: '0 2px 8px rgba(0,0,0,.06)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <ServiceThumb svc={svc} color={color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{label}</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{fmtDate(a.date)} · {minsToStr(strToMins(a.startTime))}</div>
                </div>
              </div>
              {a.techName !== 'TBD' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #f5f5f5' }}>
                  {tech ? <TechAvatar tech={tech} size={28} /> : <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>👩‍💼</span>}
                  <span style={{ fontSize: 12, color: '#666' }}>with {a.techName}</span>
                </div>
              )}
            </div>
          );
        })}

        {/* Salon contact card */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '8px 20px', boxShadow: '0 2px 8px rgba(0,0,0,.06)', marginBottom: 16 }}>
          {[
            { icon: '📍', text: addressOneLine, href: mapsUrl, external: true },
            phone
              ? { icon: '📞', text: phone, href: telHref }
              : { icon: '💬', text: 'Have a question? Chat with us', href: '/?web#chat' },
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

        <a href="/?web" style={{ display: 'block', textAlign: 'center', fontSize: 15, fontWeight: 700, color: '#fff', textDecoration: 'none', background: 'var(--tm-accent, #3D95CE)', borderRadius: 14, padding: '15px', boxShadow: '0 2px 8px rgba(61,149,206,.35)' }}>
          ← Back to Meraki Nail Studio
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
      window.history.replaceState({}, '', '/?book=1');
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
function EmailLinkRow({ form, onChange, emailLinkState, onSendEmailLink }) {
  const [localEmail, setLocalEmail] = useState(form.email || '');
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(localEmail.trim());

  function send() {
    if (!isValidEmail || emailLinkState === 'sending') return;
    onChange({ email: localEmail.trim() });
    onSendEmailLink(localEmail.trim());
  }

  if (emailLinkState === 'sent') {
    return (
      <div style={{ padding: '14px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ fontSize: 22, marginTop: 2 }}>📬</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 3 }}>Check your email!</div>
          <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5 }}>
            We sent a sign-in link to <strong>{localEmail}</strong>. Click it to come back and finish.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 16px', borderTop: '1px solid #f0f0f0' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 8 }}>Sign in with email link</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          type="email" value={localEmail} onChange={e => setLocalEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="you@example.com" autoComplete="email"
          style={{ flex: 1, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 10, padding: '10px 12px', fontSize: 16, outline: 'none', background: '#fafafa', color: '#1a1a1a', minWidth: 0 }}
        />
        <button onClick={send} disabled={!isValidEmail || emailLinkState === 'sending'}
          style={{ flexShrink: 0, padding: '0 16px', borderRadius: 10, border: 'none', background: isValidEmail && emailLinkState !== 'sending' ? 'var(--tm-primary, #2D7A5F)' : '#d0d0d0', color: '#fff', fontSize: 13, fontWeight: 700, cursor: isValidEmail && emailLinkState !== 'sending' ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          {emailLinkState === 'sending' ? 'Sending…' : 'Send link ✉️'}
        </button>
      </div>
      {emailLinkState === 'error' && (
        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 6 }}>Couldn't send link. Try Google or continue as guest.</div>
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
function GoogleSignInBtn() {
  async function go() {
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
