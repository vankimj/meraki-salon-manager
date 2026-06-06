import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import {
  subscribeTurnRoster, saveTurnRoster,
  subscribeQueue, updateWaitlistEntry, removeWaitlistEntry, addToWaitlist,
  subscribeToAppointments, createAppointment,
  fetchEmployees, fetchServices, fetchClient, fetchClients, createClient,
} from '../../lib/firestore';
import { logActivity } from '../../lib/logger';
import { resolveServicePricing } from '../../utils/serviceHelpers';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtClock(d = new Date()) {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function minutesAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 60000));
}

// Play a short pleasant two-note chime (C5 → E5) when a new walk-in arrives.
// Uses Web Audio API so we don't need to ship an mp3 asset. Browsers gate
// audio behind a user gesture; the first chime after a fresh page load may
// be silent — tapping anything in the UI unlocks it.
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const playNote = (freq, startMs, durMs) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t0 = ctx.currentTime + startMs / 1000;
      const t1 = t0 + durMs / 1000;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t1);
    };
    playNote(523.25, 0,   180); // C5
    playNote(659.25, 110, 240); // E5
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {}
}

function nextUpInRotation(roster) {
  if (!roster || roster.length === 0) return null;
  const sorted = [...roster].sort((a, b) => {
    const ta = a.turnsTaken || 0, tb = b.turnsTaken || 0;
    if (ta !== tb) return ta - tb;
    return (a.clockInAt || '').localeCompare(b.clockInAt || '');
  });
  return sorted[0];
}

