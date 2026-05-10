# Architecture

Engineering reference for the Plume Nexus / Meraki Salon Manager stack as of 2026-05-10. This is a working document — update it when the architecture meaningfully changes. For per-module file maps and feature lists, see [`CLAUDE.md`](./CLAUDE.md).

---

## System overview

The stack splits into three layers — clients, our Firebase backend, and third-party services. The three diagrams below show each layer and its links to the others. GitHub's Mermaid renderer fits each diagram cleanly; for a single zoomable view of all three together, see the dedicated "Pretty" diagram (Eraser.io / Figma) when one exists.

### Layer 1 — Client surfaces → Firebase

```mermaid
graph LR
    subgraph Clients["Client surfaces"]
        direction TB
        WebPWA["Web PWA"]
        TipFlow["TipFlow kiosk"]
        Walkin["Walk-in kiosk"]
        Mobile["Native mobile<br/>(Expo SDK 54)"]
        Public["Public booking /<br/>check-in / manage /<br/>rsvp / unsubscribe"]
        PNSite["plumenexus.com<br/>marketing site"]
        PlatAdmin["platform-admin<br/>console"]
    end

    subgraph Firebase["Firebase project"]
        direction TB
        Auth["Firebase Auth"]
        Fstore[("Firestore<br/>tenants/{tid}")]
        Funcs["Cloud Functions v2<br/>(54 fns)"]
        Hosting["Hosting<br/>(3 targets)"]
    end

    WebPWA --> Auth & Fstore & Funcs
    Mobile --> Auth & Fstore & Funcs
    TipFlow & Walkin --> Fstore
    Public --> Funcs
    PNSite --> Funcs
    PlatAdmin --> Funcs
    Hosting --> WebPWA & PNSite & PlatAdmin

    classDef firebase fill:#FFA000,stroke:#FF6F00,color:#fff
    classDef client fill:#2D7A5F,stroke:#1e5240,color:#fff
    class Auth,Fstore,Funcs,Hosting firebase
    class WebPWA,TipFlow,Walkin,Mobile,Public,PNSite,PlatAdmin client
```

### Layer 2 — Cloud Functions → third-party services

```mermaid
graph LR
    Funcs["Cloud Functions v2"]

    subgraph Comms["Comms"]
        Twilio["Twilio<br/>SMS"]
        Resend["Resend<br/>email"]
        Expo["Expo Push<br/>(APNS + FCM)"]
    end

    subgraph Payments["Payments + payroll"]
        Stripe["Stripe<br/>POS · memberships"]
        Gusto["Gusto<br/>payroll · 1099s"]
    end

    subgraph AI["AI / Maps"]
        Anthropic["Anthropic<br/>chatbot · voice"]
        Google["Google Cloud<br/>Maps · OAuth"]
    end

    Funcs --> Twilio
    Funcs --> Resend
    Funcs --> Expo
    Funcs --> Stripe
    Funcs --> Gusto
    Funcs --> Anthropic
    Funcs --> Google

    Stripe -.->|webhook| Funcs
    Twilio -.->|inbound SMS| Funcs
    Gusto -.->|OAuth callback| Funcs

    classDef firebase fill:#FFA000,stroke:#FF6F00,color:#fff
    classDef external fill:#5b3b8c,stroke:#3d2660,color:#fff
    class Funcs firebase
    class Twilio,Resend,Expo,Stripe,Gusto,Anthropic,Google external
```

### Layer 3 — Edge + distribution

```mermaid
graph LR
    User(("User")) --> CF["Cloudflare Worker<br/>(URL / host rewrites)"]
    CF --> Hosting["Firebase Hosting<br/>(meraki / plumenexus / platform-admin)"]

    Dev["Mobile build pipeline<br/>(EAS Build)"] -.->|.app + .ipa| Apple["Apple App Store /<br/>TestFlight"]
    Apple --> Phone(("iPhone"))

    GH["GitHub<br/>(origin)"] -.->|CI hooks TBD| Dev

    classDef firebase fill:#FFA000,stroke:#FF6F00,color:#fff
    classDef external fill:#5b3b8c,stroke:#3d2660,color:#fff
    class Hosting firebase
    class CF,Apple,Dev,GH external
```

---

## Client surfaces

