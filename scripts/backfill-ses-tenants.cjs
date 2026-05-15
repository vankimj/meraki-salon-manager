#!/usr/bin/env node
/**
 * Phase 4 backfill: create an AWS SES Tenant resource for every existing
 * Plume Nexus tenant + associate the shared sending identity.
 *
 * Before the SES Tenants feature shipped (this commit's `ensureSesTenant`
 * hook in provisionTenant), tenants were provisioned without a
 * corresponding SES Tenant resource on the AWS side. This script
 * backfills them so EMAIL_PROVIDER=ses cutover works for every tenant.
 *
 * Idempotent: ensureSesTenant + associateSesIdentityToTenant both
 * treat AlreadyExistsException as success, so re-running is safe.
 *
 * Auth: uses Application Default Credentials for Firestore (gcloud
 * auth application-default login) + AWS_ACCESS_KEY_ID +
 * AWS_SECRET_ACCESS_KEY env vars for SES API.
 *
 * Required env (export before running):
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY      — IAM user creds
 *   AWS_SES_REGION                                — typically us-east-1
 *   AWS_SES_SHARED_IDENTITY_ARN                   — arn:aws:ses:us-east-1:<acct>:identity/send.plumenexus.com
 *
 * Run:
 *   node scripts/backfill-ses-tenants.cjs --dry-run    (preview only)
 *   node scripts/backfill-ses-tenants.cjs              (do it)
 */
const admin = require('../functions/node_modules/firebase-admin');
const {
  SESv2Client,
  CreateTenantCommand,
  CreateTenantResourceAssociationCommand,
} = require('../functions/node_modules/@aws-sdk/client-sesv2');

const DRY_RUN = process.argv.includes('--dry-run');

const REGION       = process.env.AWS_SES_REGION || 'us-east-1';
const ACCESS_KEY   = process.env.AWS_ACCESS_KEY_ID;
const SECRET_KEY   = process.env.AWS_SECRET_ACCESS_KEY;
const IDENTITY_ARN = process.env.AWS_SES_SHARED_IDENTITY_ARN;

if (!ACCESS_KEY || !SECRET_KEY) {
  console.error('Missing AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars.');
  process.exit(1);
}
if (!IDENTITY_ARN) {
  console.error('Missing AWS_SES_SHARED_IDENTITY_ARN env var.');
  console.error('Copy from SES Console → Identities → send.plumenexus.com → ARN.');
  process.exit(1);
}

admin.initializeApp({ projectId: 'meraki-salon-manager' });
const db = admin.firestore();
const ses = new SESv2Client({
  region: REGION,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

async function ensureTenant(tid) {
  if (DRY_RUN) return { created: 'dry-run' };
  try {
    await ses.send(new CreateTenantCommand({ TenantName: tid }));
    return { created: true };
  } catch (e) {
    if (e?.name === 'AlreadyExistsException' || /already exists/i.test(e?.message || '')) {
      return { created: false, existed: true };
    }
    throw e;
  }
}

async function associateIdentity(tid) {
  if (DRY_RUN) return { associated: 'dry-run' };
  try {
    await ses.send(new CreateTenantResourceAssociationCommand({
      TenantName:  tid,
      ResourceArn: IDENTITY_ARN,
    }));
    return { associated: true };
  } catch (e) {
    if (e?.name === 'AlreadyExistsException' || /already exists|associated/i.test(e?.message || '')) {
      return { associated: false, existed: true };
    }
    throw e;
  }
}

(async () => {
  console.log(`Backfilling SES Tenants — region=${REGION} identity=${IDENTITY_ARN}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no AWS writes)' : 'LIVE'}`);

  const snap = await db.collection('tenants').get();
  console.log(`Found ${snap.size} tenants in Firestore.`);

  let ok = 0, skipped = 0, failed = 0;
  for (const doc of snap.docs) {
    const tid = doc.id;
    const t = doc.data();
    // Skip inactive / soft-deleted tenants — they're not sending email.
    if (t.active === false) {
      console.log(`  ${tid}: SKIP (active=false)`);
      skipped++;
      continue;
    }
    try {
      const tr = await ensureTenant(tid);
      const ar = await associateIdentity(tid);
      const tag = tr.existed && ar.existed ? 'noop' : tr.existed ? 'assoc-only' : 'created+assoc';
      console.log(`  ${tid}: ${tag}`);
      ok++;
    } catch (e) {
      console.error(`  ${tid}: FAILED — ${e?.name || 'Unknown'}: ${e?.message || e}`);
      failed++;
    }
  }

  console.log();
  console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
