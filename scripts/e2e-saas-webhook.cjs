#!/usr/bin/env node
// Integration test for the SaaS billing webhook path: properly-signed Stripe
// events → the DEPLOYED stripeWebhook → data/settings.plan flips in Firestore.
// Uses a throwaway tenant (TENANT below) so Meraki / real tenants are untouched.
//
// Run:
//   WEBHOOK_SECRET="$(firebase functions:secrets:access STRIPE_WEBHOOK_SECRET)" \
//   GTOKEN="$(gcloud auth print-access-token)" \
//   node scripts/e2e-saas-webhook.cjs
const fs = require('fs');
const path = require('path');

const PROJECT = 'plumenexus-prod';
const TENANT  = 'e2e-billing-webhook';
const WEBHOOK_URL = 'https://stripewebhook-valbwuybdq-uc.a.run.app';
const SUB_ID = 'sub_e2e_webhook';

const SECRET = process.env.WEBHOOK_SECRET;
const GTOKEN = process.env.GTOKEN;
if (!SECRET || !GTOKEN) { console.error('Set WEBHOOK_SECRET and GTOKEN env vars'); process.exit(1); }

// Pull the live (sandbox) price IDs from functions/.env so plan reverse-lookup matches.
const env = fs.readFileSync(path.join(__dirname, '..', 'functions', '.env'), 'utf8');
const PRICE = {
  pro:     /STRIPE_PRO_PRICE_ID=(\S+)/.exec(env)[1],
  studio:  /STRIPE_STUDIO_PRICE_ID=(\S+)/.exec(env)[1],
  starter: /STRIPE_STARTER_PRICE_ID=(\S+)/.exec(env)[1],
};

const stripe = require(path.join(__dirname, '..', 'functions', 'node_modules', 'stripe'))('sk_test_dummy');

const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const fsHeaders = { Authorization: `Bearer ${GTOKEN}`, 'X-Goog-User-Project': PROJECT, 'Content-Type': 'application/json' };

async function fsSet(doc, fields) {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: String(v) }])) };
  const r = await fetch(`${FS}/${doc}`, { method: 'PATCH', headers: fsHeaders, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`fsSet ${doc} -> ${r.status} ${await r.text()}`);
}
async function fsGetPlan(doc) {
  const r = await fetch(`${FS}/${doc}`, { headers: fsHeaders });
  if (!r.ok) return null;
  const d = await r.json();
  return d.fields?.plan?.stringValue ?? null;
}
async function fsDelete(doc) { await fetch(`${FS}/${doc}`, { method: 'DELETE', headers: fsHeaders }); }

async function fire(type, object) {
  const event = { id: 'evt_e2e_' + Math.floor(Date.now() / 1000), object: 'event', type, data: { object } };
  const payload = JSON.stringify(event);
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const r = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig }, body: payload });
  return { status: r.status, body: await r.text() };
}

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); }

(async () => {
  const settings = `tenants/${TENANT}/data/settings`;
  const root     = `tenants/${TENANT}`;
  try {
    // Seed: a starter tenant with a sub. No ownerEmail → skip the downgrade email.
    await fsSet(root, { plan: 'starter', name: 'E2E Billing Test', active: 'true' });
    await fsSet(settings, { plan: 'starter', stripeCustomerId: 'cus_e2e', stripeSubscriptionId: SUB_ID, subscriptionStatus: 'active' });

    // A) checkout.session.completed (SaaS) → plan becomes studio
    let res = await fire('checkout.session.completed', { id: 'cs_e2e', object: 'checkout.session', subscription: SUB_ID, metadata: { tenantId: TENANT, plan: 'studio' } });
    check('checkout.session.completed accepted (200)', res.status === 200, `HTTP ${res.status}`);
    check('plan flipped to studio', (await fsGetPlan(settings)) === 'studio');

    // B) customer.subscription.updated (Pro price) → plan becomes pro
    res = await fire('customer.subscription.updated', { id: SUB_ID, object: 'subscription', status: 'active', cancel_at_period_end: false, current_period_end: Math.floor(Date.now() / 1000) + 2592000, metadata: { tenantId: TENANT }, items: { data: [{ price: { id: PRICE.pro } }] } });
    check('subscription.updated accepted (200)', res.status === 200, `HTTP ${res.status}`);
    check('plan switched to pro (price reverse-lookup)', (await fsGetPlan(settings)) === 'pro');

    // C) customer.subscription.deleted → downgrade to starter
    res = await fire('customer.subscription.deleted', { id: SUB_ID, object: 'subscription', status: 'canceled', metadata: { tenantId: TENANT } });
    check('subscription.deleted accepted (200)', res.status === 200, `HTTP ${res.status}`);
    check('plan downgraded to starter', (await fsGetPlan(settings)) === 'starter');
  } finally {
    await fsDelete(settings); await fsDelete(root);
    console.log('— cleaned up test tenant —');
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
