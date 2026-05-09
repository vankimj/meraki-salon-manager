const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule }       = require('firebase-functions/v2/scheduler');
const { onCall, onRequest, HttpsError }= require('firebase-functions/v2/https');
const { initializeApp }    = require('firebase-admin/app');
const { getFirestore }     = require('firebase-admin/firestore');
const { defineString, defineSecret } = require('firebase-functions/params');
const { Resend }           = require('resend');
const Anthropic            = require('@anthropic-ai/sdk');

initializeApp();

const TENANT_ID   = 'meraki';
const resendKey       = defineString('RESEND_API_KEY',      { default: '' });
const resendFrom      = defineString('RESEND_FROM',         { default: 'Meraki Nail Studio <noreply@merakinailstudio.com>' });
const mapsApiKey      = defineString('GOOGLE_MAPS_API_KEY', { default: '' });
const publicAppUrl    = defineString('PUBLIC_APP_URL',      { default: 'https://meraki-salon-manager.web.app' });
const unsubscribeSecret = defineString('UNSUBSCRIBE_SECRET', { default: 'change-me-in-prod-env' });
const stripeKey       = defineSecret('STRIPE_SECRET_KEY');
const anthropicKey    = defineSecret('ANTHROPIC_API_KEY');

// CAN-SPAM unsubscribe link helpers. Token is an HMAC-truncated-to-16-hex of
// the tenantId:clientId pair, signed with the UNSUBSCRIBE_SECRET. Not
// security-critical (worst case: a determined attacker can mark a client
// unsubscribed) — we just need to make scraping infeasible. The link works
// permanently as required by CAN-SPAM (>= 30 days, indefinite is fine).
function unsubToken(tenantId, clientId) {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', unsubscribeSecret.value())
    .update(`${tenantId}:${clientId}`)
    .digest('hex')
    .slice(0, 16);
}
function unsubUrl(tenantId, clientId) {
  if (!clientId) return null;
  const t = unsubToken(tenantId, clientId);
  const base = (publicAppUrl.value() || '').replace(/\/+$/, '');
  return `${base}/?unsub=1&tid=${encodeURIComponent(tenantId)}&cid=${encodeURIComponent(clientId)}&t=${t}`;
}

// Per-appointment HMAC token for client-facing "manage my appointment" links.
// Same threat model as unsubscribe: not security-critical (the worst case is
// a guessed token cancels a single appointment, which the client can re-
// confirm with the salon). Lets us include reschedule/cancel links in emails
// + SMS without the client needing to log in.
function apptManageToken(tenantId, apptId) {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', unsubscribeSecret.value())
    .update(`appt:${tenantId}:${apptId}`)
    .digest('hex')
    .slice(0, 16);
}
function apptManageUrl(tenantId, apptId) {
  if (!apptId) return null;
  const t = apptManageToken(tenantId, apptId);
  const base = (publicAppUrl.value() || '').replace(/\/+$/, '');
  return `${base}/?manage=${encodeURIComponent(apptId)}&tid=${encodeURIComponent(tenantId)}&t=${t}`;
}

