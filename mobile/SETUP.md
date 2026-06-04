# Plume Nexus Mobile — Setup

Expo (React Native) app for staff. Phase 1 ships the foundation; Phase 2+ fills in screens.

## Quick start (local dev on Expo Go)

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with **Expo Go** (App Store / Play Store). Sign in with the same Google account that's an admin on the web app.

> Push notifications do **not** work in Expo Go on iOS as of SDK 53+; you'll need an EAS Build (Development Client) to test push end-to-end. Everything else (UI, sign-in, Firestore reads/writes) works in Expo Go.

## What's implemented (Phase 1)

- ✅ Google sign-in (shared Firebase project with web app)
- ✅ Bottom-tab navigation: Schedule · Earnings · Clients · Chat · Profile
- ✅ Push notification token registration (`expo-notifications`) — saved per-user in Firestore at `tenants/{tid}/userPushTokens/{uid}`
- ✅ Server-side push fan-out — the existing `sendApptNotification` Cloud Function now sends both email AND push for every notification doc
- ✅ Schedule (read-only day view), Clients (search), placeholder cards for the rest

## What's coming (Phase 2-4)

- Schedule writes — status changes, check-in, note edits, drag-to-reschedule
- TechEarnings — tips/services/take-home dashboard
- Clients full CRUD
- Profile self-edit
- Chat / messages
- Tech-scoped Reports
- Personal Settings

## Production assets to swap before App Store

Placeholders are seeded from the web icons. Before submitting:

- `assets/icon.png` — 1024×1024 app icon (no transparency)
- `assets/splash.png` — 1284×2778 splash screen image (or whatever Expo recommends for the latest SDK)
- `assets/adaptive-icon.png` — 1024×1024 Android adaptive icon foreground
- `assets/notification-icon.png` — 96×96 Android monochrome notification icon

## Before EAS Build (production)

### 1. Set the EAS project ID
```bash
cd mobile
npx eas init
```
This populates `app.json → expo.extra.eas.projectId` automatically. Push tokens won't return a real value without this.

### 2. Google Sign-In — set the web client ID
In `src/screens/AuthScreen.jsx`, replace the `webClientId` placeholder with the value from:
Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Web client.

### 3. Firebase Google Services files
- iOS: `GoogleService-Info.plist` → place in `mobile/`
- Android: `google-services.json` → place in `mobile/`

Both download from Firebase Console → Project Settings → Your apps.

### 4. EAS Build
```bash
npm install -g eas-cli
eas login
eas build --platform all --profile production
```

## File map

```
mobile/
  App.jsx                       — auth gate → AuthScreen or RootNav
  app.json                      — Expo config (icons, plugins, push)
  src/
    lib/
      firebase.js               — Firebase config (same project as web)
      firestore.js              — Firestore helpers
    navigation/
      RootNav.jsx               — Bottom-tab nav, registers push on mount
    hooks/
      usePushRegistration.js    — Expo push token → Firestore
    screens/
      AuthScreen.jsx            — Google sign-in
      ScheduleScreen.jsx        — Day view (read-only in Phase 1)
      ClientsScreen.jsx         — Searchable client list
      EarningsScreen.jsx        — Stub (Phase 2 will port TechEarnings)
      ChatScreen.jsx            — Stub (Phase 4)
      ProfileScreen.jsx         — Identity + sign-out (Phase 3 self-edit)
```

## How push fan-out works

1. Mobile app boots → `usePushRegistration` requests permission, gets an Expo push token, writes to `tenants/{tid}/userPushTokens/{uid}` (`{ email, tokens: arrayUnion(token), platform, lastSeenAt }`).
2. A web/server action creates a Firestore notification doc at `tenants/{tid}/notifications/{notifId}` (existing `notifyAffectedTechs` / `notifyOnCheckIn` flow — no changes there).
3. The `sendApptNotification` Cloud Function fires on doc create:
   - Sends the email as before.
   - In parallel, queries `userPushTokens` by tech email, batches Expo push messages, POSTs to `https://exp.host/--/api/v2/push/send`.
   - Strips `DeviceNotRegistered` tokens automatically so dead tokens don't pile up.
4. The phone shows a banner; tapping it deep-links to the relevant screen (`data.type` in the payload — wiring up the deep link is a Phase 2 polish item).
