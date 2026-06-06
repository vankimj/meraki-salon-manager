// Rebuilds plumenexus/public/og-image.svg with the new feather-rosette mark.
// The mark uses userSpaceOnUse gradients, so it is injected as nested <svg> viewports
// (0 0 64 64) so the gradients map to the mark's local space, not the 1200x630 canvas.
// Run: node brand/build-og.cjs
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rosetteSvg = fs.readFileSync(path.join(__dirname, 'plumenexus-rosette.svg'), 'utf8');
// strip outer <svg ...> ... </svg> to get inner defs+group
const INNER = rosetteSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
const nested = (size) => `<svg x="0" y="0" width="${size}" height="${size}" viewBox="0 0 64 64">${INNER}</svg>`;

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f1923"/>
      <stop offset="55%" stop-color="#1a1230"/>
      <stop offset="100%" stop-color="#2a1a4a"/>
    </linearGradient>
    <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6a4fa0"/>
      <stop offset="100%" stop-color="#2a9d8f"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#a288c9"/>
      <stop offset="100%" stop-color="#5db5e6"/>
    </linearGradient>
    <radialGradient id="glow1" cx="0.85" cy="0.15" r="0.7">
      <stop offset="0%" stop-color="rgba(109,76,184,.45)"/>
      <stop offset="100%" stop-color="rgba(109,76,184,0)"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.1" cy="0.85" r="0.7">
      <stop offset="0%" stop-color="rgba(42,157,143,.28)"/>
      <stop offset="100%" stop-color="rgba(42,157,143,0)"/>
    </radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="40"/></filter>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>

  <g stroke="rgba(255,255,255,0.04)" stroke-width="1">
    <line x1="0" y1="200" x2="1200" y2="200"/>
    <line x1="0" y1="400" x2="1200" y2="400"/>
    <line x1="400" y1="0" x2="400" y2="630"/>
    <line x1="800" y1="0" x2="800" y2="630"/>
  </g>

  <!-- Logo lockup, top-left -->
  <g transform="translate(80, 78)">
    ${nested(64)}
    <text x="84" y="42" font-family="Cinzel, Georgia, serif" font-size="30" font-weight="700" letter-spacing="3" fill="#fff">PLUME</text>
    <text x="218" y="42" font-family="Cinzel, Georgia, serif" font-size="30" font-weight="700" letter-spacing="3" fill="#f3da90">NEXUS</text>
  </g>

  <!-- Eyebrow chip -->
  <g transform="translate(80, 200)">
    <rect width="320" height="36" rx="18" fill="rgba(162,136,201,.16)" stroke="rgba(162,136,201,.4)" stroke-width="1"/>
    <circle cx="20" cy="18" r="4" fill="#5eeb95"/>
    <text x="36" y="23" font-family="Inter, -apple-system, sans-serif" font-size="13" font-weight="600" letter-spacing="1.2" fill="#a288c9">IN PRODUCTION · COLUMBUS, OH</text>
  </g>

  <!-- Main headline -->
  <g transform="translate(80, 270)">
    <text font-family="Cinzel, Georgia, serif" font-size="72" font-weight="700" fill="#fff" letter-spacing="-1">
      <tspan x="0" dy="0">The salon platform</tspan>
      <tspan x="0" dy="86" font-family="Great Vibes, cursive" font-weight="400" font-size="92" fill="url(#accent)">built by salon owners.</tspan>
    </text>
  </g>

  <!-- Sub line -->
  <g transform="translate(80, 510)">
    <text font-family="Inter, -apple-system, sans-serif" font-size="22" fill="rgba(255,255,255,.7)" font-weight="400">Scheduling · POS · Two-way messaging · Marketing · AI-powered reports</text>
  </g>

  <!-- Domain badge bottom-right -->
  <g transform="translate(1040, 570)">
    <text text-anchor="end" font-family="Inter, -apple-system, sans-serif" font-size="16" font-weight="600" fill="rgba(255,255,255,.5)" letter-spacing="1">plumenexus.com</text>
  </g>

  <!-- Decorative orb with the mark -->
  <circle cx="1020" cy="180" r="140" fill="url(#logoGrad)" opacity="0.12" filter="url(#blur)"/>
  <circle cx="1020" cy="180" r="60" fill="url(#logoGrad)" opacity="0.18"/>
  <g transform="translate(960, 120)">
    <rect width="120" height="120" rx="24" fill="url(#logoGrad)"/>
    ${nested(120)}
  </g>
</svg>
`;

fs.writeFileSync(path.join(ROOT, 'plumenexus/public/og-image.svg'), og);
console.log('wrote plumenexus/public/og-image.svg with feather-rosette mark');
