import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut as fbSignOut,
         sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  fetchServices, fetchEmployees, fetchBookingConfig,
  fetchAppointments, createAppointment, fetchClientByEmail,
} from '../lib/firestore';
import { groupByCategory, formatPrice, formatDuration } from '../utils/serviceHelpers';

// ── constants ──────────────────────────────────────────
const BOOKING_START = 9 * 60;
const BOOKING_END   = 20 * 60;
const SLOT_STEP     = 30;

const CATEGORY_COLORS = {
  'Manicures': '#2D7A5F', 'Pedicures': '#3D95CE', 'Gel Nails': '#8B5CF6',
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

  // auth
  const [gUser,   setGUser]   = useState(undefined); // undefined=loading, null=signed out
  const [client,  setClient]  = useState(null);      // matching client record if found

  // wizard
  const [step,    setStep]    = useState(1);
  const [service, setService] = useState(null);
  const [tech,    setTech]    = useState(undefined); // undefined=not chosen, null=no-pref, obj=specific
  const [date,    setDate]    = useState('');
  const [slot,    setSlot]    = useState(null);
  const [appts,   setAppts]   = useState(null);
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
          setClient(c);
          if (c) setForm(f => ({
            ...f,
            name:  f.name  || c.name  || user.displayName || '',
            phone: f.phone || c.phone || '',
            email: user.email,
          }));
          else setForm(f => ({ ...f, email: f.email || user.email }));
        }).catch(() => {});
      } else {
        setClient(null);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    Promise.all([fetchBookingConfig(), fetchServices(), fetchEmployees()])
      .then(([c, svcs, emps]) => {
        setCfg(c);
        setServices(svcs.filter(s => s.active !== false));
        setTechs(emps.filter(e => e.active !== false).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      })
      .catch(() => setCfg({ enabled: false }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!date) return;
    setAppts(null); setSlot(null);
    fetchAppointments(date).then(setAppts).catch(() => setAppts([]));
  }, [date]);

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
    const dur = service.duration || 60;
    let assignedTech = tech;
    if (tech === null && appts) assignedTech = firstFreeTech(techs, slot, dur, appts);
    const h = Math.floor(slot / 60), m = slot % 60;
    const appt = {
      date,
      startTime:   `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
      duration:    dur,
      techId:      assignedTech?.id   || null,
      techName:    assignedTech?.name || 'TBD',
      clientId:    client?.id || '',
      clientName:  form.name.trim(),
      clientPhone: form.phone.trim(),
      clientEmail: form.email.trim() || null,
      services:    [{ id: service.id, name: service.name, price: service.basePrice || 0, duration: dur }],
      status:      'scheduled',
      notes:       form.notes.trim() || null,
      source:      'online_booking',
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
    };
    setSubmitting(true);
    try { await createAppointment(appt); setConfirmed(appt); }
    catch { alert('Booking failed. Please try again or call us.'); }
    finally { setSubmitting(false); }
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
  if (confirmed) return <SuccessScreen appt={confirmed} service={service} />;

  return (
    <div style={{ minHeight: '100dvh', background: '#f5f6f8', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>
      <Header
        step={step} cfg={cfg}
        gUser={gUser} client={client}
        onSignIn={handleGoogleSignIn}
        onSignOut={handleSignOut}
      />

      {emailLinkDevice && (
        <CrossDevicePrompt onDone={() => setEmailLinkDevice(false)} />
      )}

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 16px 48px' }}>
        {/* Returning customer welcome */}
        {gUser && client && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f0f9f5', border: '1px solid #c3e6d8', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
            {gUser.photoURL
              ? <img src={gUser.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              : <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#2D7A5F', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, flexShrink: 0 }}>
                  {client.name?.[0] || '?'}
                </div>
            }
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a6040' }}>Welcome back, {client.name?.split(' ')[0]}!</div>
              <div style={{ fontSize: 11, color: '#4a9070' }}>Your info will be pre-filled at checkout</div>
            </div>
          </div>
        )}

        {step === 1 && (
          <Step1Service
            services={services}
            selected={service}
            onSelect={s => { setService(s); setSlot(null); setAppts(null); setStep(2); }}
          />
        )}
        {step === 2 && (
          <Step2Stylist
            techs={techs}
            selected={tech}
            onSelect={t => { setTech(t); setStep(3); }}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <Step3DateTime
            service={service} tech={tech} techs={techs}
            date={date} slot={slot} appts={appts}
            onDateChange={d => { setDate(d); setSlot(null); }}
            onSlotSelect={s => { setSlot(s); setStep(4); }}
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
            service={service} tech={tech} techs={techs}
            date={date} slot={slot} appts={appts}
            form={form} submitting={submitting}
            onConfirm={handleBook}
            onBack={() => setStep(4)}
          />
        )}
      </div>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────
function Header({ step, cfg, gUser, client, onSignIn, onSignOut }) {
  return (
    <div style={{ background: 'linear-gradient(135deg,#1e6b50,#2D7A5F 40%,#3D7FBF)', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 2px 12px rgba(0,0,0,.18)' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '14px 16px 10px' }}>
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

        {/* Step progress */}
        <div style={{ display: 'flex', gap: 4, paddingBottom: 2 }}>
          {[1,2,3,4,5].map(s => (
            <div key={s} style={{ flex: s === step ? 2 : 1, height: 3, borderRadius: 2, background: s <= step ? '#fff' : 'rgba(255,255,255,.25)', transition: 'all .25s' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, paddingBottom: 2 }}>
          {['Service','Stylist','Date','Info','Confirm'].map((label, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, fontWeight: i + 1 <= step ? 700 : 400, color: i + 1 <= step ? '#fff' : 'rgba(255,255,255,.4)', letterSpacing: '.03em', textTransform: 'uppercase' }}>
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Service ────────────────────────────────────
function Step1Service({ services, selected, onSelect }) {
  const groups = groupByCategory(services);
  return (
    <div>
      <StepTitle>Choose a service</StepTitle>
      {groups.map(({ category, services: svcs }) => {
        const color = CATEGORY_COLORS[category] || '#555';
        const icon  = CATEGORY_ICONS[category]  || '💆';
        return (
          <div key={category} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                {icon}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#333', letterSpacing: '.02em' }}>{category}</span>
              <div style={{ flex: 1, height: 1, background: '#e8e8e8' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {svcs.map(s => (
                <ServiceCard key={s.id} svc={s} color={color} selected={selected?.id === s.id} onSelect={() => onSelect(s)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ServiceCard({ svc, color, selected, onSelect }) {
  const [imgErr, setImgErr] = useState(false);
  const hasImg = svc.image && !imgErr;
  return (
    <button onClick={onSelect} style={{
      display: 'flex', alignItems: 'stretch', textAlign: 'left', fontFamily: 'inherit',
      background: '#fff', border: `1.5px solid ${selected ? color : '#e8e8e8'}`,
      borderRadius: 14, overflow: 'hidden', cursor: 'pointer', width: '100%',
      boxShadow: selected ? `0 0 0 2px ${color}30, 0 2px 8px rgba(0,0,0,.06)` : '0 1px 4px rgba(0,0,0,.05)',
      transition: 'border-color .15s, box-shadow .15s',
    }}>
      {/* Color accent bar */}
      <div style={{ width: 4, background: selected ? color : '#e8e8e8', flexShrink: 0, transition: 'background .15s' }} />
      {/* Image */}
      <div style={{ width: 80, height: 80, flexShrink: 0, background: '#f0f0f0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {hasImg
          ? <img src={svc.image} alt={svc.name} onError={() => setImgErr(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 28 }}>{CATEGORY_ICONS[svc.category] || '💅'}</span>
        }
      </div>
      {/* Text */}
      <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 3 }}>{svc.name}</div>
        {svc.description && (
          <div style={{ fontSize: 12, color: '#888', lineHeight: 1.4, marginBottom: 5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {svc.description}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: color }}>{formatPrice(svc.basePrice, svc.priceFrom)}</span>
          <span style={{ fontSize: 11, color: '#bbb' }}>·</span>
          <span style={{ fontSize: 12, color: '#888' }}>⏱ {formatDuration(svc.duration, svc.durationMin)}</span>
        </div>
      </div>
      {selected && (
        <div style={{ width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: color, fontSize: 18, flexShrink: 0, paddingRight: 8 }}>✓</div>
      )}
    </button>
  );
}

// ── Step 2: Stylist ────────────────────────────────────
function Step2Stylist({ techs, selected, onSelect, onBack }) {
  return (
    <div>
      <StepTitle>Choose your stylist</StepTitle>
      {/* No preference */}
      <button onClick={() => onSelect(null)} style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
        borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
        marginBottom: 12,
        border: `1.5px solid ${selected === null ? '#2D7A5F' : '#e8e8e8'}`,
        background: selected === null ? '#f0f9f5' : '#fff',
        boxShadow: selected === null ? '0 0 0 2px #2D7A5F30' : '0 1px 4px rgba(0,0,0,.05)',
      }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>💅</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 2 }}>No preference</div>
          <div style={{ fontSize: 12, color: '#888' }}>We'll assign an available stylist for you</div>
        </div>
        {selected === null && <div style={{ marginLeft: 'auto', color: '#2D7A5F', fontSize: 20, paddingRight: 4 }}>✓</div>}
      </button>

      {/* Tech grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {techs.map(t => (
          <TechCard key={t.id} tech={t} selected={selected?.id === t.id} onSelect={() => onSelect(t)} />
        ))}
      </div>
      <div style={{ marginTop: 16 }}><BackBtn onClick={onBack} /></div>
    </div>
  );
}

function TechCard({ tech, selected, onSelect }) {
  return (
    <button onClick={onSelect} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 12px',
      borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
      border: `1.5px solid ${selected ? '#2D7A5F' : '#e8e8e8'}`,
      background: selected ? '#f0f9f5' : '#fff',
      boxShadow: selected ? '0 0 0 2px #2D7A5F30' : '0 1px 4px rgba(0,0,0,.05)',
      position: 'relative',
    }}>
      {selected && (
        <div style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: '50%', background: '#2D7A5F', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
      )}
      <TechAvatar tech={tech} size={64} />
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginTop: 10, lineHeight: 1.3 }}>{tech.name}</div>
      {tech.title && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{tech.title}</div>}
    </button>
  );
}

// ── Step 3: Date + Time ────────────────────────────────
function Step3DateTime({ service, tech, techs, date, slot, appts, onDateChange, onSlotSelect, onBack }) {
  const dur = service?.duration || 60;
  const allSlots = getSlots(dur);

  function isAvailable(slotMins) {
    if (!appts) return false;
    return tech === null
      ? techs.some(t => isTechFreeAt(t, slotMins, dur, appts))
      : isTechFreeAt(tech, slotMins, dur, appts);
  }

  const hasAny = appts && allSlots.some(s => isAvailable(s));

  return (
    <div>
      <StepTitle>Pick a date &amp; time</StepTitle>
      <BookingCalendar value={date} onChange={onDateChange} />

      {date && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#555', marginBottom: 12 }}>{fmtDate(date)}</div>
          {appts === null ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>
          ) : hasAny ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {allSlots.map(m => {
                const avail = isAvailable(m);
                const isSel = slot === m;
                return (
                  <button key={m} onClick={() => avail && onSlotSelect(m)} disabled={!avail}
                    style={{
                      padding: '12px 4px', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                      border: `1.5px solid ${isSel ? '#2D7A5F' : avail ? '#c3e6d8' : '#ececec'}`,
                      background: isSel ? '#2D7A5F' : avail ? '#f0f9f5' : '#fafafa',
                      color: isSel ? '#fff' : avail ? '#1a6040' : '#ccc',
                      cursor: avail ? 'pointer' : 'default',
                    }}>
                    {minsToStr(m)}
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px 16px', background: '#fff', borderRadius: 14, border: '1px solid #e8e8e8' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>😔</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#555' }}>No availability on this date</div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>Try a different day</div>
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 20 }}><BackBtn onClick={onBack} /></div>
    </div>
  );
}

// ── Step 4: Info ───────────────────────────────────────
function Step4Info({ form, gUser, client, emailLinkState, onSendEmailLink, onChange, onNext, onBack }) {
  const valid = form.name.trim() && form.phone.trim();
  const isReturning = gUser && client && client.name && client.phone;
  const [editing, setEditing] = useState(!isReturning);
  const hasEmail = form.email.trim().includes('@');

  return (
    <div>
      <StepTitle>Your information</StepTitle>

      {isReturning && !editing ? (
        <div style={{ background: '#fff', border: '1.5px solid #c3e6d8', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ padding: '14px 16px', background: '#f0f9f5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a6040' }}>Using your saved info</div>
            <button onClick={() => setEditing(true)} style={{ fontSize: 12, color: '#3D95CE', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Edit</button>
          </div>
          {[
            { icon: '👤', value: form.name  || client.name  },
            { icon: '📞', value: form.phone || client.phone },
            { icon: '✉️', value: form.email || gUser.email  },
          ].map(({ icon, value }) => value ? (
            <div key={icon} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderTop: '1px solid #f0f0f0' }}>
              <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{icon}</span>
              <span style={{ fontSize: 13, color: '#333' }}>{value}</span>
            </div>
          ) : null)}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
          {[
            { key: 'name',  label: 'Name',  type: 'text',  placeholder: 'Your full name',           required: true  },
            { key: 'phone', label: 'Phone', type: 'tel',   placeholder: '(555) 000-0000',           required: true  },
            { key: 'email', label: 'Email', type: 'email', placeholder: 'For confirmation & sign-in', required: false },
            { key: 'notes', label: 'Notes', type: 'text',  placeholder: 'Any requests or preferences?', required: false },
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
      )}

      {/* Sign-in options — only shown when not already signed in */}
      {!gUser && (
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ padding: '10px 16px', background: '#fafafa', fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: '.06em', textTransform: 'uppercase' }}>
            Returning customer? Sign in to auto-fill
          </div>

          {/* Email magic link */}
          <div style={{ padding: '14px 16px', borderTop: '1px solid #f0f0f0' }}>
            {emailLinkState === 'sent' ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 22, marginTop: 2 }}>📬</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 3 }}>Check your email!</div>
                  <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5 }}>
                    We sent a sign-in link to <strong>{form.email}</strong>. Click it to sign in — you can come back and finish booking.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>Sign in with email link</div>
                  <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
                    {hasEmail ? `Send a link to ${form.email}` : 'Enter your email above first'}
                  </div>
                  {emailLinkState === 'error' && (
                    <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>Couldn't send link. Try again or use Google below.</div>
                  )}
                </div>
                <button
                  onClick={() => hasEmail && onSendEmailLink(form.email)}
                  disabled={!hasEmail || emailLinkState === 'sending'}
                  style={{ flexShrink: 0, padding: '9px 16px', borderRadius: 10, border: 'none', background: hasEmail && emailLinkState !== 'sending' ? '#2D7A5F' : '#d0d0d0', color: '#fff', fontSize: 13, fontWeight: 700, cursor: hasEmail && emailLinkState !== 'sending' ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  {emailLinkState === 'sending' ? 'Sending…' : 'Send link ✉️'}
                </button>
              </div>
            )}
          </div>

          {/* Google sign-in */}
          <div style={{ padding: '14px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>Sign in with Google</div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>Quick sign-in with your Google account</div>
            </div>
            <GoogleSignInBtn />
          </div>
        </div>
      )}

      <button onClick={onNext} disabled={!valid}
        style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', background: valid ? '#2D7A5F' : '#d0d0d0', color: '#fff', fontSize: 16, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'inherit', marginBottom: 10 }}>
        Review Booking →
      </button>
      <BackBtn onClick={onBack} />
    </div>
  );
}

// ── Step 5: Confirm ────────────────────────────────────
function Step5Confirm({ service, tech, techs, date, slot, appts, form, submitting, onConfirm, onBack }) {
  const dur = service?.duration || 60;
  const assignedTech = tech !== null ? tech : (appts ? firstFreeTech(techs, slot, dur, appts) : null);
  const total = service?.basePrice;
  return (
    <div>
      <StepTitle>Confirm booking</StepTitle>

      {/* Appointment card */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 16, overflow: 'hidden', marginBottom: 16, boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
        {/* Service banner */}
        <div style={{ background: `linear-gradient(135deg,${CATEGORY_COLORS[service?.category] || '#2D7A5F'},#3D95CE)`, padding: '16px 20px' }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.75)', marginBottom: 2 }}>Service</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{service?.name}</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,.85)', background: 'rgba(255,255,255,.15)', borderRadius: 8, padding: '2px 10px' }}>
              {formatPrice(service?.basePrice, service?.priceFrom)}
            </span>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,.85)', background: 'rgba(255,255,255,.15)', borderRadius: 8, padding: '2px 10px' }}>
              ⏱ {formatDuration(service?.duration, service?.durationMin)}
            </span>
          </div>
        </div>
        {/* Details */}
        {[
          { icon: '👩‍💼', label: 'Stylist',  value: assignedTech?.name || 'Any available' },
          { icon: '📅',  label: 'Date',    value: fmtDate(date) },
          { icon: '🕐',  label: 'Time',    value: minsToStr(slot) },
          { icon: '👤',  label: 'Name',    value: form.name },
          { icon: '📞',  label: 'Phone',   value: form.phone },
          form.email && { icon: '✉️', label: 'Email', value: form.email },
          form.notes && { icon: '📝', label: 'Notes', value: form.notes },
        ].filter(Boolean).map(({ icon, label, value }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid #f0f0f0', gap: 12 }}>
            <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
            <span style={{ fontSize: 12, color: '#aaa', width: 56, flexShrink: 0 }}>{label}</span>
            <span style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>{value}</span>
          </div>
        ))}
      </div>

      <button onClick={onConfirm} disabled={submitting}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: submitting ? '#aaa' : '#2D7A5F', color: '#fff', fontSize: 16, fontWeight: 800, cursor: submitting ? 'default' : 'pointer', fontFamily: 'inherit', marginBottom: 10, letterSpacing: '.01em' }}>
        {submitting ? 'Booking…' : '✓ Confirm Appointment'}
      </button>
      <BackBtn onClick={onBack} />
      <div style={{ fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
        By booking, you agree to our cancellation policy. A deposit may be required for new clients.
      </div>
    </div>
  );
}

