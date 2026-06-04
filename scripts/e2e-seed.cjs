#!/usr/bin/env node
// Seeds the Firebase emulators for the downgrade-gate e2e:
//   - an admin auth user (email/password) the spec signs in as
//   - tenant 'merakinailstudio' on the Pro plan with a (fake) active sub
//   - data/users granting that email the 'admin' role (so checkUserAccess
//     hydrates isAdmin without the bootstrap allowlist)
//   - one active client membership with NO stripeSubscriptionId, so
//     cancelMembership in the e2e never calls real Stripe
//
// Run with the emulator host envs set (the npm script / runner does this):
//   FIRESTORE_EMULATOR_HOST=localhost:8080 \
//   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
//   node scripts/e2e-seed.cjs
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const TENANT = 'merakinailstudio';
const EMAIL = 'e2e-admin@plumenexus.test';
const PASSWORD = 'e2e-password-123';

if (!process.env.FIRESTORE_EMULATOR_HOST)     process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

admin.initializeApp({ projectId: 'plumenexus-prod' });
const db = admin.firestore();
const auth = admin.auth();
const now = new Date().toISOString();

async function main() {
  // Admin auth user (idempotent)
  try { await auth.getUserByEmail(EMAIL); }
  catch { await auth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true, displayName: 'E2E Admin' }); }

  await db.doc(`tenants/${TENANT}`).set({
    name: 'E2E Salon', ownerEmail: EMAIL, plan: 'pro',
    stripeCustomerId: 'cus_e2e', stripeSubscriptionId: 'sub_e2e', active: true, createdAt: now,
  }, { merge: true });

  await db.doc(`tenants/${TENANT}/data/settings`).set({
    plan: 'pro', stripeCustomerId: 'cus_e2e', stripeSubscriptionId: 'sub_e2e',
    subscriptionStatus: 'active', timeoutMin: 120, disabledModules: [], updatedAt: now,
  }, { merge: true });

  await db.doc(`tenants/${TENANT}/data/users`).set({
    users: [{ email: EMAIL, name: 'E2E Admin', role: 'admin', grantedAt: now }],
    adminEmails: [EMAIL], staffEmails: [EMAIL],
  }, { merge: true });

  // Active membership, no Stripe sub → cancelMembership stays Stripe-free.
  await db.doc(`tenants/${TENANT}/memberships/e2e-mem-1`).set({
    clientName: 'E2E Member', planName: 'Gold', price: 80, billingPeriod: 'monthly',
    status: 'active', startedAt: now, createdAt: now, updatedAt: now,
  }, { merge: true });

  console.log(`[e2e-seed] seeded tenant '${TENANT}' (Pro), admin ${EMAIL}, 1 active membership`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[e2e-seed] failed:', e); process.exit(1); });
