# Migration playbook — pulling customers off PT Enhance & BuzzOps

**Researched:** 2026-06-28 (Cowork desktop). Companion to [`docs/competitors/FINDINGS.md`](../competitors/FINDINGS.md).

**TL;DR for Jonathan:** Every migration splits into two halves with very different difficulty. **(A) Records** — clients, contact info, history, appointments, services — are CSV-shaped and we can automate the import almost entirely, because **we already have a working CSV importer** ([`src/lib/csvImport.js`](../../src/lib/csvImport.js)) built for the GlossGenius switch. **(B) Money-on-file** — saved credit cards and live recurring billing — is *not* scrapeable by anyone; it can only move processor-to-processor through a PCI-compliant export ([Stripe PAN migration](https://docs.stripe.com/get-started/data-migrations/overview)). That second half is the real friction, and it's much bigger for BuzzOps (a billing platform) than for PT Enhance (a coaching tool). So: automate half A hard, have a clean playbook for half B, and lead the sales conversation with "we do the move for you."

---

## The mental model: two halves of every migration

| Half | What's in it | Portable? | Our move |
|------|--------------|-----------|----------|
| **A — Records** | Client list (name, phone, email, birthday, notes), appointment history, upcoming bookings, service menu, staff list, photos | **Yes** — exportable as CSV/Excel from most platforms, or rebuildable from a client list | **Automate.** Extend our existing importer with per-source presets. |
| **B — Money-on-file** | Saved cards (tokens), active recurring memberships/subscriptions billing those cards | **Only processor→processor**, PCI L1→L1, PGP-encrypted over SFTP, ~10-day SLA. Never a CSV. | **Don't DIY.** Run the [Stripe data-migration](https://docs.stripe.com/get-started/data-migrations/card-imports) path, or have clients re-enter cards. |

Card numbers can **never** be exported to a spreadsheet — that's PCI by design. Per [Stripe's migration docs](https://docs.stripe.com/get-started/data-migrations/pan-export), card data only transfers to another **PCI DSS Level 1** processor, PGP-encrypted (4096-bit+), via SFTP, with no universal API between processors and a ~10-day turnaround. Credentials saved via wallet layers (e.g. Stripe **Link**) can't move at all. **Implication:** whether *we* can absorb cards-on-file depends on our own processor being PCI L1 and willing to run an import — a prerequisite to resolve before promising "keep your cards." For most *PT Enhance* prospects this barely matters; for *BuzzOps* prospects it's the whole ballgame.

---

## What we already have (don't rebuild this)

[`src/lib/csvImport.js`](../../src/lib/csvImport.js) is a complete, source-agnostic importer. The architecture is exactly right for adding sources: **pure parsing/mapping in this file; the caller (`CsvImportSection`) does the Firestore writes + progress UI.** Concretely it already provides:

- **`parseCsv(text)`** ([L8](../../src/lib/csvImport.js#L8)) — robust CSV parser (quoted fields, embedded commas/newlines, doubled quotes). Source-neutral.
- **`getCol(record, candidates)`** ([L42](../../src/lib/csvImport.js#L42)) — case-insensitive column lookup against a **list of candidate header names**. This is the key extension point: adding a new platform mostly = adding its column names to these candidate lists.
- **`detectType(headers)`** ([L141](../../src/lib/csvImport.js#L141)) — sniffs whether a file is clients / appointments / sales / line-items. Already falls through to a generic **clients** detector on "has email/phone, no date/service" ([L160](../../src/lib/csvImport.js#L160)).
- **`mapClientRow`** ([L304](../../src/lib/csvImport.js#L304)), **`mapAppointmentRow`** ([L332](../../src/lib/csvImport.js#L332)), **`mapSaleRow`** ([L362](../../src/lib/csvImport.js#L362)) — row→Firestore-doc mappers, already tolerant of many header aliases ("Phone"/"Mobile"/"Phone Number", "First Name"+"Last Name" vs "Client Name", etc.).
- Date/time/money/status/method normalizers and a two-file receipt joiner.

On the write side, the [Firestore layer](../../src/lib/firestore.js) already has **`createClientsBatch`** / **`createAppointmentsBatch`** (chunked at 450/batch), **phone de-dupe** via a canonical `phoneDigits` field, and **`resizeImg(src, w, h, q)`** ([`src/utils/helpers.js`](../../src/utils/helpers.js)) which accepts a **URL or Blob and returns base64** — so importing client/staff photos from URLs is already solved.

**Bottom line:** a plain client-list CSV with name + email + phone columns can be imported **today**, unmodified, by the GlossGenius path. The per-platform work below is about handling each source's quirks and removing manual steps.

---

## PT Enhance

**Migration difficulty: LOW–MEDIUM.** It's a coaching tool, so half B is small. The catch is half A: **no documented self-serve export or public API.**

### What's gettable
- **Confidence flag:** I could not find any PT Enhance documentation, help article, or API reference describing a client-data export (searched vendor site, help, Capterra, SourceForge). Treat "how do I get the data out" as **unconfirmed — step 1 is literally checking the account UI for an Export button and, failing that, emailing PT Enhance support to request a client CSV.** Their support is genuinely responsive (4.8 on Capterra, per [FINDINGS](../competitors/FINDINGS.md)), which actually helps here.
- **Likely obtainable:** a client roster (names, emails, phones) — either via an export button, a support-provided CSV, or worst case manual copy from the client list (these rosters are usually tens, not thousands).
- **Probably NOT portable:** workout programs, periodization calendars, and assigned exercise/education content. These are PT Enhance's proprietary library + custom-built programs and almost never come out in structured form. **This is fine** — we don't have a program builder yet anyway (it's a [roadmap gap](../competitors/competitor-landscape.md)), so we're not promising to import something we can't display.
- **Money-on-file:** PT Enhance billing is per-client and light; many trainers bill outside the tool. If cards are vaulted there, same PCI rule applies — but the volume is small enough that **"clients re-enter their card on first booking" is an acceptable answer.**

### What we automate
1. Add `'ptenhance'` candidate columns to the `getCol` lists in [`csvImport.js`](../../src/lib/csvImport.js#L42) once we see a real PT Enhance export header row (get one sample file from the prospect — this is the single highest-value artifact).
2. The existing generic **clients** detector + `mapClientRow` likely ingests a PT Enhance roster with **zero new code** if the headers are conventional (Name/Email/Phone). Adding the source tag `_importedFrom: 'ptenhance'` is a one-line change to the mapper.
3. Photos (if the export includes URLs) flow through `resizeImg` automatically.

### Effort & honest read
**~Half a day of dev** *if* PT Enhance gives a clean CSV; **most of the effort is non-engineering** — getting the export out of PT Enhance. For a single prospect, you could honestly migrate them **by hand in an afternoon** using the existing importer; build the preset only once you're converting PT Enhance users repeatedly.

---

## BuzzOps

**Migration difficulty: MEDIUM–HIGH.** It's a full gym-ops/billing platform, so half B (live recurring memberships on saved cards) is large and is the real obstacle — not the records.

### What's gettable
- **Confidence flag:** BuzzOps publishes lots about migrating **INTO** BuzzOps (their [migration page](https://buzops.com/gym-management-software-tips-on-migration-and-payment/) advertises free white-glove onboarding, 24-hr data transfer, and notably *"push encrypted payment profiles… no need to change payment providers"*). I found **nothing** about a departing customer **exporting** their data out. Outbound data portability is **unconfirmed** — step 1 is a support request for a full data export (clients, memberships, schedule, transaction history).
  - *Competitive-intel note:* BuzzOps's inbound pitch is itself a tell — they treat "we move your data and your cards for free" as a closing tool. **We should match that promise**, because a prospect who got a free move *in* will expect a free move *out/over*.
- **Records (half A) — automatable once exported:** member roster, contact info, membership/plan names, class/appointment schedule, staff list, transaction history. All CSV-shaped → our importer.
- **Money-on-file (half B) — the blocker:** BuzzOps runs recurring membership billing against vaulted cards (it even supports crypto, per its [G2 profile](https://www.g2.com/products/buzops/reviews)). Those cards can only come to us via a **PCI L1→L1 processor migration** ([Stripe card-import](https://docs.stripe.com/get-started/data-migrations/card-imports)) — encrypted, SFTP, ~10-day SLA — and **only if our processor supports it.** If a prospect has 200 members on auto-pay, "re-enter your card" is a much harder ask than for a solo PT.

### What we automate
1. **Member/client + schedule import:** add BuzzOps header candidates to `getCol`; reuse `mapClientRow` / `mapAppointmentRow`. Likely needs a small **membership mapper** if we want to represent recurring plans (we don't have a memberships collection yet — scope check needed; for an initial migration, importing members as clients + noting their plan in `notes` is the pragmatic v1).
2. **Transaction history** flows through the existing `mapSaleRow` / receipt path with new column aliases.
3. **Card-on-file:** *not* an importer feature — a **runbook**, see below.

### Effort & honest read
**Records: ~1–2 days of dev** for a BuzzOps preset (more if we build a real memberships model). **Cards-on-file: not a code task at all** — it's a coordinated processor migration that depends on (a) getting BuzzOps/its processor to release an encrypted export and (b) our processor being PCI L1 and willing to import. Until (b) is confirmed, **do not promise BuzzOps prospects they keep their auto-pay cards.** The defensible promise today is: "we move all your records and history for free; for active auto-pay we'll run a processor migration where possible, or do a one-time re-authorization drive."

---

## The card-on-file runbook (the one non-DIY piece)

For any prospect with saved cards / live recurring billing:

1. **Confirm our processor is PCI DSS Level 1** and supports inbound PAN import (prerequisite — resolve once, globally). Stripe documents both [export](https://docs.stripe.com/get-started/data-migrations/pan-export) and [import](https://docs.stripe.com/get-started/data-migrations/pan-import) sides.
2. Have the prospect request an **encrypted card-data export** from their current processor (not from BuzzOps/PT Enhance the app — from the *processor* underneath it).
3. Transfer is PGP-encrypted over SFTP, processor-to-processor; budget **~10 business days** ([Stripe SLA](https://stripe.com/guides/five-steps-to-accelerate-your-data-migration-to-stripe)).
4. **Fallback when migration isn't possible** (incompatible processor, wallet-tokenized cards, small client count): a **re-authorization drive** — import the records now, then prompt each client to re-enter their card on first booking via our existing payments/Venmo flow. For PT Enhance-size books this is usually the right call anyway.

---

## Recommended build order

1. **Do nothing generic yet — get one real export file from each prospect.** The header row dictates everything. One sample PT Enhance CSV and one BuzzOps CSV are worth more than any speculative code.
2. **Ship a self-serve Import wizard tab in Admin** ([`src/modules/admin/Admin.jsx`](../../src/modules/admin/Admin.jsx) — add `{ id: 'import', label: '📥 Import' }` to its tab list) wrapping the existing `CsvImportSection`. This turns migration from "Jonathan does it manually" into a feature, and it's reusable for *every* source (GlossGenius, PT Enhance, BuzzOps, Vagaro, Mindbody).
3. **Add per-source header presets** to `getCol`/`detectType` as real files come in — cheap, additive, low-risk.
4. **Tag imports** with `_importedFrom` (the GG path already does this at [L327](../../src/lib/csvImport.js#L327)) so migrated records are reportable and reversible.
5. **Resolve the processor question** (PCI L1 + inbound card import) before marketing "keep your cards" to BuzzOps-scale prospects.

**Net:** the records side is largely a config/preset exercise on top of code you already shipped — days, not weeks. The genuinely hard, non-automatable part is cards-on-file, and it's a processor coordination problem, not a scraping problem. Sell the records migration as "free and we do it for you" (matching BuzzOps's own inbound pitch); handle cards with the runbook above.

---

### Sources
- [`src/lib/csvImport.js`](../../src/lib/csvImport.js), [`src/lib/firestore.js`](../../src/lib/firestore.js), [`src/utils/helpers.js`](../../src/utils/helpers.js), [`src/modules/admin/Admin.jsx`](../../src/modules/admin/Admin.jsx) — existing import infrastructure (Plume Nexus codebase, reviewed 2026-06-28)
- [BuzzOps — Gym Management Software: Tips on Migration and Payment](https://buzops.com/gym-management-software-tips-on-migration-and-payment/) (their inbound migration + encrypted payment-profile pitch)
- [Buzops — G2 profile](https://www.g2.com/products/buzops/reviews) (feature set incl. recurring billing, crypto)
- [Stripe — Data migrations overview](https://docs.stripe.com/get-started/data-migrations/overview) · [PAN export](https://docs.stripe.com/get-started/data-migrations/pan-export) · [PAN import](https://docs.stripe.com/get-started/data-migrations/pan-import) · [Card imports](https://docs.stripe.com/get-started/data-migrations/card-imports) · [Accelerate migration (10-day SLA)](https://stripe.com/guides/five-steps-to-accelerate-your-data-migration-to-stripe)
- PT Enhance export capability: **unconfirmed** — no public export/API documentation found (vendor site, help, [Capterra](https://www.capterra.com/p/140261/ptEnhance/reviews), SourceForge searched 2026-06-28)
