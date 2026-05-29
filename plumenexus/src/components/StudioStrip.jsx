import { C, FONT } from '../theme.js';
import EditorialPhoto from './EditorialPhoto.jsx';

// Editorial photo strip — establishes the brand's connection to actual
// craft work, not stock SaaS aesthetics. Photos are processed in
// /scripts/process-photos.cjs and committed to /public/photos/. Each
// EditorialPhoto already has CSS-level grain; the underlying JPGs also
// have a baked-in soft-light grain layer from the pipeline.
export default function StudioStrip() {
  return (
    <section style={{
      background: C.bgSoft,
      borderTop: `1px solid ${C.ruleSoft}`,
      borderBottom: `1px solid ${C.ruleSoft}`,
      padding: '110px 28px',
    }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>

        <header style={{ marginBottom: 64, maxWidth: 740 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: C.goldDeep,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            marginBottom: 16,
          }}>
            I · The craft
          </div>
          <h2 style={{
            fontFamily: FONT.display,
            fontSize: 'clamp(30px, 4vw, 52px)',
            lineHeight: 1.1,
            letterSpacing: '-0.015em',
            margin: 0, color: C.ink, fontWeight: 400,
          }}>
            Software for the work
            <span style={{ fontStyle: 'italic', fontWeight: 400, color: C.muted }}> that lives on the hand.</span>
          </h2>
          <p style={{
            marginTop: 22, maxWidth: 580,
            fontSize: 17, lineHeight: 1.65, color: C.muted,
          }}>
            Plume Nexus runs Meraki Nail Studio in Columbus, Ohio — a
            10-tech salon — before it ships to anyone else. Every release
            sits next to the work it serves.
          </p>
        </header>

        {/* Magazine spread: tall left + two stacked details on the right */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 24,
        }} className="pn-studio-grid">
          <EditorialPhoto
            src="/photos/studio-primary.jpg"
            alt="Sculpted gold-line manicure"
            aspect="4 / 3"
            treatment="full"
            caption="Studio work · Spring capsule"
          />
          <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 24 }}>
            <EditorialPhoto
              src="/photos/detail-light.jpg"
              alt="Hand resting against natural light"
              aspect="4 / 5"
              treatment="full"
            />
            <EditorialPhoto
              src="/photos/detail-natural.jpg"
              alt="Natural French — refined"
              aspect="4 / 5"
              treatment="full"
            />
          </div>
        </div>

        {/* Footnote row — small accent + showcase */}
        <div style={{
          marginTop: 24,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)',
          gap: 24,
          alignItems: 'stretch',
        }} className="pn-studio-grid">
          <EditorialPhoto
            src="/photos/accent-red.jpg"
            alt="Cherry detail"
            aspect="1 / 1"
            treatment="full"
          />
          <EditorialPhoto
            src="/photos/showcase-heart.jpg"
            alt="St. Valentine campaign · 2026"
            aspect="3 / 4"
            treatment="full"
            caption="Seasonal · 2026"
          />
        </div>
      </div>

      <style>{`
        @media (max-width: 820px) {
          .pn-studio-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
