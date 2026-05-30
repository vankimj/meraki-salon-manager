# Free Solo Tier — Risk Register & Mitigation Plan

**Status:** Draft v2 (2026-05-09)
**Owner:** Jonathan VanKim
**Purpose:** Watertight pre-launch review of the **Founders' Year** model — Solo is free for anyone who signs up before June 30, 2027, locked in for life ("Founders' Members"). After that date, Solo becomes a paid tier for new signups; Founders' Members keep lifetime free access. Document lists every risk we can think of, how likely it is, what triggers it, and what we'll do about it.
**Cadence:** Review quarterly. Add new risks as they surface. Mark mitigations as ✅ shipped, 🟡 in-progress, ⬜ TODO.

**Why this changed from v1:** v1 assumed "Free Solo forever" with no time limit. v2 reflects the Founders' Year model decision (2026-05-09) which bounds the cohort and converts most "forever promise" risks from Critical → Med. Risks marked **[v2 reduced]** had their severity downgraded; risks marked **[v2 added]** are new to this model.

---

## How to read this

- **Severity:** Critical = company-killer. High = real money or legal exposure. Med = annoying but recoverable. Low = polish.
- **Likelihood:** How probable in the first 24 months at scale (1K-10K free users).
- **Trigger:** The event that makes the risk go from theoretical to real.
- **Status:** ✅ done · 🟡 partial · ⬜ not started

---

## A. Legal & Compliance

| # | Risk | Sev | Likely | Trigger | Mitigation | Status |
|---|---|---|---|---|---|---|
| A1 | "**Lifetime**" Founders' promise to existing members is binding | Med [v2 reduced from Critical] | Certain | Per-Founders'-Member, day 1 | Cohort is bounded (only those who sign up by June 30, 2027). Lifetime promise applies to a fixed, knowable cohort. ToS clause: "Founders' Members keep their plan terms unchanged for as long as their account remains active." | ⬜ |
| A1b | **Sunset of Solo for new signups** at end of Founders' Year reads as breaking the promise to prospects who didn't sign up in time | Med [v2 added] | Medium | Date passes | Date is announced publicly from launch day. Real cutoff, not retroactive. Plus extension flexibility (only ever extend, never shorten) softens any pressure | ⬜ |
| A2 | **TCPA pass-through liability** — free user sends marketing SMS without consent, you're named in the suit | Critical | Medium | First class-action plaintiff | Free Solo cannot send SMS at all. Any plan that does requires explicit per-audience consent confirmation. Audit log retains opt-in records 7 years | 🟡 (no SMS on free is decided; consent log not built) |
| A3 | **CAN-SPAM violations** by free users via email blasts | High | Medium | FTC complaint or state AG | Cap free email at 100/mo. Built-in unsubscribe footer is non-removable. Sender-domain reputation monitoring | 🟡 |
| A4 | **GDPR / CCPA** apply equally to free users — same compliance burden, no offsetting revenue | High | Certain (any EU user) | First EU signup | Data export anytime. 30-day deletion. DPA template available on request. Cookie-free analytics. Document data-processor agreements | 🟡 |
| A5 | **DMCA hosting safe-harbor** requires registered DMCA agent | High | Medium | First takedown notice | Register DMCA agent with Copyright Office ($6 one-time, $6 every 3 yrs). Add agent address to ToS. Build takedown response process | ⬜ |
| A6 | **CSAM detection** is legally required for any image-hosting service | Critical | Low | Any uploaded illegal image | Use Cloudflare Images or Google Cloud Vision SafeSearch on every photo upload. NCMEC reporting workflow documented | ⬜ |
| A7 | **Section 230 defense** must be asserted to limit liability for user-generated content | Med | Medium | Defamation suit involving content a free user created | Add Section 230 invocation to ToS. Editorial-discretion language carefully worded | ⬜ |
| A8 | **COPPA** under-13 user creates account | Med | Low | A teen tries to use it | ToS minimum age 18 (industry standard). Soft email-domain check at signup. No stated marketing to minors | ⬜ |
| A9 | **ADA accessibility** — disability claim because the booking page or admin app fails WCAG | High | Low-Med | One litigious plaintiff | Targeted WCAG 2.1 AA pass on the booking page (the public surface). VPAT statement available on request | ⬜ |
| A10 | **State AG investigations** become viable once you have enough users (~5K) | High | Low | High-profile complaint | Above-board on every front: data, billing, marketing claims. Annual independent legal review of marketing copy claims | ⬜ |
| A11 | **Class action exposure** — TCPA, BIPA (Illinois biometrics), CCPA all support class certification | Critical | Low-Med | Any of the above | Hard caps on automated SMS, no biometric data stored, CCPA-compliant rights workflow | 🟡 |
| A12 | **Subpoena / law enforcement requests** scale with user count (~1 per 1K users per quarter) | Med | Certain | First request | Documented response process: 5-day SLA, transparency report annually, $75-150/hr cost recovery for non-emergency requests | ⬜ |
| A13 | **DPA (Data Processing Agreement)** required by every EU controller (i.e., each EU salon owner) | Med | Medium | First EU enterprise inquiry | Self-serve DPA generator linked from /trust page. Template approved by counsel | ⬜ |
| A14 | **Indemnification asymmetry** — your ToS protects you but exposes them, or vice versa | Med | Medium | Acquired-by-larger-customer review | Counsel-reviewed ToS with mutual indemnity for IP claims, capped at 12 months fees for everything else | ⬜ |
| A15 | **Force majeure / SLA obligations** — your service goes down for 4 hrs, what do free users get? | Low | Certain | Major outage | ToS: free tier carries best-effort SLA, no credits. Paid tiers get pro-rata refund credit | ⬜ |
| A16 | **Right of publicity** — using a customer salon's logo in marketing without consent | Med | Low | One angry customer | Written permission required before any logo or quote used externally. Recorded in CRM | ⬜ |
| A17 | **Unauthorized practice of law** — answering a legal question via the AI chatbot | Low | Low | One bad AI response | System prompt explicitly forbids legal/medical/tax advice; redirects to professionals. Logged + reviewed monthly | 🟡 (system prompt has tone guidance, not explicit forbid) |

