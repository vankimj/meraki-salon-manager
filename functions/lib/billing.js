// Pure, testable billing helpers extracted from functions/index.js so
// they can be unit-tested without spinning up firebase-functions runtime.
// The orchestrator handleChargeRefunded takes its Firestore + Stripe +
// sendEmail dependencies as parameters so tests can inject fakes.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

// Build a refund record from a Stripe Charge object. The Charge carries
// `refunds.data[]` ordered newest-first; we key the Firestore doc by the
// latest refund's id so retried webhooks are idempotent (Stripe re-delivers
// events on 5xx — same refund event = same doc, no duplicates).
function buildRefundRecord(charge) {
  const latest = charge.refunds?.data?.[0] || null;
  return {
    refundId:        latest?.id || null,
    chargeId:        charge.id,
    invoiceId:       charge.invoice || null,
    paymentIntentId: charge.payment_intent || null,
    customerId:      charge.customer || null,
    amount:          charge.amount,
    amountRefunded:  charge.amount_refunded,
    currency:        charge.currency,
    reason:          latest?.reason || null,
    isFullRefund:    charge.amount_refunded === charge.amount,
    refundedAt:      new Date().toISOString(),
  };
}

function buildTenantRefundEmailHtml({ salonName, amountDollars, currency, isFullRefund, reason }) {
  const refundLabel = isFullRefund ? 'Full refund' : 'Partial refund';
  const reasonLine  = reason ? `<p style="color:#666;font-size:13px;margin:0 0 16px"><strong>Reason:</strong> ${esc(reason)}</p>` : '';
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f7fa;margin:0;padding:32px 16px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="background:#0f1923;padding:32px;text-align:center">
    <div style="font-size:28px;color:#fff;font-weight:300;letter-spacing:2px">Plume Nexus</div>
  </div>
  <div style="padding:32px">
    <h2 style="color:#1a1a1a;margin:0 0 8px">Refund processed</h2>
    <p style="color:#555;margin:0 0 20px">Hi ${esc(salonName)} team — we've issued a ${refundLabel.toLowerCase()} to your card on file.</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-bottom:24px">
      <div style="font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${refundLabel}</div>
      <div style="font-size:24px;color:#1a1a1a;font-weight:700">$${esc(amountDollars)} ${esc((currency || 'USD').toUpperCase())}</div>
    </div>
    ${reasonLine}
    <p style="color:#666;font-size:13px;margin:0 0 12px">It can take 5–10 business days for the refund to appear on your statement, depending on your bank.</p>
    <p style="color:#666;font-size:13px;margin:0">Your subscription remains active. Questions? Just reply to this email.</p>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #f0f0f0;font-size:11px;color:#aaa;text-align:center">
    Plume Nexus · <a href="https://plumenexus.com" style="color:#aaa">plumenexus.com</a>
  </div>
</div></body></html>`;
}

function buildMemberRefundEmailHtml({ clientName, planName, amountDollars, currency, isFullRefund, salonName }) {
  const refundLabel = isFullRefund ? 'Full refund' : 'Partial refund';
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f7fa;margin:0;padding:32px 16px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="padding:32px">
    <h2 style="color:#1a1a1a;margin:0 0 8px">Your refund has been processed</h2>
    <p style="color:#555;margin:0 0 20px">Hi ${esc(clientName || 'there')} — ${esc(salonName)} has issued a ${refundLabel.toLowerCase()} for your <strong>${esc(planName)}</strong>.</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-bottom:24px">
      <div style="font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${refundLabel}</div>
      <div style="font-size:24px;color:#1a1a1a;font-weight:700">$${esc(amountDollars)} ${esc((currency || 'USD').toUpperCase())}</div>
    </div>
    <p style="color:#666;font-size:13px;margin:0">It can take 5–10 business days for the refund to appear on your statement, depending on your bank. Reply with any questions.</p>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #f0f0f0;font-size:11px;color:#aaa;text-align:center">
    ${esc(salonName)} via Plume Nexus
  </div>
</div></body></html>`;
}