function fmtTime(str) {
  if (!str) return '';
  const [h, m] = str.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Escape user-controlled strings before interpolating them into email HTML.
// Receipts/reviewRequests/chatNotifications are now staff-only at the rules
// layer, but we still escape here as defense-in-depth so any future relaxation
// of those rules — or any imported field — can't smuggle markup into mail
// sent from the salon's verified domain.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}
// Validate a URL is plain http(s). Used for href interpolation so an attacker
// can't smuggle javascript:/data: URIs through fields like googleReviewUrl.
function safeUrl(u) {
  if (!u) return '';
  const s = String(u).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function fmtDate(str) {
  if (!str) return str;
  return new Date(str + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function buildSubject(changeType, clientName, date) {
  const d = fmtDate(date);
  const subjects = {
    appt_added:     `New appointment — ${clientName} on ${d}`,
    appt_removed:   `Appointment reassigned — ${clientName} on ${d}`,
    appt_assigned:  `Appointment assigned to you — ${clientName} on ${d}`,
    appt_modified:  `Appointment updated — ${clientName} on ${d}`,
    client_checkin: `${clientName} has arrived — ${d}`,
  };
  return subjects[changeType] || `Schedule update — ${d}`;
}

function buildHtml(data) {
  const dateStr = `${esc(fmtDate(data.date))} at ${esc(fmtTime(data.startTime))}`;
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Schedule Notification</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;line-height:1.65;color:#222;margin:0 0 20px;">${esc(data.message)}</p>
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border:1px solid #e8e8e8;">
        <div style="font-size:13px;color:#555;margin-bottom:6px;">
          <span style="margin-right:8px;">📅</span>${dateStr}
        </div>
        <div style="font-size:13px;color:#555;">
          <span style="margin-right:8px;">👤</span>${esc(data.clientName)}
        </div>
      </div>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div>
</body>
</html>`;
}

function buildHandbookReminderHtml(data, empName) {
  const firstName = (empName || data.techName || 'Team').split(' ')[0];
  const title     = data.handbookTitle || 'Employee Handbook';
  const version   = data.version || '1.0';
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Employee Handbook</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${esc(firstName)}!</p>
      <p style="font-size:14px;line-height:1.65;color:#555;margin:0 0 20px;">
        The <strong>${esc(title)}</strong> (v${esc(version)}) has been updated and requires your acknowledgment.
        Please log in to the Meraki Salon Manager app to read and sign the latest handbook.
      </p>
      <div style="background:#FEF9EC;border-radius:8px;padding:14px 16px;border:1px solid #fcd34d;">
        <div style="font-size:13px;color:#92400e;font-weight:600;">Action Required</div>
        <div style="font-size:13px;color:#555;margin-top:4px;">Sign the ${esc(title)} v${esc(version)} in the Meraki app under HR → Handbook.</div>
      </div>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div>
</body>
</html>`;
}

exports.sendReceiptEmail = onDocumentCreated(
  `tenants/${TENANT_ID}/receipts/{receiptId}`,
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data   = snap.data();
    if (!data || data.sent || data.error) return;

    const apiKey = resendKey.value();
    if (!apiKey) { await snap.ref.update({ error: 'resend_not_configured' }); return; }

    const { clientName, clientEmail, techName, date, startTime, services = [], retailProducts = [], payment = {} } = data;
    if (!clientEmail) { await snap.ref.update({ error: 'no_email' }); return; }

    // Read Google review URL from settings (best-effort)
    let googleReviewUrl = null;
    try {
      const settingsSnap = await getFirestore().doc(`tenants/${TENANT_ID}/data/settings`).get();
      if (settingsSnap.exists) googleReviewUrl = settingsSnap.data().googleReviewUrl || null;
    } catch { /* non-fatal */ }

    const dateStr     = `${esc(fmtDate(date))}${startTime ? ' at ' + esc(fmtTime(startTime)) : ''}`;
    const firstName   = (clientName || 'there').split(' ')[0];
    const serviceRows = services.map(s =>
      `<tr><td style="padding:6px 0;color:#333;font-size:13px;">${esc(s.name || '—')}${s.techName && s.techName !== techName ? ` <span style="color:#aaa">(${esc(s.techName)})</span>` : ''}</td><td style="text-align:right;padding:6px 0;color:#333;font-size:13px;">$${Number(s.price || 0).toFixed(2)}</td></tr>`
    ).join('');

    const summaryRows = [
      payment.discountAmount > 0 && `<tr><td style="padding:4px 0;font-size:12px;color:#888;">Discount</td><td style="text-align:right;font-size:12px;color:#ef4444;">-$${payment.discountAmount.toFixed(2)}</td></tr>`,
      payment.promoAmount    > 0 && `<tr><td style="padding:4px 0;font-size:12px;color:#888;">Promo (${esc(payment.promoCode)})</td><td style="text-align:right;font-size:12px;color:#ef4444;">-$${payment.promoAmount.toFixed(2)}</td></tr>`,
      payment.giftCard       && payment.giftCard.applied > 0 && `<tr><td style="padding:4px 0;font-size:12px;color:#888;">Gift card</td><td style="text-align:right;font-size:12px;color:#ef4444;">-$${payment.giftCard.applied.toFixed(2)}</td></tr>`,
      payment.creditApplied  > 0 && `<tr><td style="padding:4px 0;font-size:12px;color:#888;">Store credit</td><td style="text-align:right;font-size:12px;color:#ef4444;">-$${payment.creditApplied.toFixed(2)}</td></tr>`,
      payment.tip            > 0 && `<tr><td style="padding:4px 0;font-size:12px;color:#888;">Tip</td><td style="text-align:right;font-size:12px;color:#555;">$${payment.tip.toFixed(2)}</td></tr>`,
    ].filter(Boolean).join('');

    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Receipt</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 4px;font-weight:600;">Hi ${esc(firstName)}!</p>
      <p style="font-size:13px;color:#888;margin:0 0 20px;">Thanks for visiting Meraki Nail Studio. Here's your receipt.</p>

      <div style="background:#f8f9fa;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:12px;color:#555;">
        <div>📅 ${dateStr}</div>
        <div style="margin-top:4px;">👩‍💼 ${esc(techName || 'Your technician')}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
        <tr style="border-bottom:1px solid #e8e8e8;">
          <th style="text-align:left;font-size:11px;color:#aaa;padding-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Service</th>
          <th style="text-align:right;font-size:11px;color:#aaa;padding-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Price</th>
        </tr>
        ${serviceRows}
        ${retailProducts.length > 0 ? `
          <tr><td colspan="2" style="padding:8px 0 4px;font-size:11px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.06em;border-top:1px solid #f0f0f0;">Retail Products</td></tr>
          ${retailProducts.map(rp => `<tr><td style="padding:6px 0;color:#333;font-size:13px;">${esc(rp.name)}${rp.qty > 1 ? ` ×${esc(rp.qty)}` : ''}</td><td style="text-align:right;padding:6px 0;color:#333;font-size:13px;">$${(Number(rp.price || 0) * (rp.qty || 1)).toFixed(2)}</td></tr>`).join('')}
        ` : ''}
        ${summaryRows ? `<tr><td colspan="2" style="padding:6px 0;border-top:1px solid #f0f0f0;"></td></tr>${summaryRows}` : ''}
        <tr style="border-top:1px solid #e8e8e8;">
          <td style="padding:10px 0 0;font-size:14px;font-weight:700;color:#1a1a1a;">Total</td>
          <td style="text-align:right;padding:10px 0 0;font-size:14px;font-weight:700;color:#2D7A5F;">$${Number(payment.total || 0).toFixed(2)}</td>
        </tr>
        <tr>
          <td colspan="2" style="font-size:11px;color:#aaa;padding-top:3px;">Paid via ${esc(payment.method || '—')}</td>
        </tr>
      </table>

      ${safeUrl(googleReviewUrl)
        ? `<div style="margin:20px 0 0;text-align:center;">
             <a href="${esc(safeUrl(googleReviewUrl))}" style="display:inline-block;background:#2D7A5F;color:#fff;font-size:13px;font-weight:700;padding:11px 24px;border-radius:10px;text-decoration:none;letter-spacing:.01em;">⭐ Leave us a Google Review</a>
             <p style="font-size:11px;color:#bbb;margin:8px 0 0;">It takes 30 seconds and means the world to us 🙏</p>
           </div>`
        : `<p style="font-size:12px;color:#aaa;margin:16px 0 0;line-height:1.6;">We loved having you! It means a lot. 🙏</p>`
      }
    </div>
    <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div>
</body>
</html>`;

    try {
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from:    resendFrom.value(),
        to:      clientEmail,
        subject: `Your receipt from Meraki Nail Studio — ${fmtDate(date)}`,
        html,
      });
      if (error) throw new Error(error.message || JSON.stringify(error));
      await snap.ref.update({ sent: true, sentAt: new Date().toISOString() });
      console.log(`[Receipt] Sent to ${clientName} (${clientEmail})`);
    } catch (e) {
      console.error('[Receipt] Failed:', e.message);
      await snap.ref.update({ error: e.message });
    }
  }
);

function buildMarketingHtml(bodyHtml, promoCode, promoLabel, ctaText, ctaUrl, unsubLink) {
  // bodyHtml is pre-escaped by the caller (sendMarketingCampaign). The other
  // four inputs come straight from the campaign doc — escape every one and
  // restrict ctaUrl to http(s).
  const promoBlock = promoCode ? `
      <div style="margin:20px 0;background:#f0faf6;border:2px dashed #2D7A5F;border-radius:10px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:#2D7A5F;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;">Your Exclusive Promo Code</div>
        <div style="font-size:26px;font-weight:800;color:#1a1a1a;letter-spacing:.12em;font-family:monospace,sans-serif;">${esc(promoCode)}</div>
        ${promoLabel ? `<div style="font-size:12px;color:#888;margin-top:6px;">${esc(promoLabel)}</div>` : ''}
      </div>` : '';
  const ctaUrlSafe = safeUrl(ctaUrl);
  const ctaBlock = ctaUrlSafe ? `
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="${esc(ctaUrlSafe)}" style="display:inline-block;background:#2D7A5F;color:#fff;font-size:14px;font-weight:700;padding:13px 32px;border-radius:10px;text-decoration:none;letter-spacing:.01em;">${esc(ctaText || 'Book Your Appointment')} →</a>
      </div>` : '';
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Message from the team</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:14px;line-height:1.75;color:#333;margin:0;">${bodyHtml}</p>
      ${promoBlock}
      ${ctaBlock}
    </div>
    <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
      <p style="font-size:10px;color:#ccc;margin:4px 0 0;">
        You're receiving this as a valued client.${unsubLink ? ` <a href="${esc(unsubLink)}" style="color:#888;text-decoration:underline;">Unsubscribe</a>` : ' Reply to this email to unsubscribe.'}
        &nbsp;·&nbsp; <a href="${esc(publicAppUrl.value() || '')}/?terms=1" style="color:#888;text-decoration:underline;">Terms</a>
        &nbsp;·&nbsp; <a href="${esc(publicAppUrl.value() || '')}/?privacy=1" style="color:#888;text-decoration:underline;">Privacy</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// Core email-send pipeline. Mirrors processSMSCampaign so the UI's
// CampaignDiagnostics panel (attempts[], sent/fail/queued counters,
// progress flushes, cancel-on-flush, status flow) works identically
// across channels. Used by both the immediate trigger and the scheduled
// runner.
async function processEmailCampaign(tenantId, docRef, data) {
  const apiKey = resendKey.value();
  if (!apiKey) {
    await docRef.update({ status: 'failed', error: 'resend_not_configured' });
    return;
  }

  const recipients = Array.isArray(data.recipients) ? data.recipients : [];
  if (recipients.length === 0) {
    await docRef.update({ status: 'failed', error: 'no_recipients' });
    return;
  }

  if (data.cancelRequested) {
    await docRef.update({
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      sentCount: 0, failCount: 0, attemptedCount: 0, attempts: [],
    });
    return;
  }

  await docRef.update({
    status: 'sending',
    startedAt: new Date().toISOString(),
    sentCount: 0,
    failCount: 0,
    attemptedCount: 0,
    attempts: [],
  });

  const resend = new Resend(apiKey);
  const fromAddr = resendFrom.value();
  const subject = data.subject || '';
  const body = data.body || '';

  const attempts = [];
  let lastFlushAt = Date.now();
  const FLUSH_EVERY_N = 5;
  const FLUSH_EVERY_MS = 1500;
  const ATTEMPTS_CAP = 2000;

  function counts() {
    let sent = 0, failed = 0;
    for (const a of attempts) {
      if (a.status === 'sent')        sent++;
      else if (a.status === 'failed') failed++;
    }
    return { sent, failed };
  }

  async function flushProgress() {
    const { sent, failed } = counts();
    const stored = attempts.length > ATTEMPTS_CAP ? attempts.slice(0, ATTEMPTS_CAP) : attempts;
    await docRef.update({
      sentCount: sent,
      failCount: failed,
      attemptedCount: attempts.length,
      attempts: stored,
      attemptsTruncated: attempts.length > ATTEMPTS_CAP,
      lastUpdateAt: new Date().toISOString(),
    });
    lastFlushAt = Date.now();
  }

  for (const recipient of recipients) {
    const at = new Date().toISOString();
    const { name, email, clientId } = recipient;
    if (!email) {
      attempts.push({ name: name || '(unknown)', email: '', status: 'failed', code: 'NO_EMAIL', reason: 'Recipient has no email address on file', at });
    } else {
      const firstName = (name || 'there').split(' ')[0];
      const lastName  = (name || '').split(' ').slice(1).join(' ');

      // Personalized promo: mint a unique single-use code bound to this
      // client; the code substitutes into the body via {promoCode} AND
      // is rendered as the highlighted block in the email's promo card.
      let promoCode = data.promoCode || null;
      let promoLabel = data.promoLabel || null;
      let promoMintError = null;
      if (data.promoPersonalize && clientId) {
        try {
          const minted = await createPersonalizedPromo(tenantId, {
            prefix:      data.promoPersonalize.prefix,
            type:        data.promoPersonalize.type,
            value:       data.promoPersonalize.value,
            expiresDays: data.promoPersonalize.expiresDays,
            clientId,
            campaignId:  docRef.id,
          });
          if (minted) {
            promoCode = minted.code;
            promoLabel = data.promoPersonalize.type === 'amount'
              ? `$${data.promoPersonalize.value} off — single use, expires in ${data.promoPersonalize.expiresDays} days`
              : `${data.promoPersonalize.value}% off — single use, expires in ${data.promoPersonalize.expiresDays} days`;
          }
        } catch (e) {
          promoMintError = e?.message || 'promo_mint_failed';
          console.error(`[processEmailCampaign] promo mint failed for ${email}:`, promoMintError);
        }
      }

      const placeholders = { firstName, lastName, promoCode: promoCode || '' };
      const personalizedSubject = substitutePlaceholders(subject, placeholders);
      const personalizedBody    = substitutePlaceholders(body,    placeholders);
      const bodyHtml = personalizedBody
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

      try {
        const result = await resend.emails.send({
          from:    fromAddr,
          to:      email,
          subject: personalizedSubject,
          html:    buildMarketingHtml(bodyHtml, promoCode, promoLabel, data.ctaText || null, data.ctaUrl || null, unsubUrl(tenantId, clientId)),
        });
        if (result?.error) {
          // Resend returns { data: null, error: { name, message, ...} }
          // rather than throwing for most validation errors. Capture it.
          const code   = result.error.name || result.error.statusCode || 'RESEND_ERROR';
          const reason = result.error.message || JSON.stringify(result.error);
          console.error(`[processEmailCampaign] ${email} resend-error code=${code} reason=${reason}`);
          attempts.push({ name: name || '(unknown)', email, status: 'failed', code: String(code), reason, promoCode: promoCode || null, at });
        } else {
          attempts.push({ name: name || '(unknown)', email, status: 'sent', resendId: result?.data?.id || null, promoCode: promoCode || null, at });
        }
      } catch (err) {
        const code = err?.name || err?.code || 'UNKNOWN';
        const reason = err?.message || 'Unknown Resend error';
        console.error(`[processEmailCampaign] ${email} threw code=${code} reason=${reason}`);
        attempts.push({ name: name || '(unknown)', email, status: 'failed', code: String(code), reason, promoCode: promoCode || null, promoMintError, at });
      }

      // Resend rate limit: ~10 req/sec on free tier, more on paid. 50ms
      // pacing keeps us well under either ceiling.
      await new Promise(r => setTimeout(r, 50));
    }

    const now = Date.now();
    let cancelled = false;
    if (attempts.length % FLUSH_EVERY_N === 0 || now - lastFlushAt >= FLUSH_EVERY_MS) {
      try { await flushProgress(); } catch (e) { console.error('[processEmailCampaign] progress flush failed:', e); }
      try {
        const cur = await docRef.get();
        if (cur.data()?.cancelRequested) cancelled = true;
      } catch (e) { console.error('[processEmailCampaign] cancel-check read failed:', e); }
    }
    if (cancelled) break;
  }

  const { sent, failed } = counts();
  const failures = attempts.filter(a => a.status === 'failed').slice(0, 200);
  let finalStatus = 'done';
  try {
    const cur = await docRef.get();
    if (cur.data()?.cancelRequested) finalStatus = 'cancelled';
  } catch { /* fall through */ }
  await docRef.update({
    status: finalStatus,
    sentCount: sent,
    failCount: failed,
    attemptedCount: attempts.length,
    attempts: attempts.length > ATTEMPTS_CAP ? attempts.slice(0, ATTEMPTS_CAP) : attempts,
    attemptsTruncated: attempts.length > ATTEMPTS_CAP,
    failures,
    ...(finalStatus === 'cancelled'
        ? { cancelledAt: new Date().toISOString() }
        : { sentAt:      new Date().toISOString() }),
  });
}

exports.sendMarketingCampaign = onDocumentCreated(
  { document: `tenants/${TENANT_ID}/campaigns/{campaignId}`, timeoutSeconds: 540 },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (!data) return;
    // Email immediate path. SMS is handled by sendSMSCampaign;
    // scheduled email/sms is handled by runScheduledCampaigns.
    if (data.channel === 'sms') return;
    if (data.status !== 'pending') return;
    await processEmailCampaign(snap.ref.parent.parent.id, snap.ref, data);
  }
);

// Public callable: marks a client opted out of marketing. Called from the
// /?unsub=1&tid=&cid=&t= public page that the email's unsubscribe link
// points at. Token-based — no auth required (CAN-SPAM forbids requiring
// auth or info beyond email to unsubscribe).
exports.processUnsubscribe = onCall({ cors: true }, async (request) => {
  const { tid, cid, token } = request.data || {};
  if (!tid || !cid || !token) throw new HttpsError('invalid-argument', 'Missing parameters');
  const expected = unsubToken(tid, cid);
  // Constant-time compare so timing can't reveal a partial-match.
  const crypto = require('crypto');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpsError('permission-denied', 'Invalid unsubscribe token');
  }
  const db = getFirestore();
  const ref = db.doc(`tenants/${tid}/clients/${cid}`);
  const doc = await ref.get();
  if (!doc.exists) throw new HttpsError('not-found', 'Client not found');
  await ref.update({
    marketingOptOut:    true,
    marketingOptOutAt:  new Date().toISOString(),
    marketingOptOutVia: 'email_unsubscribe_link',
    updatedAt:          new Date().toISOString(),
  });
  return { ok: true, name: doc.data().name || null };
});

// ── Self-service appointment manage (public via HMAC token) ────
// Single callable that handles three actions, all gated by an HMAC token
// pinned to the appointment. No login required — the link in the booking
// confirmation email/SMS is the credential.
//
// Actions:
//   'get'             — return appt summary + cancellation policy
//   'availableSlots'  — return open slots for the next 30 days for the
//                       same tech/service combo (or any tech if 'auto')
//   'reschedule'      — change date/startTime (and optionally techName)
//   'cancel'          — set status to 'cancelled'
//
// Cancellation policy: refuse mutations within
// settings.bookingConfig.cancellationLeadHours of the start time
// (defaults to 24 hours). Frontend reads the policy via 'get' to show
// the right UX.
exports.manageAppointment = onCall({ cors: true }, async (request) => {
  const { tid, apptId, token, action, payload = {} } = request.data || {};
  if (!tid || !apptId || !token || !action) {
    throw new HttpsError('invalid-argument', 'Missing parameters');
  }
  const expected = apptManageToken(tid, apptId);
  const crypto = require('crypto');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpsError('permission-denied', 'Invalid token');
  }

  const db = getFirestore();
  const apptRef = db.doc(`tenants/${tid}/appointments/${apptId}`);
  const apptSnap = await apptRef.get();
  if (!apptSnap.exists) throw new HttpsError('not-found', 'Appointment not found');
  const appt = { id: apptSnap.id, ...apptSnap.data() };

  const settingsSnap = await db.doc(`tenants/${tid}/data/settings`).get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  const leadHours = Number(settings.bookingConfig?.cancellationLeadHours) || 24;

  const strToMins = (s) => {
    if (!s) return 0;
    const [h, m] = s.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const fmtTimeIso = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  // Compare appointment start instant to "now" to enforce policy
  function hoursUntilAppt() {
    const apptMs = new Date(`${appt.date}T${(appt.startTime || '00:00')}:00`).getTime();
    return (apptMs - Date.now()) / 3600000;
  }

  if (action === 'get') {
    const hUntil = hoursUntilAppt();
    return {
      appt: {
        id: appt.id,
        date: appt.date,
        startTime: appt.startTime,
        duration: appt.duration || 60,
        techName: appt.techName,
        clientName: appt.clientName || 'Client',
        services: (appt.services || []).map(s => ({ name: s.name, duration: s.duration, price: s.price })),
        status: appt.status,
        techRequestType: appt.techRequestType || 'scheduler',
      },
      policy: {
        cancellationLeadHours: leadHours,
        canModify: appt.status !== 'cancelled' && appt.status !== 'done' && hUntil >= leadHours,
        hoursUntil: hUntil,
      },
      salon: {
        name: settings.salonName || 'Meraki Nail Studio',
        phone: settings.contactPhone || settings.phone || '',
      },
    };
  }

  if (appt.status === 'cancelled') throw new HttpsError('failed-precondition', 'Already cancelled');
  if (appt.status === 'done')      throw new HttpsError('failed-precondition', 'Already completed');
  if (hoursUntilAppt() < leadHours) {
    throw new HttpsError('failed-precondition', `Changes must be made at least ${leadHours} hour${leadHours === 1 ? '' : 's'} in advance — please call the salon.`);
  }

  if (action === 'cancel') {
    await apptRef.update({
      status:           'cancelled',
      cancelledAt:      new Date().toISOString(),
      cancelledBy:      'client_self_service',
      updatedAt:        new Date().toISOString(),
    });
    return { ok: true };
  }

  if (action === 'availableSlots') {
    // Look up the next 30 days of openings for the same tech, same service
    const dur = (appt.services || []).reduce((s, sv) => s + (Number(sv.duration) || 0), 0) || (Number(appt.duration) || 60);
    const today = new Date();
    const out = [];
    for (let d = 1; d <= 30; d++) {
      const target = new Date(today);
      target.setDate(target.getDate() + d);
      const yyyymmdd = target.toLocaleDateString('en-CA');
      const dow = target.toLocaleDateString('en-US', { weekday: 'short' });
      const sh = settings.storeHours?.[dow] || {};
      if (sh.closed) continue;
      const open  = strToMins(sh.open  || settings.apptHours?.open  || '09:00');
      const close = strToMins(sh.close || settings.apptHours?.close || '18:00');
      // Check tech is on that day-of-week
      const empSnap = await db.collection(`tenants/${tid}/employees`).where('name', '==', appt.techName).limit(1).get();
      const emp = empSnap.empty ? null : empSnap.docs[0].data();
      if (emp?.workDays && emp.workDays[dow]?.on === false) continue;
      // Check tech time-off
      const toSnap = await db.collection(`tenants/${tid}/timeOff`).get();
      const onTimeOff = toSnap.docs.map(x => x.data()).some(t =>
        t.techName === appt.techName &&
        (t.startDate || '') <= yyyymmdd && yyyymmdd <= (t.endDate || t.startDate || '')
      );
      if (onTimeOff) continue;
      // Tech's existing appts
      const apSnap = await db.collection(`tenants/${tid}/appointments`).where('date', '==', yyyymmdd).get();
      const techAppts = apSnap.docs.map(x => x.data())
        .filter(a => a.techName === appt.techName && a.status !== 'cancelled')
        .map(a => ({ s: strToMins(a.startTime || '00:00'), e: strToMins(a.startTime || '00:00') + (Number(a.duration) || 60) }))
        .sort((a, b) => a.s - b.s);
      // Build open slots in 30-min increments
      const slots = [];
      for (let m = open; m + dur <= close; m += 30) {
        const free = !techAppts.some(t => t.s < m + dur && t.e > m);
        if (free) slots.push(m);
      }
      if (slots.length) {
        out.push({
          date: yyyymmdd,
          dow,
          slots: slots.map(m => ({ startTime: fmtTimeIso(m), durationMinutes: dur })),
        });
      }
      if (out.length >= 14) break; // cap response
    }
    return { availability: out };
  }

  if (action === 'reschedule') {
    const { date, startTime, techName } = payload;
    if (!date || !startTime) throw new HttpsError('invalid-argument', 'date and startTime required');
    // Tight self-check: don't allow rescheduling INTO the past or onto a
    // collision with another appt on the same tech.
    const newApptMs = new Date(`${date}T${startTime}:00`).getTime();
    if (newApptMs < Date.now()) throw new HttpsError('invalid-argument', 'Cannot reschedule to a past time');
    const dur = (appt.services || []).reduce((s, sv) => s + (Number(sv.duration) || 0), 0) || (Number(appt.duration) || 60);
    const useTechName = techName || appt.techName;
    const collSnap = await db.collection(`tenants/${tid}/appointments`).where('date', '==', date).get();
    const newStart = strToMins(startTime);
    const newEnd   = newStart + dur;
    const collide = collSnap.docs.map(x => ({ id: x.id, ...x.data() })).some(a =>
      a.id !== appt.id &&
      a.techName === useTechName &&
      a.status !== 'cancelled' &&
      (() => {
        const s = strToMins(a.startTime || '00:00');
        const e = s + (Number(a.duration) || 60);
        return s < newEnd && e > newStart;
      })()
    );
    if (collide) throw new HttpsError('failed-precondition', 'That slot is no longer available — pick another time.');
    await apptRef.update({
      date,
      startTime,
      ...(techName && techName !== appt.techName ? { techName } : {}),
      rescheduledAt:    new Date().toISOString(),
      rescheduledBy:    'client_self_service',
      updatedAt:        new Date().toISOString(),
    });
    return { ok: true, newDate: date, newStartTime: startTime };
  }

  throw new HttpsError('invalid-argument', `Unknown action: ${action}`);
});

exports.sendReviewRequestEmail = onDocumentCreated(
  `tenants/${TENANT_ID}/reviewRequests/{reqId}`,
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (!data || data.sent || data.error) return;

    const apiKey = resendKey.value();
    if (!apiKey) { await snap.ref.update({ error: 'resend_not_configured' }); return; }

    const { clientName, clientEmail, googleReviewUrl } = data;
    if (!clientEmail)              { await snap.ref.update({ error: 'no_email' });      return; }
    if (!safeUrl(googleReviewUrl)) { await snap.ref.update({ error: 'no_review_url' }); return; }

    const firstName   = (clientName || 'there').split(' ')[0];
    const reqId       = snap.id;
    const trackUrl    = `https://us-central1-meraki-salon-manager.cloudfunctions.net/trackReviewClick?r=${encodeURIComponent(reqId)}`;
    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">We'd love your feedback</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${esc(firstName)}! 💅</p>
      <p style="font-size:14px;line-height:1.7;color:#555;margin:0 0 24px;">
        Thank you so much for visiting us at Meraki Nail Studio! We hope you loved your nails.
        If you have a moment, leaving us a Google review would mean the world to us and helps
        other clients find us.
      </p>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${esc(trackUrl)}" style="display:inline-block;background:#f59e0b;color:#fff;font-size:14px;font-weight:700;padding:13px 32px;border-radius:10px;text-decoration:none;letter-spacing:.01em;">
          ⭐ Leave a Google Review
        </a>
        <p style="font-size:11px;color:#bbb;margin:10px 0 0;">It only takes 30 seconds and helps us so much 🙏</p>
      </div>
      <p style="font-size:12px;color:#aaa;line-height:1.6;margin:0;">
        We can't wait to see you again soon!<br>— The Meraki Nail Studio Team
      </p>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div>
</body>
</html>`;

    try {
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from:    resendFrom.value(),
        to:      clientEmail,
        subject: `How was your visit? We'd love your feedback 💅`,
        html,
      });
      if (error) throw new Error(error.message || JSON.stringify(error));
      await snap.ref.update({ sent: true, sentAt: new Date().toISOString() });
      console.log(`[ReviewRequest] Sent to ${clientName} (${clientEmail})`);

      // Notify the tech who served this client (best-effort)
      if (data.techName) {
        const db = getFirestore();
        const empSnap = await db.collection(`tenants/${TENANT_ID}/employees`)
          .where('name', '==', data.techName).limit(1).get();
        const techEmail = empSnap.empty ? null : (empSnap.docs[0].data().email || '').trim();
        if (techEmail) {
          const tFirstName = (empSnap.docs[0].data().name || data.techName).split(' ')[0];
          await resend.emails.send({
            from:    resendFrom.value(),
            to:      techEmail,
            subject: `Review request sent to ${clientName}`,
            html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Review Request Sent</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${esc(tFirstName)}!</p>
      <p style="font-size:14px;line-height:1.7;color:#555;margin:0 0 16px;">
        A Google review request was just sent to <strong>${esc(clientName)}</strong>.
        If you see them in the salon, remind them to leave a review — it helps the whole team!
      </p>
      <div style="background:#f0fdf4;border-radius:8px;padding:12px 14px;border:1px solid #bbf7d0;font-size:13px;color:#16a34a;font-weight:600;">
        ⭐ Every review makes a difference — thank you!
      </div>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div></body></html>`,
          }).catch(e => console.error('[ReviewRequest] Tech notify failed:', e.message));
        }
      }
    } catch (e) {
      console.error('[ReviewRequest] Failed:', e.message);
      await snap.ref.update({ error: e.message });
    }
  }
);

exports.sendAccessRequestNotification = onDocumentCreated(
  `tenants/${TENANT_ID}/requests/{uid}`,
  async (event) => {
    const db   = getFirestore();
    const snap = event.data;
    if (!snap) return;

    const req    = snap.data();
    const apiKey = resendKey.value();
    if (!apiKey) return;

    // Find all admin emails from the users data doc
    const usersSnap = await db.doc(`tenants/${TENANT_ID}/data/users`).get();
    const usersData  = usersSnap.exists ? usersSnap.data() : {};
    const admins     = (usersData.users || []).filter(u => u.role === 'admin' && u.email);

    if (!admins.length) return;

    const resend = new Resend(apiKey);
    const name   = req.name || req.email;

    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">New Access Request</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;line-height:1.65;color:#222;margin:0 0 16px;">
        A new user is requesting access to the salon manager app.
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border:1px solid #e8e8e8;font-size:13px;color:#555;">
        <div><strong>Name:</strong> ${esc(name)}</div>
        <div style="margin-top:6px;"><strong>Email:</strong> ${esc(req.email)}</div>
      </div>
      <p style="font-size:13px;color:#888;margin:16px 0 0;">
        Log in to the Admin panel to approve or deny this request.
      </p>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div>
</body>
</html>`;

    await Promise.all(admins.map(admin =>
      resend.emails.send({
        from:    resendFrom.value(),
        to:      admin.email,
        subject: `Access request — ${name}`,
        html,
      }).catch(e => console.error('[AccessReq] Email to', admin.email, 'failed:', e.message))
    ));

    console.log(`[AccessReq] Notified ${admins.length} admin(s) about ${req.email}`);
  }
);

exports.sendApptNotification = onDocumentCreated(
  `tenants/${TENANT_ID}/notifications/{notifId}`,
  async (event) => {
    const db   = getFirestore();
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    if (!data || data.sent || data.error) return;

    const ref = snap.ref;

    try {
      // Look up tech email from employee record
      const empSnap = await db
        .collection(`tenants/${TENANT_ID}/employees`)
        .where('name', '==', data.techName)
        .limit(1)
        .get();

      if (empSnap.empty) {
        await ref.update({ error: 'employee_not_found' });
        return;
      }

      const email = (empSnap.docs[0].data().email || '').trim();
      if (!email) {
        await ref.update({ error: 'no_email' });
        return;
      }

      const apiKey = resendKey.value();
      if (!apiKey) {
        console.warn('[Notif] RESEND_API_KEY not set — skipping email for', data.techName);
        await ref.update({ error: 'resend_not_configured' });
        return;
      }

      const resend   = new Resend(apiKey);
      const isHandbookReminder = data.changeType === 'handbook_reminder';
      const subject  = isHandbookReminder
        ? `Action required: Sign the ${data.handbookTitle || 'Employee Handbook'}`
        : buildSubject(data.changeType, data.clientName, data.date);
      const html     = isHandbookReminder
        ? buildHandbookReminderHtml(data, empSnap.docs[0].data().name)
        : buildHtml(data);
      const { error } = await resend.emails.send({
        from:    resendFrom.value(),
        to:      email,
        subject,
        html,
      });

      if (error) throw new Error(error.message || JSON.stringify(error));

      await ref.update({ sent: true, sentAt: new Date().toISOString(), sentTo: email });
      console.log(`[Notif] Email sent to ${data.techName} (${email})`);
    } catch (e) {
      console.error('[Notif] Email failed:', e.message);
      await ref.update({ error: e.message });
    }
  }
);

// ── Daily client appointment reminders ─────────────────
// Runs every day at 9 AM Eastern. Sends a reminder email to every client
// with a scheduled appointment the following day. Marks appointments with
// reminderSent: true to prevent duplicate sends on retries.

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function buildReminderHtml(appt, client) {
  const dateStr  = `${esc(fmtDate(appt.date))} at ${esc(fmtTime(appt.startTime))}`;
  const services = (appt.services || []).map(s => s.name).filter(Boolean).join(', ') || 'Nail services';
  const duration = appt.duration ? `${appt.duration} min` : '';
  const manageLink = apptManageUrl(TENANT_ID, appt.id);
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Appointment Reminder</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${esc(client.name?.split(' ')[0] || client.name)}!</p>
      <p style="font-size:14px;line-height:1.65;color:#555;margin:0 0 20px;">
        Just a reminder that you have an appointment <strong>tomorrow</strong> at Meraki Nail Studio.
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:16px;border:1px solid #e8e8e8;">
        <div style="font-size:13px;color:#333;margin-bottom:8px;display:flex;gap:10px;">
          <span>📅</span><span><strong>${dateStr}</strong></span>
        </div>
        <div style="font-size:13px;color:#333;margin-bottom:8px;display:flex;gap:10px;">
          <span>💅</span><span>${esc(services)}${duration ? ` <span style="color:#aaa">(${esc(duration)})</span>` : ''}</span>
        </div>
        <div style="font-size:13px;color:#333;margin-bottom:8px;display:flex;gap:10px;">
          <span>👩‍💼</span><span>with ${esc(appt.techName)}</span>
        </div>
        <div style="font-size:13px;color:#333;display:flex;gap:10px;">
          <span>📍</span><span>Columbus, OH</span>
        </div>
      </div>
      ${manageLink ? `<div style="text-align:center;margin:18px 0 0;">
        <a href="${esc(manageLink)}" style="display:inline-block;background:#5b3b8c;color:#fff;font-size:13px;font-weight:600;padding:11px 24px;border-radius:10px;text-decoration:none;">
          Reschedule or cancel
        </a>
      </div>` : ''}
      <p style="font-size:11px;color:#aaa;margin:14px 0 0;line-height:1.5;text-align:center;">
        Need help? Reply to this email or call the salon.
      </p>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div>
</body>
</html>`;
}

function buildMeetingReminderHtml(meeting, participantName, timeLabel) {
  const firstName = (participantName || 'Team').split(' ')[0];
  const dateStr   = `${esc(fmtDate(meeting.date))} at ${esc(fmtTime(meeting.startTime))}`;
  const durLabel  = meeting.duration ? `${meeting.duration} min` : '';
  // description is the only field that should keep newlines as <br>; escape
  // first, then convert escaped newlines to <br> so script can't sneak in.
  const descHtml  = meeting.description
    ? esc(meeting.description).replace(/\n/g, '<br>')
    : '';
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Meeting Reminder — starting in ${esc(timeLabel)}</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${esc(firstName)}!</p>
      <p style="font-size:14px;line-height:1.65;color:#555;margin:0 0 20px;">
        Your meeting is starting in <strong>${esc(timeLabel)}</strong>. See you there!
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:16px;border:1px solid #e8e8e8;">
        <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:10px;">${esc(meeting.title)}</div>
        <div style="font-size:13px;color:#555;margin-bottom:6px;">📅 ${dateStr}${durLabel ? ` (${esc(durLabel)})` : ''}</div>
        ${meeting.location ? `<div style="font-size:13px;color:#555;margin-bottom:6px;">📍 ${esc(meeting.location)}</div>` : ''}
        ${descHtml ? `<div style="font-size:12px;color:#888;margin-top:8px;line-height:1.5;">${descHtml}</div>` : ''}
      </div>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendMeetingReminderBatch(resend, meeting, participants, timeLabel, ref, flag) {
  const withEmail = (participants || []).filter(p => p.email);
  await Promise.all(withEmail.map(p =>
    resend.emails.send({
      from:    resendFrom.value(),
      to:      p.email,
      subject: `Starting in ${timeLabel}: ${meeting.title}`,
      html:    buildMeetingReminderHtml(meeting, p.name, timeLabel),
    }).catch(e => console.error('[MeetingReminders] Email to', p.email, 'failed:', e.message))
  ));
  await ref.update({ [`reminders.${flag}`]: true });
  console.log(`[MeetingReminders] ${timeLabel} reminders sent for "${meeting.title}" to ${withEmail.length} participant(s)`);
}

exports.sendMeetingReminders = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'America/New_York' },
  async () => {
    const db     = getFirestore();
    const apiKey = resendKey.value();
    if (!apiKey) { console.warn('[MeetingReminders] RESEND_API_KEY not set — skipping'); return; }

    const today = new Date().toISOString().slice(0, 10);
    const snap  = await db.collection(`tenants/${TENANT_ID}/meetings`)
      .where('date', '>=', today)
      .get();

    const resend    = new Resend(apiKey);
    const now       = Date.now();
    let batchesSent = 0;

    for (const docSnap of snap.docs) {
      const meeting = { id: docSnap.id, ...docSnap.data() };
      const { startTimestamp, reminders = {}, participants = [] } = meeting;
      if (!startTimestamp) continue;

      const diffMin = (startTimestamp - now) / 60000;

      if (diffMin >= 55 && diffMin <= 75 && !reminders.sent60) {
        await sendMeetingReminderBatch(resend, meeting, participants, '1 hour',     docSnap.ref, 'sent60');
        batchesSent++;
      }
      if (diffMin >= 10 && diffMin <= 25 && !reminders.sent15) {
        await sendMeetingReminderBatch(resend, meeting, participants, '15 minutes', docSnap.ref, 'sent15');
        batchesSent++;
      }
    }

    console.log(`[MeetingReminders] Checked ${snap.size} meetings, sent ${batchesSent} reminder batch(es)`);
  }
);

exports.sendDailyReminders = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'America/New_York' },
  async () => {
    const db     = getFirestore();
    const apiKey = resendKey.value();

    if (!apiKey) {
      console.warn('[Reminders] RESEND_API_KEY not set — skipping');
      return;
    }

    const tomorrow = tomorrowStr();
    console.log('[Reminders] Checking appointments for', tomorrow);

    // Fetch all of tomorrow's appointments (filter status + reminderSent client-side
    // to avoid needing a composite index)
    const apptSnap = await db
      .collection(`tenants/${TENANT_ID}/appointments`)
      .where('date', '==', tomorrow)
      .get();

    const toRemind = apptSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => a.status === 'scheduled' && a.clientId && !a.reminderSent);

    if (!toRemind.length) {
      console.log('[Reminders] Nothing to send for', tomorrow);
      return;
    }

    // Batch-fetch unique clients
    const clientIds = [...new Set(toRemind.map(a => a.clientId))];
    const clientSnaps = await Promise.all(
      clientIds.map(id => db.doc(`tenants/${TENANT_ID}/clients/${id}`).get())
    );
    const clientMap = {};
    clientSnaps.forEach(snap => { if (snap.exists) clientMap[snap.id] = snap.data(); });

    const resend = new Resend(apiKey);
    let sent = 0, skipped = 0;

    await Promise.all(toRemind.map(async appt => {
      const client = clientMap[appt.clientId];
      const email  = client?.email?.trim();

      if (!email) { skipped++; return; }
      // Honor the client's appointment-email preference. Default to opted-in
      // when the field is missing (legacy clients).
      if (client?.commPreferences?.appointmentEmail === false) {
        skipped++;
        console.log(`[Reminders] Skipping ${client.name} — opted out of appointment email`);
        return;
      }

      try {
        const { error } = await resend.emails.send({
          from:    resendFrom.value(),
          to:      email,
          subject: `Reminder: Your appointment tomorrow at Meraki Nail Studio`,
          html:    buildReminderHtml(appt, client),
        });

        if (error) throw new Error(error.message || JSON.stringify(error));

        await db.doc(`tenants/${TENANT_ID}/appointments/${appt.id}`)
          .update({ reminderSent: true, reminderSentAt: new Date().toISOString() });

        sent++;
        console.log(`[Reminders] Sent to ${client.name} (${email})`);
      } catch (e) {
        console.error(`[Reminders] Failed for ${client?.name}:`, e.message);
      }
    }));

    console.log(`[Reminders] Done for ${tomorrow}. Sent: ${sent}, Skipped (no email): ${skipped}`);
  }
);

// ── Tech appointment reminders (T-minus N min) ─────────
// Runs every 5 minutes. Looks for scheduled appts that start within
// `leadMinutes` (default 15) and aren't yet flagged techReminderSent.
// Sends an email + optional SMS to the assigned tech, then marks the appt.
exports.sendTechAppointmentReminders = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'America/New_York',
  },
  async () => {
    const db = getFirestore();
    const sDoc = await db.doc(`tenants/${TENANT_ID}/data/settings`).get();
    const cfg  = ((sDoc.exists ? sDoc.data() : {}).techReminders) || {};
    if (cfg.enabled === false) {
      console.log('[TechReminders] Disabled via settings — skipping');
      return;
    }
    const leadMin = Number(cfg.leadMinutes) > 0 ? Number(cfg.leadMinutes) : 15;
    const channel = cfg.channel || 'email'; // 'email' | 'sms' | 'both'

    // "now" in salon timezone
    const tz = 'America/New_York';
    const now = new Date();
    const localToday = now.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
    const hm = now.toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
    const [h, m] = hm.split(':').map(Number);
    const nowMins   = h * 60 + m;
    const upperMins = nowMins + leadMin;

    const apptSnap = await db
      .collection(`tenants/${TENANT_ID}/appointments`)
      .where('date', '==', localToday)
      .get();

    const candidates = apptSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => {
      if (a.status !== 'scheduled') return false;
      if (a.techReminderSent) return false;
      if (!a.startTime || !a.techName) return false;
      const [ah, am] = String(a.startTime).split(':').map(Number);
      if (!Number.isFinite(ah) || !Number.isFinite(am)) return false;
      const sm = ah * 60 + am;
      return sm > nowMins && sm <= upperMins;
    });

    if (!candidates.length) {
      console.log(`[TechReminders] Nothing pending at ${hm} (lead=${leadMin}m)`);
      return;
    }

    const empSnap = await db.collection(`tenants/${TENANT_ID}/employees`).get();
    const empByName = {};
    empSnap.docs.forEach(d => { const e = d.data(); if (e.name) empByName[e.name] = e; });

    const apiKey = resendKey.value();
    const resend = apiKey ? new Resend(apiKey) : null;

    const twSid       = twilioSid.value();
    const twToken     = twilioToken.value();
    const twApiKeySid = twilioApiKeySid.value();
    const twFrom      = twilioFrom.value();
    const smsClient = (twSid && twToken && twFrom)
      ? require('twilio')(twApiKeySid || twSid, twToken, twApiKeySid ? { accountSid: twSid } : undefined)
      : null;

    let emailsSent = 0, smsSent = 0, skipped = 0;

    for (const appt of candidates) {
      const emp = empByName[appt.techName];
      if (!emp || emp.techReminderOptOut) { skipped++; continue; }

      const [ah, am] = appt.startTime.split(':').map(Number);
      const apptMins = ah * 60 + am;
      const minutesAway = Math.max(0, apptMins - nowMins);
      const startLabel = (() => {
        const hh = ah > 12 ? ah - 12 : ah === 0 ? 12 : ah;
        const ampm = ah >= 12 ? 'PM' : 'AM';
        return `${hh}:${String(am).padStart(2, '0')} ${ampm}`;
      })();
      const services = (appt.services || []).map(s => s.name).filter(Boolean).join(', ') || 'no services listed';
      const clientLabel = appt.clientName || 'Walk-in';

      const wantsEmail = (channel === 'email' || channel === 'both');
      const wantsSms   = (channel === 'sms'   || channel === 'both');

      // Email
      if (wantsEmail && resend && emp.email) {
        try {
          const subject = `[${minutesAway}m] ${clientLabel} at ${startLabel} — ${services}`;
          const html = buildAutoEmail(
            'Upcoming appointment',
            emp.name?.split(' ')[0] || 'there',
            `<p style="font-size:14px;color:#222;margin:0 0 12px;">Heads-up — your next appointment starts in <strong>${minutesAway} minute${minutesAway === 1 ? '' : 's'}</strong>.</p>
             <table style="width:100%;border-collapse:collapse;font-size:14px;color:#222;margin:0 0 12px;">
               <tr><td style="padding:6px 0;color:#888;width:90px;">Time</td><td style="padding:6px 0;font-weight:600;">${startLabel}</td></tr>
               <tr><td style="padding:6px 0;color:#888;">Client</td><td style="padding:6px 0;font-weight:600;">${clientLabel}</td></tr>
               <tr><td style="padding:6px 0;color:#888;">Services</td><td style="padding:6px 0;">${services}</td></tr>
               ${appt.notes ? `<tr><td style="padding:6px 0;color:#888;">Notes</td><td style="padding:6px 0;font-style:italic;">${String(appt.notes).slice(0, 280)}</td></tr>` : ''}
             </table>`,
            null, null
          );
          const { error } = await resend.emails.send({
            from: resendFrom.value(),
            to: emp.email.trim(),
            subject,
            html,
          });
          if (error) throw new Error(error.message || JSON.stringify(error));
          emailsSent++;
        } catch (e) {
          console.error(`[TechReminders] Email failed for ${emp.name}:`, e.message);
        }
      }

      // SMS
      if (wantsSms && smsClient && emp.phone) {
        try {
          const phone = normalizePhone(emp.phone);
          if (phone) {
            const body = `Meraki: ${clientLabel} at ${startLabel} (in ${minutesAway} min) — ${services.slice(0, 80)}`;
            await smsClient.messages.create({ from: twFrom, to: phone, body });
            smsSent++;
          }
        } catch (e) {
          console.error(`[TechReminders] SMS failed for ${emp.name}:`, e.message);
        }
      }

      await db.doc(`tenants/${TENANT_ID}/appointments/${appt.id}`).update({
        techReminderSent: true,
        techReminderSentAt: new Date().toISOString(),
      });
    }

    console.log(`[TechReminders] ${candidates.length} due. emails:${emailsSent} sms:${smsSent} skipped:${skipped}`);
  }
);

exports.sendBookingConfirmation = onDocumentCreated(
  `tenants/${TENANT_ID}/appointments/{apptId}`,
  async (event) => {
    const db   = getFirestore();
    const snap = event.data;
    if (!snap) return;

    const appt = snap.data();
    if (!appt || appt.source !== 'online_booking') return;

    const apiKey = resendKey.value();
    if (!apiKey) return;

    // appt.* fields here come from the public booking form (anyone can submit
    // an appointment doc). Every interpolation below MUST be HTML-escaped so
    // an attacker can't inject markup into mail sent from the verified domain.
    const resend    = new Resend(apiKey);
    const firstName = (appt.clientName || 'there').split(' ')[0];
    const dateStr   = `${esc(fmtDate(appt.date))} at ${esc(fmtTime(appt.startTime))}`;
    const svcName   = appt.services?.[0]?.name || 'Nail service';
    const techLine  = appt.techName && appt.techName !== 'TBD' ? appt.techName : 'an available stylist';
    const manageLink = apptManageUrl(TENANT_ID, event.params?.apptId || snap.id);

    const clientHtml = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Booking Confirmation</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${esc(firstName)}!</p>
      <p style="font-size:14px;line-height:1.65;color:#555;margin:0 0 20px;">
        Your appointment has been booked. We can't wait to see you!
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border:1px solid #e8e8e8;">
        <div style="font-size:13px;color:#555;margin-bottom:8px;"><strong>📅</strong> ${dateStr}</div>
        <div style="font-size:13px;color:#555;margin-bottom:8px;"><strong>💅</strong> ${esc(svcName)}</div>
        <div style="font-size:13px;color:#555;margin-bottom:8px;"><strong>👩‍💼</strong> With ${esc(techLine)}</div>
        <div style="font-size:13px;color:#555;"><strong>📍</strong> Meraki Nail Studio, Columbus OH</div>
      </div>
      ${manageLink ? `<div style="text-align:center;margin:18px 0 0;">
        <a href="${esc(manageLink)}" style="display:inline-block;background:#5b3b8c;color:#fff;font-size:13px;font-weight:600;padding:11px 24px;border-radius:10px;text-decoration:none;">
          Reschedule or cancel
        </a>
      </div>` : ''}
      <p style="font-size:11px;color:#aaa;margin:14px 0 0;text-align:center;">Or reply to this email — we'll take care of you.</p>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div>
</body>
</html>`;

    // Send to client — honor commPreferences.appointmentEmail if set on
    // the linked client doc. Defaults to opted-in for legacy/unknown clients.
    if (appt.clientEmail) {
      let emailOk = true;
      if (appt.clientId) {
        try {
          const cDoc = await db.doc(`tenants/${TENANT_ID}/clients/${appt.clientId}`).get();
          if (cDoc.exists && cDoc.data()?.commPreferences?.appointmentEmail === false) emailOk = false;
        } catch { /* fall through — assume opted-in */ }
      }
      if (emailOk) {
        await resend.emails.send({
          from:    resendFrom.value(),
          to:      appt.clientEmail,
          subject: `Booking confirmed — ${fmtDate(appt.date)} at ${fmtTime(appt.startTime)}`,
          html:    clientHtml,
        }).catch(e => console.error('[Booking] Client email failed:', e.message));
      } else {
        console.log(`[Booking] Skipped client email — opted out of appointment email`);
      }
    }

    // Notify admins
    try {
      const usersSnap = await db.doc(`tenants/${TENANT_ID}/data/users`).get();
      const admins    = ((usersSnap.exists ? usersSnap.data().users : []) || []).filter(u => u.role === 'admin' && u.email);
      if (admins.length) {
        const adminHtml = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">New Online Booking</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:14px;line-height:1.65;color:#222;margin:0 0 16px;">
        A new appointment was booked online.
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border:1px solid #e8e8e8;font-size:13px;color:#555;">
        <div style="margin-bottom:6px;"><strong>Client:</strong> ${esc(appt.clientName)}${appt.clientPhone ? ' · ' + esc(appt.clientPhone) : ''}</div>
        <div style="margin-bottom:6px;"><strong>Date:</strong> ${dateStr}</div>
        <div style="margin-bottom:6px;"><strong>Service:</strong> ${esc(svcName)}</div>
        <div><strong>Stylist:</strong> ${esc(appt.techName || 'TBD')}</div>
      </div>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div>
</body>
</html>`;
        await Promise.all(admins.map(a =>
          resend.emails.send({
            from:    resendFrom.value(),
            to:      a.email,
            subject: `New online booking — ${appt.clientName} on ${fmtDate(appt.date)}`,
            html:    adminHtml,
          }).catch(e => console.error('[Booking] Admin email failed:', e.message))
        ));
      }
    } catch (e) { console.error('[Booking] Admin notify error:', e.message); }

    // Write in-app notification for admin notification center
    try {
      await db.collection(`tenants/${TENANT_ID}/notifications`).add({
        changeType:  'online_booking',
        clientName:  appt.clientName  || '',
        clientPhone: appt.clientPhone || '',
        clientEmail: appt.clientEmail || '',
        date:        appt.date        || '',
        startTime:   appt.startTime   || '',
        techName:    appt.techName    || 'TBD',
        serviceName: appt.services?.[0]?.name || '',
        apptId:      event.params.apptId,
        message:     `${appt.services?.[0]?.name || 'Nail service'} on ${fmtDate(appt.date)} at ${fmtTime(appt.startTime)} with ${appt.techName || 'TBD'}`,
        createdAt:   new Date().toISOString(),
        sent:        true,
      });
    } catch (e) { console.error('[Booking] In-app notif failed:', e.message); }

    console.log(`[Booking] Processed booking for ${appt.clientName} on ${appt.date}`);
  }
);

exports.generateAnnual1099s = onSchedule(
  { schedule: '0 10 30 1 *', timeZone: 'America/New_York' },
  async () => {
    const db   = getFirestore();
    const year = new Date().getFullYear() - 1; // January 30 = generate for prior year

    const start = `${year}-01-01`;
    const end   = `${year}-12-31`;

    const runsSnap = await db.collection(`tenants/${TENANT_ID}/payrollRuns`)
      .where('endDate', '>=', start)
      .where('endDate', '<=', end)
      .get();

    const totals = {};
    runsSnap.docs.forEach(d => {
      (d.data().techs || []).forEach(t => {
        if (!t.techName) return;
        totals[t.techName] = (totals[t.techName] || 0) + (Number(t.total) || 0);
      });
    });

    // Fetch employees for contact/tax info
    const empSnaps = await db.collection(`tenants/${TENANT_ID}/employees`).get();
    const empMap = {};
    empSnaps.docs.forEach(d => { empMap[d.data().name] = d.data(); });

    // Fetch settings for payer info
    const settingsSnap = await db.doc(`tenants/${TENANT_ID}/data/settings`).get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    const payer = {
      name:    settings.salonName    || 'Meraki Nail Studio',
      address: settings.salonAddress || 'Columbus, OH',
      ein:     settings.ein          || '',
    };

    let count = 0;
    for (const [techName, totalEarnings] of Object.entries(totals)) {
      const emp = empMap[techName] || {};
      const id  = `${year}_${techName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      await db.collection(`tenants/${TENANT_ID}/taxForms`).doc(id).set({
        year,
        techName,
        techEmail:       emp.email   || '',
        techAddress:     emp.address || '',
        techTaxId:       emp.taxId   || '',
        totalEarnings:   Math.round(totalEarnings * 100) / 100,
        federalWithheld: 0,
        payer,
        generatedAt:     new Date().toISOString(),
        generatedBy:     'auto',
        updatedAt:       new Date().toISOString(),
      }, { merge: true });
      count++;
    }

    console.log(`[1099s] Generated ${count} forms for ${year}`);
  }
);

exports.sendChatNotification = onDocumentCreated(
  `tenants/${TENANT_ID}/chatNotifications/{notifId}`,
  async (event) => {
    const db   = getFirestore();
    const snap = event.data;
    if (!snap) return;

    const data   = snap.data();
    const apiKey = resendKey.value();
    if (!apiKey) return;

    const usersSnap = await db.doc(`tenants/${TENANT_ID}/data/users`).get();
    const admins    = ((usersSnap.exists ? usersSnap.data().users : []) || []).filter(u => u.role === 'admin' && u.email);
    if (!admins.length) return;

    const resend    = new Resend(apiKey);
    const firstName = (data.clientName || 'A client').split(' ')[0];
    const preview   = (data.preview || '').slice(0, 120);

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">New Client Message</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">New message from ${esc(data.clientName || 'a client')}</p>
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border:1px solid #e8e8e8;margin:12px 0;">
        <div style="font-size:13px;color:#555;font-style:italic;">"${esc(preview)}"</div>
      </div>
      <p style="font-size:13px;color:#888;margin:0;">Open the Meraki app and go to <strong>Messages</strong> to reply.</p>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div></body></html>`;

    await Promise.all(admins.map(a =>
      resend.emails.send({
        from:    resendFrom.value(),
        to:      a.email,
        subject: `New message from ${data.clientName || 'a client'}`,
        html,
      }).catch(e => console.error('[ChatNotif] Email to', a.email, 'failed:', e.message))
    ));

    console.log(`[ChatNotif] Notified ${admins.length} admin(s) — message from ${data.clientName}`);
  }
);

exports.sendReviewReceivedNotification = onDocumentCreated(
  `tenants/${TENANT_ID}/reviewReceived/{docId}`,
  async (event) => {
    const db   = getFirestore();
    const snap = event.data;
    if (!snap) return;

    const data   = snap.data();
    const apiKey = resendKey.value();
    if (!apiKey) return;

    const stars = '★'.repeat(data.rating || 5) + '☆'.repeat(5 - (data.rating || 5));

    const usersSnap = await db.doc(`tenants/${TENANT_ID}/data/users`).get();
    const admins    = ((usersSnap.exists ? usersSnap.data().users : []) || []).filter(u => u.role === 'admin' && u.email);

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#f59e0b,#f97316);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.85);font-size:12px;margin-top:2px;">New Google Review</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">⭐ New review from ${esc(data.clientName || 'a client')}!</p>
      <div style="background:#fffbeb;border-radius:8px;padding:14px 16px;border:1px solid #fde68a;margin:12px 0;">
        <div style="font-size:20px;color:#f59e0b;margin-bottom:6px;letter-spacing:2px;">${stars}</div>
        ${data.techName ? `<div style="font-size:13px;color:#555;">Serviced by <strong>${esc(data.techName)}</strong></div>` : ''}
        ${data.date ? `<div style="font-size:12px;color:#aaa;margin-top:4px;">${esc(data.date)}</div>` : ''}
      </div>
      <p style="font-size:13px;color:#888;margin:0;">Open the client's profile in the Meraki app to view the full review.</p>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div></body></html>`;

    const recipients = [...admins];

    // Also notify the tech if specified
    if (data.techName) {
      const empSnap = await db.collection(`tenants/${TENANT_ID}/employees`)
        .where('name', '==', data.techName).limit(1).get();
      if (!empSnap.empty) {
        const techEmail = (empSnap.docs[0].data().email || '').trim();
        if (techEmail && !recipients.find(r => r.email === techEmail)) {
          recipients.push({ email: techEmail, name: data.techName });
        }
      }
    }

    const resend = new Resend(apiKey);
    await Promise.all(recipients.map(r =>
      resend.emails.send({
        from:    resendFrom.value(),
        to:      r.email,
        subject: `New ${data.rating || 5}-star Google review — ${data.clientName || 'client'}`,
        html,
      }).catch(e => console.error('[ReviewReceived] Email to', r.email, 'failed:', e.message))
    ));

    console.log(`[ReviewReceived] Notified ${recipients.length} recipient(s) for ${data.clientName}`);
  }
);

// ── Fetch + cache Google Reviews ────────────────────────
// Called from Admin → Webfront tab. Requires GOOGLE_MAPS_API_KEY to be set:
//   firebase functions:config:set google.maps_api_key="AIza..."
// (or via Firebase console → Functions → Configuration)
exports.refreshGoogleReviews = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');

  const placeId = (request.data || {}).placeId;
  if (!placeId) throw new HttpsError('invalid-argument', 'placeId is required');

  const apiKey = mapsApiKey.value();
  if (!apiKey) {
    throw new HttpsError(
      'failed-precondition',
      'GOOGLE_MAPS_API_KEY is not configured. Set it in Firebase Console → Functions → Configuration.'
    );
  }

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,rating,user_ratings_total,reviews&key=${apiKey}`;
  const res  = await fetch(url);
  const json = await res.json();

  if (json.status !== 'OK') {
    throw new HttpsError('internal', `Places API: ${json.status}${json.error_message ? ' — ' + json.error_message : ''}`);
  }

  const result  = json.result || {};
  const reviews = (result.reviews || []).map(r => ({
    name:      r.author_name              || 'Google Reviewer',
    rating:    r.rating                   || 5,
    text:      r.text                     || '',
    date:      r.relative_time_description|| '',
    photoUrl:  r.profile_photo_url        || null,
    authorUrl: r.author_url               || null,
  }));

  const db = getFirestore();
  await db.doc(`tenants/${TENANT_ID}/data/googleReviews`).set({
    placeId,
    reviews,
    rating:          result.rating              || null,
    userRatingCount: result.user_ratings_total  || null,
    refreshedAt:     new Date().toISOString(),
  });

  console.log(`[GoogleReviews] Cached ${reviews.length} reviews · rating ${result.rating} (${result.user_ratings_total} total)`);
  return { count: reviews.length, rating: result.rating, total: result.user_ratings_total };
});

// ── AI Chatbot ────────────────────────────────────────

exports.chatWithSalon = onCall(
  { secrets: [anthropicKey], cors: true },
  async (request) => {
    const apiKey = anthropicKey.value();
    if (!apiKey) throw new HttpsError('unavailable', 'AI not configured');

    const { messages = [] } = request.data;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpsError('invalid-argument', 'messages required');
    }
    if (messages.length > 30) throw new HttpsError('invalid-argument', 'Too many messages');

    const db = getFirestore();

    // Load live salon context from Firestore
    const [wfSnap, svcSnap, settingsSnap] = await Promise.all([
      db.doc(`tenants/${TENANT_ID}/data/webfront`).get(),
      db.collection(`tenants/${TENANT_ID}/services`).get(),
      db.doc(`tenants/${TENANT_ID}/data/settings`).get(),
    ]);

    const cfg      = wfSnap.exists      ? wfSnap.data()      : {};
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    const services = svcSnap.docs.map(d => d.data());

    const hours = cfg.hours || {};
    const hoursText = [
      ['Monday',    hours.mon],
      ['Tuesday',   hours.tue],
      ['Wednesday', hours.wed],
      ['Thursday',  hours.thu],
      ['Friday',    hours.fri],
      ['Saturday',  hours.sat],
      ['Sunday',    hours.sun],
    ].filter(([, v]) => v).map(([d, v]) => `  ${d}: ${v}`).join('\n');

    // Group services by category
    const svcByCategory = {};
    services.forEach(s => {
      const cat = s.category || 'Services';
      if (!svcByCategory[cat]) svcByCategory[cat] = [];
      svcByCategory[cat].push(s);
    });
    const svcText = Object.entries(svcByCategory).map(([cat, svcs]) => {
      const lines = svcs.map(s => {
        const price = s.basePrice ?? s.price;
        const priceStr = price != null ? ` — ${s.priceFrom ? 'from ' : ''}$${price}` : '';
        const dur = s.duration ?? s.durationMin;
        const durStr = dur ? ` · ${dur}min${s.durationMin && !s.duration ? '+' : ''}` : '';
        return `    • ${s.name}${priceStr}${durStr}${s.description ? ` (${s.description})` : ''}`;
      }).join('\n');
      return `  ${cat}:\n${lines}`;
    }).join('\n\n');

    const bookingUrl = settings.bookingUrl || cfg.bookingUrl || 'https://meraki-salon-manager.web.app/?book';
    const phone      = cfg.phone || '';
    const address    = cfg.address || '5029 Olentangy River Rd, Columbus, OH 43214';
    const instagram  = cfg.instagram ? `@${cfg.instagram}` : '@meraki_cbus';

    const systemPrompt = `You are a friendly, helpful assistant for Meraki Nail Studio, a nail salon in Columbus, Ohio.

Your role: answer questions about services, pricing, hours, booking, the team, and anything else a visitor might ask. Help them book an appointment or find what they need quickly.

Keep responses warm, concise, and conversational — 1-3 short paragraphs max. Never make up services or prices that aren't listed below. If you don't know something specific, direct them to call or book online.

━━━ SALON INFO ━━━
Address: ${address}
Phone: ${phone || 'See website for contact info'}
Instagram: ${instagram}
Book online: ${bookingUrl}

━━━ HOURS ━━━
${hoursText || 'See website for hours'}

━━━ SERVICES & PRICING ━━━
${svcText || 'See website for full service menu'}

━━━ CANCELLATION POLICY ━━━
${cfg.policy || 'Appointments canceled with less than 24 hours notice may incur a cancellation fee.'}`;

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system:     systemPrompt,
      messages:   messages.map(m => ({ role: m.role, content: m.content })),
    });

    return { reply: response.content[0]?.text || '' };
  }
);

// ── Reports AI chatbot (admin-only, read-only) ────────
// Lets the salon owner ask natural-language questions about their data.
// Hard read-only: no mutate methods imported, no write tools exposed.
exports.chatWithReports = onCall(
  { secrets: [anthropicKey], cors: true, timeoutSeconds: 90 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const apiKey = anthropicKey.value();
    if (!apiKey) throw new HttpsError('unavailable', 'AI not configured');

    const { messages = [] } = request.data || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpsError('invalid-argument', 'messages required');
    }
    if (messages.length > 20) throw new HttpsError('invalid-argument', 'Too many messages');

    const db = getFirestore();
    const APPTS    = `tenants/${TENANT_ID}/appointments`;
    const RECEIPTS = `tenants/${TENANT_ID}/receipts`;
    const CLIENTS  = `tenants/${TENANT_ID}/clients`;

    // ── Tool implementations ────────────────────────────
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dowOf = (yyyymmdd) => {
      try { return DOW[new Date(yyyymmdd + 'T12:00:00').getDay()]; }
      catch { return null; }
    };
    const apptRev = (a) => {
      if (Array.isArray(a.services)) {
        return a.services.reduce((s, sv) => s + (Number(sv.price) || 0), 0);
      }
      return 0;
    };

    async function queryAppointments({ startDate, endDate, techName, dayOfWeek, status, clientNameQuery, limit = 10 }) {
      if (!startDate || !endDate) return { error: 'startDate and endDate are required' };
      const snap = await db.collection(APPTS)
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get();
      let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (techName) {
        const t = techName.toLowerCase();
        rows = rows.filter(a => (a.techName || '').toLowerCase().includes(t));
      }
      if (dayOfWeek) {
        const want = dayOfWeek.slice(0, 3).toLowerCase();
        rows = rows.filter(a => (dowOf(a.date) || '').toLowerCase() === want);
      }
      if (status) rows = rows.filter(a => (a.status || '').toLowerCase() === status.toLowerCase());
      if (clientNameQuery) {
        const q = clientNameQuery.toLowerCase();
        rows = rows.filter(a => (a.clientName || '').toLowerCase().includes(q));
      }
      const totalRevenue = rows.reduce((s, a) => s + apptRev(a), 0);
      const cancelled = rows.filter(a => a.status === 'cancelled').length;
      const noShow    = rows.filter(a => a.status === 'no_show').length;
      const done      = rows.filter(a => a.status === 'done').length;
      const sample = rows.slice(0, Math.min(Math.max(1, limit), 50)).map(a => ({
        date: a.date, dayOfWeek: dowOf(a.date), startTime: a.startTime, techName: a.techName,
        clientName: a.clientName || 'Walk-in', status: a.status,
        services: (a.services || []).map(s => s.name).filter(Boolean).join(', '),
        revenue: apptRev(a),
      }));
      return {
        count: rows.length, totalRevenue: Math.round(totalRevenue * 100) / 100,
        cancelled, noShow, done, sample,
      };
    }

    async function getRevenueSummary({ startDate, endDate, groupBy }) {
      if (!startDate || !endDate) return { error: 'startDate and endDate are required' };
      const snap = await db.collection(RECEIPTS)
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get();
      const rows = snap.docs.map(d => d.data());
      // Revenue lives under r.payment, not at the top level. Refunds, voids,
      // and cancellations are negative receipts that should net against sales.
      const isNegative = (r) => r.transactionType === 'refund'
        || r.transactionType === 'void' || r.transactionType === 'cancellation';
      const refundedCount = rows.filter(isNegative).length;
      const totals = rows.reduce((acc, r) => {
        const p   = r.payment || {};
        const sales = Array.isArray(r.services)
          ? r.services.reduce((s, sv) => s + (Number(sv.price) || 0), 0) : 0;
        const sub = Number(p.subtotal) || sales;
        const tax = Number(p.tax) || 0;
        const tip = Number(p.tip) || 0;
        const tot = (p.total !== undefined && p.total !== null)
          ? Number(p.total) || 0
          : (sub + tax + tip);
        const sign = isNegative(r) ? -1 : 1;
        acc.subtotal += sign * sub;
        acc.tax      += sign * tax;
        acc.tip      += sign * tip;
        acc.total    += sign * tot;
        return acc;
      }, { subtotal: 0, tax: 0, tip: 0, total: 0 });
      Object.keys(totals).forEach(k => totals[k] = Math.round(totals[k] * 100) / 100);

      let breakdown = null;
      if (groupBy === 'tech' || groupBy === 'service' || groupBy === 'month' || groupBy === 'day') {
        const buckets = {};
        rows.forEach(r => {
          const p     = r.payment || {};
          const sign  = isNegative(r) ? -1 : 1;
          const lines = Array.isArray(r.services) ? r.services
                       : Array.isArray(r.lineItems) ? r.lineItems : [];
          const recTotal = (p.total !== undefined && p.total !== null)
            ? Number(p.total) || 0
            : lines.reduce((s, l) => s + (Number(l.price) || 0), 0);
          if (groupBy === 'tech' || groupBy === 'service') {
            // Prefer per-line tech/name; fall back to receipt-level techName.
            if (lines.length === 0 && groupBy === 'tech') {
              const key = r.techName || '—';
              buckets[key] = (buckets[key] || 0) + sign * recTotal;
            } else {
              lines.forEach(li => {
                const key = groupBy === 'tech'
                  ? (li.techName || r.techName || '—')
                  : (li.name || li.service || '—');
                const amt = Number(li.price) || 0;
                buckets[key] = (buckets[key] || 0) + sign * amt;
              });
            }
          } else {
            const d = r.date || '';
            const key = groupBy === 'month' ? d.slice(0, 7) : d;
            buckets[key] = (buckets[key] || 0) + sign * recTotal;
          }
        });
        breakdown = Object.entries(buckets)
          .map(([k, v]) => ({ key: k, total: Math.round(v * 100) / 100 }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 30);
      }
      return { receiptCount: rows.length, refundedOrCancelled: refundedCount, ...totals, breakdown };
    }

    async function getTopClients({ startDate, endDate, sortBy = 'visits', limit = 10 }) {
      if (!startDate || !endDate) return { error: 'startDate and endDate are required' };
      const snap = await db.collection(APPTS)
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get();
      const byClient = {};
      snap.docs.forEach(d => {
        const a = d.data();
        if (!a.clientId || !a.clientName || a.clientName === 'Walk-in') return;
        if (a.status === 'cancelled') return;
        const k = a.clientId;
        if (!byClient[k]) byClient[k] = { clientId: k, name: a.clientName, visits: 0, spend: 0 };
        byClient[k].visits += 1;
        byClient[k].spend  += apptRev(a);
      });
      const list = Object.values(byClient)
        .map(c => ({ ...c, spend: Math.round(c.spend * 100) / 100 }))
        .sort((a, b) => sortBy === 'spend' ? b.spend - a.spend : b.visits - a.visits)
        .slice(0, Math.min(Math.max(1, limit), 50));
      return { clients: list, totalUniqueClients: Object.keys(byClient).length };
    }

    async function getClientHistory({ nameQuery, limit = 5 }) {
      if (!nameQuery) return { error: 'nameQuery is required' };
      const cSnap = await db.collection(CLIENTS).get();
      const q = nameQuery.toLowerCase();
      const matches = cSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => (c.name || '').toLowerCase().includes(q))
        .slice(0, Math.min(Math.max(1, limit), 10));
      const out = [];
      for (const c of matches) {
        const aSnap = await db.collection(APPTS).where('clientId', '==', c.id).get();
        const appts = aSnap.docs.map(d => d.data())
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const lastVisit = appts.find(a => a.status === 'done' || a.status === 'scheduled');
        const totalSpend = appts.reduce((s, a) => s + apptRev(a), 0);
        out.push({
          name: c.name, phone: c.phone || null, email: c.email || null,
          birthday: c.birthday || null, banned: !!c.banned,
          totalAppts: appts.length,
          totalSpend: Math.round(totalSpend * 100) / 100,
          lastVisitDate: lastVisit?.date || null,
          recentVisits: appts.slice(0, 5).map(a => ({
            date: a.date, tech: a.techName, status: a.status,
            services: (a.services || []).map(s => s.name).filter(Boolean).join(', '),
          })),
        });
      }
      return { matches: out };
    }

    const TOOLS = [
      {
        name: 'queryAppointments',
        description: 'Count and filter appointments by date range, tech, day of week, status, or client name. Returns count, totals, and a sample of matching rows. Use this for questions like "how many appointments did Tess D have on Saturdays last year".',
        input_schema: {
          type: 'object',
          properties: {
            startDate: { type: 'string', description: 'YYYY-MM-DD inclusive lower bound' },
            endDate:   { type: 'string', description: 'YYYY-MM-DD inclusive upper bound' },
            techName:  { type: 'string', description: 'Substring match against techName, case-insensitive' },
            dayOfWeek: { type: 'string', description: 'Sun/Mon/Tue/Wed/Thu/Fri/Sat (or full name)' },
            status:    { type: 'string', description: 'scheduled/done/cancelled/no_show/in-progress' },
            clientNameQuery: { type: 'string', description: 'Substring match against clientName' },
            limit:     { type: 'number', description: 'Max rows in sample (default 10, max 50)' },
          },
          required: ['startDate', 'endDate'],
        },
      },
      {
        name: 'getRevenueSummary',
        description: 'Sum revenue (subtotal/tax/tip/total) from receipts in a date range. Optionally break down by tech, service, day, or month.',
        input_schema: {
          type: 'object',
          properties: {
            startDate: { type: 'string' }, endDate: { type: 'string' },
            groupBy: { type: 'string', enum: ['tech', 'service', 'day', 'month'] },
          },
          required: ['startDate', 'endDate'],
        },
      },
      {
        name: 'getTopClients',
        description: 'Top clients by visit count or spend within a date range.',
        input_schema: {
          type: 'object',
          properties: {
            startDate: { type: 'string' }, endDate: { type: 'string' },
            sortBy: { type: 'string', enum: ['visits', 'spend'] },
            limit:  { type: 'number', description: 'Default 10, max 50' },
          },
          required: ['startDate', 'endDate'],
        },
      },
      {
        name: 'getClientHistory',
        description: 'Look up a client by fuzzy name match. Returns up to 5 matches each with profile info, total visits, total spend, and recent visit details.',
        input_schema: {
          type: 'object',
          properties: {
            nameQuery: { type: 'string' },
            limit: { type: 'number', description: 'Max matches, default 5' },
          },
          required: ['nameQuery'],
        },
      },
    ];

    const TOOL_DISPATCH = { queryAppointments, getRevenueSummary, getTopClients, getClientHistory };

    const today = new Date().toISOString().slice(0, 10);
    const systemPrompt = `You are a read-only analytics assistant for Meraki Nail Studio (a nail salon in Columbus, OH).

You answer questions about salon data — appointments, revenue, clients, techs — using the tools provided. You CANNOT modify any record, send messages, or change any setting. If asked to do so, decline and explain you're read-only.

Today is ${today}. When the user references relative time ("last year", "this past month", "year-to-date"), translate it to explicit YYYY-MM-DD ranges before calling tools.

When using tools:
- Always pick the smallest date window that answers the question.
- Be precise with names — fuzzy matching is on, but obvious typos are still your job to resolve.
- If a tool returns 0 rows, double-check whether the date range or filter might be wrong.
- After getting tool results, answer in 1–4 short paragraphs. For lists, use compact bullets. Format numbers with $ and commas.
- Never fabricate values not in tool output. If you didn't call a tool, say so.`;

    const client = new Anthropic({ apiKey });
    let convo = messages.map(m => ({ role: m.role, content: m.content }));
    let toolRounds = 0;

    while (true) {
      const resp = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system:     systemPrompt,
        tools:      TOOLS,
        messages:   convo,
      });

      const stopReason = resp.stop_reason;
      const blocks = resp.content || [];

      if (stopReason !== 'tool_use') {
        const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        return { reply: text };
      }

      // Append assistant turn (with tool_use blocks) and run tools.
      convo.push({ role: 'assistant', content: blocks });
      const toolResults = [];
      for (const b of blocks) {
        if (b.type !== 'tool_use') continue;
        const fn = TOOL_DISPATCH[b.name];
        let result;
        try {
          result = fn ? await fn(b.input || {}) : { error: `Unknown tool: ${b.name}` };
        } catch (e) {
          result = { error: e.message || 'Tool failed' };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: b.id,
          content: JSON.stringify(result),
        });
      }
      convo.push({ role: 'user', content: toolResults });

      toolRounds += 1;
      if (toolRounds >= 6) {
        // Hard cap to prevent runaway loops; force a final answer next round.
        const final = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          system: systemPrompt + '\n\nDo not call any more tools — answer with what you have.',
          messages: convo,
        });
        const text = (final.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        return { reply: text };
      }
    }
  }
);

