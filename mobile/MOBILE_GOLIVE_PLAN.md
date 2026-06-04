# Mobile App Go-Live Plan — Plume Nexus (iOS)

_Authored 2026-06-03. The Apple Developer account (JVK Consulting LLC) is now verified, which
was the sole blocker. This plan takes the simulator-tested app to a real device, then TestFlight,
then the App Store._

## Decisions locked
- **Rebrand to Plume Nexus.** Bundle ID `app.plumenexus.pro`, display name "Plume Nexus".
- **Apple account: JVK Consulting LLC** (org account). App Store "Seller" will show as
  JVK Consulting LLC — legally fine; can be changed later via name update or app transfer to
  Plume Nexus LLC if desired. Not a blocker.
- **Web OAuth client ID is unchanged** (`721171829996-l4r31smgf04r3fnagshfh4hpld1eb91n`). It is
  the Firebase audience and is bundle-agnostic.

## Why the bundle ID can't just be string-swapped
Google Sign-In on iOS validates the running app's bundle ID against an **iOS OAuth client** that
is registered to one specific bundle ID. The current iOS client
(`…ap9a74l13h4c9rdtf4vv168c4kq1q5ep`) is bound to `com.meraki.salonmanager`. Changing the bundle
to `app.plumenexus.pro` **requires a new iOS OAuth client** (or editing the existing client's
bundle ID) in the Google Cloud console for project `plumenexus-prod`. Until that exists, the new
reversed-client-ID URL scheme is unknown — so those two spots are staged with a LOUD placeholder
rather than a fabricated value (per the never-fabricate-config rule).

---

## Phase 1 — Rebrand app identity

### 1a. Code changes (DONE in this pass, except the OAuth-bound values)
- `app.json`: `name` → "Plume Nexus"; `ios.bundleIdentifier` + `android.package` →
  `app.plumenexus.pro`; `scheme` → "plumenexus".
- `app.json` `CFBundleURLSchemes` reversed-client-ID: **staged placeholder**
  `com.googleusercontent.apps.REPLACE_WITH_NEW_IOS_OAUTH_CLIENT` — must be swapped to the new
  client's reversed ID.
- `src/screens/AuthScreen.jsx`: login-screen brand text "Meraki / NAIL STUDIO" → "Plume Nexus /
  SALON MANAGER"; `IOS_CLIENT_ID` **staged placeholder** + TODO; `WEB_CLIENT_ID` left unchanged.
- `package.json` `name` → `plumenexus-mobile`; `SETUP.md` title → "Plume Nexus Mobile".
- **EAS slug stays `meraki-mobile`** (app.json line 4) — DO NOT CHANGE. Resolved 2026-06-04: the
  EAS **Display name** was renamed to `plumenexus-mobile` (what shows on expo.dev), but the slug is
  an immutable internal ID validated against projectId `9da1f1fe-…234cc`. `app.json` slug must keep
  matching the real slug (`eas project:info` → `@jvankim/meraki-mobile`), so it stays as-is.
  Users never see the slug; the app display name is "Plume Nexus".

### 1b. Create the new iOS OAuth client (YOU — needs console access)
1. Google Cloud console → project **plumenexus-prod** → APIs & Services → Credentials.
2. **Create Credentials → OAuth client ID → Application type: iOS.**
3. Name it e.g. "Plume Nexus iOS". **Bundle ID: `app.plumenexus.pro`**.
4. Copy two things back to me:
   - the **iOS client ID** (`…apps.googleusercontent.com`)
   - its **reversed client ID** / "iOS URL scheme" (`com.googleusercontent.apps.…`)
5. I drop them into `AuthScreen.jsx` (`IOS_CLIENT_ID`) and `app.json` (`CFBundleURLSchemes`).

> Alternative: edit the **existing** iOS client and change its bundle ID to `app.plumenexus.pro`.
> Then the client ID stays the same and only the bundle changes. Either path works.

---

## Phase 2 — Apple registration & first device build
1. With EAS logged in as `jvankim`, run the device dev-client build — EAS will prompt to
   create the Apple **App ID** `app.plumenexus.pro`, **distribution certificate**, and
   **provisioning profile** automatically (account is now verified, so this no longer errors):
   ```bash
   cd mobile && eas build --profile development --platform ios
   ```
2. Register your physical iPhone/iPad as a test device when prompted (or
   `eas device:create`), then install the resulting dev-client build on it.
3. Smoke-test on device: Google Sign-In (validates the new OAuth client), schedule, push
   notification delivery (push only works on a real device build, never in Expo Go).

---

## Phase 3 — Real branded assets
- Replace placeholders in `mobile/assets/` (`icon.png`, `splash.png`, `adaptive-icon.png`,
  `notification-icon.png`) with Plume Nexus camellia-brand art. `brand-master.svg` at the repo
  root is the source that drives PNG regeneration.
- Confirm `app.json` splash `backgroundColor` (#0f1923) and notification `color` (#2D7A5F) still
  match the Plume Nexus palette, or update.

---

## Phase 4 — TestFlight & App Store
1. Production build:
   ```bash
   cd mobile && eas build --profile production --platform ios
   ```
2. Submit to App Store Connect:
   ```bash
   cd mobile && eas submit --profile production --platform ios
   ```
   (First run creates the App Store Connect app record for `app.plumenexus.pro`.)
3. App Store Connect: fill listing metadata, privacy nutrition labels (the app collects
   client PII, photos, push tokens — declare accordingly), screenshots.
4. TestFlight internal testing → fix → App Store review submission.

---

## Open items to resolve along the way (not blockers, but flag)
- **`iPad` support**: `app.json` has `supportsTablet: false`. Techs use phones, but the salon also
  uses iPads (TipFlow kiosk is iPad). Decide whether the tech app should also run native on iPad
  or stay iPhone-only.
- **Tenant fallback default**: `src/lib/currentTenant.js` `FALLBACK = 'merakinailstudio'` — this is
  CORRECT (the real Meraki tenant slug/doc ID, a live customer) and must stay. Verified 2026-06-03.
- **`ITSAppUsesNonExemptEncryption: false`** is set — correct only if the app uses no
  non-exempt crypto beyond standard HTTPS. True today; re-confirm if crypto is added.
