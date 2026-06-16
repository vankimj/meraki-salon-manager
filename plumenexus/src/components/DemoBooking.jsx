import { useEffect } from 'react';
import Cal, { getCalApi } from '@calcom/embed-react';
import { C, FONT, grad, shadow, radius } from '../theme.js';
import Section from './Section.jsx';

// Cal.com booking, deep-linked to ONE event type so visitors land straight on
// the calendar (skipping the generic event-type picker). Brand-matched to the
// site's plum via getCalApi. To swap the event, change CAL_LINK to
// "<handle>/<event-slug>"; to switch providers, replace the embed entirely.
const CAL_LINK         = 'jonathan-vankim-huyzoh/30min';
const CAL_BOOKING_PAGE = 'https://cal.com/jonathan-vankim-huyzoh';
const CAL_BRAND        = '#6a4fa0'; // brand plum
const IS_PLACEHOLDER   = !CAL_LINK.trim();

const POINTS = [
  { icon: '🎙️', title: 'Live AI walkthrough',     body: 'See voice-command booking, AI reports, and the time-off and off-hours warnings that keep the schedule honest.' },
  { icon: '📊', title: 'Migration plan',          body: 'We map your current setup to Plume Nexus modules in real time.' },
  { icon: '💬', title: 'Q&A with the founder',    body: 'Honest answers about gaps, roadmap, pricing, integrations.' },
  { icon: '🎁', title: 'Custom 30-day trial',     body: "You leave with a 30-day trial sandbox. On GlossGenius? We can load your exported data live on the call; from other platforms we hand-import it within one business day." },
];

export default function DemoBooking() {
  return (
    <Section
      id="demo"
      eyebrow="Book a demo"
      title="20 minutes. No slide deck."
      subtitle="A live walkthrough with the founder — built by a salon owner for his own 10-tech studio. No sales engineer, no scripted pitch — just answers."
    >
      {/* What you'll get — a row of points above the calendar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 22,
        maxWidth: 1000, margin: '0 auto 40px',
      }}>
        {POINTS.map(p => (
          <div key={p.title} style={{ display: 'flex', gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: `${C.plum}10`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0,
            }}>{p.icon}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 2 }}>{p.title}</div>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{p.body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Cal.com embed (or fallback) — full width so the month calendar has room
          to show its time-slot column side by side. */}
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <BookingEmbed />
      </div>

      <div style={{
        maxWidth: 920, margin: '18px auto 0', textAlign: 'center',
        fontSize: 13, color: C.muted, lineHeight: 1.55,
      }}>
        <strong style={{ color: C.plum }}>Can't find a time?</strong> Use the{' '}
        <a href="#contact" style={{ color: C.plum, fontWeight: 600 }}>contact form</a> instead —
        we'll work around your schedule.
      </div>
    </Section>
  );
}

function BookingEmbed() {
  // Brand-match the Cal.com embed to the site's plum + a clean month layout.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cal = await getCalApi({ namespace: 'pn-demo' });
        if (cancelled) return;
        cal('ui', {
          styles: { branding: { brandColor: CAL_BRAND } },
          hideEventTypeDetails: false,
          layout: 'column_view',
        });
      } catch { /* the link fallback below covers a script-load failure */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (IS_PLACEHOLDER) {
    // Fallback card (only renders if CAL_LINK is unset) — routes to the form.
    return (
      <div style={{
        background: '#fff',
        border: `1px solid ${C.rule}`,
        borderRadius: radius.lg,
        boxShadow: shadow.md,
        padding: 36,
        textAlign: 'center',
        minHeight: 460,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: grad.primary,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 30, marginBottom: 18,
        }}>📅</div>
        <h3 style={{
          fontFamily: FONT.display, fontSize: 22, fontWeight: 600,
          margin: '0 0 10px', color: C.ink,
        }}>Pick a time that works.</h3>
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, margin: '0 0 24px', maxWidth: 360 }}>
          We'll send you a Google Calendar invite with the meeting link.
          Most demos are 20–30 minutes.
        </p>
        <a
          href="#contact"
          style={{
            padding: '13px 26px', fontSize: 15, fontWeight: 600,
            color: '#fff', background: grad.primary,
            borderRadius: 999, textDecoration: 'none',
            boxShadow: shadow.brand,
          }}
        >
          Request a time
        </a>
      </div>
    );
  }

  // Cal.com inline embed — brand-matched, deep-linked to one event so it lands
  // straight on the calendar.
  return (
    <div>
      <div style={{
        background: '#fff',
        border: `1px solid ${C.rule}`,
        borderRadius: radius.lg,
        boxShadow: shadow.md,
        overflow: 'hidden',
        minHeight: 720,
      }}>
        <Cal
          namespace="pn-demo"
          calLink={CAL_LINK}
          config={{ layout: 'column_view' }}
          style={{ width: '100%', height: 720, overflow: 'auto' }}
        />
      </div>
      <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: C.mutedSoft }}>
        Calendar not loading?{' '}
        <a href={CAL_BOOKING_PAGE} target="_blank" rel="noopener noreferrer" style={{ color: C.plum, fontWeight: 600 }}>
          Open the booking page →
        </a>
      </div>
    </div>
  );
}
