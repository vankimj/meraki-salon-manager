# Migration Plan — `meraki-salon-manager` → `plumenexus-prod`

**Goal:** rename the Firebase project from `meraki-salon-manager` to `plumenexus-prod` before onboarding real (non-Jonathan) tenants. Single user (Jonathan, jvankim@gmail.com); Meraki Nail Studio is the only real data; everything else is demo or pre-prod.

**Budget:** ~$5 total (one-time GCS storage for export bundles; no parallel-run).

**Cutover strategy:** export-and-archive instead of 30-day parallel-run. Decommission old project on day 7 after green-light, retain export bundles in GCS for 90 days.

**Time estimate:** 3 working days + Google OAuth verification clock (3–5 business days, kicked off day 1).

**Rollback path:** Firestore export bundles re-importable into a scratch project; Stripe webhook history queryable in Stripe Dashboard forever; git tag pre-migration commit.

---

## Naming decisions

| Thing | Old | New |
|---|---|---|
| Firebase project ID | `meraki-salon-manager` | `plumenexus-prod` |
| Default Hosting site | `meraki-salon-manager.web.app` | `plumenexus-prod.web.app` |
| Cloud Functions base URL | `us-central1-meraki-salon-manager.cloudfunctions.net` | `us-central1-plumenexus-prod.cloudfunctions.net` |
| Storage bucket | `meraki-salon-manager.firebasestorage.app` | `plumenexus-prod.firebasestorage.app` |
| BQ project (`firestore_export.*`) | `meraki-salon-manager` | `plumenexus-prod` |
| Hosting target (already renamed) | `meraki` | `app` |
| GCS export staging bucket | `gs://meraki-restore-staging` | `gs://plumenexus-restore-staging` |
| **Meraki tenant doc ID** | `tf46226a93a1b546b` | `merakinailstudio` |
| **Meraki tenant slug (legacy fallback)** | `meraki` | (removed — no legacy fallback) |
| **Hardcoded `TENANT_ID` fallback in code** | `'meraki'` | (removed; tenant ID must come from slug lookup) |
| Local working dir | `/Users/jonathanvankim/Downloads/Meraki-Salon-Manager` | `…/Plumenexus-Salon-Manager` |
| GitHub repo | `vankimj/Meraki-Salon-Manager` | `vankimj/Plumenexus-Salon-Manager` |
| Auto-memory dir | `~/.claude/projects/-Users-jonathanvankim-Downloads-Meraki-Salon-Manager/` | `…-Plumenexus-Salon-Manager/` |

