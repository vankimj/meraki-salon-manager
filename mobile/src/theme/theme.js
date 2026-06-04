// Semantic color tokens for light + dark mode. Screens reference these
// (via useTheme()) instead of hardcoding hex, so the whole app re-colors
// from one place. Brand hues (green/blue/teal) stay constant; only the
// neutrals (backgrounds, surfaces, text, borders) flip between modes.

const BRAND = {
  green: '#2D7A5F',
  blue:  '#3D95CE',
  teal:  '#3D9E8A',
};

export const lightTheme = {
  mode: 'light',
  ...BRAND,
  // Brand tints usable as fills on light surfaces.
  greenSoft: '#eef5f2',
  blueSoft:  '#e8f2fb',
  // Neutrals
  bg:          '#f5f7fa',   // app background
  surface:     '#ffffff',   // cards, rows, sheets
  surfaceAlt:  '#f6f7f9',   // inputs, subtle fills
  surfaceMuted:'#f1f3f5',   // chips, secondary fills
  text:        '#1a1a1a',   // primary text
  textMuted:   '#8a8a8a',   // secondary text
  textFaint:   '#aaaaaa',   // hints, placeholders
  border:      '#ececec',
  borderStrong:'#d8d8d8',
  // Semantic
  danger:   '#c0392b',
  dangerBg: '#fdecea',
  success:  '#16a34a',
  warning:  '#c47d2e',
  warningBg:'#fdf2e6',
  // Chrome
  overlay:    'rgba(0,0,0,0.4)',
  headerBg:   '#ffffff',
  navBar:     '#ffffff',
  shadow:     '#000000',
  placeholder:'#bbbbbb',
};

export const darkTheme = {
  mode: 'dark',
  ...BRAND,
  // On dark, brand greens/blues read better a touch lighter for text/icons.
  green: '#4FB892',
  blue:  '#5BAEE0',
  greenSoft: '#13332a',
  blueSoft:  '#11283a',
  // Neutrals
  bg:          '#0f1419',
  surface:     '#1a2027',
  surfaceAlt:  '#232b34',
  surfaceMuted:'#2a323c',
  text:        '#f1f3f5',
  textMuted:   '#9aa3ad',
  textFaint:   '#6b7480',
  border:      '#2a323c',
  borderStrong:'#3a434e',
  // Semantic
  danger:   '#ef5350',
  dangerBg: '#3a1f1d',
  success:  '#34d27e',
  warning:  '#e0a64a',
  warningBg:'#3a2c18',
  // Chrome
  overlay:    'rgba(0,0,0,0.6)',
  headerBg:   '#1a2027',
  navBar:     '#1a2027',
  shadow:     '#000000',
  placeholder:'#5b636d',
};

export function themeFor(scheme) {
  return scheme === 'dark' ? darkTheme : lightTheme;
}
