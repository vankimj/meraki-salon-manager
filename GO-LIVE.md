# Go-Live Checklist — Meraki Salon Manager

Switching Meraki Nail Studio off GlossGenius and onto this app. Items grouped by when they need to be done. Check items off as you go.

---

## T-7 to T-3 days — Data migration

- [x] **Import GG Clients CSV** (Admin → Settings → Import from GlossGenius). This is the missing piece for Top Clients / per-tech client counts.
- [x] Run **Link GG receipts to clients** backfill. Re-run **Diagnose mismatches** afterward to verify residual no-match count is just walk-ins.
- [ ] Spot-check 5–10 imported receipts on Reports → Transactions: do dates, totals, techs, and client names match what you remember from GG?
- [ ] Verify **Top Clients** now shows real visit counts for known repeat clients.
- [ ] Decide what to do about the ~8,200 walk-in receipts (mostly OK to leave; flag if it bothers you).
- [x] Decide whether to clear demo data — `_demo: true` records are tagged. Admin → Demo Data → "Clear Demo Data" if you want a clean slate.

## T-7 to T-3 days — Configuration

- [ ] Verify **Services** menu: every service active, prices/durations correct, categories right.
- [ ] Verify **Employees**: 10 techs, photos, contact info, `serviceIds` assigned (so each tech only books for what they actually do).
- [x] **Store hours** — Calendar → 🕐 Hours toolbar button. Set realistic open/close + per-day variations.
- [x] **Financial settings**: tax rate (7.5% Columbus), CC fee (Stripe 2.9% + $0.30), removal price.
- [ ] **Decide on tip policy**: "Disable tips on credit card" toggle on or off.
- [ ] **Online Booking** settings: enabled, lead time, cancellation policy, deposit, removal question text.
- [ ] **Tech assignment method**: confirmed `turnQueue` (Mango POS) is what you want.
- [ ] **Branding**: salon name, tagline, theme — verify on `/?web` (public site) and inside the app.

## T-7 to T-3 days — Customer-data defense-in-depth (LAUNCH-BLOCKING)

**Principle:** losing customer data is unacceptable. The 2026-05-10 Meraki users incident (`data/usersFull` went silently missing for ~24h while `staffEmails` survived) was a near-miss with our own admin data — the same shape of failure on `clients`, `appointments`, or `receipts` would mean lost client history, lost revenue records, or lost tax data. Every item below is launch-blocking.