// ── Voice Command AI (admin/scheduler only) ───────────
// Takes a transcribed voice command from the front desk, parses intent,
// resolves entities (which client / which tech / which appt), and returns
// a structured "proposed action" the frontend confirms + executes.
// HARD RULE: this function never writes to Firestore. It only reads to
// resolve entities. The frontend executes the confirmed action through
// existing client-side helpers, so all writes go through Firestore rules.
exports.voiceCommand = onCall(
  { secrets: [anthropicKey], cors: true, timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const apiKey = anthropicKey.value();
    if (!apiKey) throw new HttpsError('unavailable', 'AI not configured');

    const { transcript, role = 'admin' } = request.data || {};
    if (!transcript || typeof transcript !== 'string') {
      throw new HttpsError('invalid-argument', 'transcript required');
    }
    if (transcript.length > 500) {
      throw new HttpsError('invalid-argument', 'transcript too long');
    }

    const db = getFirestore();
    const APPTS    = `tenants/${TENANT_ID}/appointments`;
    const CLIENTS  = `tenants/${TENANT_ID}/clients`;
    const EMPS     = `tenants/${TENANT_ID}/employees`;
    const SVCS     = `tenants/${TENANT_ID}/services`;

    const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const fmtTime = (m) => {
      const h = Math.floor(m / 60), mm = m % 60;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
      return `${hh}:${String(mm).padStart(2, '0')} ${ampm}`;
    };
    const strToMins = (s) => {
      if (!s) return 0;
      const [h, m] = s.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };

    // ── Read-only entity-resolution tools ───────────────
    async function searchClients({ nameQuery, limit = 5 }) {
      if (!nameQuery) return { matches: [] };
      const snap = await db.collection(CLIENTS).get();
      const q = nameQuery.toLowerCase();
      const matches = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => (c.name || '').toLowerCase().includes(q) && !c.banned)
        .slice(0, Math.min(limit, 10))
        .map(c => ({ id: c.id, name: c.name, phone: c.phone || null, email: c.email || null }));
      return { matches };
    }

    async function listEmployees() {
      const snap = await db.collection(EMPS).get();
      const techs = snap.docs.map(d => d.data())
        .filter(e => e.active !== false && e.name)
        .map(e => ({
          name: e.name,
          serviceIds: e.serviceIds || [],
          workDays: e.workDays || {},
        }));
      return { techs };
    }

    async function listServices() {
      const snap = await db.collection(SVCS).get();
      const services = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.active !== false)
        .map(s => ({ id: s.id, name: s.name, duration: s.duration || 60, basePrice: s.basePrice ?? null }));
      return { services };
    }

    async function viewSchedule({ date, techName }) {
      if (!date) return { error: 'date required (YYYY-MM-DD)' };
      const snap = await db.collection(APPTS).where('date', '==', date).get();
      let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (techName) {
        const t = techName.toLowerCase();
        rows = rows.filter(a => (a.techName || '').toLowerCase().includes(t));
      }
      rows.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      return {
        date,
        appointments: rows.map(a => ({
          id: a.id,
          startTime: a.startTime,
          startTimeFormatted: a.startTime ? fmtTime(strToMins(a.startTime)) : '',
          duration: a.duration || 60,
          techName: a.techName,
          clientName: a.clientName || 'Walk-in',
          status: a.status,
          services: (a.services || []).map(s => s.name).filter(Boolean).join(', '),
        })),
      };
    }

    async function findAppointment({ clientNameQuery, techName, date }) {
      if (!date) return { error: 'date required (YYYY-MM-DD)' };
      const snap = await db.collection(APPTS).where('date', '==', date).get();
      let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (techName) {
        const t = techName.toLowerCase();
        rows = rows.filter(a => (a.techName || '').toLowerCase().includes(t));
      }
      if (clientNameQuery) {
        const q = clientNameQuery.toLowerCase();
        rows = rows.filter(a => (a.clientName || '').toLowerCase().includes(q));
      }
      rows = rows.filter(a => a.status !== 'cancelled');
      rows.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      return {
        matches: rows.slice(0, 5).map(a => ({
          id: a.id,
          startTime: a.startTime,
          startTimeFormatted: a.startTime ? fmtTime(strToMins(a.startTime)) : '',
          duration: a.duration || 60,
          techName: a.techName,
          clientName: a.clientName || 'Walk-in',
          status: a.status,
          services: (a.services || []).map(s => s.name).filter(Boolean).join(', '),
          checkedInAt: a.checkedInAt || null,
        })),
      };
    }

    async function findOpenSlots({ techName, date, durationMinutes = 60, preferredStartTime }) {
      if (!techName || !date) return { error: 'techName and date required' };
      const snap = await db.collection(APPTS).where('date', '==', date).get();
      const techAppts = snap.docs.map(d => d.data())
        .filter(a => a.techName === techName && a.status !== 'cancelled')
        .map(a => ({ start: strToMins(a.startTime || '00:00'), end: strToMins(a.startTime || '00:00') + (Number(a.duration) || 60) }))
        .sort((a, b) => a.start - b.start);
      // Default working window 9am-8pm
      const dayStart = 9 * 60, dayEnd = 20 * 60;
      const slots = [];
      let cursor = dayStart;
      for (const a of techAppts) {
        if (a.start - cursor >= durationMinutes) {
          slots.push(cursor);
        }
        cursor = Math.max(cursor, a.end);
      }
      if (dayEnd - cursor >= durationMinutes) slots.push(cursor);
      // If preferred time given, sort by closeness; else first 6
      let chosen = slots;
      if (preferredStartTime) {
        const target = strToMins(preferredStartTime);
        chosen = [...slots].sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
      }
      return {
        techName, date, durationMinutes,
        openSlots: chosen.slice(0, 6).map(m => ({ startTime: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, formatted: fmtTime(m) })),
      };
    }

    // ── Finalize: this is the LAST tool the model calls ─
    async function finalizeAction(payload) {
      // Just echo back the proposed action — frontend handles execution.
      return { ok: true, ...payload };
    }

    const TOOLS = [
      {
        name: 'searchClients',
        description: 'Find clients by partial name match. Use when the user mentions a client name to resolve to a clientId.',
        input_schema: { type: 'object', properties: { nameQuery: { type: 'string' }, limit: { type: 'number' } }, required: ['nameQuery'] },
      },
      {
        name: 'listEmployees',
        description: 'List all active techs (with their serviceIds + workDays). Use when the user mentions a tech name to confirm spelling and capabilities.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'listServices',
        description: 'List all active services (with id, name, duration, basePrice). Use when the user mentions a service name.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'viewSchedule',
        description: 'Read the schedule for a specific date and optional tech. Use for "what does X have today" or "show me Y\'s schedule" questions.',
        input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, techName: { type: 'string' } }, required: ['date'] },
      },
      {
        name: 'findAppointment',
        description: 'Find an existing appointment by client name, tech, and/or date. Use when the user wants to reschedule, cancel, or check-in a specific appt.',
        input_schema: { type: 'object', properties: { clientNameQuery: { type: 'string' }, techName: { type: 'string' }, date: { type: 'string' } }, required: ['date'] },
      },
      {
        name: 'findOpenSlots',
        description: 'Find available time slots for a tech on a date with a given duration. Use to suggest booking times.',
        input_schema: { type: 'object', properties: { techName: { type: 'string' }, date: { type: 'string' }, durationMinutes: { type: 'number' }, preferredStartTime: { type: 'string', description: 'HH:mm 24h' } }, required: ['techName', 'date'] },
      },
      {
        name: 'finalizeAction',
        description: 'Call this LAST when you have all the info to propose an action to the user. The user will confirm or cancel before any changes happen. Available actionTypes: "book" | "reschedule" | "cancel" | "checkIn" | "view" | "unsupported".',
        input_schema: {
          type: 'object',
          properties: {
            actionType: { type: 'string', enum: ['book', 'reschedule', 'cancel', 'checkIn', 'view', 'unsupported'] },
            summary: { type: 'string', description: 'A one-sentence plain-English description of what will happen, in present tense. e.g. "Book Sarah Johnson with Tess on Tuesday May 13 at 2:00 PM for Gel Manicure."' },
            payload: {
              type: 'object',
              description: 'Action-specific data. For "book": { clientId, clientName, techName, date, startTime (HH:mm), duration, services: [{name, duration, price}] }. For "reschedule": { apptId, newTechName?, newDate?, newStartTime? }. For "cancel": { apptId }. For "checkIn": { apptId }. For "view": { description, items: [string] } — items MUST be plain readable strings like "10:00 AM — Sarah Johnson — Gel Manicure (60 min)" or "Tess D is fully booked today". Do not put objects in items. For "unsupported": { reason }.',
            },
            naturalReply: { type: 'string', description: 'Short conversational reply to show the user. Used as a header above the confirmation card.' },
          },
          required: ['actionType', 'summary', 'payload', 'naturalReply'],
        },
      },
    ];

    const TOOL_DISPATCH = { searchClients, listEmployees, listServices, viewSchedule, findAppointment, findOpenSlots, finalizeAction };

    const systemPrompt = `You are a voice assistant for Meraki Nail Studio's front desk. The user just spoke a command into a phone microphone. Your job: parse intent, resolve entities, and call finalizeAction with a structured proposal that the user will confirm before any change happens.

Today is ${todayISO} (timezone America/New_York). When the user says "today" / "tomorrow" / "next Tuesday" / "this Friday", convert to explicit YYYY-MM-DD.

User's role: ${role}. Tech-role users can only do "view" and "checkIn" actions. Admins/schedulers can do all.

Process:
1. Identify the intent: book / reschedule / cancel / checkIn / view / unsupported
2. Resolve entities by calling searchClients, listEmployees, listServices, viewSchedule, findAppointment, or findOpenSlots as needed
3. Call finalizeAction with the complete payload

Critical rules:
- Times must be 24h "HH:mm" format. "2pm" → "14:00".
- Always resolve client/tech names to exact matches via searchClients/listEmployees before finalizing. If multiple clients match, pick the one with the most recent activity OR set actionType="unsupported" with reason="multiple matches" listing them.
- For booking: services array must include duration and price. Look services up via listServices.
- If the user's request is unclear or impossible, set actionType="unsupported" with a clear reason.
- Be concise in summary + naturalReply.
- Don't ask follow-up questions in this turn — make a best-effort proposal. The user will see the confirmation card and can correct.

You MUST call finalizeAction exactly once at the end.`;

    const client = new Anthropic({ apiKey });
    let convo = [{ role: 'user', content: transcript }];
    let toolRounds = 0;

    while (true) {
      const resp = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system:     systemPrompt,
        tools:      TOOLS,
        messages:   convo,
      });

      const blocks = resp.content || [];
      const stopReason = resp.stop_reason;

      // Look for the finalizeAction call → terminal state
      const finalize = blocks.find(b => b.type === 'tool_use' && b.name === 'finalizeAction');
      if (finalize) {
        const out = finalize.input || {};
        return {
          actionType:  out.actionType || 'unsupported',
          summary:     out.summary || '',
          payload:     out.payload || {},
          naturalReply: out.naturalReply || '',
          transcript,
        };
      }

      if (stopReason !== 'tool_use') {
        // Model gave up without finalizing
        const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        return {
          actionType: 'unsupported',
          summary: text || 'Could not parse command.',
          payload: { reason: 'no_finalize' },
          naturalReply: text || 'Sorry, I didn\'t catch that.',
          transcript,
        };
      }

      // Run other tools and continue
      convo.push({ role: 'assistant', content: blocks });
      const results = [];
      for (const b of blocks) {
        if (b.type !== 'tool_use') continue;
        const fn = TOOL_DISPATCH[b.name];
        let r;
        try { r = fn ? await fn(b.input || {}) : { error: 'unknown_tool' }; }
        catch (e) { r = { error: e.message || 'tool_failed' }; }
        results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(r) });
      }
      convo.push({ role: 'user', content: results });

      toolRounds += 1;
      if (toolRounds >= 6) {
        return {
          actionType: 'unsupported',
          summary: 'Took too many steps to resolve. Try a more specific command.',
          payload: { reason: 'tool_rounds_exceeded' },
          naturalReply: 'Sorry, that was too complex — try something simpler.',
          transcript,
        };
      }
    }
  }
);