// Process a charge.refunded event. Routes by subscription metadata:
//   type === 'membership' → record under the membership doc, email the client.
//   otherwise (SaaS)      → record under tenant billing, email the owner.
// Dependencies are injected so unit tests can pass fakes:
//   db        — Firestore instance (getFirestore() in production)
//   stripe    — initialised Stripe client
//   sendEmail — async ({from,to,subject,html,tenantId}) => {data,error}
async function handleChargeRefunded(charge, db, stripe, sendEmail) {
  if (!charge.invoice) {
    console.log(`[refund] charge ${charge.id} has no invoice — skipping (one-time charge)`);
    return { skipped: 'no_invoice' };
  }

  const refund = buildRefundRecord(charge);
  if (!refund.refundId) {
    console.warn(`[refund] charge ${charge.id} has no refund in refunds.data — Stripe payload anomaly`);
    return { skipped: 'no_refund_data' };
  }

  const invoice = await stripe.invoices.retrieve(charge.invoice);
  if (!invoice.subscription) {
    console.log(`[refund] invoice ${invoice.id} has no subscription — skipping`);
    return { skipped: 'no_subscription' };
  }
  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  const meta = subscription.metadata || {};
  const isMembership = meta.type === 'membership';
  const tid = meta.tenantId;
  if (!tid) {
    console.warn(`[refund] subscription ${subscription.id} missing metadata.tenantId — can't route refund`);
    return { skipped: 'no_tenant_id' };
  }

  const amountDollars = (refund.amountRefunded / 100).toFixed(2);

  if (isMembership) {
    const memId = meta.membershipId;
    if (!memId) {
      console.warn(`[refund] membership subscription ${subscription.id} missing metadata.membershipId`);
      return { skipped: 'no_membership_id' };
    }
    await db.doc(`tenants/${tid}/memberships/${memId}/refunds/${refund.refundId}`).set(refund);

    const [tenSnap, memSnap] = await Promise.all([
      db.doc(`tenants/${tid}`).get(),
      db.doc(`tenants/${tid}/memberships/${memId}`).get(),
    ]);
    const ten = tenSnap.data() || {};
    const mem = memSnap.data() || {};
    if (mem.clientId) {
      const clientSnap = await db.doc(`tenants/${tid}/clients/${mem.clientId}`).get();
      const client = clientSnap.data() || {};
      if (client.email) {
        const { error } = await sendEmail({
          from: `${ten.name || 'Your salon'} <noreply@plumenexus.com>`,
          to:   client.email,
          subject: `Your refund has been processed`,
          html:  buildMemberRefundEmailHtml({
            clientName:    client.name || client.firstName || '',
            planName:      mem.planName || 'Membership',
            amountDollars,
            currency:      refund.currency,
            isFullRefund:  refund.isFullRefund,
            salonName:     ten.name || 'Your salon',
          }),
          tenantId: tid,
        });
        if (error) console.error(`[refund email member] ${client.email}:`, error.message);
      }
    }
    return { routed: 'membership', tenantId: tid, membershipId: memId, refundId: refund.refundId };
  }

  await db.doc(`tenants/${tid}/refunds/${refund.refundId}`).set(refund);
  const tenSnap = await db.doc(`tenants/${tid}`).get();
  const ten = tenSnap.data() || {};
  if (ten.ownerEmail) {
    const { error } = await sendEmail({
      from: 'Plume Nexus <noreply@plumenexus.com>',
      to:   ten.ownerEmail,
      subject: `Refund processed for ${ten.name || 'your subscription'}`,
      html:  buildTenantRefundEmailHtml({
        salonName:     ten.name || 'Your salon',
        amountDollars,
        currency:      refund.currency,
        isFullRefund:  refund.isFullRefund,
        reason:        refund.reason,
      }),
      tenantId: tid,
    });
    if (error) console.error(`[refund email tenant] ${ten.ownerEmail}:`, error.message);
  }
  return { routed: 'saas', tenantId: tid, refundId: refund.refundId };
}

// ── Dispute (chargeback) handling ─────────────────────────────────────────
// Stripe disputes are time-sensitive: typically 7-21 days to submit evidence
// before Stripe sides with the cardholder by default. Missing the window =
// automatic loss + funds permanently withdrawn. Both the platform owner
// (who responds via Stripe Dashboard) and the tenant owner (who has the
// context — receipts, photos, conversation logs) need to know immediately.

// Build a dispute record. Pure for testability. Idempotent: re-running with
// the same dispute object produces the same record (apart from updatedAt).
// Routing metadata (isMembership / membershipId / clientId / clientName) is
// passed in by the orchestrator rather than derived from the dispute itself
// (since Stripe dispute payloads don't carry our subscription metadata).
function buildDisputeRecord(dispute, routing = {}) {
  return {
    disputeId:      dispute.id,
    chargeId:       dispute.charge || null,
    amount:         dispute.amount,
    currency:       dispute.currency,
    reason:         dispute.reason || null,
    status:         dispute.status || null,
    evidenceDueBy:  dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
      : null,
    isChargeRefundable: !!dispute.is_charge_refundable,
    isMembership:   !!routing.isMembership,
    membershipId:   routing.membershipId || null,
    clientId:       routing.clientId || null,
    clientName:     routing.clientName || null,
    createdAt:      dispute.created ? new Date(dispute.created * 1000).toISOString() : new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
  };
}

// Best-effort Stripe Dashboard URL. Works for both test and live mode
// because Stripe figures out the routing based on which mode you're
// signed into. Member of public Stripe URL contract.
function disputeDashboardUrl(disputeId) {
  return `https://dashboard.stripe.com/disputes/${esc(disputeId)}`;
}

