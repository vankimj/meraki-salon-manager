# Launch & Grow — activation & deploy

Everything ships **dark** behind feature flags, so merging to `main` changes nothing for real tenants until you flip a flag. This doc lists what to deploy and flip to turn it on.

## 1. Feature flags (src/lib/featureFlags.js)
Two flags, both `demo`-only by default. Roll out demo → owner (Meraki) → free → pro per the file's rollout discipline (or flip a single tenant via `settings.featureFlags.<flag> = true`).
- `curatedHome` — Phase 1 simplicity (curated Core/Grow/Admin home + Simple-Mode switch + Checkout "More options").
- `launchGrow` — the Launch & Grow module (tile + route + AI coach).

## 2. Secrets / config
| Name | Type | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret | **already set** (powers the AI coach) |
| `GOOGLE_BUSINESS_KMS_KEY` | string | **already set** (reused to KMS-encrypt the IG token) |
| `META_APP_ID` | string (.env / functions config) | **NEW — required for live Instagram** |
| `META_APP_SECRET` | secret | **NEW — required for live Instagram** |

```
firebase functions:secrets:set META_APP_SECRET
# add META_APP_ID to functions/.env (or your config) — it's public (rides in the OAuth URL)
```

Without the META_* values the Instagram functions **no-op gracefully** and the UI shows the manual "last posted" tracker — so the AI coach + everything else can ship before Meta is ready.

## 3. Deploy (targeted — never `--only functions` all-at-once; us-central1 CPU quota)
Repeat the `functions:` prefix per name (see memory `reference_firebase_deploy_only_functions_syntax`).

AI coach (needs only ANTHROPIC_API_KEY):
```
firebase deploy --only functions:growCoachSuggest,functions:growDraftDocument,functions:growPhotoCritique
```
Instagram (needs META_* + KMS; safe to deploy before Meta approval — they no-op until configured):
```
firebase deploy --only functions:startInstagramAuth,functions:instagramAuthCallback,functions:syncInstagramNow,functions:disconnectInstagram,functions:pollInstagramCadence
```
Rules (adds launchChecklist + instagram* docs):
```
firebase deploy --only firestore:rules
```

After deploying a callable, integration-smoke it before flipping the flag (per memory `feedback_mocking_hides_integration_bugs`).

## 4. Meta App Review (gates LIVE Instagram only)
The Meta app needs these permissions approved (weeks of lead time): `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `business_management`. Add the OAuth redirect URI:
```
https://us-central1-plumenexus-prod.cloudfunctions.net/instagramAuthCallback
```
Plus business verification + a screencast of the connect flow. Until approved, the manual cadence tracker is the experience.

## 5. Storage CORS (one-time — enables AI photo critique)
The "✨ critique" reads an uploaded photo client-side (resizeImg fetches the Storage download URL), which needs the bucket to allow cross-origin GET. Download URLs are already public, so GET-from-any-origin is safe:
```
gsutil cors set storage.cors.json gs://<your-storage-bucket>
```

## 6. What's NOT wired yet (future)
- Mobile parity (web-first per the parity rule).
- Place-ID capture item (Google reviews connect is a deep-link to Admin for now).
- Crop/touch-up editor (AI critique gives crop advice instead).
