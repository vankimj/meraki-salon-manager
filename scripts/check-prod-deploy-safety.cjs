#!/usr/bin/env node
// Guard against accidental PRODUCTION deploys. Wired into firebase.json
// `hosting:app.predeploy`, so it runs for ANY deploy of the app site.
//
// Policy (per "non-prod deploys proceed, only prod is gated"):
//   • SKIP_PROD_DEPLOY_GUARD=1  → bypass (emergencies).
//   • PREVIEW_DEPLOY=1          → a preview/staging CHANNEL deploy (set by
//       preview:branch / deploy:staging). Never touches a live tenant, so it's
//       always allowed — deploy from any branch, dirty or not.
//   • No tenant flagged live    → even the LIVE deploy is allowed (every
//       slugs/*.isProduction is false → nothing real is being served).
//   • A tenant IS flagged live  → LIVE deploys re-gate to a clean `main`
//       (Admin → Settings → "This salon is LIVE" sets the flag).
//
// "Production" is data-driven: a tenant is live when its public slug doc has
// isProduction === true (set via the setTenantProduction callable). The check
// FAILS CLOSED — if it can't be determined (no ADC, query error), the strict
// clean-main gate is applied.
//
// Emergency bypass: SKIP_PROD_DEPLOY_GUARD=1 firebase deploy ...
const path = require('node:path');
const { execSync } = require('node:child_process');

function run(cmd) { return execSync(cmd, { encoding: 'utf8' }).trim(); }
function block(lines) {
  console.error('\n✗ Production hosting deploy blocked.');
  lines.forEach(l => console.error('  ' + l));
  console.error('\n  Emergency bypass: SKIP_PROD_DEPLOY_GUARD=1 firebase deploy ...\n');
  process.exit(1);
}

if (process.env.SKIP_PROD_DEPLOY_GUARD === '1') {
  // stderr, not stdout — predeploy output is otherwise prepended to the
  // `firebase ... --json` payload that deploy-safe.cjs parses.
  console.error('⚠  Prod deploy guard skipped via SKIP_PROD_DEPLOY_GUARD=1');
  process.exit(0);
}
if (process.env.PREVIEW_DEPLOY === '1') {
  console.error('✓ Preview / non-prod channel deploy — guard not applied.');
  process.exit(0);
}

// Does any tenant currently flag itself live/production? Fail CLOSED.
async function anyProductionTenant() {
  try {
    const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
    if (!admin.apps.length) admin.initializeApp({ projectId: 'plumenexus-prod' });
    const snap = await admin.firestore().collection('slugs').where('isProduction', '==', true).limit(1).get();
    return { known: true, exists: !snap.empty };
  } catch (e) {
    return { known: false, exists: true, err: e.message };
  }
}

(async () => {
  const prod = await anyProductionTenant();
  if (prod.known && !prod.exists) {
    console.log('✓ Prod deploy guard: no tenant is flagged live (production) yet — deploys are open.');
    process.exit(0);
  }
  if (!prod.known) console.error(`⚠  Could not check production tenants (${prod.err}) — applying the strict gate (fail-closed).`);

  let branch;
  try { branch = run('git rev-parse --abbrev-ref HEAD'); }
  catch { block(['Not in a git repo. Aborting.']); }
  if (branch !== 'main') {
    block([
      `Current branch: ${branch}`,
      'A live tenant exists, so production deploys must come from "main".',
      '',
      'To preview this branch instead: npm run preview:branch',
      `To merge: git checkout main && git merge ${branch}`,
    ]);
  }
  const dirty = run('git status --porcelain');
  if (dirty) {
    block(['Working tree has uncommitted changes:', ...dirty.split('\n').map(l => '  ' + l), '', 'Commit or stash before deploying to production.']);
  }
  console.log('✓ Prod deploy guard: a live tenant exists; on main, clean tree.');
  process.exit(0);
})();