// Format the due-by date in a human-readable way. Returns null if no date.
// Pinned to UTC with an explicit label: this is a hard Stripe dispute deadline,
// and Cloud Functions render in the server's timezone — an UNLABELED local time
// (e.g. "10:00 AM") could be misread as the salon's own zone and cause a missed
// deadline. (timeZoneName can't be combined with dateStyle/timeStyle — it throws
// — so the "UTC" label is appended explicitly.)
function formatDueBy(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

function buildPlatformDisputeAlertHtml({ tenantName, tenantOwnerEmail, amountDollars, currency, reason, dueByLabel, disputeId, isMembership, clientName }) {
  const who = isMembership
    ? `${esc(clientName || 'A salon client')} (client of ${esc(tenantName)})`
    : `${esc(tenantName)} (${esc(tenantOwnerEmail || 'no owner email')})`;
  const deadlineBox = dueByLabel
    ? `<div style="background:#fef2f2;border:2px solid #ef4444;border-radius:12px;padding:16px 20px;margin-bottom:24px">
         <div style="font-size:11px;color:#991b1b;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Evidence due</div>
         <div style="font-size:18px;color:#991b1b;font-weight:700">${esc(dueByLabel)}</div>
         <div style="font-size:12px;color:#7f1d1d;margin-top:6px">After this deadline, Stripe sides with the cardholder by default.</div>
       </div>`
    : '';
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f7fa;margin:0;padding:32px 16px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="background:#991b1b;padding:24px 32px">
    <div style="font-size:13px;color:#fecaca;font-weight:700;text-transform:uppercase;letter-spacing:2px">⚠ Action required</div>
    <div style="font-size:22px;color:#fff;font-weight:700;margin-top:4px">Chargeback dispute opened</div>
  </div>
  <div style="padding:28px 32px">
    <p style="color:#333;margin:0 0 16px;font-size:14px"><strong>${who}</strong> has had a charge disputed by the cardholder.</p>
    ${deadlineBox}
    <table style="width:100%;font-size:13px;color:#555;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="padding:6px 0;color:#999;width:120px">Amount</td><td>$${esc(amountDollars)} ${esc((currency || 'USD').toUpperCase())}</td></tr>
      <tr><td style="padding:6px 0;color:#999">Reason</td><td>${esc(reason || 'not provided')}</td></tr>
      <tr><td style="padding:6px 0;color:#999">Type</td><td>${isMembership ? 'Membership (salon client)' : 'SaaS subscription (tenant)'}</td></tr>
      <tr><td style="padding:6px 0;color:#999">Dispute ID</td><td style="font-family:monospace;font-size:12px">${esc(disputeId)}</td></tr>
    </table>
    <a href="${disputeDashboardUrl(disputeId)}" style="display:block;background:#ef4444;color:#fff;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:16px">Submit evidence in Stripe Dashboard →</a>
    <p style="color:#666;font-size:12px;margin:0;line-height:1.6">Next steps: gather receipts / appointment records / conversation logs from the affected ${isMembership ? 'salon' : 'tenant'} and upload them through the link above. Stripe will email you confirmation.</p>
  </div>
</div></body></html>`;
}

function buildTenantDisputeAlertHtml({ salonName, amountDollars, currency, reason, dueByLabel, isMembership, clientName, disputeId }) {
  const who = isMembership
    ? `Your client <strong>${esc(clientName || 'a member')}</strong> has filed a chargeback`
    : `Your salon's subscription payment has been disputed`;
  const deadlineLine = dueByLabel
    ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#9a3412"><strong>Time-sensitive:</strong> evidence is due by <strong>${esc(dueByLabel)}</strong>. After that deadline, Stripe sides with the cardholder by default.</div>`
    : '';
  const action = isMembership
    ? `Reply to this email with: appointment records, signed receipts, photos of completed services, and any text/email conversations with this client. Our team will compile and submit the response to Stripe on your behalf.`
    : `If you didn't authorize this dispute or want it withdrawn, contact our team by replying to this email within 24 hours.`;
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f7fa;margin:0;padding:32px 16px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="background:#0f1923;padding:28px 32px">
    <div style="font-size:11px;color:#fed7aa;font-weight:700;text-transform:uppercase;letter-spacing:2px">Action required</div>
    <div style="font-size:20px;color:#fff;font-weight:700;margin-top:4px">Chargeback dispute opened</div>
  </div>
  <div style="padding:28px 32px">
    <p style="color:#333;margin:0 0 16px;font-size:14px">${who} for <strong>$${esc(amountDollars)} ${esc((currency || 'USD').toUpperCase())}</strong>.</p>
    ${deadlineLine}
    <table style="width:100%;font-size:13px;color:#555;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="padding:6px 0;color:#999;width:120px">Reason given</td><td>${esc(reason || 'not provided')}</td></tr>
      <tr><td style="padding:6px 0;color:#999">Dispute ID</td><td style="font-family:monospace;font-size:12px">${esc(disputeId)}</td></tr>
    </table>
    <p style="color:#555;font-size:13px;line-height:1.7;margin:0 0 12px">${action}</p>
  </div>
  <div style="padding:14px 32px;border-top:1px solid #f0f0f0;font-size:11px;color:#aaa;text-align:center">
    ${esc(salonName)} via Plume Nexus
  </div>
</div></body></html>`;
}

function buildDisputeClosedEmailHtml({ tenantName, outcome, amountDollars, currency, isMembership, clientName, disputeId, audience }) {
  // audience: 'platform' | 'tenant'
  const won = outcome === 'won';
  const color = won ? '#15803d' : '#991b1b';
  const bg    = won ? '#f0fdf4' : '#fef2f2';
  const headline = won ? 'Dispute resolved in your favor' : 'Dispute lost';
  const summary = won
    ? `Stripe sided with you. The $${esc(amountDollars)} stays in your account.`
    : `Stripe sided with the cardholder. The $${esc(amountDollars)} has been withdrawn from the account.`;
  const who = isMembership ? `client ${esc(clientName || '')}` : `tenant ${esc(tenantName)}`;
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f7fa;margin:0;padding:32px 16px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="padding:28px 32px">
    <h2 style="color:${color};margin:0 0 8px;font-size:20px">${won ? '✓' : '✗'} ${headline}</h2>
    <p style="color:#555;margin:0 0 16px;font-size:13px">The chargeback dispute on ${who} for <strong>$${esc(amountDollars)} ${esc((currency || 'USD').toUpperCase())}</strong> has closed.</p>
    <div style="background:${bg};border:1px solid ${color};border-radius:10px;padding:14px 18px;margin-bottom:16px;font-size:13px;color:${color}">${summary}</div>
    ${audience === 'platform' ? `<p style="color:#666;font-size:12px;margin:0">Dispute ID: <code style="font-family:monospace">${esc(disputeId)}</code></p>` : ''}
  </div>
</div></body></html>`;
}

// Process a charge.dispute.created event. URGENT — Stripe gives a fixed
// (typically 7-21 day) window to submit evidence. Records under
// `tenants/{tid}/billing/disputes/{disputeId}` (SaaS) or
// `tenants/{tid}/memberships/{memId}/disputes/{disputeId}` (member) and
// emails BOTH the platform owner (who responds in Stripe Dashboard) AND
// the tenant owner (who has the context to provide).
async function handleChargeDisputeCreated(dispute, db, stripe, sendEmail, platformOwnerEmail) {
  // Disputes always target a Charge (no path where they don't). But the
  // charge might be a one-time payment (no invoice → no subscription →
  // no tenant). In that case we can still alert the platform owner.
  if (!dispute.charge) {
    console.warn(`[dispute] dispute ${dispute.id} has no charge — anomaly, skipping`);
    return { skipped: 'no_charge' };
  }
  const charge = await stripe.charges.retrieve(dispute.charge);
  const amountDollars = (dispute.amount / 100).toFixed(2);

  // Find the tenant via subscription metadata. If no subscription (one-time
  // charge), still alert the platform — chargeback on any charge matters.
  let tid = null;
  let memId = null;
  let isMembership = false;
  let clientId = null;
  let invoice = null;
  if (charge.invoice) {
    invoice = await stripe.invoices.retrieve(charge.invoice);
    if (invoice.subscription) {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const meta = subscription.metadata || {};
      tid          = meta.tenantId || null;
      memId        = meta.membershipId || null;
      isMembership = meta.type === 'membership';
      clientId     = meta.clientId || null;
    }
  }

  let tenantName = '';
  let tenantOwnerEmail = '';
  let clientName = '';
  if (tid) {
    const tenSnap = await db.doc(`tenants/${tid}`).get();
    const ten = tenSnap.data() || {};
    tenantName       = ten.name || '';
    tenantOwnerEmail = ten.ownerEmail || '';

    // Resolve clientName for membership disputes (used both in emails and
    // in the dispute record so the in-app UI can render it).
    if (isMembership && memId) {
      const memSnap = await db.doc(`tenants/${tid}/memberships/${memId}`).get();
      const mem = memSnap.data() || {};
      if (mem.clientId) {
        clientId = mem.clientId;
        const clientSnap = await db.doc(`tenants/${tid}/clients/${mem.clientId}`).get();
        const client = clientSnap.data() || {};
        clientName = client.name || client.firstName || '';
      }
    }
  }

  // All disputes live in one flat location: tenants/{tid}/billing/disputes/{id}.
  // Membership disputes carry isMembership=true + membershipId/clientId so the
  // UI can filter or render context.
  const rec = buildDisputeRecord(dispute, { isMembership, membershipId: memId, clientId, clientName });
  const dueByLabel = formatDueBy(rec.evidenceDueBy);
  if (tid) {
    await db.doc(`tenants/${tid}/disputes/${rec.disputeId}`).set(rec);
  }

  // ALWAYS email the platform owner — they're the only one who can submit
  // evidence in Stripe Dashboard. Even if tenant lookup failed (one-time
  // charge, missing metadata), platform needs to know.
  if (platformOwnerEmail) {
    const { error } = await sendEmail({
      from: 'Plume Nexus Alerts <noreply@plumenexus.com>',
      to:   platformOwnerEmail,
      subject: `⚠ Chargeback dispute opened — ${dueByLabel ? `due ${dueByLabel}` : 'action required'}`,
      html: buildPlatformDisputeAlertHtml({
        tenantName, tenantOwnerEmail, amountDollars,
        currency: rec.currency, reason: rec.reason, dueByLabel,
        disputeId: rec.disputeId, isMembership, clientName,
      }),
      tenantId: tid || undefined,
    });
    if (error) console.error(`[dispute email platform] ${platformOwnerEmail}:`, error.message);
  } else {
    console.warn('[dispute] PLATFORM_OWNER_EMAIL not configured — skipping platform alert');
  }

  // Email the tenant owner so they can provide context.
  if (tenantOwnerEmail) {
    const { error } = await sendEmail({
      from: 'Plume Nexus <noreply@plumenexus.com>',
      to:   tenantOwnerEmail,
      subject: `Action needed: chargeback dispute on your salon`,
      html: buildTenantDisputeAlertHtml({
        salonName: tenantName || 'Your salon',
        amountDollars, currency: rec.currency, reason: rec.reason, dueByLabel,
        isMembership, clientName, disputeId: rec.disputeId,
      }),
      tenantId: tid,
    });
    if (error) console.error(`[dispute email tenant] ${tenantOwnerEmail}:`, error.message);
  }

  return {
    routed: tid ? (isMembership ? 'membership' : 'saas') : 'platform_only',
    tenantId: tid,
    membershipId: memId,
    disputeId: rec.disputeId,
  };
}

// Process a charge.dispute.closed event (final outcome: won / lost /
// warning_closed). Updates the stored record and emails the outcome to
// both platform owner and tenant owner.
async function handleChargeDisputeClosed(dispute, db, stripe, sendEmail, platformOwnerEmail) {
  if (!dispute.charge) return { skipped: 'no_charge' };
  const charge = await stripe.charges.retrieve(dispute.charge);
  const outcome = dispute.status; // 'won' | 'lost' | 'warning_closed'
  const amountDollars = (dispute.amount / 100).toFixed(2);

  let tid = null;
  let memId = null;
  let isMembership = false;
  let clientId = null;
  if (charge.invoice) {
    const invoice = await stripe.invoices.retrieve(charge.invoice);
    if (invoice.subscription) {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const meta = subscription.metadata || {};
      tid          = meta.tenantId || null;
      memId        = meta.membershipId || null;
      isMembership = meta.type === 'membership';
      clientId     = meta.clientId || null;
    }
  }

  let tenantName = '';
  let tenantOwnerEmail = '';
  let clientName = '';
  if (tid) {
    const tenSnap = await db.doc(`tenants/${tid}`).get();
    const ten = tenSnap.data() || {};
    tenantName       = ten.name || '';
    tenantOwnerEmail = ten.ownerEmail || '';

    if (isMembership && memId) {
      const memSnap = await db.doc(`tenants/${tid}/memberships/${memId}`).get();
      const mem = memSnap.data() || {};
      if (mem.clientId) {
        clientId = mem.clientId;
        const clientSnap = await db.doc(`tenants/${tid}/clients/${mem.clientId}`).get();
        const client = clientSnap.data() || {};
        clientName = client.name || client.firstName || '';
      }
    }
  }

  const rec = buildDisputeRecord(dispute, { isMembership, membershipId: memId, clientId, clientName });
  if (tid) {
    await db.doc(`tenants/${tid}/disputes/${rec.disputeId}`).set(rec, { merge: true });
  }

  const subjectPrefix = outcome === 'won' ? '✓ Dispute won' : outcome === 'lost' ? '✗ Dispute lost' : 'Dispute closed';
  if (platformOwnerEmail) {
    const { error } = await sendEmail({
      from: 'Plume Nexus Alerts <noreply@plumenexus.com>',
      to:   platformOwnerEmail,
      subject: `${subjectPrefix} — ${tenantName || rec.disputeId}`,
      html: buildDisputeClosedEmailHtml({
        tenantName, outcome, amountDollars, currency: rec.currency,
        isMembership, clientName, disputeId: rec.disputeId, audience: 'platform',
      }),
      tenantId: tid || undefined,
    });
    if (error) console.error(`[dispute closed email platform] ${platformOwnerEmail}:`, error.message);
  }
  if (tenantOwnerEmail) {
    const { error } = await sendEmail({
      from: 'Plume Nexus <noreply@plumenexus.com>',
      to:   tenantOwnerEmail,
      subject: `${subjectPrefix}`,
      html: buildDisputeClosedEmailHtml({
        tenantName: tenantName || 'Your salon', outcome, amountDollars,
        currency: rec.currency, isMembership, clientName,
        disputeId: rec.disputeId, audience: 'tenant',
      }),
      tenantId: tid,
    });
    if (error) console.error(`[dispute closed email tenant] ${tenantOwnerEmail}:`, error.message);
  }

  return {
    routed: tid ? (isMembership ? 'membership' : 'saas') : 'platform_only',
    tenantId: tid,
    membershipId: memId,
    disputeId: rec.disputeId,
    outcome,
  };
}

// ── Payment-failure + cancellation emails (SaaS subscription lifecycle) ─────
//
// Closes the "silent downgrade" gap audited 2026-05-30: previously
// invoice.payment_failed for SaaS was a no-op and customer.subscription.deleted
// downgraded the tenant to starter without telling them. Now the tenant owner
// gets one email when their card declines (with a portal link to update
// billing) and one when the subscription finally cancels (acknowledging the
// downgrade with a path back).

function buildPaymentFailedEmailHtml({ salonName, amountDollars, currency, portalUrl, nextAttemptLabel }) {
  const safeSalon = String(salonName || 'your salon');
  const safePortal = String(portalUrl || 'https://plumenexus.com');
  const safeNext   = nextAttemptLabel ? `<p style="font-size:13px;color:#666;margin:0 0 16px;">Stripe will retry automatically <strong>${esc(nextAttemptLabel)}</strong>. To avoid any interruption, update your card now.</p>` : '<p style="font-size:13px;color:#666;margin:0 0 16px;">To avoid any interruption to your service, update your card on file as soon as possible.</p>';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
  <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 20px;">
    <div style="font-size:13px;font-weight:700;color:#92400e;">⚠ Payment declined</div>
  </div>
  <div style="padding:24px;">
    <p style="font-size:15px;color:#222;margin:0 0 12px;font-weight:600;">Your card was declined for ${esc(safeSalon)}.</p>
    <p style="font-size:14px;color:#555;line-height:1.65;margin:0 0 8px;">We weren't able to charge <strong>$${esc(amountDollars)} ${esc((currency || 'USD').toUpperCase())}</strong> for your Plume Nexus subscription.</p>
    ${safeNext}
    <div style="text-align:center;margin:24px 0;">
      <a href="${esc(safePortal)}" style="display:inline-block;background:#6a4fa0;color:#fff;font-size:14px;font-weight:700;padding:13px 28px;border-radius:10px;text-decoration:none;">Update billing →</a>
    </div>
    <p style="font-size:12px;color:#888;line-height:1.5;margin:8px 0 0;text-align:center;">If you have questions, just reply to this email.</p>
  </div>
  <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
    <p style="font-size:11px;color:#bbb;margin:0;">Plume Nexus — salon management for the rest of us</p>
  </div>
</div></body></html>`;
}

function buildSubscriptionCanceledEmailHtml({ salonName, portalUrl }) {
  const safeSalon = String(salonName || 'your salon');
  const safePortal = String(portalUrl || 'https://plumenexus.com');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
  <div style="background:linear-gradient(135deg,#6a4fa0,#3D95CE);padding:20px 24px;">
    <div style="color:#fff;font-size:16px;font-weight:700;">Your Plume Nexus subscription ended</div>
  </div>
  <div style="padding:24px;">
    <p style="font-size:15px;color:#222;margin:0 0 12px;">Your paid subscription for <strong>${esc(safeSalon)}</strong> has been cancelled.</p>
    <p style="font-size:14px;color:#555;line-height:1.65;margin:0 0 12px;">${esc(safeSalon)} has been moved to the Starter plan. You can continue using <strong>Schedule, Clients, Services, Employees, and Walk-in Kiosk</strong> for free.</p>
    <p style="font-size:14px;color:#555;line-height:1.65;margin:0 0 16px;">Paid features (Reports, Earnings, Marketing, HR, Memberships, etc.) are paused. Re-subscribe any time to turn them back on — your data is preserved.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${esc(safePortal)}" style="display:inline-block;background:#6a4fa0;color:#fff;font-size:14px;font-weight:700;padding:13px 28px;border-radius:10px;text-decoration:none;">Manage billing →</a>
    </div>
    <p style="font-size:12px;color:#888;line-height:1.5;margin:8px 0 0;text-align:center;">Thanks for trying Plume Nexus. If something didn't work for you, we'd love to hear why — just reply.</p>
  </div>
  <div style="padding:12px 24px 20px;text-align:center;border-top:1px solid #f0f0f0;">
    <p style="font-size:11px;color:#bbb;margin:0;">Plume Nexus — salon management for the rest of us</p>
  </div>
</div></body></html>`;
}

// Mints a Stripe Customer Portal session URL for the email CTA. Wrapped here
// so handler logic stays linear and the failure mode is just "use the fallback
// URL." If Stripe is down or the customer arg is missing, we still send the
// email with a generic billing link rather than skipping the email entirely.
async function _mintPortalUrl(stripe, customerId, returnUrl) {
  if (!stripe || !customerId) return returnUrl;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url || returnUrl;
  } catch (e) {
    console.warn('[_mintPortalUrl] failed:', e?.message);
    return returnUrl;
  }
}