// ── AI-drafted conflict-resolution messages ───────────
// Given a tech's time-off block + the list of affected client appointments,
// drafts personalized SMS + email outreach messages. The frontend reviews,
// edits, then sends via existing sendDirectSms / sendDirectEmail.
// Hard read-only: function never sends — frontend does, after user confirms.
exports.draftConflictMessages = onCall(
  { secrets: [anthropicKey], cors: true, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const apiKey = anthropicKey.value();
    if (!apiKey) throw new HttpsError('unavailable', 'AI not configured');

    const {
      technicianName,
      reason,
      startDate,
      endDate,
      affected = [],
      salonName = 'Meraki Nail Studio',
      salonPhone,
      bookingUrl = 'https://meraki-salon-manager.web.app/?book',
    } = request.data || {};

    if (!technicianName || !Array.isArray(affected) || affected.length === 0) {
      throw new HttpsError('invalid-argument', 'technicianName and affected[] required');
    }
    if (affected.length > 30) {
      throw new HttpsError('invalid-argument', 'Too many appointments to draft at once');
    }

    const fmtDate = (d) => {
      try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
      catch { return d; }
    };
    const fmtTime = (t) => {
      if (!t) return '';
      const [h, m] = t.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
      return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
    };

    const reasonText = reason === 'sick'      ? 'unexpectedly out sick'
                     : reason === 'personal' ? 'taking a personal day'
                     : reason === 'vacation' ? 'on vacation'
                     : 'unavailable';

    // Per-appt magic-link so each client can self-service reschedule/cancel
    // without calling the salon. Drops into both SMS and email drafts.
    const manageLinks = {};
    affected.forEach(a => {
      const link = apptManageUrl(TENANT_ID, a.id);
      if (link) manageLinks[a.id] = link;
    });

    // Build a compact appt-context string for the prompt — include the
    // per-appt manage link so the model can reference it inline.
    const apptList = affected.map((a, idx) => {
      const services = (a.services || []).map(s => s.name || s).filter(Boolean).join(', ') || 'service';
      const newTech = a.newTechName ? ` → reassigned to ${a.newTechName}` : '';
      const specific = a.techRequestType === 'specific' ? ' (specifically requested this tech)' : '';
      const link = manageLinks[a.id] ? `\n   Reschedule/cancel link: ${manageLinks[a.id]}` : '';
      return `${idx + 1}. ID: ${a.id} | ${a.clientName || 'Client'} on ${fmtDate(a.date)} at ${fmtTime(a.startTime)} for ${services}${specific}${newTech}${link}`;
    }).join('\n');

    const systemPrompt = `You draft polite, professional client outreach messages for a salon when a technician is unavailable. Tone: warm, apologetic, action-oriented. Sound like the salon owner, not a robot.

Two outreach scenarios:
1. **Reassigned**: A different tech will cover. Confirm the swap, mention the original tech is out, point them at the per-appt reschedule link if they prefer a different time. End with "reply YES to confirm or use the link to reschedule".
2. **Needs reschedule**: No coverage available. Apologize, explain, include the per-appt reschedule link prominently so they can pick a new time without calling.

Output strict JSON (no other text). Schema:
{
  "drafts": [
    {
      "apptId": "<original id>",
      "scenario": "reassigned" | "reschedule",
      "smsDraft": "<140-200 chars, single message, no emojis except possibly one ❤️ or 🌸 — INCLUDE the reschedule link if provided>",
      "emailSubject": "<short, 8-12 words>",
      "emailDraft": "<3-5 sentences, friendly — INCLUDE the reschedule link as a clickable URL when provided>"
    }
  ]
}

Salon: ${salonName}${salonPhone ? `, phone ${salonPhone}` : ''}. Booking URL: ${bookingUrl}.

Tech ${technicianName} is ${reasonText} ${startDate === endDate ? `on ${fmtDate(startDate)}` : `from ${fmtDate(startDate)} through ${fmtDate(endDate)}`}.

For appts marked "specifically requested" — be a bit more apologetic since the client picked the tech. Offer to wait for ${technicianName}'s next available slot or pick someone else via the reschedule link.

CRITICAL: when a "Reschedule/cancel link" is provided in the appointment context below, include that EXACT URL (full https://...) in BOTH the smsDraft and emailDraft. The link is per-appointment — never share another client's link. Make the URL clearly visible (don't disguise it). For SMS, put the URL on its own line; for email, the URL should be plain text the email client will auto-link.

Keep SMS under 200 characters (so it stays a single segment), but if you must exceed it to include the link, that's acceptable — segments are cheap. Use \\n in SMS for line breaks if needed.

Use the client's first name only. Sign messages "${salonName}".`;

    const userPrompt = `Draft messages for these ${affected.length} affected appointments:

${apptList}

Output the JSON only.`;

    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    // Strip code fences if the model wrapped them
    const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

    let parsed;
    try { parsed = JSON.parse(json); }
    catch (e) {
      console.error('[draftConflictMessages] JSON parse failed:', e.message, 'raw:', raw.slice(0, 500));
      throw new HttpsError('internal', 'AI returned invalid format');
    }

    if (!parsed.drafts || !Array.isArray(parsed.drafts)) {
      throw new HttpsError('internal', 'AI returned no drafts array');
    }

    // Defensive cap on length to prevent runaway tokens
    const drafts = parsed.drafts.slice(0, affected.length).map(d => ({
      apptId:        String(d.apptId || ''),
      scenario:      d.scenario === 'reassigned' ? 'reassigned' : 'reschedule',
      smsDraft:      String(d.smsDraft || '').slice(0, 320),
      emailSubject:  String(d.emailSubject || '').slice(0, 120),
      emailDraft:    String(d.emailDraft || '').slice(0, 1200),
    }));

    return { drafts };
  }
);

