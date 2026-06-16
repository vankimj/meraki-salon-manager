import { C, FONT, grad, shadow, radius } from '../theme.js';
import Section from './Section.jsx';

// "Your first 30 days" — replaces the earlier competitor comparison.
// Reduces the biggest buying objection (switching anxiety) by showing
// concretely what onboarding actually looks like.
const STEPS = [
  {
    when: 'Day 1',
    title: 'Migrate your history',
    body: 'Coming from GlossGenius? Our CSV importer brings in your client list and last 12 months of receipts — handling tips, multi-tech splits, and refunds correctly, and deduping on GlossGenius transaction IDs so re-running is safe. On Vagaro, Square, Boulevard, Mindbody, or Fresha, we hand-import your export for you while we finish those parsers.',
    icon: '📦',
  },
  {
    when: 'Day 2-3',
    title: 'Wire up your team',
    body: 'Add your staff with role-based access (admin, scheduler, tech, read-only). Set per-tech compensation, work days, and social handles. Import or rebuild your service menu.',
    icon: '👥',
  },
  {
    when: 'Week 1',
    title: 'First live shifts',
    body: 'Front desk takes its first appointments and walk-ins, with checkout, multi-tech commission splits, and gift cards built in. Tap-to-Pay on iPhone and iPad is rolling out, pending Apple approval. And Ask AI is ready to query your data from day one — no waiting period.',
    icon: '✂️',
  },
  {
    when: 'Week 2',
    title: 'Marketing in motion',
    body: 'Send your first email campaign — birthday wishes, lapsed-client win-back, or a flash promo — with per-recipient delivery analytics that show you exactly what landed. SMS campaigns are built and unlock the moment your salon\'s text number clears carrier registration.',
    icon: '📣',
  },
  {
    when: 'Day 30',
    title: 'Enough history to lean on AI',
    body: 'By now you\'ve logged a month of real activity — enough for Ask AI to give you answers worth acting on. "Who lapsed in the last 60 days?" or "How did Saturday go?" Get them in seconds, not spreadsheets.',
    icon: '✨',
  },
];

export default function Compare() {
  return (
    <Section
      id="compare"
      eyebrow="Switching feels heavy. It shouldn't be."
      title="Your first 30 days, mapped."
      subtitle="The biggest worry every salon owner has about switching platforms is the switch itself. Here's exactly what happens, week by week."
    >
      <div style={{ position: 'relative', maxWidth: 980, margin: '0 auto' }}>

        {/* Vertical timeline rail (desktop) */}
        <div className="pn-timeline-rail" style={{
          position: 'absolute',
          left: 79, top: 0, bottom: 0,
          width: 2, background: `linear-gradient(180deg, ${C.plum} 0%, ${C.blue} 100%)`,
          borderRadius: 1, opacity: 0.18,
        }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {STEPS.map((s, i) => (
            <Step key={s.title} step={s} index={i} last={i === STEPS.length - 1} />
          ))}
        </div>
      </div>

      <div style={{
        marginTop: 56, textAlign: 'center',
        fontSize: 14, color: C.muted,
      }}>
        Want a personalized plan based on your salon's setup?{' '}
        <a href="#demo" style={{ color: C.plum, fontWeight: 600 }}>Book a demo →</a>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .pn-timeline-rail { display: none; }
        }
      `}</style>
    </Section>
  );
}

function Step({ step, index }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '160px 1fr',
      gap: 24,
      alignItems: 'flex-start',
    }} className="pn-step-row">
      {/* Left: when chip + dot */}
      <div style={{ position: 'relative', textAlign: 'right', paddingRight: 24 }} className="pn-step-when">
        <div style={{
          fontFamily: FONT.display, fontSize: 17, fontWeight: 600,
          color: C.plumDeep, lineHeight: 1.2,
        }}>{step.when}</div>
        {/* Timeline dot */}
        <div style={{
          position: 'absolute',
          right: -10, top: 4,
          width: 18, height: 18, borderRadius: '50%',
          background: '#fff',
          border: `3px solid ${C.plum}`,
          boxShadow: '0 0 0 4px #fff',
          zIndex: 2,
        }} className="pn-step-dot" />
      </div>

      {/* Right: card */}
      <div style={{
        padding: '20px 24px',
        background: '#fff',
        border: `1px solid ${C.rule}`,
        borderRadius: radius.md,
        boxShadow: shadow.sm,
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
        transition: 'transform .18s, box-shadow .18s, border-color .18s',
      }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = shadow.md;
          e.currentTarget.style.borderColor = `${C.plum}40`;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = shadow.sm;
          e.currentTarget.style.borderColor = C.rule;
        }}
      >
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: index % 2 === 0 ? grad.primary : `${C.plum}14`,
          color: index % 2 === 0 ? '#fff' : C.plumDeep,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, flexShrink: 0,
        }}>{step.icon}</div>
        <div style={{ flex: 1 }}>
          <h3 style={{
            fontFamily: FONT.body, fontSize: 17, fontWeight: 700,
            margin: '0 0 6px', color: C.ink, letterSpacing: '-.005em',
          }}>{step.title}</h3>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: C.muted, margin: 0 }}>{step.body}</p>
        </div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .pn-step-row  { grid-template-columns: 1fr !important; gap: 4px !important; }
          .pn-step-when { text-align: left !important; padding-right: 0 !important; padding-left: 4px; }
          .pn-step-dot  { display: none; }
        }
      `}</style>
    </div>
  );
}