- [ ] **Audit every multi-doc write for atomicity.** Grep `src/lib/firestore.js` and `functions/index.js` for `Promise.all([` followed by `setDoc`/`updateDoc`/`addDoc` calls. Each one is a partial-failure window. Convert to `writeBatch().commit()` or document why it's safe to be non-atomic. Already converted: `saveUsers`, `saveEmployee`, `createEmployee`, `ensureStaffEmailsBackfill` (see commit 1d02b36 + memory file `feedback_writebatch_for_split_writes.md`).
- [ ] **Audit every hard delete.** Grep for `deleteDoc(` outside the `_demo: true` cleanup paths. Anything touching `clients/`, `appointments/`, `receipts/`, `memberships/`, `giftCards/` should be soft-delete (`_deleted: true, _deletedAt, _deletedBy`) with a separate cleanup job for ≥30-day-old tombstones. Hard delete = unrecoverable.
- [ ] **Test the heal path under fault injection.** Manually delete `tenants/meraki/data/usersFull` from Firebase Console → sign in as admin → confirm `healUsersFullIfMissing` rebuilds the rich array on next load (look for `[healUsersFullIfMissing] rebuilt …` in console). If the heal doesn't fire, ship is blocked.
- [x] **Firestore Point-in-Time Recovery (PITR) enabled** — 7-day window, restore to any past microsecond. Enabled 2026-05-10 on `meraki-salon-manager` `(default)` db. Verify: `gcloud firestore databases describe --database='(default)' --project=meraki-salon-manager --format='value(pointInTimeRecoveryEnablement)'` should print `POINT_IN_TIME_RECOVERY_ENABLED`. Also enable on `plumenexus` project before that goes live.
- [ ] **BigQuery streaming export installed** for the 4 customer-data-risk collections (`clients`, `appointments`, `receipts`, `employees`) via `firebase ext:install firebase/firestore-bigquery-export`. Gives forever-history append-only forensic log: "show me everything that happened to client X in the last hour." Complements PITR (which is 7-day-window in-database recovery).
- [ ] **BigQuery backfill run** for each of the 4 collections via `npx @firebaseextensions/fs-bq-import-collection` so existing history is in BQ, not just changes-from-install-forward.
- [ ] **Daily Firestore snapshots → GCS bucket** with ≥30-day retention (separate from PITR — covers the >7-day window). Console: Firestore → Backups → Schedule. ~$0.30/month at current data volume.
- [ ] **Recovery drill: pick one collection (e.g. `clients`) and restore yesterday's snapshot to a side database.** Verify the restore actually works end-to-end before launch — untested backups don't count as backups. Use PITR for recent, daily snapshot for older.
- [ ] **Surface integrity invariants in Admin → Settings.** Build (or stub for now) a nightly scanner that reads `tenants/{id}/data/integrityReport` and shows a green/yellow/red badge: receipts ↔ appointments link rate, appointments ↔ clients link rate (non-walk-in), employees ↔ comp doc presence, users staffEmails ↔ usersFull match. Silent corruption must become visible.
- [ ] **Document the restore script pattern** for one-off recoveries. `scripts/restore-meraki-users.cjs` (gitignored, kept local) is the template — read both sides, union the surviving signal with canonical mappings, write back atomically with `_healed: true` markers per row.
- [ ] **Add a recovery runbook** to `ARCHITECTURE.md`: who to call if data is missing, where the backups live, how to invoke the restore scripts, expected RTO. Without a runbook, panic costs hours.

## T-7 days — Integrations

- [ ] **Resend** (staff notifications, daily reminders, receipts) — verify API key in Functions config, send test from a Cloud Function.
- [ ] **Stripe** — secrets configured, test mode → live keys swap, run a $1 charge through checkout to confirm.
- [ ] **Twilio** SMS — secrets configured if you want SMS campaigns / reminders. OK to defer if email-only.
- [ ] **Gusto** payroll — only needed when you actually run payroll through the app. Defer unless you're running a pay period imminently.
- [ ] **Google Review URL** in settings — check the review prompt fires after checkout.

## T-3 days — Staff prep

- [x] All 10 techs have **user records** with the right role (`tech`, not `admin` or `pending`).
- [x] Each tech has signed in once (Google or magic link) and lands on the right view.
- [ ] **HR / Reports PIN** set if you want those gated.
- [ ] **Employee handbook** assigned + acknowledged by each tech.
- [ ] **Compensation** info entered for payroll runs.
- [ ] 30-min walkthrough with the techs: how to start an appointment, check out a client, mark walk-ins, view their schedule.

## T-3 days — Marketing & Compliance

### Email setup
- [ ] **Domain verification:** confirm sender domain (e.g. `merakinailstudio.com`) is verified in Resend Console → Domains. All four DNS records green.
- [ ] **Resend `RESEND_FROM`** in `functions/.env` matches the verified domain (not `vankim.me` or `onboarding@resend.dev`).
- [ ] **Send a test email campaign** to yourself via Test subjects audience. Confirm: lands in inbox (not spam), branded card renders, `{firstName}` and subject-line `{firstName}` substitute correctly.
- [ ] **Click the Unsubscribe link** in the test email → land on green confirmation page. Verify the client profile shows 🔕 with `marketingOptOutVia: email_unsubscribe_link`.
- [ ] **Re-send to that audience** — opted-out client should be excluded automatically; recipient count drops by one.

