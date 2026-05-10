const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule }       = require('firebase-functions/v2/scheduler');
const { onCall, onRequest, HttpsError }= require('firebase-functions/v2/https');
const { initializeApp }    = require('firebase-admin/app');
const { getFirestore }     = require('firebase-admin/firestore');
const { defineString, defineSecret } = require('firebase-functions/params');
const { Resend }           = require('resend');
const Anthropic            = require('@anthropic-ai/sdk');

initializeApp();

const TENANT_ID   = 'meraki';
// Bootstrap super-admin — mirrors src/lib/firebase.js. Always passes staff/admin
// gates regardless of tenant configuration.
const BOOTSTRAP_ADMINS = ['jvankim@gmail.com'];

const resendKey       = defineString('RESEND_API_KEY',      { default: '' });
// RESEND_FROM env var was the global single-tenant sender. Removed in favor of
// per-tenant tenantFromAddress() — see helper definition below. Setting still
// honored as the per-tenant override via the `fromAddress` field on the tenant
// doc.
const mapsApiKey      = defineString('GOOGLE_MAPS_API_KEY', { default: '' });
const publicAppUrl    = defineString('PUBLIC_APP_URL',      { default: 'https://meraki-salon-manager.web.app' });
// HMAC signing keys for two distinct token types. Split into separate
// secrets (per security audit) so a leak of one only compromises one
// token surface — and so each can be rotated on its own cadence.
//   UNSUBSCRIBE_SECRET  — low-stakes; signs CAN-SPAM unsubscribe links
//   APPT_MANAGE_SECRET  — high-stakes; signs reschedule/cancel links that
//                          let the holder mutate any appointment by id
// Both are `defineSecret` (not `defineString`) so deploys hard-fail
// without a real value, and the values live in Cloud Secret Manager
// rather than function config (no plaintext echo in `firebase
// functions:config:get`, no exposure to anyone with raw config read).
const unsubscribeSecret = defineSecret('UNSUBSCRIBE_SECRET');
const apptManageSecret  = defineSecret('APPT_MANAGE_SECRET');
const stripeKey       = defineSecret('STRIPE_SECRET_KEY');
const anthropicKey    = defineSecret('ANTHROPIC_API_KEY');

