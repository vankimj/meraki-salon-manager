import { memo, useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';

// Pure-JS QR (qrcode-generator) rendered via react-native-svg — no native module,
// so it ships over-the-air. One <Path> for all dark modules keeps it light.
//
// The matrix + path build is O(modules²) and was previously re-run on EVERY
// parent render. On the kiosk checkout (one Venmo QR per tech) that meant every
// button tap re-generated all the QRs synchronously — the source of the tap
// lag. useMemo keys the build on value+size, and memo() skips the component
// entirely when props are unchanged, so a QR only recomputes when it changes.
function QRCode({ value, size = 200, color = '#0f1923', bg = '#ffffff' }) {
  const d = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(String(value || ' '));
    qr.make();
    const count = qr.getModuleCount();
    const cell = size / count;
    let path = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          const x = +(c * cell).toFixed(2);
          const y = +(r * cell).toFixed(2);
          const s = +cell.toFixed(2);
          path += `M${x} ${y}h${s}v${s}h${-s}z`;
        }
      }
    }
    return path;
  }, [value, size]);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Rect width={size} height={size} fill={bg} />
      <Path d={d} fill={color} />
    </Svg>
  );
}

export default memo(QRCode);