### SMS setup
- [ ] **Twilio domain status:** A2P 10DLC registration approved OR Toll-Free Verified — without this, US carriers throttle/drop messages. Check Twilio Console → Messaging → Regulatory Compliance.
- [ ] **Twilio Advanced Opt-Out** (Console → Messaging → Services → Settings) is **enabled**. Without this Twilio doesn't auto-handle STOP and your account can be flagged.
- [ ] **Twilio creds** in `functions/.env` (TWILIO_ACCOUNT_SID = AC..., either AUTH_TOKEN or API_KEY_SID + secret) and `TWILIO_FROM` is your purchased number.
- [ ] **Send a test SMS campaign** to yourself via Test subjects audience. Confirm: arrives within ~5s, `{firstName}` and `{bookingLink}` substituted, the link actually opens the booking screen.
- [ ] **Reply STOP** from your phone → next campaign should auto-flag your client record (`marketingOptOutVia: sms_stop_keyword_code_21610`) and exclude you.

### Personalized promos (if you plan to use them)
- [ ] Send a campaign with **Personalized promo per recipient** toggle on. Verify: each recipient receives a unique code in `{promoCode}`. Visit Admin → Gift Cards & Promos → confirm one code per recipient was created with the right discount + expiry + clientId binding.
- [ ] At checkout, attempt to redeem someone else's personalized code (use a code that belongs to a different client) → should reject with **"reserved for a different client"**.

### Marketing audience hygiene
- [ ] Confirm **opted-out clients are excluded** from every audience: send a campaign to "All clients" and verify the recipient count = (clients with valid contact) − (clients with `marketingOptOut: true`).
- [ ] Spot-check 3 random clients' profiles to confirm the opt-out state is visible and accurate.
- [ ] **GO-LIVE announcement template** drafted, saved, and previewed for both email + SMS channels.

### Legal pages
- [x] **Terms of Service** page published at `/?terms=1` and linked from webfront footer + every marketing email footer.
- [x] **Privacy Policy** page published at `/?privacy=1` and linked from webfront footer + every marketing email footer.
- [ ] **Have an attorney review** the Terms + Privacy templates before launch (especially: cancellation/no-show clause, refund policy, CCPA section). Templates are reasonable but not legal advice.
- [ ] Update the salon contact email in the policies if `merakinailstudiocolumbus@gmail.com` isn't the right one.

## T-1 day — Dress rehearsal

- [ ] Run a full mock day on staging or with real `_demo` records: book a multi-service appointment online → confirm it lands on calendar correctly → check it in → check it out → see it on Reports.
- [ ] Confirm tip flow on the iPad kiosk works (TipFlow mode).
- [ ] Test a refund.
- [ ] Test cancellation + reschedule.
- [ ] Test the booking link from a phone (not just desktop) — that's where most customers will land.
- [ ] Daily reminder Cloud Function runs at the right time in the right TZ.
- [ ] Print a paper backup of tomorrow's appointments at end of day, in case the app is down.

### Marketing dress rehearsal
- [ ] **Schedule a campaign** for 5 minutes from now (Test subjects audience) and confirm it fires automatically within the minute via the runScheduledCampaigns sweep.
- [ ] **Cancel a campaign mid-send** (queue 5+ test recipients to a verified-only setup so some succeed, some queue): click ⏹ Cancel → verify status flips to CANCELLED within 2s and the activity log shows partial completion.
- [ ] **Retry-failed flow**: produce a campaign with at least 1 failed delivery (e.g. unverified Twilio recipient on trial) → click 🔄 Retry → confirm new campaign sends only to the failed recipient(s) with `retryOf` reference to original.
- [ ] **Mass-send confirmation prompt** appears for any audience >10 recipients (sanity-test with All clients audience without sending).

## Launch day (T-0)