// ── Twilio + Stripe billing + Gusto params ───────────────────────────────────
// Declared up here (rather than next to the SMS section) because some
// scheduled-function options blocks reference these as `secrets:` at module
// load time — referencing them later would hit the const temporal-dead-zone
// and break codebase analysis at deploy.
const twilioSid       = defineString('TWILIO_ACCOUNT_SID', { default: '' });
// Twilio auth token (or API Key secret) — defineSecret so the value
// lives in Cloud Secret Manager (encrypted at rest, scoped to the
// runtime service account) instead of plaintext function config /
// .env. Also lets `validateRequest` in the inbound-SMS webhook
// verify signatures using the real secret.
const twilioToken     = defineSecret('TWILIO_AUTH_TOKEN');
const twilioApiKeySid = defineString('TWILIO_API_KEY_SID', { default: '' }); // optional: SKxxx for API Key auth
const twilioFrom      = defineString('TWILIO_FROM',        { default: '' });
const stripePriceId   = defineString('STRIPE_PRO_PRICE_ID',     { default: '' });
const stripeStarterPriceId = defineString('STRIPE_STARTER_PRICE_ID', { default: '' });
const stripeWebhookSecret  = defineSecret('STRIPE_WEBHOOK_SECRET');
const gustoClientId     = defineString('GUSTO_CLIENT_ID',     { default: '' });
const gustoClientSecret = defineString('GUSTO_CLIENT_SECRET', { default: '' });
const gustoRedirectUri  = defineString('GUSTO_REDIRECT_URI',  { default: '' });

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
// Higher stakes than unsubscribe — token-holder can reschedule/cancel any
// named appointment without logging in. Signed with a dedicated secret
// (APPT_MANAGE_SECRET) so its blast radius is contained: a leak of the
// unsub key doesn't enable mass-cancel, and rotating one doesn't invalidate
// the other's outstanding tokens.
function apptManageToken(tenantId, apptId) {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', apptManageSecret.value())
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

// ── Server-side authorization helpers (mirror firestore.rules) ──
// Cloud Functions run with Admin SDK and BYPASS Firestore rules, so every
// callable that reads/writes tenant data MUST gate role membership in code.
// These helpers mirror the rules' isTenantStaff / isTenantAdmin / isTenantOwner
// checks against the tenant's `data/users` doc (`staffEmails` / `adminEmails`)
// and the root `tenants/{tenantId}` doc (`ownerEmail`).
async function callerEmail(request) {
  return (request?.auth?.token?.email || '').toLowerCase();
}
async function isBootstrapAdmin(request) {
  return BOOTSTRAP_ADMINS.includes(await callerEmail(request));
}
async function requireTenantStaff(db, tenantId, request) {
  if (!request?.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const email = await callerEmail(request);
  if (!email) throw new HttpsError('permission-denied', 'No email on token');
  if (await isBootstrapAdmin(request)) return;
  // Tenant owner check
  const tenDoc = await db.doc(`tenants/${tenantId}`).get();
  if (tenDoc.exists && (tenDoc.data().ownerEmail || '').toLowerCase() === email) return;
  // Staff list check
  const usersDoc = await db.doc(`tenants/${tenantId}/data/users`).get();
  const staffEmails = (usersDoc.exists ? (usersDoc.data().staffEmails || []) : [])
    .map(e => String(e || '').toLowerCase());
  if (!staffEmails.includes(email)) {
    throw new HttpsError('permission-denied', 'Not a staff member of this tenant');
  }
}
async function requireTenantAdmin(db, tenantId, request) {
  if (!request?.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const email = await callerEmail(request);
  if (!email) throw new HttpsError('permission-denied', 'No email on token');
  if (await isBootstrapAdmin(request)) return;
  const tenDoc = await db.doc(`tenants/${tenantId}`).get();
  if (tenDoc.exists && (tenDoc.data().ownerEmail || '').toLowerCase() === email) return;
  const usersDoc = await db.doc(`tenants/${tenantId}/data/users`).get();
  const adminEmails = (usersDoc.exists ? (usersDoc.data().adminEmails || []) : [])
    .map(e => String(e || '').toLowerCase());
  if (!adminEmails.includes(email)) {
    throw new HttpsError('permission-denied', 'Admin access required for this tenant');
  }
}
// Returns 'admin' | 'scheduler' | 'tech' | 'readonly' | null.
// Rich users[] lives in data/usersFull (admin-only at the rules layer);
// data/users only carries staffEmails/adminEmails projections. Cloud
// Functions use Admin SDK so rules don't gate this read.
async function callerRole(db, tenantId, request) {
  if (!request?.auth) return null;
  const email = await callerEmail(request);
  if (!email) return null;
  if (await isBootstrapAdmin(request)) return 'admin';
  const tenDoc = await db.doc(`tenants/${tenantId}`).get();
  if (tenDoc.exists && (tenDoc.data().ownerEmail || '').toLowerCase() === email) return 'admin';
  const fullDoc = await db.doc(`tenants/${tenantId}/data/usersFull`).get();
  const users = (fullDoc.exists ? (fullDoc.data().users || []) : []);
  const u = users.find(x => (x.email || '').toLowerCase() === email);
  return u?.role || null;
}

// ── Per-tenant outbound email sender ──────────────────────────────────────────
// Returns the RFC 5322 "from" mailbox to use for emails sent on a tenant's
// behalf. Resolution order:
//   1. tenant.fromAddress (explicit BYO override — used by tenants who have
//      verified their own domain in Resend, like Meraki on
//      merakinailstudio.com)
//   2. shared platform sender: "{tenant.name} <noreply@plumenexus.com>"
//
// Display name is sanitized so RFC 5322 special chars (<, >, ", comma,
// semicolon, @) can't break the mailbox parse. Falls back to "Plume Nexus"
// when the tenant doc is missing or has no name (e.g. read failed).
//
// Cached in-process by tenantId. Cloud Functions instances live for several
// minutes between cold starts so this saves ~1 Firestore read per outbound
// email. If a tenant edits their fromAddress, worst-case the next cold
// start picks it up — no manual cache flush needed.
const _fromAddrCache = new Map();
async function tenantFromAddress(db, tenantId) {
  if (_fromAddrCache.has(tenantId)) return _fromAddrCache.get(tenantId);
  let addr = 'Plume Nexus <noreply@plumenexus.com>';
  try {
    const tDoc = await db.doc(`tenants/${tenantId}`).get();
    const tData = tDoc.exists ? tDoc.data() : {};
    if (tData?.fromAddress) {
      addr = String(tData.fromAddress).slice(0, 200);
    } else {
      const rawName = String(tData?.name || 'Plume Nexus').trim();
      const displayName = rawName.replace(/[<>",;@]/g, '').slice(0, 50) || 'Plume Nexus';
      addr = `${displayName} <noreply@plumenexus.com>`;
    }
  } catch (e) {
    console.warn(`[tenantFromAddress] tenant=${tenantId} lookup failed:`, e?.message);
  }
  _fromAddrCache.set(tenantId, addr);
  return addr;
}

// ── Multi-tenant iteration helper ─────────────────────────────────────────────
// Cron jobs serving the SaaS fan out across every active tenant instead of the
// legacy single-tenant `tenants/${TENANT_ID}/...` paths. Per-tenant failures
// are isolated so one broken tenant can't block the rest of the sweep.
//
// Skip rules:
//   active === false   → tenant is suspended/disabled (admin action)
//   skipPaused option  → also skip when data/settings.pause.until is today or
//                        in the future. Used by marketing sends that would
//                        feel tone-deaf during a closure window. Operational
//                        sends (appointment reminders) opt out and still fire.
async function forEachActiveTenant(label, cb, options = {}) {
  const { skipPaused = false } = options;
  const db = getFirestore();
  const tenantsSnap = await db.collection('tenants').get();
  let total = 0, ran = 0, skipped = 0, failed = 0;
  for (const tDoc of tenantsSnap.docs) {
    total++;
    const tData = tDoc.data() || {};
    if (tData.active === false) { skipped++; continue; }
    if (skipPaused) {
      try {
        const sDoc = await db.doc(`tenants/${tDoc.id}/data/settings`).get();
        const pauseUntil = String(((sDoc.exists ? sDoc.data() : {}).pause || {}).until || '').trim();
        if (pauseUntil) {
          const tz = 'America/New_York';
          const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: tz });
          if (todayLocal <= pauseUntil) { skipped++; continue; }
        }
      } catch (e) {
        console.warn(`[${label}] pause-check failed for ${tDoc.id}:`, e?.message);
      }
    }
    try {
      await cb(tDoc.id, tData);
      ran++;
    } catch (e) {
      failed++;
      console.error(`[${label}] tenant ${tDoc.id} failed:`, e?.message);
    }
  }
  console.log(`[${label}] tenants=${total} ran=${ran} skipped=${skipped} failed=${failed}`);
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
  `tenants/{tenantId}/receipts/{receiptId}`,
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const tenantId = event.params.tenantId;

    const data   = snap.data();
    if (!data || data.sent || data.error) return;

    const apiKey = resendKey.value();
    if (!apiKey) { await snap.ref.update({ error: 'resend_not_configured' }); return; }

    const { clientName, clientEmail, techName, date, startTime, services = [], retailProducts = [], payment = {} } = data;
    if (!clientEmail) { await snap.ref.update({ error: 'no_email' }); return; }

    // Read Google review URL from settings (best-effort)
    let googleReviewUrl = null;
    try {
      const settingsSnap = await getFirestore().doc(`tenants/${tenantId}/data/settings`).get();
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
        from:    await tenantFromAddress(getFirestore(), tenantId),
        to:      clientEmail,
        subject: `Your receipt — ${fmtDate(date)}`,
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
  const fromAddr = await tenantFromAddress(getFirestore(), tenantId);
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
  { document: `tenants/{tenantId}/campaigns/{campaignId}`, timeoutSeconds: 540, secrets: [unsubscribeSecret] },
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
exports.processUnsubscribe = onCall({ cors: true, secrets: [unsubscribeSecret] }, async (request) => {
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

// Public callable used by the online booking page to attach a booking
// to the right client record without exposing the clients collection
// to the public (firestore.rules limit reads to tenant staff).
//
// Flow: client supplies { tenantId, name, phone, email, extra }.
// Server normalizes the phone, looks for an existing match by email
// (exact, lowercase) or phone digits (10-digit normalized scan). If
// found, returns that client's id and merges any newly-supplied
// non-empty fields onto blank fields on the existing record (never
// overwrites existing data — guards against typos or impersonation).
// If not found, mints a new client and returns its id.
//
// Security: rate-limited per IP. Returns ONLY the id (no client info)
// so a public caller can't enumerate the customer database via this
// endpoint. Only fills missing fields, so a phone match can't be
// abused to overwrite an existing customer's email.
exports.findOrCreateClient = onCall({ cors: true }, async (request) => {
  const ip = request.rawRequest?.ip || '';
  if (!checkRate(ip, Date.now(), 60 * 60 * 1000, 30)) {
    throw new HttpsError('resource-exhausted', 'Too many booking attempts. Try again later.');
  }
  const tenantId = String(request.data?.tenantId || TENANT_ID);
  const name     = String(request.data?.name  || '').trim().slice(0, 80);
  const phone    = String(request.data?.phone || '').trim().slice(0, 32);
  const email    = String(request.data?.email || '').trim().slice(0, 200);
  const extra    = (request.data?.extra && typeof request.data.extra === 'object') ? request.data.extra : {};
  if (!name) throw new HttpsError('invalid-argument', 'name is required');
  if (!phone && !email) throw new HttpsError('invalid-argument', 'phone or email is required');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'email is invalid');
  }

  // Phone normalize (mirrors client-side normalizePhone).
  let phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length === 11 && phoneDigits.startsWith('1')) phoneDigits = phoneDigits.slice(1);
  const validPhone     = phoneDigits.length === 10;
  const formattedPhone = validPhone
    ? `+1 (${phoneDigits.slice(0, 3)}) ${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`
    : phone;
  const emailLower = email.toLowerCase();

  const db         = getFirestore();
  const clientsRef = db.collection(`tenants/${tenantId}/clients`);

  let existingId   = null;
  let existingData = null;

  // Email match first (single equality query, indexed).
  if (emailLower) {
    for (const v of new Set([email, emailLower])) {
      const snap = await clientsRef.where('email', '==', v).limit(1).get().catch(() => null);
      if (snap && !snap.empty) {
        existingId   = snap.docs[0].id;
        existingData = snap.docs[0].data();
        break;
      }
    }
  }
  // Phone match: stored phones are mixed-format, so we scan + filter
  // client-side. Cap at 5000 docs as a safety rail; in practice every
  // tenant we expect to onboard sits well below this.
  if (!existingId && validPhone) {
    const allSnap = await clientsRef.limit(5000).get().catch(() => null);
    if (allSnap) {
      for (const d of allSnap.docs) {
        const data = d.data();
        let cDigits = String(data.phone || '').replace(/\D/g, '');
        if (cDigits.length === 11 && cDigits.startsWith('1')) cDigits = cDigits.slice(1);
        if (cDigits === phoneDigits) {
          existingId   = d.id;
          existingData = data;
          break;
        }
      }
    }
  }

  if (existingId) {
    // Hard-stop banned clients before they can book — even if they try
    // a different email or a typo on the phone, the dedup query above
    // resolves them to their original record and we refuse the booking.
    // Returns a structured payload (no thrown HttpsError) so the public
    // booking UI can render a friendly inline message instead of a
    // generic "function failed" toast.
    if (existingData.banned) {
      return { banned: true };
    }
    // Backfill ONLY blank fields. Never overwrite existing data — guards
    // against typo'd phone matches inadvertently rewriting a real
    // customer's email or name.
    const updates = {};
    if (email && !existingData.email) updates.email = email;
    if (validPhone && !existingData.phone) updates.phone = formattedPhone;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date().toISOString();
      await clientsRef.doc(existingId).set(updates, { merge: true });
    }
    return { id: existingId, matched: true };
  }

  // Sanitize the optional `extra` payload — strip any keys that try to
  // bypass the field guards above or inject server-only fields.
  const safeExtra = {};
  ['picture', 'commPreferences', 'birthday', 'notes', 'address', 'instagram', 'facebook', 'tiktok', 'venmo']
    .forEach(k => { if (extra[k] !== undefined) safeExtra[k] = extra[k]; });

  const now = new Date().toISOString();
  const newDoc = await clientsRef.add({
    name,
    phone:  validPhone ? formattedPhone : phone,
    email,
    ...safeExtra,
    source:    'online_booking',
    createdAt: now,
    updatedAt: now,
    visits:    [],
    instagramTags: safeExtra.instagramTags || [],
    googleReviews: safeExtra.googleReviews || [],
  });
  return { id: newDoc.id, matched: false };
});

// Send a branded "you've been invited to your salon's Plume Nexus account"
// Public callable for the booking page slot picker. Returns the busy
// time-slots in a date range as a minimal slice — date, startTime,
// duration, techId, techName, status — with NO PII. The booking page
// previously did `getDocs(collection(... appointments))` directly,
// which exposed every client's name/phone/email/notes via a public
// rule (`appointments` had `read: if true`). After tightening the
// rule to staff-only, the public page calls this instead.
exports.getPublicAvailability = onCall({ cors: true }, async (request) => {
  const ip = request.rawRequest?.ip || '';
  if (!checkRate(ip, Date.now(), 60 * 60 * 1000, 240)) {
    throw new HttpsError('resource-exhausted', 'Too many availability checks. Try again in a few minutes.');
  }
  const { tenantId: tid, dateStart, dateEnd } = request.data || {};
  const tenantId = String(tid || TENANT_ID);
  if (!dateStart || !dateEnd) throw new HttpsError('invalid-argument', 'dateStart and dateEnd are required (YYYY-MM-DD).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
    throw new HttpsError('invalid-argument', 'Dates must be YYYY-MM-DD.');
  }
  // Cap the window so this can't be used to enumerate large slices.
  // 90 days covers any realistic public booking horizon.
  const startDt = new Date(dateStart + 'T00:00:00Z');
  const endDt   = new Date(dateEnd   + 'T00:00:00Z');
  if ((endDt - startDt) / (1000 * 60 * 60 * 24) > 90) {
    throw new HttpsError('invalid-argument', 'Date range too large (max 90 days).');
  }
  const db = getFirestore();
  const snap = await db.collection(`tenants/${tenantId}/appointments`)
    .where('date', '>=', dateStart)
    .where('date', '<=', dateEnd)
    .get();
  // STRICT minimum slice — no clientName/Phone/Email, no notes, no
  // services-array (services have prices and ids that aren't necessary
  // for availability checks). Cancelled appts skipped client-side too,
  // but we include status so the picker can reason about no-shows etc.
  const appts = snap.docs.map(d => {
    const a = d.data();
    return {
      id:        d.id,
      date:      a.date || '',
      startTime: a.startTime || '',
      duration:  Number(a.duration) || 0,
      techId:    a.techId || '',
      techName:  a.techName || '',
      status:    a.status || 'scheduled',
    };
  });
  return { appts };
});

// Public callable for the check-in flow (a client clicks the link in
// their booking confirmation email). Returns the minimal display info
// for the check-in screen — date, time, tech name, services (just name
// + duration), client first name (so they can confirm it's their appt
// without leaking other clients' identities). Does NOT return phone,
// email, full client name, notes, or anything else not needed for the
// "is this you?" confirm screen.
exports.getPublicAppointment = onCall({ cors: true }, async (request) => {
  const ip = request.rawRequest?.ip || '';
  if (!checkRate(ip, Date.now(), 60 * 60 * 1000, 60)) {
    throw new HttpsError('resource-exhausted', 'Too many lookups. Try again later.');
  }
  const { tenantId: tid, apptId } = request.data || {};
  const tenantId = String(tid || TENANT_ID);
  if (!apptId) throw new HttpsError('invalid-argument', 'apptId is required.');
  const db = getFirestore();
  const snap = await db.doc(`tenants/${tenantId}/appointments/${apptId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Appointment not found.');
  const a = snap.data();
  return {
    id:        snap.id,
    date:      a.date || '',
    startTime: a.startTime || '',
    duration:  Number(a.duration) || 0,
    techName:  a.techName || '',
    services:  (a.services || []).map(s => ({
      name:     s.name || s.customName || '',
      duration: Number(s.duration) || 0,
    })),
    clientFirstName: ((a.clientName || '').trim().split(/\s+/)[0] || ''),
    status:          a.status || 'scheduled',
    checkedInAt:     a.checkedInAt || null,
  };
});

// Returns the CALLER's own role + techName for a tenant. Replaces the
// staff-readable `byEmail` map on data/users — that map exposed every
// coworker's (email, role) tuple to any staff member. With this callable
// the caller only ever learns their own slice. Admin SDK reads
// data/usersFull (admin-only at the rules layer) and returns one entry.
//
// Returns `{ role, techName? }` for staff, or null if the caller is
// authenticated but not in this tenant's user list. Throws on missing
// auth / tenantId. Cheap: one Firestore doc read.
exports.getMyTenantRole = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { tenantId: tid } = request.data || {};
  const tenantId = String(tid || TENANT_ID);
  const callerEmail = String(request.auth.token.email || '').toLowerCase();
  if (!callerEmail) throw new HttpsError('permission-denied', 'No email on token');

  const db = getFirestore();
  // Bootstrap admin (platform-founder) returns admin role globally.
  if (await isBootstrapAdmin(request)) return { role: 'admin' };
  // Tenant owner returns admin
  const tenDoc = await db.doc(`tenants/${tenantId}`).get();
  if (tenDoc.exists && (tenDoc.data().ownerEmail || '').toLowerCase() === callerEmail) {
    return { role: 'admin' };
  }
  // Otherwise look up the caller in the rich users[] (admin-only doc).
  const fullDoc = await db.doc(`tenants/${tenantId}/data/usersFull`).get();
  const users = fullDoc.exists ? (fullDoc.data().users || []) : [];
  const me = users.find(u => (u.email || '').toLowerCase() === callerEmail);
  if (!me) return null;
  // Return ONLY the slim slice the client needs for self-lookup. Names,
  // pictures, addedAt timestamps, etc. stay server-side.
  return {
    role:     me.role || null,
    techName: me.techName || null,
  };
});

// email to a newly-added employee. Owner clicks "Send invite" in
// EmployeesAdmin and we email a Google sign-in link (tenant subdomain) so
// the tech can join with one click. Admin gate; uses the owner's verified
// Resend domain.
exports.emailEmployeeInvite = onCall({ cors: true }, async (request) => {
  const { tenantId: tid, employeeId } = request.data || {};
  const tenantId = tid || TENANT_ID;
  if (!employeeId) throw new HttpsError('invalid-argument', 'employeeId required');
  const db = getFirestore();
  await requireTenantAdmin(db, tenantId, request);

  const empSnap = await db.doc(`tenants/${tenantId}/employees/${employeeId}`).get();
  if (!empSnap.exists) throw new HttpsError('not-found', 'Employee not found');
  const emp = empSnap.data();
  const email = (emp.email || '').trim();
  if (!email) throw new HttpsError('failed-precondition', 'No email on file for this employee');

  const tenSnap = await db.doc(`tenants/${tenantId}`).get();
  const salonName = tenSnap.exists ? (tenSnap.data().name || 'Your salon') : 'Your salon';
  const baseUrl = (publicAppUrl.value() || 'https://meraki-salon-manager.web.app').replace(/\/+$/, '');
  // Sign-in URL — for SaaS this would be `https://{tenantId}.plumenexus.com`.
  const signInUrl = tenantId === 'meraki' ? baseUrl : `https://${tenantId}.plumenexus.com`;

  const apiKey = resendKey.value();
  if (!apiKey) throw new HttpsError('unavailable', 'Resend not configured');
  const resend = new Resend(apiKey);

  const firstName = (emp.name || 'there').split(' ')[0];
  const html = buildAutoEmail(
    `Welcome to ${salonName}`,
    firstName,
    `<p style="font-size:14px;color:#222;margin:0 0 12px;">${esc(salonName)} added you to their team on Plume Nexus — the salon's scheduling and earnings app.</p>
     <p style="font-size:13px;color:#555;margin:0 0 18px;">Click below to sign in with Google using <strong>${esc(email)}</strong>. You'll see your daily schedule, real-time tips and earnings, and your weekly take-home — all in one place.</p>`,
    'Sign in with Google',
    signInUrl
  );
  await resend.emails.send({
    from:    await tenantFromAddress(db, tenantId),
    to:      email,
    subject: `You're invited to ${salonName}'s team on Plume Nexus`,
    html,
  });

  await db.doc(`tenants/${tenantId}/employees/${employeeId}`).set({
    inviteSentAt: new Date().toISOString(),
    inviteSentTo: email,
    updatedAt:    new Date().toISOString(),
  }, { merge: true });

  return { ok: true, sentTo: email };
});

// Returns the signed manage-appointment URL for staff. Same URL the booking
// confirmation + reminder emails contain, so staff can resend it directly
// from the appt edit modal when a client says "I lost the email".
exports.getApptManageLink = onCall({ cors: true, secrets: [apptManageSecret] }, async (request) => {
  const { apptId, tenantId: tid } = request.data || {};
  const tenantId = tid || TENANT_ID;
  if (!apptId) throw new HttpsError('invalid-argument', 'apptId required');
  const db = getFirestore();
  // Mints a signed URL that lets the holder reschedule/cancel without auth —
  // staff-only since exposing it widens the blast radius of a leaked link.
  await requireTenantStaff(db, tenantId, request);
  const exists = await db.doc(`tenants/${tenantId}/appointments/${apptId}`).get();
  if (!exists.exists) throw new HttpsError('not-found', 'Appointment not found');
  const url = apptManageUrl(tenantId, apptId);
  return { url };
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
exports.manageAppointment = onCall({ cors: true, secrets: [apptManageSecret] }, async (request) => {
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
  `tenants/{tenantId}/reviewRequests/{reqId}`,
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const tenantId = event.params.tenantId;
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
      const db0 = getFirestore();
      const fromAddr = await tenantFromAddress(db0, tenantId);
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from:    fromAddr,
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
        const empSnap = await db.collection(`tenants/${tenantId}/employees`)
          .where('name', '==', data.techName).limit(1).get();
        const techEmail = empSnap.empty ? null : (empSnap.docs[0].data().email || '').trim();
        if (techEmail) {
          const tFirstName = (empSnap.docs[0].data().name || data.techName).split(' ')[0];
          await resend.emails.send({
            from:    fromAddr,
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
  `tenants/{tenantId}/requests/{uid}`,
  async (event) => {
    const db   = getFirestore();
    const snap = event.data;
    if (!snap) return;
    const tenantId = event.params.tenantId;

    const req    = snap.data();
    const apiKey = resendKey.value();
    if (!apiKey) return;

    // Find admin emails — read the projection (data/users.adminEmails[])
    // not the rich users[] array (now in data/usersFull, admin-only).
    // Notification email content doesn't need names; the email IS the
    // identifier. If we ever need the display name, look it up from
    // data/usersFull explicitly here.
    const usersSnap = await db.doc(`tenants/${tenantId}/data/users`).get();
    const adminEmails = usersSnap.exists ? (usersSnap.data().adminEmails || []) : [];
    if (!adminEmails.length) return;
    const admins = adminEmails.map(email => ({ email }));

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

    const fromAddr = await tenantFromAddress(db, tenantId);
    await Promise.all(admins.map(admin =>
      resend.emails.send({
        from:    fromAddr,
        to:      admin.email,
        subject: `Access request — ${name}`,
        html,
      }).catch(e => console.error('[AccessReq] Email to', admin.email, 'failed:', e.message))
    ));

    console.log(`[AccessReq] Notified ${admins.length} admin(s) about ${req.email}`);
  }
);

// Fires when a public client check-in writes `checkedInAt` to an
// appointment doc. We create the staff-facing notification server-side
// so the public CheckInScreen doesn't need access to PII (clientName,
// etc.) — it only sees the minimal slice from `getPublicAppointment`.
exports.notifyOnCheckIn = onDocumentUpdated(
  `tenants/{tenantId}/appointments/{apptId}`,
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after  = event.data?.after?.data()  || {};
    if (before.checkedInAt || !after.checkedInAt) return; // not a fresh check-in
    const tenantId = event.params?.tenantId;
    const apptId   = event.params?.apptId;
    const db = getFirestore();
    await db.collection(`tenants/${tenantId}/notifications`).add({
      apptId,
      techName:    after.techName || '',
      clientName:  after.clientName || 'A client',
      date:        after.date || '',
      startTime:   after.startTime || '',
      changeType:  'client_checkin',
      message:     `${after.clientName || 'Your client'} has arrived and checked in! 📍`,
      createdAt:   new Date().toISOString(),
      sent:        false,
    });
  }
);

exports.sendApptNotification = onDocumentCreated(
  { document: `tenants/{tenantId}/notifications/{notifId}`, secrets: [apptManageSecret] },
  async (event) => {
    const db   = getFirestore();
    const snap = event.data;
    if (!snap) return;
    const tenantId = event.params.tenantId;

    const data = snap.data();
    if (!data || data.sent || data.error) return;

    const ref = snap.ref;

    try {
      // Look up tech email from employee record
      const empSnap = await db
        .collection(`tenants/${tenantId}/employees`)
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
        from:    await tenantFromAddress(db, tenantId),
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

function buildReminderHtml(appt, client, tenantId) {
  const dateStr  = `${esc(fmtDate(appt.date))} at ${esc(fmtTime(appt.startTime))}`;
  const services = (appt.services || []).map(s => s.name).filter(Boolean).join(', ') || 'Nail services';
  const duration = appt.duration ? `${appt.duration} min` : '';
  const manageLink = apptManageUrl(tenantId, appt.id);
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

async function sendMeetingReminderBatch(resend, fromAddr, meeting, participants, timeLabel, ref, flag) {
  const withEmail = (participants || []).filter(p => p.email);
  await Promise.all(withEmail.map(p =>
    resend.emails.send({
      from:    fromAddr,
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
    const apiKey = resendKey.value();
    if (!apiKey) { console.warn('[MeetingReminders] RESEND_API_KEY not set — skipping'); return; }
    const resend = new Resend(apiKey);
    const today  = new Date().toISOString().slice(0, 10);
    const now    = Date.now();

    await forEachActiveTenant('MeetingReminders', async (tenantId) => {
      const db = getFirestore();
      const fromAddr = await tenantFromAddress(db, tenantId);
      const snap = await db.collection(`tenants/${tenantId}/meetings`)
        .where('date', '>=', today)
        .get();

      let batchesSent = 0;
      for (const docSnap of snap.docs) {
        const meeting = { id: docSnap.id, ...docSnap.data() };
        const { startTimestamp, reminders = {}, participants = [] } = meeting;
        if (!startTimestamp) continue;

        const diffMin = (startTimestamp - now) / 60000;

        if (diffMin >= 55 && diffMin <= 75 && !reminders.sent60) {
          await sendMeetingReminderBatch(resend, fromAddr, meeting, participants, '1 hour',     docSnap.ref, 'sent60');
          batchesSent++;
        }
        if (diffMin >= 10 && diffMin <= 25 && !reminders.sent15) {
          await sendMeetingReminderBatch(resend, fromAddr, meeting, participants, '15 minutes', docSnap.ref, 'sent15');
          batchesSent++;
        }
      }

      if (snap.size || batchesSent) {
        console.log(`[MeetingReminders] tenant=${tenantId} meetings=${snap.size} batches=${batchesSent}`);
      }
    });
  }
);

exports.sendDailyReminders = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'America/New_York' },
  async () => {
    const apiKey = resendKey.value();
    if (!apiKey) {
      console.warn('[Reminders] RESEND_API_KEY not set — skipping');
      return;
    }
    const resend   = new Resend(apiKey);
    const tomorrow = tomorrowStr();

    await forEachActiveTenant('Reminders', async (tenantId, tData) => {
      const db = getFirestore();
      const tenantName = tData.name || tenantId;
      const fromAddr = await tenantFromAddress(db, tenantId);

      const apptSnap = await db
        .collection(`tenants/${tenantId}/appointments`)
        .where('date', '==', tomorrow)
        .get();

      const toRemind = apptSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(a => a.status === 'scheduled' && a.clientId && !a.reminderSent);

      if (!toRemind.length) return;

      const clientIds = [...new Set(toRemind.map(a => a.clientId))];
      const clientSnaps = await Promise.all(
        clientIds.map(id => db.doc(`tenants/${tenantId}/clients/${id}`).get())
      );
      const clientMap = {};
      clientSnaps.forEach(snap => { if (snap.exists) clientMap[snap.id] = snap.data(); });

      let sent = 0, skipped = 0;
      await Promise.all(toRemind.map(async appt => {
        const client = clientMap[appt.clientId];
        const email  = client?.email?.trim();
        if (!email) { skipped++; return; }
        if (client?.commPreferences?.appointmentEmail === false) {
          skipped++;
          return;
        }

        try {
          const { error } = await resend.emails.send({
            from:    fromAddr,
            to:      email,
            subject: `Reminder: Your appointment tomorrow at ${tenantName}`,
            html:    buildReminderHtml(appt, client, tenantId),
          });
          if (error) throw new Error(error.message || JSON.stringify(error));

          await db.doc(`tenants/${tenantId}/appointments/${appt.id}`)
            .update({ reminderSent: true, reminderSentAt: new Date().toISOString() });
          sent++;
        } catch (e) {
          console.error(`[Reminders] Failed for ${client?.name} (tenant=${tenantId}):`, e.message);
        }
      }));

      console.log(`[Reminders] tenant=${tenantId} sent=${sent} skipped=${skipped} (date=${tomorrow})`);
    });
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
    secrets: [twilioToken],
  },
  async () => {
    const apiKey = resendKey.value();
    const resend = apiKey ? new Resend(apiKey) : null;

    const twSid       = twilioSid.value();
    const twToken     = twilioToken.value();
    const twApiKeySid = twilioApiKeySid.value();
    const twFrom      = twilioFrom.value();
    const smsClient = (twSid && twToken && twFrom)
      ? require('twilio')(twApiKeySid || twSid, twToken, twApiKeySid ? { accountSid: twSid } : undefined)
      : null;

    // "now" in salon timezone — assumes all tenants are America/New_York for
    // now. Per-tenant timezone preference can replace this when tenants
    // outside ET onboard.
    const tz = 'America/New_York';
    const now = new Date();
    const localToday = now.toLocaleDateString('en-CA', { timeZone: tz });
    const hm = now.toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
    const [h, m] = hm.split(':').map(Number);
    const nowMins = h * 60 + m;

    await forEachActiveTenant('TechReminders', async (tenantId, tData) => {
      const db = getFirestore();
      const tenantName = tData.name || tenantId;
      const tenantShort = String(tenantName).split(/\s+/)[0] || tenantName;
      const fromAddr = await tenantFromAddress(db, tenantId);

      const sDoc = await db.doc(`tenants/${tenantId}/data/settings`).get();
      const cfg  = ((sDoc.exists ? sDoc.data() : {}).techReminders) || {};
      if (cfg.enabled === false) return;
      const leadMin = Number(cfg.leadMinutes) > 0 ? Number(cfg.leadMinutes) : 15;
      const channel = cfg.channel || 'email';
      const upperMins = nowMins + leadMin;

      const apptSnap = await db
        .collection(`tenants/${tenantId}/appointments`)
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

      if (!candidates.length) return;

      const empSnap = await db.collection(`tenants/${tenantId}/employees`).get();
      const empByName = {};
      empSnap.docs.forEach(d => { const e = d.data(); if (e.name) empByName[e.name] = e; });

      const toSnap = await db.collection(`tenants/${tenantId}/timeOff`).get();
      const timeOffEntries = toSnap.docs.map(d => d.data())
        .filter(t => (t.startDate || '') <= localToday && localToday <= (t.endDate || t.startDate || ''));
      const isTechOnTimeOff = (techName, apptStartMins) => {
        for (const t of timeOffEntries) {
          if (t.techName !== techName) continue;
          if (t.allDay !== false) return true;
          const sM = t.startTime ? (() => { const [hh, mm] = t.startTime.split(':').map(Number); return hh * 60 + mm; })() : 0;
          const eM = t.endTime   ? (() => { const [hh, mm] = t.endTime.split(':').map(Number);   return hh * 60 + mm; })() : 24 * 60;
          if (apptStartMins >= sM && apptStartMins < eM) return true;
        }
        return false;
      };

      let emailsSent = 0, smsSent = 0, skipped = 0, skippedTimeOff = 0;

      for (const appt of candidates) {
        const emp = empByName[appt.techName];
        if (!emp || emp.techReminderOptOut) { skipped++; continue; }

        const apptStartMinsCheck = (() => {
          const [hh, mm] = (appt.startTime || '00:00').split(':').map(Number);
          return (hh || 0) * 60 + (mm || 0);
        })();
        if (isTechOnTimeOff(appt.techName, apptStartMinsCheck)) {
          skippedTimeOff++;
          await db.doc(`tenants/${tenantId}/appointments/${appt.id}`).update({
            techReminderSent: true,
            techReminderSentAt: new Date().toISOString(),
            techReminderSkippedReason: 'tech_on_time_off',
          });
          continue;
        }

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
              from: fromAddr,
              to: emp.email.trim(),
              subject,
              html,
            });
            if (error) throw new Error(error.message || JSON.stringify(error));
            emailsSent++;
          } catch (e) {
            console.error(`[TechReminders] Email failed for ${emp.name} (tenant=${tenantId}):`, e.message);
          }
        }

        if (wantsSms && smsClient && emp.phone) {
          try {
            const phone = normalizePhone(emp.phone);
            if (phone) {
              const body = `${tenantShort}: ${clientLabel} at ${startLabel} (in ${minutesAway} min) — ${services.slice(0, 80)}`;
              await smsClient.messages.create({ from: twFrom, to: phone, body });
              smsSent++;
            }
          } catch (e) {
            console.error(`[TechReminders] SMS failed for ${emp.name} (tenant=${tenantId}):`, e.message);
          }
        }

        await db.doc(`tenants/${tenantId}/appointments/${appt.id}`).update({
          techReminderSent: true,
          techReminderSentAt: new Date().toISOString(),
        });
      }

      console.log(`[TechReminders] tenant=${tenantId} due=${candidates.length} emails=${emailsSent} sms=${smsSent} skipped=${skipped} skippedTimeOff=${skippedTimeOff}`);
    });
  }
);

exports.sendBookingConfirmation = onDocumentCreated(
  { document: `tenants/{tenantId}/appointments/{apptId}`, secrets: [apptManageSecret] },
  async (event) => {
    const db   = getFirestore();
    const snap = event.data;
    if (!snap) return;
    const tenantId = event.params.tenantId;

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
    const manageLink = apptManageUrl(tenantId, event.params?.apptId || snap.id);

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
          const cDoc = await db.doc(`tenants/${tenantId}/clients/${appt.clientId}`).get();
          if (cDoc.exists && cDoc.data()?.commPreferences?.appointmentEmail === false) emailOk = false;
        } catch { /* fall through — assume opted-in */ }
      }
      if (emailOk) {
        await resend.emails.send({
          from:    await tenantFromAddress(db, tenantId),
          to:      appt.clientEmail,
          subject: `Booking confirmed — ${fmtDate(appt.date)} at ${fmtTime(appt.startTime)}`,
          html:    clientHtml,
        }).catch(e => console.error('[Booking] Client email failed:', e.message));
      } else {
        console.log(`[Booking] Skipped client email — opted out of appointment email`);
      }
    }

    // Notify admins — projection only (rich users[] now lives in
    // data/usersFull, admin-only).
    try {
      const usersSnap   = await db.doc(`tenants/${tenantId}/data/users`).get();
      const adminEmails = usersSnap.exists ? (usersSnap.data().adminEmails || []) : [];
      const admins      = adminEmails.map(email => ({ email }));
      if (admins.length) {
        const adminFrom = await tenantFromAddress(db, tenantId);
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
            from:    adminFrom,
            to:      a.email,
            subject: `New online booking — ${appt.clientName} on ${fmtDate(appt.date)}`,
            html:    adminHtml,
          }).catch(e => console.error('[Booking] Admin email failed:', e.message))
        ));
      }
    } catch (e) { console.error('[Booking] Admin notify error:', e.message); }

    // Write in-app notification for admin notification center
    try {
      await db.collection(`tenants/${tenantId}/notifications`).add({
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
  `tenants/{tenantId}/chatNotifications/{notifId}`,
  async (event) => {
    const db   = getFirestore();
    const snap = event.data;
    if (!snap) return;
    const tenantId = event.params.tenantId;

    const data   = snap.data();
    const apiKey = resendKey.value();
    if (!apiKey) return;

    // Read adminEmails projection (rich users[] is admin-only at data/usersFull).
    const usersSnap   = await db.doc(`tenants/${tenantId}/data/users`).get();
    const adminEmails = usersSnap.exists ? (usersSnap.data().adminEmails || []) : [];
    const admins      = adminEmails.map(email => ({ email }));
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

    const fromAddr = await tenantFromAddress(db, tenantId);
    await Promise.all(admins.map(a =>
      resend.emails.send({
        from:    fromAddr,
        to:      a.email,
        subject: `New message from ${data.clientName || 'a client'}`,
        html,
      }).catch(e => console.error('[ChatNotif] Email to', a.email, 'failed:', e.message))
    ));

    console.log(`[ChatNotif] Notified ${admins.length} admin(s) — message from ${data.clientName}`);
  }
);

exports.sendReviewReceivedNotification = onDocumentCreated(
  `tenants/{tenantId}/reviewReceived/{docId}`,
  async (event) => {
    const db   = getFirestore();
    const snap = event.data;
    if (!snap) return;
    const tenantId = event.params.tenantId;

    const data   = snap.data();
    const apiKey = resendKey.value();
    if (!apiKey) return;

    const stars = '★'.repeat(data.rating || 5) + '☆'.repeat(5 - (data.rating || 5));

    // Projection only — rich users[] is admin-only at data/usersFull.
    const usersSnap   = await db.doc(`tenants/${tenantId}/data/users`).get();
    const adminEmails = usersSnap.exists ? (usersSnap.data().adminEmails || []) : [];
    const admins      = adminEmails.map(email => ({ email }));

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
      const empSnap = await db.collection(`tenants/${tenantId}/employees`)
        .where('name', '==', data.techName).limit(1).get();
      if (!empSnap.empty) {
        const techEmail = (empSnap.docs[0].data().email || '').trim();
        if (techEmail && !recipients.find(r => r.email === techEmail)) {
          recipients.push({ email: techEmail, name: data.techName });
        }
      }
    }

    const resend = new Resend(apiKey);
    const fromAddr = await tenantFromAddress(db, tenantId);
    await Promise.all(recipients.map(r =>
      resend.emails.send({
        from:    fromAddr,
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
  // Admin-only: this writes the salon's reviews doc (rendered on the
  // public webfront) and burns Google Maps API quota. Without an admin
  // gate, any authed user could overwrite our reviews with reviews from
  // an arbitrary placeId (defacement) or drain quota with junk lookups.
  await requireTenantAdmin(getFirestore(), TENANT_ID, request);

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

    // Public, unauthenticated, anyone-can-call. Rate-limit by IP so a
    // single attacker can't drain Anthropic credits in a tight loop.
    // 60 calls/hr per IP is generous for normal multi-turn chat (a real
    // visitor sends maybe 5-10 messages a session).
    const ip = request.rawRequest?.ip || '';
    if (!checkRate(ip, Date.now(), 60 * 60 * 1000, 60)) {
      throw new HttpsError('resource-exhausted', 'Too many chat messages. Try again later.');
    }

    const { tenantId: tid, messages = [] } = request.data || {};
    // Tenant id validation — public surface, so reject malformed values.
    // Falls back to TENANT_ID for legacy callers that don't pass tenantId yet.
    const tenantId = String(tid || TENANT_ID).slice(0, 64);
    if (!/^[a-z0-9-]{1,64}$/.test(tenantId)) {
      throw new HttpsError('invalid-argument', 'Invalid tenantId');
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpsError('invalid-argument', 'messages required');
    }
    if (messages.length > 30) throw new HttpsError('invalid-argument', 'Too many messages');

    const db = getFirestore();

    // Load live salon context from Firestore. Tenant doc carries the
    // display name; webfront/services/settings carry the user-facing
    // copy. All four reads are publicly readable per firestore.rules.
    const [tDocSnap, wfSnap, svcSnap, settingsSnap] = await Promise.all([
      db.doc(`tenants/${tenantId}`).get(),
      db.doc(`tenants/${tenantId}/data/webfront`).get(),
      db.collection(`tenants/${tenantId}/services`).get(),
      db.doc(`tenants/${tenantId}/data/settings`).get(),
    ]);

    if (!tDocSnap.exists && svcSnap.empty && !wfSnap.exists) {
      throw new HttpsError('not-found', 'Salon not found');
    }

    const tData    = tDocSnap.exists ? tDocSnap.data() : {};
    const cfg      = wfSnap.exists      ? wfSnap.data()      : {};
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    const services = svcSnap.docs.map(d => d.data());

    // Salon name precedence: webfront override -> tenant doc -> id
    const salonName = cfg.salonName || tData.name || tenantId;

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

    const bookingUrl = settings.bookingUrl
      || cfg.bookingUrl
      || (tenantId === 'meraki' ? 'https://meraki-salon-manager.web.app/?book' : `https://${tenantId}.plumenexus.com/?book`);
    const phone      = cfg.phone || '';
    const address    = cfg.address || '';
    const instagram  = cfg.instagram ? `@${cfg.instagram}` : '';

    const systemPrompt = `You are a friendly, helpful assistant for ${salonName}.

Your role: answer questions about services, pricing, hours, booking, the team, and anything else a visitor might ask. Help them book an appointment or find what they need quickly.

Keep responses warm, concise, and conversational — 1-3 short paragraphs max. Never make up services, prices, or salon details that aren't listed below. If you don't know something specific, direct them to call or book online.

━━━ SALON INFO ━━━
Name: ${salonName}
Address: ${address || 'See website for address'}
Phone: ${phone || 'See website for contact info'}
${instagram ? `Instagram: ${instagram}` : ''}
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
    const apiKey = anthropicKey.value();
    if (!apiKey) throw new HttpsError('unavailable', 'AI not configured');

    const { messages = [] } = request.data || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpsError('invalid-argument', 'messages required');
    }
    if (messages.length > 20) throw new HttpsError('invalid-argument', 'Too many messages');

    // Reports surface revenue, full client PII, top-spenders, etc. — admin only.
    // Mirrors the original code intent ("admin-only, read-only" comment) which
    // was missing the actual server-side check.
    const dbAuth = getFirestore();
    await requireTenantAdmin(dbAuth, TENANT_ID, request);

    const db = dbAuth;
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

    // First-time visitors in a date range: clients whose earliest visit
    // (across appointments AND imported receipts) falls inside the window.
    // Implementation: collect candidate clientIds with at least one visit in
    // the range, then for each candidate check whether they had any visit
    // before startDate. Walk-ins (no clientId) are excluded by definition —
    // there's no way to attribute a walk-in to a "returning" identity.
    async function getNewClientsInRange({ startDate, endDate, limit = 50 }) {
      if (!startDate || !endDate) return { error: 'startDate and endDate are required' };
      const [aSnap, rSnap] = await Promise.all([
        db.collection(APPTS).where('date', '>=', startDate).where('date', '<=', endDate).get(),
        db.collection(RECEIPTS).where('date', '>=', startDate).where('date', '<=', endDate).get().catch(() => ({ docs: [] })),
      ]);
      const candidates = new Map(); // clientId -> { name, firstSeenInRange }
      aSnap.docs.forEach(d => {
        const a = d.data();
        if (!a.clientId || !a.clientName || a.clientName === 'Walk-in') return;
        if (a.status === 'cancelled' || a.status === 'no_show') return;
        const prev = candidates.get(a.clientId);
        if (!prev || (a.date || '') < prev.firstSeenInRange) {
          candidates.set(a.clientId, { name: a.clientName, firstSeenInRange: a.date || '' });
        }
      });
      rSnap.docs.forEach(d => {
        const r = d.data();
        if (!r.clientId || !r.clientName) return;
        const prev = candidates.get(r.clientId);
        if (!prev || (r.date || '') < prev.firstSeenInRange) {
          candidates.set(r.clientId, { name: r.clientName, firstSeenInRange: r.date || '' });
        }
      });

      // Per-candidate existence check, but using only single-field where()
      // so we don't trip Firestore's composite-index requirement
      // (where(clientId) + where(date) needs a composite index — same
      //  gotcha CLAUDE.md calls out for the day-view query). Fetch all
      // visits for the candidate, scan client-side for anything dated
      // before startDate.
      const newClients = [];
      for (const [clientId, info] of candidates) {
        const [allAppts, allReceipts] = await Promise.all([
          db.collection(APPTS).where('clientId', '==', clientId).get(),
          db.collection(RECEIPTS).where('clientId', '==', clientId).get().catch(() => ({ docs: [] })),
        ]);
        const hasOlderAppt    = allAppts.docs.some(d => (d.data().date || '') < startDate);
        const hasOlderReceipt = allReceipts.docs.some(d => (d.data().date || '') < startDate);
        if (!hasOlderAppt && !hasOlderReceipt) {
          newClients.push({ clientId, name: info.name, firstVisitDate: info.firstSeenInRange });
        }
      }
      newClients.sort((a, b) => (a.firstVisitDate || '').localeCompare(b.firstVisitDate || ''));
      return {
        startDate,
        endDate,
        candidatesChecked: candidates.size,
        newClientCount: newClients.length,
        sample: newClients.slice(0, Math.min(Math.max(1, limit), 100)),
        note: 'Walk-ins (no clientId) are excluded — they cannot be reliably attributed to a returning identity.',
      };
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
      {
        name: 'getNewClientsInRange',
        description: 'Count first-time visitors / new clients in a date range. A "new client" is one whose earliest visit (across appointments AND imported GG receipts) falls inside the given window — i.e., they had no prior visit before startDate. Use this for questions like "how many first-time visitors did I get in February 2025" or "how many new clients last quarter". Walk-ins are excluded.',
        input_schema: {
          type: 'object',
          properties: {
            startDate: { type: 'string', description: 'YYYY-MM-DD inclusive' },
            endDate:   { type: 'string', description: 'YYYY-MM-DD inclusive' },
            limit:     { type: 'number', description: 'Max sample rows, default 50, max 100' },
          },
          required: ['startDate', 'endDate'],
        },
      },
    ];

    const TOOL_DISPATCH = { queryAppointments, getRevenueSummary, getTopClients, getClientHistory, getNewClientsInRange };

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
    const apiKey = anthropicKey.value();
    if (!apiKey) throw new HttpsError('unavailable', 'AI not configured');

    const { transcript } = request.data || {};
    if (!transcript || typeof transcript !== 'string') {
      throw new HttpsError('invalid-argument', 'transcript required');
    }
    if (transcript.length > 500) {
      throw new HttpsError('invalid-argument', 'transcript too long');
    }

    const db = getFirestore();
    // Tools below read client PII (name/phone/email) which the firestore.rules
    // gate behind isTenantStaff. Enforce the same gate here since Admin SDK
    // bypasses rules. Also derive role from the tenant's users doc — DO NOT
    // trust a caller-supplied role, which only goes into the AI system prompt.
    await requireTenantStaff(db, TENANT_ID, request);
    const role = (await callerRole(db, TENANT_ID, request)) || 'tech';

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
  { secrets: [anthropicKey, apptManageSecret], cors: true, timeoutSeconds: 60 },
  async (request) => {
    // Staff-only — function returns per-appt manage URLs (HMAC-signed
    // reschedule/cancel links). Without this gate, any authed user could
    // call it with arbitrary apptIds (enumerable elsewhere) and chain into
    // mass-cancel via `manageAppointment`.
    await requireTenantStaff(getFirestore(), TENANT_ID, request);
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

// Defense-in-depth URL allowlist for CTA buttons in transactional emails.
// We send from a verified custom domain (DKIM-aligned), so a free-form CTA
// URL in an email is a powerful phishing primitive. Reject anything that's
// not http(s) or that fails to parse — and additionally enforce a host
// allowlist (Stripe Checkout / our own publicAppUrl) where the caller
// passes `ctaUrl`.
function isSafeCtaUrl(url, allowedHosts = null) {
  if (!url || typeof url !== 'string') return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (allowedHosts && allowedHosts.length) {
    return allowedHosts.some(h => parsed.host === h || parsed.host.endsWith('.' + h));
  }
  return true;
}

function buildAutoEmail(headerSub, firstName, bodyHtml, ctaText, ctaUrl) {
  const safeCta = isSafeCtaUrl(ctaUrl);
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">${headerSub}</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 12px;font-weight:600;">Hi ${firstName}!</p>
      ${bodyHtml}
      ${safeCta ? `<div style="text-align:center;margin:24px 0;">
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
  { schedule: 'every day 10:00', timeZone: 'America/New_York', secrets: [unsubscribeSecret] },
  async () => {
    const apiKey = resendKey.value();
    if (!apiKey) return;
    const resend = new Resend(apiKey);

    const now  = new Date();
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    const dd   = String(now.getDate()).padStart(2, '0');
    const mdKey = `${mm}-${dd}`;
    const year  = now.getFullYear();

    // skipPaused: birthday emails CTA "Book your birthday visit" — sending
    // during a closure window would prompt customers to book against a
    // disabled booking page.
    await forEachActiveTenant('BirthdayAuto', async (tenantId, tData) => {
      const db = getFirestore();
      const tenantName = tData.name || tenantId;
      const tenantShort = String(tenantName).split(/\s+/)[0] || tenantName;

      const settingsSnap = await db.doc(`tenants/${tenantId}/data/settings`).get();
      const settings     = settingsSnap.exists ? settingsSnap.data() : {};
      if (!settings.autoBirthday) return;

      const clientsSnap = await db.collection(`tenants/${tenantId}/clients`).get();
      const targets = clientsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.email && !c.marketingOptOut && c.birthday && c.birthday.slice(5, 10) === mdKey);
      if (!targets.length) return;

      const fromAddr = await tenantFromAddress(db, tenantId);
      let sent = 0;
      for (const client of targets) {
        const sentDocId   = `birthday_${year}_${client.id}`;
        const alreadySent = await db.doc(`tenants/${tenantId}/automationSent/${sentDocId}`).get();
        if (alreadySent.exists) continue;

        const firstName  = (client.name || 'there').split(' ')[0];
        const bookingUrl = settings.bookingUrl || 'https://meraki-salon-manager.web.app/?book';
        const body = `<p style="font-size:14px;line-height:1.7;color:#555;margin:0 0 8px;">
          🎉 Happy Birthday! We hope your special day is as fabulous as you are.
          As a little gift from all of us at ${esc(tenantShort)}, we'd love to treat you to something special this month.
          Come celebrate with us — you deserve it!
        </p>`;
        const html = buildAutoEmail("Happy Birthday! 🎂", firstName, body, "Book Your Birthday Visit", bookingUrl);

        try {
          const { error } = await resend.emails.send({
            from:    fromAddr,
            to:      client.email,
            subject: `Happy Birthday, ${firstName}! 🎂 A gift from ${tenantShort}`,
            html,
          });
          if (!error) {
            await db.doc(`tenants/${tenantId}/automationSent/${sentDocId}`).set({
              type: 'birthday', clientId: client.id, clientName: client.name, year, sentAt: new Date().toISOString(),
            });
            sent++;
          }
        } catch (e) { console.error(`[BirthdayAuto] Failed for ${client.name} (tenant=${tenantId}):`, e.message); }
      }
      console.log(`[BirthdayAuto] tenant=${tenantId} sent=${sent}/${targets.length}`);
    }, { skipPaused: true });
  }
);

// Runs every Monday at 11am Eastern. Sends re-engagement email to clients who
// haven't visited in N days. Deduplicates: won't re-email the same client until
// another full lapse window has passed.
exports.autoLapsedCampaign = onSchedule(
  { schedule: 'every monday 11:00', timeZone: 'America/New_York', secrets: [unsubscribeSecret] },
  async () => {
    const apiKey = resendKey.value();
    if (!apiKey) return;
    const resend = new Resend(apiKey);

    // skipPaused: re-engagement CTA points at booking — pointless during a
    // closure window.
    await forEachActiveTenant('LapsedAuto', async (tenantId, tData) => {
      const db = getFirestore();
      const tenantName = String(tData.name || tenantId);

      const settingsSnap = await db.doc(`tenants/${tenantId}/data/settings`).get();
      const settings     = settingsSnap.exists ? settingsSnap.data() : {};
      if (!settings.autoLapsed) return;

      const lapDays   = settings.autoLapsedDays || 60;
      const now       = new Date();
      const endDate   = now.toISOString().slice(0, 10);
      const startDate = new Date(now - lapDays * 86400000).toISOString().slice(0, 10);
      const cutoffIso = new Date(now - lapDays * 86400000).toISOString();

      const clientsSnap = await db.collection(`tenants/${tenantId}/clients`).get();
      const clients = clientsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.email && !c.marketingOptOut);

      const apptsSnap = await db.collection(`tenants/${tenantId}/appointments`)
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get();
      const activeIds = new Set(apptsSnap.docs.map(d => d.data().clientId).filter(Boolean));

      const lapsed = clients.filter(c => !activeIds.has(c.id));
      if (!lapsed.length) return;

      const fromAddr = await tenantFromAddress(db, tenantId);
      let sent = 0;
      for (const client of lapsed) {
        const sentDocId = `lapsed_${client.id}`;
        const sentSnap  = await db.doc(`tenants/${tenantId}/automationSent/${sentDocId}`).get();
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
            from:    fromAddr,
            to:      client.email,
            subject: `We miss you, ${firstName}! Come see us 💅`,
            html,
          });
          if (!error) {
            await db.doc(`tenants/${tenantId}/automationSent/${sentDocId}`).set({
              type: 'lapsed', clientId: client.id, clientName: client.name, lapDays, sentAt: new Date().toISOString(),
            });
            sent++;
          }
        } catch (e) { console.error(`[LapsedAuto] Failed for ${client.name} (tenant=${tenantId}):`, e.message); }
      }
      console.log(`[LapsedAuto] tenant=${tenantId} (${tenantName}) sent=${sent}/${lapsed.length}`);
    }, { skipPaused: true });
  }
);

exports.createPaymentIntent = onCall({ secrets: [stripeKey] }, async (request) => {
  // POS checkout is staff-only — preventing arbitrary signed-in users from
  // minting PaymentIntents in the salon's Stripe account (would otherwise
  // be a phishing primitive: attacker builds a fake checkout page using
  // OUR publishable key + the returned clientSecret, scams victims into
  // paying us, then disputes / disappears — with the salon's brand on the
  // Stripe Element).
  await requireTenantStaff(getFirestore(), TENANT_ID, request);

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
// Callable without auth so the public signup page can use it. Rate-limited and
// input-validated so the public surface can't be abused to mint phishing emails
// from the salon's verified Resend sender or squat arbitrary subdomain slugs.
exports.createTenantOnboarding = onCall({ cors: true }, async (request) => {
  const ip = request.rawRequest?.ip || '';
  // 5 signups / IP / hour — same envelope as submitContactInquiry. Provisioning
  // is heavy (4 doc writes + 1 outbound email), so this is the right tightness.
  if (!checkRate(ip, Date.now(), 60 * 60 * 1000, 5)) {
    throw new HttpsError('resource-exhausted', 'Too many signups. Try again later or use the contact form.');
  }

  const rawSalon = String(request.data?.salonName || '').trim().slice(0, 80);
  const rawOwner = String(request.data?.ownerName  || '').trim().slice(0, 80);
  const rawEmail = String(request.data?.ownerEmail || '').trim().slice(0, 200);
  const plan     = request.data?.plan;

  if (!rawSalon || !rawEmail) throw new HttpsError('invalid-argument', 'salonName and ownerEmail are required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) throw new HttpsError('invalid-argument', 'Email is invalid.');

  const salonName  = rawSalon;
  const ownerName  = rawOwner;
  const ownerEmail = rawEmail;

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
  const url  = `https://${tenantId}.plumenexus.com`;
  const planVal = ['starter', 'pro', 'enterprise'].includes(plan) ? plan : 'starter';

  // Create registry doc + provision in parallel. Pre-populate the staffEmails
  // array so isTenantStaff rule passes for the owner immediately (rules
  // require the array form; saveUsers later re-derives it).
  const ownerEmailLower = (ownerEmail || '').toLowerCase();
  await Promise.all([
    db.doc(`tenants/${tenantId}`).set({ name: salonName, ownerName: ownerName || '', ownerEmail, plan: planVal, active: true, createdAt: now }),
    db.doc(`tenants/${tenantId}/data/settings`).set({ timeoutMin: 5, createdAt: now }),
    db.doc(`tenants/${tenantId}/data/slides`).set({ slides: [], def: 0, cur: 0 }),
    // Slim projection — staff readable. Holds membership lists +
    // The rich users[] array lives in data/usersFull (admin-only); the
    // staff-readable projection only carries the membership arrays the
    // Firestore rules need (isTenantStaff / isTenantAdmin).
    db.doc(`tenants/${tenantId}/data/users`).set({
      staffEmails: [ownerEmailLower],
      adminEmails: [ownerEmailLower],
    }),
    // Rich users array — admin-only.
    db.doc(`tenants/${tenantId}/data/usersFull`).set({
      users: [{ email: ownerEmail, role: 'admin', uid: '', addedAt: now }],
    }),
  ]);

  // Send welcome email — always from the platform identity (the new
  // owner doesn't recognize their own salon as a sender yet).
  const apiKey = resendKey.value();
  if (apiKey) {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: 'Plume Nexus <noreply@plumenexus.com>',
      to:   ownerEmail,
      subject: `Welcome to Plume Nexus — ${salonName} is ready`,
      html: buildWelcomeHtml(salonName, ownerEmail, tenantId, url),
    }).catch(e => console.error('[Onboarding] welcome email failed:', e.message));
  }

  return { tenantId, url, salonName };
});

function buildWelcomeHtml(salonName, ownerEmail, tenantId, url) {
  // url is server-derived from the slug, but escape regardless so a future
  // refactor that lets a caller seed the URL can't smuggle markup in.
  const sName  = esc(salonName);
  const sEmail = esc(ownerEmail);
  const sUrl   = esc(url);
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f7fa;margin:0;padding:32px 16px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="background:#0f1923;padding:32px;text-align:center">
    <div style="font-size:36px;color:#fff;font-weight:300;letter-spacing:2px">Meraki</div>
    <div style="font-size:11px;color:#3D9E8A;letter-spacing:6px;margin-top:4px">TIPFLOW</div>
  </div>
  <div style="padding:32px">
    <h2 style="color:#1a1a1a;margin:0 0 8px">Your salon is ready 🎉</h2>
    <p style="color:#555;margin:0 0 24px"><strong>${sName}</strong> has been set up on TipFlow. Here's everything you need to get started.</p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-bottom:24px">
      <div style="font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Your TipFlow URL</div>
      <a href="${sUrl}" style="font-size:18px;color:#2D7A5F;font-weight:700;text-decoration:none">${sUrl}</a>
    </div>

    <h3 style="color:#1a1a1a;margin:0 0 12px;font-size:14px">Getting started checklist</h3>
    <ol style="color:#555;font-size:13px;line-height:2;padding-left:20px;margin:0 0 24px">
      <li>Visit your URL and sign in with Google using <strong>${sEmail}</strong></li>
      <li>Add your employees (Employees module)</li>
      <li>Set up your service menu (Services module)</li>
      <li>Configure your public booking page (Admin → Settings)</li>
      <li>Customise your public website (Admin → Webfront)</li>
    </ol>

    <a href="${sUrl}" style="display:block;background:#2D7A5F;color:#fff;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none">Open ${sName} →</a>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #f0f0f0;font-size:11px;color:#aaa;text-align:center">
    TipFlow · Salon Management Platform · <a href="https://tipflow.app" style="color:#aaa">tipflow.app</a>
  </div>
</div></body></html>`;
}

// ── Config params for new integrations (moved up — see top of file) ──────────

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
  { document: `tenants/{tenantId}/campaigns/{campaignId}`, secrets: [twilioToken] },
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
  { schedule: 'every 1 minutes', timeoutSeconds: 540, secrets: [unsubscribeSecret, twilioToken] },
  async () => {
    const nowIso = new Date().toISOString();

    await forEachActiveTenant('runScheduledCampaigns', async (tenantId) => {
      const db = getFirestore();
      const dueSnap = await db.collection(`tenants/${tenantId}/campaigns`)
        .where('status', '==', 'scheduled')
        .where('scheduleAt', '<=', nowIso)
        .get();

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
          console.error(`[runScheduledCampaigns] claim failed for ${cDoc.id} (tenant=${tenantId}):`, e?.message);
          continue;
        }
        if (!claimedData) continue;
        try {
          if (claimedData.channel === 'sms') {
            await processSMSCampaign(tenantId, cDoc.ref, claimedData);
          } else {
            await processEmailCampaign(tenantId, cDoc.ref, claimedData);
          }
        } catch (e) {
          console.error(`[runScheduledCampaigns] processor failed for ${cDoc.id} (${claimedData.channel}, tenant=${tenantId}):`, e?.message);
          await cDoc.ref.update({ status: 'failed', error: e?.message || 'scheduled_run_failed' }).catch(() => {});
        }
      }
    });
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
  const { plan, tenantId: tid } = request.data || {};
  const tId = tid || TENANT_ID;

  const db = getFirestore();
  // Cross-tenant guard: the caller must be an admin of the tenant they're
  // billing for. Without this, any authed user could supply someone else's
  // tenantId and overwrite their stripeCustomerId / hijack billing state via
  // the webhook's metadata.tenantId routing.
  await requireTenantAdmin(db, tId, request);

  const key = stripeKey.value ? stripeKey.value() : null;
  if (!key) throw new HttpsError('unavailable', 'Stripe not configured');

  const stripe   = require('stripe')(key);
  const priceId  = plan === 'starter' ? stripeStarterPriceId.value() : stripePriceId.value();
  if (!priceId)  throw new HttpsError('invalid-argument', `Price ID for plan "${plan}" not set`);

  const tenDoc  = await db.doc(`tenants/${tId}`).get();
  const ownerEmail = tenDoc.exists ? tenDoc.data().ownerEmail : request.auth.token.email;

  // Reuse existing Stripe customer if stored
  let customerId = tenDoc.exists ? tenDoc.data().stripeCustomerId : null;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: ownerEmail, metadata: { tenantId: tId } });
    customerId = customer.id;
    await db.doc(`tenants/${tId}`).set({ stripeCustomerId: customerId }, { merge: true });
  }

  // Always send the user back to our own app — never accept a caller-supplied
  // returnUrl, which would be an open-redirect / phishing primitive (the
  // post-checkout redirect comes from the legit Stripe-hosted page).
  const baseUrl = (publicAppUrl.value() || 'https://meraki-salon-manager.web.app').replace(/\/+$/, '');
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode:     'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/?stripe=success`,
    cancel_url:  `${baseUrl}/?stripe=cancel`,
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
  const { membershipId, successUrl, cancelUrl, tenantId: tid } = request.data || {};
  const tenantId = tid || TENANT_ID;
  // Mints a Stripe Checkout URL + writes Stripe IDs back to client/plan/
  // membership docs (rules say admin-only writes). Admin gate required.
  const dbAuth = getFirestore();
  await requireTenantAdmin(dbAuth, tenantId, request);
  if (!membershipId) throw new HttpsError('invalid-argument', 'membershipId required');

  const key = stripeKey.value();
  if (!key) throw new HttpsError('unavailable', 'Stripe not configured');
  const stripe = require('stripe')(key);
  const db     = dbAuth;

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
  const { membershipId, tenantId: tid } = request.data || {};
  const tenantId = tid || TENANT_ID;

  const key = stripeKey.value();
  if (!key) throw new HttpsError('unavailable', 'Stripe not configured');
  const stripe = require('stripe')(key);
  const db     = getFirestore();
  // The portal exposes invoices, saved cards, and lets the visitor cancel
  // the subscription. Admin gate required — clients shouldn't be able to
  // mint a portal for someone else just by guessing a membershipId.
  await requireTenantAdmin(db, tenantId, request);

  const memSnap = await db.doc(`tenants/${tenantId}/memberships/${membershipId}`).get();
  if (!memSnap.exists) throw new HttpsError('not-found', 'Membership not found');
  const mem = memSnap.data();
  if (!mem.stripeCustomerId) throw new HttpsError('failed-precondition', 'No Stripe customer for this member yet');

  // Always send the user back to our own app — never accept a caller-
  // supplied returnUrl, which would be an open-redirect / phishing primitive.
  const baseUrl = (publicAppUrl.value() || 'https://meraki-salon-manager.web.app').replace(/\/+$/, '');
  const session = await stripe.billingPortal.sessions.create({
    customer:   mem.stripeCustomerId,
    return_url: baseUrl,
  });

  return { url: session.url };
});

// Email the Stripe Checkout payment link to a member's client.
//
// SECURITY: this function previously accepted the link URL from the caller,
// which let any authed user send arbitrary links — including phishing URLs —
// from the salon's verified Resend domain. We now read the URL exclusively
// from the membership doc's `paymentLinkUrl` (stamped by
// createMembershipCheckout) AND restrict the URL to Stripe-checkout hosts.
exports.emailMembershipPaymentLink = onCall({ cors: true }, async (request) => {
  const { membershipId, tenantId: tid } = request.data || {};
  const tenantId = tid || TENANT_ID;
  if (!membershipId) throw new HttpsError('invalid-argument', 'membershipId required');

  const apiKey = resendKey.value();
  if (!apiKey) throw new HttpsError('unavailable', 'Resend not configured');
  const db = getFirestore();
  // Sends from a verified custom domain — admin gate so a tech-role user
  // can't fire branded emails on the salon's behalf.
  await requireTenantAdmin(db, tenantId, request);

  const memSnap = await db.doc(`tenants/${tenantId}/memberships/${membershipId}`).get();
  if (!memSnap.exists) throw new HttpsError('not-found', 'Membership not found');
  const mem = memSnap.data();
  const planSnap = await db.doc(`tenants/${tenantId}/membershipPlans/${mem.planId}`).get();
  const clientSnap = await db.doc(`tenants/${tenantId}/clients/${mem.clientId}`).get();
  if (!planSnap.exists || !clientSnap.exists) throw new HttpsError('not-found', 'Plan or client missing');
  const plan = planSnap.data();
  const client = clientSnap.data();
  if (!client.email) throw new HttpsError('failed-precondition', 'Client has no email on file');

  // Use the server-stamped link only. Validate it's a Stripe-hosted URL —
  // belt-and-suspenders even though the link was minted by our own
  // createMembershipCheckout.
  const url = mem.paymentLinkUrl;
  if (!isSafeCtaUrl(url, ['checkout.stripe.com', 'billing.stripe.com', 'buy.stripe.com'])) {
    throw new HttpsError('failed-precondition', 'No valid Stripe payment link on this membership — generate one first');
  }

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
    from:    await tenantFromAddress(db, tenantId),
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
  const db = getFirestore();
  await requireTenantAdmin(db, TENANT_ID, request);
  const clientId    = gustoClientId.value();
  const redirectUri = gustoRedirectUri.value();
  if (!clientId) throw new HttpsError('unavailable', 'Gusto not configured');

  // Mint a fresh single-use OAuth state nonce. We persist it server-side
  // with a 10-minute TTL and the callback validates + deletes it before
  // accepting the token exchange. Without this, an attacker who controls
  // a Gusto company could initiate the OAuth flow under their credentials
  // and our callback would happily overwrite the salon's stored
  // accessToken/companyId — silently rerouting payroll to the attacker.
  const nonce = require('crypto').randomBytes(16).toString('hex');
  await db.doc(`_oauthNonces/${nonce}`).set({
    provider:  'gusto',
    tenantId:  TENANT_ID,
    uid:       request.auth.uid,
    email:     (request.auth.token.email || '').toLowerCase(),
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  const url = `https://api.gusto.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${nonce}`;
  return { url };
});

exports.gustoOAuthCallback = onRequest({ cors: true }, async (req, res) => {
  const { code, state } = req.query;
  if (!code) { res.status(400).send('Missing code'); return; }
  // State must be the nonce we minted in `gustoGetAuthUrl` — exactly 32
  // hex chars. Validate format first to short-circuit obvious garbage.
  if (!state || typeof state !== 'string' || !/^[a-f0-9]{32}$/.test(state)) {
    res.status(400).send('Invalid OAuth state. Please retry the connection.');
    return;
  }

  const db = getFirestore();
  const nonceRef = db.doc(`_oauthNonces/${state}`);
  const nonceSnap = await nonceRef.get();
  if (!nonceSnap.exists) {
    res.status(400).send('OAuth state expired or already used. Please retry the connection from the HR settings.');
    return;
  }
  const nonce = nonceSnap.data();
  if (nonce.provider !== 'gusto') {
    await nonceRef.delete().catch(() => {});
    res.status(400).send('OAuth state mismatch. Please retry the connection.');
    return;
  }
  if (Number(nonce.expiresAt) < Date.now()) {
    await nonceRef.delete().catch(() => {});
    res.status(400).send('OAuth state expired (links are valid for 10 minutes). Please retry the connection.');
    return;
  }
  // Single-use: delete BEFORE the token exchange so a slow / failed
  // exchange can't be replayed with the same state.
  await nonceRef.delete();
  const tenantId = nonce.tenantId || TENANT_ID;

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

    // Sensitive credentials live in the admin-only `settingsPrivate` doc
    // — `data/settings` is staff-readable (so non-admin tech roles can
    // open the JS console and dump it). Public-facing connection metadata
    // (companyName, connectedAt) stays on `data/settings` so the HR tab
    // can show "Connected · Acme Salon" without hitting the private doc.
    await db.doc(`tenants/${tenantId}/data/settingsPrivate`).set({
      gusto: {
        accessToken:  tokens.access_token,
        refreshToken: tokens.refresh_token,
        companyId:    company?.id || '',
        connectedAt:  new Date().toISOString(),
      },
    }, { merge: true });
    await db.doc(`tenants/${tenantId}/data/settings`).set({
      gusto: {
        // Indicator only; never the access token.
        connected:    true,
        companyName:  company?.name || '',
        connectedAt:  new Date().toISOString(),
      },
    }, { merge: true });

    res.send('<html><body><script>window.opener?.postMessage("gusto_connected","*");window.close();</script><p>Gusto connected! You can close this window.</p></body></html>');
  } catch (e) {
    res.status(500).send(`Gusto auth failed: ${e.message}`);
  }
});

// Read Gusto OAuth credentials, transparently migrating from the legacy
// `data/settings.gusto.accessToken` location (staff-readable) to the new
// `data/settingsPrivate.gusto` location (admin-only). Migration runs
// at-most-once per tenant — first call after deploy moves the token,
// purges the legacy field, and writes the public indicator. Subsequent
// calls just read from the private doc.
async function getGustoCredentials(db, tenantId) {
  const FieldValue = require('firebase-admin/firestore').FieldValue;
  const privateRef = db.doc(`tenants/${tenantId}/data/settingsPrivate`);
  const priv = (await privateRef.get()).data() || {};
  if (priv.gusto?.accessToken) return priv.gusto;
  // Legacy migration path
  const legacyRef = db.doc(`tenants/${tenantId}/data/settings`);
  const legacy = (await legacyRef.get()).data() || {};
  const legacyGusto = legacy.gusto;
  if (legacyGusto?.accessToken) {
    await privateRef.set({ gusto: {
      accessToken:  legacyGusto.accessToken,
      refreshToken: legacyGusto.refreshToken || '',
      companyId:    legacyGusto.companyId || '',
      connectedAt:  legacyGusto.connectedAt || new Date().toISOString(),
      _migratedAt:  new Date().toISOString(),
    }}, { merge: true });
    // Replace the staff-readable doc's gusto field with a connection
    // indicator (no token). FieldValue.delete() on the access/refresh
    // tokens specifically.
    await legacyRef.set({ gusto: {
      connected:    true,
      companyName:  legacyGusto.companyName || '',
      connectedAt:  legacyGusto.connectedAt || new Date().toISOString(),
      // explicitly remove tokens
      accessToken:  FieldValue.delete(),
      refreshToken: FieldValue.delete(),
      companyId:    FieldValue.delete(),
    }}, { merge: true });
    return legacyGusto;
  }
  return null;
}

exports.gustoSyncEmployees = onCall({ cors: true }, async (request) => {
  const db = getFirestore();
  await requireTenantAdmin(db, TENANT_ID, request);
  const gusto = await getGustoCredentials(db, TENANT_ID);
  if (!gusto?.accessToken) throw new HttpsError('failed-precondition', 'Gusto not connected');

  const empRes = await fetch(`https://api.gusto.com/v1/companies/${gusto.companyId}/employees?include=jobs,compensations`, {
    headers: { Authorization: `Bearer ${gusto.accessToken}` },
  });
  if (!empRes.ok) throw new HttpsError('internal', `Gusto API error: ${empRes.status}`);
  const gustoEmps = await empRes.json();

  const localEmpsSnap = await db.collection(`tenants/${TENANT_ID}/employees`).get();
  const localEmps     = localEmpsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  let matched = 0;
  for (const ge of gustoEmps) {
    const fullName = `${ge.first_name} ${ge.last_name}`.trim();
    const local    = localEmps.find(e => e.name?.toLowerCase() === fullName.toLowerCase());
    if (local) {
      const comp = ge.compensations?.find(c => c.active);
      const now = new Date().toISOString();
      // Sensitive comp fields go to the admin-only sub-doc; the public
      // parent doc gets only `updatedAt`. Without this split, every Gusto
      // sync silently re-published payRate/payType/gustoId/gustoEmail to
      // the publicly-readable parent doc — undoing the comp-split lockdown.
      await db.doc(`tenants/${TENANT_ID}/employees/${local.id}/private/comp`).set({
        gustoId:    ge.id,
        gustoEmail: ge.email || '',
        payRate:    comp?.rate ? parseFloat(comp.rate) : (local.payRate || null),
        payType:    comp?.payment_unit?.toLowerCase() || (local.payType || null),
        updatedAt:  now,
      }, { merge: true });
      await db.doc(`tenants/${TENANT_ID}/employees/${local.id}`).set({
        updatedAt: now,
      }, { merge: true });
      matched++;
    }
  }

  return { matched, updated: matched, total: gustoEmps.length };
});

exports.gustoSubmitPayroll = onCall({ cors: true }, async (request) => {
  const db = getFirestore();
  await requireTenantAdmin(db, TENANT_ID, request);
  const { payrollRunId } = request.data || {};
  if (!payrollRunId) throw new HttpsError('invalid-argument', 'payrollRunId required');

  const gusto = await getGustoCredentials(db, TENANT_ID);
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
  // Admin-only: matches the firestore.rules write gate on /meetings.
  // Also prevents leaking a private meeting's title/description into an
  // invite email body for someone who shouldn't see it.
  const { tenantId: tid, meetingId } = request.data || {};
  const tenantId = tid || TENANT_ID;
  await requireTenantAdmin(getFirestore(), tenantId, request);
  if (!meetingId) throw new HttpsError('invalid-argument', 'meetingId required');
  const apiKey = resendKey.value();
  if (!apiKey) throw new HttpsError('failed-precondition', 'Email is not configured (RESEND_API_KEY missing)');

  const db = getFirestore();
  const meetingRef = db.doc(`tenants/${tenantId}/meetings/${meetingId}`);
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
  const fromAddr = await tenantFromAddress(db, tenantId);

  for (const p of participants) {
    const email = (p.email || '').trim();
    if (!email) { updated.push(p); skipped++; continue; }
    const token = p.inviteToken || (require('crypto').randomUUID());
    try {
      await resend.emails.send({
        from:    fromAddr,
        to:      email,
        subject: `You're invited: ${meeting.title || 'meeting'} · ${fmtDate(meeting.date)}`,
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
// Escape user-controlled text before interpolating into TwiML XML response.
function xmlEscape(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

exports.twilioInboundSms = onRequest({ cors: false, secrets: [twilioToken] }, async (req, res) => {
  try {
    // Verify the inbound POST really came from Twilio. Without this, anyone
    // who knows the function URL can forge a webhook with arbitrary `From` /
    // `Body` and inject a message into the chat thread of any client whose
    // phone they know — phishing the staff inbox under a real client's
    // identity. Validation uses the AUTH TOKEN secret (not API key) so
    // this works for both account-token and API-key SDK initializations.
    const tokenForSig = twilioToken.value();
    const signature   = req.headers['x-twilio-signature'];
    if (!tokenForSig || !signature) {
      console.warn('[twilioInboundSms] missing signature or auth token');
      res.status(403).send('Forbidden');
      return;
    }
    const fullUrl = `https://${req.get('host')}${req.originalUrl || req.url}`;
    const twilioSDK = require('twilio');
    const valid = twilioSDK.validateRequest(tokenForSig, signature, fullUrl, req.body || {});
    if (!valid) {
      console.warn('[twilioInboundSms] invalid signature; rejecting webhook');
      res.status(403).send('Forbidden');
      return;
    }

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

    // ── Pause check ──────────────────────────────────────
    // If the salon is currently paused, either auto-reply with the closure
    // notice (mode A, default) or forward the inbound to the admin's personal
    // phone (mode B, opt-in). Either way, skip the normal thread/notify flow.
    const db0 = getFirestore();
    const sDoc = await db0.doc(`tenants/${tenantId}/data/settings`).get().catch(() => null);
    const pauseCfg = (sDoc && sDoc.exists ? sDoc.data() : {}).pause || {};
    const pauseUntilStr = String(pauseCfg.until || '').trim();
    if (pauseUntilStr) {
      // Compare in salon timezone to avoid edge-of-day misses
      const tz = 'America/New_York';
      const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: tz });
      if (todayLocal <= pauseUntilStr) {
        // Persist a record so the salon can see what came in during the pause
        await db0.collection(`tenants/${tenantId}/inboundSmsPaused`).add({
          from: From, to: To, body: Body, twilioSid: Sid,
          at: new Date().toISOString(),
          handled: pauseCfg.forwardPhone ? 'forwarded' : 'auto-replied',
        }).catch(() => {});

        if (pauseCfg.forwardPhone) {
          // Mode B — forward to admin's personal phone, no auto-reply to client.
          // If forward setup fails (Twilio creds missing, bad phone), fall through
          // to Mode A so the customer at least gets the closure notice.
          let forwarded = false;
          try {
            const twSid       = twilioSid.value();
            const twToken     = twilioToken.value();
            const twApiKeySid = twilioApiKeySid.value();
            const twFrom      = twilioFrom.value();
            const fwdTo       = normalizePhone(pauseCfg.forwardPhone);
            if (twSid && twToken && twFrom && fwdTo) {
              const tw = require('twilio')(twApiKeySid || twSid, twToken,
                twApiKeySid ? { accountSid: twSid } : undefined);
              const fwdBody = `[Plume Nexus · while paused] From ${From}: ${Body.slice(0, 1400)}`;
              await tw.messages.create({ from: twFrom, to: fwdTo, body: fwdBody });
              forwarded = true;
            } else {
              console.warn('[twilioInboundSms] pause-forward unavailable: missing Twilio creds or bad phone, falling back to auto-reply');
            }
          } catch (e) {
            console.error('[twilioInboundSms] pause-forward failed, falling back to auto-reply:', e.message);
          }
          if (forwarded) {
            res.set('Content-Type', 'text/xml').status(200).send('<Response/>');
            return;
          }
          // Fall through to Mode A so the customer isn't left in silence.
        }

        // Mode A — auto-reply with closure notice
        const friendlyDate = (() => {
          try {
            return new Date(pauseUntilStr + 'T12:00:00').toLocaleDateString('en-US',
              { month: 'long', day: 'numeric', year: 'numeric' });
          } catch { return pauseUntilStr; }
        })();
        const defaultMsg = `Thanks for reaching out! We're temporarily closed and will reopen on ${friendlyDate}. Online booking will be available again then. We appreciate your patience!`;
        const replyText = String(pauseCfg.customMessage || defaultMsg).slice(0, 1500)
          .replace(/\{date\}/gi, friendlyDate);
        res.set('Content-Type', 'text/xml').status(200).send(
          `<Response><Message>${xmlEscape(replyText)}</Message></Response>`
        );
        return;
      }
    }

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
exports.sendDirectSms = onCall({ cors: true, secrets: [twilioToken] }, async (request) => {
  const { tenantId: tid, clientId, body } = request.data || {};
  const tenantId = tid || TENANT_ID;
  await requireTenantStaff(getFirestore(), tenantId, request);
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
  const { tenantId: tid, clientId, subject, body } = request.data || {};
  const tenantId = tid || TENANT_ID;
  await requireTenantStaff(getFirestore(), tenantId, request);
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
  const fromAddr = await tenantFromAddress(db, tenantId);
  let resendId = null, resendError = null;
  try {
    const result = await resend.emails.send({
      from: fromAddr,
      to: email,
      subject,
      html,
      replyTo: fromAddr, // future: per-staff inbox; for now just the salon's address
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
      from: await tenantFromAddress(getFirestore(), tenantId),
      to:   recipientEmail,
      subject: `🎁 You've received a $${amount.toFixed(2)} gift card`,
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
  const { tenantId: tid, cardId } = request.data || {};
  const tenantId = tid || TENANT_ID;
  await requireTenantStaff(getFirestore(), tenantId, request);
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
- Do NOT mention internal tech vendors (no Anthropic, Claude, Twilio, Resend, Firestore, Firebase, OpenAI, Plaid). Just say "AI", "SMS", "email", "your data", "bank verification". The customer-facing integrations Stripe and Gusto are OK to mention by name (and only if the customer specifically asks about them or wants to use their existing account).
- Do NOT name real Meraki staff or clients. Use generic example names (Maya, Riley, Jordan, Casey for staff; Emma, Olivia, Sophia, Isabella for clients).
- Do NOT call walk-in handling "turn rotation" or "turn-based". Use "smart walk-in management" or just "walk-in handling".
- Setup time + third-party accounts: if asked about setup or whether they need to create accounts at other services, ALWAYS lead with: "You only ever sign into Plume Nexus. We handle every other service (payments, SMS, email, AI) under the hood — you never need to create accounts anywhere else." Setup claim is "live by lunch" — most salons are operational in 30-60 minutes with our AI website auto-import (paste your existing website URL and we pre-fill services, hours, brand details). If they can't get set up in time, we concierge it for free.
- IMPORTANT: Even when the user names a specific vendor in their question (e.g. "do I need a Twilio account?" or "what about Mailchimp?"), DO NOT echo the vendor name back in your response. Refer to the category instead ("SMS service", "email tool", "payment processor", etc.). The only vendor names you may use in responses are Stripe and Gusto — and only because they're customer-facing integrations they may want to bring their own of.

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
Hybrid model: pick a base tier, then stack Power Packs for what you actually need.

Base tiers:
- Solo — Free for Founders' Members through June 30, 2027 (then $49/mo for new signups). Founders' Members keep lifetime free access. 1 staff, scheduling, POS, gift cards, AI reports, email + booking page (no SMS on free).
- Studio — $79/mo: up to 8 staff, multi-tech credit splits, smart walk-in management, custom booking domain, priority support.
- Salon Pro — $149/mo: unlimited staff, multi-location (Q3), founder-direct support, 2FA, dedicated onboarding.

Power Packs (stack on any tier):
- Comms Pack ($19/mo) — two-way SMS + dedicated phone + email reply parsing + STOP keyword handling.
- Marketing Pack ($19/mo) — loyalty + tiers + auto-rebook + send-time optimizer + advanced segments.
- AI Pack ($19/mo) — voice-command booking + AI-drafted marketing copy + conflict-resolution drafts.
- Operations Pack ($29/mo) — Gusto payroll sync + advanced reporting + 1099-NEC PDFs + multi-location (already included on Salon Pro).
- Brand Pack ($39/mo) — white-label client app + custom-branded TipFlow kiosk + custom email sender domain.

Atomic add-ons (escape hatch for power users who want exactly one feature from a pack):
- SMS only: $15/mo (vs $19 Comms Pack)
- Voice commands only: $15/mo (vs $19 AI Pack)
- Loyalty only: $15/mo (vs $19 Marketing Pack)
- Gusto only: $25/mo (vs $29 Operations Pack)
- Custom email sender domain only: $15/mo (vs $39 Brand Pack)

Pricing logic: packs are always slightly cheaper than buying every atom in them. If a customer wants 2+ atoms from the same pack, the pack is cheaper. If they want exactly one, the atom is cheaper. Most salons want most of a category, so packs are the recommended path.

Examples:
- Solo stylist with Founders' Year + wants SMS + AI: $0 + $19 Comms + $19 AI = $38/mo
- 5-tech salon, full marketing user: $79 Studio + $19 Comms + $19 Marketing + $19 AI = $136/mo
- Multi-location power user: $149 Salon Pro + all 5 packs = $274/mo

- Annual billing saves 20%
- Month-to-month, cancel anytime, no exit fees, full data export on request

━━━ FOUNDERS' YEAR ━━━
- Anyone who signs up for Solo before June 30, 2027 is a "Founders' Member" — their Solo plan is free for life, no expiration. After June 30, 2027, the Solo plan becomes paid ($49/mo) for new signups. Founders' Members keep their lifetime free access regardless.
- Founders' Members also get: a Founders badge in the app, early access to new features, and a vote on the product roadmap.
- This is a real cohort, not a marketing trick. The deadline may be extended (we'll announce publicly with at least 90 days notice if so) but won't be shortened.
- If asked about the Founders' Year deadline being extended in the past or possibly in the future: it's possible we extend (with public notice) but the lifetime free promise to existing Founders' Members is permanent.

━━━ MIGRATION & SUPPORT ━━━
- Migration: CSV export from your current platform → one-time import in a single business day. The migration tool dedupes refunds and split payments correctly.
- Stripe payments: each tenant connects their own Stripe account (funds settle directly to your bank).
- SMS: dedicated phone number per tenant, separate marketing vs transactional numbers so STOP keywords don't accidentally opt clients out of appointment confirmations.
- Support: founder-direct email at hello@plumenexus.com on every plan.

━━━ DATA EXPORT IS ALWAYS FREE ━━━
- One click in Settings exports the customer's entire account: clients, appointments, services, employees, receipts, photos, marketing history. CSV + JSON.
- Free on every plan, including Free Solo, including Founders' Members, including paused accounts, including the 90-day post-cancellation grace period. Forever.
- Never paywalled, never gated behind a support ticket, never delayed.
- This is a core principle, not a feature. If a customer is leaving because the service isn't working for them, we will not make leaving harder. We'd rather they leave with everything intact and recommend us to a friend than feel trapped.
- If asked about lock-in, vendor risk, or "what if I want to leave?": lead with this answer.

━━━ FOUNDER ACCESS IS BY INVITATION ONLY ━━━
- The Plume Nexus team CANNOT read a customer's clients, appointments, receipts, or messages without that customer's explicit invitation.
- Our internal platform admin dashboard returns only metadata (plan, billing, last activity, total counts) — never PII.
- If a customer wants the founder to see something specific (for support), they invite him as an admin via their own salon-app users settings — the same Google-Auth flow used to add any of their staff. They control who has access, and they can revoke it any time.
- There is NO "view as tenant" impersonation feature. There is NO super-user override. There is NO production data extract.
- Most SaaS quietly keeps god-mode access via support impersonation. We architected the platform so we can't.
- If asked about vendor data access, privacy, or "can your team see my data?": lead with this answer. It's a real differentiator competitors can't match without re-architecting.

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
          // Platform-level inquiry, not tenant-bound — always send from
          // the Plume Nexus identity to my admin inbox.
          from:     'Plume Nexus <noreply@plumenexus.com>',
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

// ─────────────────────────────────────────────────────────────────────────────
// Platform admin — single chokepoint for tenant metadata.
//
// PRINCIPLE #10: The founder cannot read tenant customer data without that
// tenant's invitation. This function returns ONLY sanitized aggregate fields:
// counts, timestamps, plan/billing metadata. NEVER PII (no client names,
// no appointment details, no message content).
//
// Anything that wants to surface in the platform admin UI must go through
// this function. If a future field would expose customer data, do not add it.
// ─────────────────────────────────────────────────────────────────────────────

// Authoritative platform-admin allowlist check. Always allows the bootstrap
// email; otherwise consults `platform/admins` Firestore doc.
async function isPlatformAdmin(authEmail) {
  if (!authEmail) return false;
  if (String(authEmail).toLowerCase() === 'jvankim@gmail.com') return true;
  try {
    const db = getFirestore();
    const snap = await db.doc('platform/admins').get();
    if (!snap.exists) return false;
    const list = (snap.data().emails || []).map(e => String(e).toLowerCase().trim());
    return list.includes(String(authEmail).toLowerCase().trim());
  } catch (e) {
    console.error('[isPlatformAdmin] check failed:', e?.message);
    return false;
  }
}

exports.getTenantMetadata = onCall(
  { cors: true, timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerEmail = request.auth.token.email;
    if (!await isPlatformAdmin(callerEmail)) {
      throw new HttpsError('permission-denied', 'Platform admin only');
    }

    const { tenantId } = request.data || {};
    if (!tenantId || typeof tenantId !== 'string') {
      throw new HttpsError('invalid-argument', 'tenantId required');
    }

    const db = getFirestore();
    const [
      registrySnap, usersSnap, settingsSnap,
      apptCountSnap, latestApptSnap, latestReceiptSnap, latestChatSnap,
    ] = await Promise.all([
      db.doc(`tenants/${tenantId}`).get(),
      db.doc(`tenants/${tenantId}/data/users`).get(),
      db.doc(`tenants/${tenantId}/data/settings`).get(),
      db.collection(`tenants/${tenantId}/appointments`).count().get().catch(() => null),
      db.collection(`tenants/${tenantId}/appointments`).orderBy('updatedAt', 'desc').limit(1).get().catch(() => null),
      db.collection(`tenants/${tenantId}/receipts`).orderBy('createdAt', 'desc').limit(1).get().catch(() => null),
      db.collection(`tenants/${tenantId}/chats`).orderBy('lastMessageAt', 'desc').limit(1).get().catch(() => null),
    ]);

    if (!registrySnap.exists) throw new HttpsError('not-found', 'Tenant not found');

    const registry = registrySnap.data();
    const users    = usersSnap.exists  ? usersSnap.data()    : {};
    const settings = settingsSnap.exists ? settingsSnap.data() : {};

    const timestamps = [];
    if (latestApptSnap?.docs[0])    timestamps.push(latestApptSnap.docs[0].data().updatedAt);
    if (latestReceiptSnap?.docs[0]) timestamps.push(latestReceiptSnap.docs[0].data().createdAt);
    if (latestChatSnap?.docs[0])    timestamps.push(latestChatSnap.docs[0].data().lastMessageAt);
    const lastActivityIso = timestamps.filter(Boolean).sort().pop() || null;

    // EXPLICIT enumerated safe fields. If you're tempted to add a field here
    // that exposes customer data (names, emails, message content, appointment
    // details), DON'T. Add an aggregate count or boolean instead.
    return {
      id:               tenantId,
      name:             registry.name             || null,
      ownerEmail:       registry.ownerEmail       || null,
      plan:             registry.plan             || null,
      packs:            registry.packs            || [],
      atomicAddOns:     registry.atomicAddOns     || [],
      foundersMember:   registry.foundersMember   === true,
      active:           registry.active           !== false,
      createdAt:        registry.createdAt        || null,
      legacyPlan:       registry.legacyPlan       || null,
      provisioned:      usersSnap.exists,
      // staffEmails projection is the canonical count post-split
      // (rich users[] now lives in data/usersFull, not read here).
      userCount:        Array.isArray(users.staffEmails) ? users.staffEmails.length : 0,
      apptCount:        apptCountSnap ? apptCountSnap.data().count : 0,
      lastActivityIso,
      pauseActive:      Boolean(settings.pause?.until && settings.pause.until >= new Date().toISOString().slice(0, 10)),
      techRemindersEnabled: settings.techReminders?.enabled !== false,
      timeoutMin:       Number(settings.timeoutMin) || null,
    };
  }
);

exports.listTenants = onCall(
  { cors: true, timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (!await isPlatformAdmin(request.auth.token.email)) {
      throw new HttpsError('permission-denied', 'Platform admin only');
    }

    const db = getFirestore();
    const snap = await db.collection('tenants').orderBy('createdAt', 'desc').get();
    // Registry-level metadata only. NO sub-document reads here.
    return {
      tenants: snap.docs.map(d => {
        const t = d.data();
        return {
          id:             d.id,
          name:           t.name           || null,
          ownerEmail:     t.ownerEmail     || null,
          plan:           t.plan           || null,
          packs:          t.packs          || [],
          foundersMember: t.foundersMember === true,
          active:         t.active         !== false,
          createdAt:      t.createdAt      || null,
          legacyPlan:     t.legacyPlan     || null,
        };
      }),
    };
  }
);