| Surface | Lives at | Purpose | Auth |
|---|---|---|---|
| **Web PWA** | `meraki-salon-manager.web.app` | Day-to-day admin + tech app | Google sign-in (Firebase Auth) |
| **TipFlow kiosk** | Same domain, kiosk view | Tip-suggestion display at front desk | None (kiosk mode) |
| **Walk-in kiosk** | Same domain | Walk-in waitlist on iPad | None (kiosk mode) |
| **Booking page** | `?book=1` | Public online booking | None |
| **Check-in screen** | `?checkin=<apptId>` | Public client self-check-in | Single-shot HMAC-validated update |
| **Manage appointment** | `?manage=<token>` | Client reschedule/cancel from email link | HMAC token (APPT_MANAGE_SECRET) |
| **RSVP** | `?rsvp=<token>` | Internal meeting RSVPs | UUID token (122 bits) |
| **Unsubscribe** | `?unsub=<token>` | Marketing opt-out | HMAC token (UNSUBSCRIBE_SECRET) |
| **Plume Nexus site** | `plumenexus.com` (target: `plumenexus`) | SaaS marketing + signup | None (public) |
| **Platform admin** | Target: `platform-admin` | Super-admin: list/manage all tenants | Bootstrap admin only |
| **Native mobile** | TestFlight / App Store (TBD) | Tech-facing app: schedule, earnings, clients, chat | Native Google Sign-In + Firebase |

---

## Backend

### Cloud Functions inventory (54 total)

Grouped by purpose:

| Category | Functions |
|---|---|
| **Auth + user lookup** | `getMyTenantRole`, `getTenantMetadata` |
| **Public booking + check-in** | `getPublicAvailability`, `getPublicAppointment`, `findOrCreateClient`, `manageAppointment`, `getApptManageLink` |
| **POS / Stripe** | `createPaymentIntent`, `createCheckoutSession`, `stripeWebhook`, `createMembershipCheckout`, `createMembershipPortal`, `emailMembershipPaymentLink`, `retryGiftCardEmail` |
| **Email (Resend)** | `sendApptNotification`, `sendDailyReminders`, `sendTechAppointmentReminders`, `sendReceiptEmail`, `sendReviewRequestEmail`, `sendReviewReceivedNotification`, `sendGiftCardEmail`, `sendChatNotification`, `sendBookingConfirmation`, `sendDirectEmail`, `emailEmployeeInvite`, `sendAccessRequestNotification` |
| **SMS (Twilio)** | `sendDirectSms`, `sendSMSCampaign`, Twilio inbound webhook (server-side route) |
| **Marketing** | `sendMarketingCampaign`, `runScheduledCampaigns`, `autoBirthdayCampaign`, `autoLapsedCampaign`, `chatWithMarketing`, `draftConflictMessages` |
| **AI (Anthropic)** | `chatWithReports`, `chatWithSalon`, `chatWithMarketing` (yes, two callables share AI for marketing context) |
| **Meetings / RSVP** | `sendMeetingInvites`, `sendMeetingReminders`, `recordMeetingResponse`, `fetchMeetingForRsvp` |
| **Gusto (payroll)** | `gustoGetAuthUrl`, `gustoOAuthCallback`, `gustoSyncEmployees`, `gustoSubmitPayroll`, `generateAnnual1099s` |
| **Tenant lifecycle** | `createTenantOnboarding`, `listTenants`, `refreshGoogleReviews` |
| **Triggers** | `notifyOnCheckIn` (Firestore onDocumentUpdated), `sendApptNotification` (notifications onCreate) |
| **Unsubscribe** | `processUnsubscribe` |

### Firestore data model (multi-tenant)

```
tenants/{tid}/                              ← Tenant root doc
  ├── data/
  │   ├── settings                          ← Per-tenant settings (staff-readable)
  │   ├── settingsPrivate                   ← Admin-only secrets (Gusto tokens, etc.)
  │   ├── users                             ← Slim role projection (staffEmails/adminEmails)
  │   ├── usersFull                         ← Rich users[] array (admin-only)
  │   └── slides                            ← TipFlow slides
  ├── services/{id}                         ← Service menu
  ├── clients/{id}                          ← Client profiles
  ├── employees/{id}                        ← Public employee data
  │   └── private/comp                      ← Admin-only: SSN, comp, banking
  ├── appointments/{id}                     ← Bookings
  ├── receipts/{id}                         ← POS transactions
  ├── chats/{clientId}                      ← Per-client message thread
  ├── notifications/{id}                    ← Email + push fan-out queue
  ├── userPushTokens/{uid}                  ← Expo push tokens, per user
  ├── giftCards/{id}                        ← Gift card balances
  ├── memberships/{id}                      ← Membership records
  ├── meetings/{id}                         ← Internal meeting docs
  ├── timeOff/{id}                          ← Vacation / sick / personal
  └── logs/{id}                             ← Activity audit log

_oauthNonces/{nonce}                        ← Gusto OAuth state pin (single-use, TTL'd)
```

