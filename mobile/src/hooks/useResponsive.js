import { useWindowDimensions, Platform } from 'react-native';

// One source of truth for layout breakpoints. iPhone stays first-class: at
// phone widths everything renders exactly as before; tablet styling kicks in on
// iPads and wide screens. `columns` is a convenience for grids, and
// `contentMaxWidth` caps + centers content so it doesn't stretch edge-to-edge.
const TABLET_BP = 768;

export default function useResponsive() {
  const { width, height } = useWindowDimensions();
  // ALL iPads count as tablets — including the iPad mini (744pt wide in
  // portrait) and Split View (narrower than the window), both BELOW the width
  // breakpoint. Platform.isPad is true for every iPad; Android has no isPad so
  // it falls back to width there. This is what routes the POS to the Bluetooth
  // card reader instead of Tap to Pay on iPhone.
  const isPad = Platform.OS === 'ios' && Platform.isPad;
  const isTablet   = isPad || width >= TABLET_BP;
  const isLandscape = width > height;
  return {
    width,
    height,
    isTablet,
    isLandscape,
    // grid columns: 2 on phone, 3 on iPad portrait, 4 on iPad landscape.
    columns: !isTablet ? 2 : (isLandscape ? 4 : 3),
    // cap form/list content so it reads well centered on a wide screen.
    contentMaxWidth: isTablet ? 760 : undefined,
  };
}