---

## B. Cost & Operational

| # | Risk | Sev | Likely | Trigger | Mitigation | Status |
|---|---|---|---|---|---|---|
| B1 | **Runaway AI cost** — one bad-actor user spamming chat / voice / reports racks up $50-200/mo solo | High | Medium | First abusive user | Hard cap: 50 AI calls/mo on free Solo. Per-IP rate limit on marketing chatbot. Cost-monitoring alerts at $X/day per tenant | 🟡 |
| B2 | **Storage growth** — each free user adds ~50MB/yr, 10K users = 500GB/yr | Med | Certain | 6+ months post-launch | Hard cap: 500MB per free tenant. Auto-resize photos to ≤500KB. Backup retention 7 days on free vs 30 on paid | 🟡 |
| B3 | **Twilio cost from any free SMS use** | High | Medium (if SMS leaks into free) | Feature creep | Free Solo has zero SMS — enforced at the function layer, not just the UI | 🟡 |
| B4 | **Email deliverability** — one free user spamming via AWS SES tanks the shared domain reputation | High | Medium | First spam incident | Hard cap: 100 outbound emails/mo on free. Bounce-rate kill switch (auto-pause sender if >10% bounces). Per-tenant SES Tenants reputation isolation; consider a separate sending identity for free vs paid if shared-pool reputation slips | ⬜ |
| B5 | **Support load** — free users generate 30-50% as many tickets as paid users | Med | Certain | Day 1 | Free SLA explicit: "best-effort, 5 business days." AI chatbot handles tier-1. In-app help docs comprehensive. No phone support on free | ⬜ |
| B6 | **Function execution costs** — Cloud Function invocation fees scale linearly | Low-Med | Certain | At 10K+ active free users | Aggressive caching (prompt cache, Firestore listener pooling). Quarterly cost audit per function | ⬜ |
| B7 | **Hosting bandwidth** — free users still hit the public booking page, kiosk URL, etc | Low | Certain | High-traffic salon goes free | Long-cache static assets (already done), CDN-cached booking pages, image lazy-load | 🟡 |
| B8 | **Database operations cost** — Firestore reads/writes on free tier | Med | Certain | Scale | Optimize queries to batch. Composite indexes for hot paths. Quarterly query-cost audit | 🟡 |
| B9 | **Backup costs** — every free user tenant gets backed up | Low | Certain | Scale | Free tier backed up weekly, paid daily. Backups in cold storage class | ⬜ |
| B10 | **Customer-success time per free user** — "I want a demo" requests from prospects who only intend to use free | Med | Medium | Sales touchpoint | Free Solo signup is fully self-serve, no demo. Demo only offered for Studio+ inquiries | ⬜ |
| B11 | **Refund / chargeback fraud** — free users using the platform to test payment exploits | Low | Low | One bad actor | Per-tenant Stripe Radar rules. Velocity limits on test transactions | ⬜ |
| B12 | **Outbound SMS cost overruns on PAID tiers** if a paid user goes on a marketing tear | Med | Medium | Big campaign | Per-tenant monthly SMS budget ceiling, configurable, hard-stop at 150% of monthly subscription value | ⬜ |

---

## C. Security & Abuse

