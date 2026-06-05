import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchEmployees, subscribeAttendance } from '../../lib/firestore';
import { TENANT_ID } from '../../lib/tenant';
import { EmpAvatar } from '../employees/EmployeesAdmin';

// Public iPad kiosk for tech clock-in/out + breaks. Auth = 4-digit PIN per
// tech (server-verified by clockEvent callable with via='kiosk'). No Firebase
// sign-in required — the tablet stays anonymous, which is exactly the
// always-on front-desk pattern we already use for TipFlow / Walk-in.
//
// State machine lives entirely on the backend; this UI just subscribes to
// today's attendance doc, derives each tech's current state from the last
// event, and shows the valid actions for that state.

function todayStr(date = new Date()) {
  // Salon's local "today" — for V1 we accept server-local. The backend
  // re-derives the date key in the tenant's tz before writing, so this is
  // only used to choose which doc to *subscribe* to. Worst case at midnight
  // we briefly subscribe to yesterday or tomorrow and re-render once the
  // backend writes the canonical entry.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fmtClock(d) {
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDateLong(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// Derive the tech's current state from the last event in their day. Mirrors
// computeCurrentState in functions/lib/timeclock.js — duplicated here so the
// kiosk doesn't need to round-trip the server just to render the grid.
function computeState(events) {
  if (!Array.isArray(events) || events.length === 0) return 'out';
  const last = events[events.length - 1];
  switch (last && last.kind) {
    case 'in':          return 'in';
    case 'break_start': return 'on_break';
    case 'break_end':   return 'in';
    default:            return 'out';
  }
}

// Pretty break / shift elapsed for the tile chip ("for 47m" / "since 9:01 AM").
function chipForState(state, events) {
  if (state === 'out' || !events || !events.length) return null;
  const last = events[events.length - 1];
  const sinceMs = Date.now() - new Date(last.at).getTime();
  const mins = Math.max(0, Math.floor(sinceMs / 60000));
  if (state === 'on_break') {
    const color = mins >= 60 ? '#b91c1c' : mins >= 30 ? '#b45309' : '#7c5400';
    return { label: `☕ Break ${mins}m`, bg: mins >= 60 ? '#fee2e2' : '#fff7ed', fg: color };
  }
  if (state === 'in') {
    const since = fmtClock(new Date(last.at));
    return { label: `🟢 In since ${since}`, bg: '#ecfdf5', fg: '#166534' };
  }
  return null;
}

// Valid action labels for a state. Order matters — clock-in is the only
// non-destructive action for OUT; for IN we show the most-common (break)
// before the heavier one (clock out).
function actionsForState(state) {
  switch (state) {
    case 'out':      return [{ kind: 'in',          label: 'Clock In',    color: '#2D7A5F' }];
    case 'in':       return [
      { kind: 'break_start', label: 'Start Break', color: '#d97706' },
      { kind: 'out',         label: 'Clock Out',   color: '#1f2937' },
    ];
    case 'on_break': return [
      { kind: 'break_end',   label: 'End Break',   color: '#2D7A5F' },
      { kind: 'out',         label: 'Clock Out',   color: '#1f2937' },
    ];
    default:         return [];
  }
}

export default function TimeClockKiosk() {
  const [employees,  setEmployees]  = useState([]);
  const [entries,    setEntries]    = useState([]); // attendance/{today}.entries[]
  const [now,        setNow]        = useState(new Date());
  const [picked,     setPicked]     = useState(null);  // employee record
  const [doneInfo,   setDoneInfo]   = useState(null);  // { name, label }
  const dateKey = useMemo(() => todayStr(now), [now]);

  // Initial employee load. Filtered to active so retired techs don't clog
  // the grid.
  useEffect(() => {
    fetchEmployees().then(list => setEmployees(list.filter(e => e.active !== false)))
                    .catch(() => setEmployees([]));
  }, []);

  // Live attendance subscription for today.
  useEffect(() => {
    return subscribeAttendance(dateKey, doc => setEntries(Array.isArray(doc?.entries) ? doc.entries : []));
  }, [dateKey]);

  // Clock tick — drives both header time + the "47m" chip refresh on tiles.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  function entryFor(empId) {
    return entries.find(e => e && e.employeeId === empId);
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(135deg, #1a0e2e 0%, #0e1a2e 100%)',
      color: '#fff',
      padding: 24,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      WebkitFontSmoothing: 'antialiased',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 13, color: '#a99cc9', textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700 }}>
            Time Clock
          </div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtDateLong(now)}</div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#d4c5ff' }}>
          {fmtClock(now)}
        </div>
      </div>

      {/* Grid */}
      {employees.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#7a6a9a' }}>No employees configured.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
          {employees.map(emp => {
            const e     = entryFor(emp.id);
            const events = e?.events || [];
            const state = computeState(events);
            const chip  = chipForState(state, events);
            return (
              <button key={emp.id}
                onClick={() => setPicked(emp)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  padding: '18px 12px 14px',
                  background: state === 'out' ? 'rgba(255,255,255,.05)' : state === 'on_break' ? 'rgba(217,119,6,.18)' : 'rgba(45,122,95,.18)',
                  border: `1px solid ${state === 'out' ? 'rgba(255,255,255,.1)' : state === 'on_break' ? 'rgba(217,119,6,.4)' : 'rgba(45,122,95,.4)'}`,
                  borderRadius: 16,
                  cursor: 'pointer',
                  color: 'inherit',
                  fontFamily: 'inherit',
                  textAlign: 'center',
                  minHeight: 170,
                  transition: 'transform .1s',
                }}
                onMouseDown={ev => ev.currentTarget.style.transform = 'scale(.97)'}
                onMouseUp={ev => ev.currentTarget.style.transform = 'scale(1)'}
                onMouseLeave={ev => ev.currentTarget.style.transform = 'scale(1)'}
              >
                <EmpAvatar emp={emp} size={64} />
                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>{emp.name}</div>
                {chip ? (
                  <div style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: chip.bg, color: chip.fg }}>{chip.label}</div>
                ) : (
                  <div style={{ fontSize: 11, color: '#7a6a9a' }}>Not clocked in</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {picked && (
        <PinAndActionModal
          emp={picked}
          state={computeState((entryFor(picked.id)?.events) || [])}
          onClose={() => setPicked(null)}
          onSuccess={(label) => { setPicked(null); setDoneInfo({ name: picked.name, label }); }}
        />
      )}

      {doneInfo && (
        <DoneOverlay
          name={doneInfo.name}
          label={doneInfo.label}
          onDismiss={() => setDoneInfo(null)}
        />
      )}
    </div>
  );
}

// PIN entry → action sheet → server call. Single modal that swaps its body
// based on internal step state. PIN never leaves the request body — server
// scrypt-hashes; we don't see the hash either.
function PinAndActionModal({ emp, state, onClose, onSuccess }) {
  const [step,    setStep]    = useState('pin'); // 'pin' | 'actions' | 'working'
  const [pin,     setPin]     = useState('');
  const [err,     setErr]     = useState('');
  const actions = actionsForState(state);

  function press(digit) {
    setErr('');
    setPin(p => (p + digit).slice(0, 4));
  }
  function back() {
    setErr('');
    setPin(p => p.slice(0, -1));
  }
  function clear() {
    setErr('');
    setPin('');
  }

  async function callable(payload) {
    const { httpsCallable } = await import('firebase/functions');
    const { functions }     = await import('../../lib/firebase');
    return httpsCallable(functions, 'clockEvent')(payload);
  }

  // Auto-advance to action sheet when 4th digit is entered. Server validates
  // PIN on the first clockEvent call — wrong PIN comes back as permission-
  // denied and we bounce back to the PIN step.
  useEffect(() => {
    if (step === 'pin' && pin.length === 4) {
      // If there's only one valid action (OUT → Clock In), just fire it
      // straight away — skip the action sheet. Saves a tap for the morning
      // arrival flow which is what the kiosk is touched for most.
      if (actions.length === 1) {
        runAction(actions[0]);
      } else {
        setStep('actions');
      }
    }
  }, [pin, step]);

  async function runAction(action) {
    setStep('working');
    setErr('');
    try {
      const res = await callable({
        tenantId:   TENANT_ID,
        employeeId: emp.id,
        kind:       action.kind,
        via:        'kiosk',
        pin,
      });
      if (res?.data?.duplicate) {
        onSuccess(`${action.label} (already recorded)`);
      } else {
        onSuccess(action.label);
      }
    } catch (e) {
      const code = e?.code || '';
      const msg  = e?.message || '';
      if (code === 'functions/permission-denied') {
        setStep('pin');
        setPin('');
        setErr('Wrong PIN');
      } else if (code === 'functions/failed-precondition') {
        setStep('pin');
        setPin('');
        setErr(msg.replace(/^.*?: /, ''));
      } else {
        setStep('pin');
        setPin('');
        setErr(msg || 'Could not record — try again');
      }
    }
  }

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--pn-surface)', color: 'var(--pn-text)', borderRadius: 22, width: '100%', maxWidth: 400, padding: 26, boxShadow: '0 28px 80px rgba(0,0,0,.5)' }}>

        {/* Header — avatar + name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <EmpAvatar emp={emp} size={64} />
          <div style={{ fontSize: 20, fontWeight: 700 }}>{emp.name}</div>
        </div>

        {step === 'pin' && (
          <>
            <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', textAlign: 'center', marginBottom: 12 }}>Enter your 4-digit PIN</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
              {[0, 1, 2, 3].map(i => (
                <div key={i}
                  style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--pn-border-strong)', background: i < pin.length ? '#5b3b8c' : 'transparent' }} />
              ))}
            </div>
            {err && <div style={{ textAlign: 'center', color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{err}</div>}
            <Keypad onPress={press} onBack={back} onClear={clear} />
            <button onClick={onClose}
              style={{ marginTop: 14, width: '100%', padding: '12px 16px', fontSize: 15, fontWeight: 600, borderRadius: 12, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel
            </button>
          </>
        )}

        {step === 'actions' && (
          <>
            <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', textAlign: 'center', marginBottom: 16 }}>What would you like to do?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {actions.map(a => (
                <button key={a.kind} onClick={() => runAction(a)}
                  style={{ padding: '18px', fontSize: 17, fontWeight: 700, borderRadius: 14, border: 'none', background: a.color, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 6px 18px rgba(0,0,0,.15)' }}>
                  {a.label}
                </button>
              ))}
            </div>
            <button onClick={onClose}
              style={{ marginTop: 14, width: '100%', padding: '12px 16px', fontSize: 15, fontWeight: 600, borderRadius: 12, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel
            </button>
          </>
        )}

        {step === 'working' && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--pn-text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
            <div style={{ fontSize: 15 }}>Recording…</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Keypad({ onPress, onBack, onClear }) {
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['C', '0', '⌫'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {rows.flat().map(k => {
        const isAction = k === 'C' || k === '⌫';
        return (
          <button key={k}
            onClick={() => {
              if (k === 'C') onClear();
              else if (k === '⌫') onBack();
              else onPress(k);
            }}
            style={{
              padding: '18px 0', fontSize: 22, fontWeight: 600,
              border: '1px solid var(--pn-border)', borderRadius: 12,
              background: isAction ? 'var(--pn-bg)' : 'var(--pn-surface)',
              color: isAction ? 'var(--pn-text-muted)' : 'var(--pn-text)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {k}
          </button>
        );
      })}
    </div>
  );
}

// Full-screen success confirmation. Auto-dismisses after 4 seconds so the
// kiosk returns to the grid for the next tech without anyone touching it.
function DoneOverlay({ name, label, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div onClick={onDismiss}
      style={{ position: 'fixed', inset: 0, background: 'rgba(45,122,95,.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 250, color: '#fff', textAlign: 'center', cursor: 'pointer' }}>
      <div>
        <div style={{ fontSize: 84, marginBottom: 12 }}>✓</div>
        <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 18, opacity: 0.85 }}>{name}</div>
        <div style={{ marginTop: 24, fontSize: 12, opacity: 0.6, letterSpacing: '.05em' }}>Tap anywhere to dismiss</div>
      </div>
    </div>
  );
}
