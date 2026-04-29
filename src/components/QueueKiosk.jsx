import { useState, useEffect, useRef } from 'react';
import { fetchServices, fetchEmployees, addToWaitlist, fetchTodayQueue } from '../lib/firestore';

const DARK   = '#0e1c14';
const GREEN  = '#2D7A5F';
const BLUE   = '#3D95CE';
const RESET_SECS = 14;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function BigBtn({ onClick, children, accent = GREEN, outline = false }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '22px 0', borderRadius: 18, fontSize: 20, fontWeight: 700,
      fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '-.01em',
      border: outline ? `2px solid ${accent}` : 'none',
      background: outline ? 'transparent' : accent,
      color: outline ? accent : '#fff',
      transition: 'opacity .15s',
    }}
      onMouseEnter={e => e.currentTarget.style.opacity = '.85'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
    >{children}</button>
  );
}

function CountDown({ secs, onDone }) {
  const [left, setLeft] = useState(secs);
  useEffect(() => {
    const t = setInterval(() => setLeft(l => { if (l <= 1) { clearInterval(t); onDone(); return 0; } return l - 1; }), 1000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line
  return <span style={{ fontSize: 12, color: 'rgba(255,255,255,.4)' }}>Returning to start in {left}s</span>;
}

export default function QueueKiosk() {
  const [step,       setStep]       = useState('welcome'); // welcome | walkin | arrival | done-walkin | done-arrival
  const [services,   setServices]   = useState([]);
  const [techs,      setTechs]      = useState([]);
  const [queueCount, setQueueCount] = useState(0);

  // Walk-in form
  const [name,     setName]     = useState('');
  const [phone,    setPhone]    = useState('');
  const [svcSel,   setSvcSel]   = useState('');
  const [techSel,  setTechSel]  = useState('Any');
  const [working,  setWorking]  = useState(false);
  const [position, setPosition] = useState(null);

  // Arrival form
  const [arrName,  setArrName]  = useState('');

  const nameRef = useRef(null);
  const arrRef  = useRef(null);

  useEffect(() => {
    fetchServices().then(s => setServices(s.filter(sv => sv.active !== false))).catch(() => {});
    fetchEmployees().then(e => setTechs(e.filter(emp => emp.active !== false))).catch(() => {});
    fetchTodayQueue().then(q => setQueueCount(q.filter(e => e.status === 'waiting').length)).catch(() => {});
  }, []);

  useEffect(() => {
    if (step === 'walkin')   setTimeout(() => nameRef.current?.focus(), 100);
    if (step === 'arrival')  setTimeout(() => arrRef.current?.focus(), 100);
  }, [step]);

  function reset() {
    setStep('welcome');
    setName(''); setPhone(''); setSvcSel(''); setTechSel('Any');
    setArrName(''); setPosition(null); setWorking(false);
  }

  async function submitWalkIn() {
    if (!name.trim() || !svcSel) return;
    setWorking(true);
    try {
      const q = await fetchTodayQueue();
      const waiting = q.filter(e => e.status === 'waiting');
      await addToWaitlist({
        clientName: name.trim(),
        clientPhone: phone.trim(),
        serviceName: svcSel,
        techName: techSel,
        isWalkIn: true,
        hasAppointment: false,
      });
      setPosition(waiting.length + 1);
      setQueueCount(waiting.length + 1);
      setStep('done-walkin');
    } catch { setWorking(false); }
  }

  async function submitArrival() {
    if (!arrName.trim()) return;
    setWorking(true);
    try {
      await addToWaitlist({
        clientName: arrName.trim(),
        isWalkIn: false,
        hasAppointment: true,
        serviceName: '',
        techName: 'Any',
      });
      setStep('done-arrival');
    } catch { setWorking(false); }
  }

  const shell = (children) => (
    <div style={{
      position: 'fixed', inset: 0, background: DARK, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', fontFamily: "'Helvetica Neue',sans-serif",
      padding: 40, overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{ position: 'absolute', top: 28, left: 0, right: 0, textAlign: 'center' }}>
        <div style={{ fontFamily: "'Great Vibes', cursive", fontSize: 32, color: '#fff', letterSpacing: '-.01em' }}>Meraki</div>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: 'rgba(255,255,255,.4)', letterSpacing: '.18em', marginTop: -4 }}>NAIL STUDIO</div>
      </div>
      <div style={{ width: '100%', maxWidth: 480 }}>
        {children}
      </div>
    </div>
  );

  // ── Welcome ──────────────────────────────────────────
  if (step === 'welcome') return shell(
    <>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ fontSize: 30, fontWeight: 700, color: '#fff', marginBottom: 10 }}>Welcome! 💅</div>
        <div style={{ fontSize: 16, color: 'rgba(255,255,255,.55)' }}>How can we help you today?</div>
        {queueCount > 0 && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'rgba(255,255,255,.35)' }}>
            {queueCount} {queueCount === 1 ? 'person' : 'people'} ahead in queue
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <BigBtn onClick={() => setStep('walkin')} accent={GREEN}>Walk In — Add me to the queue</BigBtn>
        <BigBtn onClick={() => setStep('arrival')} accent={BLUE}>I have an appointment</BigBtn>
      </div>
    </>
  );

  // ── Walk-in form ─────────────────────────────────────
  if (step === 'walkin') {
    const inp = { width: '100%', boxSizing: 'border-box', padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.07)', color: '#fff', fontSize: 16, fontFamily: 'inherit', outline: 'none' };
    const canSubmit = name.trim() && svcSel && !working;
    return shell(
      <>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Walk-in Queue</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,.45)', marginBottom: 28 }}>Tell us a bit about yourself</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input ref={nameRef} value={name} onChange={e => setName(e.target.value)} placeholder="Your name *" style={inp} />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone number (optional)" style={inp} inputMode="tel" />

          {/* Service picker */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Service *</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {services.map(s => (
                <button key={s.id} onClick={() => setSvcSel(s.name)}
                  style={{ padding: '9px 16px', borderRadius: 30, border: `1.5px solid ${svcSel === s.name ? GREEN : 'rgba(255,255,255,.18)'}`, background: svcSel === s.name ? GREEN : 'transparent', color: svcSel === s.name ? '#fff' : 'rgba(255,255,255,.65)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', fontWeight: svcSel === s.name ? 700 : 400 }}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          {/* Tech preference */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Tech preference</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['Any', ...techs.map(t => t.name)].map(t => (
                <button key={t} onClick={() => setTechSel(t)}
                  style={{ padding: '9px 16px', borderRadius: 30, border: `1.5px solid ${techSel === t ? BLUE : 'rgba(255,255,255,.18)'}`, background: techSel === t ? BLUE : 'transparent', color: techSel === t ? '#fff' : 'rgba(255,255,255,.65)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', fontWeight: techSel === t ? 700 : 400 }}>
                  {t === 'Any' ? 'No preference' : t}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <button onClick={reset} style={{ flex: 1, padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: 'rgba(255,255,255,.6)', fontSize: 15, fontFamily: 'inherit', cursor: 'pointer' }}>← Back</button>
            <button onClick={submitWalkIn} disabled={!canSubmit}
              style={{ flex: 2, padding: 16, borderRadius: 12, border: 'none', background: canSubmit ? GREEN : 'rgba(255,255,255,.12)', color: canSubmit ? '#fff' : 'rgba(255,255,255,.3)', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', cursor: canSubmit ? 'pointer' : 'default' }}>
              {working ? 'Adding…' : 'Join Queue'}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Appointment arrival ──────────────────────────────
  if (step === 'arrival') {
    const inp = { width: '100%', boxSizing: 'border-box', padding: '16px 18px', borderRadius: 12, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.07)', color: '#fff', fontSize: 20, fontFamily: 'inherit', outline: 'none' };
    const canSubmit = arrName.trim() && !working;
    return shell(
      <>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Check In</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,.45)', marginBottom: 32 }}>Enter your name to let us know you've arrived</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input ref={arrRef} value={arrName} onChange={e => setArrName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canSubmit && submitArrival()}
            placeholder="Your name" style={inp} />
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={reset} style={{ flex: 1, padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: 'rgba(255,255,255,.6)', fontSize: 15, fontFamily: 'inherit', cursor: 'pointer' }}>← Back</button>
            <button onClick={submitArrival} disabled={!canSubmit}
              style={{ flex: 2, padding: 16, borderRadius: 12, border: 'none', background: canSubmit ? BLUE : 'rgba(255,255,255,.12)', color: canSubmit ? '#fff' : 'rgba(255,255,255,.3)', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', cursor: canSubmit ? 'pointer' : 'default' }}>
              {working ? 'Checking in…' : 'Check In'}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Done: walk-in ────────────────────────────────────
  if (step === 'done-walkin') return shell(
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 8 }}>You're in the queue!</div>
      <div style={{ fontSize: 18, color: 'rgba(255,255,255,.6)', marginBottom: 4 }}>
        {position > 1 ? `You are #${position} in line.` : 'You\'re next!'}
      </div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>
        {techSel !== 'Any' ? `Requesting ${techSel}` : 'Any available tech'}
        {svcSel ? ` · ${svcSel}` : ''}
      </div>
      <div style={{ fontSize: 15, color: GREEN, fontWeight: 600, marginBottom: 40 }}>Have a seat — we'll call your name shortly!</div>
      <BigBtn onClick={reset} outline accent="rgba(255,255,255,.3)">
        Done
      </BigBtn>
      <div style={{ marginTop: 20 }}>
        <CountDown secs={RESET_SECS} onDone={reset} />
      </div>
    </div>
  );

  // ── Done: arrival ────────────────────────────────────
  if (step === 'done-arrival') return shell(
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 8 }}>You're checked in!</div>
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,.5)', marginBottom: 40 }}>
        Have a seat — your tech will be with you shortly.
      </div>
      <BigBtn onClick={reset} outline accent="rgba(255,255,255,.3)">Done</BigBtn>
      <div style={{ marginTop: 20 }}>
        <CountDown secs={RESET_SECS} onDone={reset} />
      </div>
    </div>
  );

  return null;
}