| # | Risk | Sev | Likely | Trigger | Mitigation | Status |
|---|---|---|---|---|---|---|
| C1 | **Account farming** — one person creates 100 free accounts to bypass caps | High | Certain | Day 1 of free launch | Phone verification at signup ($0.05 via Twilio Verify). Cloudflare Turnstile CAPTCHA. 1 free per personal email; 3/IP/24hr; 1 per Stripe Connect ID | ⬜ |
| C2 | **Multi-account abuse for SMS leakage** if SMS ever ships in free | Critical (if it leaks) | Medium | Feature creep | Account-creation friction + auth-level enforcement that free Solo = exactly 1 user | ⬜ |
| C3 | **Credential stuffing** against the auth endpoint | High | Certain | Always-on | Firebase Auth rate-limits by default. Add reCAPTCHA on signup + login if traffic spikes. 2FA available on Salon Pro | 🟡 |
| C4 | **Email-spam relay** — free user signs up just to use you as an email-blast service | High | Medium | First "can I send 5K emails to this list?" complaint | Domain warming at signup (start with 50/day cap, raise as deliverability proves out). DKIM/SPF strict. Spam-detection on subject lines + bodies | ⬜ |
| C5 | **CRM scraper** — free user uploads bought lists to unknown email recipients | High | Medium | First bounced campaign | Cap new clients at 20/day. Validate emails before send. Suppression list shared across all tenants for chronic bouncers | ⬜ |
| C6 | **Booking page abuse** — bots filling slots to deny service | Med | Low-Med | Targeted attack on a busy salon | Rate-limit per IP. Optional CAPTCHA on public booking. Slot-hold expiry (10 min) | ⬜ |
| C7 | **AI prompt injection** — user crafting input that gets the AI to do unintended things | Med | Medium | First curious tester | System prompt instructs to ignore prompt-injection attempts. AI output is constrained to read-only tools on report queries | 🟡 |
| C8 | **Tenant data leak via misconfigured rules** — query that returns another tenant's data | Critical | Low | Single rules bug | Firestore rules audit before every release that touches schema. Penetration test before each major version | 🟡 |
| C9 | **Stored XSS** via client/employee notes, service descriptions | High | Medium | Single XSS payload | All user-supplied strings escaped on output (already done in receipts). HTML-strip on input for free-text fields | 🟡 |
| C10 | **CSRF** on POST endpoints | Med | Medium | Always-on | All mutations are callable functions requiring auth tokens (CSRF-immune). Webhooks (Twilio inbound) verify signatures | 🟡 |
| C11 | **Fake support requests** — social engineering to get account access | Med | Medium | First impersonator | Documented support verification process: confirm via authenticated email + secondary identifier (last receipt, signup date, etc.) | ⬜ |
| C12 | **API abuse** if you ever expose APIs | Med | Low (no API today) | API launch | API keys per tenant, rate-limit per key, scope-based permissions, billing on paid tiers only | n/a |
| C13 | **Trademark / brand misuse** — free user names their salon "Plume Nexus Day Spa" | Low | Medium | First weird signup | Salon name uniqueness check at signup. ToS prohibits use of "Plume Nexus" or confusingly similar names in their business name | ⬜ |
| C14 | **Phishing using your domain** — bad-actor sends spoofed Plume Nexus invoices | High | Low-Med | First spoof | DMARC strict policy (p=reject). BIMI logo on outbound email. Warn customers in welcome email about phishing patterns | ⬜ |

---

## D. Strategic & Conversion