### Hosting targets

| Target | Site | Source | URL |
|---|---|---|---|
| `meraki` | `meraki-salon-manager` | `dist/` (web app build) | `meraki-salon-manager.web.app` |
| `plumenexus` | `plumenexus` | `plumenexus/dist/` (marketing site) | `plumenexus.com` |
| `platform-admin` | Hostname TBD | `platform-admin/dist/` (super-admin console) | TBD |

Deploys via `firebase deploy --only hosting:meraki` etc. Staging via Firebase Hosting Channels (`deploy:staging` → `promote:staging`).

---

## Multi-tenant architecture

The single Firebase project (`meraki-salon-manager`) serves N tenants. Each tenant = one salon. The same SPA bundle is deployed once and serves all tenants; tenant identity is resolved at runtime from the request's hostname. Data isolation is enforced by Firestore security rules; cross-tenant operations go through the `requireTenantStaff` / `requireTenantAdmin` helpers and the `forEachActiveTenant` iterator.

### Tenant data isolation

Every business object lives under `tenants/{tid}/...`. Firestore rules block cross-tenant reads — a user authenticated as a staff member of tenant `meraki` cannot read tenant `demo`'s clients or appointments.

```mermaid
graph LR
    subgraph Root["Firestore root"]
        TenantsCol[("tenants/")]
        OauthNonces[("_oauthNonces/<br/>(Gusto state pins)")]
    end

    subgraph Meraki["tenants/meraki/"]
        direction TB
        M_data["data/<br/>settings · users · usersFull<br/>settingsPrivate · slides"]
        M_biz["clients · employees · appointments<br/>receipts · chats · notifications<br/>userPushTokens · giftCards · memberships<br/>meetings · timeOff · logs"]
    end

    subgraph Demo["tenants/demo/"]
        direction TB
        D_data["data/...<br/>(same shape)"]
        D_biz["clients · employees ...<br/>(same shape, isolated)"]
    end

    subgraph Future["tenants/{newSalon}/"]
        direction TB
        F_data["..."]
        F_biz["..."]
    end

    TenantsCol --> Meraki
    TenantsCol --> Demo
    TenantsCol --> Future

    classDef firebase fill:#FFA000,stroke:#FF6F00,color:#fff
    classDef tenant fill:#EBF4FB,stroke:#3D95CE,color:#1a5f8a
    class TenantsCol,OauthNonces firebase
    class M_data,M_biz,D_data,D_biz,F_data,F_biz tenant
```

### Request routing — how a subdomain becomes a tenant

Tenant resolution happens client-side in [`src/lib/tenant.js`](src/lib/tenant.js). Order of precedence:

1. `?tenant=<id>` query param (test override, persists in sessionStorage)
2. `import.meta.env.VITE_TENANT_ID` build-time env (staging only)
3. `window.location.hostname` subdomain match
4. Fallback to `'meraki'` (legacy default)

```mermaid
sequenceDiagram
    actor U as User
    participant DNS as DNS / Cloudflare
    participant CFW as Cloudflare Worker
    participant FH as Firebase Hosting
    participant SPA as SPA bundle
    participant TJS as tenant.js detectTenantId()
    participant FS as Firestore

    U->>DNS: meraki.plumenexus.com
    DNS->>CFW: route
    CFW->>FH: rewrite host → meraki-salon-manager.web.app
    FH-->>SPA: serve same bundle for all tenants
    SPA->>TJS: detectTenantId()
    Note over TJS: 1. ?tenant param?<br/>2. VITE_TENANT_ID env?<br/>3. hostname → "meraki"<br/>4. fallback "meraki"
    TJS-->>SPA: TENANT_ID = "meraki"
    SPA->>FS: getDoc(tenants/meraki/data/settings)
    Note over FS: Rules enforce<br/>isTenantStaff(meraki)<br/>before read
    FS-->>SPA: tenant data
```

