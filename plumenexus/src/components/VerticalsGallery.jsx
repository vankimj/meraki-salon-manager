import { useState } from 'react';
import { C, FONT } from '../theme.js';
import EditorialPhoto from './EditorialPhoto.jsx';

// Multi-vertical proof gallery — backs up the "every personal-services business"
// positioning with imagery beyond the founder's own nail studio. Photos are
// CC0 / public-domain (sourced via Openverse, verified watermark-free) and
// self-hosted in /public/photos/. EditorialPhoto's 'muted' treatment + film
// grain unifies the mixed sources into the site's editorial look. Each vertical
// has a pool; one is picked at random on mount, so the set re-rolls on refresh.
const VERTICALS = [
  { label: 'Barbershops',        alt: 'A barber mid-cut',            pool: ['/photos/v-barber.jpg', '/photos/v-barber-2.jpg', '/photos/v-barber-3.jpg'] },
  { label: 'Med spas',           alt: 'A relaxing facial treatment', pool: ['/photos/v-medspa.jpg'] },
  { label: 'Hair salons',        alt: 'A salon cut in progress',     pool: ['/photos/v-hair.jpg', '/photos/v-hair-2.jpg'] },
  { label: 'Pet grooming',       alt: 'Grooming day',                pool: ['/photos/v-petgroom.jpg', '/photos/v-petgroom-2.jpg', '/photos/v-petgroom-3.jpg'] },
  { label: 'Wellness & massage', alt: 'A therapeutic massage',       pool: ['/photos/v-massage.jpg', '/photos/v-massage-2.jpg', '/photos/v-massage-3.jpg'] },
];

export default function VerticalsGallery() {
  // One image per vertical, chosen on mount — re-rolls on every page refresh.
  const [picks] = useState(() => VERTICALS.map(v => v.pool[Math.floor(Math.random() * v.pool.length)]));
  return (
    <section style={{ background: '#fff', padding: '96px 28px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>

        <header style={{ maxWidth: 760, marginBottom: 48 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: C.goldDeep,
            letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 16,
          }}>
            One platform · every chair
          </div>
          <h2 style={{
            fontFamily: FONT.display,
            fontSize: 'clamp(28px, 3.6vw, 46px)',
            lineHeight: 1.12, letterSpacing: '-0.015em',
            margin: 0, color: C.ink, fontWeight: 400,
          }}>
            Nail studios were first.
            <span style={{ fontStyle: 'italic', color: C.muted }}> Not last.</span>
          </h2>
          <p style={{ marginTop: 20, maxWidth: 620, fontSize: 17, lineHeight: 1.65, color: C.muted }}>
            The same scheduling, POS, two-way messaging, and AI-powered reporting that run a
            10-tech nail studio run a barbershop, a med spa, a grooming salon, or a wellness
            studio just as well.
          </p>
        </header>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 22,
        }}>
          {VERTICALS.map((v, i) => (
            <EditorialPhoto
              key={v.label}
              src={picks[i]}
              alt={v.alt}
              aspect="3 / 4"
              treatment="muted"
              rounded={12}
              caption={v.label}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
