import { useWindowDimensions } from 'react-native';

// One source of truth for layout breakpoints. iPhone stays first-class: at
// phone widths everything renders exactly as before; tablet styling only kicks
// in at >= 768pt (iPad portrait). `columns` is a convenience for grids, and
// `contentMaxWidth` caps + centers content so it doesn't stretch edge-to-edge
// on a big screen.
const TABLET_BP = 768;

export default function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isTablet   = width >= TABLET_BP;
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
