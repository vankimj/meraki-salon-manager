# Founders' Cohort Beta Intake Form

**Purpose:** Capture qualified Founders' Cohort applicants. Sets expectations on both sides (theirs + yours), surfaces fit early, and creates a usable data file.

**How to use:**
- **Phase 1 (now):** Use as a Google Form. Share the link in your Founders' Cohort recruitment outreach. ~5 min to set up at forms.google.com.
- **Phase 2 (later):** Embed as a real form on plumenexus.com/founders or behind a "Apply" button on the Pricing page.

---

## Form fields (for Google Forms or future in-app form)

### Section 1 — Contact (required)

| Field | Type | Notes |
|---|---|---|
| Your name | Short text | Required |
| Email | Email | Required. Validate format. |
| Phone | Phone | Optional but ask. Best way to reach you fast. |
| Salon / business name | Short text | Required |
| Salon website or Instagram | URL | Optional. Helps you research before the call. |

### Section 2 — Your salon (required)

| Field | Type | Notes |
|---|---|---|
| City + state | Short text | Required. Useful for cohort diversity. |
| What kind of business is this? | Dropdown | Nail salon · Hair salon · Med spa · Day spa · Brow & lash · Barbershop · Wellness studio · Tattoo · Pet grooming · Other (text) |
| How many staff? | Dropdown | Just me · 2-3 · 4-8 · 9-15 · 16+ |
| How long have you been in business? | Dropdown | <1 year · 1-3 years · 3-7 years · 7+ years |
| Your role | Dropdown | Owner · Manager · Both |

### Section 3 — Current setup (required)

| Field | Type | Notes |
|---|---|---|
| What software do you use today? | Multi-select | GlossGenius · Square · Vagaro · Booksy · Boulevard · Mindbody · StyleSeat · Fresha · Pen & paper · Other |
| What's the #1 thing you wish your current setup did better? | Long text | This is the GOLD field. Read every response. |
| Roughly how much do you pay per month for software, all in? | Dropdown | <$50 · $50-100 · $100-200 · $200-400 · $400+ · Not sure |
| What would success look like in 90 days on Plume Nexus? | Long text | Surfaces real outcomes vs vague hopes. |

### Section 4 — Founders' Cohort commitment (required)

The cohort is small, exclusive, and we want each member committed. Be honest about what they're agreeing to.

| Field | Type | Notes |
|---|---|---|
| I understand the Founders' Cohort means: free Solo plan for life, in exchange for ~30 min/month of feedback for the first 6 months. | Checkbox | Required to proceed. |
| Are you willing to share honest feedback, including critical feedback? | Y/N | Required. |
| Are you open to a 30-min onboarding call with the founder? | Y/N | Required. |
| When could you migrate from your current platform? | Dropdown | This week · This month · Next 1-3 months · Just exploring |
| Anything else we should know? | Long text | Optional but always read. |

### Section 5 — How did you hear about us? (optional)

| Field | Type | Notes |
|---|---|---|
| How did you find us? | Multi-select | Word of mouth · Industry FB group · Reddit · Local · Other (text) |
| Who referred you (if applicable)? | Short text | Optional. Track for thank-yous later. |

---

## What happens after submission (the autoresponder)

The form should send an immediate confirmation email. Draft below — replace the placeholders, send via the existing AWS SES setup (or Gmail for one-off manual sends).

```
Subject: Got your Founders' Cohort application — here's what's next

Hi [first name],

Thanks for applying to be a Founders' Member. I read every application personally,
so this isn't a generic "we'll be in touch" email.

Here's what happens now:
1. I review your application within 1 business day
2. If we're a fit, you get an email from me with a Calendly link to book
   a 30-min onboarding call
3. On that call we get your account set up, import your data, and walk
   through the platform together

What I'm looking for in Founders' Members:
- Willingness to share real feedback (the critical stuff matters more than the praise)
- Active salon (not "I'm planning to open one day")
- Time to actually use the platform — even if light, regular use beats heavy use once

If your application doesn't make this round, I'll let you know and explain why. The
cohort is intentionally small so we can give each member real attention. Future
cohorts open up over time.

Thanks for taking the platform seriously enough to apply.

— Jonathan VanKim
Founder, Plume Nexus
hello@plumenexus.com
```

---

## Internal triage rubric (for you, not them)

When reviewing applications, score each on:

| Criterion | 1 (low) | 3 (med) | 5 (high) |
|---|---|---|---|
| Salon size matches target ICP (3-15 staff) | Solo or 20+ | 1-2 or 16-20 | 3-15 staff |
| Currently paying for software | Not really | A little ($50-100) | Yes ($100+) |
| Pain in #1 free-text question | Vague or generic | Specific but mild | Specific + intense |
| Migration timing | Just exploring | 1-3 months | This week/month |
| Communication quality | Hard to read | Average | Clear, thoughtful |
| Cohort diversity (geography, segment) | Same as 5+ existing | Same as 1-4 | Underrepresented |

**Score 18+ → invite to demo. Score 12-17 → invite with reservations. Score <12 → polite rejection (they can re-apply later).**

---

## Cohort cap & cadence

- **Phase 1 cohort:** 25 salons. Application review batched weekly.
- **Once full:** waitlist. Send waitlisted applicants a "we'll let you know when the next cohort opens" note.
- **Phase 2 cohort:** open ~3 months after phase 1 if you've digested feedback and shipped meaningfully.

Don't open the gates wide just because you can. The cohort's value is the relationship, not the headcount.

---

## Polite rejection template

For applications that don't make the cut:

```
Subject: Re: Founders' Cohort application

Hi [first name],

Thanks again for applying. I want to be honest — for the current cohort, we're
prioritizing salons with [3-15 staff actively running on existing software], and
yours is a [different size / different stage / etc.].

This isn't a "no" forever — just a "not this round." We're opening another cohort
in [3-6 months] and I'd love for you to reapply then. I'll make sure your name's
on the list.

In the meantime, if you want to try the Solo plan independently (which is free
during Founders' Year for any salon), you're welcome to sign up at plumenexus.com.
You'd just be on the public free tier rather than the Founders' Cohort with
direct founder access.

Thanks for understanding — and for taking the time to apply.

— Jonathan
```