| # | Risk | Sev | Likely | Trigger | Mitigation | Status |
|---|---|---|---|---|---|---|
| D1 | **Conversion rate too low** to make freemium worth it (target: 4-8% free → paid within 90d) | High | Medium | 90 days post-launch | Instrument upgrade-funnel events on day 1 (first appt booked, first marketing send, first AI report, hitting any cap). A/B test in-app upgrade prompts | ⬜ |
| D2 | **Cannibalization** — Studio-tier salons signing up as free Solo | High | High | Within 30 days | Hard auth-level cap: free Solo = exactly 1 user account. Feature gating on multi-tech credit splits, walk-in management, voice commands | 🟡 |
| D3 | **Feature creep into free tier is irreversible** — once a feature is free, taking it back = brand crisis | High | Certain | Each new release | Internal rule: features default to paid, only graduate to free after 12 months differentiation. Documented exception process | ⬜ |
| D4 | **Free user feedback drowns paid feedback** — they're more vocal, more entitled | Med | Certain | Ongoing | Roadmap prioritization formula weighted by tier × urgency × impact. Free tier feature requests in separate triage queue | ⬜ |
| D5 | **Sunsetting Solo for new signups at end of Founders' Year** is a planned, pre-announced event — not a betrayal | Low [v2 reduced from High] | Future | Founders' Year end date | Date is in marketing copy from day 1. SUNSET-PLAYBOOK.md still applies for the *Founders' cohort* if they ever need to be migrated (don't, but contingency exists) | 🟡 |
| D5b | **Pressure to extend Founders' Year multiple times** could erode deadline credibility | Med [v2 added] | Medium | Slow signup ramp | Cap extensions at 2 total. Each extension publicly announced with honest reasoning. Document each extension decision in this register | ⬜ |
| D6 | **Race to the bottom** — competitors copy and the market expects free everywhere | Med | High | 6-12 months post-launch | Differentiate on quality + AI depth, not price. Free tier is acquisition not strategy | n/a (market dynamic) |
| D7 | **Brand confusion** — "free version" becomes the dominant perception, paid features invisible | Med | Medium | If marketing leans too hard into "free" | Marketing leads with capability stories, free is the entry path not the headline | 🟡 |
| D8 | **Conversion-event blindness** — no instrumentation = flying blind | High | Certain (if not built) | Day 1 | Build event-tracking before opening free tier. Specific events: signup, first appt, first SMS upgrade prompt seen, cap hit, paid conversion | ⬜ |
| D9 | **Wrong cap = wrong upgrade lever** — caps that bite at random points hurt rather than help | Med | Medium | After 90 days of data | Instrument cap-hit events. Move caps that bite at frustration moments (low value-realized) further out, move caps that bite at "they're succeeding" closer in | ⬜ |
| D10 | **Premature monetization push** — chasing free users to upgrade before they've felt value | Med | Medium | Aggressive upgrade modals | First upgrade prompt only after 3 weeks of weekly logins + at least one cap warning | ⬜ |

---

## E. Data & Privacy

