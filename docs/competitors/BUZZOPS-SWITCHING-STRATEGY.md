# Switching a BuzzOps gym to Plume Nexus — hurdles & the winnable owner

**Updated:** 2026-06-28. Companion to [`FINDINGS.md`](FINDINGS.md), [`../migration/MIGRATION-PLAYBOOK.md`](../migration/MIGRATION-PLAYBOOK.md), [`../migration/STRIPE-VS-AUTHNET-BATTLECARD.md`](../migration/STRIPE-VS-AUTHNET-BATTLECARD.md). Assumes the **payment-migration path is solved** (Stripe imports the Authorize.Net CIM vault) and asks: *what else stops a BuzzOps owner, and who can we actually win?*

---

## The core problem: BuzzOps owners aren't in pain

Unlike Mindbody (resented) or Vagaro (up-charge gripes), the [BuzzOps review trail](FINDINGS.md) is *happy* — operator-built, great support, 5-star. **We're not rescuing them from a fire; we're asking a content owner to take on switching risk.** That reframes the whole approach: a frontal assault on a satisfied 24/7 gym loses. We win specific owner *profiles* with a specific positive pull — not "we're marginally better."

---

## Hurdle set 1 — gym features we don't have (some are hard dealbreakers)

Plume Nexus has salon DNA (clients + appointments + services). BuzzOps is full gym-ops. The gaps that stop a switch cold, worst first:

1. **Door / access control — the hardest dealbreaker.** A 24/7 keyfob/app-entry gym physically cannot leave BuzzOps for software that can't unlock the door. If the target runs unstaffed hours, the conversation ends before it starts.
2. **A memberships model.** Gyms run on recurring tiered memberships — contracts, freezes/holds, family plans, prepaid packages, account credits. Our model has clients/appointments/services but **no memberships/plans/contracts object**. Structural, not cosmetic.
3. **Class scheduling with capacity + waitlist + check-in.** Group fitness is reservations against a capacity, not a salon day-grid of tech columns ([`ScheduleAdmin.jsx`](../../src/modules/schedule/ScheduleAdmin.jsx) is a tech-column day view).
4. **Native member app.** Members expect to book, check in, and see their membership on their phone. We have a kiosk, not a member app ([known gap](competitor-landscape.md)).
5. **POS / retail** for supplements, merch, drinks — already on our [roadmap](competitor-landscape.md), live for them.

## Hurdle set 2 — trust & risk (bite even if features matched)

- **Zero gym references.** Flagship tenant is a nail studio; a gym owner's first question is "who like me uses this, and is it built for gyms?" Honest answer today: nobody yet. Steepest non-feature hill.
- **"Will you exist in two years?"** — the exact gripe leveled at BuzzOps, and we're smaller/newer. Status-quo bias is brutal when revenue's on the line.
- **Support fear.** BuzzOps's most-praised trait is personal, founder-level support. We'd have to *visibly out-support*, not match.
- **Migration completeness beyond cards.** Even with cards solved, owners fear losing membership terms, contract end dates, freeze status, visit history, prepaid balances. A botched import = members blaming the owner.
- **Staff retraining + member re-download.** Front desk knows BuzzOps; members have the app and habits. Every "why did you change this?" lands on the owner.

---

## Who we can actually convince (aim here, not at 24/7 gyms)

1. **Boutique / by-appointment PT or small-group studio.** 1–3 trainers, 1:1 or small-group, *staffed* hours, no turnstiles. Appointment-shaped — exactly what Plume already does well — and BuzzOps is heavy, over-built ops for them. **This is the wedge, and it's the same PT vertical we're already chasing.**
2. **Multi-service / hybrid owner.** Fitness *plus* recovery/massage, aesthetics, retail, wellness. BuzzOps is gym-only; our **one-tool-multi-vertical** story is a structural advantage no gym-only platform can answer.
3. **Small, price-squeezed operator** paying $350–550 loaded on BuzzOps for more platform than they use, who'd drop to flat $29–129 — *if* we cover their actual needs.

## What actually convinces that owner (value stack, by pull)

1. **"One tool for your whole business."** For multi-service owners this is the knockout — consolidate BuzzOps + a coaching app + Venmo/payments into one. BuzzOps can't follow them across verticals.
2. **"We move you over for free — including your members' cards — and you run both systems for two weeks until you trust it."** De-risking beats feature-bragging for a nervous owner; mirror BuzzOps's own onboarding promise back at them.
3. **Real money saved**, shown as *their* number: loaded BuzzOps bill vs. our flat price, annualized.
4. **Founder-led, obsessive support** — a promise with Jonathan's name on it. Neutralizes their favorite thing about BuzzOps.
5. **The "billing vs. coaching" wedge** — the one real BuzzOps gripe is "it bills, you bolt on other tools to actually coach." When we build the programming side, an owner stitching BuzzOps + a coaching app can collapse it into us.

---

## Strategic recommendation

**Don't chase 24/7 access gyms yet** — that requires building access control, a memberships engine, class capacity, and a member app, and even then we'd fight happy customers with no references. Aim the entire motion at the **boutique/appointment PT studio and the multi-service hybrid owner**, where our existing strengths *are* the pitch and BuzzOps is overkill or single-vertical. Land **2–3 of those as reference customers**, then the credibility exists to move upmarket — at which point access control + memberships become worth building because real demand is pulling them.

---

## Proposed roadmap cards (the "move upmarket" enablers)

Gated behind landing boutique reference customers — track them so the upmarket path is visible, but don't build ahead of demand. Ready-to-run `gh` script: [`create-buzops-roadmap-cards.sh`](create-buzops-roadmap-cards.sh) (run from VS Code / a shell with `gh` authed — see note below).

| Card | Why it's the gate | Labels | Column |
|---|---|---|---|
| **Memberships & recurring-billing model** (plans, tiers, contracts, freezes, family plans, prepaid packages, account credits) | No gym runs without it; structural data-model gap | `feature`, `p2` | Backlog |
| **Class scheduling: capacity, waitlist, check-in** | Group fitness core; our schedule is a salon day-grid | `feature` | Backlog |
| **Door / access-control integration** (keyfob / app entry, 24/7 unstaffed) | Hard dealbreaker for any 24/7 gym | `feature`, `infra` | Backlog |
| **Native member app** (book classes, check in, view membership/billing) | Member-facing table stakes vs. BuzzOps native apps | `feature`, `mobile` | Backlog |

> **Note:** these cards could not be created from the Cowork desktop session — `gh` isn't available/authenticated here. Create them from Claude Code in VS Code (where `gh` is authed) by running the script above, or have Claude in VS Code add them.

---

### Sources
- [`FINDINGS.md`](FINDINGS.md) — BuzzOps review profile (happy, operator-built, great support)
- [`competitor-landscape.md`](competitor-landscape.md) — Plume Nexus honest gaps (native app, exercise library, AI program-gen, CRM); multi-vertical positioning
- [Buzops — G2 profile](https://www.g2.com/products/buzops/reviews) (feature set: memberships, native apps, 24/7 access control, POS, CRM)