### Per-tenant branding (dual-store)

Two stores; admin UI dual-writes so public surfaces and auth surfaces stay in sync. Eventual consolidation is open work.

| Store | Path | Audience | Holds |
|---|---|---|---|
| `data/settings` | `tenants/{tid}/data/settings` | Staff-only (rules-blocked pre-login) | `salonName`, `brandName`, `brandTagline` + everything else |
| `data/webfront` | `tenants/{tid}/data/webfront` | Public read | Branding (mirrored) + `address`, `phone`, `instagram`, `hours` |

**Resolution chain in client code:**

```
authenticated context: settings.salonName → webfront.salonName → "Plume Nexus"
public  context (booking, check-in, kiosk, splash):
                          webfront.salonName → tenant root doc .name → "Plume Nexus"
```

### Cross-tenant operations

Three categories of code legitimately traverse tenants. All use Admin SDK (bypasses Firestore rules) AND verify caller authorization in code.

```mermaid
graph TB
    subgraph Cron["Scheduled / cron jobs"]
        CronFn["sendDailyReminders<br/>autoBirthdayCampaign<br/>autoLapsedCampaign<br/>sendTechAppointmentReminders<br/>generateAnnual1099s (TODO)<br/>runScheduledCampaigns"]
        ForEach["forEachActiveTenant(label, cb, { skipPaused? })"]
        CronFn --> ForEach
        ForEach --> AllTenants[("for each tenant<br/>in tenants/*")]
    end

    subgraph Triggers["Doc triggers"]
        TrigFn["notifyOnCheckIn<br/>sendApptNotification<br/>... 9 total"]
        TrigPath["match path:<br/>tenants/{tenantId}/.../{id}<br/>→ event.params.tenantId"]
        TrigFn --> TrigPath
    end

    subgraph Callables["Callable functions"]
        CallFn["chatWithSalon<br/>chatWithReports<br/>createPaymentIntent<br/>createTenantOnboarding<br/>refreshGoogleReviews<br/>... 30+"]
        CallGate["validate tenantId regex<br/>requireTenantStaff/Admin(db, tid, request)"]
        CallFn --> CallGate
    end

    subgraph PlatAdmin["Platform admin console"]
        PA["listTenants callable<br/>(bootstrap admin only)"]
        PAList[("read across<br/>tenants/*")]
        PA --> PAList
    end

    classDef firebase fill:#FFA000,stroke:#FF6F00,color:#fff
    classDef rule fill:#fef3c7,stroke:#92400e,color:#92400e
    class CronFn,TrigFn,CallFn,PA,AllTenants,TrigPath,PAList firebase
    class ForEach,CallGate rule
```

### Tenant lifecycle — signup to active

```mermaid
sequenceDiagram
    actor U as New owner
    participant PN as plumenexus.com
    participant CF as createTenantOnboarding<br/>Cloud Function
    participant FS as Firestore
    participant FA as Firebase Auth<br/>(magic link)
    participant R as Resend
    participant App as Web app at<br/>{newSalon}.plumenexus.com

    U->>PN: signs up (salon name, email, plan)
    PN->>CF: createTenantOnboarding(name, email, slug)
    CF->>CF: rate-limit + validate slug<br/>(reserved-subdomain check)
    CF->>FS: create tenants/{slug}<br/>root doc (ownerEmail, name, fromAddress)
    CF->>FS: seed data/settings + data/webfront<br/>+ data/users (slim) + data/usersFull (rich)
    CF->>FS: seed employees (if onboarding form provided any)
    CF->>R: send magic-link sign-in email to owner
    R-->>U: receives invite
    U->>FA: clicks link → magic-link sign-in
    FA-->>U: authenticated session
    U->>App: redirected to {newSalon}.plumenexus.com
    Note over App,FA: tenant.js detects subdomain → TENANT_ID = slug<br/>Now isTenantStaff(slug) === true → reads succeed
    Note over CF,App: Manual blocker today: Firebase Auth<br/>authorized-domains list needs each subdomain<br/>added in console — no wildcards.
```

### Tenant identity matrix

Quick reference for "where is tenant id known and how":

