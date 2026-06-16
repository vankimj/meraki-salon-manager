import { C, FONT, grad, shadow, radius } from '../theme.js';
import Section from './Section.jsx';

const AI_FEATURES = [
  {
    icon: '🎙️',
    title: 'Voice command booking',
    body: '"Book Emma Klein for a gel mani next Tuesday at 2 with Riley." The AI confirms the slot, finds the client, picks the service, and books — hands-free.',
  },
  {
    icon: '📊',
    title: 'Plain-English reporting',
    body: 'Skip dashboards. Ask "Show me clients who haven\'t booked in 60 days," "What was last quarter\'s no-show rate?", "Who\'s lapsed but used to come monthly?" — get instant answers backed by your real data.',
  },
  {
    icon: '✍️',
    title: 'AI-drafted marketing copy',
    body: 'On-brand Instagram captions, post ideas, ad copy, and promo blurbs — drawn from your salon\'s own profile and ready to drop into a post or campaign. Most platforms charge a four-figure monthly add-on for this; we include it in the AI Pack.',
  },
  {
    icon: '🩹',
    title: 'Conflict-resolution drafts',
    body: 'A tech calls out and you see ranked coverage suggestions to apply with a click. For the slots you can\'t cover, AI drafts a warm apology + reschedule message — complete with a self-service rebooking link — for each affected client, ready for you to review and send by email or text.',
  },
  {
    icon: '🔄',
    title: 'Rebook & win-back',
    body: 'Prompt every client to book their next visit right at checkout — with a suggested date based on the service\'s typical interval. Lapsed clients who haven\'t returned in a while get an automatic win-back email. (SMS reminders and per-client cadence are on the way.)',
  },
];

export default function AISection() {
  return (
    <Section
      id="ai"
      eyebrow="The AI advantage"
      title="A platform that does the busywork."
      subtitle="We embedded AI across the stack — not as a chatbot bolted to the side, but as a real tool that can read your data, draft your messages, and book your appointments."
      dark
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))',
        gap: 16,
      }}>
        {AI_FEATURES.map(f => <AICard key={f.title} {...f} />)}
      </div>

      <div style={{
        marginTop: 56, padding: '28px 32px',
        background: 'rgba(255,255,255,.04)',
        border: '1px solid rgba(255,255,255,.08)',
        borderRadius: radius.lg,
        display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: FONT.display, fontSize: 22, fontWeight: 600, marginBottom: 4 }}>
            See the AI live in 10 minutes.
          </div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,.65)' }}>
            We'll demo with your real data, anonymized. No commitment.
          </div>
        </div>
        <a href="#contact" style={{
          padding: '13px 26px', fontSize: 14, fontWeight: 600,
          color: '#fff', background: grad.primary,
          borderRadius: 999, textDecoration: 'none',
          boxShadow: shadow.brand, whiteSpace: 'nowrap',
        }}>Schedule the demo →</a>
      </div>
    </Section>
  );
}

function AICard({ icon, title, body }) {
  return (
    <div style={{
      padding: 24,
      background: 'rgba(255,255,255,.04)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: radius.md,
      transition: 'background .15s, border-color .15s',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,.07)';
        e.currentTarget.style.borderColor = 'rgba(139,111,196,.4)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,.04)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)';
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 14 }}>{icon}</div>
      <h3 style={{
        fontFamily: FONT.body, fontSize: 16, fontWeight: 700,
        margin: '0 0 8px', color: '#fff',
      }}>{title}</h3>
      <p style={{ fontSize: 14, lineHeight: 1.55, color: 'rgba(255,255,255,.65)', margin: 0 }}>{body}</p>
    </div>
  );
}
