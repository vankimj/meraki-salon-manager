import { C, FONT, grad, radius, shadow } from '../theme.js';
import Section from './Section.jsx';

// No fabricated testimonials. Plume Nexus is pre-launch with no customers yet —
// real quotes from real owners land here as the founding cohort goes live. An
// invented quote is worse than an honest blank.
export default function Testimonials() {
  return (
    <Section
      eyebrow="Founding cohort"
      title="No customer quotes yet — and we won't fake them."
      subtitle="Plume Nexus is pre-launch. Real stories from real salon owners will live here as our founding cohort goes live. We'd rather show you an honest blank than a stock photo with a made-up name."
    >
      <div style={{
        maxWidth: 720, margin: '0 auto', textAlign: 'center',
        background: '#fff', border: `1px solid ${C.rule}`,
        borderRadius: radius.lg, boxShadow: shadow.sm,
        padding: '44px 32px',
      }}>
        <div style={{ fontFamily: FONT.display, fontSize: 56, lineHeight: 0.5, color: C.plumSoft, marginBottom: 16 }}>"</div>
        <p style={{ fontSize: 19, lineHeight: 1.6, color: C.text, fontStyle: 'italic', margin: '0 0 26px' }}>
          Be one of the salons whose story goes here. Founding members get Solo
          free for life and white-glove migration on us.
        </p>
        <a href="#demo" style={{
          display: 'inline-block', padding: '13px 28px', fontSize: 15, fontWeight: 600,
          color: '#fff', background: grad.primary, borderRadius: 999, textDecoration: 'none',
          boxShadow: shadow.brand,
        }}>
          Become a founding salon →
        </a>
      </div>
    </Section>
  );
}