// ── Auto-campaigns ────────────────────────────────────

function buildAutoEmail(headerSub, firstName, bodyHtml, ctaText, ctaUrl) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">${headerSub}</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 12px;font-weight:600;">Hi ${firstName}!</p>
      ${bodyHtml}
      ${ctaUrl ? `<div style="text-align:center;margin:24px 0;">
        <a href="${ctaUrl}" style="display:inline-block;background:#2D7A5F;color:#fff;font-size:14px;font-weight:700;padding:13px 32px;border-radius:10px;text-decoration:none;">${ctaText}</a>
      </div>` : ''}
      <p style="font-size:12px;color:#aaa;margin:16px 0 0;">— The Meraki Nail Studio Team</p>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
      <p style="font-size:10px;color:#ccc;margin:4px 0 0;">Reply to unsubscribe.</p>
    </div>
  </div></body></html>`;
}

// Runs daily at 10am Eastern. Sends birthday email to clients whose birthday is today.
// Deduplicates via automationSent collection (one per client per year).
exports.autoBirthdayCampaign = onSchedule(
  { schedule: 'every day 10:00', timeZone: 'America/New_York' },
  async () => {
    const db     = getFirestore();
    const apiKey = resendKey.value();
    if (!apiKey) return;

    const settingsSnap = await db.doc(`tenants/${TENANT_ID}/data/settings`).get();
    const settings     = settingsSnap.exists ? settingsSnap.data() : {};
    if (!settings.autoBirthday) { console.log('[BirthdayAuto] Disabled — skipping'); return; }

    const now  = new Date();
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    const dd   = String(now.getDate()).padStart(2, '0');
    const mdKey = `${mm}-${dd}`;
    const year  = now.getFullYear();

    const clientsSnap = await db.collection(`tenants/${TENANT_ID}/clients`).get();
    const targets = clientsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.email && !c.marketingOptOut && c.birthday && c.birthday.slice(5, 10) === mdKey);

    if (!targets.length) { console.log('[BirthdayAuto] No birthdays today'); return; }

    const resend = new Resend(apiKey);
    let sent = 0;
    for (const client of targets) {
      const sentDocId  = `birthday_${year}_${client.id}`;
      const alreadySent = await db.doc(`tenants/${TENANT_ID}/automationSent/${sentDocId}`).get();
      if (alreadySent.exists) continue;

      const firstName = (client.name || 'there').split(' ')[0];
      const bookingUrl = settings.bookingUrl || 'https://meraki-salon-manager.web.app/?book';
      const body = `<p style="font-size:14px;line-height:1.7;color:#555;margin:0 0 8px;">
        🎉 Happy Birthday! We hope your special day is as fabulous as you are.
        As a little gift from all of us at Meraki, we'd love to treat you to something special this month.
        Come celebrate with us — you deserve it!
      </p>`;
      const html = buildAutoEmail("Happy Birthday! 🎂", firstName, body, "Book Your Birthday Visit", bookingUrl);

      try {
        const { error } = await resend.emails.send({
          from:    resendFrom.value(),
          to:      client.email,
          subject: `Happy Birthday, ${firstName}! 🎂 A gift from Meraki`,
          html,
        });
        if (!error) {
          await db.doc(`tenants/${TENANT_ID}/automationSent/${sentDocId}`).set({
            type: 'birthday', clientId: client.id, clientName: client.name, year, sentAt: new Date().toISOString(),
          });
          sent++;
        }
      } catch (e) { console.error('[BirthdayAuto] Failed for', client.name, ':', e.message); }
    }
    console.log(`[BirthdayAuto] Sent ${sent}/${targets.length} birthday emails`);
  }
);

// Runs every Monday at 11am Eastern. Sends re-engagement email to clients who
// haven't visited in N days. Deduplicates: won't re-email the same client until
// another full lapse window has passed.
exports.autoLapsedCampaign = onSchedule(
  { schedule: 'every monday 11:00', timeZone: 'America/New_York' },
  async () => {
    const db     = getFirestore();
    const apiKey = resendKey.value();
    if (!apiKey) return;

    const settingsSnap = await db.doc(`tenants/${TENANT_ID}/data/settings`).get();
    const settings     = settingsSnap.exists ? settingsSnap.data() : {};
    if (!settings.autoLapsed) { console.log('[LapsedAuto] Disabled — skipping'); return; }

    const lapDays  = settings.autoLapsedDays || 60;
    const now      = new Date();
    const endDate  = now.toISOString().slice(0, 10);
    const startDate = new Date(now - lapDays * 86400000).toISOString().slice(0, 10);
    const cutoffIso = new Date(now - lapDays * 86400000).toISOString();

    const clientsSnap = await db.collection(`tenants/${TENANT_ID}/clients`).get();
    const clients = clientsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.email && !c.marketingOptOut);

    const apptsSnap = await db.collection(`tenants/${TENANT_ID}/appointments`)
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .get();
    const activeIds = new Set(apptsSnap.docs.map(d => d.data().clientId).filter(Boolean));

    const lapsed = clients.filter(c => !activeIds.has(c.id));
    if (!lapsed.length) { console.log('[LapsedAuto] No lapsed clients'); return; }

    const resend = new Resend(apiKey);
    let sent = 0;
    for (const client of lapsed) {
      const sentDocId  = `lapsed_${client.id}`;
      const sentSnap   = await db.doc(`tenants/${TENANT_ID}/automationSent/${sentDocId}`).get();
      if (sentSnap.exists && sentSnap.data().sentAt > cutoffIso) continue;

      const firstName  = (client.name || 'there').split(' ')[0];
      const bookingUrl = settings.bookingUrl || 'https://meraki-salon-manager.web.app/?book';
      const body = `<p style="font-size:14px;line-height:1.7;color:#555;margin:0 0 8px;">
        It's been a while since your last visit, and we genuinely miss you!
        We have exciting new styles and services waiting for you.
        Come back and let us take care of you — your nails (and you!) deserve it.
      </p>`;
      const html = buildAutoEmail("We miss you! 💅", firstName, body, "Book Your Next Visit", bookingUrl);

      try {
        const { error } = await resend.emails.send({
          from:    resendFrom.value(),
          to:      client.email,
          subject: `We miss you, ${firstName}! Come see us 💅`,
          html,
        });
        if (!error) {
          await db.doc(`tenants/${TENANT_ID}/automationSent/${sentDocId}`).set({
            type: 'lapsed', clientId: client.id, clientName: client.name, lapDays, sentAt: new Date().toISOString(),
          });
          sent++;
        }
      } catch (e) { console.error('[LapsedAuto] Failed for', client.name, ':', e.message); }
    }
    console.log(`[LapsedAuto] Sent ${sent}/${lapsed.length} lapsed emails`);
  }
);

exports.createPaymentIntent = onCall({ secrets: [stripeKey] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');

  const { amountCents, description } = request.data || {};
  if (!amountCents || amountCents < 50) throw new HttpsError('invalid-argument', 'Amount must be at least $0.50');

  const key = stripeKey.value();
  if (!key) throw new HttpsError('failed-precondition', 'Stripe is not configured on this server');

  const stripe = require('stripe')(key);
  const paymentIntent = await stripe.paymentIntents.create({
    amount:   Math.round(amountCents),
    currency: 'usd',
    description: description || 'Meraki Nail Studio',
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
  });

  return { clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id };
});

// Tracks when a client clicks the review link in their email, then redirects to Google.
exports.trackReviewClick = onRequest({ cors: false }, async (req, res) => {
  const reqId = String(req.query.r || '');
  const db    = getFirestore();

  // Reject obviously-malformed reqIds before doing a Firestore read.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(reqId)) {
    return res.redirect(302, 'https://g.page/r/review');
  }

  let redirectTo = `https://g.page/r/review`; // fallback
  try {
    const ref  = db.doc(`tenants/${TENANT_ID}/reviewRequests/${reqId}`);
    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data();
      // Only honor http(s) URLs — blocks javascript:/data: and any
      // malformed string an attacker could otherwise plant.
      const candidate = safeUrl(data.googleReviewUrl);
      if (candidate) redirectTo = candidate;
      if (!data.clickedAt) {
        await ref.update({ clickedAt: new Date().toISOString() });
      }
    }
  } catch (e) {
    console.error('[ReviewClick] Error:', e.message);
  }

  res.redirect(302, redirectTo);
});

// ── Tenant onboarding ─────────────────────────────────────────────────────────
// Creates a new tenant record, provisions Firestore data, and sends a welcome email.
// Callable without auth so the public signup page can use it.
exports.createTenantOnboarding = onCall({ cors: true }, async (request) => {
  const { salonName, ownerName, ownerEmail, plan } = request.data || {};
  if (!salonName || !ownerEmail) throw new HttpsError('invalid-argument', 'salonName and ownerEmail are required');

  // Derive slug from salon name
  const base = salonName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'salon';
  const db   = getFirestore();

  // Find an available slug (up to 5 attempts)
  let tenantId = base;
  for (let i = 1; i <= 5; i++) {
    const existing = await db.doc(`tenants/${tenantId}`).get();
    if (!existing.exists) break;
    tenantId = `${base}${i}`;
    if (i === 5) throw new HttpsError('already-exists', 'A salon with a similar name already exists. Please contact support.');
  }

  const now  = new Date().toISOString();
  const url  = `https://${tenantId}.tipflow.app`;
  const planVal = ['starter', 'pro', 'enterprise'].includes(plan) ? plan : 'starter';

  // Create registry doc + provision in parallel
  await Promise.all([
    db.doc(`tenants/${tenantId}`).set({ name: salonName, ownerName: ownerName || '', ownerEmail, plan: planVal, active: true, createdAt: now }),
    db.doc(`tenants/${tenantId}/data/settings`).set({ timeoutMin: 5, createdAt: now }),
    db.doc(`tenants/${tenantId}/data/slides`).set({ slides: [], def: 0, cur: 0 }),
    db.doc(`tenants/${tenantId}/data/users`).set({ users: [{ email: ownerEmail, role: 'admin', uid: '', addedAt: now }] }),
  ]);

  // Send welcome email
  const apiKey = resendKey.value();
  if (apiKey) {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: 'TipFlow <hello@tipflow.app>',
      to:   ownerEmail,
      subject: `Welcome to TipFlow — ${salonName} is ready`,
      html: buildWelcomeHtml(salonName, ownerEmail, tenantId, url),
    }).catch(e => console.error('[Onboarding] welcome email failed:', e.message));
  }

  return { tenantId, url, salonName };
});

