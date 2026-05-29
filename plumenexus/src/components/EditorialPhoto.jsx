import { C, EASE, DUR } from '../theme.js';

// Editorial photo treatment used across the marketing site. Pass any raw
// JPG/PNG (from /public/photos/) and it renders with:
//   - aspect ratio constraint (default 16:9)
//   - optional B&W or muted treatment via CSS filter
//   - subtle film-grain overlay (4% opacity) for tactility
//   - slow reveal-on-mount via CSS transition
//
// treatment: 'bw' | 'muted' | 'duotone' | 'full'
//   bw      — full grayscale + slight contrast lift
//   muted   — desat 60%, contrast +5%, brightness -3% (the most flexible
//             default for mixed photography)
//   duotone — grayscale + plum/gold tint via mix-blend-mode overlay
//   full    — untouched colour, just grain
//
// If `src` is missing or 404s we render a clearly-marked placeholder so
// it's obvious where photography still needs to land.
export default function EditorialPhoto({
  src,
  alt = '',
  aspect = '16 / 9',
  treatment = 'muted',
  rounded = 0,
  caption = '',
}) {
  const filter = {
    bw:      'grayscale(1) contrast(1.05) brightness(.98)',
    muted:   'saturate(.65) contrast(1.04) brightness(.98)',
    duotone: 'grayscale(1) contrast(1.08)',
    full:    'none',
  }[treatment] || 'none';

  return (
    <figure style={{ margin: 0 }}>
      <div style={{
        position: 'relative',
        aspectRatio: aspect,
        overflow: 'hidden',
        borderRadius: rounded,
        background: C.bgCream,
      }}>
        {src ? (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover',
              display: 'block',
              filter,
              transition: `transform ${DUR.slow} ${EASE}`,
            }}
            onError={(e) => { e.currentTarget.style.opacity = '0'; }}
          />
        ) : (
          <PhotoPlaceholder alt={alt} />
        )}

        {treatment === 'duotone' && (
          <div aria-hidden="true" style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(135deg, ${C.plumDeep}, ${C.gold})`,
            mixBlendMode: 'color',
            opacity: 0.55,
          }} />
        )}

        {/* Film grain overlay — pure SVG fractal noise, ~4% strength */}
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0,
          opacity: 0.06,
          mixBlendMode: 'multiply',
          backgroundImage: GRAIN_DATA_URI,
          backgroundSize: '200px 200px',
          pointerEvents: 'none',
        }} />
      </div>
      {caption && (
        <figcaption style={{
          marginTop: 14,
          fontSize: 12,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: C.muted,
          fontStyle: 'italic',
        }}>{caption}</figcaption>
      )}
    </figure>
  );
}

function PhotoPlaceholder({ alt }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 8,
      background: `linear-gradient(135deg, ${C.bgCream}, ${C.bgSoft})`,
      color: C.mutedSoft,
      fontSize: 12,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ fontSize: 20, opacity: 0.4 }}>◌</div>
      <div>Photo coming soon</div>
      {alt && <div style={{ fontSize: 10, color: C.mutedSoft, opacity: 0.7, textTransform: 'none', letterSpacing: 0 }}>{alt}</div>}
    </div>
  );
}

// Inline SVG fractal-noise data URI. Keeps everything in JS — no extra
// asset to load. Generated once; reused as a CSS background-image.
const GRAIN_DATA_URI =
  `url("data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>` +
      `<filter id='n'>` +
        `<feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>` +
        `<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'/>` +
      `</filter>` +
      `<rect width='200' height='200' filter='url(%23n)' opacity='0.85'/>` +
    `</svg>`
  ) + `")`;
