// Pure HTML builder for the rating CTA injected into the email receipt.
// Extracted so we can unit-test the style branching, per-tech URL
// construction, and fallback path without spinning up the full
// onDocumentCreated trigger.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}
function safeHttpUrl(u) {
  if (!u) return null;
  const s = String(u).trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

function buildRatingEmailBlock({ viewToken, baseUrl, services, techName, style, fallbackGoogleUrl }) {
  if (!viewToken || !baseUrl) {
    const safe = safeHttpUrl(fallbackGoogleUrl);
    if (safe) {
      return `<div style="margin:20px 0 0;text-align:center;">
         <a href="${escapeHtml(safe)}" style="display:inline-block;background:#2D7A5F;color:#fff;font-size:13px;font-weight:700;padding:11px 24px;border-radius:10px;text-decoration:none;letter-spacing:.01em;">⭐ Leave us a Google Review</a>
         <p style="font-size:11px;color:#bbb;margin:8px 0 0;">It takes 30 seconds and means the world to us 🙏</p>
       </div>`;
    }
    return `<p style="font-size:12px;color:#aaa;margin:16px 0 0;line-height:1.6;">We loved having you! It means a lot. 🙏</p>`;
  }

  const techSet = new Set();
  (services || []).forEach(s => { if (s && s.techName) techSet.add(s.techName); });
  if (techSet.size === 0 && techName) {
    String(techName).split(',').map(t => t.trim()).filter(Boolean).forEach(t => techSet.add(t));
  }
  const techs = Array.from(techSet);
  if (techs.length === 0) techs.push('Your technician');

  const baseLink = `${baseUrl}/r/${encodeURIComponent(viewToken)}`;

  const starRow = (tech) => {
    const cells = [1, 2, 3, 4, 5].map(n => {
      const href = `${baseLink}?rate=${n}&tech=${encodeURIComponent(tech)}&src=email`;
      return `<td style="padding:0 2px;"><a href="${escapeHtml(href)}" style="display:inline-block;text-decoration:none;font-size:28px;color:#f5b400;line-height:1;">☆</a></td>`;
    }).join('');
    return `<div style="margin:0 0 12px;">
      <div style="font-size:12px;color:#555;margin:0 0 6px;">How was ${escapeHtml(tech)}?</div>
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0;"><tr>${cells}</tr></table>
    </div>`;
  };

  const buttonHtml = `<div style="text-align:center;margin-top:8px;">
    <a href="${escapeHtml(baseLink)}?src=email" style="display:inline-block;background:#2D7A5F;color:#fff;font-size:13px;font-weight:700;padding:11px 24px;border-radius:10px;text-decoration:none;">★ Rate your visit</a>
    <p style="font-size:11px;color:#bbb;margin:8px 0 0;">It only takes 20 seconds.</p>
  </div>`;

  const starsHtml = `<div style="margin:20px 0 0;">
    <div style="font-size:14px;font-weight:600;color:#222;margin:0 0 10px;">How was your visit?</div>
    ${techs.map(starRow).join('')}
  </div>`;

  if (style === 'inline_stars')  return starsHtml;
  if (style === 'single_button') return `<div style="margin:20px 0 0;">${buttonHtml}</div>`;
  return `${starsHtml}<div style="border-top:1px dashed #eee;margin-top:8px;padding-top:8px;">${buttonHtml}</div>`;
}

module.exports = { buildRatingEmailBlock };