function buildWelcomeHtml(salonName, ownerEmail, tenantId, url) {
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f7fa;margin:0;padding:32px 16px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="background:#0f1923;padding:32px;text-align:center">
    <div style="font-size:36px;color:#fff;font-weight:300;letter-spacing:2px">Meraki</div>
    <div style="font-size:11px;color:#3D9E8A;letter-spacing:6px;margin-top:4px">TIPFLOW</div>
  </div>
  <div style="padding:32px">
    <h2 style="color:#1a1a1a;margin:0 0 8px">Your salon is ready 🎉</h2>
    <p style="color:#555;margin:0 0 24px"><strong>${salonName}</strong> has been set up on TipFlow. Here's everything you need to get started.</p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-bottom:24px">
      <div style="font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Your TipFlow URL</div>
      <a href="${url}" style="font-size:18px;color:#2D7A5F;font-weight:700;text-decoration:none">${url}</a>
    </div>

    <h3 style="color:#1a1a1a;margin:0 0 12px;font-size:14px">Getting started checklist</h3>
    <ol style="color:#555;font-size:13px;line-height:2;padding-left:20px;margin:0 0 24px">
      <li>Visit your URL and sign in with Google using <strong>${ownerEmail}</strong></li>
      <li>Add your employees (Employees module)</li>
      <li>Set up your service menu (Services module)</li>
      <li>Configure your public booking page (Admin → Settings)</li>
      <li>Customise your public website (Admin → Webfront)</li>
    </ol>

    <a href="${url}" style="display:block;background:#2D7A5F;color:#fff;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none">Open ${salonName} →</a>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #f0f0f0;font-size:11px;color:#aaa;text-align:center">
    TipFlow · Salon Management Platform · <a href="https://tipflow.app" style="color:#aaa">tipflow.app</a>
  </div>
</div></body></html>`;
}

// ── Config params for new integrations ───────────────────────────────────────
const twilioSid       = defineString('TWILIO_ACCOUNT_SID', { default: '' });
const twilioToken     = defineString('TWILIO_AUTH_TOKEN',  { default: '' }); // master Auth Token OR API Key Secret
const twilioApiKeySid = defineString('TWILIO_API_KEY_SID', { default: '' }); // optional: SKxxx for API Key auth
const twilioFrom      = defineString('TWILIO_FROM',        { default: '' });
const stripePriceId  = defineString('STRIPE_PRO_PRICE_ID',     { default: '' });
const stripeStarterPriceId = defineString('STRIPE_STARTER_PRICE_ID', { default: '' });
const stripeWebhookSecret  = defineSecret('STRIPE_WEBHOOK_SECRET');
const gustoClientId     = defineString('GUSTO_CLIENT_ID',     { default: '' });
const gustoClientSecret = defineString('GUSTO_CLIENT_SECRET', { default: '' });
const gustoRedirectUri  = defineString('GUSTO_REDIRECT_URI',  { default: '' });

// ── SMS Campaigns (Twilio) ────────────────────────────────────────────────────
// Sends to the recipients list the Marketing UI resolved at "Send" time
// (data.recipients). The UI is the single source of truth for audience
// resolution — it knows about every segment type and applies marketingOptOut
// + channel-required-contact filters there. Re-querying here would silently
// send to all clients for any segment the function hadn't been updated to
// recognize.
// Core SMS-send pipeline. Used by both the immediate trigger
// (onDocumentCreated, status='pending') and the scheduled runner
// (onSchedule, picks up status='scheduled' campaigns whose scheduleAt
// is past). The function:
//   - validates Twilio config + recipients
//   - flips status pending → sending
//   - sends each recipient sequentially, capturing per-attempt status,
//     Twilio code/reason for failures, and msg.sid for traceability
//   - flushes progress to Firestore every ~5 attempts or 1.5s so the
//     UI subscription stays live
//   - honors cancelRequested at every flush boundary and at exit
//   - derives counters from the attempts array (cannot diverge)
async function processSMSCampaign(tenantId, docRef, data) {
  const sid       = twilioSid.value();
  const token     = twilioToken.value();
  const apiKeySid = twilioApiKeySid.value();
  const from      = twilioFrom.value();
  if (!sid || !token || !from) {
    await docRef.update({ status: 'failed', error: 'twilio_not_configured' });
    return;
  }

  const recipients = Array.isArray(data.recipients) ? data.recipients : [];
  if (recipients.length === 0) {
    await docRef.update({ status: 'failed', error: 'no_recipients' });
    return;
  }

  const twilioSDK = require('twilio');
  const client = apiKeySid
    ? twilioSDK(apiKeySid, token, { accountSid: sid })
    : twilioSDK(sid, token);

  if (data.cancelRequested) {
    await docRef.update({
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      sentCount: 0, failCount: 0, attemptedCount: 0, attempts: [],
    });
    return;
  }

  await docRef.update({
    status: 'sending',
    startedAt: new Date().toISOString(),
    sentCount: 0,
    failCount: 0,
    attemptedCount: 0,
    attempts: [],
  });

  const attempts = [];
  let lastFlushAt = Date.now();
  const FLUSH_EVERY_N = 5;
  const FLUSH_EVERY_MS = 1500;
  const ATTEMPTS_CAP = 2000;

  function counts() {
    let sent = 0, failed = 0;
    for (const a of attempts) {
      if (a.status === 'sent')        sent++;
      else if (a.status === 'failed') failed++;
    }
    return { sent, failed };
  }

  async function flushProgress() {
    const { sent, failed } = counts();
    const stored = attempts.length > ATTEMPTS_CAP ? attempts.slice(0, ATTEMPTS_CAP) : attempts;
    await docRef.update({
      sentCount: sent,
      failCount: failed,
      attemptedCount: attempts.length,
      attempts: stored,
      attemptsTruncated: attempts.length > ATTEMPTS_CAP,
      lastUpdateAt: new Date().toISOString(),
    });
    lastFlushAt = Date.now();
  }

  for (const r of recipients) {
    const at = new Date().toISOString();
    const phone = normalizePhone(r.phone);
    if (!phone) {
      attempts.push({ name: r.name || '(unknown)', phone: r.phone || '', status: 'failed', code: 'INVALID_PHONE_FORMAT', reason: `Could not normalize phone "${r.phone || ''}" to E.164`, at });
    } else {
      // Personalized promo: generate a unique code bound to this client
      // before formatting the body so {promoCode} can be substituted.
      // Failure to mint a code is non-fatal — we still send the message
      // (just without the code) and log it on the attempt for traceability.
      let promoCode = null;
      let promoMintError = null;
      if (data.promoPersonalize && r.clientId) {
        try {
          const minted = await createPersonalizedPromo(tenantId, {
            prefix:      data.promoPersonalize.prefix,
            type:        data.promoPersonalize.type,
            value:       data.promoPersonalize.value,
            expiresDays: data.promoPersonalize.expiresDays,
            clientId:    r.clientId,
            campaignId:  docRef.id,
          });
          if (minted) promoCode = minted.code;
        } catch (e) {
          promoMintError = e?.message || 'promo_mint_failed';
          console.error(`[processSMSCampaign] promo mint failed for ${r.name}:`, promoMintError);
        }
      }
      const body = substitutePlaceholders(data.smsBody, {
        firstName: r.name?.split(' ')[0] || 'there',
        lastName:  r.name?.split(' ').slice(1).join(' ') || '',
        promoCode: promoCode || '',
      });
      try {
        const msg = await client.messages.create({ body, from, to: phone });
        const tStatus = msg?.status || '';
        if (tStatus === 'failed' || tStatus === 'undelivered') {
          const code   = msg?.errorCode != null ? String(msg.errorCode) : `TWILIO_${tStatus.toUpperCase()}`;
          const reason = msg?.errorMessage || `Twilio reported status: ${tStatus}`;
          console.error(`[processSMSCampaign] ${r.name} ${phone} delivery-failed (no throw) status=${tStatus} code=${code} reason=${reason}`);
          attempts.push({ name: r.name || '(unknown)', phone, status: 'failed', code, reason, twilioStatus: tStatus, twilioSid: msg?.sid || null, promoCode: promoCode || null, at });
          await maybeAutoOptOut(tenantId, r, code, 'twilio_status');
        } else {
          attempts.push({ name: r.name || '(unknown)', phone, status: 'sent', twilioStatus: tStatus || null, twilioSid: msg?.sid || null, promoCode: promoCode || null, at });
        }
      } catch (err) {
        const code = err?.code != null ? String(err.code) : 'UNKNOWN';
        const reason = err?.message || 'Unknown Twilio error';
        console.error(`[processSMSCampaign] ${r.name} ${phone} threw code=${code} reason=${reason}`);
        attempts.push({ name: r.name || '(unknown)', phone, status: 'failed', code, reason, promoCode: promoCode || null, at });
        await maybeAutoOptOut(tenantId, r, code, 'twilio_throw');
      }
    }

    const now = Date.now();
    let cancelled = false;
    if (attempts.length % FLUSH_EVERY_N === 0 || now - lastFlushAt >= FLUSH_EVERY_MS) {
      try { await flushProgress(); } catch (e) { console.error('[processSMSCampaign] progress flush failed:', e); }
      try {
        const cur = await docRef.get();
        if (cur.data()?.cancelRequested) cancelled = true;
      } catch (e) { console.error('[processSMSCampaign] cancel-check read failed:', e); }
    }
    if (cancelled) break;
  }

  const { sent, failed } = counts();
  const failures = attempts.filter(a => a.status === 'failed').slice(0, 200);
  let finalStatus = 'done';
  try {
    const cur = await docRef.get();
    if (cur.data()?.cancelRequested) finalStatus = 'cancelled';
  } catch { /* fall through */ }
  await docRef.update({
    status: finalStatus,
    sentCount: sent,
    failCount: failed,
    attemptedCount: attempts.length,
    attempts: attempts.length > ATTEMPTS_CAP ? attempts.slice(0, ATTEMPTS_CAP) : attempts,
    attemptsTruncated: attempts.length > ATTEMPTS_CAP,
    failures,
    ...(finalStatus === 'cancelled'
        ? { cancelledAt: new Date().toISOString() }
        : { sentAt:      new Date().toISOString() }),
  });
}

exports.sendSMSCampaign = onDocumentCreated(
  `tenants/{tenantId}/campaigns/{campaignId}`,
  async (event) => {
    const data = event.data.data();
    if (data.channel !== 'sms') return;
    // Only fire on immediate sends. Scheduled campaigns are picked up by
    // runScheduledCampaigns once their scheduleAt is past.
    if (data.status !== 'pending') return;
    await processSMSCampaign(event.params.tenantId, event.data.ref, data);
  }
);

// Scheduled-send sweep. Runs every minute, finds SMS campaigns whose
// scheduleAt has passed and are still status='scheduled', and processes
// them. Idempotent: each one is flipped to 'sending' (atomically via a
// status check) before processing so a duplicate sweep can't double-send.
exports.runScheduledCampaigns = onSchedule(
  { schedule: 'every 1 minutes', timeoutSeconds: 540 },
  async () => {
    const db = getFirestore();
    const tenantsSnap = await db.collection('tenants').get();
    const nowIso = new Date().toISOString();

    for (const tDoc of tenantsSnap.docs) {
      let dueSnap;
      try {
        dueSnap = await db.collection(`tenants/${tDoc.id}/campaigns`)
          .where('status', '==', 'scheduled')
          .where('scheduleAt', '<=', nowIso)
          .get();
      } catch (e) {
        console.error(`[runScheduledCampaigns] query failed for tenant ${tDoc.id}:`, e?.message);
        continue;
      }
      for (const cDoc of dueSnap.docs) {
        // Race-safe claim: only ONE sweep instance gets to process this row.
        // Pre-flip to 'sending' inside a transaction; the per-channel
        // processor overwrites startedAt/sentCount/etc. as part of setup.
        let claimedData = null;
        try {
          await db.runTransaction(async (tx) => {
            const cur = await tx.get(cDoc.ref);
            const d = cur.data();
            if (d?.status !== 'scheduled') return;
            tx.update(cDoc.ref, { status: 'sending', releasedAt: nowIso });
            claimedData = d;
          });
        } catch (e) {
          console.error(`[runScheduledCampaigns] claim failed for ${cDoc.id}:`, e?.message);
          continue;
        }
        if (!claimedData) continue;
        try {
          if (claimedData.channel === 'sms') {
            await processSMSCampaign(tDoc.id, cDoc.ref, claimedData);
          } else {
            await processEmailCampaign(tDoc.id, cDoc.ref, claimedData);
          }
        } catch (e) {
          console.error(`[runScheduledCampaigns] processor failed for ${cDoc.id} (${claimedData.channel}):`, e?.message);
          await cDoc.ref.update({ status: 'failed', error: e?.message || 'scheduled_run_failed' }).catch(() => {});
        }
      }
    }
  }
);

// Twilio error codes that signal the recipient has opted out of marketing.
// When seen, we auto-flag the client's marketingOptOut so future audience
// queries skip them — saves API calls and keeps us TCPA-compliant.
//   21610 — recipient previously sent STOP / blacklist
//   30007 — message filtered (often A2P content/STOP-driven)
const OPT_OUT_TWILIO_CODES = new Set(['21610', '30007']);

async function maybeAutoOptOut(tenantId, recipient, code, source) {
  if (!OPT_OUT_TWILIO_CODES.has(String(code))) return;
  if (!recipient?.clientId) return;
  try {
    const db = getFirestore();
    await db.doc(`tenants/${tenantId}/clients/${recipient.clientId}`).update({
      marketingOptOut:    true,
      marketingOptOutAt:  new Date().toISOString(),
      marketingOptOutVia: `sms_stop_keyword_code_${code}`,
      updatedAt:          new Date().toISOString(),
    });
    console.log(`[maybeAutoOptOut] flagged ${recipient.name} (${recipient.clientId}) for code=${code} source=${source}`);
  } catch (e) {
    console.error(`[maybeAutoOptOut] update failed for ${recipient.clientId}:`, e?.message);
  }
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return null;
}

// Generate a unique single-use promo code bound to a specific client.
// Used by personalized-promo campaigns: each recipient gets a unique code
// they (and only they) can redeem. Returns { code, ref } or null on
// failure (caller should still send the message — promo is a bonus, not
// blocker). Code is always uppercase + alphanumeric for SMS friendliness.
async function createPersonalizedPromo(tenantId, params) {
  const { prefix, type, value, expiresDays, clientId, campaignId } = params;
  if (!clientId) return null; // cannot bind a code to nobody
  const crypto = require('crypto');
  const safePrefix = (prefix || 'PROMO').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'PROMO';
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
  const code = `${safePrefix}-${suffix}`;
  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + Math.max(1, expiresDays || 30) * 86400000).toISOString().slice(0, 10);
  const db = getFirestore();
  const ref = db.collection(`tenants/${tenantId}/promoCodes`).doc();
  await ref.set({
    code,
    type:        type === 'amount' ? 'amount' : 'percent',
    value:       Math.max(0, Number(value) || 0),
    clientId,
    campaignId:  campaignId || null,
    active:      true,
    startDate:   start,
    endDate:     end,
    singleUse:   true,
    usedCount:   0,
    _autoGenerated: true,
    _personalized: true,
    createdAt:   new Date().toISOString(),
  });
  return { code, ref };
}

// Apply standard placeholder substitution to a message body. Used by both
// email and SMS paths so the variable set stays consistent.
function substitutePlaceholders(body, vars) {
  let out = body || '';
  if (vars.firstName != null) out = out.replace(/\{firstName\}/gi, vars.firstName);
  if (vars.lastName  != null) out = out.replace(/\{lastName\}/gi,  vars.lastName);
  if (vars.promoCode != null) out = out.replace(/\{promoCode\}/g,  vars.promoCode);
  return out;
}

// ── Stripe Billing ────────────────────────────────────────────────────────────
exports.createCheckoutSession = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { plan, tenantId: tid, successUrl, cancelUrl } = request.data || {};
  const tId = tid || TENANT_ID;

  const key = stripeKey.value ? stripeKey.value() : null;
  if (!key) throw new HttpsError('unavailable', 'Stripe not configured');

  const stripe   = require('stripe')(key);
  const priceId  = plan === 'starter' ? stripeStarterPriceId.value() : stripePriceId.value();
  if (!priceId)  throw new HttpsError('invalid-argument', `Price ID for plan "${plan}" not set`);

  const db      = getFirestore();
  const tenDoc  = await db.doc(`tenants/${tId}`).get();
  const ownerEmail = tenDoc.exists ? tenDoc.data().ownerEmail : request.auth.token.email;

  // Reuse existing Stripe customer if stored
  let customerId = tenDoc.exists ? tenDoc.data().stripeCustomerId : null;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: ownerEmail, metadata: { tenantId: tId } });
    customerId = customer.id;
    await db.doc(`tenants/${tId}`).set({ stripeCustomerId: customerId }, { merge: true });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode:     'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl || 'https://tipflow.app/?stripe=success',
    cancel_url:  cancelUrl  || 'https://tipflow.app/?stripe=cancel',
    metadata: { tenantId: tId, plan },
  });

  return { url: session.url };
});

exports.stripeWebhook = onRequest(
  { secrets: [stripeWebhookSecret] },
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const key = stripeKey.value ? stripeKey.value() : null;
    if (!key) { res.status(500).send('Stripe not configured'); return; }

    let event;
    try {
      const stripe = require('stripe')(key);
      event = stripe.webhooks.constructEvent(req.rawBody, sig, stripeWebhookSecret.value());
    } catch (e) {
      res.status(400).send(`Webhook signature failed: ${e.message}`);
      return;
    }

    const db = getFirestore();
    const obj = event.data.object;

    if (event.type === 'checkout.session.completed') {
      // Two flavors of checkout.session.completed land here:
      //   1. SaaS subscription (tipflow plan) — metadata.type !== 'membership'
      //   2. Salon membership subscription — metadata.type === 'membership'
      if (obj.metadata?.type === 'membership') {
        const tid          = obj.metadata.tenantId || TENANT_ID;
        const membershipId = obj.metadata.membershipId;
        if (membershipId) {
          await db.doc(`tenants/${tid}/memberships/${membershipId}`).set({
            status:                 'active',
            stripeSubscriptionId:   obj.subscription,
            stripeCustomerId:       obj.customer,
            paidAt:                 new Date().toISOString(),
            updatedAt:              new Date().toISOString(),
          }, { merge: true });
          // Persist customer ID on the client too for next-time reuse
          if (obj.customer) {
            const memSnap = await db.doc(`tenants/${tid}/memberships/${membershipId}`).get();
            const clientId = memSnap.data()?.clientId;
            if (clientId) {
              await db.doc(`tenants/${tid}/clients/${clientId}`).set({ stripeCustomerId: obj.customer }, { merge: true });
            }
          }
        }
      } else {
        // SaaS subscription
        const tenantId = obj.metadata?.tenantId;
        const plan     = obj.metadata?.plan || 'pro';
        if (tenantId) {
          await db.doc(`tenants/${tenantId}/data/settings`).set({ plan }, { merge: true });
          await db.doc(`tenants/${tenantId}`).set({ plan, stripeSubscriptionId: obj.subscription }, { merge: true });
        }
      }
    }

    // Subscription lifecycle: active / past_due / cancelled / unpaid
    if (event.type === 'customer.subscription.updated') {
      // Try membership first (per-tenant subcollection lookup)
      const tid = obj.metadata?.tenantId || TENANT_ID;
      const membershipId = obj.metadata?.membershipId;
      if (membershipId) {
        const status = obj.status === 'active' ? 'active'
                     : obj.status === 'past_due' ? 'past_due'
                     : obj.status === 'canceled' ? 'cancelled'
                     : obj.status === 'unpaid' ? 'past_due'
                     : obj.status === 'paused' ? 'paused'
                     : obj.status;
        await db.doc(`tenants/${tid}/memberships/${membershipId}`).set({
          status,
          cancelAtPeriodEnd: !!obj.cancel_at_period_end,
          currentPeriodEnd:  obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null,
          updatedAt:         new Date().toISOString(),
        }, { merge: true });
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      // Membership branch: stamp cancelled
      const tid = obj.metadata?.tenantId || TENANT_ID;
      const membershipId = obj.metadata?.membershipId;
      if (membershipId) {
        await db.doc(`tenants/${tid}/memberships/${membershipId}`).set({
          status:      'cancelled',
          cancelledAt: new Date().toISOString(),
          updatedAt:   new Date().toISOString(),
        }, { merge: true });
      } else {
        // SaaS: fall back to existing tenant search
        const snap = await db.collection('tenants')
          .where('stripeSubscriptionId', '==', obj.id).limit(1).get();
        if (!snap.empty) {
          const t = snap.docs[0].id;
          await db.doc(`tenants/${t}/data/settings`).set({ plan: 'starter' }, { merge: true });
          await db.doc(`tenants/${t}`).set({ plan: 'starter' }, { merge: true });
        }
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const tid = obj.metadata?.tenantId || obj.subscription_details?.metadata?.tenantId;
      const subId = obj.subscription;
      if (subId && tid) {
        const memSnap = await db.collection(`tenants/${tid}/memberships`)
          .where('stripeSubscriptionId', '==', subId).limit(1).get();
        if (!memSnap.empty) {
          await memSnap.docs[0].ref.set({
            status:    'past_due',
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
      }
    }

    res.json({ received: true });
  }
);

// Create a Stripe Checkout Session for a salon-client membership subscription.
// Auto-creates the Stripe Product + Price for the plan if one doesn't exist
// yet, and reuses the client's Stripe Customer if we have one.
exports.createMembershipCheckout = onCall({ cors: true, secrets: [stripeKey] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { membershipId, successUrl, cancelUrl, tenantId: tid } = request.data || {};
  const tenantId = tid || TENANT_ID;
  if (!membershipId) throw new HttpsError('invalid-argument', 'membershipId required');

  const key = stripeKey.value();
  if (!key) throw new HttpsError('unavailable', 'Stripe not configured');
  const stripe = require('stripe')(key);
  const db     = getFirestore();

  const memRef = db.doc(`tenants/${tenantId}/memberships/${membershipId}`);
  const memSnap = await memRef.get();
  if (!memSnap.exists) throw new HttpsError('not-found', 'Membership not found');
  const mem = { id: memSnap.id, ...memSnap.data() };

  const planSnap = await db.doc(`tenants/${tenantId}/membershipPlans/${mem.planId}`).get();
  if (!planSnap.exists) throw new HttpsError('not-found', 'Plan not found');
  const plan = { id: planSnap.id, ...planSnap.data() };

  const clientSnap = await db.doc(`tenants/${tenantId}/clients/${mem.clientId}`).get();
  if (!clientSnap.exists) throw new HttpsError('not-found', 'Client not found');
  const client = { id: clientSnap.id, ...clientSnap.data() };

  // Ensure Stripe Product + Price exist for this plan
  let stripePriceId = plan.stripePriceId;
  if (!stripePriceId) {
    const product = plan.stripeProductId
      ? await stripe.products.retrieve(plan.stripeProductId).catch(() => null)
      : await stripe.products.create({ name: plan.name, metadata: { tenantId, planId: plan.id } });
    const price = await stripe.prices.create({
      product:  product.id,
      unit_amount: Math.round((Number(plan.price) || 0) * 100),
      currency: 'usd',
      recurring: { interval: plan.billingPeriod === 'yearly' ? 'year' : 'month' },
      metadata: { tenantId, planId: plan.id },
    });
    stripePriceId = price.id;
    await db.doc(`tenants/${tenantId}/membershipPlans/${plan.id}`).set({
      stripeProductId: product.id,
      stripePriceId:   price.id,
    }, { merge: true });
  }

  // Ensure Stripe Customer for this client
  let stripeCustomerId = client.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: client.email || undefined,
      name:  client.name || undefined,
      phone: client.phone || undefined,
      metadata: { tenantId, clientId: client.id },
    });
    stripeCustomerId = customer.id;
    await db.doc(`tenants/${tenantId}/clients/${client.id}`).set({ stripeCustomerId }, { merge: true });
  }

  const baseUrl = (publicAppUrl.value() || 'https://meraki-salon-manager.web.app').replace(/\/+$/, '');
  const session = await stripe.checkout.sessions.create({
    customer:   stripeCustomerId,
    mode:       'subscription',
    line_items: [{ price: stripePriceId, quantity: 1 }],
    success_url: successUrl || `${baseUrl}/?membership=success`,
    cancel_url:  cancelUrl  || `${baseUrl}/?membership=cancel`,
    metadata: {
      type:         'membership',
      tenantId,
      membershipId: mem.id,
      clientId:     client.id,
      planId:       plan.id,
    },
    // Forward the same metadata to the underlying Subscription so webhook
    // events for status updates can route back to the right membership doc.
    subscription_data: {
      metadata: { type: 'membership', tenantId, membershipId: mem.id, clientId: client.id, planId: plan.id },
    },
  });

  // Stamp the membership doc so the admin UI shows that a payment link was generated
  await memRef.set({
    paymentLinkUrl:       session.url,
    paymentLinkCreatedAt: new Date().toISOString(),
    updatedAt:            new Date().toISOString(),
  }, { merge: true });

  return { url: session.url };
});

// Generate a Stripe Customer Portal session for a member to manage billing
// (cancel, update card, view invoices).
exports.createMembershipPortal = onCall({ cors: true, secrets: [stripeKey] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { membershipId, returnUrl, tenantId: tid } = request.data || {};
  const tenantId = tid || TENANT_ID;

  const key = stripeKey.value();
  if (!key) throw new HttpsError('unavailable', 'Stripe not configured');
  const stripe = require('stripe')(key);
  const db     = getFirestore();

  const memSnap = await db.doc(`tenants/${tenantId}/memberships/${membershipId}`).get();
  if (!memSnap.exists) throw new HttpsError('not-found', 'Membership not found');
  const mem = memSnap.data();
  if (!mem.stripeCustomerId) throw new HttpsError('failed-precondition', 'No Stripe customer for this member yet');

  const baseUrl = (publicAppUrl.value() || 'https://meraki-salon-manager.web.app').replace(/\/+$/, '');
  const session = await stripe.billingPortal.sessions.create({
    customer:   mem.stripeCustomerId,
    return_url: returnUrl || baseUrl,
  });

  return { url: session.url };
});

// Email the Stripe Checkout payment link to a member's client. Frontend
// passes the URL it got from createMembershipCheckout, plus the plan name.
// Sends the branded transactional email and stamps the membership doc.
exports.emailMembershipPaymentLink = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { membershipId, url, tenantId: tid } = request.data || {};
  const tenantId = tid || TENANT_ID;
  if (!membershipId || !url) throw new HttpsError('invalid-argument', 'membershipId and url required');

  const apiKey = resendKey.value();
  if (!apiKey) throw new HttpsError('unavailable', 'Resend not configured');
  const db = getFirestore();

  const memSnap = await db.doc(`tenants/${tenantId}/memberships/${membershipId}`).get();
  if (!memSnap.exists) throw new HttpsError('not-found', 'Membership not found');
  const mem = memSnap.data();
  const planSnap = await db.doc(`tenants/${tenantId}/membershipPlans/${mem.planId}`).get();
  const clientSnap = await db.doc(`tenants/${tenantId}/clients/${mem.clientId}`).get();
  if (!planSnap.exists || !clientSnap.exists) throw new HttpsError('not-found', 'Plan or client missing');
  const plan = planSnap.data();
  const client = clientSnap.data();
  if (!client.email) throw new HttpsError('failed-precondition', 'Client has no email on file');

  const resend  = new Resend(apiKey);
  const firstName = (client.name || 'there').split(' ')[0];
  const html = buildAutoEmail(
    `${plan.name} membership`,
    firstName,
    `<p style="font-size:14px;color:#222;margin:0 0 12px;">You're all set to join the <strong>${esc(plan.name)}</strong> membership at $${plan.price}/${plan.billingPeriod === 'yearly' ? 'year' : 'month'}.</p>
     <p style="font-size:13px;color:#555;margin:0 0 18px;">Click the button below to add your payment method. Your subscription starts immediately and renews automatically. You can cancel anytime through your billing portal — we'll email you the link after sign-up.</p>`,
    'Complete sign-up',
    url
  );
  await resend.emails.send({
    from:    resendFrom.value(),
    to:      client.email.trim(),
    subject: `Complete your ${plan.name} membership`,
    html,
  });

  await db.doc(`tenants/${tenantId}/memberships/${membershipId}`).set({
    paymentLinkSentAt: new Date().toISOString(),
    paymentLinkSentTo: client.email.trim(),
    updatedAt:         new Date().toISOString(),
  }, { merge: true });

  return { ok: true, sentTo: client.email };
});