| # | Risk | Sev | Likely | Trigger | Mitigation | Status |
|---|---|---|---|---|---|---|
| E1 | **Breach of free user data** triggers same notification + fines as paid | Critical | Low | Single security incident | Same security model for all tenants (no "free tier is less secure"). Cyber insurance covers all users | 🟡 |
| E2 | **Right-to-erasure (GDPR Art. 17) requests** scale with user base | Med | Certain | First EU user | Self-serve account deletion in app. 30-day completion. Delete from primary + all backups within 90 days | ⬜ |
| E3 | **Right-to-access requests** require export of all PII for the requesting individual | Med | Medium | First privacy-aware user | Self-serve data export already covers most cases. Documented process for non-account-holder requests (e.g., a salon's client requesting their own data) | ⬜ |
| E4 | **Data residency requirements** — Canadian, EU, Australian customers may require local storage | Med | Low (early) | First enterprise inquiry | Document current residency (US-only). Offer multi-region as Salon Pro upsell when inquiries start | ⬜ |
| E5 | **PCI scope creep** — accidentally storing card data | Critical | Low | Any developer mistake | Stripe Elements only (cards never touch our servers). Quarterly PCI scope audit. Never log payment fields | 🟡 |
| E6 | **Account sharing** — free Solo account shared between business partners | Med | Certain | First multi-person solo | ToS clause: account is per-natural-person. Single auth session enforced (logout-other-sessions option). Activity log shows multi-IP usage | ⬜ |
| E7 | **Discovery / litigation hold** — preserve data when notified of pending litigation | Med | Low-Med | First notice of suit | Documented hold process. Override deletion automation for held accounts. Admin tool to flag tenants under hold | ⬜ |
| E8 | **CCPA "do not sell" for residents** even if you don't sell data | Low | Certain | First CA user | Privacy Policy already says "we don't sell." Do-not-sell link in footer (legally required even if non-applicable) | ⬜ |
| E9 | **Cross-tenant data contamination via shared resources** (e.g., shared SMS pool, shared email pool) | High | Medium | One bad-actor tenant | Domain warming, suppression-list isolation per-tenant where possible, kill-switch on shared-pool abusers | ⬜ |
| E10 | **Backup encryption + access control** — backups are a weaker target than primary | Med | Low | Backup-targeted attack | Backups encrypted with separate key. Access requires admin + audit trail. Quarterly backup-restore drill | ⬜ |

---

## F. Tax & Accounting

| # | Risk | Sev | Likely | Trigger | Mitigation | Status |
|---|---|---|---|---|---|---|
| F1 | **Sales tax nexus** — some states count free users toward economic nexus | High | Medium | Crossing 1K free users | Tax accountant review at 500 + 1K + 5K user milestones. Use Stripe Tax for paid plans (auto-handles registration in nexus states) | ⬜ |
| F2 | **VAT registration in EU** if you have any EU customers (free or paid) | Med | Medium | First EU paid user | OSS (One-Stop Shop) registration. Stripe Tax handles VAT calc + remittance | ⬜ |
| F3 | **1099-K reporting** — Stripe issues 1099-K to your platform if you process money for tenants | Med | Certain | Annual | Stripe Connect Standard (each tenant has their own Stripe account) avoids this — tenants get their own 1099-Ks | 🟡 |
| F4 | **State business registration** — operating in states beyond Ohio may require foreign-entity registration | Med | Medium | Crossing employee count thresholds in another state | Stay incorporated in OH (already JVK Consulting LLC). Register as foreign LLC in states where you have employees, not just users | ⬜ |
| F5 | **Income tax across multiple states** if you hire remote employees | Med | Medium | First remote hire | Use a PEO (Justworks, Gusto Embedded) for multi-state payroll | ⬜ |
| F6 | **Annual entity filing** — JVK Consulting LLC needs annual report in OH | Low | Certain | Annual | Calendar reminder. ~$0 in OH for LLC annual report (no fee for LLCs in OH) | ⬜ |
| F7 | **Free tier accounting** — how do you book the cost of serving free users? | Low | Certain | Annual P&L | Customer-acquisition cost line item; track unit economics quarterly | ⬜ |
| F8 | **Crypto / unusual payment methods** — currently only Stripe, but if you ever add crypto, BSA/AML rules apply | Low | Low | Future feature | Don't add crypto without legal review | n/a |

---

## G. Vendor & Dependency

| # | Risk | Sev | Likely | Trigger | Mitigation | Status |
|---|---|---|---|---|---|---|
| G1 | **AI provider price hike** — Anthropic raises Claude Haiku pricing 2-5x | High | Medium | At any time | Multi-provider AI abstraction (you can swap to Gemini Flash, GPT-4o-mini for similar tasks). Current cost monitoring per tenant | ⬜ |
| G2 | **AI model deprecation** — Haiku 4.5 sunset before you migrate | Med | Certain (eventually) | 18-24 months out | Subscribe to Anthropic deprecation announcements. Keep system prompts portable. Monthly model-availability check | ⬜ |
| G3 | **Twilio price changes** — SMS or phone-number rate increases | Med | Low-Med | Annual review | Multi-provider SMS abstraction (Vonage, Bandwidth as fallback). Pass-through pricing model on paid tiers protects margin | ⬜ |
| G4 | **AWS SES service limits / outage** | Med | Medium | First major incident | Single-provider via `sendEmail()` abstraction — provider swap is a one-line config change. Marketing campaigns are non-urgent enough to delay; transactional sends queue in Firestore docs for retry | ⬜ |
| G5 | **Firebase pricing changes** | Med | Low | Major Google policy shift | Annual contract review. Reservation pricing for predictable workloads. Backup migration plan to AWS/Cloudflare worker stack documented (don't build, just plan) | ⬜ |
| G6 | **Stripe account suspension** — your platform Stripe account gets flagged | Critical | Low | Compliance issue | Quarterly Stripe risk review meeting. Documented escalation contact. Contingency: tenants connect their own Stripe directly already | 🟡 |
| G7 | **Domain registrar issue** — Cloudflare loses control of plumenexus.com | Critical | Very Low | Catastrophic registrar event | Multi-year domain registration. DNS transfer lock enabled. Domain renewal calendar | ⬜ |
| G8 | **DNS provider outage** | Med | Low | Major Cloudflare incident | Cloudflare has redundant infra. Have a documented backup DNS plan (e.g. AWS Route 53) with TTLs that allow fast cutover | ⬜ |
| G9 | **GitHub / source control** — you're on GitHub. What if your account is compromised? | Critical | Low | Account compromise | 2FA on personal account. Branch protection on main. Periodic offline backup of repo | 🟡 |
| G10 | **Anthropic policy changes** — they prohibit certain use cases, you're caught flat-footed | Med | Low-Med | Anthropic policy update | Subscribe to policy updates. Quarterly review of usage against AUP | ⬜ |

---

## H. Reputational & Brand

| # | Risk | Sev | Likely | Trigger | Mitigation | Status |
|---|---|---|---|---|---|---|
| H1 | **Negative review on G2 / Capterra / Reddit** from free user | Med | Certain | Day 1 of free launch | Respond to every review within 48 hrs. Public, professional, problem-solving tone. Encourage paid users to leave reviews to balance | ⬜ |
| H2 | **"I tried the free version" becomes the dominant narrative** in third-party reviews | Med | Medium | 3-6 months in | Free users self-identify in reviews — track sentiment by tier. If free dominates, adjust acquisition mix | ⬜ |
| H3 | **Sunset announcement crisis** if you ever retire free | High | Future | Sunset day | Have the sunset playbook drafted before launch (already in D5). Communicate early, generously, with grandfather period | ⬜ |
| H4 | **Outage during high-visibility moment** — site goes down during a launch tweet | Med | Medium | Launch event, AppSumo deal, etc. | Status page (status.plumenexus.com) wired to real uptime monitoring. Pre-written incident comms templates | ⬜ |
| H5 | **Founder burnout reduces support quality** — visible degradation hurts brand | High | Medium | 12-18 months in | Hire CX person before you hit the wall (~5K paid customers). Burnout is a mitigation problem, not just personal | ⬜ |
| H6 | **Public AI failure** — voice command books wrong client, blast email goes to wrong list, etc. | Med | Medium | First incident | Action AI requires confirmation (already designed). Marketing blast has 60-second cancel window. Public incident report on status page | 🟡 |
| H7 | **Paywall accusation** — free users complain when they hit caps | Low | Certain | Day 1 | Caps are explicit at signup. Cap-hit emails frame as growth signal not denial of service. Easy upgrade path | ⬜ |
| H8 | **Competitive misinformation** — competitors spread FUD about your free tier | Low | Medium | Once you have traction | Maintain truthful battlecards internally. Don't engage publicly. Let customer testimonials speak | ⬜ |

---

## I. Account Lifecycle

| # | Risk | Sev | Likely | Trigger | Mitigation | Status |
|---|---|---|---|---|---|---|
| I1 | **Dormant account accumulation** — free users sign up, churn silently, data piles up | Med | Certain | 6+ months post-launch | Soft-archive (read-only, no AI/SMS) after 12 months inactive. Hard-delete after 24 months with 60-day email warning | ⬜ |
| I2 | **Resurrection** — dormant user returns, expects everything intact | Low | Medium | Year 2+ | "Re-activate account" flow that restores from soft-archive. Hard-deleted accounts can't be restored — clear in deletion email | ⬜ |
| I3 | **Account takeover via abandoned email** — free user's email gets recycled by ISP, attacker re-registers | High | Low | Multi-year-old accounts | Annual session re-verification on dormant accounts. Email-change requires confirmation from old email | ⬜ |
| I4 | **Self-service deletion is irreversible** — user rage-deletes, then regrets | Med | Medium | Frustrated user | 7-day grace period on deletion. Email warning at deletion request and at 24 hrs. Confirm via authenticated email | ⬜ |
| I5 | **Successor / business sale** — free user sells their salon, new owner can't access | Low | Low-Med | Salon ownership change | Documented account-transfer process via support. Verify both parties via authenticated email | ⬜ |
| I6 | **Death of the account holder** — solo stylist passes away, family needs records | Low | Low | Tragic edge case | Documented next-of-kin process. Death certificate required for data release | ⬜ |
| I7 | **Account squatting** — free user holds the salon name, doesn't use it | Low | Medium | Inactive accounts | Salon name release after 12 months of no logins (with 60-day warning) | ⬜ |
| I8 | **Multi-account by same person** intentional (testing, family, contractors) | Low | Medium | Day 1 | Allow up to 3/IP, 1/personal-email. Manual review for legitimate edge cases | 🟡 |

---

## J. Product & Engineering

| # | Risk | Sev | Likely | Trigger | Mitigation | Status |
|---|---|---|---|---|---|---|
| J1 | **Free tier quality drift** — features broken on free because they're tested only on paid | Med | Medium | After 6 months | CI tests run with both free + paid feature flags. Internal Free Solo test account exercised weekly | ⬜ |
| J2 | **Cap-enforcement bugs** — caps don't actually fire, users get more than they should | High | Medium | Any release | Server-side cap enforcement (not client-only). Daily reconciliation report comparing usage to caps | ⬜ |
| J3 | **Migration / schema change costs** scale with user count, including free | Med | Certain | Major schema change | Backward-compatible migrations. Lazy migration on access (don't bulk-migrate dormant accounts) | 🟡 |
| J4 | **Engineering velocity drops** because of free-tier complexity | Med | Medium | Ongoing | Keep tier logic centralized in one config + one entitlements check. Avoid scattered if-free-then conditionals | 🟡 |
| J5 | **Documentation rot** — free tier features change but docs lag | Low | Medium | Ongoing | Docs versioned with releases. Quarterly docs audit | ⬜ |
| J6 | **Localization / time zones** — free user in Hawaii, support in Ohio, scheduled functions in NY | Low | Medium | First international free user | All times stored UTC, displayed in tenant TZ. Settings.timezone field per tenant | 🟡 |
| J7 | **Mobile UX gaps** — free signup happens on mobile, breaks if untested | Med | Medium | First mobile-only free signup | Signup flow tested on iOS Safari + Android Chrome. PWA install prompts work | 🟡 |
| J8 | **Internationalization** — free user signs up speaking only Spanish | Low | Low (early) | First non-English signup | English-only acknowledged at signup. i18n on roadmap, not pre-launch | ⬜ |

---

## Cross-cutting principles (the rules that apply to all of the above)

1. **Default to paid.** Every new feature ships in paid tiers first. Graduation to free requires explicit decision after 12 months.
2. **Server-side enforcement.** Every cap, every entitlement check, every limit happens on the backend. UI gates are convenience, not security.
3. **Soft-warn before hard-block.** 80% = warning, 95% = email, 100% = upgrade-or-wait choice. Never silent failure.
4. **One config to rule them all.** All tier limits live in a single `tierLimits` Firestore doc. No hardcoded numbers in feature code.
5. **Instrument first, optimize later.** Every cap, every upgrade prompt, every feature gate fires an analytics event. You can't optimize what you don't measure.
6. **Write the sunset playbook now.** Don't publish it. But have it ready before the first free signup.
7. **Caps are upgrade levers, not punishments.** Cap design should make hitting them feel like growth, not denial.
8. **Data export is always free, on every plan, forever.** This principle outranks revenue, conversion math, and competitive concerns. If a customer wants to leave because our service stopped working for them, we will not make leaving harder. The export endpoint is one click, complete (CSV + JSON), available even during pause and post-cancellation grace. Never paywalled, never gated behind support, never delayed. If a future product decision conflicts with this principle, the principle wins.
9. **Hide all implementation complexity. Salon owners only see Plume Nexus.** Salon owners never have to create accounts at, log into, configure, or even know the names of any third-party services we use under the hood (Stripe, Twilio, AWS SES, Anthropic, Gusto, Plaid, Firebase, Google Maps, etc.). The only platform they create, sign into, or get bills from is Plume Nexus. This outranks revenue, conversion math, and feature breadth. If a feature requires the salon owner to log into a third-party tool to set it up, the feature isn't done. **Single exception:** integrations that legally require user-initiated OAuth (their own Google Business Profile, an existing Stripe account they want to bring) — these still happen as a single OAuth click inside Plume Nexus, never sent to a third-party site for setup or support. **Vendor names never appear in customer-facing UI strings.** No "Powered by Stripe," no "Sent via Twilio." Engineering audits the app for leaks at every release.
10. **Founder access is by invitation only. Platform admin sees metadata, never customer data.** The Plume Nexus founder cannot read any tenant's clients, appointments, receipts, messages, marketing campaigns, or photos by default. The platform admin dashboard returns only sanitized aggregate metadata (tenant name, plan, billing, last activity, usage counts) — never PII. If a tenant wants the founder to see their data (e.g. for support), they invite him as a tenant admin via their own salon-app Admin module — the same Google-Auth flow they'd use to add any of their own staff. The tenant retains full visibility (audit log) and revocation power. **Single exception:** Meraki Nail Studio, where Jonathan VanKim is the actual salon owner — his access there is granted via the same tenant-admin role mechanism, not via any platform-admin backdoor. There is no "view as tenant" impersonation feature, no super-user override, no production data extracts. This outranks support speed, debugging convenience, and the temptation to "just take a look." If a feature lets the founder read tenant customer data without that tenant's invitation, the feature isn't done. **Engineering enforcement:** every cloud function that touches tenant data must justify why in code comments; the platform admin app calls a single chokepoint function (`getTenantMetadata`) that returns only an enumerated safe field list.
11. **Tenant URLs default to subdomains. Custom domains are an opt-in paid add-on.** Every new tenant signs up at `<salon-id>.plumenexus.com` (e.g. `sarahsbb.plumenexus.com`). The wildcard SSL cert for `*.plumenexus.com` is provisioned once at the Firebase project level — every subdomain inherits it instantly with zero per-tenant provisioning steps. **Why this matters:** custom-domain SSL minting on Firebase Hosting can get stuck (the founder's own `plumenexus.com` apex hit a 24+ hour stuck-state on 2026-05-08, requiring remove-and-re-add to recover). That same bug class is structurally impossible for subdomain tenants because there's nothing to mint. **Custom domains** (`yoursalon.com` → tenant's Plume Nexus instance) are available as a paid add-on (Studio plan and up, included in Brand Pack). When a tenant opts in, the platform admin walks them through DNS setup, monitors the cert provisioning, and has a documented "remove + re-add" runbook ready in case minting gets stuck. **Engineering enforcement:** the new-tenant signup flow assigns a subdomain by default; the custom-domain flow is a separate Settings → Branding action gated behind the right plan tier. This minimizes per-tenant ops overhead and keeps cert-provisioning risk contained to the small fraction of tenants who deliberately opt in.

---

## Pre-launch checklist (must-have before opening free signups)

- [ ] **A1** ToS clause about modifying/sunsetting free tier
- [ ] **A2** Free Solo cannot send SMS — enforced at function layer
- [ ] **A4** GDPR/CCPA self-serve data export + deletion
- [ ] **A5** DMCA agent registered with Copyright Office
- [ ] **A6** CSAM scanning on every photo upload
- [ ] **B1, B2, B4** Hard caps shipped: AI calls, storage, email
- [ ] **B5** Free SLA explicit in pricing page + ToS
- [ ] **C1** Phone verification + CAPTCHA at signup
- [ ] **C8** Firestore rules audit
- [ ] **C9** XSS pass on all free-text input fields
- [ ] **C14** DMARC strict (p=reject)
- [ ] **D1, D8** Conversion-funnel events instrumented
- [ ] **D2** Auth-level enforcement of 1-user-per-free-Solo
- [ ] **E1** Same security model for all tenants
- [ ] **E5** PCI scope verified (Stripe Elements only, no card data on our servers)
- [ ] **F1** Tax accountant consult at 1K user milestone
- [ ] **G1** AI provider abstraction layer
- [ ] **H4** Status page wired to monitoring
- [ ] **I1** Account-aging policy implemented
- [ ] **J2** Cap-enforcement tests in CI

---

## Quarterly review items

- Review tier limits against actual usage data (are caps in the right place?)
- Review per-tenant cost trends (any single tenant a runaway?)
- Review conversion funnel (free → Solo Plus → Studio → Salon Pro)
- Review support ticket volume by tier (is free generating proportional pain?)
- Review compliance landscape (new state laws, FTC actions, Anthropic policy)
- Review competitor pricing (race to the bottom indicators?)
- Review vendor pricing (any cost increases threatening margin?)
- Review dormant-account count (purge candidates?)
- Review legal action landscape (any cases against similar platforms?)

---

## Tripwire metrics (alert when these fire)

| Metric | Threshold | Action |
|---|---|---|
| Per-tenant AI cost > $10/mo on free | Single occurrence | Investigate; rate-limit hard if abuse |
| Per-tenant storage > 400MB on free | Approaching cap | Send "you're at 80%" notice |
| Outbound email bounce rate > 5% on a single send | Single occurrence | Auto-pause sender; investigate suppression list |
| Marketing chatbot calls per IP > 100 in 1 hour | Single occurrence | Auto-block IP for 24 hr |
| New free signups from same IP > 5 in 24 hr | Single occurrence | Hold for review |
| Free → paid conversion rate < 3% over rolling 90d | Sustained | Re-evaluate pricing or caps |
| Support ticket volume per free user > 0.5/quarter | Sustained | Improve docs / chatbot / signup flow |
| Stripe risk score change | Any | Immediate review |
| Anthropic API error rate > 1% | Sustained | Investigate; consider failover provider |
| 4xx rate on /book endpoint > 5% | Sustained | Likely bot/abuse; tighten rate limits |

---

## What this document is NOT

- **Not a legal opinion.** Counsel review required before any of this becomes the actual operating posture.
- **Not exhaustive.** New risks will surface. Add them.
- **Not a roadmap.** It's a risk register. Mitigations may take quarters to ship — that's fine, as long as risks are tracked.
- **Not static.** Quarterly review is the minimum cadence.

---

## Document changelog

- **v1 — 2026-05-09** — initial draft (assumed "Free Solo forever")
- **v2 — 2026-05-09** — switched to Founders' Year model. A1 ("forever" promise) downgraded Critical → Med because cohort is now bounded. A1b added (sunset for new signups). D5 (sunset crisis) downgraded High → Low because it's pre-announced. D5b added (multi-extension credibility risk). Founders' Year end date constant lives in `plumenexus/src/theme.js` as `FOUNDERS_YEAR_END_ISO`.
- **v3 — 2026-05-09** — switched to **hybrid pricing model**: 3 base tiers + 5 Power Packs + atomic add-ons escape hatch. Solo (free for Founders), Studio $79, Salon Pro $149. Packs at $19-39/mo. Atoms at $15-25 for power users. D2 (cannibalization) impact partially mitigated since cross-tier feature acquisition no longer requires tier upgrade — they buy the pack instead. New risk to track: D11 (pack-vs-atom decision paralysis if both surfaced equally) — mitigated by hiding atoms behind a "customize" toggle.
- **v4 — 2026-05-09** — added principle #9 (hide all implementation complexity). All third-party vendors (Stripe, Twilio, AWS SES, Anthropic, Gusto, Plaid, etc.) must be invisible to the customer. Salon owners only ever sign into Plume Nexus. AI website-scraping for service-menu auto-import added to roadmap as a key onboarding accelerant. Marketing claim updated to "live by lunch" with concierge-migration guarantee.