// Resolves the tenant doc + ownerEmail + a portal return URL for a SaaS sub.
// Returns null if no tenant could be matched (e.g. grandfathered sub with no
// metadata.tenantId, but also no stripeSubscriptionId mirror).
async function _resolveTenantForSubscription(subscription, db) {
  let tid = subscription?.metadata?.tenantId || null;
  if (!tid && subscription?.id) {
    const snap = await db.collection('tenants')
      .where('stripeSubscriptionId', '==', subscription.id).limit(1).get();
    if (!snap.empty) tid = snap.docs[0].id;
  }
  if (!tid) return null;
  const tenSnap = await db.doc(`tenants/${tid}`).get();
  const ten = tenSnap.exists ? tenSnap.data() : {};
  return {
    tenantId:    tid,
    name:        ten.name || '',
    ownerEmail:  ten.ownerEmail || '',
    subdomain:   ten.subdomain || tid,
    customerId:  subscription?.customer || ten.stripeCustomerId || null,
  };
}

// invoice.payment_failed handler for SaaS subscriptions. Idempotent per-
// invoice: stores the invoice.id on data/settings and skips if Stripe Smart
// Retries fire the same event a second time. Membership invoices are routed
// elsewhere (the existing inline branch in stripeWebhook handles them).
async function handleInvoicePaymentFailedSaas(invoice, db, stripe, sendEmail) {
  if (!invoice?.subscription) return { skipped: 'no_subscription' };
  // Pull the subscription so we can read its metadata to distinguish SaaS
  // from membership. Memberships have metadata.type === 'membership'.
  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  if (subscription?.metadata?.type === 'membership') return { skipped: 'membership_branch' };
  const tenant = await _resolveTenantForSubscription(subscription, db);
  if (!tenant) return { skipped: 'no_tenant' };
  // Idempotency: skip if we already emailed for this exact invoice.
  const settingsRef = db.doc(`tenants/${tenant.tenantId}/data/settings`);
  const settingsSnap = await settingsRef.get();
  const lastEmailed = settingsSnap.exists ? settingsSnap.data().lastFailedInvoiceId : null;
  if (lastEmailed && lastEmailed === invoice.id) return { skipped: 'duplicate_retry' };
  if (!tenant.ownerEmail) return { skipped: 'no_owner_email' };
  const returnUrl = `https://${tenant.subdomain}.plumenexus.com/manage`;
  const portalUrl = await _mintPortalUrl(stripe, tenant.customerId, returnUrl);
  const amountDollars = ((invoice.amount_due || 0) / 100).toFixed(2);
  // Stripe sends `next_payment_attempt` as a unix seconds value when Smart
  // Retries are enabled. Render in a human form if present. Pinned to UTC so the
  // calendar day is deterministic regardless of the server's timezone (a local
  // render could land on the wrong day for attempts near midnight UTC).
  let nextAttemptLabel = '';
  if (invoice.next_payment_attempt) {
    const d = new Date(invoice.next_payment_attempt * 1000);
    nextAttemptLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  const html = buildPaymentFailedEmailHtml({
    salonName:        tenant.name,
    amountDollars,
    currency:         invoice.currency,
    portalUrl,
    nextAttemptLabel,
  });
  await sendEmail({
    from:     'Plume Nexus <noreply@send.plumenexus.com>',
    to:       tenant.ownerEmail,
    subject:  `Action required: payment failed for ${tenant.name || 'your salon'}`,
    html,
    tenantId: tenant.tenantId,
  });
  await settingsRef.set({ lastFailedInvoiceId: invoice.id, lastFailedInvoiceAt: new Date().toISOString() }, { merge: true });
  return { emailed: tenant.ownerEmail };
}

// customer.subscription.deleted handler for SaaS subscriptions. Combines the
// downgrade-to-solo (free tier) Firestore write and the email so the webhook block
// becomes a one-liner. Idempotent: subscription.deleted only fires once per
// subscription lifecycle, but the email itself is unsigned and could be
// re-delivered — the downgrade write is also idempotent (set merge).
async function handleSubscriptionDeletedSaas(subscription, db, stripe, sendEmail) {
  const tenant = await _resolveTenantForSubscription(subscription, db);
  if (!tenant) return { skipped: 'no_tenant' };
  const { FieldValue } = require('firebase-admin/firestore');
  const clear = {
    plan:                 'solo',
    stripeSubscriptionId: FieldValue.delete(),
    subscriptionStatus:   FieldValue.delete(),
    cancelAtPeriodEnd:    FieldValue.delete(),
    currentPeriodEnd:     FieldValue.delete(),
    updatedAt:            new Date().toISOString(),
  };
  await db.doc(`tenants/${tenant.tenantId}/data/settings`).set(clear, { merge: true });
  await db.doc(`tenants/${tenant.tenantId}`).set(clear, { merge: true });
  if (!tenant.ownerEmail) return { downgraded: true, skipped: 'no_owner_email' };
  const returnUrl = `https://${tenant.subdomain}.plumenexus.com/manage`;
  const portalUrl = await _mintPortalUrl(stripe, tenant.customerId, returnUrl);
  const html = buildSubscriptionCanceledEmailHtml({ salonName: tenant.name, portalUrl });
  await sendEmail({
    from:     'Plume Nexus <noreply@send.plumenexus.com>',
    to:       tenant.ownerEmail,
    subject:  `Your Plume Nexus subscription ended`,
    html,
    tenantId: tenant.tenantId,
  });
  return { downgraded: true, emailed: tenant.ownerEmail };
}

// ── Card-on-file helpers ──────────────────────────────────────────────────
// PCI compliance note: we never see/store raw card numbers. Stripe.js
// tokenizes them in the browser; we get back a PaymentMethod ID (pm_xxx)
// and *display-only* metadata (brand, last4, exp). Those are NOT
// PCI-restricted under SAQ A — they're explicitly allowed for receipt /
// wallet UX. The actual PAN lives in Stripe's PCI Level 1 vault.
//
// What we DO store on tenants/{tid}/clients/{cid}.paymentMethods:
//   id        — pm_xxx, the opaque token used to charge later
//   brand     — 'visa' | 'mastercard' | 'amex' | etc.
//   last4     — last 4 digits (display only; not a card number)
//   expMonth  — 1-12
//   expYear   — 4-digit
//   funding   — 'credit' | 'debit' | 'prepaid' | 'unknown'
//   country   — ISO 2-letter (used to detect international cards
//               so the salon can be warned about Stripe's +1.5% surcharge)
//   addedAt   — ISO timestamp
//
// What we do NOT store anywhere:
//   - The PAN (full card number)
//   - The CVC
//   - The cardholder name (separate field; not regulated but minimised)
//   - Any field Stripe returns under `card.networks` or `card.three_d_secure`

// Extract the safe-to-store metadata from a Stripe PaymentMethod object.
// Pure (no I/O), so unit-testable. Returns null if `pm.card` is missing —
// indicates the PaymentMethod isn't a card (could be us_bank_account, etc.)
// which we don't handle yet.
function extractCardMetadata(pm) {
  if (!pm || !pm.card) return null;
  const c = pm.card;
  return {
    id:       pm.id,
    brand:    c.brand || 'unknown',
    last4:    c.last4 || '',
    expMonth: c.exp_month || null,
    expYear:  c.exp_year  || null,
    funding:  c.funding   || 'unknown',
    country:  c.country   || null,
    addedAt:  new Date().toISOString(),
  };
}

// Build the args object for stripe.paymentIntents.create() to charge a
// previously-saved card off-session. Centralised so every off-session
// charge in the codebase uses the same destination-charge + on_behalf_of
// + metadata shape — and so when a developer adds a new charge path, they
// can't forget the `on_behalf_of` flag (which is what makes the salon's
// name appear on the cardholder's statement).
//
// Required:
//   amount             — in smallest currency unit (cents for USD)
//   currency           — 'usd', 'eur', etc.
//   customerId         — cus_xxx the PaymentMethod is attached to
//   paymentMethodId    — pm_xxx to charge
//   connectAccountId   — acct_xxx of the salon's Stripe Connect account.
//                        REQUIRED — never charge without routing to a
//                        connected account, or funds land on the platform
//                        and we trip money-transmitter rules.
//   tenantId, clientId — metadata for audit + webhook routing
//
// Optional:
//   description           — appears on Stripe Dashboard charge view
//   applicationFeeAmount  — Plume's cut in cents (default 0; tunable per
//                           tenant when the platform-fee field exists)
//   statementDescriptorSuffix — optional dynamic suffix appended to the
//                           salon's base descriptor (e.g. 'NOSHOW' for
//                           no-show fees)
function buildOffSessionChargeRequest({
  amount, currency, customerId, paymentMethodId, connectAccountId,
  tenantId, clientId,
  description, applicationFeeAmount, statementDescriptorSuffix,
}) {
  if (!amount || amount <= 0)        throw new Error('amount must be a positive integer');
  if (!currency)                      throw new Error('currency required');
  if (!customerId)                    throw new Error('customerId required');
  if (!paymentMethodId)               throw new Error('paymentMethodId required');
  if (!connectAccountId)              throw new Error('connectAccountId required — refusing to charge to platform account (money-transmitter risk)');
  if (!tenantId)                      throw new Error('tenantId required for audit');

  const req = {
    amount,
    currency,
    customer:         customerId,
    payment_method:   paymentMethodId,
    confirm:          true,
    off_session:      true,                            // cardholder not present; SCA handled if required
    on_behalf_of:     connectAccountId,                // → salon's name on statement
    transfer_data:    { destination: connectAccountId }, // → funds route to salon
    application_fee_amount: Math.max(0, applicationFeeAmount || 0),
    metadata: {
      tenantId,
      clientId: clientId || '',
      source:   'off_session_card',
    },
  };
  if (description)              req.description = description;
  if (statementDescriptorSuffix) req.statement_descriptor_suffix = String(statementDescriptorSuffix).slice(0, 22);
  return req;
}

// PaymentIntent params for the INTERACTIVE (Stripe Elements) POS checkout —
// cardholder present, confirmed client-side. Same Connect routing as the
// off-session path: funds settle to the salon's connected account and the
// salon is the merchant of record, so the platform never holds salon money
// (money-transmitter risk). application_fee_amount is the platform's cut
// (0 by default — Plume takes no processing markup; revenue is the SaaS sub).
function buildPosChargeRequest({
  amount, currency, connectAccountId, tenantId, description, applicationFeeAmount,
}) {
  if (!amount || amount <= 0)   throw new Error('amount must be a positive integer');
  if (!currency)                throw new Error('currency required');
  if (!connectAccountId)        throw new Error('connectAccountId required — refusing to charge to platform account (money-transmitter risk)');
  if (!tenantId)                throw new Error('tenantId required for audit');

  const req = {
    amount,
    currency,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    on_behalf_of:  connectAccountId,
    transfer_data: { destination: connectAccountId },
    application_fee_amount: Math.max(0, Math.round(Number(applicationFeeAmount) || 0)),
    metadata: { tenantId, source: 'pos_interactive' },
  };
  if (description) req.description = String(description);
  return req;
}

module.exports = {
  buildPosChargeRequest,
  buildRefundRecord,
  buildTenantRefundEmailHtml,
  buildMemberRefundEmailHtml,
  handleChargeRefunded,
  buildDisputeRecord,
  buildPlatformDisputeAlertHtml,
  buildTenantDisputeAlertHtml,
  buildDisputeClosedEmailHtml,
  handleChargeDisputeCreated,
  handleChargeDisputeClosed,
  formatDueBy,
  buildPaymentFailedEmailHtml,
  buildSubscriptionCanceledEmailHtml,
  handleInvoicePaymentFailedSaas,
  handleSubscriptionDeletedSaas,
  extractCardMetadata,
  buildOffSessionChargeRequest,
};