// ── Gusto Integration ─────────────────────────────────────────────────────────
exports.gustoGetAuthUrl = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const clientId    = gustoClientId.value();
  const redirectUri = gustoRedirectUri.value();
  if (!clientId) throw new HttpsError('unavailable', 'Gusto not configured');
  const state = request.auth.uid;
  const url   = `https://api.gusto.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
  return { url };
});

exports.gustoOAuthCallback = onRequest({ cors: true }, async (req, res) => {
  const { code, state: uid } = req.query;
  if (!code) { res.status(400).send('Missing code'); return; }

  const clientId     = gustoClientId.value();
  const clientSecret = gustoClientSecret.value();
  const redirectUri  = gustoRedirectUri.value();

  try {
    const tokenRes = await fetch('https://api.gusto.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error(tokens.error_description || 'Token exchange failed');

    // Fetch Gusto company info
    const meRes = await fetch('https://api.gusto.com/v1/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = await meRes.json();
    const company = me.roles?.payroll_admin?.companies?.[0];

    // Store auth + company in the tenant's settings
    const db = getFirestore();
    await db.doc(`tenants/${TENANT_ID}/data/settings`).set({
      gusto: {
        accessToken:  tokens.access_token,
        refreshToken: tokens.refresh_token,
        companyId:    company?.id || '',
        companyName:  company?.name || '',
        connectedAt:  new Date().toISOString(),
      },
    }, { merge: true });

    res.send('<html><body><script>window.opener?.postMessage("gusto_connected","*");window.close();</script><p>Gusto connected! You can close this window.</p></body></html>');
  } catch (e) {
    res.status(500).send(`Gusto auth failed: ${e.message}`);
  }
});

exports.gustoSyncEmployees = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const db       = getFirestore();
  const settings = (await db.doc(`tenants/${TENANT_ID}/data/settings`).get()).data();
  const gusto    = settings?.gusto;
  if (!gusto?.accessToken) throw new HttpsError('failed-precondition', 'Gusto not connected');

  const empRes = await fetch(`https://api.gusto.com/v1/companies/${gusto.companyId}/employees?include=jobs,compensations`, {
    headers: { Authorization: `Bearer ${gusto.accessToken}` },
  });
  if (!empRes.ok) throw new HttpsError('internal', `Gusto API error: ${empRes.status}`);
  const gustoEmps = await empRes.json();

  const localEmpsSnap = await db.collection(`tenants/${TENANT_ID}/employees`).get();
  const localEmps     = localEmpsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  let synced = 0;
  for (const ge of gustoEmps) {
    const fullName = `${ge.first_name} ${ge.last_name}`.trim();
    const local    = localEmps.find(e => e.name?.toLowerCase() === fullName.toLowerCase());
    if (local) {
      const comp = ge.compensations?.find(c => c.active);
      await db.doc(`tenants/${TENANT_ID}/employees/${local.id}`).set({
        gustoId:       ge.id,
        gustoEmail:    ge.email || '',
        payRate:       comp?.rate ? parseFloat(comp.rate) : local.payRate,
        payType:       comp?.payment_unit?.toLowerCase() || local.payType,
        updatedAt:     new Date().toISOString(),
      }, { merge: true });
      synced++;
    }
  }

  return { synced, total: gustoEmps.length };
});

exports.gustoSubmitPayroll = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { payrollRunId } = request.data || {};
  if (!payrollRunId) throw new HttpsError('invalid-argument', 'payrollRunId required');

  const db       = getFirestore();
  const settings = (await db.doc(`tenants/${TENANT_ID}/data/settings`).get()).data();
  const gusto    = settings?.gusto;
  if (!gusto?.accessToken) throw new HttpsError('failed-precondition', 'Gusto not connected');

  const runSnap = await db.doc(`tenants/${TENANT_ID}/payrollRuns/${payrollRunId}`).get();
  if (!runSnap.exists) throw new HttpsError('not-found', 'Payroll run not found');
  const run = runSnap.data();

  // Create an off-cycle payroll in Gusto
  const payRes = await fetch(`https://api.gusto.com/v1/companies/${gusto.companyId}/payrolls`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${gusto.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      off_cycle: true,
      off_cycle_reason: 'Bonus',
      start_date: run.startDate,
      end_date:   run.endDate,
      employee_compensations: (run.techs || [])
        .filter(t => t.gustoId)
        .map(t => ({
          employee_id: t.gustoId,
          payment_method: 'Direct Deposit',
          fixed_compensations: [{ name: 'Commission', amount: String(t.total?.toFixed(2) || '0.00') }],
        })),
    }),
  });

  if (!payRes.ok) {
    const err = await payRes.json().catch(() => ({}));
    throw new HttpsError('internal', `Gusto payroll failed: ${JSON.stringify(err)}`);
  }

  const payroll = await payRes.json();
  await db.doc(`tenants/${TENANT_ID}/payrollRuns/${payrollRunId}`).set({
    gustoPayrollId: payroll.payroll_id || payroll.id,
    gustoSubmittedAt: new Date().toISOString(),
  }, { merge: true });

  return { gustoPayrollId: payroll.payroll_id || payroll.id };
});

// ── Meeting RSVP ──────────────────────────────────────
// Token-based public RSVP flow: each participant gets a random per-person
// token stored on the meeting record; clicking their email link hits
// recordMeetingResponse with { meetingId, token, response } and we update
// participants[i].response in place.

function rsvpAppUrl({ meetingId, token, response }) {
  const base = 'https://meraki-salon-manager.web.app';
  const params = new URLSearchParams({ rsvp: meetingId, token });
  if (response) params.set('r', response);
  return `${base}/?${params.toString()}`;
}

function buildIcsForMeeting(meeting) {
  // Minimal RFC 5545 ICS payload — enough for Apple Mail, Outlook, Google to
  // import into the recipient's calendar.
  const dt = (date, time) => {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi]    = (time || '09:00').split(':').map(Number);
    const local = new Date(y, mo - 1, d, h, mi);
    return local.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };
  const dtStart = dt(meeting.date, meeting.startTime);
  const dur = Number(meeting.duration) || 30;
  const endLocal = new Date(meeting.date + 'T' + (meeting.startTime || '09:00'));
  endLocal.setMinutes(endLocal.getMinutes() + dur);
  const dtEnd = endLocal.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = s => (s || '').replace(/[\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Meraki Nail Studio//Meetings//EN',
    'BEGIN:VEVENT',
    `UID:meraki-meeting-${meeting.id || Date.now()}@meraki-salon-manager.web.app`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escape(meeting.title || 'Meraki meeting')}`,
    meeting.location    ? `LOCATION:${escape(meeting.location)}`    : '',
    meeting.description ? `DESCRIPTION:${escape(meeting.description)}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

function meetingInviteHtml({ meeting, token, recipientName, baseUrl }) {
  const acceptUrl  = rsvpAppUrl({ meetingId: meeting.id, token, response: 'accept'  });
  const maybeUrl   = rsvpAppUrl({ meetingId: meeting.id, token, response: 'maybe'   });
  const declineUrl = rsvpAppUrl({ meetingId: meeting.id, token, response: 'decline' });
  const detailsUrl = rsvpAppUrl({ meetingId: meeting.id, token });
  const dur = Number(meeting.duration) || 30;
  const endHHMM = (() => {
    const [h, mi] = (meeting.startTime || '09:00').split(':').map(Number);
    const total = h * 60 + mi + dur;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  })();
  const descHtml = meeting.description
    ? esc(meeting.description).replace(/\n/g, '<br>')
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:24px 24px 20px;color:#fff;">
      <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.8;">Meeting invitation</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;line-height:1.25;">${esc(meeting.title || 'Meraki team meeting')}</div>
    </div>
    <div style="padding:22px 24px;color:#1a1a1a;">
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;">Hi ${esc(recipientName || 'there')},<br>You're invited to the following meeting. Please let us know if you can make it:</p>
      <table style="width:100%;border-collapse:collapse;margin:8px 0 18px;font-size:14px;">
        <tr><td style="padding:6px 0;color:#888;width:84px;">Date</td><td style="padding:6px 0;">${esc(fmtDate(meeting.date))}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Time</td><td style="padding:6px 0;">${esc(fmtTime(meeting.startTime))} – ${esc(fmtTime(endHHMM))}</td></tr>
        ${meeting.location ? `<tr><td style="padding:6px 0;color:#888;">Location</td><td style="padding:6px 0;">${esc(meeting.location)}</td></tr>` : ''}
        ${descHtml ? `<tr><td style="padding:6px 0;color:#888;vertical-align:top;">Details</td><td style="padding:6px 0;line-height:1.5;">${descHtml}</td></tr>` : ''}
      </table>
      <div style="display:block;text-align:center;margin:22px 0 12px;">
        <a href="${esc(acceptUrl)}"  style="display:inline-block;margin:4px 4px;padding:11px 22px;border-radius:8px;background:#16a34a;color:#fff;text-decoration:none;font-weight:700;font-size:14px;">✓ Accept</a>
        <a href="${esc(maybeUrl)}"   style="display:inline-block;margin:4px 4px;padding:11px 22px;border-radius:8px;background:#f59e0b;color:#fff;text-decoration:none;font-weight:700;font-size:14px;">? Maybe</a>
        <a href="${esc(declineUrl)}" style="display:inline-block;margin:4px 4px;padding:11px 22px;border-radius:8px;background:#ef4444;color:#fff;text-decoration:none;font-weight:700;font-size:14px;">✗ Decline</a>
      </div>
      <div style="text-align:center;font-size:12px;color:#888;margin-top:6px;">
        Or <a href="${esc(detailsUrl)}" style="color:#3D95CE;text-decoration:none;">view meeting details &amp; respond there</a>
      </div>
    </div>
    <div style="padding:14px 24px;background:#fafafa;border-top:1px solid #f0f0f0;text-align:center;font-size:11px;color:#aaa;">
      Meraki Nail Studio · Sent from your salon's meeting tool
    </div>
  </div>
</body></html>`;
}

exports.sendMeetingInvites = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { meetingId } = request.data || {};
  if (!meetingId) throw new HttpsError('invalid-argument', 'meetingId required');
  const apiKey = resendKey.value();
  if (!apiKey) throw new HttpsError('failed-precondition', 'Email is not configured (RESEND_API_KEY missing)');

  const db = getFirestore();
  const meetingRef = db.doc(`tenants/${TENANT_ID}/meetings/${meetingId}`);
  const snap = await meetingRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Meeting not found');
  const meeting = { id: snap.id, ...snap.data() };
  const participants = Array.isArray(meeting.participants) ? meeting.participants : [];
  if (participants.length === 0) throw new HttpsError('failed-precondition', 'Meeting has no participants');

  const resend = new Resend(apiKey);
  const ics = buildIcsForMeeting(meeting);
  const icsB64 = Buffer.from(ics, 'utf8').toString('base64');
  const sentAt = new Date().toISOString();
  const updated = [];
  let sent = 0, skipped = 0;

  for (const p of participants) {
    const email = (p.email || '').trim();
    if (!email) { updated.push(p); skipped++; continue; }
    const token = p.inviteToken || (require('crypto').randomUUID());
    try {
      await resend.emails.send({
        from:    resendFrom.value(),
        to:      email,
        subject: `You're invited: ${meeting.title || 'Meraki meeting'} · ${fmtDate(meeting.date)}`,
        html:    meetingInviteHtml({ meeting, token, recipientName: p.name }),
        attachments: [{
          filename: 'meeting.ics',
          content: icsB64,
        }],
      });
      sent++;
      updated.push({ ...p, inviteToken: token, inviteSentAt: sentAt });
    } catch (e) {
      // Email failure shouldn't drop the participant from the list — keep the
      // existing entry but record the error so the admin can see what happened.
      updated.push({ ...p, inviteToken: token, inviteError: e.message || 'send failed' });
    }
  }

  await meetingRef.set({ participants: updated, lastInvitesSentAt: sentAt }, { merge: true });
  return { sent, skipped, total: participants.length };
});

exports.recordMeetingResponse = onCall(async (request) => {
  // Public — no auth required. Token is the credential.
  const { meetingId, token, response } = request.data || {};
  if (!meetingId || !token) throw new HttpsError('invalid-argument', 'meetingId and token required');
  if (!['accept', 'maybe', 'decline'].includes(response)) {
    throw new HttpsError('invalid-argument', 'response must be accept | maybe | decline');
  }
  const db = getFirestore();
  const meetingRef = db.doc(`tenants/${TENANT_ID}/meetings/${meetingId}`);
  const snap = await meetingRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Meeting not found');
  const meeting = snap.data();
  const participants = Array.isArray(meeting.participants) ? meeting.participants : [];
  const idx = participants.findIndex(p => p.inviteToken === token);
  if (idx < 0) throw new HttpsError('permission-denied', 'Invalid token');
  const updated = participants.slice();
  updated[idx] = { ...updated[idx], response, respondedAt: new Date().toISOString() };
  await meetingRef.set({ participants: updated }, { merge: true });
  return {
    ok: true,
    participantName: updated[idx].name || updated[idx].email,
    meetingTitle:    meeting.title,
    meetingDate:     meeting.date,
    meetingTime:     meeting.startTime,
    response,
  };
});