- [ ] **Cut-over moment**: when do you stop taking new bookings on GG and start on Meraki Salon Manager? Pick a clean break (e.g., end of business Saturday → Sunday morning live).
- [ ] **GG**: turn off online booking on GlossGenius so customers can't book on the dead system.
- [ ] **Public booking link**: replace any GG booking link in your Instagram bio, website, Google profile, Yelp, signage, business cards-in-progress.
- [ ] **Email blast** to existing clients: "We've moved to a new booking system, book here: [link]." Include a screenshot.
- [ ] **In-salon signage**: small QR code at the reception desk linking to the booking page.
- [ ] **First booking**: make one yourself, beginning to end, through the public link.
- [ ] **Watch the inbox** for staff/customer confusion — be on call all day.

## T+1 to T+7 — Post-launch monitoring

- [ ] Daily check on **Reports → Overview**: revenue and walk-in counts look sane vs. yesterday's reality.
- [ ] **Activity log** review: any unexpected errors, deletions, or auth issues?
- [ ] **Feedback** tab in Admin: bugs / ideas submitted by staff or clients.
- [ ] Review **schedule conflicts** — anything that looks wrong on the calendar grid (double-bookings, missing techs, wrong durations).
- [ ] **Cancellation rate / no-show rate** — calibrate vs. GG baseline.
- [ ] **Receipt sample**: pick 5 random checkouts each day and verify totals, tax, tip, fee, and CC processing fee all reconcile to your Stripe dashboard.
- [ ] Track unresolved bugs in the open-bugs list and prioritize for the first patch cycle.

### Marketing post-launch
- [ ] **Unsubscribe activity**: every couple days, scan Clients for new `marketingOptOut: true` records — abnormally high opt-out rates signal a bad campaign (subject too clickbait, too-frequent sends, etc.).
- [ ] **Twilio cost monitor**: Twilio Console → Usage → SMS. Real cost should track ~$0.0079 × segments × recipients. Spikes could indicate retry loops or unintended re-sends.
- [ ] **Resend deliverability**: Resend Dashboard → Logs. Watch for bounces, complaints, blocks. >2% bounce rate is a red flag — clean stale email addresses.
- [ ] **Campaign delivery rates**: every campaign's activity log should show <5% failed for a healthy domain. Higher → check A2P/TFN status, opt-out clean-up, recipient list quality.

---

## Riskiest items (test twice)

1. **Online booking → calendar**: a customer books 3 services with one tech; calendar grid shows one block at the right time on the right column with all 3 services visible.
2. **Multi-tech checkout** with tip split: an appt with two techs sharing services checks out cleanly and tip splits proportionally.
3. **GG receipt history → Reports**: spot-check that historical totals roughly match GG's own reports for the same date range. If they don't, something's wrong with the import (probably the createdAt or client linking).
4. **Stripe live charge** end-to-end: card → success → receipt email → matches Stripe dashboard.
5. **Daily reminder email** fires once and only once per day at the right time.
6. **Marketing audience opt-out**: the recipient count must drop by exactly 1 immediately after a client unsubscribes (via either link click or STOP keyword). Test this twice with two separate test clients — one via email link, one via SMS STOP — before any real blast.
7. **Personalized promo isolation**: try redeeming a personalized code as the wrong client at checkout. Must reject with "reserved for a different client" — never silently accept.

---

## Fallback plan if something breaks at launch

- [ ] **Roll back hosting**: `npm run rollback:prod` reverts the last promote. `npm run rollback:console` opens Firebase Console for picking a specific past release.
- [ ] **Re-enable GG online booking** if it stays bad — keep the GG account paid for ~30 days as a safety net.
- [ ] Keep your Firebase project console open in a tab on launch day so you can spot Function errors in real time.

---

## Automated test gate

`npm run deploy:staging` and `npm run deploy:prod` (and therefore `promote:staging`) now run `npm test` first. If any test fails, the deploy aborts before building or uploading anything. Run `npm test` locally any time to check.

`npm run deploy:prod:skip-tests` is available as an emergency escape hatch for unrelated-flaky-test situations only — don't use it to skip a real failure.
