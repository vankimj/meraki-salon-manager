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
  { icon: '🎙️', title: 'Live AI walkthrough',     body: 'See voice-command booking, AI reports, and conflict-resolution drafts on real data.' },
  { icon: '📊', title: 'Migration plan',          body: 'We map your current setup to Plume Nexus modules in real time.' },
  { icon: '💬', title: 'Q&A with the founder',    body: 'Honest answers about gaps, roadmap, pricing, integrations.' },
  { icon: '🎁', title: 'Custom 30-day trial',     body: 'You leave the call with a sandbox loaded with your data.' },
];

export default function DemoBooking() {
  return (
    <Section
      id="demo"
      eyebrow="Book a demo"
      title="20 minutes. No slide deck."
      subtitle="A live walkthrough on real salon data with the founder. No sales engineer, no scripted pitch — just answers."
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)',
        gap: 40,
        maxWidth: 1080, margin: '0 auto',
        alignItems: 'start',
      }} className="pn-demo-grid">

        {/* Left: what's included */}
        <div>
          <h3 style={{
            fontFamily: FONT.display, fontSize: 22, fontWeight: 600,
            margin: '0 0 22px', color: C.ink,
          }}>What you'll get</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {POINTS.map(p => (
              <div key={p.title} style={{ display: 'flex', gap: 14 }}>
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

          <div style={{
            marginTop: 28, padding: '14px 16px',
            background: C.bgSoft, borderRadius: radius.md,
            border: `1px solid ${C.rule}`,
            fontSize: 13, color: C.text, lineHeight: 1.55,
          }}>
            <strong style={{ color: C.plum }}>Can't find a time?</strong> Use the{' '}
            <a href="#contact" style={{ color: C.plum, fontWeight: 600 }}>contact form</a> instead —
            we'll work around your schedule.
          </div>
        </div>

        {/* Right: Cal.com embed (or fallback) */}
        <BookingEmbed />
      </div>

      <style>{`
        @media (max-width: 880px) {
          .pn-demo-grid { grid-template-columns: 1fr !important; gap: 28px !important; }
        }
      `}</style>
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
          layout: 'month_view',
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
        minHeight: 660,
      }}>
        <Cal
          namespace="pn-demo"
          calLink={CAL_LINK}
          config={{ layout: 'month_view' }}
          style={{ width: '100%', height: 660, overflow: 'auto' }}
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
