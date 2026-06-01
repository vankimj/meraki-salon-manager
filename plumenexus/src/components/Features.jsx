import { C, FONT } from '../theme.js';
import Reveal from './Reveal.jsx';

// Five hero pillars rendered as alternating editorial spreads instead of
// a 12-card icon grid. The 7 other modules remain available via the
// comparison table further down the page (#compare). Less is more —
// magazines do not bullet-list their feature articles.
const PILLARS = [
  {
    eyebrow:  'I',
    title:    'Scheduling',
    accent:   'made human.',
    body:     'Drag-to-reschedule, recurring bookings, smart walk-in management, time-off blocks. The front-desk move you actually make — one click, the right outcome.',
    foot:     'Recurring · Walk-in queue · Time-off · Drag reschedule',
  },
  {
    eyebrow:  'II',
    title:    'POS',
    accent:   'without the patchwork.',
    body:     'Multi-tech credit splits at checkout. Tips per service, not per ticket. Gift cards, promo codes, store credit, refunds with photos. Built in. No add-on.',
    foot:     'Multi-tech splits · Per-service tips · Gift · Refunds',
  },
  {
    eyebrow:  'III',
    title:    'Communications',
    accent:   'in one inbox.',
    body:     'Two-way SMS and email threaded by client. Per-client channel preferences. Inbound replies route themselves. No more lost texts; no more "did I tell her already?"',
    foot:     'Two-way SMS · Email · Threading · Preferences',
  },
  {
    eyebrow:  'IV',
    title:    'Reports',
    accent:   'you can talk to.',
    body:     'Revenue, leaderboards, IRS-ready tax exports, cancellation analysis — every number a salon owner needs. Plus a chatbot that answers any question about your data in plain English.',
    foot:     'AI chat · IRS exports · Leaderboards · Cancellation',
  },
  {
    eyebrow:  'V',
    title:    'Payroll',
    accent:   'handled.',
    body:     'Per-tech earnings dashboards, compensation models that actually fit booth-rent vs commission vs hybrid, and a one-click Gusto sync when payday hits. Gusto runs W-2 + contractor payroll and files the tax forms — Plume Nexus owns the salon side: the ledger, the splits, the tips.',
    foot:     'Commission · Booth-rent · Tips · Gusto sync',
  },
];

