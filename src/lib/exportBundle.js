// Builds a complete data-export ZIP per Plume Nexus principle #8:
// data export is always free, on every plan, forever. This module produces:
//   - everything.json     full snapshot for re-import fidelity
//   - manifest.json       metadata about the export
//   - <collection>.csv    one CSV per collection for human/Excel use
//   - photos/             extracted image files (client.picture, employee.photo,
//                         slides[].img) — base64 data URLs unpacked to real files
//   - README.txt          plain-English explanation of what's in the bundle
//
// All client-side. No support tickets, no waiting period, no paywall.
import JSZip from 'jszip';
import { fetchAllForBackup } from './firestore';
import { TENANT_ID } from './tenant';

// ── CSV serialization ──────────────────────────────────────────────
// Cells starting with =, +, -, @, tab, or CR can be interpreted as formulas
// when the CSV is opened in Excel/Numbers/Sheets. Prefix any such cell with a
// single quote to neutralize. Defends against malicious client-name payloads
// and accidental formula triggers.
function neutralizeFormulaPrefix(s) {
  if (s.length === 0) return s;
  const c = s.charCodeAt(0);
  // = + - @ \t \r
  if (c === 61 || c === 43 || c === 45 || c === 64 || c === 9 || c === 13) {
    return "'" + s;
  }
  return s;
}
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const j = JSON.stringify(value).replace(/"/g, '""');
    return `"${j}"`;
  }
  const safe = neutralizeFormulaPrefix(String(value));
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function rowsToCSV(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  // Union of all keys preserves columns even when some rows are sparse.
  const keys = Array.from(rows.reduce((set, r) => {
    Object.keys(r || {}).forEach(k => set.add(k));
    return set;
  }, new Set()));
  const header = keys.map(csvEscape).join(',');
  const body   = rows.map(r => keys.map(k => {
    const v = r[k];
    // Strip base64 photo blobs from CSVs — they bloat the file and aren't
    // useful in a spreadsheet. The full base64 stays in everything.json
    // and the actual image file is unpacked to /photos.
    if (typeof v === 'string' && v.startsWith('data:image/')) return '[image — see photos/]';
    return csvEscape(v);
  }).join(',')).join('\n');
  return header + '\n' + body;
}

// ── Photo extraction ───────────────────────────────────────────────
const PHOTO_FIELDS = [
  // [collection, idField, photoField, filenamePrefix]
  ['clients',   '_id', 'picture', 'client'],
  ['employees', '_id', 'photo',   'employee'],
];

function dataUrlToBytes(dataUrl) {
  try {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return null;
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    const b64 = m[2];
    // atob is fine for the photo sizes we deal with (<2MB after resize).
    // Wrap in try/catch so a single corrupt photo doesn't abort the whole export.
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return { ext, bytes };
  } catch (e) {
    console.warn('[exportBundle] skipping corrupt photo:', e?.message);
    return null;
  }
}

// ── Bundle builder ─────────────────────────────────────────────────
export async function buildExportBundle({ onProgress } = {}) {
  const progress = (msg) => onProgress && onProgress(msg);

  progress('Fetching everything…');
  const data = await fetchAllForBackup();

  progress('Building bundle…');
  const zip = new JSZip();
  const exportedAt = new Date().toISOString();
  const tenantId = TENANT_ID;

  // 1. Manifest
  const counts = {};
  Object.entries(data).forEach(([key, val]) => {
    if (Array.isArray(val)) counts[key] = val.length;
  });
  const manifest = {
    version:     1,
    exportedAt,
    tenantId,
    appVersion:  '1.0',
    description: 'Plume Nexus complete data export. See README.txt for what is in this bundle.',
    counts,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // 2. README
  zip.file('README.txt', README_TEMPLATE
    .replace('{TENANT}', tenantId)
    .replace('{DATE}', exportedAt)
    .replace('{COUNTS}', Object.entries(counts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `  ${k.padEnd(22)} ${n}`)
      .join('\n')));

  // 3. Full JSON snapshot (re-import friendly)
  zip.file('everything.json', JSON.stringify({ ...manifest, data }, null, 2));

  // 4. Per-collection CSVs
  Object.entries(data).forEach(([key, val]) => {
    if (!Array.isArray(val) || val.length === 0) return;
    const csv = rowsToCSV(val);
    if (csv) zip.file(`csv/${key}.csv`, csv);
  });

  // 5. Settings docs (each as JSON file under /settings/)
  Object.entries(data).forEach(([key, val]) => {
    if (key.startsWith('_') && val && typeof val === 'object') {
      zip.file(`settings/${key.slice(1)}.json`, JSON.stringify(val, null, 2));
    }
  });

  // 6. Photos extracted from base64 → real image files
  let photoCount = 0;
  PHOTO_FIELDS.forEach(([col, idField, photoField, prefix]) => {
    const rows = data[col];
    if (!Array.isArray(rows)) return;
    rows.forEach(row => {
      const decoded = dataUrlToBytes(row[photoField]);
      if (!decoded) return;
      const id   = row[idField] || 'unknown';
      const name = (row.name || row.firstName || '').toString().replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
      const file = `photos/${prefix}-${id}${name ? '-' + name : ''}.${decoded.ext}`;
      zip.file(file, decoded.bytes);
      photoCount += 1;
    });
  });
  // Slides also carry images
  const slidesArr = (data._slides && Array.isArray(data._slides.slides)) ? data._slides.slides : [];
  slidesArr.forEach((s, i) => {
    const decoded = dataUrlToBytes(s.img);
    if (decoded) {
      zip.file(`photos/slide-${i + 1}.${decoded.ext}`, decoded.bytes);
      photoCount += 1;
    }
  });
  if (photoCount > 0) {
    zip.file('photos/INDEX.txt', `${photoCount} photo(s) extracted from base64 storage.\nFilenames: <type>-<id>-<name>.<ext>\n`);
  }

  progress('Compressing…');
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  }, (meta) => progress(`Compressing… ${Math.round(meta.percent)}%`));

  // 7. Trigger download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `plumenexus-${tenantId}-${exportedAt.slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return {
    fileCount: Object.keys(zip.files).length,
    photoCount,
    bytes: blob.size,
  };
}

const README_TEMPLATE = `Plume Nexus — Your Complete Data Export
========================================

Tenant: {TENANT}
Exported: {DATE}

This bundle contains everything Plume Nexus has stored on your behalf.
It is yours, free, forever — per our binding promise that data export
is never paywalled, never gated behind support, never delayed.

WHAT'S INSIDE
-------------
manifest.json     metadata about this export
everything.json   complete JSON snapshot. Use this to re-import elsewhere
                  or to restore your account.
csv/              one CSV per data table — open in Excel, Google Sheets,
                  Numbers, or any spreadsheet tool.
settings/         your account configuration (slides, users list, brand,
                  webfront copy, booking config, handbook, etc.) as JSON.
photos/           every uploaded image, extracted as a real file.
                  Filename pattern: <type>-<id>-<name>.<ext>

HOW TO USE
----------
- Looking at your data: open any csv/ file in your spreadsheet app.
- Backing up: keep the whole .zip somewhere safe.
- Migrating elsewhere: most platforms accept CSV imports. Map our column
  names to theirs as needed; everything.json has full fidelity.
- Restoring your account: contact hello@plumenexus.com and we'll re-import
  everything.json for you, free.

ROW COUNTS
----------
{COUNTS}

Questions? hello@plumenexus.com — the founder reads every email.
`;