**What stays "meraki" (tenant-specific brand/content, NOT renamed):**
- Brand assets `public/brand/meraki/` (Meraki Nail Studio's photos + SVGs — they belong to that tenant)
- Salon name strings "Meraki Nail Studio"
- Component `HeroMerakiSite` + layout mode `merakiSite` (Meraki's editorial homepage)
- Contact data: `hello@merakinailstudio.com`, `@meraki_cbus`, etc.
- Loose data files in `~/Downloads/`: `meraki-backup-*.json`, `meraki-tax-report-*.csv`, etc. — these are Meraki tenant data exports

**Clean break (since pre-prod, single user):**
- The Meraki tenant becomes a "normal" tenant with doc ID `merakinailstudio` (matches its slug).
- No more legacy `tenants/meraki` Firestore path, no more `TENANT_ID = 'meraki'` hardcoded fallback, no more "is this the special bootstrap tenant?" branching in code.
- After migration, the ONLY way to get Meraki's tenant context is the slug-lookup path used for all tenants.

---

## Phase 0 — Pre-flight (Day -1, 60 min)

### 0.A — Parallel-session freeze (CRITICAL — prevents wedged state)

You run 3+ concurrent Claude Code sessions on this repo via 4 worktrees. The migration touches global config (firebase.js × 4, .firebaserc, hosting targets, function URLs). If any parallel session deploys or pushes mid-migration, the result is wedged: stale code on the wrong project, or merge conflicts on rename commits.

- [ ] **Stop all other sessions.** Don't open new Claude Code chats on this repo for the migration window (~3 days).
- [ ] **For each active worktree, commit-and-push current work to its branch and pause:**
  - [ ] `Meraki-editorial-site` (feature/editorial-site) — commit, push, pause
  - [ ] `Meraki-phase-5` (feature/phase-5-app-store) — commit, push, pause
  - [ ] `Meraki-plumenexus` (feature/plumenexus-launch) — commit, push, pause (or decide to delete in Phase 8.3)
- [ ] **Disable Firebase Hosting auto-deploy hooks** if any are configured in CI (none currently, per CLAUDE.md "No CI/CD — all deploys are manual").
- [ ] **Verify main is at the rename commit `7711d31`** (the `meraki` → `app` target alias rename from earlier this session).

If during migration you discover a parallel session DID make a commit on main, abort the migration phase you're in, rebase migration branch onto new main, re-verify all changes, resume.

### 0.B — Access verification

- [ ] `firebase login` succeeds and lists `meraki-salon-manager`
- [ ] `gcloud auth login` and `gcloud projects list` shows the project
- [ ] `gsutil ls` works (for Storage + GCS exports)
- [ ] `bq ls --project_id=meraki-salon-manager` works
- [ ] Stripe Dashboard access (`dashboard.stripe.com`)
- [ ] Twilio Console access
- [ ] AWS Console access (SES tab, us-west-2)
- [ ] Cloudflare Dashboard access (Workers + DNS)
- [ ] GitHub repo admin access (for rename)
- [ ] Google Cloud Console access (OAuth consent screen for new project)
- [ ] All Firebase Cloud Secrets noted in 1Password / vault:
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - `TWILIO_AUTH_TOKEN`
  - `ANTHROPIC_API_KEY`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
  - `UNSUBSCRIBE_SECRET`, `APPT_MANAGE_SECRET`
- [ ] `functions/.env` saved to a secure location (it has AWS keys + Stripe publishable + Google Maps key)

---

## Phase 1 — Backups & Snapshots (Day 0, 90 min)

Everything from this phase is read-only on the old project. Cost: ~$2 GCS storage for 90 days.

### 1.1 — Tag and freeze
- [ ] `git tag pre-migration-2026-MM-DD && git push origin pre-migration-2026-MM-DD`
- [ ] Note the SHA: `_______________________________`
- [ ] No more deploys to `meraki-salon-manager` after this point

### 1.2 — Firestore export
```bash
gcloud config set project meraki-salon-manager
gsutil mb -l us-central1 gs://plumenexus-migration-snapshot-2026-MM-DD
gcloud firestore export gs://plumenexus-migration-snapshot-2026-MM-DD/firestore
```
- [ ] Export completes (~5–15 min)
- [ ] Verify: `gsutil ls -l gs://plumenexus-migration-snapshot-2026-MM-DD/firestore`

### 1.3 — Storage bucket snapshot
```bash
gsutil -m rsync -r gs://meraki-salon-manager.firebasestorage.app gs://plumenexus-migration-snapshot-2026-MM-DD/storage
```
- [ ] Rsync completes
- [ ] File counts match between source and snapshot

### 1.4 — Auth users export
```bash
firebase auth:export plumenexus-migration-snapshot-2026-MM-DD/auth-users.json --project meraki-salon-manager
```
- [ ] Export file created
- [ ] Upload to snapshot bucket: `gsutil cp plumenexus-migration-snapshot-2026-MM-DD/auth-users.json gs://plumenexus-migration-snapshot-2026-MM-DD/`

### 1.5 — BigQuery dataset snapshot (for historical reports/AI chatbot)
```bash
for collection in clients appointments receipts employees data services giftcards promocodes payrollruns refunds disputes; do
  bq extract --destination_format=AVRO \
    "meraki-salon-manager:firestore_export.${collection}_raw_changelog" \
    "gs://plumenexus-migration-snapshot-2026-MM-DD/bq/${collection}-*.avro"
done
```
- [ ] All 11 datasets extracted

### 1.6 — Stripe webhook history dump (just-in-case reconciliation reference)
- [ ] Stripe Dashboard → Developers → Events → Export last 30 days as CSV
- [ ] Save to `gs://plumenexus-migration-snapshot-2026-MM-DD/stripe-events-2026-MM-DD.csv`

### 1.7 — Configuration snapshots
- [ ] `cp -r .firebaserc firebase.json firestore.rules firestore.indexes.json storage.rules functions/.env extensions/ plumenexus-migration-snapshot-2026-MM-DD/configs/`
- [ ] `gsutil cp -r plumenexus-migration-snapshot-2026-MM-DD/configs gs://plumenexus-migration-snapshot-2026-MM-DD/`

### 1.8 — Set 90-day lifecycle on snapshot bucket
```bash
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}' > /tmp/lifecycle.json
gsutil lifecycle set /tmp/lifecycle.json gs://plumenexus-migration-snapshot-2026-MM-DD
```
- [ ] Lifecycle set (auto-delete day 90 = ~$0.10/month while live)

---

## Phase 2 — New Firebase project setup (Day 1, parallel with Phase 1; 2 hr)

### 2.1 — Create Firebase project
- [ ] Firebase Console → Add Project → name `plumenexus-prod`
- [ ] Enable Blaze (pay-as-you-go) plan
- [ ] Link to billing account (same card)
- [ ] Note the new project number: `_______________________________`
- [ ] Note the new messagingSenderId: `_______________________________`

### 2.2 — Enable required APIs
Get the list from old project:
```bash
gcloud services list --enabled --project=meraki-salon-manager --format='value(config.name)' > /tmp/apis.txt
```
Enable each on new:
```bash
while read api; do
  gcloud services enable "$api" --project=plumenexus-prod
done < /tmp/apis.txt
```
- [ ] All APIs enabled (~20–30 APIs typically)

### 2.3 — Provision data services in same region as old (us-central1 / nam5)
- [ ] Firestore → Create database → `nam5` (multi-region), Native mode
- [ ] Storage → enable bucket `plumenexus-prod.firebasestorage.app` (same region)
- [ ] BigQuery → ensure dataset `firestore_export` will be created in `us` (auto when extensions deploy)

### 2.4 — Enable Firestore PITR (resets to 0; starts fresh)
- [ ] Firestore → Settings → Point-in-time recovery → enable

### 2.5 — Kick off Google OAuth consent screen verification (LONG CLOCK — START NOW)
- [ ] Google Cloud Console → APIs & Services → OAuth consent screen → External
- [ ] App name: `Plume Nexus Salon Manager`
- [ ] Support email: jvankim@gmail.com
- [ ] App domain: `plumenexus.com`
- [ ] Authorized domains: `plumenexus.com`, `cloudfunctions.net`
- [ ] Scopes: add `https://www.googleapis.com/auth/business.manage`
- [ ] Test users: jvankim@gmail.com
- [ ] **Submit for production verification** (3–5 business day clock)
- [ ] Create OAuth client ID (Web application)
  - Redirect URI: `https://us-central1-plumenexus-prod.cloudfunctions.net/googleBusinessAuthCallback`
- [ ] Save new `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` to vault

### 2.6 — Create new KMS key for refresh-token encryption
```bash
gcloud kms keyrings create salon-secrets --location=us-central1 --project=plumenexus-prod
gcloud kms keys create business-profile-refresh-token \
  --keyring=salon-secrets --location=us-central1 --project=plumenexus-prod \
  --purpose=encryption
```
- [ ] Note new key path: `projects/plumenexus-prod/locations/us-central1/keyRings/salon-secrets/cryptoKeys/business-profile-refresh-token`

### 2.7 — Create restore-staging bucket
```bash
gsutil mb -l us-central1 -p plumenexus-prod gs://plumenexus-restore-staging
```

---

## Phase 3 — Code rename (Day 1, 90 min)

### 3.1 — Add new project to `.firebaserc` (keep both during migration)
Edit `.firebaserc`:
```json
{
  "projects": {
    "default": "plumenexus-prod",
    "legacy":  "meraki-salon-manager"
  },
  "targets": {
    "plumenexus-prod": {
      "hosting": {
        "app": ["plumenexus-prod"],
        "plumenexus": ["plumenexus"],
        "platform-admin": ["plumenexus-admin"]
      }
    }
  }
}
```
- [ ] Test: `firebase use legacy` still hits the old project; `firebase use default` hits the new one

### 3.2 — Update Firebase config files
For each `firebase.js` (4 files), replace:
- `projectId: 'meraki-salon-manager'` → `'plumenexus-prod'`
- `storageBucket: 'meraki-salon-manager.firebasestorage.app'` → `'plumenexus-prod.firebasestorage.app'`
- `authDomain: 'meraki-salon-manager.firebaseapp.com'` → `'plumenexus-prod.firebaseapp.com'`
- `messagingSenderId` + `appId` → from new project (Firebase Console → Project Settings → Web App)

Files:
- [ ] `src/lib/firebase.js`
- [ ] `plumenexus/src/lib/firebase.js`
- [ ] `platform-admin/src/lib/firebase.js`
- [ ] `mobile/src/lib/firebase.js`

### 3.3 — Update Cloudflare Worker
- [ ] `cloudflare/worker.js` line 28: `const FIREBASE_HOST = 'plumenexus-prod.web.app';`
- [ ] Update comment line 3
- [ ] DO NOT deploy yet — keep flipping to new project for the cutover moment in Phase 7

### 3.4 — Update Cloud Functions URLs in functions/index.js
Replace `meraki-salon-manager.web.app` and `us-central1-meraki-salon-manager.cloudfunctions.net` throughout (~10 instances). Use this safe pattern that won't touch tenant refs:
```bash
grep -rln "meraki-salon-manager" functions/ src/ plumenexus/ platform-admin/ mobile/ cloudflare/ \
  | xargs sed -i '' 's|meraki-salon-manager|plumenexus-prod|g'
```
Then verify nothing tenant-related got hit:
```bash
git diff | grep -E "tenants/meraki|brand/meraki|merakinailstudio|HeroMeraki|merakiSite"
```
- [ ] No false positives (if there are, revert those specific hunks)

### 3.5 — Update firebase.json CSP headers
- [ ] Replace `meraki-salon-manager.firebaseapp.com` → `plumenexus-prod.firebaseapp.com` in both `frame-src` directives (lines 58 + 92)

### 3.6 — Update extensions/*.env
For each of 11 fs-bq-* extensions:
- [ ] `BIGQUERY_PROJECT_ID=plumenexus-prod`

### 3.7 — Update mobile/app.json (only if messagingSenderId changes)
- [ ] iOS `infoPlist.CFBundleURLSchemes` → new reversed client ID `com.googleusercontent.apps.<NEW_PROJECT_NUMBER>-...`
- [ ] DO NOT change bundleIdentifier (keep `com.meraki.salonmanager` — App Store provisioning is account-tied, not project-tied)

### 3.7a — Kill the legacy `meraki` tenant fallback
Now that Meraki will be `merakinailstudio` (slug + doc ID), every legacy fallback path goes away.

- [ ] `src/lib/tenant.js` — remove the `TENANT_ID = 'meraki'` fallback constant + all branches that use it. Slug lookup is the only path.
- [ ] `mobile/src/lib/firebase.js` — remove `TENANT_ID = 'meraki'` hardcode. Mobile sign-in resolves tenant via the user's `tenants/{tid}/data/usersFull/{uid}` membership lookup.
- [ ] `src/lib/migration.js` — delete the one-time `tenants/meraki` migration code (already-applied; pre-prod = no need to preserve).
- [ ] `functions/index.js` lines 18–23 — remove the legacy `tf46226a93a1b546b` constant + comment ("Was 'meraki' originally; that tenant was deleted 2026-05-14"). Replace with the clean `merakinailstudio` ID.
- [ ] Test fixtures in `functions/lib/*.test.js` that reference `tenants/meraki` — update to `tenants/merakinailstudio`.
- [ ] `slugs/meraki` Firestore doc — will be deleted in Phase 4.5 (the data-side cleanup). Do not write code that depends on it after this commit.
- [ ] Re-run `grep -rn "tenants/meraki\b\|'meraki'\|TENANT_ID.*meraki" --include="*.js" --include="*.jsx"` and verify only intentional brand refs remain (`/brand/meraki/`, `HeroMerakiSite`, etc.).

### 3.8 — Update docs (cosmetic)
- [ ] `ARCHITECTURE.md` — 45 refs
- [ ] `CLAUDE.md` — 3 refs
- [ ] `GO-LIVE.md` — 3 refs
- [ ] `ONBOARDING.md` — 2 refs
- [ ] `docs/GOOGLE_BUSINESS_PROFILE_SETUP.md` — 5 refs (new OAuth client ID, new KMS key path, new redirect URI)
- [ ] `package.json` rollback:console URL (line 23)

### 3.9 — Build sanity
```bash
npm run build
cd plumenexus && npm run build && cd ..
cd platform-admin && npm run build && cd ..
```
- [ ] All builds succeed

### 3.10 — Commit on a migration branch (don't merge to main yet)
```bash
git checkout -b migration/plumenexus-prod
git add -A
git commit -m "Migration: meraki-salon-manager → plumenexus-prod"
git push origin migration/plumenexus-prod
```

---

## Phase 4 — Deploy code + import data to new project (Day 2, 3 hr)

### 4.1 — Initial deploy to new project
```bash
firebase use plumenexus-prod
firebase deploy --only firestore:rules,firestore:indexes,storage:rules
```
- [ ] Rules + indexes deployed (will trigger index builds, ~5 min)

### 4.2 — Set Cloud Secrets on new project
```bash
firebase use plumenexus-prod
firebase functions:secrets:set STRIPE_SECRET_KEY            # paste from vault
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET        # paste from vault (will update again in Phase 5)
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET   # paste new client secret from Phase 2.5
firebase functions:secrets:set UNSUBSCRIBE_SECRET
firebase functions:secrets:set APPT_MANAGE_SECRET
```
- [ ] All 8 secrets set

### 4.3 — Update `functions/.env` for new project
- [ ] `AWS_*` lines — copy verbatim from old project (AWS account survives)
- [ ] `GOOGLE_OAUTH_CLIENT_ID` — new value from Phase 2.5
- [ ] `GOOGLE_BUSINESS_KMS_KEY` — new value from Phase 2.6
- [ ] `GOOGLE_MAPS_API_KEY` — copy verbatim (account-tied, survives)
- [ ] `PUBLIC_APP_URL` — `https://plumenexus-prod.web.app` (will become tenant subdomains via Worker)

### 4.4 — Deploy Cloud Functions
```bash
firebase deploy --only functions
```
- [ ] Deploy succeeds (~10–15 min for first deploy)
- [ ] All scheduled functions auto-create their Cloud Scheduler jobs
- [ ] Smoke test a public endpoint: `curl https://us-central1-plumenexus-prod.cloudfunctions.net/healthCheck`

### 4.5 — Install Firebase Extensions (11 fs-bq-*)
```bash
firebase deploy --only extensions
```
- [ ] All 11 extensions install (takes ~10–15 min)
- [ ] Verify in Firebase Console → Extensions

### 4.6 — Import Firestore data
```bash
gcloud firestore import gs://plumenexus-migration-snapshot-2026-MM-DD/firestore --project=plumenexus-prod
```
- [ ] Import completes
- [ ] Spot-check in Firestore Console: `tenants/tf46226a93a1b546b` (Meraki tenant) exists with subcollections

### 4.7 — Copy Storage bucket
```bash
gsutil -m rsync -r gs://meraki-salon-manager.firebasestorage.app gs://plumenexus-prod.firebasestorage.app
```
- [ ] Files copied

### 4.8 — Import Auth users
```bash
firebase auth:import plumenexus-migration-snapshot-2026-MM-DD/auth-users.json \
  --hash-algo=SCRYPT \
  --hash-key=$(firebase auth:export /tmp/_.json --project meraki-salon-manager 2>&1 | grep hash_key | cut -d= -f2) \
  --project plumenexus-prod
```
- [ ] Import succeeds (preserves UIDs + hashed passwords)
- [ ] Sign in as jvankim@gmail.com on new project → Google OAuth popup will require re-consent (one-time)

### 4.9 — Rename Meraki tenant: doc ID `tf46226a93a1b546b` → `merakinailstudio`

Now that the new-project Firestore has the imported data, do a contained data migration to give Meraki Nail Studio its proper tenant identity. Single script, single tenant, easy to verify.

Write `scripts/rename-meraki-tenant.cjs` (or similar) that:

1. Reads every subcollection under `tenants/tf46226a93a1b546b/*` (data, services, clients, employees, appointments, receipts, giftcards, promocodes, payrollruns, refunds, disputes, logs, etc.)
2. Writes each doc to the parallel path under `tenants/merakinailstudio/*`
3. After all writes succeed: deletes `tenants/tf46226a93a1b546b/*`
4. Writes/updates `slugs/merakinailstudio` to `{ tenantId: 'merakinailstudio', updatedAt: ... }`
5. Deletes `slugs/meraki` (the legacy slug entry, if it exists)

```bash
node scripts/rename-meraki-tenant.cjs --project=plumenexus-prod --dry-run   # verify first
node scripts/rename-meraki-tenant.cjs --project=plumenexus-prod --execute   # actually move
```

- [ ] Dry-run shows expected doc counts
- [ ] Execute completes without errors
- [ ] Verify in Firestore Console: `tenants/merakinailstudio/data/settings` exists, `tenants/tf46226a93a1b546b` is gone, `slugs/merakinailstudio.tenantId === 'merakinailstudio'`
- [ ] Verify `slugs/meraki` no longer exists

### 4.10 — Deploy Hosting (to new project URLs, NOT yet custom-domain)
```bash
npm run build
firebase deploy --only hosting:app,hosting:plumenexus,hosting:platform-admin
```
- [ ] All 3 sites deploy
- [ ] Smoke test:
  - `https://plumenexus-prod.web.app` — admin/staff login flow
  - `https://plumenexus.web.app` — marketing site (may auto-resolve to a generated URL)
  - `https://plumenexus-admin.web.app` — platform admin
- [ ] Sign in as Jonathan, verify Firestore reads work, verify a sample appointment shows up under the `merakinailstudio` tenant

---

## Phase 5 — External service reconfig (Day 2, 90 min)

DO NOT update production webhook URLs until Phase 7 cutover. For each service below, prepare the new URL **but keep the old URL active** until cutover so Stripe/Twilio events keep landing on the old project while you finish testing.

### 5.1 — Stripe (Dashboard)
- [ ] Developers → Webhooks → "Add endpoint" (don't delete old yet)
  - URL: `https://us-central1-plumenexus-prod.cloudfunctions.net/stripeWebhook`
  - Events: same as old endpoint (copy event list)
  - Note new webhook signing secret: `_______________________________`
- [ ] `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET` with new value on new project
- [ ] Trigger a test webhook from Stripe Dashboard → "Send test webhook" → verify it hits new function

### 5.2 — Twilio (Console)
- [ ] Phone Numbers → Active numbers → for each TFN:
  - Note current Message webhook URL: `_______________________________` (old)
  - DO NOT change yet — change at cutover (Phase 7)
- [ ] Messaging → Compliance → Status callback URL — same; document, don't change

### 5.3 — Google Business Profile OAuth
- [ ] Verify Phase 2.5 OAuth client is created and consent screen verification is in progress
- [ ] If consent screen still in "Testing" mode, expand test users to include any tenant emails
- [ ] Update `docs/GOOGLE_BUSINESS_PROFILE_SETUP.md` with new client ID + redirect URI

### 5.4 — AWS SES (SNS bounce/complaint webhook)
- [ ] AWS Console → SNS → Subscriptions → for `bounces` and `complaints` topics:
  - Add new subscription pointing at `https://us-central1-plumenexus-prod.cloudfunctions.net/sesEventWebhook`
  - Keep old subscription active for now
  - Confirm the new HTTP subscription (function must respond to SubscriptionConfirmation message)

### 5.5 — Gusto OAuth
- [ ] Gusto Developer Portal → App settings → Redirect URI
  - Add: `https://us-central1-plumenexus-prod.cloudfunctions.net/gustoOAuthCallback`
  - Keep old redirect URI active for now

### 5.6 — Cloudflare DNS — pre-stage but don't switch
- [ ] DO NOT touch DNS yet — the Worker handles all routing
- [ ] Verify Worker code change from Phase 3.3 is in your editor, ready to deploy at cutover

---

## Phase 6 — Smoke test new project end-to-end (Day 2 evening, 2 hr)

Use the raw Firebase URLs (`plumenexus-prod.web.app`) — don't cut DNS yet.

### 6.1 — Critical flows
- [ ] Sign in as jvankim@gmail.com (will require fresh Google OAuth consent)
- [ ] View dashboard — should show Meraki Nail Studio tenant data
- [ ] Open Schedule — verify appointments visible
- [ ] Open Clients → spot-check 3 clients (one with a photo to test Storage)
- [ ] Create a new test appointment, then delete it (verifies Firestore writes + delete + tombstone)
- [ ] Open Reports → AI chatbot → ask "how many appointments last week" (verifies Anthropic API + BQ access)
- [ ] Trigger a test SMS receipt (verifies Twilio path — but note Twilio webhook still pointed at OLD project)
- [ ] Trigger a test email receipt (verifies SES path)
- [ ] Stripe → trigger a test webhook from Dashboard → confirm it lands on new project's stripeWebhook function

### 6.2 — Public-facing flows
- [ ] Visit `https://plumenexus-prod.web.app/` — should redirect to a tenant or show "no tenant" state
- [ ] Visit `https://plumenexus-prod.web.app/?tid=tf46226a93a1b546b` — Meraki public homepage renders
- [ ] Book a test appointment as a guest

### 6.3 — Mobile (optional pre-cutover)
- [ ] Update `mobile/src/lib/firebase.js` is already done in Phase 3.2
- [ ] Run a dev build pointed at new project
- [ ] Sign in, verify schedule loads

### 6.4 — Green-light gate
**Do not proceed to Phase 7 until every checkbox above is checked.** If any flow is broken, fix on new project before cutover.

---

## Phase 7 — Cutover (Day 3, 60 min — any time)

You're the only user; pre-prod; cut over whenever it's convenient. After this, traffic flows to the new project.

### 7.1 — Cloudflare Worker flip
- [ ] `cd cloudflare && npx wrangler deploy`
- [ ] Verify: `curl -H "Host: merakinailstudio.plumenexus.com" https://plumenexus-prod.web.app` returns Meraki's homepage
- [ ] Verify in browser: `https://merakinailstudio.plumenexus.com` loads from new project (check Network tab for the new function URLs)

### 7.2 — Stripe webhook hand-off (one minute window)
- [ ] Stripe Dashboard → Webhooks → DISABLE the old `meraki-salon-manager` endpoint
- [ ] Verify the new `plumenexus-prod` endpoint is ENABLED
- [ ] (Stripe will queue + retry events that landed during the brief gap)

### 7.3 — Twilio webhook hand-off
- [ ] For each TFN: update Message webhook URL to `https://us-central1-plumenexus-prod.cloudfunctions.net/twilioInboundSms`
- [ ] Update status callback URL to `https://us-central1-plumenexus-prod.cloudfunctions.net/twilioStatusWebhook`

### 7.4 — AWS SES SNS hand-off
- [ ] Delete old SNS subscription pointing at meraki-salon-manager function URL
- [ ] Confirm new SNS subscription is "Confirmed"

### 7.5 — Gusto hand-off
- [ ] Remove old redirect URI; keep only the new one

### 7.6 — Custom domain re-verification on new project
- [ ] Firebase Console → Hosting (new project) → Add custom domain for:
  - `plumenexus.com` (marketing site → `plumenexus` hosting target)
  - `admin.plumenexus.com` (if exists → `platform-admin` target)
- [ ] DO NOT add `merakinailstudio.plumenexus.com` or wildcards — those are handled by the Cloudflare Worker
- [ ] Wait for SSL provisioning (1–2 hr)

### 7.7 — Disable scheduled functions on old project (stop double-execution)
```bash
firebase use legacy
firebase functions:delete sendMeetingReminders sendDailyReminders sendTechAppointmentReminders \
  generateAnnual1099s autoBirthdayCampaign autoLapsedCampaign runScheduledCampaigns \
  purgeOldTombstones runIntegrityScan scheduledSyncGoogleBusinessReviews \
  pullGcpCostDaily aggregateUsageDaily --force
```
- [ ] Old scheduled functions deleted (so they don't keep firing against old Firestore)

### 7.8 — Set old project to read-only mode (defensive)
- [ ] Old Firebase Console → Firestore → Rules → publish rules: `allow read: if true; allow write: if false;` for safety
- [ ] (You can still re-import from old data via the snapshot bucket if needed)

### 7.9 — Merge migration branch to main
```bash
git checkout main
git merge migration/plumenexus-prod
git push origin main
```

---

## Phase 8 — Local FS + git rename (Day 3, 30 min)

Done AFTER cutover succeeds — these are local-only cleanups.

### 8.1 — Rename GitHub repo
- [ ] github.com/vankimj/Meraki-Salon-Manager → Settings → rename to `Plumenexus-Salon-Manager`
- [ ] GitHub auto-redirects old URLs for life (so legacy clones keep working)

### 8.2 — Update git remote on all 4 worktrees
```bash
cd /Users/jonathanvankim/Downloads/Meraki-Salon-Manager
git remote set-url origin https://github.com/vankimj/Plumenexus-Salon-Manager.git
cd /Users/jonathanvankim/Downloads/Meraki-editorial-site
git remote set-url origin https://github.com/vankimj/Plumenexus-Salon-Manager.git
cd /Users/jonathanvankim/Downloads/Meraki-phase-5
git remote set-url origin https://github.com/vankimj/Plumenexus-Salon-Manager.git
cd /Users/jonathanvankim/Downloads/Meraki-plumenexus
git remote set-url origin https://github.com/vankimj/Plumenexus-Salon-Manager.git
```

### 8.3 — Decide on `Meraki-plumenexus` worktree
- [ ] Inspect its branch (`feature/plumenexus-launch`) — was this vestigial / superseded by phase-5?
- [ ] If yes: `git worktree remove Meraki-plumenexus`
- [ ] If no: rename like the others below

### 8.4 — Rename local working dirs
Order matters: rename the worktrees first, then update the primary checkout's worktree pointers.

```bash
cd ~/Downloads
# Rename all 3 (or 4) worktree dirs
mv Meraki-editorial-site Plumenexus-editorial-site
mv Meraki-phase-5        Plumenexus-phase-5
mv Meraki-plumenexus     Plumenexus-plumenexus  # or delete if vestigial
mv Meraki-Salon-Manager  Plumenexus-Salon-Manager
```

- [ ] cd into the renamed primary: `cd ~/Downloads/Plumenexus-Salon-Manager`
- [ ] `git worktree repair` — fixes the absolute-path pointers in `.git/worktrees/*/gitdir`
- [ ] Verify all worktrees: `git worktree list`

### 8.5 — Move/rename the auto-memory dir
The memory dir is keyed off the cwd path. After renaming the cwd, Claude Code will look for the wrong dir.

```bash
mv ~/.claude/projects/-Users-jonathanvankim-Downloads-Meraki-Salon-Manager \
   ~/.claude/projects/-Users-jonathanvankim-Downloads-Plumenexus-Salon-Manager
```
- [ ] Confirm new directory exists
- [ ] Future Claude Code sessions in the new dir will read this memory automatically

### 8.6 — Leave loose `~/Downloads/meraki-*.csv` + `meraki-backup-*.json` + `Meraki SVG.zip` untouched
- [ ] These are Meraki Nail Studio tenant data exports — names correctly reflect their tenant content. Don't rename.

### 8.7 — IDE / VS Code workspace
- [ ] If VS Code recent-projects list shows old paths, manually re-open the renamed dir
- [ ] Update any `.code-workspace` files (search `~/Downloads/Meraki-` in your home dir)

---

## Phase 9 — Post-cutover monitoring (Days 3–7)

- [ ] Day 3 evening: check Cloud Functions logs for errors (`firebase functions:log --project plumenexus-prod`)
- [ ] Day 4: review Stripe Dashboard → Webhooks → verify all events succeeded (200 responses)
- [ ] Day 4: review SES → bounce/complaint topic → verify SNS deliveries succeeded
- [ ] Day 5: review BQ extensions are populating: `bq query "SELECT COUNT(*) FROM plumenexus-prod.firestore_export.appointments_raw_changelog WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)"`
- [ ] Day 5: verify scheduled functions are firing on schedule (check Cloud Scheduler in Console)
- [ ] Day 7: confirm Google OAuth consent screen verification completed → move from Testing to Production

---

## Phase 10 — Decommission old project (Day 30)

Only after 30 days of green operation. The snapshot bucket has a 90-day lifecycle, so you still have 60 days of restore-ability after this.

- [ ] Final Firestore export of old project as belt-and-suspenders backup (in case something resurfaces)
- [ ] Firebase Console (old project) → Project Settings → Delete project
- [ ] Stripe Dashboard → delete the disabled old webhook endpoint
- [ ] AWS Console → SNS → delete old subscription (already deleted at cutover, just verify)
- [ ] Delete the migration branch: `git branch -d migration/plumenexus-prod && git push origin --delete migration/plumenexus-prod`

---

## Cost summary

| Phase | Cost |
|---|---|
| Snapshot bucket (90-day retention, <5 GB) | ~$0.50 |
| Export read ops (Firestore) | ~$0.50 |
| Import write ops (new Firestore) | ~$1.50 |
| Storage rsync (gsutil) | $0 (same region) |
| BQ extract to GCS | ~$0.10 |
| New project baseline cost during testing | ~$1–2 |
| **Total** | **~$5** |

No 30-day double-infra cost.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Google OAuth verification rejected | Low | Already verified for old project; new submission uses same domain. Test users cover dev. |
| Stripe webhook events lost between disable old / enable new | Low | Stripe retries failures with exponential backoff for 3 days |
| Twilio inbound SMS lost during cutover window | Low | Pre-prod, single user. Worst case: a test SMS from Jonathan during the 60s flip needs re-sending. |
| BQ extension backfill catches only new writes | Certain | Historical BQ data in snapshot AVRO; can re-import if reports need history |
| Custom domain SSL provisioning delay | Medium | Cloudflare Worker handles main subdomains; only `plumenexus.com` apex needs Firebase custom domain |
| Forgotten config in one of ~30 places | Medium | Phase 3 `git diff | grep meraki-salon-manager` after sed runs catches stragglers |
| Auth users locked out | Low | UIDs + password hashes preserved on import; Google sign-in just requires fresh consent |
| Apple App Store build broken | Low | Bundle ID unchanged; only Firebase config inside app changes |

---

## Open questions (decide before Phase 1)

1. **Project ID name** — confirm `plumenexus-prod` or pick something else (`plumenexus-app`, `plume-nexus`, etc.)? The ID is permanent.
2. **Worktree `Meraki-plumenexus`** — vestigial or in active use? Confirm before Phase 8.3.
3. **OAuth consent screen verification** — has the OLD project's consent screen ever been moved to Production (verified by Google)? If yes, this clock has already run once.

(Cutover timing intentionally omitted — pre-prod, single user, do it whenever.)

---

## Appendix A — Wedged-deployment recovery

A "wedge" is when the system enters a state where the next action would make things worse, but standing still is also bad. The migration has a few of these failure modes. For each, the move is the same: **pause, diagnose, recover. Don't retry the broken command in a loop.**

### A.1 — Cloud Functions deploy interrupted mid-flight
**Symptom:** `firebase deploy --only functions` killed (Ctrl-C, network drop, timeout). Some functions deployed, others not.

**Recovery:**
1. `firebase functions:list --project=plumenexus-prod` — see what exists
2. Re-run the deploy. Cloud Functions deploys are idempotent; it'll skip unchanged and finish missing ones.
3. If a specific function is stuck "deploying" for >30 min, force-delete it and redeploy: `firebase functions:delete <name> --force --project=plumenexus-prod` then redeploy.

### A.2 — Firestore import partial / corrupted
**Symptom:** `gcloud firestore import` failed midway; some collections present, some missing.

**Recovery:**
1. Verify the snapshot bundle is intact: `gsutil ls -l gs://plumenexus-migration-snapshot-.../firestore/`
2. Delete the partial data in the new project: Firestore Console → delete affected collections (CAREFUL — only on new project, never on old)
3. Re-run the import. Firestore import overwrites existing docs at the same path; no merge.

### A.3 — Firestore index build pending blocks queries
**Symptom:** App queries fail with "this query requires an index" even though `firestore.indexes.json` is correct.

**Recovery:**
1. Firebase Console → Firestore → Indexes — verify all indexes are "Enabled" (not "Building"). Index builds can take 10–60 min for large collections.
2. Don't manually re-create indexes via the Console — that creates duplicates. Wait for `firebase deploy --only firestore:indexes` indexes to finish building.
3. If an index is stuck "Building" for >2 hrs, file via the Firebase support form (rare; usually means a duplicate definition).

### A.4 — Cloud Function secret missing → functions crash on cold start
**Symptom:** Function logs show `Error: Secret STRIPE_WEBHOOK_SECRET not found`.

**Recovery:**
1. `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project=plumenexus-prod` — paste value
2. **Must redeploy functions** after setting a new secret. Setting alone doesn't bind it to running functions.
3. `firebase deploy --only functions:stripeWebhook --project=plumenexus-prod`

### A.5 — Stripe webhook signing mismatch after secret swap
**Symptom:** stripeWebhook function returns 400 with `Webhook signature verification failed` for incoming events.

**Recovery:**
1. You set the OLD project's webhook secret on the NEW project (or vice-versa). The signing secret is endpoint-specific.
2. Get the NEW endpoint's signing secret from Stripe Dashboard → Webhooks → [new endpoint] → Signing secret → Reveal.
3. `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET` with the correct value, then redeploy.

### A.6 — Cloudflare Worker pointed at dead project
**Symptom:** `merakinailstudio.plumenexus.com` returns 404 / "no such site" from Firebase.

**Recovery:**
1. Check Worker code: `cat cloudflare/worker.js | grep FIREBASE_HOST` — should be `plumenexus-prod.web.app` post-cutover.
2. `cd cloudflare && npx wrangler deploy` — redeploy Worker.
3. Cloudflare Workers deploys are atomic and propagate in <30s globally.

### A.7 — Migration commit pushed to main while parallel session was working
**Symptom:** Other worktree session reports `git rebase` conflicts on firebase.js / .firebaserc.

**Recovery:**
1. **Other session's changes always lose this conflict** — the migration is the global authoritative state. Tell them to:
   - `git stash` any local changes
   - `git pull --rebase origin main`
   - Re-apply their work on top of the new firebase.js (new projectId etc.)
2. If they've already pushed conflicting changes upstream: revert their commit on origin/main, push them back to their feature branch, redo migration push.

### A.8 — Firebase Extensions stuck "Processing"
**Symptom:** `firebase deploy --only extensions` shows one or more extensions in "Processing" state for >30 min.

**Recovery:**
1. Firebase Console → Extensions — find the stuck one.
2. Uninstall it manually (Console UI).
3. Re-run `firebase deploy --only extensions:fs-bq-X --project=plumenexus-prod`.
4. Backfill catches only new writes — if you need historical BQ data, schedule a `bq load` from the AVRO snapshot in Phase 1.5.

### A.9 — Auth import silently dropped users
**Symptom:** `firebase auth:import` reports success but user count on new project is wrong.

**Recovery:**
1. `firebase auth:export /tmp/post-import.json --project plumenexus-prod` — compare row count to original export.
2. If short: the `--hash-algo` / `--hash-key` flags were wrong. Get the correct values: `firebase auth:export /tmp/_.json --project meraki-salon-manager` shows the hash config in stderr.
3. Delete the imported users (Auth Console → Users → Delete all) and re-import with correct flags.

### A.10 — Stuck in "wedged" mid-Phase-4 with both projects in weird state
**Symptom:** Lost track of what's where; both old and new project have partial state; not sure what's safe to delete.

**Recovery:**
1. **Stop deploying.** Step back from the keyboard.
2. The snapshot bundle from Phase 1 is the source of truth. Both projects are mutable; the snapshot is not.
3. Wipe new project's Firestore + Storage entirely (Console → Project Settings → Delete Firestore data).
4. Re-run Phase 4 from scratch. The snapshot is immutable; you can re-import as many times as needed.
5. Do NOT touch the old project's data — it's the live one until cutover.

---

## Appendix B — "Did I rename it?" verification

Run these greps after each rename phase to confirm nothing was missed:

```bash
# Phase 3 verification — should only return brand/tenant references, no platform IDs
grep -rn "meraki-salon-manager" --include="*.js" --include="*.jsx" --include="*.json" \
  --include="*.md" --include="*.cjs" --include="*.html" \
  | grep -v node_modules | grep -v dist | grep -v ".firebase/"
# Expected: 0 results in code; cosmetic mentions in docs OK if they're describing the legacy state

# Phase 3.7a verification — legacy tenant slug fallback gone
grep -rn "'meraki'\|\"meraki\"\|TENANT_ID.*meraki\|tenants/meraki\b" \
  --include="*.js" --include="*.jsx" src/ functions/ mobile/ platform-admin/
# Expected: 0 hits in non-brand files. Hits inside HeroMerakiSite.jsx are intentional brand refs.

# Phase 4.9 verification — Firestore data shape
node -e "
const a = require('firebase-admin'); a.initializeApp({projectId:'plumenexus-prod'});
(async()=>{
  console.log('merakinailstudio:', (await a.firestore().doc('tenants/merakinailstudio/data/settings').get()).exists);
  console.log('tf462...:', (await a.firestore().doc('tenants/tf46226a93a1b546b/data/settings').get()).exists);
  console.log('slug:', (await a.firestore().doc('slugs/merakinailstudio').get()).data());
})();"
# Expected: merakinailstudio=true, tf462...=false, slug.tenantId='merakinailstudio'
```
