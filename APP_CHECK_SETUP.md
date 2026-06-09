# Firebase App Check — setup & rollout

App Check attaches an attestation token to every Firestore + callable request so
bot/abuse traffic against the **public booking callables** can be rejected
server-side. It's wired into the code but **OFF by default** (monitor mode) until
you complete the console setup below and flip enforcement.

Protected callables (soft-enforced via `requireAppCheck`):
`findOrCreateClient`, `submitOnlineBooking`, `getPublicAvailability`,
`createBookingSetupIntent`, `saveBookingPaymentMethod`, `chargeBookingDeposit`.

## 1. Create a reCAPTCHA v3 site key
- Google Cloud Console → Security → reCAPTCHA (or https://www.google.com/recaptcha/admin).
- Create a **reCAPTCHA v3** key (score-based). Domains: `merakinailstudio.plumenexus.com`,
  `plumenexus-prod.web.app`, and any other tenant booking domains. Also add `localhost` for dev.
- Copy the **site key** (public) — this is what the web client uses.

## 2. Register the web app in App Check
- Firebase Console → App Check → Apps → your **Web app** → register with the
  **reCAPTCHA v3** provider, pasting the site key from step 1.
- Leave enforcement **unenforced** for now (we enforce in code, gradually).

## 3. Add the site key to the web build env
Add to `.env` (and `.env.production` / `.env.staging`):
```
VITE_RECAPTCHA_SITE_KEY=<your reCAPTCHA v3 site key>
```
- Without this var the client simply doesn't init App Check (no breakage).
- For local dev: in App Check console, register a **debug token**, then set
  `VITE_APPCHECK_DEBUG_TOKEN=<token>` (or `=true` to print a fresh one to the console).

## 4. Deploy in MONITOR mode (default)
- Deploy hosting (so clients send tokens) + functions. Leave `APP_CHECK_ENFORCE` unset.
- The functions log `[AppCheck] missing token (monitor) …` for any tokenless
  request. Watch logs / App Check console "Requests" metrics for a few days until
  ~all legit booking traffic shows verified tokens.

## 5. Flip enforcement
Once coverage looks clean, set the functions env var and redeploy functions:
```
APP_CHECK_ENFORCE=true
```
(in `functions/.env` or via `firebase functions:config` / deploy env). Now tokenless
requests to the booking callables are rejected. No client redeploy needed to flip it.

## Notes
- CSP already allows reCAPTCHA (`www.google.com`, `www.gstatic.com`, `*.googleapis.com`).
- Mobile app App Check is **not** done here (mobile uses the JS SDK and its callables
  are staff-authenticated; the bot surface is the public web booking page). If desired
  later, mobile needs `react-native-firebase` App Check with DeviceCheck/App Attest
  (iOS) + Play Integrity (Android).
- Don't enable App Check **enforcement for Firestore/Storage in the console** unless
  you've confirmed every client (web + mobile + admin) sends tokens — that's a
  separate, broader switch than the per-callable code enforcement here.
