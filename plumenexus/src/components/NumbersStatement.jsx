import { C, FONT } from '../theme.js';
import Reveal from './Reveal.jsx';

// Editorial statement — confidence presented as restraint. Three short
// lines, each a Fraunces line at hero scale, hairline-divided. Replaces
// a "100,000+ customers" stat-banner with the boutique-magazine
// equivalent: small numbers, large type, italic accent.
export default function NumbersStatement() {
  const LINES = [
    { num: 'One',       word: 'studio.',                    italic: false },
    { num: 'Ten',       word: 'techs.',                     italic: false },
    { num: 'Fourteen',  word: 'months in build.',           italic: true  },
  ];

  return (
    <section style={{
      background: C.bg,
      padding: '140px 28px',
      borderTop: `1px solid ${C.rule}`,
      borderBottom: `1px solid ${C.rule}`,
    }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <Reveal>
          <div style={{
            fontSize: 11, fontWeight: 600, color: C.goldDeep,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            marginBottom: 56, textAlign: 'left',
          }}>
            II · The proof
          </div>
        </Reveal>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {LINES.map((l, i) => (
            <Reveal key={i} delay={i * 140}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 24,
                padding: '28px 0',
                borderBottom: i < LINES.length - 1 ? `1px solid ${C.rule}` : 'none',
                flexWrap: 'wrap',
              }}>
                <div style={{
                  fontFamily: FONT.display,
                  fontSize: 'clamp(56px, 9vw, 120px)',
                  lineHeight: 0.95,
                  letterSpacing: '-0.02em',
                  color: C.ink,
                  fontWeight: 400,
                  fontStyle: l.italic ? 'italic' : 'normal',
                  minWidth: 'min(280px, 38vw)',
                }}>
                  {l.num}
                </div>
                <div style={{
                  fontFamily: FONT.display,
                  fontSize: 'clamp(28px, 4vw, 48px)',
                  lineHeight: 1.1,
                  letterSpacing: '-0.01em',
                  color: C.muted,
                  fontWeight: 300,
                  fontStyle: l.italic ? 'italic' : 'normal',
                  flex: 1,
                }}>
                  {l.word}
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={520}>
          <p style={{
            marginTop: 56,
            maxWidth: 480,
            fontSize: 15,
            lineHeight: 1.7,
            color: C.muted,
            fontStyle: 'italic',
          }}>
            Plume Nexus has been running Meraki Nail Studio since opening
            day — every release tested against real bookings, real payroll,
            real walk-ins. No theoretical features. No untested edge cases.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
