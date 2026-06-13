// Per-tenant cost & usage logging.
//
// Every paid outbound call (Twilio SMS, AWS SES email, Anthropic AI) writes
// a small record under `tenants/{tenantId}/usage{Sms|Email|Ai}` so the
// nightly aggregator can roll them into `usageDaily` / `usageMonthly` docs
// that power the platform-admin cost dashboard.
//
// Three rules every helper here follows:
//   1. Never throw — a logging failure must NEVER break a real customer send.
//      Each fn is wrapped in try/catch and console.warns on failure.
//   2. PII is masked at the source (phone → last 4, email → local prefix +
//      domain). Body text is NEVER stored — only metadata.
//   3. Each doc carries `dayKey` (UTC YYYY-MM-DD) + `monthKey` (UTC YYYY-MM)
//      so the aggregator can bucket without composite indexes — single-
//      field equality only.
//
// Pricing constants are baseline US rates as of 2026-05-31. Update here
// when contracts change; the aggregator + UI both read from PRICING so a
// single edit propagates.

const { FieldValue } = require('firebase-admin/firestore');

const PRICING = Object.freeze({
  // Twilio toll-free US outbound; varies by country. v1 = US-only assumption.
  smsPerSegment:        0.0083,
  // AWS End User Messaging US outbound (per message part). Cheaper than
  // Twilio; selected when a send goes through the AWS provider path.
  awsSmsPerSegment:     0.00581,
  // Twilio TFN rental, billed per number per month. Added as a fixed
  // line item by the monthly rollup, not per-send.
  tfnMonthlyRental:     2.00,
  // SES outbound. Production tier ($0.10 / 1000). First 62k/mo free in
  // the AWS free tier — ignored here (free tier benefits the platform
  // bill, not the per-tenant attribution).
  emailPerSend:         0.0001,
  // Anthropic Haiku 4.5 token pricing. Update when model changes.
  aiInputPerToken:      0.000001,
  aiOutputPerToken:     0.000005,
});

function dayKeyUTC(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function monthKeyUTC(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

// GSM-7 = 160/153 chars per segment; UCS-2 (any non-GSM char like emoji) =
// 70/67. Twilio's API returns numSegments on the create() response, so
// prefer that. This is only a fallback estimator.
function estimateSmsSegments(body) {
  const s = String(body || '');
  if (!s) return 0;
  const isUcs2 = /[^\x00-\x7F]/.test(s);
  if (isUcs2) return s.length <= 70 ? 1 : Math.ceil(s.length / 67);
  return s.length <= 160 ? 1 : Math.ceil(s.length / 153);
}

function maskPhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `****${digits.slice(-4)}`;
}

function maskEmail(e) {
  const s = String(e || '').trim().toLowerCase();
  const at = s.indexOf('@');
  if (at <= 0) return '****';
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const visible = local.length <= 2 ? local[0] || '' : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

async function logSmsUsage(db, tenantId, opts = {}) {
  if (!db || !tenantId) return;
  const { kind, to, body, sid, segments, provider } = opts;
  try {
    const segs = Number.isFinite(Number(segments)) && Number(segments) > 0
      ? Number(segments)
      : estimateSmsSegments(body);
    const perSeg = provider === 'aws' ? PRICING.awsSmsPerSegment : PRICING.smsPerSegment;
    const costUsd = +(segs * perSeg).toFixed(6);
    const now = new Date();
    await db.collection(`tenants/${tenantId}/usageSms`).add({
      at:       FieldValue.serverTimestamp(),
      dayKey:   dayKeyUTC(now),
      monthKey: monthKeyUTC(now),
      kind:     String(kind || 'transactional'),
      to:       maskPhone(to),
      segments: segs,
      costUsd,
      provider: provider || 'twilio',
      sid:      sid || null,
    });
  } catch (e) {
    console.warn(`[logSmsUsage] tenant=${tenantId} failed:`, e?.message);
  }
}

async function logEmailUsage(db, tenantId, opts = {}) {
  if (!db || !tenantId) return;
  const { kind, to, messageId } = opts;
  try {
    const costUsd = +PRICING.emailPerSend.toFixed(6);
    const now = new Date();
    await db.collection(`tenants/${tenantId}/usageEmail`).add({
      at:        FieldValue.serverTimestamp(),
      dayKey:    dayKeyUTC(now),
      monthKey:  monthKeyUTC(now),
      kind:      String(kind || 'transactional'),
      to:        maskEmail(to),
      costUsd,
      messageId: messageId || null,
    });
  } catch (e) {
    console.warn(`[logEmailUsage] tenant=${tenantId} failed:`, e?.message);
  }
}

// Anthropic SDK response.usage = { input_tokens, output_tokens,
// cache_creation_input_tokens?, cache_read_input_tokens? }. We bill input
// at the same rate regardless of cache hit (cache discount is a platform
// win, not a per-tenant attribution change). Cached input tokens are still
// counted as input for the per-tenant figure.
async function logAiUsage(db, tenantId, opts = {}) {
  if (!db || !tenantId) return;
  const { endpoint, model, usage } = opts;
  try {
    const input  = Number(usage?.input_tokens || 0) +
                   Number(usage?.cache_creation_input_tokens || 0) +
                   Number(usage?.cache_read_input_tokens || 0);
    const output = Number(usage?.output_tokens || 0);
    const costUsd = +(input * PRICING.aiInputPerToken +
                      output * PRICING.aiOutputPerToken).toFixed(6);
    const now = new Date();
    await db.collection(`tenants/${tenantId}/usageAi`).add({
      at:           FieldValue.serverTimestamp(),
      dayKey:       dayKeyUTC(now),
      monthKey:     monthKeyUTC(now),
      endpoint:     String(endpoint || 'unknown'),
      model:        String(model || 'unknown'),
      inputTokens:  input,
      outputTokens: output,
      costUsd,
    });
  } catch (e) {
    console.warn(`[logAiUsage] tenant=${tenantId} failed:`, e?.message);
  }
}

module.exports = {
  PRICING,
  dayKeyUTC,
  monthKeyUTC,
  estimateSmsSegments,
  maskPhone,
  maskEmail,
  logSmsUsage,
  logEmailUsage,
  logAiUsage,
};
