import Svg, { Path, Circle, Rect, Polyline } from 'react-native-svg';

// Reusable inline SVG icons. Used in tab bar, empty states, and any
// place where emoji glyphs would be unreliable (iOS 26 simulator
// drops Apple Color Emoji and renders ? boxes; SDK 54 dev clients
// can also have intermittent issues with @expo/vector-icons fonts).
//
// Stroke = 2 with rounded caps, viewBox 0 0 24 24 — Lucide-style.
// Pass `size` and `color` props (color falls back to currentColor for
// flexibility, though RN doesn't honor that — pass an explicit color).
export default function Icon({ name, size = 24, color = '#666', strokeWidth = 2 }) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  switch (name) {
    case 'calendar':
      return <Svg {...props}><Rect x="3" y="4" width="18" height="18" rx="2" /><Path d="M16 2v4M8 2v4M3 10h18" /></Svg>;
    case 'dollar':
      return <Svg {...props}><Path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></Svg>;
    case 'people':
      return <Svg {...props}><Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><Circle cx="9" cy="7" r="4" /></Svg>;
    case 'chat':
      return <Svg {...props}><Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></Svg>;
    case 'person':
      return <Svg {...props}><Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><Circle cx="12" cy="7" r="4" /></Svg>;
    case 'sparkles':
      return <Svg {...props}><Path d="M12 3v18M3 12h18M5 5l14 14M19 5L5 19" /></Svg>;
    case 'check':
      return <Svg {...props}><Polyline points="20 6 9 17 4 12" /></Svg>;
    case 'pin':
      return <Svg {...props}><Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><Circle cx="12" cy="10" r="3" /></Svg>;
    case 'phone':
      return <Svg {...props}><Path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></Svg>;
    case 'mail':
      return <Svg {...props}><Path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><Polyline points="22,6 12,13 2,6" /></Svg>;
    case 'grid':
      return <Svg {...props}><Rect x="3" y="3" width="7" height="7" rx="1" /><Rect x="14" y="3" width="7" height="7" rx="1" /><Rect x="3" y="14" width="7" height="7" rx="1" /><Rect x="14" y="14" width="7" height="7" rx="1" /></Svg>;
    case 'scissors':
      return <Svg {...props}><Circle cx="6" cy="6" r="3" /><Circle cx="6" cy="18" r="3" /><Path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" /></Svg>;
    case 'box':
      return <Svg {...props}><Path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><Polyline points="3.27 6.96 12 12.01 20.73 6.96" /><Path d="M12 22.08V12" /></Svg>;
    case 'clock':
      return <Svg {...props}><Circle cx="12" cy="12" r="9" /><Path d="M12 7v5l3 2" /></Svg>;
    case 'gift':
      return <Svg {...props}><Polyline points="20 12 20 22 4 22 4 12" /><Rect x="2" y="7" width="20" height="5" /><Path d="M12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></Svg>;
    case 'star':
      return <Svg {...props}><Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" /></Svg>;
    case 'idcard':
      return <Svg {...props}><Rect x="2" y="4" width="20" height="16" rx="2" /><Circle cx="8" cy="10" r="2" /><Path d="M14 8h4M14 12h4M6 16h6" /></Svg>;
    case 'walk':
      return <Svg {...props}><Circle cx="12" cy="4" r="2" /><Path d="M12 6v6M12 12l-3 4M12 12l3 4M9 9l3 1 3-1" /></Svg>;
    case 'users':
      return <Svg {...props}><Rect x="2" y="3" width="20" height="14" rx="2" /><Path d="M8 21l4-4 4 4" /></Svg>;
    case 'chart':
      return <Svg {...props}><Path d="M3 3v18h18" /><Rect x="7" y="12" width="3" height="6" /><Rect x="13" y="8" width="3" height="10" /></Svg>;
    case 'megaphone':
      return <Svg {...props}><Path d="M3 10v4a1 1 0 0 0 1 1h3l8 5V4L7 9H4a1 1 0 0 0-1 1z" /><Path d="M18 8a4 4 0 0 1 0 8" /></Svg>;
    case 'briefcase':
      return <Svg {...props}><Rect x="2" y="7" width="20" height="14" rx="2" /><Path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20" /></Svg>;
    case 'trash':
      return <Svg {...props}><Path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" /></Svg>;
    default:
      return null;
  }
}
