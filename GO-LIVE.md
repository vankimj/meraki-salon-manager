# Go-Live Checklist — Meraki Salon Manager

Switching Meraki Nail Studio off GlossGenius and onto this app. Items grouped by when they need to be done. Check items off as you go.

---

## T-7 to T-3 days — Data migration

- [ ] **Import GG Clients CSV** (Admin → Settings → Import from GlossGenius). This is the missing piece for Top Clients / per-tech client counts.
- [ ] Run **Link GG receipts to clients** backfill. Re-run **Diagnose mismatches** afterward to verify residual no-match count is just walk-ins.
- [ ] Spot-check 5–10 imported receipts on Reports → Transactions: do dates, totals, techs, and client names match what you remember from GG?
- [ ] Verify **Top Clients** now shows real visit counts for known repeat clients.
- [ ] Decide what to do about the ~8,200 walk-in receipts (mostly OK to leave; flag if it bothers you).
- [ ] Decide whether to clear demo data — `_demo: true` records are tagged. Admin → Demo Data → "Clear Demo Data" if you want a clean slate.

## T-7 to T-3 days — Configuration

- [ ] Verify **Services** menu: every service active, prices/durations correct, categories right.
- [ ] Verify **Employees**: 10 techs, photos, contact info, `serviceIds` assigned (so each tech only books for what they actually do).
- [ ] **Store hours** — Calendar → 🕐 Hours toolbar button. Set realistic open/close + per-day variations.
- [ ] **Financial settings**: tax rate (7.5% Columbus), CC fee (Stripe 2.9% + $0.30), removal price.
- [ ] **Decide on tip policy**: "Disable tips on credit card" toggle on or off.
- [ ] **Online Booking** settings: enabled, lead time, cancellation policy, deposit, removal question text.
- [ ] **Tech assignment method**: confirmed `turnQueue` (Mango POS) is what you want.
- [ ] **Branding**: salon name, tagline, theme — verify on `/?web` (public site) and inside the app.

## T-7 days — Integrations

- [ ] **Resend** (staff notifications, daily reminders, receipts) — verify API key in Functions config, send test from a Cloud Function.
- [ ] **Stripe** — secrets configured, test mode → live keys swap, run a $1 charge through checkout to confirm.
- [ ] **Twilio** SMS — secrets configured if you want SMS campaigns / reminders. OK to defer if email-only.
- [ ] **Gusto** payroll — only needed when you actually run payroll through the app. Defer unless you're running a pay period imminently.
- [ ] **Google Review URL** in settings — check the review prompt fires after checkout.

## T-3 days — Staff prep

- [ ] All 10 techs have **user records** with the right role (`tech`, not `admin` or `pending`).
- [ ] Each tech has signed in once (Google or magic link) and lands on the right view.
- [ ] **HR / Reports PIN** set if you want those gated.
- [ ] **Employee handbook** assigned + acknowledged by each tech.
- [ ] **Compensation** info entered for payroll runs.
- [ ] 30-min walkthrough with the techs: how to start an appointment, check out a client, mark walk-ins, view their schedule.

## T-1 day — Dress rehearsal

- [ ] Run a full mock day on staging or with real `_demo` records: book a multi-service appointment online → confirm it lands on calendar correctly → check it in → check it out → see it on Reports.
- [ ] Confirm tip flow on the iPad kiosk works (TipFlow mode).
- [ ] Test a refund.
- [ ] Test cancellation + reschedule.
- [ ] Test the booking link from a phone (not just desktop) — that's where most customers will land.
- [ ] Daily reminder Cloud Function runs at the right time in the right TZ.
- [ ] Print a paper backup of tomorrow's appointments at end of day, in case the app is down.

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

---

## Riskiest items (test twice)

1. **Online booking → calendar**: a customer books 3 services with one tech; calendar grid shows one block at the right time on the right column with all 3 services visible.
2. **Multi-tech checkout** with tip split: an appt with two techs sharing services checks out cleanly and tip splits proportionally.
3. **GG receipt history → Reports**: spot-check that historical totals roughly match GG's own reports for the same date range. If they don't, something's wrong with the import (probably the createdAt or client linking).
4. **Stripe live charge** end-to-end: card → success → receipt email → matches Stripe dashboard.
5. **Daily reminder email** fires once and only once per day at the right time.

---

## Fallback plan if something breaks at launch

- [ ] **Roll back hosting**: `npm run rollback:prod` reverts the last promote. `npm run rollback:console` opens Firebase Console for picking a specific past release.
- [ ] **Re-enable GG online booking** if it stays bad — keep the GG account paid for ~30 days as a safety net.
- [ ] Keep your Firebase project console open in a tab on launch day so you can spot Function errors in real time.

---

## Automated test gate

`npm run deploy:staging` and `npm run deploy:prod` (and therefore `promote:staging`) now run `npm test` first. If any test fails, the deploy aborts before building or uploading anything. Run `npm test` locally any time to check.

`npm run deploy:prod:skip-tests` is available as an emergency escape hatch for unrelated-flaky-test situations only — don't use it to skip a real failure.