| Layer | Where tenant comes from | Notes |
|---|---|---|
| **Web bundle** (browser) | `detectTenantId()` — query param > env > hostname | Pinned at first call; cached in `TENANT_ID` const |
| **Cloud Function callable** | `request.data.tenantId` (client-supplied) | Server validates format + calls `requireTenantStaff/Admin` |
| **Cloud Function trigger** | `event.params.tenantId` from path wildcard | Implicit — Firestore path encodes it |
| **Cron job** | Iterates `tenants/*` via `forEachActiveTenant` | Skips `active: false`, optionally skips paused tenants |
| **Mobile app** | Hardcoded `'meraki'` in `mobile/src/lib/firebase.js` | Single-tenant for now; mobile multi-tenant is future work |

### Multi-tenant gotchas

See [`reference_firebase_quirks.md`](memory) for the full list. Summary:

- **Auth domains aren't wildcardable.** Each tenant subdomain must be added to Firebase Auth → Settings → Authorized domains manually. Plan to automate inside `createTenantOnboarding` (TODO).
- **Cloudflare proxy can break Firebase SSL.** Plumenexus subdomains must be DNS-only (gray cloud), not proxied — otherwise SSL handshake fails on Firebase's side.
- **Tenant root doc must exist for cron fan-out.** Meraki's `tenants/meraki` doc was missing for ~24hr because the schema predated SaaS; scheduled functions silently no-op'd. New tenants via `createTenantOnboarding` get the doc; legacy tenants need `scripts/set-meraki-from-address.cjs` style backfill.
- **`SalonWebfront.jsx` is still Meraki-templated.** Tenant #2 needs a refactor pass before they can use the public booking surface.

---

## Third-party integrations

| Provider | Purpose | Where wired | Env vars / secrets | Account owner |
|---|---|---|---|---|
| **Stripe** | POS PaymentIntents · subscriptions · webhooks | `createPaymentIntent`, `createMembershipCheckout`, `stripeWebhook` | `STRIPE_SECRET_KEY` (secret), `STRIPE_WEBHOOK_SECRET` (secret), `STRIPE_PRO_PRICE_ID`, `STRIPE_STARTER_PRICE_ID` | Jonathan |
| **Twilio** | SMS send + inbound webhook | `sendDirectSms`, `sendSMSCampaign`, `twilioInboundSms` | `TWILIO_AUTH_TOKEN` (secret), `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_FROM` | Jonathan |
| **Resend** | All transactional email | All `send*Email` functions | `RESEND_API_KEY` | Jonathan |
| **Gusto** | Payroll OAuth + submit + 1099s | `gustoOAuthCallback`, `gustoSubmitPayroll`, etc. | `GUSTO_CLIENT_ID`, `GUSTO_CLIENT_SECRET`, `GUSTO_REDIRECT_URI` | Jonathan |
| **Anthropic** | Reports chatbot · voice command parsing | `chatWithReports`, `chatWithSalon`, `chatWithMarketing`, `voiceCommand` | `ANTHROPIC_API_KEY` (secret) | Jonathan |
| **Google Cloud** | OAuth (web + iOS clients) · Maps API · Firebase | Firebase Console + Cloud Console | `GOOGLE_MAPS_API_KEY`, OAuth client IDs in mobile app source | Jonathan |
| **Expo / EAS** | Mobile build pipeline · push fan-out | `mobile/`, `sendApptNotification` (push fan-out) | EAS project ID in `mobile/app.json` | Jonathan (`@jvankim`) |
| **Apple Developer** | App Store distribution | EAS Build signing | Pending verification as of 2026-05-10 | Jonathan |
| **Cloudflare Worker** | URL / host rewrites | `cloudflare/worker.js`, deployed via `wrangler` | Cloudflare account creds | Jonathan |
| **GitHub** | Origin · code hosting | `vankimj/Meraki-Salon-Manager` | — | Jonathan |
| **GlossGenius** | CSV importer (one-way) | Admin → Import from GlossGenius | None (manual CSV) | — |
| **ngrok** | Dev tunnel for Expo only | `mobile/` dev | Local install only | — |

---

## Data flow walkthroughs

### 1. Online booking → confirmation → reminder

