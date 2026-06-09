# SMS Provider Evaluation — Twilio vs AWS End User Messaging

_Decision doc. Compiled 2026-06-09 from an adversarially-verified deep-research pass (11 verified claims, sources cited below). Context: multi-tenant salon SaaS (Plume Nexus), each tenant gets its own dedicated number, transactional + two-way SMS, ~few thousand SMS/mo across tenants. Triggered by slow Twilio support on Meraki's stuck verification._

## TL;DR / Verdict

**Do not migrate to AWS to escape the slow Twilio ticket.** Switching does **not** unblock a stuck verification faster — both providers submit to the same downstream registries (TCR for 10DLC, the toll-free aggregators), so moving **restarts** the verification clock on AWS and adds a migration. The "escape slow Twilio support" justification is the weakest-supported claim in the whole evaluation.

**AWS is, however, a legitimate strategic move** on cost and multi-tenant fit — worth a deliberate pilot, not a fire-drill migration.

## Two tracks (keep them separate)

| Track | Goal | Action |
|-------|------|--------|
| **1 — Unblock Meraki NOW** (on Twilio, no migration) | Real texts this week | Escalate the ticket; and/or pivot Meraki from **toll-free → 10DLC** (TCR registers in ~1–3 business days vs toll-free's weeks). Fastest path to sending. |
| **2 — Evaluate AWS deliberately** | Lower cost + native multi-tenancy long-term | Pilot ONE new tenant end-to-end on AWS End User Messaging before any wholesale switch. (This doc + roadmap card.) |

## Where AWS genuinely wins (high confidence)

- **Purpose-built for our exact model.** `pinpoint-sms-voice-v2` explicitly markets ISV/multi-tenant use: programmatic number provisioning (`RequestPhoneNumber`, `CreatePool`), per-number/per-pool two-way config, and inbound delivered to an **SNS topic** whose payload includes **`destinationNumber`** → route inbound to the right tenant. Per-tenant opt-out list isolation. Maps ~1:1 onto our per-tenant TFN design.
- **Compliance auto-handled.** STOP/HELP auto-replies + auto-opt-out by default, no code (opt into self-managed if needed).
- **Cheaper (modestly):** numbers **$1/mo 10DLC, $2/mo toll-free** (vs Twilio **$1.15 / $2.15**); per-message **~$0.0058** vs Twilio **$0.0083** + carrier pass-through. Lowest paid support tier **~$29/mo** (Business Support+; AWS retired Developer/Business for new subs 2025-12-02) with a **24h initial-response** target on quota/number cases.

## Gotchas that matter for us (high confidence)

1. **Per-tenant 10DLC cost is dominated by the ~$10/mo campaign fee** (TCR pass-through), NOT the $1 number — on *either* provider. Bake this per-salon line item into pricing regardless of vendor.
2. **AWS quota caps:** default **25 dedicated numbers/account** (adjustable via support case) and a **hard cap of 49 numbers per 10DLC campaign that is NOT increasable**. A per-tenant-number SaaS must architect around the 49/campaign cap at scale (multiple campaigns).

## Migration surface in our codebase (if we proceed)

- `sendSms()` — 10 call sites in `functions/index.js`
- `twilioInboundSms` webhook → replace with an SNS-topic consumer (inbound → tenant routing via `destinationNumber`)
- `twilioStatusWebhook` → SNS delivery events
- `functions/lib/tfnRegistry.js` + `provisionTenantSMS` / `markSharedTfn` / `releaseTenantSMS` → number provisioning rewrite (`RequestPhoneNumber` / pools)
- Opt-out handling (currently Twilio-side) → AWS opt-out lists (or self-managed)
- ~56 web/mobile references to twilio/sendSms wrappers (mostly indirect)

Non-trivial but bounded. Pilot de-risks before any cutover.

## What's NOT well established (flagged uncertainty)

- **Twilio's actual support response times / tiers** — the research found almost no primary evidence; the comparison on "is Twilio support truly slower" is only partly answerable.
- Carrier **pass-through fees are time-sensitive** (T-Mobile / US Cellular announced increases effective 2026-01-19). Re-price before committing.
- Registration fees ($4.50 company, $10/mo or $2/mo low-volume campaign, $50 T-Mobile activation "postponed") can change.

## Sources

AWS pricing & support: aws.amazon.com/end-user-messaging/pricing, aws.amazon.com/sns/sms-pricing, aws.amazon.com/premiumsupport/pricing, aws.amazon.com/blogs/aws/new-and-enhanced-aws-support-plans
AWS two-way + provisioning + compliance (docs.aws.amazon.com/sms-voice/latest/userguide): two-way-sms, two-way-sms-phone-number, two-way-sms-pool, two-way-sms-payload, phone-numbers-request, opt-out-list-self-managed, keywords-required, quotas; API_RequestPhoneNumber; sms-voice-v2; blog: how-to-implement-self-managed-opt-outs-for-sms-with-amazon-pinpoint
Twilio pricing: twilio.com/en-us/sms/pricing/us
