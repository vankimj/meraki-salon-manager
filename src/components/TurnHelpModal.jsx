import { useState, useEffect, useMemo, useRef } from 'react';
import { TURN_HELP as H } from '../data/turnHelp';

// Build per-step running totals (revenue / value / customer count per tech) for
// one distribution system, so the bars can animate as the day plays out.
function buildRun(clients, assigned, techs) {
  const zero = () => Object.fromEntries(techs.map(t => [t, { rev: 0, val: 0, count: 0 }]));
  const run = [zero()];
  let cur = zero();
  clients.forEach((c, i) => {
    cur = JSON.parse(JSON.stringify(cur));
    const t = assigned[i];
    cur[t].rev += c.price; cur[t].val += c.value; cur[t].count += 1;
    run.push(cur);
  });
  return run;
}

const COLORS = { Anna: '#2D7A5F', Bao: '#3D95CE', Chi: '#b8742f' };

export default function TurnHelpModal({ onClose }) {
  const { techs, clients, systems } = H;
  const runs = useMemo(() => ({
    leastBusy: buildRun(clients, systems.leastBusy.assigned, techs),
    mango:     buildRun(clients, systems.mango.assigned, techs),
  }), [clients, systems, techs]);

  const maxRev = useMemo(() => {
    let m = 0;
    ['leastBusy', 'mango'].forEach(k => { const end = runs[k][clients.length]; techs.forEach(t => { m = Math.max(m, end[t].rev); }); });
    return m || 1;
  }, [runs, clients.length, techs]);

  const [step, setStep] = useState(0);          // 0 = before anyone; clients.length = done
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);
  const [clockN, setClockN] = useState(0);      // clock-in timeline reveal count
  const [breakI, setBreakI] = useState(0);      // breaks stepper index

  useEffect(() => {
    if (!playing) return;
    if (step >= clients.length) { setPlaying(false); return; }
    timer.current = setTimeout(() => setStep(s => Math.min(clients.length, s + 1)), 1150);
    return () => clearTimeout(timer.current);
  }, [playing, step, clients.length]);

  const incoming = step >= 1 && step <= clients.length ? clients[step - 1] : null;
  const done = step >= clients.length;

  const SystemPanel = ({ sys }) => {
    const run = runs[sys.key][step];
    const recipient = incoming ? sys.assigned[step - 1] : null;
    const endRun = runs[sys.key][clients.length];
    const revs = techs.map(t => endRun[t].rev);
    const spread = Math.max(...revs) - Math.min(...revs);
    return (
      <div style={{ flex: 1, minWidth: 230, background: 'var(--pn-bg, #f7f8f9)', border: '1px solid var(--pn-border, #eee)', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--pn-text, #222)', marginBottom: 2 }}>{sys.label}</div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted, #777)', lineHeight: 1.45, marginBottom: 12, minHeight: 30 }}>{sys.blurb}</div>
        {techs.map(t => {
          const d = run[t];
          const isGettingIt = recipient === t;
          return (
            <div key={t} style={{ marginBottom: 12, transition: 'transform .2s', transform: isGettingIt ? 'scale(1.02)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: COLORS[t] }}>
                  {t}
                  <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 600, color: 'var(--pn-text-faint, #999)' }}>🕘 in {H.clockIns[t]}</span>
                  {isGettingIt && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#fff', background: COLORS[t], borderRadius: 10, padding: '1px 7px' }}>＋ got it</span>}
                </span>
                <span style={{ fontSize: 11, color: 'var(--pn-text-muted, #777)', fontVariantNumeric: 'tabular-nums' }}>${d.rev} · {d.count} {d.count === 1 ? 'client' : 'clients'}</span>
              </div>
              <div style={{ height: 16, background: 'var(--pn-surface-alt, #eceef0)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(d.rev / maxRev) * 100}%`, background: COLORS[t], borderRadius: 8, transition: 'width .55s ease' }} />
              </div>
            </div>
          );
        })}
        {done && (
          <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: spread > 120 ? '#c0392b' : '#1a7a4f', background: spread > 120 ? '#fdecea' : '#eaf6ef', borderRadius: 8, padding: '7px 9px', lineHeight: 1.4 }}>
            {spread > 120
              ? `😬 Pay gap: $${spread}. Same-ish client counts, wildly different money.`
              : `✅ Pay gap: only $${spread}. Everyone earned about the same.`}
          </div>
        )}
      </div>
    );
  };

  const sec = { fontSize: 14, fontWeight: 800, color: 'var(--tm-primary, #2D7A5F)', margin: '22px 0 8px' };
  const para = { fontSize: 13.5, lineHeight: 1.6, color: 'var(--pn-text-muted, #555)', margin: '0 0 8px' };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 14px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--pn-surface, #fff)', color: 'var(--pn-text, #1a1a1a)', borderRadius: 16, maxWidth: 720, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--pn-border, #eee)', position: 'sticky', top: 0, background: 'var(--pn-surface, #fff)', zIndex: 2 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>🔄 {H.title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--pn-text-muted, #888)', lineHeight: 1, fontFamily: 'inherit' }}>×</button>
        </div>

        <div style={{ padding: '18px 20px' }}>
          {/* Basics */}
          <div style={sec}>First, the basics</div>
          {H.basics.map((b, i) => (
            <p key={i} style={para}><strong style={{ color: 'var(--pn-text, #333)' }}>{b.term}:</strong> {b.def}</p>
          ))}

          {/* The big question */}
          <div style={{ marginTop: 20, background: '#fff8ed', border: '1px solid #f3d9a4', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: '#9a6b1e' }}>❓ {H.bigQuestion.q}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1a7a4f', margin: '4px 0 8px' }}>{H.bigQuestion.a}</div>
            {H.bigQuestion.why.map((w, i) => (
              <p key={i} style={{ ...para, color: '#6b5a3a', margin: '0 0 6px' }}>{w}</p>
            ))}
          </div>

          {/* The idea + menu */}
          <div style={sec}>The idea: count the value of the work, not the headcount</div>
          <p style={para}>{H.idea}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {H.menu.map(m => (
              <span key={m.name} style={{ fontSize: 11.5, background: 'var(--pn-bg, #f4f5f6)', border: '1px solid var(--pn-border, #e6e6e6)', borderRadius: 16, padding: '4px 10px', color: 'var(--pn-text-muted, #555)' }}>
                {m.name} · <strong>{m.value} {m.value === 1 ? 'pt' : 'pts'}</strong> · ${m.price}
              </span>
            ))}
          </div>

          {/* Animated walkthrough */}
          <div style={sec}>Watch one day unfold — same 9 walk-ins, two systems</div>
          <p style={{ ...para, marginBottom: 8 }}>Hit play. The same customers arrive in the same order; watch how each system hands them out and what each tech ends up earning.</p>
          <p style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--pn-text-faint, #888)', background: 'var(--pn-bg, #f4f5f6)', borderRadius: 8, padding: '8px 10px', margin: '0 0 12px' }}>🕘 {H.tieNote}</p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <button onClick={() => { if (done) { setStep(0); setPlaying(true); } else setPlaying(p => !p); }}
              style={{ fontSize: 13, fontWeight: 800, color: '#fff', background: 'var(--tm-primary, #2D7A5F)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: 'inherit' }}>
              {done ? '↺ Replay' : playing ? '⏸ Pause' : '▶ Play'}
            </button>
            <button onClick={() => { setPlaying(false); setStep(s => Math.min(clients.length, s + 1)); }} disabled={done}
              style={{ fontSize: 13, fontWeight: 700, color: done ? '#bbb' : 'var(--pn-text-muted, #555)', background: 'var(--pn-surface, #fff)', border: '1px solid var(--pn-border, #ddd)', borderRadius: 8, padding: '8px 14px', cursor: done ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              Step ›
            </button>
            <button onClick={() => { setPlaying(false); setStep(0); }}
              style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text-muted, #555)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              Reset
            </button>
            <span style={{ fontSize: 12, color: 'var(--pn-text-muted, #888)', marginLeft: 'auto', fontWeight: 600 }}>{step} / {clients.length} served</span>
          </div>

          <div style={{ minHeight: 44, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: incoming ? '#eef5f2' : 'transparent', borderRadius: 10, padding: incoming ? '10px 12px' : 0 }}>
            {incoming
              ? <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--pn-text, #333)' }}>Walk-in #{incoming.n} just arrived: <span style={{ color: 'var(--tm-primary, #2D7A5F)' }}>{incoming.service}</span> · ${incoming.price} <span style={{ color: 'var(--pn-text-muted, #888)', fontWeight: 600 }}>({incoming.value} pts)</span></span>
              : done
                ? <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--pn-text-muted, #555)' }}>That’s the whole day. Compare the two drawers 👇</span>
                : <span style={{ fontSize: 13, color: 'var(--pn-text-faint, #aaa)' }}>Press ▶ Play to start the day.</span>}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <SystemPanel sys={systems.leastBusy} />
            <SystemPanel sys={systems.mango} />
          </div>

          {/* Why least-busy isn't fair */}
          <div style={sec}>Why “least busy” feels fair but isn’t</div>
          {H.whyNotFair.map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <span style={{ color: 'var(--tm-primary, #2D7A5F)', fontWeight: 800 }}>›</span>
              <span style={para}>{w}</span>
            </div>
          ))}

          {/* Clock-in timeline */}
          <div style={sec}>🕘 {H.clockInTimeline.q}</div>
          <p style={{ ...para, fontWeight: 700, color: 'var(--pn-text, #333)' }}>{H.clockInTimeline.a}</p>
          <button onClick={() => setClockN(n => n >= H.clockInTimeline.events.length ? 0 : n + 1)}
            style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: 'var(--tm-primary, #2D7A5F)', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12 }}>
            {clockN >= H.clockInTimeline.events.length ? '↺ Replay' : clockN === 0 ? '▶ Play the day' : 'Next ›'}
          </button>
          <div style={{ borderLeft: '2px solid var(--pn-border, #e6e6e6)', paddingLeft: 14, marginLeft: 4 }}>
            {H.clockInTimeline.events.map((ev, i) => {
              const shown = i < clockN;
              return (
                <div key={i} style={{ position: 'relative', marginBottom: 12, opacity: shown ? 1 : 0.25, transition: 'opacity .4s', transform: shown ? 'none' : 'translateY(4px)' }}>
                  <span style={{ position: 'absolute', left: -21, top: 3, width: 9, height: 9, borderRadius: '50%', background: ev.highlight ? '#e0892f' : 'var(--tm-primary, #2D7A5F)', boxShadow: '0 0 0 3px var(--pn-surface, #fff)' }} />
                  <div style={{ fontSize: 12, fontWeight: 800, color: ev.highlight ? '#c0721e' : 'var(--pn-text, #333)' }}>{ev.time}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--pn-text-muted, #555)' }}>{ev.text}</div>
                </div>
              );
            })}
          </div>

          {/* Breaks */}
          <div style={sec}>☕ {H.breaks.q}</div>
          <p style={{ ...para, fontWeight: 700, color: 'var(--pn-text, #333)' }}>{H.breaks.a}</p>
          {(() => {
            const stp = H.breaks.steps[breakI];
            const chip = (r) => {
              const bg = r.s === 'away' ? 'var(--pn-bg, #f4f5f6)' : r.s === 'next' ? '#eaf6ef' : 'var(--pn-surface, #fff)';
              const bd = r.s === 'next' ? '#2D7A5F' : 'var(--pn-border, #e0e0e0)';
              return (
                <div key={r.n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, border: `1.5px solid ${bd}`, background: bg, marginBottom: 6, opacity: r.s === 'away' ? 0.6 : 1, transition: 'all .3s' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text, #222)' }}>{r.s === 'next' ? '⭐ ' : r.s === 'away' ? '💤 ' : ''}{r.n}</span>
                  <span style={{ fontSize: 12, color: 'var(--pn-text-muted, #777)' }}>{r.t} turn{r.t === 1 ? '' : 's'}{r.s === 'away' ? ' · away' : ''}</span>
                </div>
              );
            };
            return (
              <div>
                <div style={{ background: 'var(--pn-bg, #f7f8f9)', borderRadius: 10, padding: 12, marginBottom: 10 }}>{stp.roster.map(chip)}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--pn-text-muted, #555)', minHeight: 38, marginBottom: 10 }}>{stp.caption}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={() => setBreakI(i => Math.max(0, i - 1))} disabled={breakI === 0}
                    style={{ fontSize: 12, fontWeight: 700, color: breakI === 0 ? '#bbb' : 'var(--pn-text-muted, #555)', background: 'var(--pn-surface, #fff)', border: '1px solid var(--pn-border, #ddd)', borderRadius: 8, padding: '6px 12px', cursor: breakI === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}>‹ Back</button>
                  <button onClick={() => setBreakI(i => Math.min(H.breaks.steps.length - 1, i + 1))} disabled={breakI >= H.breaks.steps.length - 1}
                    style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: breakI >= H.breaks.steps.length - 1 ? '#bbb' : 'var(--tm-primary, #2D7A5F)', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: breakI >= H.breaks.steps.length - 1 ? 'default' : 'pointer', fontFamily: 'inherit' }}>Next ›</button>
                  <span style={{ fontSize: 11, color: 'var(--pn-text-faint, #999)', marginLeft: 'auto' }}>{breakI + 1} / {H.breaks.steps.length}</span>
                </div>
              </div>
            );
          })()}
          <div style={{ marginTop: 10 }}>
            {H.breaks.points.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4 }}><span style={{ color: 'var(--tm-primary, #2D7A5F)', fontWeight: 800 }}>›</span><span style={{ ...para, margin: 0 }}>{p}</span></div>
            ))}
          </div>

          {/* No preference vs requested */}
          <div style={sec}>{H.requests.q}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {H.requests.cases.map(c => (
              <div key={c.tag} style={{ flex: 1, minWidth: 220, background: 'var(--pn-bg, #f7f8f9)', border: '1px solid var(--pn-border, #eee)', borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--pn-text, #222)', marginBottom: 6 }}>{c.icon} {c.tag}</div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--pn-text-muted, #555)' }}>{c.text}</div>
              </div>
            ))}
          </div>

          {/* How it works in this app */}
          <div style={sec}>How it works in this app</div>
          {H.howItWorksHere.map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <span style={{ color: 'var(--tm-primary, #2D7A5F)', fontWeight: 800 }}>›</span>
              <span style={para}>{w}</span>
            </div>
          ))}

          <div style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--pn-text-faint, #888)', marginTop: 16, lineHeight: 1.55, borderTop: '1px solid var(--pn-border, #eee)', paddingTop: 14 }}>{H.footer}</div>
        </div>
      </div>
    </div>
  );
}
