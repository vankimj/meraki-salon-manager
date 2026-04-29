const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule }       = require('firebase-functions/v2/scheduler');
const { onCall, onRequest, HttpsError }= require('firebase-functions/v2/https');
const { initializeApp }    = require('firebase-admin/app');
const { getFirestore }     = require('firebase-admin/firestore');
const { defineString }     = require('firebase-functions/params');
const { Resend }           = require('resend');

initializeApp();

const TENANT_ID   = 'meraki';
const resendKey   = defineString('RESEND_API_KEY',      { default: '' });
const resendFrom  = defineString('RESEND_FROM',         { default: 'Meraki Nail Studio <noreply@merakinailstudio.com>' });
const mapsApiKey  = defineString('GOOGLE_MAPS_API_KEY', { default: '' });

function fmtTime(str) {
  if (!str) return '';
  const [h, m] = str.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
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
  const dateStr = `${fmtDate(data.date)} at ${fmtTime(data.startTime)}`;
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Schedule Notification</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;line-height:1.65;color:#222;margin:0 0 20px;">${data.message}</p>
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border:1px solid #e8e8e8;">
        <div style="font-size:13px;color:#555;margin-bottom:6px;">
          <span style="margin-right:8px;">📅</span>${dateStr}
        </div>
        <div style="font-size:13px;color:#555;">
          <span style="margin-right:8px;">👤</span>${data.clientName}
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
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${firstName}!</p>
      <p style="font-size:14px;line-height:1.65;color:#555;margin:0 0 20px;">
        The <strong>${title}</strong> (v${version}) has been updated and requires your acknowledgment.
        Please log in to the Meraki Salon Manager app to read and sign the latest handbook.
      </p>
      <div style="background:#FEF9EC;border-radius:8px;padding:14px 16px;border:1px solid #fcd34d;">
        <div style="font-size:13px;color:#92400e;font-weight:600;">Action Required</div>
        <div style="font-size:13px;color:#555;margin-top:4px;">Sign the ${title} v${version} in the Meraki app under HR → Handbook.</div>
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

    const dateStr     = `${fmtDate(date)}${startTime ? ' at ' + fmtTime(startTime) : ''}`;
    const firstName   = (clientName || 'there').split(' ')[0];
    const serviceRows = services.map(s =>
      `<tr><td style="padding:6px 0;color:#333;font-size:13px;">${s.name || '—'}${s.techName && s.techName !== techName ? ` <span style="color:#aaa">(${s.techName})</span>` : ''}</td><td style="text-align:right;padding:6px 0;color:#333;font-size:13px;">$${Number(s.price || 0).toFixed(2)}</td></tr>`
    ).join('');

    const summaryRows = [
      payment.discountAmount > 0 && `<tr><td style="padding:4px 0;font-size:12px;color:#888;">Discount</td><td style="text-align:right;font-size:12px;color:#ef4444;">-$${payment.discountAmount.toFixed(2)}</td></tr>`,
      payment.promoAmount    > 0 && `<tr><td style="padding:4px 0;font-size:12px;color:#888;">Promo (${payment.promoCode})</td><td style="text-align:right;font-size:12px;color:#ef4444;">-$${payment.promoAmount.toFixed(2)}</td></tr>`,
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
      <p style="font-size:15px;color:#222;margin:0 0 4px;font-weight:600;">Hi ${firstName}!</p>
      <p style="font-size:13px;color:#888;margin:0 0 20px;">Thanks for visiting Meraki Nail Studio. Here's your receipt.</p>

      <div style="background:#f8f9fa;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:12px;color:#555;">
        <div>📅 ${dateStr}</div>
        <div style="margin-top:4px;">👩‍💼 ${techName || 'Your technician'}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
        <tr style="border-bottom:1px solid #e8e8e8;">
          <th style="text-align:left;font-size:11px;color:#aaa;padding-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Service</th>
          <th style="text-align:right;font-size:11px;color:#aaa;padding-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Price</th>
        </tr>
        ${serviceRows}
        ${retailProducts.length > 0 ? `
          <tr><td colspan="2" style="padding:8px 0 4px;font-size:11px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.06em;border-top:1px solid #f0f0f0;">Retail Products</td></tr>
          ${retailProducts.map(rp => `<tr><td style="padding:6px 0;color:#333;font-size:13px;">${rp.name}${rp.qty > 1 ? ` ×${rp.qty}` : ''}</td><td style="text-align:right;padding:6px 0;color:#333;font-size:13px;">$${(Number(rp.price || 0) * (rp.qty || 1)).toFixed(2)}</td></tr>`).join('')}
        ` : ''}
        ${summaryRows ? `<tr><td colspan="2" style="padding:6px 0;border-top:1px solid #f0f0f0;"></td></tr>${summaryRows}` : ''}
        <tr style="border-top:1px solid #e8e8e8;">
          <td style="padding:10px 0 0;font-size:14px;font-weight:700;color:#1a1a1a;">Total</td>
          <td style="text-align:right;padding:10px 0 0;font-size:14px;font-weight:700;color:#2D7A5F;">$${Number(payment.total || 0).toFixed(2)}</td>
        </tr>
        <tr>
          <td colspan="2" style="font-size:11px;color:#aaa;padding-top:3px;">Paid via ${payment.method || '—'}</td>
        </tr>
      </table>

      ${googleReviewUrl
        ? `<div style="margin:20px 0 0;text-align:center;">
             <a href="${googleReviewUrl}" style="display:inline-block;background:#2D7A5F;color:#fff;font-size:13px;font-weight:700;padding:11px 24px;border-radius:10px;text-decoration:none;letter-spacing:.01em;">⭐ Leave us a Google Review</a>
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

function buildMarketingHtml(bodyHtml, promoCode, promoLabel) {
  const promoBlock = promoCode ? `
      <div style="margin:20px 0;background:#f0faf6;border:2px dashed #2D7A5F;border-radius:10px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:#2D7A5F;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;">Your Exclusive Promo Code</div>
        <div style="font-size:26px;font-weight:800;color:#1a1a1a;letter-spacing:.12em;font-family:monospace,sans-serif;">${promoCode}</div>
        ${promoLabel ? `<div style="font-size:12px;color:#888;margin-top:6px;">${promoLabel}</div>` : ''}
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
    </div>
    <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
      <p style="font-size:10px;color:#ccc;margin:4px 0 0;">You're receiving this as a valued client. Reply to this email to unsubscribe.</p>
    </div>
  </div>
</body>
</html>`;
}

exports.sendMarketingCampaign = onDocumentCreated(
  { document: `tenants/${TENANT_ID}/campaigns/{campaignId}`, timeoutSeconds: 540 },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (!data || data.status !== 'pending') return;

    const apiKey = resendKey.value();
    if (!apiKey) { await snap.ref.update({ status: 'failed', error: 'resend_not_configured' }); return; }

    const { subject, body, recipients = [] } = data;
    if (!recipients.length) {
      await snap.ref.update({ status: 'done', sentCount: 0, sentAt: new Date().toISOString() });
      return;
    }

    await snap.ref.update({ status: 'sending' });

    const resend = new Resend(apiKey);
    let sentCount = 0, failCount = 0;

    for (const recipient of recipients) {
      const { name, email } = recipient;
      if (!email) { failCount++; continue; }

      const firstName        = (name || 'there').split(' ')[0];
      const personalizedBody = (body || '').replace(/\{firstName\}/gi, firstName);
      const bodyHtml         = personalizedBody
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

      try {
        const { error } = await resend.emails.send({
          from:    resendFrom.value(),
          to:      email,
          subject,
          html:    buildMarketingHtml(bodyHtml, data.promoCode || null, data.promoLabel || null),
        });
        if (error) throw new Error(error.message || JSON.stringify(error));
        sentCount++;
      } catch (e) {
        console.error(`[Marketing] Failed for ${email}:`, e.message);
        failCount++;
      }

      // ~20 emails/second — stays within Resend rate limits
      await new Promise(r => setTimeout(r, 50));
    }

    await snap.ref.update({ status: 'done', sentCount, failCount, sentAt: new Date().toISOString() });
    console.log(`[Marketing] "${data.name}": sent ${sentCount}, failed ${failCount}`);
  }
);

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
    if (!clientEmail)     { await snap.ref.update({ error: 'no_email' });      return; }
    if (!googleReviewUrl) { await snap.ref.update({ error: 'no_review_url' }); return; }

    const firstName   = (clientName || 'there').split(' ')[0];
    const reqId       = snap.id;
    const trackUrl    = `https://us-central1-meraki-salon-manager.cloudfunctions.net/trackReviewClick?r=${reqId}`;
    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">We'd love your feedback</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${firstName}! 💅</p>
      <p style="font-size:14px;line-height:1.7;color:#555;margin:0 0 24px;">
        Thank you so much for visiting us at Meraki Nail Studio! We hope you loved your nails.
        If you have a moment, leaving us a Google review would mean the world to us and helps
        other clients find us.
      </p>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${trackUrl}" style="display:inline-block;background:#f59e0b;color:#fff;font-size:14px;font-weight:700;padding:13px 32px;border-radius:10px;text-decoration:none;letter-spacing:.01em;">
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
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${tFirstName}!</p>
      <p style="font-size:14px;line-height:1.7;color:#555;margin:0 0 16px;">
        A Google review request was just sent to <strong>${clientName}</strong>.
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
        <div><strong>Name:</strong> ${name}</div>
        <div style="margin-top:6px;"><strong>Email:</strong> ${req.email}</div>
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
  const dateStr  = `${fmtDate(appt.date)} at ${fmtTime(appt.startTime)}`;
  const services = (appt.services || []).map(s => s.name).filter(Boolean).join(', ') || 'Nail services';
  const duration = appt.duration ? `${appt.duration} min` : '';
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Appointment Reminder</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${client.name?.split(' ')[0] || client.name}!</p>
      <p style="font-size:14px;line-height:1.65;color:#555;margin:0 0 20px;">
        Just a reminder that you have an appointment <strong>tomorrow</strong> at Meraki Nail Studio.
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:16px;border:1px solid #e8e8e8;">
        <div style="font-size:13px;color:#333;margin-bottom:8px;display:flex;gap:10px;">
          <span>📅</span><span><strong>${dateStr}</strong></span>
        </div>
        <div style="font-size:13px;color:#333;margin-bottom:8px;display:flex;gap:10px;">
          <span>💅</span><span>${services}${duration ? ` <span style="color:#aaa">(${duration})</span>` : ''}</span>
        </div>
        <div style="font-size:13px;color:#333;margin-bottom:8px;display:flex;gap:10px;">
          <span>👩‍💼</span><span>with ${appt.techName}</span>
        </div>
        <div style="font-size:13px;color:#333;display:flex;gap:10px;">
          <span>📍</span><span>Columbus, OH</span>
        </div>
      </div>
      <p style="font-size:12px;color:#aaa;margin:16px 0 0;line-height:1.5;">
        Need to reschedule? Please contact us as soon as possible so we can accommodate you.
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
  const dateStr   = `${fmtDate(meeting.date)} at ${fmtTime(meeting.startTime)}`;
  const durLabel  = meeting.duration ? `${meeting.duration} min` : '';
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Meeting Reminder — starting in ${timeLabel}</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${firstName}!</p>
      <p style="font-size:14px;line-height:1.65;color:#555;margin:0 0 20px;">
        Your meeting is starting in <strong>${timeLabel}</strong>. See you there!
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:16px;border:1px solid #e8e8e8;">
        <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:10px;">${meeting.title}</div>
        <div style="font-size:13px;color:#555;margin-bottom:6px;">📅 ${dateStr}${durLabel ? ` (${durLabel})` : ''}</div>
        ${meeting.location ? `<div style="font-size:13px;color:#555;margin-bottom:6px;">📍 ${meeting.location}</div>` : ''}
        ${meeting.description ? `<div style="font-size:12px;color:#888;margin-top:8px;line-height:1.5;">${meeting.description.replace(/\n/g, '<br>')}</div>` : ''}
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

    const resend    = new Resend(apiKey);
    const firstName = (appt.clientName || 'there').split(' ')[0];
    const dateStr   = `${fmtDate(appt.date)} at ${fmtTime(appt.startTime)}`;
    const svcName   = appt.services?.[0]?.name || 'Nail service';
    const techLine  = appt.techName && appt.techName !== 'TBD' ? appt.techName : 'a available stylist';

    const clientHtml = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#2D7A5F,#3D95CE);padding:20px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px;">Meraki Nail Studio</div>
      <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:2px;">Booking Confirmation</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">Hi ${firstName}!</p>
      <p style="font-size:14px;line-height:1.65;color:#555;margin:0 0 20px;">
        Your appointment has been booked. We can't wait to see you!
      </p>
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border:1px solid #e8e8e8;">
        <div style="font-size:13px;color:#555;margin-bottom:8px;"><strong>📅</strong> ${dateStr}</div>
        <div style="font-size:13px;color:#555;margin-bottom:8px;"><strong>💅</strong> ${svcName}</div>
        <div style="font-size:13px;color:#555;margin-bottom:8px;"><strong>👩‍💼</strong> With ${techLine}</div>
        <div style="font-size:13px;color:#555;"><strong>📍</strong> Meraki Nail Studio, Columbus OH</div>
      </div>
      <p style="font-size:12px;color:#aaa;margin:16px 0 0;">Need to reschedule? Give us a call and we'll take care of you.</p>
    </div>
    <div style="padding:12px 24px 20px;text-align:center;">
      <p style="font-size:11px;color:#bbb;margin:0;">Meraki Nail Studio · Columbus, OH</p>
    </div>
  </div>
</body>
</html>`;

    // Send to client
    if (appt.clientEmail) {
      await resend.emails.send({
        from:    resendFrom.value(),
        to:      appt.clientEmail,
        subject: `Booking confirmed — ${fmtDate(appt.date)} at ${fmtTime(appt.startTime)}`,
        html:    clientHtml,
      }).catch(e => console.error('[Booking] Client email failed:', e.message));
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
        <div style="margin-bottom:6px;"><strong>Client:</strong> ${appt.clientName}${appt.clientPhone ? ' · ' + appt.clientPhone : ''}</div>
        <div style="margin-bottom:6px;"><strong>Date:</strong> ${dateStr}</div>
        <div style="margin-bottom:6px;"><strong>Service:</strong> ${svcName}</div>
        <div><strong>Stylist:</strong> ${appt.techName || 'TBD'}</div>
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
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">New message from ${data.clientName || 'a client'}</p>
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border:1px solid #e8e8e8;margin:12px 0;">
        <div style="font-size:13px;color:#555;font-style:italic;">"${preview}"</div>
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
      <p style="font-size:15px;color:#222;margin:0 0 6px;font-weight:600;">⭐ New review from ${data.clientName || 'a client'}!</p>
      <div style="background:#fffbeb;border-radius:8px;padding:14px 16px;border:1px solid #fde68a;margin:12px 0;">
        <div style="font-size:20px;color:#f59e0b;margin-bottom:6px;letter-spacing:2px;">${stars}</div>
        ${data.techName ? `<div style="font-size:13px;color:#555;">Serviced by <strong>${data.techName}</strong></div>` : ''}
        ${data.date ? `<div style="font-size:12px;color:#aaa;margin-top:4px;">${data.date}</div>` : ''}
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

// Tracks when a client clicks the review link in their email, then redirects to Google.
exports.trackReviewClick = onRequest({ cors: false }, async (req, res) => {
  const reqId = req.query.r;
  const db    = getFirestore();

  let redirectTo = `https://g.page/r/review`; // fallback
  try {
    if (reqId) {
      const ref  = db.doc(`tenants/${TENANT_ID}/reviewRequests/${reqId}`);
      const snap = await ref.get();
      if (snap.exists) {
        const data = snap.data();
        if (data.googleReviewUrl) redirectTo = data.googleReviewUrl;
        if (!data.clickedAt) {
          await ref.update({ clickedAt: new Date().toISOString() });
        }
      }
    }
  } catch (e) {
    console.error('[ReviewClick] Error:', e.message);
  }

  res.redirect(302, redirectTo);
});
