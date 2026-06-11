import { useState, useEffect, useRef } from 'react';
import { fetchServices, fetchEmployees, addToWaitlist, subscribeQueue, fetchWebfrontConfig, kioskWalkinOptions, kioskRegisterClient } from '../lib/firestore';
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

// Phone helpers: we keep `phone` state as raw digits (<=10), format for display.
function digitsOnly(s) { return String(s || '').replace(/\D/g, '').slice(0, 10); }
function fmtPhoneInput(d) {
  d = digitsOnly(d);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
function fmtPhoneStored(d) { d = digitsOnly(d); return d.length === 10 ? `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d; }
function waitLabel(min) {
  if (min == null) return '';
  if (min <= 5) return 'now';
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `~${h}h ${m}m` : `~${h}h`;
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

  // Walk-in flow
  const [phone,     setPhone]     = useState('');     // raw digits, <=10
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [identity,  setIdentity]  = useState(null);   // { clientId, firstName, todayAppt }
  const [svcSel,    setSvcSel]    = useState(null);   // { id, name }
  const [techSel,   setTechSel]   = useState('Any');  // 'Any' | tech name
  const [avail,     setAvail]     = useState(null);   // CF result { options, noPrefEarliest, anyAvailable, salonClosed }
  const [working,   setWorking]   = useState(false);
  const [position,  setPosition]  = useState(null);

  // Appointment-arrival path (phone-first via the same CF, so it actually
  // finds appointments — the old direct client/appt reads are blocked for anon).
  const [arrPhone,   setArrPhone]   = useState('');
  const [arrMatched, setArrMatched] = useState(null); // { firstName, appt }

  const phoneRef = useRef(null);
  const nameRef  = useRef(null);
  const arrRef   = useRef(null);

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
    if (step === 'phone')    setTimeout(() => phoneRef.current?.focus(), 120);
    if (step === 'new-name') setTimeout(() => nameRef.current?.focus(), 120);
    if (step === 'arrival')  setTimeout(() => arrRef.current?.focus(), 120);
  }, [step]);

  function reset() {
    setStep('welcome');
    setPhone(''); setFirstName(''); setLastName(''); setIdentity(null);
    setSvcSel(null); setTechSel('Any'); setAvail(null); setWorking(false); setPosition(null);
    setArrPhone(''); setArrMatched(null);
  }

  const phoneOk = phone.length === 10;

  // Phone-first lookup. The guarded CF returns only { matched, clientId,
  // firstName, banned?, todayAppt? } — no PII crosses to this anon device.
  async function lookupPhone() {
    if (!phoneOk || working) return;
    setWorking(true);
    setStep('lookup');
    try {
      const res = await kioskRegisterClient({ phone });
      if (!res || res.error || res.banned) return setStep('frontdesk');
      if (res.matched) {
        setIdentity({ clientId: res.clientId, firstName: res.firstName, todayAppt: res.todayAppt || null });
        setStep('greet');
      } else {
        setStep('new-prompt');
      }
    } finally { setWorking(false); }
  }

  async function createClient() {
    if (!firstName.trim() || !lastName.trim() || working) return;
    setWorking(true);
    const res = await kioskRegisterClient({ phone, firstName: firstName.trim(), lastName: lastName.trim() });
    setWorking(false);
    if (!res || res.error || res.banned) return setStep('frontdesk');
    setIdentity({ clientId: res.clientId, firstName: res.firstName || firstName.trim(), todayAppt: res.todayAppt || null });
    setStep('service');
  }

  // Selecting a tech (or "No preference") fetches availability server-side.
  async function chooseTech(t) {
    if (working) return;
    setWorking(true);
    setTechSel(t);
    setAvail(null);
    setStep('availability');
    try {
      const res = await kioskWalkinOptions({ serviceId: svcSel.id, requestedTechName: t === 'Any' ? '' : t });
      if (!res || res.error) return setStep('frontdesk');
      setAvail(res);
    } finally { setWorking(false); }
  }

  async function joinQueue({ techName, requestedTechName, waitMin }) {
    if (working) return;
    setWorking(true);
    try {
      await addToWaitlist({
        clientId:    identity?.clientId || '',
        clientName:  identity?.firstName || 'Guest',
        clientPhone: fmtPhoneStored(phone),
        serviceName: svcSel?.name || '',
        serviceId:   svcSel?.id || '',
        techName:    techName || 'Any',
        requestedTechName: requestedTechName || '',
        estimatedWaitMin:  Number.isFinite(waitMin) ? waitMin : null,
        isWalkIn:       true,
        hasAppointment: !!identity?.todayAppt,
      });
      setPosition(queueCount + 1);
      setStep('done-walkin');
    } catch { setStep('frontdesk'); } finally { setWorking(false); }
  }

  async function submitArrival() {
    if (arrPhone.length !== 10 || working) return;
    setWorking(true);
    try {
      const res = await kioskRegisterClient({ phone: arrPhone });
      if (!res || res.error || res.banned) return setStep('frontdesk');
      const appt = res.todayAppt || null;
      // Await the queue write — only claim "checked in" once the front desk
      // actually has the arrival. A failed write routes to the front-desk screen.
      await addToWaitlist({
        clientId:    res.clientId || '',
        clientName:  res.firstName || 'Guest',
        clientPhone: fmtPhoneStored(arrPhone),
        apptId:      appt?.apptId || '',
        serviceName: appt?.serviceName || '',
        techName:    appt?.techName || 'Any',
        isWalkIn:       false,
        hasAppointment: !!appt,
      });
      setArrMatched({ firstName: res.firstName || '', appt });
      setStep('done-arrival');
    } catch { setStep('frontdesk'); } finally { setWorking(false); }
  }

  // Renders the availability step per the wait-time rules. Lives inside the
  // component so it can read avail/techSel/svcSel and call joinQueue.
  function renderAvailability() {
    if (!avail) return <LoadingHero tint={theme.accent} label="Checking availability…" />;
    if (avail.salonClosed) {
      return (
        <>
          <SuccessHero tint={theme.accent} title="We're closed right now" tagline="Please check our hours and come back during open times." />
          <DoneFooter onReset={reset} />
        </>
      );
    }

    // No preference → show the soonest clocked-in tech who can do the service.
    if (techSel === 'Any') {
      const e = avail.noPrefEarliest;
      if (!e) return noTechAvailable();
      return (
        <>
          <SectionHeader title="Here's the soonest opening" subtitle={svcSel?.name ? `for your ${svcSel.name}` : ''} />
          <AvailCard tint={theme.primary} techName={e.techName} wait={e.waitMinutes} note="next available" />
          <ButtonRow style={{ marginTop: 18 }}>
            <SecondaryButton onClick={() => setStep('tech')}><IconArrowLeft size={16} /> Back</SecondaryButton>
            <PrimaryButton onClick={() => joinQueue({ techName: 'Any', requestedTechName: '', waitMin: e.waitMinutes })} disabled={working} tint={theme.primary}>
              {working ? 'Joining…' : 'Join the queue'}
            </PrimaryButton>
          </ButtonRow>
        </>
      );
    }

    // Specific tech requested.
    const r = avail.options.find(o => o.techName === techSel);
    if (!r) {
      // Requested tech not available today at all.
      const alt = avail.options[0];
      return (
        <>
          <SectionHeader title={`${techSel} isn't available today`} subtitle={alt ? 'Someone else can help you sooner.' : ''} />
          {alt && <AvailCard tint={theme.primary} techName={alt.techName} wait={alt.waitMinutes} note="available instead" />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            {alt && <PrimaryButton onClick={() => joinQueue({ techName: alt.techName, requestedTechName: alt.techName, waitMin: alt.waitMinutes })} disabled={working} tint={theme.primary}>Choose {alt.techName}</PrimaryButton>}
            <SecondaryButton onClick={() => joinQueue({ techName: techSel, requestedTechName: techSel, waitMin: null })}>Wait for {techSel} anyway</SecondaryButton>
            <SecondaryButton onClick={() => setStep('tech')}>Pick someone else</SecondaryButton>
          </div>
        </>
      );
    }
    if (r.waitMinutes <= 60) {
      return (
        <>
          <SectionHeader title={`${techSel} can see you soon`} />
          <AvailCard tint={theme.accent} techName={techSel} wait={r.waitMinutes} note="your requested tech" />
          <ButtonRow style={{ marginTop: 18 }}>
            <SecondaryButton onClick={() => setStep('tech')}><IconArrowLeft size={16} /> Back</SecondaryButton>
            <PrimaryButton onClick={() => joinQueue({ techName: techSel, requestedTechName: techSel, waitMin: r.waitMinutes })} disabled={working} tint={theme.accent}>
              {working ? 'Joining…' : 'Join the queue'}
            </PrimaryButton>
          </ButtonRow>
        </>
      );
    }
    // Requested tech > 1 hr → suggest an immediately-available alternative.
    const immediate = avail.options.find(o => o.techName !== techSel && o.waitMinutes <= 10);
    const sooner    = avail.options.find(o => o.techName !== techSel);
    const suggest   = immediate || sooner;
    return (
      <>
        <SectionHeader title={`${techSel} has a bit of a wait`} subtitle={`About ${waitLabel(r.waitMinutes)}.`} />
        {suggest && <AvailCard tint={theme.primary} techName={suggest.techName} wait={suggest.waitMinutes} note={immediate ? 'available now' : 'available sooner'} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          {suggest && <PrimaryButton onClick={() => joinQueue({ techName: suggest.techName, requestedTechName: suggest.techName, waitMin: suggest.waitMinutes })} disabled={working} tint={theme.primary}>Switch to {suggest.techName} ({waitLabel(suggest.waitMinutes)})</PrimaryButton>}
          <SecondaryButton onClick={() => joinQueue({ techName: techSel, requestedTechName: techSel, waitMin: r.waitMinutes })}>Keep {techSel} ({waitLabel(r.waitMinutes)})</SecondaryButton>
          <SecondaryButton onClick={() => setStep('tech')}>Back</SecondaryButton>
        </div>
      </>
    );
  }

  function noTechAvailable() {
    return (
      <>
        <SectionHeader title="No tech is open right now" subtitle={`for ${svcSel?.name || 'this service'}`} />
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,.6)', marginBottom: 16, lineHeight: 1.5 }}>
          You can still join the queue and we'll fit you in as soon as someone's free.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PrimaryButton onClick={() => joinQueue({ techName: 'Any', requestedTechName: techSel === 'Any' ? '' : techSel, waitMin: null })} disabled={working} tint={theme.primary}>
            {working ? 'Joining…' : 'Join the queue anyway'}
          </PrimaryButton>
          <SecondaryButton onClick={() => setStep('service')}>Pick a different service</SecondaryButton>
        </div>
      </>
    );
  }

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
          <KioskChoice Icon={IconChair} title="Walk in" desc="Add me to the queue" tint={theme.primary} onClick={() => setStep('phone')} />
          <KioskChoice Icon={IconCalendar} title="I have an appointment" desc="Let us know you've arrived" tint={theme.accent} onClick={() => setStep('arrival')} />
        </div>
      </Shell>
    );
  }

  // ── Walk-in: phone ───────────────────────────────────────
  if (step === 'phone') {
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SectionHeader title="What's your phone number?" subtitle="We'll check if you've been here before." />
        <KInput refEl={phoneRef} value={fmtPhoneInput(phone)} onChange={v => setPhone(digitsOnly(v))}
          onKeyDown={e => e.key === 'Enter' && phoneOk && lookupPhone()}
          placeholder="(555) 555-5555" inputMode="tel" big />
        <ButtonRow style={{ marginTop: 18 }}>
          <SecondaryButton onClick={reset}><IconArrowLeft size={16} /> Back</SecondaryButton>
          <PrimaryButton onClick={lookupPhone} disabled={!phoneOk} tint={theme.primary}>Continue</PrimaryButton>
        </ButtonRow>
      </Shell>
    );
  }

  // ── Walk-in: lookup (transient) ──────────────────────────
  if (step === 'lookup') {
    return <Shell theme={theme} narrow brand={brand}><LoadingHero tint={theme.primary} label="Looking you up…" /></Shell>;
  }

  // ── Walk-in: greet returning client ──────────────────────
  if (step === 'greet') {
    const appt = identity?.todayAppt;
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SuccessHero
          tint={theme.primary}
          title={identity?.firstName ? `Welcome back, ${identity.firstName}!` : 'Welcome back!'}
          big={appt ? `We see your ${formatTimeStr(appt.startTime)} appointment` : null}
          detail={appt ? `${appt.techName ? `with ${appt.techName}` : ''}${appt.serviceName ? ` · ${appt.serviceName}` : ''}`.trim() : null}
          tagline="Let's get you into the walk-in queue."
        />
        <ButtonRow style={{ marginTop: 8 }}>
          <SecondaryButton onClick={reset}><IconArrowLeft size={16} /> Start over</SecondaryButton>
          <PrimaryButton onClick={() => setStep('service')} tint={theme.primary}>Continue</PrimaryButton>
        </ButtonRow>
      </Shell>
    );
  }

  // ── Walk-in: new client prompt ───────────────────────────
  if (step === 'new-prompt') {
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SectionHeader title="We don't see that number" subtitle={`Are you new to ${brand?.name || 'the salon'}?`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <PrimaryButton onClick={() => setStep('new-name')} tint={theme.primary}>Yes, I'm new — sign me up</PrimaryButton>
          <SecondaryButton onClick={() => { setPhone(''); setStep('phone'); }}>Re-enter my number</SecondaryButton>
          <SecondaryButton onClick={() => setStep('frontdesk')}>Ask the front desk</SecondaryButton>
        </div>
      </Shell>
    );
  }

  // ── Walk-in: new client name ─────────────────────────────
  if (step === 'new-name') {
    const canSubmit = firstName.trim() && lastName.trim() && !working;
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SectionHeader title="Welcome! What's your name?" subtitle="We'll set up your profile." />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <KInput refEl={nameRef} value={firstName} onChange={setFirstName} placeholder="First name *" big />
          <KInput value={lastName} onChange={setLastName} placeholder="Last name *" big
            onKeyDown={e => e.key === 'Enter' && canSubmit && createClient()} />
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)' }}>📱 {fmtPhoneInput(phone)}</div>
        </div>
        <ButtonRow style={{ marginTop: 18 }}>
          <SecondaryButton onClick={() => setStep('new-prompt')}><IconArrowLeft size={16} /> Back</SecondaryButton>
          <PrimaryButton onClick={createClient} disabled={!canSubmit} tint={theme.primary}>{working ? 'Setting up…' : 'Continue'}</PrimaryButton>
        </ButtonRow>
      </Shell>
    );
  }

  // ── Walk-in: service ─────────────────────────────────────
  if (step === 'service') {
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SectionHeader title="What can we do for you?" subtitle="Pick a service." />
        <PillRow>
          {services.map(s => (
            <Pill key={s.id} active={svcSel?.id === s.id} tint={theme.primary} onClick={() => setSvcSel({ id: s.id, name: s.name })}>{s.name}</Pill>
          ))}
        </PillRow>
        <ButtonRow style={{ marginTop: 18 }}>
          <SecondaryButton onClick={reset}><IconArrowLeft size={16} /> Start over</SecondaryButton>
          <PrimaryButton onClick={() => setStep('tech')} disabled={!svcSel} tint={theme.primary}>Continue</PrimaryButton>
        </ButtonRow>
      </Shell>
    );
  }

  // ── Walk-in: tech preference ─────────────────────────────
  if (step === 'tech') {
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SectionHeader title="Any tech preference?" subtitle={svcSel?.name ? `For your ${svcSel.name}` : ''} />
        <PillRow>
          <Pill active={false} tint={theme.accent} onClick={() => chooseTech('Any')}>No preference</Pill>
          {techs.map(t => (
            <Pill key={t.id} active={false} tint={theme.accent} onClick={() => chooseTech(t.name)}>{t.name}</Pill>
          ))}
        </PillRow>
        <ButtonRow style={{ marginTop: 18 }}>
          <SecondaryButton onClick={() => setStep('service')}><IconArrowLeft size={16} /> Back</SecondaryButton>
        </ButtonRow>
      </Shell>
    );
  }

  // ── Walk-in: availability ────────────────────────────────
  if (step === 'availability') {
    return <Shell theme={theme} narrow brand={brand}>{renderAvailability()}</Shell>;
  }

  // ── Front desk fallback (banned / error / opt-out) ───────
  if (step === 'frontdesk') {
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SuccessHero tint={theme.accent} title="Please see the front desk" tagline="A team member will get you checked in. Thank you!" />
        <DoneFooter onReset={reset} />
      </Shell>
    );
  }

  // ── Appointment arrival (phone-first) ────────────────────
  if (step === 'arrival') {
    const canSubmit = arrPhone.length === 10 && !working;
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SectionHeader title="Let us know you're here" subtitle="Enter the phone number on your appointment." />
        <KInput refEl={arrRef} value={fmtPhoneInput(arrPhone)} onChange={v => setArrPhone(digitsOnly(v))}
          onKeyDown={e => e.key === 'Enter' && canSubmit && submitArrival()}
          placeholder="(555) 555-5555" inputMode="tel" big />
        <ButtonRow style={{ marginTop: 18 }}>
          <SecondaryButton onClick={reset}><IconArrowLeft size={16} /> Back</SecondaryButton>
          <PrimaryButton onClick={submitArrival} disabled={!canSubmit} tint={theme.accent}>{working ? 'Checking in…' : 'Check In'}</PrimaryButton>
        </ButtonRow>
      </Shell>
    );
  }

  // ── Done: walk-in ────────────────────────────────────────
  if (step === 'done-walkin') {
    return (
      <Shell theme={theme} narrow brand={brand}>
        <SuccessHero
          tint={theme.primary}
          big={position > 1 ? `You're #${position} in line` : "You're next!"}
          title="You're in the queue!"
          detail={`${techSel !== 'Any' ? `Requesting ${techSel}` : 'Any available tech'}${svcSel?.name ? ` · ${svcSel.name}` : ''}`}
          tagline="Have a seat — we'll call your name shortly!"
        />
        <DoneFooter onReset={reset} />
      </Shell>
    );
  }

  // ── Done: arrival ────────────────────────────────────────
  if (step === 'done-arrival') {
    const firstName = arrMatched?.firstName || '';
    const appt = arrMatched?.appt;
    const apptDetail = appt
      ? `${appt.startTime ? formatTimeStr(appt.startTime) : ''}${appt.techName && appt.techName !== 'TBD' ? ` with ${appt.techName}` : ''}${appt.serviceName ? ` · ${appt.serviceName}` : ''}`.trim()
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

function LoadingHero({ tint, label }) {
  return (
    <div style={{ textAlign: 'center', padding: '56px 8px' }}>
      <div style={{ width: 64, height: 64, margin: '0 auto 22px', borderRadius: '50%', border: `3px solid ${tint}44`, borderTopColor: tint, animation: 'pnspin .8s linear infinite' }} />
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,.7)' }}>{label}</div>
      <style>{`@keyframes pnspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function AvailCard({ tint, techName, wait, note }) {
  const initials = String(techName || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${tint}55`, borderRadius: 18, padding: '22px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: `linear-gradient(135deg,${tint},${tint}cc)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{techName}</div>
        {note && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 2 }}>{note}</div>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: tint }}>{waitLabel(wait)}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)' }}>{wait != null && wait > 5 ? 'est. wait' : 'available'}</div>
      </div>
    </div>
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