```mermaid
sequenceDiagram
    actor C as Client
    participant WP as Web (booking page)
    participant CF as Cloud Functions
    participant FS as Firestore
    participant R as Resend
    participant T as Twilio

    C->>WP: opens ?book=1
    WP->>CF: getPublicAvailability(tenantId, date)
    CF->>FS: read appointments + employees
    FS-->>CF: busy slots + tech list
    CF-->>WP: minimal slice (no PII)
    C->>WP: picks slot, fills form, submits
    WP->>CF: findOrCreateClient(...)
    CF->>FS: write/match clients/{id}
    WP->>FS: create appointments/{id} (public-write allowed)
    FS->>CF: notifications/{id} created (trigger fan-out)
    CF->>CF: sendApptNotification (email + push)
    CF->>R: send confirmation email to client
    CF->>R: send notification email to assigned tech
    Note over CF,T: ~24hr before appt, sendDailyReminders cron fires
    CF->>R: send reminder email
    CF->>T: send reminder SMS (if opted in)
```

### 2. Tech checks in client → tech notification (push + email)

```mermaid
sequenceDiagram
    actor T as Tech
    participant M as Mobile app
    participant FS as Firestore
    participant CF as Cloud Functions
    participant R as Resend
    participant E as Expo Push
    participant D as Tech device

    T->>M: taps "Mark client checked-in"
    M->>FS: update appointments/{id}.checkedInAt = now
    FS->>CF: notifyOnCheckIn trigger fires (onDocumentUpdated)
    CF->>FS: create notifications/{id} (changeType: 'client_checkin')
    FS->>CF: sendApptNotification trigger fires (onDocumentCreated)
    CF->>FS: look up employee by techName → email
    CF->>R: send email to tech
    CF->>FS: query userPushTokens where email matches
    FS-->>CF: token list
    CF->>E: POST exp.host/--/api/v2/push/send with batch
    E->>D: deliver push to all of tech's devices
    Note over E,CF: DeviceNotRegistered tokens auto-pruned
```

### 3. POS checkout → receipt → payroll

```mermaid
sequenceDiagram
    actor S as Staff
    participant W as Web (CheckoutModal)
    participant CF as Cloud Functions
    participant Stp as Stripe
    participant FS as Firestore
    participant R as Resend
    participant G as Gusto

    S->>W: opens checkout modal
    S->>W: fills cart, picks payment method
    alt Card payment
        W->>CF: createPaymentIntent(tenantId, amount)
        CF->>Stp: PaymentIntent.create()
        Stp-->>CF: clientSecret
        CF-->>W: clientSecret
        W->>Stp: confirmCardPayment (Elements)
        Stp-->>W: success
        Stp->>CF: webhook: payment_intent.succeeded
        CF->>FS: stamp receipt as paid
    end
    W->>FS: create receipts/{id} with techSplit, services, tips
    W->>CF: sendReceiptEmail (if client opted in)
    CF->>R: email receipt to client
    Note over FS,G: Later, on payroll-run day
    S->>CF: gustoSubmitPayroll(tenantId, periodStart, periodEnd)
    CF->>FS: query receipts in range, group by tech, sum
    CF->>G: POST payroll run with hours + comp
    G-->>CF: payroll confirmation
```

### 4. Marketing campaign — SMS send

```mermaid
sequenceDiagram
    actor A as Admin
    participant W as Web (Marketing)
    participant CF as Cloud Functions
    participant FS as Firestore
    participant T as Twilio

    A->>W: composes campaign, picks audience
    A->>W: clicks Send
    W->>CF: sendSMSCampaign(tenantId, audienceFilter, body)
    CF->>FS: requireTenantAdmin (server-side authz)
    CF->>FS: query clients matching audience filter
    CF->>FS: filter out marketingOptOut clients
    loop For each client
        CF->>FS: append unsubscribe link to body (HMAC-signed)
        CF->>T: messages.create(to, body)
        T-->>CF: deliveredAt or error
        CF->>FS: log send to campaigns/{id}/sent/{clientId}
    end
    Note over T,CF: Client replies STOP → Twilio inbound webhook → CF marks marketingOptOut
```

### 5. New tenant onboarding (SaaS signup)

```mermaid
sequenceDiagram
    actor U as New owner
    participant PN as Plume Nexus site
    participant CF as Cloud Functions
    participant FS as Firestore
    participant FA as Firebase Auth
    participant R as Resend

    U->>PN: completes signup form (salon name, email, plan)
    PN->>CF: createTenantOnboarding(name, email, slug)
    CF->>CF: rate-limit + validate slug
    CF->>FS: create tenants/{newTid} root doc
    CF->>FS: seed data/settings, data/users, etc.
    CF->>FS: create employees seed if any
    CF->>R: email invite to new owner
    R-->>U: receives invite with magic-link sign-in
    U->>FA: clicks link → Firebase magic-link sign-in
    FA-->>U: authenticated
    U->>PN: redirected to web app, signed in as bootstrap admin of newTid
```

