// Plume Nexus brand tokens. Premium, multi-industry feel.
// Anchors: deep ink-blue (trust), soft plum (the "plume"), warm cream (lift).

// ── Founders' Year ──────────────────────────────────────────────
// PLACEHOLDER — adjust when actual launch date is set. Founders' Members
// who sign up before this date get free Solo for life. After this date,
// Solo becomes a paid tier for new signups.
export const FOUNDERS_YEAR_END_ISO  = '2027-06-30';
export const FOUNDERS_YEAR_END_LONG = 'June 30, 2027';

// Palette warmed 2026-05-15 for premium / editorial feel. Tokens kept
// (callers unchanged); values shifted toward bone, oat, and warm ink to
// pull the site away from cool tech-startup and toward Aesop / luxury
// magazine. Plum + blue + gold accents preserved.
export const C = {
  ink:        '#1a1410',   // warm near-black (was cool #0f1923)
  inkSoft:    '#2a221c',
  text:       '#2a221c',
  muted:      '#6b6258',
  mutedSoft:  '#9a9286',
  rule:       '#d8d2c6',   // warm hairline (was lavender #e7e3ee)
  ruleSoft:   '#ebe5d8',
  bg:         '#fbf8f1',   // bone (was pure #ffffff)
  bgSoft:     '#f6f2ea',   // oat
  bgCream:    '#efe9dc',   // deeper cream
  plum:       '#6a4fa0',
  plumDeep:   '#3f2767',
  plumSoft:   '#8b6fc4',
  blue:       '#3d95ce',
  blueDeep:   '#1f6ea3',
  teal:       '#2a9d8f',
  gold:       '#c19a4a',
  goldDeep:   '#9c7a32',
  success:    '#2D7A5F',
  danger:     '#ef4444',
};

export const FONT = {
  display: "'Fraunces', Georgia, serif",   // editorial serif, variable (was Cinzel)
  script:  "'Great Vibes', cursive",
  body:    "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

// Editorial easing — slow, intentional. Use as `transition: <prop> var(--pn-dur) var(--pn-ease);`
// or directly in inline styles. Globals are set in index.html <style>.
export const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const DUR  = { fast: '350ms', base: '700ms', slow: '1000ms' };

export const grad = {
  primary:  `linear-gradient(135deg, ${C.plum}, ${C.blue})`,
  primaryDeep: `linear-gradient(135deg, ${C.plumDeep}, ${C.blueDeep})`,
  ink:      `linear-gradient(135deg, ${C.ink}, ${C.inkSoft})`,
  cream:    `linear-gradient(180deg, #ffffff 0%, ${C.bgCream} 100%)`,
};

export const shadow = {
  sm: '0 2px 8px rgba(15,25,35,.05)',
  md: '0 8px 24px rgba(15,25,35,.08)',
  lg: '0 16px 48px rgba(15,25,35,.12)',
  brand: '0 12px 36px rgba(106,79,160,.25)',
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  xl: 32,
};
