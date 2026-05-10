import { useState, useEffect, useRef } from 'react';
import { fetchServices, fetchEmployees, addToWaitlist, subscribeQueue, fetchWebfrontConfig, fetchClientByPhone, findTodaysAppointmentForClient } from '../lib/firestore';
import { getTheme, detectAutoTheme } from '../lib/themes';
import { IconChair, IconCalendar, IconCheck, IconArrowLeft, IconClock, IconChevronRight } from './Icons';

const RESET_SECS = 14;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatTimeStr(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh   = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function CountDown({ secs, onDone }) {
  const [left, setLeft] = useState(secs);
  useEffect(() => {
    const t = setInterval(() => setLeft(l => { if (l <= 1) { clearInterval(t); onDone(); return 0; } return l - 1; }), 1000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line
  return <span style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', letterSpacing: '.04em' }}>Returning to start in {left}s</span>;
}

// Module-scope Shell so it keeps a stable component identity between renders;
// otherwise inputs inside lose focus on every keystroke.
function Shell({ children, narrow, theme, brand }) {
  const bgStyle = {
    position: 'fixed', inset: 0, overflowY: 'auto', overflowX: 'hidden',
    background: `radial-gradient(ellipse at top, ${theme.dark}f5 0%, ${theme.dark} 55%, #050a0a 100%)`,
    fontFamily: "'Helvetica Neue','Inter',-apple-system,sans-serif",
    color: '#fff',
  };
  return (
    <div style={bgStyle}>
      <div aria-hidden style={{
        position: 'absolute', top: -160, left: '50%', transform: 'translateX(-50%)',
        width: 720, height: 480, borderRadius: '50%',
        background: `radial-gradient(ellipse, ${theme.primary}26 0%, ${theme.accent}18 35%, transparent 65%)`,
        pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative', textAlign: 'center', paddingTop: 36, paddingBottom: 12, zIndex: 1 }}>
        <div style={{ fontFamily: "'Great Vibes', cursive", fontSize: 38, lineHeight: 1, color: '#fff', letterSpacing: '-.01em' }}>{brand?.name || 'Plume Nexus'}</div>
        {brand?.tagline && (
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: 'rgba(255,255,255,.42)', letterSpacing: '.32em', textTransform: 'uppercase', marginTop: 2 }}>{brand.tagline}</div>
        )}
      </div>
      <div style={{ position: 'relative', zIndex: 1, maxWidth: narrow ? 540 : 720, margin: '0 auto', padding: '20px 28px 56px' }}>
        {children}
      </div>
    </div>
  );
}

export default function QueueKiosk() {
  const [step,       setStep]       = useState('welcome');
  const [services,   setServices]   = useState([]);
  const [techs,      setTechs]      = useState([]);
  const [queueCount, setQueueCount] = useState(0);
  const [theme,      setTheme]      = useState(getTheme('meraki'));
  const [brand,      setBrand]      = useState(null);

  // Walk-in form
  const [name,     setName]     = useState('');
  const [phone,    setPhone]    = useState('');
  const [email,    setEmail]    = useState('');
  const [svcSel,   setSvcSel]   = useState('');
  const [techSel,  setTechSel]  = useState('Any');
  const [working,  setWorking]  = useState(false);
  const [position, setPosition] = useState(null);

  // Arrival form
  const [arrName,    setArrName]    = useState('');
  const [arrPhone,   setArrPhone]   = useState('');
  const [arrMatched, setArrMatched] = useState(null);  // { client, appt } or null

  const nameRef = useRef(null);
  const arrRef  = useRef(null);

  // Load static data + theme
  useEffect(() => {
    fetchServices().then(s => setServices(s.filter(sv => sv.active !== false))).catch(() => {});
    fetchEmployees().then(e => setTechs(e.filter(emp => emp.active !== false))).catch(() => {});
    fetchWebfrontConfig().then(wf => {
      if (!wf) return;
      const t = wf.autoTheme ? (detectAutoTheme() || getTheme(wf.themeId || 'meraki')) : getTheme(wf.themeId || 'meraki');
      setTheme(t);
      setBrand({ name: wf.brandName || wf.salonName || 'Plume Nexus', tagline: wf.brandTagline || '' });
    }).catch(() => {});
  }, []);

  // Live queue count
  useEffect(() => {
    const unsub = subscribeQueue(todayStr(), entries => {
      setQueueCount(entries.filter(e => e.status === 'waiting').length);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (step === 'walkin')   setTimeout(() => nameRef.current?.focus(), 120);
    if (step === 'arrival')  setTimeout(() => arrRef.current?.focus(), 120);
  }, [step]);

  function reset() {
    setStep('welcome');
    setName(''); setPhone(''); setEmail(''); setSvcSel(''); setTechSel('Any');
    setArrName(''); setArrPhone(''); setArrMatched(null); setPosition(null); setWorking(false);
  }

  async function submitWalkIn() {
    if (!name.trim() || !svcSel) return;
    setWorking(true);
    try {
      await addToWaitlist({
        clientName: name.trim(),
        clientPhone: phone.trim(),
        clientEmail: email.trim(),
        serviceName: svcSel,
        techName: techSel,
        isWalkIn: true,
        hasAppointment: false,
      });
      setPosition(queueCount + 1);
      setStep('done-walkin');
    } catch { setWorking(false); }
  }

  async function submitArrival() {
    if (!arrName.trim() || !arrPhone.trim()) return;
    setWorking(true);
    try {
      // Look up the client + their appointment by phone before creating the
      // waitlist entry, so staff see the matched record on the dashboard.
      const [client, appt] = await Promise.all([
        fetchClientByPhone(arrPhone.trim()).catch(() => null),
        findTodaysAppointmentForClient({ phone: arrPhone.trim() }).catch(() => null),
      ]);
      setArrMatched({ client, appt });

      await addToWaitlist({
        clientName:  client?.name || arrName.trim(),
        clientPhone: arrPhone.trim(),
        clientEmail: client?.email || '',
        clientId:    client?.id || '',
        apptId:      appt?.id || '',
        serviceName: appt?.services?.[0]?.name || '',
        techName:    appt?.techName || 'Any',
        isWalkIn:    false,
        hasAppointment: !!appt,
      });
      setStep('done-arrival');
    } catch { setWorking(false); }
  }

  // Shell is rendered via the module-level <Shell> component below — defining it
  // inside this function would create a brand-new component identity on every
  // render, remounting all inputs and stealing focus on every keystroke.

  // ── Welcome ──────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <Shell theme={theme} brand={brand}>
        <div style={{ textAlign: 'center', marginTop: 24, marginBottom: 36 }}>
          <h1 style={{ fontSize: 38, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-.6px' }}>How can we help?</h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,.55)', marginTop: 10 }}>Pick one to get started.</p>
          {queueCount > 0 && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 18, padding: '7px 16px', borderRadius: 30, background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', fontSize: 13, color: 'rgba(255,255,255,.65)' }}>
              <IconClock size={14} />
              {queueCount} {queueCount === 1 ? 'person' : 'people'} ahead in queue
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <KioskChoice
            Icon={IconChair}
            title="Walk in"
            desc="Add me to the queue"
            tint={theme.primary}
            onClick={() => setStep('walkin')}
          />
          <KioskChoice
            Icon={IconCalendar}
            title="I have an appointment"
            desc="Let us know you've arrived"
            tint={theme.accent}
            onClick={() => setStep('arrival')}
          />
        </div>
      </Shell>
    );
  }

  // ── Walk-in form ─────────────────────────────────────────
  if (step === 'walkin') {
    const canSubmit = name.trim() && svcSel && !working;
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SectionHeader title="Join the Walk-in Queue" subtitle="Tell us a bit about yourself." />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <KInput refEl={nameRef} value={name} onChange={setName} placeholder="Your name *" />
          <KInput value={phone} onChange={setPhone} placeholder="Phone number (optional)" inputMode="tel" />
          <KInput value={email} onChange={setEmail} placeholder="Email (optional)" inputMode="email" />

          <Field label="Service *">
            <PillRow>
              {services.map(s => (
                <Pill key={s.id} active={svcSel === s.name} tint={theme.primary} onClick={() => setSvcSel(s.name)}>
                  {s.name}
                </Pill>
              ))}
            </PillRow>
          </Field>

          <Field label="Tech preference">
            <PillRow>
              {['Any', ...techs.map(t => t.name)].map(t => (
                <Pill key={t} active={techSel === t} tint={theme.accent} onClick={() => setTechSel(t)}>
                  {t === 'Any' ? 'No preference' : t}
                </Pill>
              ))}
            </PillRow>
          </Field>

          <ButtonRow>
            <SecondaryButton onClick={reset}><IconArrowLeft size={16} /> Back</SecondaryButton>
            <PrimaryButton onClick={submitWalkIn} disabled={!canSubmit} tint={theme.primary}>
              {working ? 'Adding…' : 'Join Queue'}
            </PrimaryButton>
          </ButtonRow>
        </div>
      </Shell>
    );
  }

  // ── Appointment arrival ─────────────────────────────────
  if (step === 'arrival') {
    const canSubmit = arrName.trim() && arrPhone.trim() && !working;
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SectionHeader title="Let us know you're here" subtitle="A couple quick details so we can find your appointment." />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <KInput refEl={arrRef} value={arrName} onChange={setArrName} placeholder="Your name *" big />
          <KInput value={arrPhone} onChange={setArrPhone}
            onKeyDown={e => e.key === 'Enter' && canSubmit && submitArrival()}
            placeholder="Phone number *" inputMode="tel" big />
        </div>

        <ButtonRow style={{ marginTop: 18 }}>
          <SecondaryButton onClick={reset}><IconArrowLeft size={16} /> Back</SecondaryButton>
          <PrimaryButton onClick={submitArrival} disabled={!canSubmit} tint={theme.accent}>
            {working ? 'Checking in…' : 'Check In'}
          </PrimaryButton>
        </ButtonRow>
      </Shell>
    );
  }

  // ── Done: walk-in ───────────────────────────────────────
  if (step === 'done-walkin') {
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SuccessHero
          tint={theme.primary}
          big={position > 1 ? `You're #${position} in line` : "You're next!"}
          title="You're in the queue!"
          detail={`${techSel !== 'Any' ? `Requesting ${techSel}` : 'Any available tech'}${svcSel ? ` · ${svcSel}` : ''}`}
          tagline="Have a seat — we'll call your name shortly!"
        />
        <DoneFooter onReset={reset} />
      </Shell>
    );
  }

  // ── Done: arrival ───────────────────────────────────────
  if (step === 'done-arrival') {
    const firstName = (arrMatched?.client?.name || arrName).split(' ')[0];
    const appt = arrMatched?.appt;
    const apptDetail = appt
      ? `${appt.startTime ? formatTimeStr(appt.startTime) : ''}${appt.techName && appt.techName !== 'TBD' ? ` with ${appt.techName}` : ''}${appt.services?.[0]?.name ? ` · ${appt.services[0].name}` : ''}`.trim()
      : null;
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SuccessHero
          tint={theme.accent}
          title={firstName ? `Welcome, ${firstName}!` : "You're checked in!"}
          big={appt ? 'We found your appointment' : null}
          detail={apptDetail}
          tagline={appt
            ? "Have a seat — your tech will be with you shortly."
            : "We couldn't find an appointment under that number, but we've let the front desk know you're here."}
        />
        <DoneFooter onReset={reset} />
      </Shell>
    );
  }

  return null;
}

// ── Sub-components ──────────────────────────────────────

function KioskChoice({ Icon, title, desc, tint, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: 'rgba(255,255,255,.04)',
        border: `1px solid ${hover ? tint : 'rgba(255,255,255,.12)'}`,
        borderRadius: 20, padding: '32px 26px', cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', color: '#fff',
        transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease',
        transform: hover ? 'translateY(-3px)' : 'translateY(0)',
        boxShadow: hover ? `0 18px 48px ${tint}26, 0 0 0 1px ${tint}40 inset` : '0 4px 14px rgba(0,0,0,.3)',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 18, minHeight: 200,
      }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: `linear-gradient(135deg,${tint},${tint}cc)`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 8px 22px ${tint}44` }}>
        <Icon size={28} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, letterSpacing: '-.2px' }}>{title}</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', lineHeight: 1.5 }}>{desc}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,.7)', fontSize: 13, fontWeight: 600, transform: hover ? 'translateX(3px)' : 'translateX(0)', transition: 'transform .18s' }}>
        Continue <IconChevronRight size={14} />
      </div>
    </button>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: '#fff', letterSpacing: '-.3px' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 14, color: 'rgba(255,255,255,.5)', marginTop: 6 }}>{subtitle}</div>}
    </div>
  );
}

function KInput({ refEl, value, onChange, placeholder, inputMode, onKeyDown, big }) {
  return (
    <input ref={refEl} value={value} onChange={e => onChange(e.target.value)}
      onKeyDown={onKeyDown} placeholder={placeholder} inputMode={inputMode}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: big ? '20px 22px' : '16px 18px',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,.15)',
        background: 'rgba(255,255,255,.06)',
        color: '#fff', fontSize: big ? 22 : 16, fontFamily: 'inherit',
        outline: 'none',
        transition: 'border-color .15s, background .15s',
      }}
      onFocus={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.32)'; e.currentTarget.style.background = 'rgba(255,255,255,.09)'; }}
      onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; e.currentTarget.style.background = 'rgba(255,255,255,.06)'; }}
    />
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.42)', textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 10 }}>{label}</div>
      {children}
    </div>
  );
}

function PillRow({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>;
}

function Pill({ active, tint, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '10px 18px', borderRadius: 30,
        border: `1.5px solid ${active ? tint : 'rgba(255,255,255,.18)'}`,
        background: active ? tint : 'rgba(255,255,255,.04)',
        color: active ? '#fff' : 'rgba(255,255,255,.7)',
        fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
        fontWeight: active ? 700 : 500,
        transition: 'background .15s, border-color .15s',
      }}>
      {children}
    </button>
  );
}

function ButtonRow({ children, style }) {
  return <div style={{ display: 'flex', gap: 12, marginTop: 6, ...style }}>{children}</div>;
}

function SecondaryButton({ onClick, children }) {
  return (
    <button onClick={onClick}
      style={{ flex: 1, padding: '15px 18px', borderRadius: 14, border: '1px solid rgba(255,255,255,.18)', background: 'transparent', color: 'rgba(255,255,255,.65)', fontSize: 15, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      {children}
    </button>
  );
}

function PrimaryButton({ onClick, disabled, tint, children }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        flex: 2, padding: '15px 22px', borderRadius: 14, border: 'none',
        background: disabled ? 'rgba(255,255,255,.1)' : `linear-gradient(135deg,${tint},${tint}dd)`,
        color: disabled ? 'rgba(255,255,255,.3)' : '#fff',
        fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
        boxShadow: disabled ? 'none' : `0 8px 22px ${tint}44`,
        transition: 'box-shadow .15s',
      }}>
      {children}
    </button>
  );
}

function SuccessHero({ tint, title, big, detail, tagline }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 8px 24px' }}>
      <div style={{ width: 96, height: 96, borderRadius: '50%', background: `linear-gradient(135deg,${tint},${tint}aa)`, margin: '0 auto 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 14px 40px ${tint}55`, color: '#fff' }}>
        <IconCheck size={44} />
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: '#fff', marginBottom: 10, letterSpacing: '-.4px' }}>{title}</div>
      {big && <div style={{ fontSize: 22, fontWeight: 700, color: tint, marginBottom: 8 }}>{big}</div>}
      {detail && <div style={{ fontSize: 14, color: 'rgba(255,255,255,.5)', marginBottom: 14 }}>{detail}</div>}
      {tagline && <div style={{ fontSize: 16, color: 'rgba(255,255,255,.78)', fontWeight: 500, lineHeight: 1.5, maxWidth: 380, margin: '0 auto' }}>{tagline}</div>}
    </div>
  );
}

function DoneFooter({ onReset }) {
  return (
    <div style={{ marginTop: 28, textAlign: 'center' }}>
      <button onClick={onReset}
        style={{ padding: '13px 38px', borderRadius: 14, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.85)', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
        Done
      </button>
      <div style={{ marginTop: 16 }}>
        <CountDown secs={RESET_SECS} onDone={onReset} />
      </div>
    </div>
  );
}
