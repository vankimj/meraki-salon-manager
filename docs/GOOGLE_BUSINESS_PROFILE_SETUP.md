# Google Business Profile API setup

Steps you (Jonathan) need to perform in the Google Cloud Console to enable the "Connect Google Business" feature. The code is already deployed and will start working as soon as the two env vars are configured. The full review sync (all 174+ reviews instead of the 5 the public Places API allows) is gated entirely by this setup.

## Step 1 — Enable the APIs

In the GCP console for **project `meraki-salon-manager`**:

1. Go to **APIs & Services → Library**
2. Search for and enable each of:
   - **Google My Business Account Management API**
   - **Google My Business Business Information API**
   - **My Business Q&A API** (optional — needed only if we later add Q&A management)

The legacy reviews endpoint at `mybusiness.googleapis.com/v4` is auto-enabled when the Account Management API is enabled. Google has not migrated the reviews endpoint to the new split APIs yet.

## Step 2 — Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. **User Type:** External (you'll be the only test user initially, but External is what Google Business Profile requires)
3. Fill in:
   - App name: `Plume Nexus Salon Manager`
   - User support email: `jvankim@gmail.com`
   - App logo: optional
   - App domain: `merakinailstudio.plumenexus.com`
   - Authorized domains: `plumenexus.com`, `cloudfunctions.net`
   - Developer contact: `jvankim@gmail.com`
4. **Scopes** — add:
   - `https://www.googleapis.com/auth/business.manage`
5. **Test users** — add `jvankim@gmail.com` (and any other emails that should be able to connect)
6. **Publishing status:** Leave in **Testing** for now. We'll move to Production later (requires Google verification, 3–5 days).

In Testing mode, up to 100 designated test users can use the app without verification. That's plenty for Meraki + any test tenant.

## Step 3 — Create the OAuth 2.0 Client ID

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `Plume Nexus Salon Manager — Google Business`
4. **Authorized redirect URIs** — add:
   ```
   https://us-central1-meraki-salon-manager.cloudfunctions.net/googleBusinessAuthCallback
   https://merakinailstudio.plumenexus.com/auth/google-business/callback
   ```
   (Two URIs because the Cloud Function URL is what Google actually calls, but if we later add a Hosting-routed callback we'll already have the alternate URL whitelisted.)
5. Click **Create**. You'll be shown a **Client ID** and a **Client secret** — copy both.

## Step 4 — Create a KMS key for refresh-token encryption

The OAuth refresh token must be encrypted at rest. We use Google Cloud KMS so the encryption key never touches the function's process memory directly — it's used only via authorized API calls.

1. Go to **Security → Key Management → Create key ring**
   - Name: `salon-secrets`
   - Location: `us-central1` (same region as functions)
2. Inside that key ring, **Create key**
   - Name: `business-profile-refresh-token`
   - Protection level: Software (sufficient; HSM costs more and isn't needed here)
   - Purpose: Symmetric encrypt/decrypt
   - Rotation: 90 days
3. After creation, on the key's **Permissions** tab, grant your Cloud Functions service account the role:
   - Principal: `meraki-salon-manager@appspot.gserviceaccount.com` (or the 2nd-gen functions runner — usually `<project-number>-compute@developer.gserviceaccount.com`; check `gcloud functions list` if unsure)
   - Role: **Cloud KMS CryptoKey Encrypter/Decrypter**

You can verify the key path from the Console; it should look like:
```
projects/meraki-salon-manager/locations/us-central1/keyRings/salon-secrets/cryptoKeys/business-profile-refresh-token
```

## Step 5 — Wire the secrets into Firebase Functions

Three params need to be set in `functions/.env`:

```bash
GOOGLE_OAUTH_CLIENT_ID=<from Step 3>
GOOGLE_OAUTH_CLIENT_SECRET=<from Step 3>
GOOGLE_BUSINESS_KMS_KEY=projects/meraki-salon-manager/locations/us-central1/keyRings/salon-secrets/cryptoKeys/business-profile-refresh-token
```

Then redeploy functions:
```bash
firebase deploy --only functions:startGoogleBusinessAuth,functions:googleBusinessAuthCallback,functions:syncGoogleBusinessReviews,functions:scheduledSyncGoogleBusinessReviews
```

## Step 6 — Connect Meraki

1. Open https://merakinailstudio.plumenexus.com → Admin → Webfront → **Google Business Profile** section
2. Click **Connect Google Business Profile**
3. Sign in with `jvankim@gmail.com` (the Google account that owns the Meraki listing)
4. Grant the requested permission
5. You'll be returned to the app with a "Connected — N locations" status

After that, the Public Reviews panel will switch from showing 5 to showing all reviews, and a nightly cron will keep it fresh.

## Production verification (later, for SaaS)

When you're ready to expose this to other tenants (Pro tier feature), submit the OAuth consent screen for verification:
- Provide a privacy policy URL
- Demo video showing the connect flow
- Justification for the `business.manage` scope
- Wait 3–5 days for Google review

Until then, each new tenant who wants this feature needs to be added as a **test user** in the OAuth consent screen.
