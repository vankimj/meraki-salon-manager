import { useState, useEffect, useRef, useMemo } from 'react';
import { buildDayReplay } from '../lib/dayReplay';

const COLORS = ['#2D7A5F', '#3D95CE', '#b8742f', '#8e5bd0', '#c0392b', '#0e9aa7', '#d4860b', '#5a7d2a'];
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// "Replay the day" — animates how the real rotation accumulated on a chosen
// date, so a manager can show a tech exactly how the logic played out.
// `fetchDay(date)` must return { appointments, roster }.
export default function DayReplayModal({ services = [], turnMode = 'count', fetchDay, initialDate, onClose }) {
  const [date, setDate] = useState(initialDate || todayStr());
  const [raw, setRaw] = useState(null);     // { appointments, roster }
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let live = true;
    setLoading(true); setStep(0); setPlaying(false);
    Promise.resolve(fetchDay(date)).then(d => { if (live) { setRaw(d || { appointments: [], roster: [] }); setLoading(false); } })
      .catch(() => { if (live) { setRaw({ appointments: [], roster: [] }); setLoading(false); } });
    return () => { live = false; };
  }, [date, fetchDay]);

  const replay = useMemo(() => raw ? buildDayReplay({ appointments: raw.appointments, services, roster: raw.roster, turnMode, date }) : null, [raw, services, turnMode, date]);

  const nEvents = replay ? replay.events.length : 0;
  useEffect(() => {
    if (!playing) return;
    if (step >= nEvents) { setPlaying(false); return; }
    timer.current = setTimeout(() => setStep(s => Math.min(nEvents, s + 1)), 1050);
    return () => clearTimeout(timer.current);
  }, [playing, step, nEvents]);

  const colorOf = useMemo(() => {
    const m = {};
    (replay ? replay.techs : []).forEach((t, i) => { m[t.name] = COLORS[i % COLORS.length]; });
    return m;
  }, [replay]);

  const unit = turnMode === 'value' ? 'pts' : 'turns';
  const fmt = (n) => turnMode === 'value' ? (Math.round(n * 10) / 10) : n;
  const maxVal = replay ? Math.max(1, ...replay.techs.map(t => replay.finals[t.name] || 0)) : 1;
  const incoming = replay && step >= 1 && step <= nEvents ? replay.events[step - 1] : null;
  const done = replay && step >= nEvents;
  const cum = replay ? replay.cumulative[Math.min(step, nEvents)] : {};

  const btn = (bg) => ({ fontSize: 13, fontWeight: 800, color: '#fff', background: bg, border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: 'inherit' });

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 14px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--pn-surface, #fff)', color: 'var(--pn-text, #1a1a1a)', borderRadius: 16, maxWidth: 620, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--pn-border, #eee)', position: 'sticky', top: 0, background: 'var(--pn-surface, #fff)', zIndex: 2 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>▶ Replay the day</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--pn-text-muted, #888)', lineHeight: 1, fontFamily: 'inherit' }}>×</button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--pn-text-muted, #666)', fontWeight: 600 }}>Day:</label>
            <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--pn-border, #ddd)', fontSize: 13, fontFamily: 'inherit', background: 'var(--pn-surface, #fff)', color: 'var(--pn-text, #222)' }} />
            <span style={{ fontSize: 11, color: 'var(--pn-text-faint, #999)', fontWeight: 600 }}>{turnMode === 'value' ? 'By value of work' : 'By customer count'}</span>
          </div>

          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--pn-text-faint, #999)' }}>Loading…</div>
          ) : replay.isEmpty ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--pn-text-muted, #777)', fontSize: 13, lineHeight: 1.5 }}>
              No completed walk-ins or appointments for {date}. Nothing to replay — once tickets are checked out, they'll show here.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <button onClick={() => { if (done) { setStep(0); setPlaying(true); } else setPlaying(p => !p); }} style={btn('var(--tm-primary, #2D7A5F)')}>
                  {done ? '↺ Replay' : playing ? '⏸ Pause' : '▶ Play the day'}
                </button>
                <button onClick={() => { setPlaying(false); setStep(s => Math.min(nEvents, s + 1)); }} disabled={done}
                  style={{ fontSize: 13, fontWeight: 700, color: done ? '#bbb' : 'var(--pn-text-muted, #555)', background: 'var(--pn-surface, #fff)', border: '1px solid var(--pn-border, #ddd)', borderRadius: 8, padding: '8px 14px', cursor: done ? 'default' : 'pointer', fontFamily: 'inherit' }}>Step ›</button>
                <button onClick={() => { setPlaying(false); setStep(0); }} style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text-muted, #555)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
                <span style={{ fontSize: 12, color: 'var(--pn-text-muted, #888)', marginLeft: 'auto', fontWeight: 600 }}>{step} / {nEvents}</span>
              </div>

              <div style={{ minHeight: 44, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: incoming ? 'var(--pn-success-bg, #eef5f2)' : 'transparent', borderRadius: 10, padding: incoming ? '9px 12px' : 0 }}>
                {incoming ? (
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text, #333)' }}>
                    {incoming.startTime && <span style={{ color: 'var(--pn-text-muted, #888)' }}>{incoming.startTime} · </span>}
                    <span style={{ color: colorOf[incoming.techName] }}>{incoming.techName}</span> took {incoming.client}
                    {incoming.services.length ? ` · ${incoming.services.join(', ')}` : ''}
                    {' '}<span style={{ color: 'var(--pn-text-muted, #888)', fontWeight: 600 }}>(+{fmt(incoming.credit)} {unit}{incoming.requested ? ' · requested' : incoming.kind === 'walkin' ? ' · walk-in' : ''})</span>
                  </span>
                ) : done ? (
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text-muted, #555)' }}>End of {date} — final tally below 👇</span>
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--pn-text-faint, #aaa)' }}>Press ▶ to replay {nEvents} checkout{nEvents === 1 ? '' : 's'}.</span>
                )}
              </div>

              {replay.techs.map(t => {
                const v = cum[t.name] || 0;
                const isActive = incoming && incoming.techName === t.name;
                return (
                  <div key={t.name} style={{ marginBottom: 12, transition: 'transform .2s', transform: isActive ? 'scale(1.01)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: colorOf[t.name] }}>
                        {t.name}
                        {t.clockInAt && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--pn-text-faint, #999)' }}>🕘 {new Date(t.clockInAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
                        {isActive && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#fff', background: colorOf[t.name], borderRadius: 10, padding: '1px 7px' }}>＋ took this one</span>}
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--pn-text-muted, #777)', fontVariantNumeric: 'tabular-nums' }}>{fmt(v)} {unit}</span>
                    </div>
                    <div style={{ height: 16, background: 'var(--pn-surface-alt, #eceef0)', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(v / maxVal) * 100}%`, background: colorOf[t.name], borderRadius: 8, transition: 'width .5s ease' }} />
                    </div>
                  </div>
                );
              })}

              {done && (
                <div style={{ fontSize: 12, color: 'var(--pn-text-faint, #888)', marginTop: 8, lineHeight: 1.5 }}>
                  This is exactly how the rotation tallied that day — lowest bar was always “next up.” {turnMode === 'value' ? 'Each ticket added its value at checkout.' : 'Each completed ticket added one turn.'}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
