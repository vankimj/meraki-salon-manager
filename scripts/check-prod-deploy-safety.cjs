#!/usr/bin/env node
// Guard against accidental prod deploys from feature branches or dirty
// working trees. Wired into firebase.json `hosting:meraki.predeploy` so
// it runs for ANY prod hosting deploy (npm run deploy:prod, raw
// `firebase deploy --only hosting:meraki`, etc). To deploy a preview
// instead, use `npm run preview:branch`.
//
// Bypass for emergencies: SKIP_PROD_DEPLOY_GUARD=1 firebase deploy ...
const { execSync } = require('node:child_process');

if (process.env.SKIP_PROD_DEPLOY_GUARD === '1') {
  console.log('⚠  Prod deploy guard skipped via SKIP_PROD_DEPLOY_GUARD=1');
  process.exit(0);
}

const ALLOWED_BRANCH = 'main';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

let branch;
try {
  branch = run('git rev-parse --abbrev-ref HEAD');
} catch (e) {
  // Not in a git checkout — bail loudly rather than silently deploy.
  console.error('✗ Prod deploy guard: not in a git repo. Aborting.');
  process.exit(1);
}

if (branch !== ALLOWED_BRANCH) {
  console.error(`\n✗ Prod hosting deploy blocked.`);
  console.error(`  Current branch: ${branch}`);
  console.error(`  Prod deploys must come from "${ALLOWED_BRANCH}".`);
  console.error(`\n  To preview from this branch instead, run:`);
  console.error(`    npm run preview:branch`);
  console.error(`\n  To merge to main, run:`);
  console.error(`    git checkout main && git merge ${branch}`);
  console.error(`\n  Emergency bypass: SKIP_PROD_DEPLOY_GUARD=1 firebase deploy ...\n`);
  process.exit(1);
}

const dirty = run('git status --porcelain');
if (dirty) {
  console.error(`\n✗ Prod hosting deploy blocked.`);
  console.error(`  Working tree has uncommitted changes:`);
  console.error(dirty.split('\n').map(l => `    ${l}`).join('\n'));
  console.error(`\n  Commit or stash before deploying to prod.`);
  console.error(`  Emergency bypass: SKIP_PROD_DEPLOY_GUARD=1 firebase deploy ...\n`);
  process.exit(1);
}

console.log('✓ Prod deploy guard: on main, clean tree.');
