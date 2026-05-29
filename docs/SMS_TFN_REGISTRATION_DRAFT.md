# Twilio Toll-Free Verification — Draft Submission

Paste-ready content for the Plume Nexus shared TFN: **(855) 957-4235**.

Submit this when the **Toll-free registration** step unlocks in Twilio Console (gated on the Plume Nexus LLC business compliance profile finishing review).

---

## Decision: SaaS TFN model

**All TFNs are registered to Plume Nexus LLC** under a single multi-tenant A2P brand. "Dedicated TFN" for a Pro-tier tenant is a *routing* feature, not a *legal-entity* feature. This is the same model GlossGenius uses.

- Trial / Starter tier → shared TFN (this one), salon-name prefix in every message
- Studio / Pro tier → dedicated TFN (also Plume-Nexus-verified, but routed exclusively to one tenant), salon-name prefix still recommended for consistency
- Onboarding new tenants → minutes, not weeks; no per-tenant TrustHub paperwork

Tradeoff vs. tenant-verified TFNs: salon doesn't legally own the number; if they leave Plume Nexus, the number stays. Acceptable for our positioning.

---

## Use case category

**Mixed** (most accurate). If split: **Account Notification** primary, **Marketing** secondary (for birthday/promo messages).

## Business / Use case description

> Plume Nexus is a SaaS salon-management platform (plumenexus.com) used by independent beauty and wellness businesses to run their daily operations. End-clients of these businesses receive SMS messages related to appointments they have booked: confirmations, reminders, reschedules, cancellations, and post-visit follow-ups. Every message is sent on behalf of a specific business customer of Plume Nexus and identifies the originating business by name in the first words of the message body (e.g., "Sparkle Nails: Reminder for your appointment tomorrow at 2pm. Reply STOP to opt out."). Plume Nexus LLC is the operator of the messaging infrastructure; the named businesses are the originators of each individual conversation. Recipients are clients of these businesses who have provided their phone number and consented to appointment-related SMS at the time of booking, either through the business's intake form or through Plume Nexus's hosted consent page at plumenexus.com/sms-consent. Opt-out via STOP, UNSUBSCRIBE, or QUIT is honored immediately and applied per-business; HELP returns business-identifying information and support contact.

## How do end-users consent to receive messages?

> End-users consent by providing their phone number to a Plume Nexus business customer at the time of booking an appointment, either (a) in person at the business's front desk, (b) via the business's online booking form, or (c) via the hosted consent flow at https://plumenexus.com/sms-consent which discloses message frequency, message-and-data-rate notice, STOP/HELP keywords, and links to the privacy policy and terms of service. Consent is recorded per-business and stored with timestamp, source, and policy version.

## Opt-in image / URL

- URL: `https://plumenexus.com/sms-consent`
- Also upload a screenshot of the page when prompted.

## Sample messages

1. **Booking confirmation**
   `Meraki Nail Studio: Your appointment with Yasmin is booked for Sat Mar 14 at 2:00 PM. Reply STOP to opt out, HELP for help. Msg&data rates may apply.`

2. **Reminder, day-before**
   `Sparkle Nails: Reminder — your appointment with Tess is tomorrow at 10:30 AM. Reply C to confirm, R to reschedule, STOP to opt out.`

3. **Same-day reminder**
   `Meraki Nail Studio: See you in 2 hours! Your 2:00 PM appointment with Yasmin is confirmed. Address: 123 Main St. Reply STOP to opt out.`

4. **Reschedule confirmation**
   `Sparkle Nails: Your appointment has been rescheduled to Thu Mar 19 at 11:00 AM with Audriana. Reply STOP to opt out.`

5. **Cancellation confirmation**
   `Meraki Nail Studio: Your appointment on Sat Mar 14 at 2:00 PM has been canceled. We hope to see you soon. Reply STOP to opt out.`

6. **Post-visit thank-you**
   `Sparkle Nails: Thanks for visiting today, Sarah! We'd love your feedback: https://plumenexus.com/r/abc123. Reply STOP to opt out.`

7. **Birthday / promotional**
   `Meraki Nail Studio: Happy birthday, Jamie! Enjoy 15% off any service this month. Book: https://meraki.plumenexus.com. Reply STOP to opt out.`

8. **Two-way confirmation reply**
   `Sparkle Nails: Got it — your appointment for Sat Mar 14 at 2:00 PM is confirmed. See you then! Reply STOP to opt out.`

## Volume estimate

- Messages per day: **50–500** (pre-prod / Meraki only — revise upward as tenants onboard)
- Messages per month: **1,500–15,000**

## Help & opt-out keyword responses

- **STOP / UNSUBSCRIBE / QUIT** → `You've been unsubscribed from [Business Name]. You will receive no more messages. Reply START to resubscribe.`
- **HELP / INFO** → `[Business Name] — appointment reminders sent via Plume Nexus. Support: support@plumenexus.com. Reply STOP to opt out.`

## Privacy policy URL

`https://plumenexus.com/privacy` — must explicitly mention SMS data handling. Verify before submission.

---

## Submission tips

- Use **Meraki Nail Studio** in 2–3 sample messages — having a real operating customer reads well to reviewers.
- Keep promotional samples to 1 of 8. Carriers are stricter on Marketing; weight the bundle toward transactional.
- Sample messages can be edited after approval if the actual pattern drifts. Substantive changes trigger re-review.

## Current status (2026-05-29)

- TFN provisioned: (855) 957-4235
- Compliance profile (Plume Nexus LLC business identity): **In Review**
- Toll-free registration: **Locked — pending compliance profile approval**
- Inbound webhook hardcoded `tenantId = TENANT_ID` still needs to be fixed before tenant #2 (see `functions/index.js` line ~5519).