// ── Success ────────────────────────────────────────────
function SuccessScreen({ appt, service }) {
  return (
    <div style={{ minHeight: '100dvh', background: '#f5f6f8', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'linear-gradient(135deg,#1e6b50,#2D7A5F 40%,#3D7FBF)', padding: '20px 20px 40px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Meraki Nail Studio</div>
        </div>
      </div>
      <div style={{ maxWidth: 480, margin: '-24px auto 0', padding: '0 16px 48px', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ background: '#fff', borderRadius: 20, padding: '32px 24px', boxShadow: '0 8px 32px rgba(0,0,0,.1)', textAlign: 'center', marginBottom: 16 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#f0f9f5', border: '3px solid #2D7A5F', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 30, color: '#2D7A5F' }}>
            ✓
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#1a1a1a', marginBottom: 6 }}>You're booked!</div>
          <div style={{ fontSize: 14, color: '#888', lineHeight: 1.7 }}>
            See you on <strong style={{ color: '#333' }}>{fmtDate(appt.date)}</strong><br />
            at <strong style={{ color: '#333' }}>{minsToStr(strToMins(appt.startTime))}</strong>
            {appt.clientEmail && (
              <><br /><span style={{ fontSize: 12, color: '#bbb' }}>Confirmation sent to {appt.clientEmail}</span></>
            )}
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,.06)', marginBottom: 16 }}>
          {[
            { icon: '💅', text: service?.name },
            appt.techName !== 'TBD' && { icon: '👩‍💼', text: appt.techName },
            { icon: '📍', text: 'Meraki Nail Studio, Columbus OH' },
            { icon: '📞', text: 'Questions? Give us a call!' },
          ].filter(Boolean).map(({ icon, text }) => (
            <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
              <span style={{ fontSize: 18, width: 26, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
              <span style={{ fontSize: 13, color: '#555' }}>{text}</span>
            </div>
          ))}
        </div>

        <a href="/" style={{ display: 'block', textAlign: 'center', fontSize: 15, fontWeight: 700, color: '#fff', textDecoration: 'none', background: '#3D95CE', borderRadius: 14, padding: '15px', boxShadow: '0 2px 8px rgba(61,149,206,.35)' }}>
          ← Back to Meraki Salon Manager
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
                height: 40, borderRadius: 10,
                border: `1.5px solid ${isSel ? '#2D7A5F' : isToday ? '#c3e6d8' : 'transparent'}`,
                background: isSel ? '#2D7A5F' : isToday ? '#f0f9f5' : 'transparent',
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
          style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: working || !email.trim() ? '#d0d0d0' : '#2D7A5F', color: '#fff', fontSize: 15, fontWeight: 700, cursor: working || !email.trim() ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {working ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}

// ── Shared UI ──────────────────────────────────────────
function TechAvatar({ tech, size = 56 }) {
  const [err, setErr] = useState(false);
  if (tech.photo && !err) {
    return <img src={tech.photo} alt={tech.name} onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid #e8e8e8' }} />;
  }
  const ini = (tech.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: size * 0.28, fontWeight: 700, flexShrink: 0 }}>
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
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#3D95CE', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, padding: '6px 0' }}>
      ← Back
    </button>
  );
}
function FullCenter({ children }) {
  return <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8' }}>{children}</div>;
}
function Spinner() {
  return <div style={{ width: 32, height: 32, border: '3px solid #e0e0e0', borderTop: '3px solid #2D7A5F', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />;
}
