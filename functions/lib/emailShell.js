// Shared, isomorphic rendering primitives for the message-template system.
//
// ONE branded email chrome (gradient header + white card + footer) so every
// automated tenant email stays on-brand; templates supply only the subject and
// a light-markup body. Pure functions only (no Firestore / Node-only APIs) so
// the SAME code renders on the server (functions/index.js) and in the web
// editor's live preview — previews can never lie about what the server sends.
//
// Light markup understood by renderEmailBody (paragraphs separated by blank
// lines):
//   # text            → bold heading paragraph (greeting)
//   > text            → muted small paragraph (sign-off / footnote)
//   [[Label|{url}]]   → centered CTA button (dropped if the url is empty/unsafe)
//   {blockVar}        → a trusted, code-generated HTML block (htmlVars) inserted raw
//   anything else     → standard body prose paragraph
// Inline: {var} interpolates (HTML-escaped unless the var is in htmlVars),
//         **bold** → <strong>, single newlines inside a paragraph → <br>.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}

// Replace {name} placeholders. htmlVars are inserted raw (trusted, code-built);
// every other provided var is escaped (email) or passed through (sms, escapeFn
// = identity). A {name} with no matching var is left LITERAL so the editor can
// warn on unknown placeholders and so a typo never silently blanks copy.
function interpolate(str, vars, { escapeFn = (x) => x, htmlVars = [] } = {}) {
  const set = htmlVars instanceof Set ? htmlVars : new Set(htmlVars || []);
  const v = vars || {};
  return String(str == null ? '' : str).replace(/\{(\w+)\}/g, (whole, name) => {
    if (!Object.prototype.hasOwnProperty.call(v, name)) return whole; // unknown → literal
    const val = v[name];
    return set.has(name) ? String(val == null ? '' : val) : escapeFn(val);
  });
}

const PROSE_STYLE = 'font-size:14px;line-height:1.65;color:#555;margin:0 0 16px;';
const HEAD_STYLE  = 'font-size:15px;color:#222;margin:0 0 12px;font-weight:600;';
const NOTE_STYLE  = 'font-size:12px;color:#aaa;line-height:1.6;margin:14px 0 0;';
const BTN_WRAP    = 'text-align:center;margin:20px 0;';
const BTN_STYLE   = 'display:inline-block;background:#2D7A5F;color:#fff;font-size:14px;font-weight:700;padding:13px 30px;border-radius:10px;text-decoration:none;';

// **bold** → <strong>. Applied after interpolation; runs on trusted chrome +
// already-escaped values, so it can't introduce script.
function inlineFmt(s) {
  return String(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function para(text, style) {
  const html = inlineFmt(text).replace(/\n/g, '<br>');
  return `<p style="${style}">${html}</p>`;
}

// Render a light-markup body to the inner HTML of the email card's content div.
function renderEmailBody(body, vars, htmlVars = []) {
  const set = new Set(htmlVars || []);
  const blocks = String(body == null ? '' : body).split(/\n[ \t]*\n/);
  const out = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    // Lone trusted HTML block: {detailsCard} etc. on its own line.
    const loneVar = /^\{(\w+)\}$/.exec(block);
    if (loneVar && set.has(loneVar[1])) {
      const val = vars && vars[loneVar[1]];
      if (val) out.push(String(val));
      continue;
    }

    // CTA button: [[Label|{url}]]
    const cta = /^\[\[([\s\S]+?)\|([\s\S]+?)\]\]$/.exec(block);
    if (cta) {
      const label = interpolate(cta[1], vars, { escapeFn: esc, htmlVars });
      const url   = interpolate(cta[2], vars, { escapeFn: (x) => x, htmlVars });
      if (isSafeUrl(url)) {
        out.push(`<div style="${BTN_WRAP}"><a href="${esc(url)}" style="${BTN_STYLE}">${label}</a></div>`);
      }
      continue;
    }

    let style = PROSE_STYLE;
    let text  = block;
    if (block.startsWith('# ')) { style = HEAD_STYLE; text = block.slice(2); }
    else if (block.startsWith('> ')) { style = NOTE_STYLE; text = block.slice(2); }

    const rendered = interpolate(text, vars, { escapeFn: esc, htmlVars });
    if (!rendered.trim()) continue; // a var resolved to nothing — drop the empty paragraph
    out.push(para(rendered, style));
  }
  return out.join('\n      ');
}

// The branded chrome. brand = { salonName, footerLine }. Options:
//   subtitle          header sub-line (already interpolated)
//   gradient          "c1,c2" for the header (default brand teal→blue)
//   footerNote        extra muted footer line (e.g. "Reply to unsubscribe.")
//   footerBorder      hairline above the footer (default true)
//   centerHeaderTitle when set, a centered header variant with an uppercase
//                     salon name + this big title (the gift-card style)
function emailShell(brand, { subtitle = '', bodyHtml = '', gradient = '#2D7A5F,#3D95CE', footerNote = '', footerBorder = true, centerHeaderTitle = '' } = {}) {
  const b = brand || { salonName: 'your salon', footerLine: 'Plume Nexus' };
  const header = centerHeaderTitle
    ? `<div style="background:linear-gradient(135deg,${gradient});padding:24px;text-align:center;color:#fff;">
      <div style="font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.9;">${esc(b.salonName)}</div>
      <div style="font-size:22px;font-weight:700;margin-top:8px;">${centerHeaderTitle}</div>
    </div>`
    : `<div style="background:linear-gradient(135deg,${gradient});padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">${esc(b.salonName)}</div>
      ${subtitle ? `<div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">${subtitle}</div>` : ''}
    </div>`;
  const footerBorderCss = footerBorder ? 'border-top:1px solid #f0f0f0;' : '';
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    ${header}
    <div style="padding:24px;">
      ${bodyHtml}
    </div>
    <div style="padding:12px 24px 20px;text-align:center;${footerBorderCss}">
      <p style="font-size:11px;color:#bbb;margin:0;">${esc(b.footerLine)}</p>
      ${footerNote ? `<p style="font-size:10px;color:#ccc;margin:4px 0 0;">${esc(footerNote)}</p>` : ''}
    </div>
  </div>
</body>
</html>`;
}

// A small rounded info card matching the existing f8f9fa detail boxes, so send
// sites can build the trusted {detailsCard} block consistently.
function infoCard(innerHtml) {
  return `<div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border:1px solid #e8e8e8;font-size:13px;color:#555;">${innerHtml}</div>`;
}

// GSM-7 vs UCS-2 segment math for the SMS editor's live counter. Any char
// outside the GSM-7 alphabet (emoji, many accents) forces the whole message
// into UCS-2 (70-char segments, 67 when concatenated).
const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";
function segmentInfo(text) {
  const str = String(text || '');
  const chars = Array.from(str);
  let unicode = false;
  let units = 0;
  for (const ch of chars) {
    if (GSM7.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else { unicode = true; break; }
  }
  if (unicode) {
    const len = chars.length;
    const seg = len <= 70 ? 1 : Math.ceil(len / 67);
    return { encoding: 'UCS-2', length: len, segments: seg };
  }
  const seg = units <= 160 ? 1 : Math.ceil(units / 153);
  return { encoding: 'GSM-7', length: units, segments: Math.max(1, seg) };
}

module.exports = {
  esc, isSafeUrl, interpolate, renderEmailBody, emailShell, infoCard, segmentInfo,
};