exports.fetchMeetingForRsvp = onCall(async (request) => {
  // Public read of a single meeting + this participant's current response,
  // gated by the per-participant token.
  const { meetingId, token } = request.data || {};
  if (!meetingId || !token) throw new HttpsError('invalid-argument', 'meetingId and token required');
  const db = getFirestore();
  const snap = await db.doc(`tenants/${TENANT_ID}/meetings/${meetingId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Meeting not found');
  const meeting = snap.data();
  const participants = Array.isArray(meeting.participants) ? meeting.participants : [];
  const me = participants.find(p => p.inviteToken === token);
  if (!me) throw new HttpsError('permission-denied', 'Invalid token');
  return {
    meeting: {
      id:          meetingId,
      title:       meeting.title,
      date:        meeting.date,
      startTime:   meeting.startTime,
      duration:    meeting.duration,
      location:    meeting.location,
      description: meeting.description,
    },
    participant: {
      name:        me.name,
      email:       me.email,
      response:    me.response || null,
      respondedAt: me.respondedAt || null,
    },
  };
});

// ── Two-way SMS: inbound webhook + outbound callable ───────────────────────
// Match a client by the inbound phone's last-10-digits across the clients
// collection. Phones are stored in varied formats; comparing the digit-only
// suffix avoids needing a separate normalized field.
async function findClientByPhone(tenantId, fromPhone) {
  const inboundDigits = (fromPhone || '').replace(/\D/g, '');
  if (!inboundDigits) return null;
  const last10 = inboundDigits.slice(-10);
  const db = getFirestore();
  const all = await db.collection(`tenants/${tenantId}/clients`).get();
  for (const d of all.docs) {
    const phoneDigits = ((d.data().phone || '') + '').replace(/\D/g, '');
    if (phoneDigits.slice(-10) === last10) return { id: d.id, ...d.data() };
  }
  return null;
}

// Append a message to chats/{clientId}, creating the doc if needed. Used by
// both inbound (channel='sms', from='client') and outbound (from='staff').
async function appendChatMessage(tenantId, clientId, clientInfo, message) {
  const db = getFirestore();
  const FieldValue = require('firebase-admin/firestore').FieldValue;
  const chatRef = db.doc(`tenants/${tenantId}/chats/${clientId}`);
  const snap = await chatRef.get();
  const now = new Date().toISOString();
  if (!snap.exists) {
    await chatRef.set({
      clientId,
      clientName:  clientInfo?.name  || 'Client',
      clientEmail: clientInfo?.email || '',
      clientPhone: clientInfo?.phone || '',
      messages:    [message],
      lastMessage: message.text,
      lastChannel: message.channel || 'app',
      lastAt:      now,
      unreadStaff: message.from === 'client' ? 1 : 0,
      updatedAt:   now,
    });
  } else {
    const updates = {
      messages:    FieldValue.arrayUnion(message),
      lastMessage: message.text,
      lastChannel: message.channel || 'app',
      lastAt:      now,
      updatedAt:   now,
    };
    if (message.from === 'client') updates.unreadStaff = FieldValue.increment(1);
    else                            updates.unreadStaff = 0;
    await chatRef.update(updates);
  }
}

// Twilio webhook target: configure in Twilio Console → Phone Numbers →
// Active Numbers → click your number → Messaging Configuration → "A
// message comes in" → Webhook → POST <this function URL>.
exports.twilioInboundSms = onRequest({ cors: false }, async (req, res) => {
  try {
    // Twilio sends application/x-www-form-urlencoded; Firebase parses to req.body
    const From = req.body?.From || '';
    const To   = req.body?.To   || '';
    const Body = req.body?.Body || '';
    const Sid  = req.body?.MessageSid || null;
    if (!From || !Body) {
      console.warn('[twilioInboundSms] missing From or Body');
      res.set('Content-Type', 'text/xml').status(200).send('<Response/>');
      return;
    }
    // Single-tenant for now; for multi-tenant SaaS we'd map To-number → tenantId.
    const tenantId = TENANT_ID;
    const client = await findClientByPhone(tenantId, From);
    if (!client) {
      // Unknown sender — log and respond OK. We don't auto-create a client
      // record (could be a wrong number); staff can create manually if needed.
      console.warn(`[twilioInboundSms] no client matched for ${From} body="${Body.slice(0, 60)}"`);
      const db = getFirestore();
      await db.collection(`tenants/${tenantId}/inboundSmsOrphans`).add({
        from: From, to: To, body: Body, twilioSid: Sid, at: new Date().toISOString(),
      }).catch(() => {});
      res.set('Content-Type', 'text/xml').status(200).send('<Response/>');
      return;
    }
    const message = {
      text:     Body,
      channel:  'sms',
      from:     'client',
      at:       new Date().toISOString(),
      twilioSid: Sid,
      phone:    From,
    };
    await appendChatMessage(tenantId, client.id, client, message);
    // Notify admins (existing chat-notification flow already handles this for
    // the first message in a session — calling addDoc on chatNotifications).
    if (client.unreadStaff === undefined || client.unreadStaff === 0) {
      const db = getFirestore();
      await db.collection(`tenants/${tenantId}/chatNotifications`).add({
        clientId:    client.id,
        clientName:  client.name  || 'Client',
        clientEmail: client.email || '',
        clientPhone: From,
        preview:     Body.slice(0, 120),
        channel:     'sms',
        createdAt:   new Date().toISOString(),
      }).catch(() => {});
    }
    res.set('Content-Type', 'text/xml').status(200).send('<Response/>');
  } catch (e) {
    console.error('[twilioInboundSms] handler crashed:', e);
    // Always 200 so Twilio doesn't retry-storm
    res.set('Content-Type', 'text/xml').status(200).send('<Response/>');
  }
});

// Staff-side outbound: send an SMS to a client and append it to the chat.
// Auth: requires a signed-in user. We trust the client to send sane content;
// rules-layer enforcement of who-can-message-whom can be tightened later.
exports.sendDirectSms = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { tenantId: tid, clientId, body } = request.data || {};
  const tenantId = tid || TENANT_ID;
  if (!clientId || !body) throw new HttpsError('invalid-argument', 'Missing clientId or body');

  const sid       = twilioSid.value();
  const token     = twilioToken.value();
  const apiKeySid = twilioApiKeySid.value();
  const from      = twilioFrom.value();
  if (!sid || !token || !from) throw new HttpsError('failed-precondition', 'Twilio not configured');

  const db = getFirestore();
  const cDoc = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
  if (!cDoc.exists) throw new HttpsError('not-found', 'Client not found');
  const client = { id: cDoc.id, ...cDoc.data() };
  const phone = normalizePhone(client.phone);
  if (!phone) throw new HttpsError('failed-precondition', `Cannot normalize client phone "${client.phone}"`);

  const twilioSDK = require('twilio');
  const tw = apiKeySid
    ? twilioSDK(apiKeySid, token, { accountSid: sid })
    : twilioSDK(sid, token);

  let twilioStatus = null, twilioError = null, msgSid = null;
  try {
    const msg = await tw.messages.create({ body, from, to: phone });
    twilioStatus = msg?.status || null;
    msgSid = msg?.sid || null;
    if (twilioStatus === 'failed' || twilioStatus === 'undelivered') {
      twilioError = `${msg.errorCode || 'TWILIO_ERROR'}: ${msg.errorMessage || twilioStatus}`;
    }
  } catch (e) {
    twilioError = `${e?.code || 'UNKNOWN'}: ${e?.message || 'send threw'}`;
    console.error('[sendDirectSms] threw:', twilioError);
    throw new HttpsError('internal', twilioError);
  }

  const message = {
    text:        body,
    channel:     'sms',
    from:        'staff',
    at:          new Date().toISOString(),
    staffEmail:  request.auth.token?.email || null,
    twilioSid:   msgSid,
    twilioStatus,
    twilioError,
    phone,
  };
  await appendChatMessage(tenantId, clientId, client, message);
  return { ok: true, twilioStatus, twilioError };
});

// Staff-side outbound email. Sends a plain-text-style email to the client
// via Resend and appends to chats/{clientId} with channel='email' so the
// thread shows it inline with SMS + in-app messages. Inbound email
// threading (Phase 2B) requires Resend Inbound webhook + MX records on
// the verified domain — deferred until that infra is set up.
exports.sendDirectEmail = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { tenantId: tid, clientId, subject, body } = request.data || {};
  const tenantId = tid || TENANT_ID;
  if (!clientId || !subject || !body) throw new HttpsError('invalid-argument', 'Missing clientId, subject, or body');

  const apiKey = resendKey.value();
  if (!apiKey) throw new HttpsError('failed-precondition', 'Resend not configured');

  const db = getFirestore();
  const cDoc = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
  if (!cDoc.exists) throw new HttpsError('not-found', 'Client not found');
  const client = { id: cDoc.id, ...cDoc.data() };
  const email = (client.email || '').trim();
  if (!email) throw new HttpsError('failed-precondition', 'Client has no email on file');

  const senderName = request.auth.token?.name || request.auth.token?.email?.split('@')[0] || 'Meraki';
  // Plain-text body wrapped in light HTML so line breaks render. Different
  // shape from marketing emails — this is meant to look like a real one-to-one
  // email from a staff member, not a campaign card.
  const escaped = (body || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222;font-size:14px;line-height:1.6;">
<div style="max-width:560px;margin:0 auto;">
<p style="margin:0 0 14px;">${escaped}</p>
<p style="margin:24px 0 0;font-size:12px;color:#888;border-top:1px solid #eee;padding-top:12px;">
— ${esc(senderName)}, Meraki Nail Studio<br>
${SALON_ADDRESS_HTML || 'Columbus, OH'}
</p>
</div></body></html>`;

  const resend = new Resend(apiKey);
  let resendId = null, resendError = null;
  try {
    const result = await resend.emails.send({
      from: resendFrom.value(),
      to: email,
      subject,
      html,
      replyTo: resendFrom.value(), // future: per-staff inbox; for now just the salon's address
    });
    if (result?.error) {
      resendError = `${result.error.name || 'RESEND_ERROR'}: ${result.error.message || JSON.stringify(result.error)}`;
      console.error('[sendDirectEmail]', resendError);
      throw new HttpsError('internal', resendError);
    }
    resendId = result?.data?.id || null;
  } catch (e) {
    if (!resendError) {
      resendError = `${e?.name || 'UNKNOWN'}: ${e?.message || 'send threw'}`;
      console.error('[sendDirectEmail] threw:', resendError);
    }
    throw new HttpsError('internal', resendError);
  }

  const message = {
    text:       body,
    subject,
    channel:    'email',
    from:       'staff',
    at:         new Date().toISOString(),
    staffEmail: request.auth.token?.email || null,
    senderName,
    resendId,
    resendError,
    email,
  };
  await appendChatMessage(tenantId, clientId, client, message);
  return { ok: true, resendId };
});

// Optional constant; some installs may want a more elaborate footer block.
const SALON_ADDRESS_HTML = 'Meraki Nail Studio · Columbus, OH';

// Gift card email — fires on giftCard doc creation. Marks emailStatus
// pending → sending → sent (or failed), captures resendId / errorCode
// / errorReason on the doc itself so the GiftCardsAdmin UI can show
// delivery state in real time and offer a retry button on failures.
// Skipped silently when there's no recipientEmail (e.g. walk-in gift
// where buyer takes the printed card).
async function processGiftCardEmail(tenantId, docRef, data) {
  const apiKey = resendKey.value();
  if (!apiKey) {
    await docRef.update({ emailStatus: 'failed', emailErrorCode: 'RESEND_NOT_CONFIGURED', emailErrorReason: 'Resend API key missing' });
    return;
  }
  const recipientEmail = (data.recipientEmail || '').trim();
  if (!recipientEmail) {
    await docRef.update({ emailStatus: 'skipped', emailErrorReason: 'No recipient email on file' });
    return;
  }

  await docRef.update({ emailStatus: 'sending', emailStartedAt: new Date().toISOString() });

  const resend = new Resend(apiKey);
  const recipientName = (data.recipientName || '').trim() || 'there';
  const code = data.code || '';
  const amount = Number(data.balance) || Number(data.originalAmount) || 0;

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#7c3aed,#3D95CE);padding:24px;text-align:center;color:#fff;">
      <div style="font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.9;">Meraki Nail Studio</div>
      <div style="font-size:22px;font-weight:700;margin-top:8px;">🎁 You've received a gift card!</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 14px;">Hi ${esc(recipientName)},</p>
      <p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 18px;">Someone has gifted you a Meraki Nail Studio gift card. Use the code below at checkout next time you visit us.</p>
      <div style="background:#f0faf6;border:2px dashed #7c3aed;border-radius:12px;padding:20px;text-align:center;margin:18px 0;">
        <div style="font-size:11px;color:#7c3aed;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px;">Your gift card code</div>
        <div style="font-size:26px;font-weight:800;color:#1a1a1a;letter-spacing:.16em;font-family:monospace,sans-serif;">${esc(code)}</div>
        <div style="font-size:14px;color:#7c3aed;font-weight:600;margin-top:10px;">$${amount.toFixed(2)} balance</div>
      </div>
      <p style="font-size:13px;line-height:1.6;color:#666;margin:0 0 8px;">Save this code — you'll need it at your next visit. Mention it to the front desk or enter it at checkout.</p>
      <p style="font-size:13px;line-height:1.6;color:#666;margin:0;">Book your appointment any time at <a href="${esc(publicAppUrl.value() || '')}/?book=1" style="color:#2D7A5F;">our online booking page</a>.</p>
    </div>
    <div style="padding:14px 24px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div>
</body></html>`;

  let resendId = null, errorCode = null, errorReason = null;
  try {
    const result = await resend.emails.send({
      from: resendFrom.value(),
      to:   recipientEmail,
      subject: `🎁 You've received a $${amount.toFixed(2)} gift card from Meraki Nail Studio`,
      html,
    });
    if (result?.error) {
      errorCode   = result.error.name || result.error.statusCode || 'RESEND_ERROR';
      errorReason = result.error.message || JSON.stringify(result.error);
    } else {
      resendId = result?.data?.id || null;
    }
  } catch (e) {
    errorCode   = e?.name || 'UNKNOWN';
    errorReason = e?.message || 'send threw';
  }

  if (errorCode) {
    console.error(`[giftCardEmail] failed for ${recipientEmail}: ${errorCode} ${errorReason}`);
    await docRef.update({
      emailStatus:     'failed',
      emailErrorCode:  String(errorCode),
      emailErrorReason: errorReason,
      emailLastTriedAt: new Date().toISOString(),
    });
  } else {
    await docRef.update({
      emailStatus:    'sent',
      emailResendId:  resendId,
      emailSentAt:    new Date().toISOString(),
      emailErrorCode: null,
      emailErrorReason: null,
    });
  }
}

exports.sendGiftCardEmail = onDocumentCreated(
  `tenants/{tenantId}/giftCards/{cardId}`,
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    // Only auto-email on creation when emailStatus hasn't been set yet
    // (allows manual creation paths to opt out by pre-stamping the field).
    if (!data || data.emailStatus) return;
    await processGiftCardEmail(event.params.tenantId, snap.ref, data);
  }
);

// Manual retry: callable from the GiftCardsAdmin UI on a card whose
// initial send failed. Resets emailStatus + re-runs the send.
exports.retryGiftCardEmail = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { tenantId: tid, cardId } = request.data || {};
  const tenantId = tid || TENANT_ID;
  if (!cardId) throw new HttpsError('invalid-argument', 'Missing cardId');
  const db = getFirestore();
  const ref = db.doc(`tenants/${tenantId}/giftCards/${cardId}`);
  const cur = await ref.get();
  if (!cur.exists) throw new HttpsError('not-found', 'Gift card not found');
  // Clear status so processGiftCardEmail will operate, then run it.
  await ref.update({ emailStatus: null, emailErrorCode: null, emailErrorReason: null });
  await processGiftCardEmail(tenantId, ref, cur.data());
  const after = await ref.get();
  return { ok: true, emailStatus: after.data()?.emailStatus, emailErrorReason: after.data()?.emailErrorReason };
});

// ─────────────────────────────────────────────────────────────────────────────
// Plume Nexus marketing site — public, unauthenticated callables.
// Powers the chatbot and contact form on https://plumenexus.com.
// ─────────────────────────────────────────────────────────────────────────────

// Marketing pitch system prompt — long-lived, prompt-cached so the per-call
// token bill is just the conversation tail.
const PLUMENEXUS_SYSTEM_PROMPT = `You are Plume — the AI assistant for Plume Nexus, a salon-management platform sold at https://plumenexus.com.

Your role: answer questions for prospective customers (salon owners, spa managers, studio operators) browsing the marketing site. Be warm, concise, and confident — but never sleazy or hard-selling. If a question needs human follow-up (custom quote, deep technical, complaint), point the user to the contact form below the chat.

Tone: friendly product expert. 1-3 short paragraphs. No emoji unless the user uses one first. Never invent features or pricing not listed below.

CRITICAL RULES:
- Do NOT mention any specific competitor by name (no GlossGenius, Square, Vagaro, Boulevard, Mindbody, Klaviyo, Mailchimp, Fresha, Booksy, etc.). If asked "how do you compare to X?", redirect to what Plume Nexus does uniquely well, without naming or evaluating the competitor.
- Do NOT mention internal tech vendors (no Anthropic, Claude, Twilio, Resend, Firestore, Firebase, OpenAI). Just say "AI", "SMS", "email", "your data". The customer-facing integrations Stripe and Gusto are OK to mention by name.
- Do NOT name real Meraki staff or clients. Use generic example names (Maya, Riley, Jordan, Casey for staff; Emma, Olivia, Sophia, Isabella for clients).
- Do NOT call walk-in handling "turn rotation" or "turn-based". Use "smart walk-in management" or just "walk-in handling".

━━━ ABOUT PLUME NEXUS ━━━
- All-in-one operating system for modern personal-services businesses: salons, nail studios, spas, barbershops, brow/lash, wellness studios, tattoo, pet grooming.
- Built by a software engineer who runs his own salon (in Columbus, OH). The platform is in production at that salon today.
- Sold by JVK Consulting LLC. Domain plumenexus.com. App will be plumenexus.app on iOS/Android.
- Founder-led, small-team. Founder still answers email personally.

━━━ CORE MODULES ━━━
- Smart Scheduling: drag-to-reschedule, recurring bookings, smart walk-in management, time-off blocks, store-hours guard, birthday banner, VIP highlight, geo check-in.
- Client CRM: profiles, full visit history, photos, social handles, notes, allergies, marketing preferences, referral tracking, automated lapsed-client alerts.
- POS & Checkout: Stripe-powered, multi-tech credit splits, tip-per-service, gift cards, promo codes, store credit, refunds with photos. Tap-to-Pay on iOS coming Q3.
- Communications Hub: two-way SMS + email in one threaded inbox. Per-client channel preferences (SMS/email/voice). CAN-SPAM compliant + STOP keyword handling.
- Marketing Engine: campaigns with audience segmentation (8+ built-in audiences), AI-drafted body copy, personalized promo codes per client, scheduled sends, real-time per-recipient delivery analytics, channel-aware templates.
- Gift Cards & Loyalty: digital gift cards with auto-emailed delivery, points-per-dollar loyalty, tiers (Silver/Gold/Platinum), birthday bonuses, referral bonuses.
- AI-Powered Reports: chatbot answers natural-language questions about your data ("top three techs in March?", "lapsed clients who used to come monthly?"). IRS-ready tax export, real-time revenue, leaderboards, retention/rebook rate per tech.
- Voice Commands: hands-free booking ("Book Emma Klein with Riley tomorrow at 2 for a gel mani") — proposes the action and waits for your confirmation before writing.
- Employee & HR: profiles, photos, social links, compensation models, performance reviews, 1099-NEC PDF export, Gusto payroll sync.
- Online Booking: public page, embeddable widget, magic-link self-service reschedule, post-visit Google review prompts.
- TipFlow Kiosk: dedicated front-desk iPad mode for tip selection and queue display. Custom-branded per location.
- Roles & Permissions: admin/scheduler/tech/read-only, view-as impersonation, PIN-locked HR & Reports, verbose activity logs.

━━━ AI ADVANTAGE ━━━
Every AI call runs server-side, never trains on customer data, never shared.
- Plain-English reporting (read-only by design)
- Voice command booking (proposes action, waits for confirmation before writing)
- AI-drafted marketing copy
- Conflict-resolution drafts when a tech calls in sick
- Send-time optimization based on opens/clicks
- Auto-rebook nudges when a client is overdue

━━━ PRICING (USD/mo, no setup fees, no per-tx surcharges) ━━━
- Solo — $49/mo: 1 staff, full feature set minus advanced extras
- Studio — $99/mo: up to 8 staff, multi-tech splits, walk-in management, voice commands, loyalty, custom booking domain
- Salon Pro — $199/mo: unlimited staff, multi-location (Q3), Gusto integration, white-label client app, 2FA, founder-direct support
- Annual billing saves 20%
- 30-day free trial
- Month-to-month, cancel anytime, no exit fees, full data export on request

━━━ MIGRATION & SUPPORT ━━━
- Migration: CSV export from your current platform → one-time import in a single business day. The migration tool dedupes refunds and split payments correctly.
- Stripe payments: each tenant connects their own Stripe account (funds settle directly to your bank).
- SMS: dedicated phone number per tenant, separate marketing vs transactional numbers so STOP keywords don't accidentally opt clients out of appointment confirmations.
- Support: founder-direct email at hello@plumenexus.com on every plan.

━━━ WHEN TO ESCALATE TO HUMAN ━━━
If a user asks for: a custom quote for >25 staff, multi-location pricing, a specific compliance certification (HIPAA, SOC 2), a feature you don't see listed above, or sounds like a complaint — politely point them to the contact form ("I'd loop in the founder for that — drop your details on the contact form below the chat and Jonathan will reply within a business day").

━━━ ANSWERING "HOW DO YOU COMPARE TO X?" ━━━
Don't name X. Pivot to what Plume Nexus uniquely delivers: AI everywhere (reports, voice, marketing copy, conflict resolution), one unified inbox for SMS + email, founder-direct support on every plan, no upcharges for loyalty or marketing, full data portability. Frame it as "here's what makes us different" rather than "here's how they fall short."`;

// Naive in-memory rate limiter — keyed by Function instance. Good enough for
// the marketing site's traffic shape; not a fortress. Each instance allows
// up to 30 chat calls per IP per 10-minute window.
const _chatRateBuckets = new Map();
function checkRate(ip, now = Date.now(), windowMs = 10 * 60 * 1000, max = 30) {
  if (!ip) return true;
  const bucket = _chatRateBuckets.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  _chatRateBuckets.set(ip, bucket);
  return bucket.count <= max;
}

exports.chatWithMarketing = onCall(
  { secrets: [anthropicKey], cors: true, timeoutSeconds: 30 },
  async (request) => {
    const apiKey = anthropicKey.value();
    if (!apiKey) throw new HttpsError('unavailable', 'AI not configured');

    const ip = request.rawRequest?.ip || '';
    if (!checkRate(ip)) {
      throw new HttpsError('resource-exhausted', 'Too many requests. Try again in a few minutes or use the contact form.');
    }

    const { messages = [] } = request.data || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpsError('invalid-argument', 'messages required');
    }
    if (messages.length > 24) {
      throw new HttpsError('invalid-argument', 'Conversation too long — please refresh and start a new chat.');
    }

    // Sanitize: clip each message body, drop anything non-string
    const wireMessages = messages
      .filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
      .map(m => ({
        role: m.role,
        content: String(m.content).slice(0, 2000),
      }));
    if (wireMessages.length === 0) {
      throw new HttpsError('invalid-argument', 'No valid messages');
    }
    if (wireMessages[wireMessages.length - 1].role !== 'user') {
      // Defensive — assistant should never be the trailing message
      throw new HttpsError('invalid-argument', 'Last message must be from user');
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: [
        {
          type: 'text',
          text: PLUMENEXUS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: wireMessages,
    });

    const reply = response.content?.[0]?.text || '';
    return { reply };
  }
);

// Contact-form inquiry from the marketing site. Validates input, sends Resend
// email to the founder, persists a record in Firestore for the audit trail.
exports.submitContactInquiry = onCall(
  { cors: true, timeoutSeconds: 20 },
  async (request) => {
    const ip = request.rawRequest?.ip || '';
    if (!checkRate(ip, Date.now(), 60 * 60 * 1000, 5)) {
      // Tighter window for contact: 5/hr per IP
      throw new HttpsError('resource-exhausted', 'Too many submissions. Try again later.');
    }

    const { name = '', email = '', salon = '', staff = '', message = '' } = request.data || {};
    const cleanName    = String(name).trim().slice(0, 120);
    const cleanEmail   = String(email).trim().slice(0, 200);
    const cleanSalon   = String(salon).trim().slice(0, 200);
    const cleanStaff   = String(staff).trim().slice(0, 50);
    const cleanMessage = String(message).trim().slice(0, 4000);

    if (!cleanName || !cleanEmail || !cleanMessage) {
      throw new HttpsError('invalid-argument', 'Name, email, and message are required.');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      throw new HttpsError('invalid-argument', 'Email is invalid.');
    }

    const db = getFirestore();
    const inquiry = {
      name:      cleanName,
      email:     cleanEmail,
      salon:     cleanSalon,
      staff:     cleanStaff,
      message:   cleanMessage,
      ip:        ip || null,
      userAgent: request.rawRequest?.headers?.['user-agent']?.slice(0, 300) || null,
      source:    'plumenexus.com',
      createdAt: new Date().toISOString(),
      status:    'new',
    };
    const ref = await db.collection('plumenexus_inquiries').add(inquiry);

    // Email founder via Resend if configured
    const apiKey = resendKey.value();
    if (apiKey) {
      try {
        const resend = new Resend(apiKey);
        const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1f2e;">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#5b3b8c;text-transform:uppercase;margin-bottom:6px;">PLUME NEXUS · NEW INQUIRY</div>
  <h2 style="margin:0 0 18px;font-size:20px;color:#0f1923;">${esc(cleanName)} · ${esc(cleanSalon || 'No salon name given')}</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
    <tr><td style="padding:6px 0;color:#888;width:90px;">Email</td><td style="padding:6px 0;font-weight:600;"><a href="mailto:${esc(cleanEmail)}">${esc(cleanEmail)}</a></td></tr>
    <tr><td style="padding:6px 0;color:#888;">Salon</td><td style="padding:6px 0;">${esc(cleanSalon) || '—'}</td></tr>
    <tr><td style="padding:6px 0;color:#888;">Staff</td><td style="padding:6px 0;">${esc(cleanStaff) || '—'}</td></tr>
  </table>
  <div style="padding:16px;background:#fbfaff;border:1px solid #e7e3ee;border-radius:10px;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(cleanMessage)}</div>
  <div style="margin-top:18px;font-size:11px;color:#999;">
    Source: plumenexus.com · IP: ${esc(ip || 'unknown')} · Inquiry ID: ${ref.id}
  </div>
</div>
        `.trim();

        await resend.emails.send({
          from:     resendFrom.value(),
          to:       'jvankim@gmail.com',
          replyTo:  cleanEmail,
          subject:  `[Plume Nexus] ${cleanName} — ${cleanSalon || 'inquiry'}`,
          html,
        });
        await ref.update({ emailedFounderAt: new Date().toISOString() });
      } catch (e) {
        console.error('[plumenexus.contact] Resend email failed', e);
        await ref.update({ emailError: e?.message || String(e) });
      }
    } else {
      console.warn('[plumenexus.contact] RESEND_API_KEY missing — inquiry recorded but no email sent');
    }

    return { ok: true, id: ref.id };
  }
);