export default function Features() {
  return (
    <section id="features" style={{
      background: C.bg,
      padding: '120px 28px 100px',
    }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>

        <Reveal>
          <header style={{ marginBottom: 88, maxWidth: 740 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: C.goldDeep,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              marginBottom: 16,
            }}>
              III · The platform
            </div>
            <h2 style={{
              fontFamily: FONT.display,
              fontSize: 'clamp(32px, 4.4vw, 56px)',
              lineHeight: 1.08,
              letterSpacing: '-0.015em',
              margin: 0, color: C.ink, fontWeight: 400,
            }}>
              Five pillars.
              <span style={{ fontStyle: 'italic', fontWeight: 400, color: C.muted }}> One login. One bill.</span>
            </h2>
            <p style={{
              marginTop: 22, maxWidth: 540,
              fontSize: 17, lineHeight: 1.65, color: C.muted,
            }}>
              The whole salon, on one platform. Built to replace the
              patchwork of scheduling apps, marketing tools, and
              spreadsheets you have cobbled together.
            </p>
          </header>
        </Reveal>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {PILLARS.map((p, i) => (
            <Pillar key={p.eyebrow} pillar={p} reversed={i % 2 === 1} last={i === PILLARS.length - 1} />
          ))}
        </div>

        <Reveal delay={120}>
          <div style={{
            marginTop: 56,
            paddingTop: 32,
            borderTop: `1px solid ${C.rule}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 24,
            flexWrap: 'wrap',
          }}>
            <p style={{
              fontSize: 13,
              color: C.muted,
              fontStyle: 'italic',
              margin: 0,
              letterSpacing: '0.01em',
            }}>
              Plus seven more modules — gift cards, loyalty, voice commands,
              employee profiles, kiosk mode, online booking, roles &amp; permissions.
            </p>
            <a href="#compare" style={{
              fontSize: 13,
              fontWeight: 600,
              color: C.ink,
              textDecoration: 'none',
              borderBottom: `1px solid ${C.gold}`,
              paddingBottom: 2,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>
              Full comparison →
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Pillar({ pillar, reversed, last }) {
  return (
    <Reveal>
      <article style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: 56,
        alignItems: 'center',
        padding: '64px 0',
        borderBottom: last ? 'none' : `1px solid ${C.rule}`,
      }} className="pn-pillar">
        <div style={{ order: reversed ? 2 : 1 }} className="pn-pillar-text">
          <div style={{
            fontFamily: FONT.display,
            fontSize: 14,
            fontStyle: 'italic',
            color: C.gold,
            letterSpacing: '0.04em',
            marginBottom: 12,
          }}>
            {pillar.eyebrow}
          </div>
          <h3 style={{
            fontFamily: FONT.display,
            fontSize: 'clamp(32px, 4.2vw, 56px)',
            lineHeight: 1.05,
            letterSpacing: '-0.015em',
            margin: 0, color: C.ink, fontWeight: 400,
          }}>
            {pillar.title}{' '}
            <span style={{ fontStyle: 'italic', color: C.muted, fontWeight: 300 }}>
              {pillar.accent}
            </span>
          </h3>
          <p style={{
            marginTop: 20,
            fontSize: 17, lineHeight: 1.65, color: C.text,
            maxWidth: 460,
          }}>
            {pillar.body}
          </p>
          <p style={{
            marginTop: 18,
            fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
            color: C.mutedSoft, fontWeight: 500,
          }}>
            {pillar.foot}
          </p>
        </div>

        <div style={{ order: reversed ? 1 : 2 }} className="pn-pillar-art">
          <PillarPlate pillar={pillar} />
        </div>
      </article>

      <style>{`
        @media (max-width: 880px) {
          .pn-pillar { grid-template-columns: 1fr !important; gap: 32px !important; padding: 48px 0 !important; }
          .pn-pillar-text { order: 1 !important; }
          .pn-pillar-art  { order: 2 !important; }
        }
      `}</style>
    </Reveal>
  );
}

// Restrained type-driven placeholder until real device-frame product
// screenshots land. Each pillar gets a quiet cream card with its big
// Roman numeral in Fraunces and a hairline border — magazine pagination
// vibe rather than an icon. Replaces these one-by-one with photo or
// product-UI shots later.
function PillarPlate({ pillar }) {
  return (
    <div style={{
      aspectRatio: '4 / 5',
      background: `linear-gradient(140deg, ${C.bgCream}, ${C.bgSoft})`,
      border: `1px solid ${C.rule}`,
      borderRadius: 4,
      position: 'relative',
      overflow: 'hidden',
      boxShadow: '0 24px 60px rgba(15,15,15,.05), 0 2px 8px rgba(15,15,15,.04)',
    }}>
      {/* Hairline cross-rules — classic magazine plate */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: '8% 6%',
        border: `1px solid ${C.rule}`,
        borderRadius: 2,
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '14% 12%',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: FONT.display,
          fontSize: 11, letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: C.muted,
          marginBottom: 14,
        }}>
          Plate {pillar.eyebrow}
        </div>
        <div style={{
          fontFamily: FONT.display,
          fontSize: 'clamp(80px, 12vw, 160px)',
          lineHeight: 1,
          color: C.gold,
          fontWeight: 300,
          letterSpacing: '-0.04em',
          fontStyle: 'italic',
        }}>
          {pillar.eyebrow}
        </div>
        <div style={{
          marginTop: 18,
          fontSize: 12, letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: C.muted,
        }}>
          {pillar.title}
        </div>
      </div>
    </div>
  );
}