---

## Secrets & environment

### Stored in Cloud Secret Manager (defineSecret)

These are NEVER plaintext in `.env` — overlap with secret env vars would fail deploy. Set via:

```bash
firebase functions:secrets:set <NAME>
```

| Name | Used by |
|---|---|
| `UNSUBSCRIBE_SECRET` | HMAC-sign + verify unsubscribe links |
| `APPT_MANAGE_SECRET` | HMAC-sign + verify appointment-manage links |
| `STRIPE_SECRET_KEY` | All Stripe API calls |
| `STRIPE_WEBHOOK_SECRET` | Verify Stripe webhook signatures |
| `TWILIO_AUTH_TOKEN` | Twilio API auth + signature-verify inbound webhook |
| `ANTHROPIC_API_KEY` | Reports chatbot, voice command, marketing AI |

### Stored in `functions/.env` (defineString — non-secret config)

| Name | Used for |
|---|---|
| `RESEND_API_KEY` | Resend API auth (worth promoting to defineSecret eventually) |
| `RESEND_FROM` | Default sender; overridden per-tenant via `data/settings.fromAddress` |
| `GOOGLE_MAPS_API_KEY` | Address autocomplete in client/employee forms |
| `PUBLIC_APP_URL` | Default unsubscribe + manage-appt link base |
| `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_FROM` | Twilio config |
| `STRIPE_PRO_PRICE_ID`, `STRIPE_STARTER_PRICE_ID` | Stripe pricing for self-service signup |
| `GUSTO_CLIENT_ID`, `GUSTO_CLIENT_SECRET`, `GUSTO_REDIRECT_URI` | Gusto OAuth |

---

## Failure modes

What breaks when each integration is down, and what the user sees:

| Provider down | Visible impact | Mitigation in place |
|---|---|---|
| **Firebase Auth** | Nobody can sign in | None — Firebase Auth uptime is Google's SLA |
| **Firestore** | Entire app broken — nothing loads | None |
| **Cloud Functions** | Callables fail; emails/SMS queue but don't fire | Firestore writes (notifications/{id}) buffer until functions return |
| **Stripe** | POS card payments fail; cash/check still work | Cash fallback always available |
| **Twilio** | SMS fails (campaigns + reminders); email reminders still go | Email reminders are primary channel |
| **Resend** | Email fails (receipts + reminders + notifications) | Notifications doc stays unsent for retry; admin sees `error` field |
| **Gusto** | Payroll submit fails | Admin reverts to running payroll manually in Gusto's own UI |
| **Anthropic** | Reports chatbot returns "AI unavailable"; voice command falls back to manual entry | Non-AI Reports still work; voice is optional |
| **Expo Push** | Mobile alerts don't deliver; email notifications still go | Email is primary, push is secondary |
| **Cloudflare Worker** | Some URL/host rewrites fail | Plume Nexus marketing site uses direct Firebase Hosting |
| **GlossGenius** | (only matters during one-time migration) | Manual CSV re-export |

---

## Deploy targets reference

| Action | Command |
|---|---|
| Web staging | `npm run deploy:staging` |
| Web production | `npm run promote:staging` (re-builds, doesn't clone — required) |
| Single function | `firebase deploy --only functions:<fnName>` |
| All functions | `firebase deploy --only functions` |
| Firestore rules | `firebase deploy --only firestore:rules` |
| Hosting target | `firebase deploy --only hosting:<target>` |
| Plume Nexus site | `firebase deploy --only hosting:plumenexus` |
| Platform admin | `firebase deploy --only hosting:platform-admin` |
| Mobile dev client | `cd mobile && eas build --profile development --platform ios` |
| Mobile sim build | `cd mobile && eas build --profile development-simulator --platform ios` |
| Mobile production | `cd mobile && eas build --profile production --platform ios` |
| Mobile App Store submit | `cd mobile && eas submit --platform ios` |
| Cloudflare Worker | `cd cloudflare && wrangler deploy` |

---

## Versioning

This doc is checked into `main`. Update it when:

- A new third-party integration is added or removed
- The Firestore tenant model gets a new root collection
- A new hosting target is created
- The deploy workflow changes
- A new failure mode is discovered (with mitigation)

Last updated: 2026-05-10.
