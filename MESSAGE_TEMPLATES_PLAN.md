# Message Template Builder — Execution Plan

Tenant-editable templates for **every automated email + SMS**, with baked-in default
wording (so blank = today's behavior), a variable system, and an Admin editor.
Decided 2026-06-11. Build as a dedicated, full-budget session.

---

## 1. Core design decisions (don't re-litigate these)

1. **Owners edit CONTENT, not raw HTML.** Keep the branded HTML shell (gradient
   header + footer) as a **fixed wrapper**; the owner edits the **subject** + the
   **body copy** (a few paragraphs/blocks). This avoids owners breaking HTML/CSP/
   escaping and keeps every email on-brand. Extract the existing shell into a
   reusable `emailShell(brand, { title, contentHtml, ctaUrl?, ctaLabel? })`.
2. **Defaults must byte-match current wording.** Each template ships a default = the
   exact copy in the current hardcoded send. The switch is invisible until edited.
3. **Variables** are a defined, per-template allowlist (e.g. `{clientName}`,
   `{salonName}`, `{date}`, `{time}`, `{service}`, `{tech}`, `{manageLink}`,
   `{total}`, `{amount}`). `renderTemplate` interpolates them and **HTML-escapes**
   variable values for email (never the template chrome). Unknown `{placeholders}`
   render literally + the editor warns.
4. **SMS = body only.** `sendSms` already auto-prepends the salon name and appends
   the "Reply STOP to opt out." footer — templates must NOT duplicate those. Editor
   shows a live **segment count**.
5. **Admin alerts**: two layers. The **wrapper** (subject prefix `🔔 Admin Alert ·`,
   greeting) is templatable; the dynamic **detail line** (e.g. refund amount, who,
   reason) stays code-generated and is injected as a `{detail}` variable. So one
   `admin_alert` template covers refund/rating/credit/etc.; per-type templates are
   out of scope for v1.
6. **Storage**: `tenants/{id}/messageTemplates/{key}` = `{ subject?, body, updatedAt }`.
   Missing doc/field → fall back to the default. Per-tenant override only.
7. **Platform-internal messages are NOT editable** (SES-broken alert, security
   delete alerts, Stripe deauth, Plume Nexus welcome, ticket replies). Exclude them.

---

## 2. Architecture

- **`functions/lib/messageTemplates.js`** (new) — exports:
  - `DEFAULT_TEMPLATES`: `{ [key]: { channel:'email'|'sms', group, label, subject?, body, vars:[...], description } }`. `body`/`subject` use `{var}` placeholders. `body` for email is the CONTENT only (goes inside `emailShell`).
  - `TEMPLATE_KEYS` list + grouping for the editor.
  - `renderTemplate(db, tenantId, key, vars)` → loads `tenants/{id}/messageTemplates/{key}`, falls back to default, interpolates + escapes, returns `{ subject, html }` (email, wrapped in `emailShell`) or `{ body }` (sms). Cache per (tenant,key) ~5 min like `tenantSmsFrom`.
  - `interpolate(str, vars, { escape })`.
- **`functions/lib/emailShell.js`** (new or extracted) — the shared branded HTML wrapper currently duplicated across sends.
- **`src/lib/messageTemplates.js`** (web, new) — mirror of `DEFAULT_TEMPLATES` (or fetch via a callable) for the editor's defaults + preview + variable lists. Keep the default copy in ONE source of truth if possible (e.g. a JSON the build copies to both), else mirror carefully.
- **Firestore rules**: `messageTemplates/{key}` — `read/write: isTenantAdmin` (or a new `editTemplates` cap → owner+manager). CF reads via Admin SDK.

---

## 3. Template inventory (tenant-facing — wire ALL of these)

Extract each default `body`/`subject` from the current send site (grep the subject text in `functions/index.js`).

### Customer emails
| key | subject (current) | key vars |
|---|---|---|
| `booking_confirmation_email` | Booking confirmed — {date} at {time} | clientName, salonName, date, time, service, tech, location, manageLink |
| `reminder_email` | Reminder: Your appointment tomorrow at {salonName} | clientName, date, time, service, tech, manageLink |
| `cancellation_notice_email` | Your appointment at {salonName} was cancelled | clientName, date, time, service, tech |
| `receipt_email` | Your receipt — {date} | clientName, salonName, lineItems, total, tip, date, viewLink |
| `rating_request_email` | How was your visit? We'd love your feedback 💅 | clientName, salonName, ratingLink |
| `gift_card_email` | 🎁 You've received a ${amount} gift card | recipientName, senderName, amount, code, salonName |
| `membership_invite_email` | Complete your {planName} membership | clientName, planName, link |
| `birthday_email` | Happy Birthday … | clientName, salonName, offer? |
| `win_back_email` | We miss you … | clientName, salonName, offer? |

### Customer SMS (body only; no name-prefix, no STOP footer)
| key | gist |
|---|---|
| `booking_confirmation_sms` | "Your {service} is booked for {date} at {time} with {tech}. Manage: {manageLink}" |
| `reminder_sms` | reminder, day-of/day-before |
| `receipt_sms` | receipt link |
| `rating_request_sms` | rate link |
| `cancellation_sms` | cancelled notice |

### Admin alerts (email; wrapper templatable, `{detail}` injected)
| key | covers |
|---|---|
| `admin_new_booking` | new online/staff booking — clientName, date, service, tech |
| `admin_alert` | generic (refund, low rating, credit adjust, dispute) — title, detail |
| `admin_new_message` | client replied — clientName, message |
| `admin_new_review` | new Google review — clientName, rating |
| `admin_access_request` | staff access request — name, email |

> Tech alerts are **push** (notifications collection), not email — out of scope unless we add tech email later.

---

## 4. Send sites to rewire (grep `subject:` and `sendSms(` in functions/index.js)
~32 email + ~20 SMS sites. For each tenant-facing one above, replace the inline
HTML/string with `const { subject, html } = await renderTemplate(db, tenantId, key, vars)`
then `sendEmail({ from, to, replyTo, subject, html, tenantId })`. Leave platform-
internal sends as-is.

Known anchors: `sendBookingConfirmation` (booking email + admin email + booking SMS),
`sendTechAppointmentReminders` (reminder), the cancellation-notice path, the receipt
email/SMS (`sendReceiptSms` + the receipt email), `submitServiceRating`/rating-request,
`notifyTenantAdmins` (admin_alert wrapper), gift card, membership.

---

## 5. Admin editor UI (`src/modules/admin/` — new MessageTemplatesSection or its own view)

- Entry: Admin → Settings → a "✉️ Message Templates" group (or a top-level tile).
- Grouped list: **Customer Emails · Customer SMS · Admin Alerts**. Each row: label +
  "Edited"/"Default" badge.
- Editor per template:
  - **Subject** input (email only).
  - **Body** textarea (monospace-ish; v1 plain text/light markup, NOT a full WYSIWYG).
  - **Variable chips**: click to insert `{var}` at cursor; show each var's meaning.
  - **Live preview**: render with sample data via the web mirror of `renderTemplate`
    (email shows inside the shell; SMS shows the bubble + segment count + the
    auto-added name prefix & STOP footer as greyed, non-editable).
  - **Reset to default** (deletes the override).
  - **Save** → writes `tenants/{id}/messageTemplates/{key}`.
- Gate: owner+manager (`can('editTemplates')` or reuse an existing admin cap).

---

## 6. Build order (within the session)
1. `emailShell` extraction + `messageTemplates.js` lib (DEFAULT_TEMPLATES for all keys, byte-matched to current copy) + `renderTemplate` + unit tests for interpolation/escaping/fallback.
2. Rewire customer **emails** (booking, reminder, cancellation, receipt, rating, gift card, membership) → render. Verify each renders identically to before with no override (snapshot/string compare in tests).
3. Rewire customer **SMS**.
4. Rewire **admin alerts** (wrapper + `{detail}`).
5. Web mirror + the **editor UI** + preview.
6. Firestore rules + cap. Tests. Deploy (functions touched are many — deploy targeted, watch the us-central1 CPU quota; see `project_cloudrun_cpu_quota`).

---

## 7. Gotchas / must-handle
- **CPU quota**: redeploying ~10 functions at once may hit the us-central1 cap. Deploy in small batches.
- **Escaping**: variable values escaped for email; the shell/template chrome is trusted. SMS: no HTML.
- **Default drift**: write a test that asserts each default renders to the current
  string for a fixed input, so we know the switch is invisible.
- **Reply-To / from**: unchanged — templates don't touch sender logic.
- **i18n / emoji**: keep UTF-8; subjects already use emoji.
- **Versioning**: store `updatedAt` + `updatedBy`; consider a "last edited by X" line.
- **SMS segment math**: GSM-7 vs UCS-2 (emoji/accents force 70-char segments) — the editor's counter must account for that.
- **Preview parity**: the web preview must use the SAME interpolation as the server, or previews lie. Share the interpolate fn (or a JS port with a test asserting parity).

---

## 8. Done = 
Every tenant-facing email/SMS renders from a template; blank tenant = identical to
today; the owner can edit subject + body + see a live preview + reset to default for
all ~15 messages; tests prove default-parity; deployed in batches.

---

## 9. Consolidate, don't fragment (the #1 requirement)
The owner's explicit ask: "we have too many half-finished template systems — do it
right so it's not a constant back-and-forth." So step ONE of the build is an audit:

- **Inventory every existing place copy is already configurable** and decide
  fold-in vs leave-standalone (document the call):
  - `feedbackThankYouTitle` / `feedbackThankYouMsg` (rating page) — *fold into this system* as templates.
  - `cancellationPolicyText` / `refundPolicyText` (settings) — these are policy *snippets* injected into multiple messages; keep as settings but expose as `{cancellationPolicy}` / `{refundPolicy}` variables.
  - Marketing campaigns (`MarketingAdmin`) — already its own composer; **leave standalone** (different lifecycle), but share the `emailShell` + variable list.
  - Welcome styles / hero / editorial copy — pre-login marketing surface, **out of scope** (not a message).
  - `helpContent.js` — in-app help, not a message — out of scope.
- **One render path.** After this lands, there should be exactly ONE way copy gets
  into an automated email/SMS: `renderTemplate`. No more inline HTML strings in new
  code. Add a lint/grep check or a PR-review note to enforce it.
- **One editor.** All message editing lives in the Message Templates UI — don't add
  per-message one-off fields (like the feedback/policy fields were) going forward;
  migrate those into the template editor.
