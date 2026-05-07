export function clean(val) {
  return (val || '').trim().replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
}

export function normURL(u) {
  u = (u || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Escape a string for safe interpolation into HTML markup. Use anywhere
// user-controlled text is concatenated into raw HTML (document.write,
// innerHTML, email template strings, etc.). React JSX auto-escapes by
// default — only use this for the unsafe-by-design code paths.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

export function phSVG(color) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">
    <rect width="300" height="400" fill="${color}"/>
    <circle cx="150" cy="140" r="60" fill="rgba(255,255,255,.15)"/>
    <ellipse cx="150" cy="320" rx="100" ry="70" fill="rgba(255,255,255,.1)"/>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

// Parse TIFF/DNG structure to extract the largest embedded JPEG preview
async function extractJpegFromRaw(blob) {
  const buf   = await blob.arrayBuffer();
  const view  = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const magic = (bytes[0] << 8) | bytes[1];
  if (magic !== 0x4949 && magic !== 0x4D4D) throw new Error('Not a valid DNG/TIFF file');
  const le = magic === 0x4949;

  let bestOffset = 0, bestLen = 0;
  const visited = new Set();

  function tryUpdate(off, len) {
    if (off > 0 && len > 0 && len > bestLen && off + len <= buf.byteLength &&
        bytes[off] === 0xFF && bytes[off + 1] === 0xD8) {
      bestOffset = off; bestLen = len;
    }
  }

  function parseIfd(offset) {
    if (!offset || offset + 2 > buf.byteLength || visited.has(offset)) return;
    visited.add(offset);

    let count;
    try { count = view.getUint16(offset, le); } catch { return; }
    if (count === 0 || count > 2000) return;

    let jpegOff = 0, jpegLen = 0;
    let compression = 0, stripOff = 0, stripLen = 0;

    for (let i = 0; i < count; i++) {
      const e = offset + 2 + i * 12;
      if (e + 12 > buf.byteLength) break;

      const tag = view.getUint16(e, le);
      const cnt = view.getUint32(e + 4, le);

      if (tag === 0x0103) compression = view.getUint16(e + 8, le);
      if (tag === 0x0201) jpegOff = view.getUint32(e + 8, le);
      if (tag === 0x0202) jpegLen = view.getUint32(e + 8, le);
      // StripOffsets / StripByteCounts — single-strip preview JPEG
      if (tag === 0x0111 && cnt === 1) stripOff = view.getUint32(e + 8, le);
      if (tag === 0x0117 && cnt === 1) stripLen = view.getUint32(e + 8, le);

      // SubIFD (0x014A) — may hold multiple sub-directories
      if (tag === 0x014A) {
        if (cnt === 1) {
          parseIfd(view.getUint32(e + 8, le));
        } else {
          const arrBase = view.getUint32(e + 8, le);
          for (let k = 0; k < cnt && arrBase + k * 4 + 4 <= buf.byteLength; k++)
            parseIfd(view.getUint32(arrBase + k * 4, le));
        }
      }
      // ExifIFD (0x8769) and GPS IFD (0x8825)
      if (tag === 0x8769 || tag === 0x8825) parseIfd(view.getUint32(e + 8, le));
    }

    tryUpdate(jpegOff, jpegLen);
    // Strip-based JPEG preview (compression 6=JPEG, 34892=LossyJPEG used by DNG)
    if (compression === 6 || compression === 7 || compression === 34892)
      tryUpdate(stripOff, stripLen);

    const nextOff = offset + 2 + count * 12;
    if (nextOff + 4 <= buf.byteLength) parseIfd(view.getUint32(nextOff, le));
  }

  if (buf.byteLength >= 8) parseIfd(view.getUint32(4, le));

  // Fallback: O(n) scan for embedded standard JPEG (FF D8 FF E1 Exif or FF D8 FF E0 JFIF).
  // Raw tile data in DNG uses lossless JPEG (FF D8 FF F7) which is excluded by the E0/E1 filter.
  if (!bestLen) {
    for (let i = 0; i < bytes.length - 3; i++) {
      if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF &&
          (bytes[i + 3] === 0xE1 || bytes[i + 3] === 0xE0)) {
        for (let j = i + 4; j < bytes.length - 1; j++) {
          if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
            const len = j + 2 - i;
            if (len > bestLen) { bestOffset = i; bestLen = len; }
            i = j; // advance outer loop past this JPEG (for loop does i++ → j+1)
            break;
          }
        }
      }
    }
  }

  if (!bestLen) throw new Error('No JPEG preview found in DNG file');
  return new Blob([new Uint8Array(buf, bestOffset, bestLen)], { type: 'image/jpeg' });
}

async function toJpegBlob(blob) {
  const t = blob.type;
  if (t === 'image/heic' || t === 'image/heif') {
    const heic2any = (await import('heic2any')).default;
    const result   = await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 });
    return Array.isArray(result) ? result[0] : result;
  }
  if (t.includes('dng') || t.includes('raw') || t === 'image/tiff') {
    return extractJpegFromRaw(blob);
  }
  return blob;
}

export async function resizeImg(src, maxW, maxH, quality) {
  let blob = src instanceof Blob ? src : await fetch(src).then(r => r.blob());
  blob = await toJpegBlob(blob);

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        const ar = w / h;
        if (w > maxW) { w = maxW; h = Math.round(w / ar); }
        if (h > maxH) { h = maxH; w = Math.round(h * ar); }
        const c   = document.createElement('canvas');
        c.width   = Math.max(1, Math.round(w));
        c.height  = Math.max(1, Math.round(h));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      } catch (err) { URL.revokeObjectURL(url); reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img-onerror: type=' + blob.type + ' size=' + blob.size)); };
    img.src = url;
  });
}

export const QR_SIZE = 148;

export const PLACEHOLDER_COLORS = ['#4A7DB5', '#2D7A5F', '#7B5EA7', '#C0622F', '#2A8A8A'];