// Tech avatar circle — initials with color from tech name hash.
function techColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 50%)`;
}

function initialsOf(name) {
  return (name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

export default function WalkinKiosk() {
  const { isAdmin, isScheduler, showToast, gUser } = useApp();
  const today = todayStr();
  const [roster, setRoster]   = useState([]);
  const [queue, setQueue]     = useState([]);
  const [appts, setAppts]     = useState([]);
  const [employees, setEmployees] = useState([]);
  const [services, setServices]   = useState([]);
  const [clients, setClients]     = useState([]);
  const [showAdd, setShowAdd]   = useState(false);
  const [seatPrompt, setSeatPrompt] = useState(null); // { entry, techName }
  const [now, setNow] = useState(new Date());
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef(null);

  if (!isAdmin && !isScheduler) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--pn-text-muted)' }}>
        Walk-in kiosk requires admin or scheduler role.
      </div>
    );
  }

  // Live subscriptions
  useEffect(() => subscribeTurnRoster(today, data => setRoster((data && data.roster) || [])), []);
  useEffect(() => subscribeQueue(today, setQueue), []);
  useEffect(() => subscribeToAppointments(today, setAppts), []);

  // Audio chime on new walk-in. Tracks queue length and plays a short
  // pleasant tone via Web Audio API when it grows. First mount initializes
  // the ref but doesn't chime so refreshing the page is silent.
  const prevQueueLenRef = useRef(null);
  useEffect(() => {
    const waitingNow = queue.filter(q => q.status !== 'seated' && q.status !== 'cancelled').length;
    if (prevQueueLenRef.current !== null && waitingNow > prevQueueLenRef.current) {
      playChime();
    }
    prevQueueLenRef.current = waitingNow;
  }, [queue]);
  useEffect(() => {
    fetchEmployees().then(emps => setEmployees(emps.filter(e => e.active !== false))).catch(() => {});
    fetchServices().then(svcs => setServices(svcs.filter(s => s.active !== false))).catch(() => {});
    fetchClients().then(setClients).catch(() => {});
  }, []);

  // Refresh client list after a walk-in is added so a freshly-created
  // client shows up in the picker on the next "Add walk-in" tap.
  function refreshClients() {
    fetchClients().then(setClients).catch(() => {});
  }

  // Tick the clock every 30s for "waiting X min" displays
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Fullscreen toggle
  function toggleFullscreen() {
    const el = containerRef.current;
    if (!document.fullscreenElement) {
      el?.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setFullscreen(false)).catch(() => {});
    }
  }
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const next = nextUpInRotation(roster);
  const waiting = (queue || []).filter(q => q.status !== 'seated' && q.status !== 'cancelled')
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  // Seat the head of the queue with next-up tech (or a chosen tech)
  async function seatWalkIn(entry, techName) {
    if (!entry || !techName) return;
    try {
      // Banned-client guard — walk-in flow has no override; banned clients
      // get hard-blocked at seating. Admin must remove them from the queue.
      // (For overriding a ban, use the calendar booking flow which has the
      // explicit override checkbox + audit log.)
      if (entry.clientId) {
        try {
          const c = await fetchClient(entry.clientId);
          if (c?.banned) {
            showToast(`🚫 ${c.name} is banned — cannot seat. Remove from queue.`);
            logActivity('walkin_blocked_banned', `Blocked seating of banned client ${c.name} (${c.id})`);
            return;
          }
        } catch (e) {
          console.warn('[walkin] could not check ban status:', e?.message);
        }
      }
      // 1) +1 turn for the tech
      const updated = (roster || []).map(r =>
        r.techName === techName ? { ...r, turnsTaken: (Number(r.turnsTaken) || 0) + 1 } : r
      );
      await saveTurnRoster(today, updated).catch(() => {});

      // 2) Create the appointment for "now". Resolve the per-tech duration so a
      // slower tech gets the longer block they configured for this service.
      const svc = services.find(s => s.name === entry.serviceName);
      const seatedTechRec = employees.find(e => e.name === techName) || null;
      const dur = svc ? (resolveServicePricing(svc, null, seatedTechRec).duration || 60) : 60;
      const newApptId = await createAppointment({
        clientId:   entry.clientId || '',
        clientName: entry.clientName || 'Walk-in',
        techName,
        date:       today,
        startTime:  nowHHMM(),
        duration:   dur,
        services:   svc ? [{ name: svc.name, duration: dur, price: svc.basePrice ?? '' }] : (entry.serviceName ? [{ name: entry.serviceName, duration: dur, price: '' }] : []),
        status:     'in-progress',
        source:     'walkin_kiosk',
        techRequestType: 'auto',
        _turnCredited: new Date().toISOString(),
        createdBy:  gUser?.email || null,
      });

      // 3) Mark the queue entry seated
      await updateWaitlistEntry(entry.id, { status: 'seated', seatedAt: new Date().toISOString(), seatedTech: techName, apptId: newApptId }).catch(() => {});

      logActivity('walkin_seated', `${entry.clientName || 'Walk-in'} → ${techName} (${entry.serviceName || 'service'})`);
      showToast(`${entry.clientName || 'Walk-in'} seated with ${techName}`);
      setSeatPrompt(null);
    } catch (e) {
      showToast(`Seat failed: ${e.message || 'unknown'}`, 4000);
    }
  }

  return (
    <div ref={containerRef} style={{
      maxWidth: '100%',
      minHeight: fullscreen ? '100vh' : 'auto',
      background: fullscreen ? 'linear-gradient(135deg, #1a0e2e 0%, #0e1a2e 100%)' : 'transparent',
      padding: fullscreen ? 24 : 0,
      color: fullscreen ? '#fff' : 'inherit',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 13, color: fullscreen ? '#a99cc9' : 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>
            Walk-in Kiosk
          </div>
          <div style={{ fontSize: fullscreen ? 28 : 22, fontWeight: 700, color: fullscreen ? '#fff' : 'var(--pn-text)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: fullscreen ? 24 : 18, fontWeight: 700, color: fullscreen ? '#fff' : '#6a4fa0', fontVariantNumeric: 'tabular-nums' }}>
            {fmtClock(now)}
          </div>
          <button onClick={toggleFullscreen}
            style={{ fontSize: 14, padding: '8px 14px', borderRadius: 10, border: 'none', background: fullscreen ? 'rgba(255,255,255,.15)' : '#f3eafc', color: fullscreen ? '#fff' : '#6a4fa0', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {fullscreen ? '✕ Exit fullscreen' : '⛶ Fullscreen'}
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 18 }}>
        {/* NEXT UP hero — left, takes 2 columns */}
        <div style={{ gridColumn: 'span 2', minWidth: 320 }}>
          {next ? (
            <NextUpHero
              next={next}
              hasWalkIn={waiting.length > 0}
              onSeatNext={() => waiting.length > 0 ? setSeatPrompt({ entry: waiting[0], techName: next.techName }) : setShowAdd(true)}
              fullscreen={fullscreen}
            />
          ) : (
            <div style={{ background: fullscreen ? 'rgba(255,255,255,.06)' : 'var(--pn-surface)', border: fullscreen ? '1px solid rgba(255,255,255,.15)' : '1px solid var(--pn-border)', borderRadius: 18, padding: 36, textAlign: 'center', minHeight: 220 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>👥</div>
              <div style={{ fontSize: 18, color: fullscreen ? '#a99cc9' : 'var(--pn-text-muted)', marginBottom: 6, fontWeight: 600 }}>No techs in rotation today</div>
              <div style={{ fontSize: 13, color: fullscreen ? '#7a6a9a' : 'var(--pn-text-faint)', marginBottom: 14, lineHeight: 1.5, maxWidth: 320, margin: '0 auto 14px' }}>
                Open <strong>Schedule → Turn rotation</strong> from the side nav to clock techs in. This view updates live as soon as anyone joins the rotation from any device.
              </div>
              <div style={{ fontSize: 11, color: fullscreen ? '#7a6a9a' : 'var(--pn-text-faint)' }}>
                💡 Leave this page open on an iPad — it auto-refreshes.
              </div>
            </div>
          )}
        </div>

        {/* Waitlist column — right */}
        <div style={{ minWidth: 320 }}>
          <WaitlistPanel
            waiting={waiting}
            now={now}
            onAdd={() => setShowAdd(true)}
            onSeat={(entry) => setSeatPrompt({ entry, techName: next?.techName })}
            onRemove={async (entry) => {
              if (!confirm(`Remove ${entry.clientName || 'walk-in'} from waitlist?`)) return;
              // Cancel rather than hard-delete: the existing `waiting`
              // filter excludes status='cancelled' so the row disappears
              // from the panel, and we keep a row in the collection for
              // audit / analytics. Falls back to deleteDoc if the update
              // ever fails (e.g. doc was already removed by a sibling).
              try {
                await updateWaitlistEntry(entry.id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
                logActivity('walkin_removed', `${entry.clientName || 'walk-in'} cancelled from waitlist`);
              } catch (e) {
                try {
                  await removeWaitlistEntry(entry.id);
                  logActivity('walkin_removed', `${entry.clientName || 'walk-in'} removed from waitlist`);
                } catch (e2) {
                  showToast(`Could not remove: ${e2?.message || e?.message || 'unknown error'}`, 5000);
                }
              }
            }}
            fullscreen={fullscreen}
          />
        </div>

        {/* Rotation column — bottom row, full width */}
        <div style={{ gridColumn: '1 / -1' }}>
          <RotationPanel roster={roster} fullscreen={fullscreen} />
        </div>
      </div>

      {/* Add walk-in modal */}
      {showAdd && (
        <AddWalkinModal
          services={services}
          employees={employees}
          clients={clients}
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); refreshClients(); }}
        />
      )}

      {/* Seat confirm */}
      {seatPrompt && (
        <SeatConfirmModal
          entry={seatPrompt.entry}
          defaultTech={seatPrompt.techName}
          roster={roster}
          onConfirm={(techName) => seatWalkIn(seatPrompt.entry, techName)}
          onCancel={() => setSeatPrompt(null)}
        />
      )}
    </div>
  );
}

function NextUpHero({ next, hasWalkIn, onSeatNext, fullscreen }) {
  const color = techColor(next.techName);
  return (
    <div style={{
      background: fullscreen
        ? 'linear-gradient(135deg, #6a4fa0 0%, #7a4ad9 100%)'
        : 'linear-gradient(135deg, #f3eafc 0%, #eaf3fc 100%)',
      border: fullscreen ? 'none' : '1px solid #d8d0e8',
      borderRadius: 18,
      padding: 28,
      minHeight: 280,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      boxShadow: fullscreen ? '0 20px 60px rgba(0,0,0,.4)' : '0 4px 12px rgba(106,79,160,.08)',
    }}>
      <div style={{ fontSize: fullscreen ? 16 : 14, fontWeight: 700, color: fullscreen ? '#d4c5ff' : '#6a4fa0', textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 14 }}>
        ⭐ Next Up
      </div>
      <div style={{
        width: fullscreen ? 140 : 110,
        height: fullscreen ? 140 : 110,
        borderRadius: '50%',
        background: color,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: fullscreen ? 56 : 44,
        fontWeight: 700,
        marginBottom: 16,
        boxShadow: '0 8px 24px rgba(0,0,0,.25)',
      }}>
        {initialsOf(next.techName)}
      </div>
      <div style={{ fontSize: fullscreen ? 44 : 34, fontWeight: 800, color: fullscreen ? '#fff' : 'var(--pn-text)', lineHeight: 1.1, marginBottom: 8 }}>
        {next.techName}
      </div>
      <div style={{ fontSize: fullscreen ? 16 : 14, color: fullscreen ? '#d4c5ff' : 'var(--pn-text-muted)', marginBottom: 20 }}>
        {next.turnsTaken || 0} turn{next.turnsTaken === 1 ? '' : 's'} today
      </div>
      <button onClick={onSeatNext}
        style={{
          padding: fullscreen ? '16px 36px' : '14px 28px',
          fontSize: fullscreen ? 18 : 16,
          fontWeight: 700,
          borderRadius: 14,
          border: 'none',
          background: hasWalkIn ? '#22c55e' : (fullscreen ? 'rgba(255,255,255,.15)' : 'var(--pn-surface-alt)'),
          color: hasWalkIn ? '#fff' : (fullscreen ? '#d4c5ff' : 'var(--pn-text-muted)'),
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: hasWalkIn ? '0 6px 16px rgba(34,197,94,.3)' : 'none',
          transition: 'transform .08s',
        }}
        onMouseDown={e => e.currentTarget.style.transform = 'scale(.98)'}
        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
        {hasWalkIn ? '👋 Seat next walk-in' : '+ Add walk-in'}
      </button>
    </div>
  );
}

function WaitlistPanel({ waiting, now, onAdd, onSeat, onRemove, fullscreen }) {
  return (
    <div style={{
      background: fullscreen ? 'rgba(255,255,255,.06)' : 'var(--pn-surface)',
      border: fullscreen ? '1px solid rgba(255,255,255,.15)' : '1px solid var(--pn-border)',
      borderRadius: 18, padding: 20, minHeight: 280,
      backdropFilter: fullscreen ? 'blur(20px)' : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: fullscreen ? 18 : 15, fontWeight: 700, color: fullscreen ? '#fff' : 'var(--pn-text)' }}>
          📝 Waitlist {waiting.length > 0 && <span style={{ color: '#ef4444' }}>({waiting.length})</span>}
        </div>
        <button onClick={onAdd}
          style={{ fontSize: 13, padding: '6px 12px', borderRadius: 8, border: 'none', background: '#6a4fa0', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          + Add
        </button>
      </div>
      {waiting.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: fullscreen ? '#7a6a9a' : 'var(--pn-text-faint)', fontSize: 14 }}>
          No one waiting
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {waiting.map((q, i) => {
            const wait = minutesAgo(q.createdAt) ?? 0;
            const urgent = wait > 20;
            return (
              <div key={q.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px',
                background: fullscreen ? (urgent ? 'rgba(239,68,68,.15)' : 'rgba(255,255,255,.06)') : (urgent ? 'var(--pn-danger-bg)' : 'var(--pn-bg)'),
                border: fullscreen ? '1px solid rgba(255,255,255,.1)' : `1px solid ${urgent ? '#fca5a5' : 'var(--pn-border)'}`,
                borderRadius: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: fullscreen ? '#fff' : 'var(--pn-text)' }}>{i === 0 ? '👉 ' : ''}{q.clientName || 'Walk-in'}</span>
                    {q.techName && q.techName !== 'Any' && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--pn-danger)' }}>★ {q.techName}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: fullscreen ? '#a99cc9' : 'var(--pn-text-muted)' }}>
                    {q.serviceName || 'service'} · waiting {wait} min
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => onSeat(q)}
                    style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
                    Seat
                  </button>
                  <button onClick={() => onRemove(q)}
                    style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, border: fullscreen ? '1px solid rgba(255,255,255,.2)' : '1px solid var(--pn-border-strong)', background: 'transparent', color: fullscreen ? '#a99cc9' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RotationPanel({ roster, fullscreen }) {
  if (!roster || roster.length === 0) return null;
  const sorted = [...roster].sort((a, b) => {
    const ta = a.turnsTaken || 0, tb = b.turnsTaken || 0;
    if (ta !== tb) return ta - tb;
    return (a.clockInAt || '').localeCompare(b.clockInAt || '');
  });
  return (
    <div style={{
      background: fullscreen ? 'rgba(255,255,255,.06)' : 'var(--pn-surface)',
      border: fullscreen ? '1px solid rgba(255,255,255,.15)' : '1px solid var(--pn-border)',
      borderRadius: 18, padding: 20,
      backdropFilter: fullscreen ? 'blur(20px)' : 'none',
    }}>
      <div style={{ fontSize: fullscreen ? 18 : 15, fontWeight: 700, color: fullscreen ? '#fff' : 'var(--pn-text)', marginBottom: 14 }}>
        🔄 Rotation order
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {sorted.map((r, i) => {
          const color = techColor(r.techName);
          const isNext = i === 0;
          return (
            <div key={r.techName} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: 12,
              background: isNext
                ? (fullscreen ? 'rgba(122, 74, 217, .35)' : 'linear-gradient(135deg, #f3eafc, #eaf3fc)')
                : (fullscreen ? 'rgba(255,255,255,.04)' : 'var(--pn-bg)'),
              border: fullscreen
                ? `1px solid ${isNext ? 'rgba(212,197,255,.4)' : 'rgba(255,255,255,.08)'}`
                : `1px solid ${isNext ? '#d8d0e8' : 'var(--pn-border)'}`,
              borderRadius: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%', background: color,
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, flexShrink: 0,
              }}>{initialsOf(r.techName)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: fullscreen ? '#fff' : 'var(--pn-text)' }}>
                  {isNext && '#1 '}{r.techName}
                </div>
                <div style={{ fontSize: 11, color: fullscreen ? '#a99cc9' : 'var(--pn-text-muted)' }}>
                  {r.turnsTaken || 0} turn{r.turnsTaken === 1 ? '' : 's'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Loose US phone format ((NNN) NNN-NNNN). Walk-ins are local — full
// libphonenumber-style international parsing isn't needed here.
function formatWalkInPhone(input) {
  const digits = String(input || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function AddWalkinModal({ services, employees, clients, onClose, onAdded }) {
  // Existing-client picker state
  const [clientId,    setClientId]    = useState('');
  const [clientName,  setClientName]  = useState('');
  const [clientPhone, setClientPhone] = useState('');
  // New-client inline form (mirrors the appointment modal)
  const [newOpen, setNewOpen]   = useState(false);
  const [newName, setNewName]   = useState('');
  const [newPhone, setNewPhone] = useState('');

  const [serviceName, setServiceName] = useState('');
  const [techName,    setTechName]    = useState('');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const today = todayStr();

  function pickClient(c) {
    setClientId(c.id);
    setClientName(c.name);
    setClientPhone(c.phone || '');
    setNewOpen(false);
  }
  function clearClient() {
    setClientId('');
    setClientName('');
    setClientPhone('');
  }

  async function submit() {
    setErr('');
    let resolvedId    = clientId;
    let resolvedName  = clientName.trim();
    let resolvedPhone = clientPhone.trim();

    // New client flow: validate, create, then add to waitlist.
    if (newOpen) {
      const n = newName.trim();
      const p = newPhone.trim();
      if (!n) { setErr('Name required'); return; }
      if (!p) { setErr('Phone required for new client'); return; }
      setSaving(true);
      try {
        resolvedId    = await createClient({ name: n, phone: p });
        resolvedName  = n;
        resolvedPhone = p;
      } catch (e) {
        setErr(e?.message || 'Could not create client');
        setSaving(false);
        return;
      }
    } else {
      if (!resolvedId)   { setErr('Pick a client (or tap + New client)'); return; }
      if (!resolvedName) { setErr('Name required'); return; }
      setSaving(true);
    }

    try {
      await addToWaitlist({
        date: today,
        clientId:    resolvedId,
        clientName:  resolvedName,
        clientPhone: resolvedPhone,
        serviceName: serviceName || '',
        techName:    techName || 'Any',
        status:      'waiting',
        createdAt:   new Date().toISOString(),
      });
      logActivity('walkin_added', `${resolvedName} on waitlist (${serviceName || 'service tbd'})`);
      onAdded();
    } catch (e) {
      setErr(e?.message || 'Could not add');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 420, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Add walk-in</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {!newOpen && (
            <FieldRow label="Client">
              <ClientPicker
                clients={clients}
                clientId={clientId}
                onSelect={pickClient}
                onClear={clearClient}
              />
            </FieldRow>
          )}

          {!newOpen && !clientId && (
            <button onClick={() => { setNewOpen(true); setNewName(''); setNewPhone(''); }}
              style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, color: 'var(--pn-warning)', background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
              + New client
            </button>
          )}

          {newOpen && (
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--pn-warning-bg)', border: '1px solid #fde68a' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--pn-warning)', fontWeight: 700 }}>New client profile</div>
                <button onClick={() => setNewOpen(false)}
                  style={{ border: 'none', background: 'none', color: 'var(--pn-warning)', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
              </div>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Full name *" style={{ ...kioskInput, marginBottom: 6 }} />
              <input type="tel" inputMode="tel" value={newPhone}
                onChange={e => setNewPhone(formatWalkInPhone(e.target.value))}
                placeholder="Phone *  (614) 555-0123" style={kioskInput} />
            </div>
          )}

          {clientId && (
            <FieldRow label="Phone">
              <input type="tel" inputMode="tel" value={clientPhone}
                onChange={e => setClientPhone(formatWalkInPhone(e.target.value))}
                placeholder="(614) 555-0123" style={kioskInput} />
            </FieldRow>
          )}

          <FieldRow label="Service">
            <select value={serviceName} onChange={e => setServiceName(e.target.value)} style={kioskInput}>
              <option value="">Pick service…</option>
              {(services || []).map(s => <option key={s.id} value={s.name}>{s.name}{s.basePrice ? ` · $${s.basePrice}` : ''}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="Tech">
            <select value={techName} onChange={e => setTechName(e.target.value)} style={kioskInput}>
              <option value="">No preference (Any)</option>
              {(employees || []).map(e => <option key={e.id || e.name} value={e.name}>{e.name}</option>)}
            </select>
          </FieldRow>
          {err && <div style={{ fontSize: 12, color: '#b91c1c' }}>{err}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={submit} disabled={saving}
            style={{ flex: 2, padding: '10px 14px', borderRadius: 10, border: 'none', background: saving ? '#cbb6e0' : '#6a4fa0', color: '#fff', fontWeight: 600, fontSize: 14, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Adding…' : 'Add to waitlist'}
          </button>
          <button onClick={onClose} disabled={saving}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientPicker({ clients, clientId, onSelect, onClear }) {
  const [query, setQuery] = useState('');
  const [open,  setOpen]  = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selected = clients.find(c => c.id === clientId);

  if (selected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...kioskInput, paddingTop: 8, paddingBottom: 8, cursor: 'default' }}>
        <span style={{ flex: 1, fontSize: 14, color: 'var(--pn-text)' }}>{selected.name}</span>
        {selected.phone && <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{selected.phone}</span>}
        <button onClick={onClear} style={{ border: 'none', background: 'none', color: 'var(--pn-text-faint)', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
    );
  }

  const sortedAll = [...(clients || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const filtered = query.length >= 1
    ? sortedAll.filter(c => (c.name || '').toLowerCase().includes(query.toLowerCase()) || (c.phone || '').includes(query)).slice(0, 50)
    : sortedAll.slice(0, 100);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search clients by name or phone…"
        style={kioskInput}
      />
      {open && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 2px)', background: 'var(--pn-surface)', border: '1px solid var(--pn-border-strong)', borderRadius: 8, zIndex: 220, maxHeight: 260, overflowY: 'auto', boxShadow: '0 6px 20px rgba(0,0,0,.12)' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '12px', fontSize: 12, color: 'var(--pn-text-muted)', textAlign: 'center' }}>
              No matches{query ? ` for “${query}”` : ''}. Tap <strong style={{ color: '#92400e' }}>+ New client</strong> below.
            </div>
          ) : filtered.map(c => (
            <div key={c.id} onMouseDown={() => { onSelect(c); setQuery(''); setOpen(false); }}
              style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--pn-border)' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f5f9ff'}
              onMouseLeave={e => e.currentTarget.style.background = ''}>
              <span style={{ flex: 1 }}>{c.name}</span>
              {c.phone && <span style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>{c.phone}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SeatConfirmModal({ entry, defaultTech, roster, onConfirm, onCancel }) {
  const [techName, setTechName] = useState(defaultTech || '');
  const sorted = [...(roster || [])].sort((a, b) => (a.turnsTaken || 0) - (b.turnsTaken || 0));
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 400, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Seat walk-in</div>
        <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginBottom: 16 }}>
          <strong>{entry.clientName || 'Walk-in'}</strong>
          {entry.serviceName ? ` · ${entry.serviceName}` : ''}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>Pick tech</div>
        <select value={techName} onChange={e => setTechName(e.target.value)} style={{ ...kioskInput, marginBottom: 16 }}>
          <option value="">Pick a tech…</option>
          {sorted.map(r => (
            <option key={r.techName} value={r.techName}>
              {r.techName} ({r.turnsTaken || 0} turn{r.turnsTaken === 1 ? '' : 's'}){r.techName === defaultTech ? ' — next up' : ''}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onConfirm(techName)} disabled={!techName}
            style={{ flex: 2, padding: '10px 14px', borderRadius: 10, border: 'none', background: !techName ? '#cbb6e0' : '#22c55e', color: '#fff', fontWeight: 600, fontSize: 14, cursor: !techName ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            Seat with {techName || '…'}
          </button>
          <button onClick={onCancel}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const kioskInput = {
  width: '100%',
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '9px 12px',
  borderRadius: 10,
  border: '1px solid var(--pn-border-strong)',
  background: 'var(--pn-bg)',
  outline: 'none',
  boxSizing: 'border-box',
};

function FieldRow({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      {children}
    </div>
  );
}
