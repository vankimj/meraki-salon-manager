# Multi-Vertical Market Map

**Status:** Strategy (2026-06-16) · **Owner:** Jonathan
**Companion:** `BOOKABLE_ENGINE_SPEC.md` (the engine that unlocks A/B/C)

How far Plume Nexus's scheduling engine can stretch beyond nail salons — what's *the same
product*, what's *a new engine*, and what's *a different company*.

---

## 1. The thesis

Plume Nexus is an **appointment book**: staff columns × time slots, a service menu
(price/duration), checkout, a client record. Whether a new industry is a *modification* or a
*different product* is decided by five questions:

1. **What's the bookable unit?** A person, a room/table/bay, a class seat, or a truck on a route?
2. **What's the "service"?** Fixed menu, custom quote, recurring plan, or a class?
3. **What's the record?** Person, pet, property, or party?
4. **Regulatory load?** None → HIPAA + insurance claims.
5. **One- or two-sided?** Does the platform also have to *bring the demand*?

The further from "person × slot, no compliance, we already have the customer," the more it
stops being a modification.

---

## 2. The six archetypes

| | Archetype | Bookable unit | Fit | Verdict |
|---|---|---|---|---|
| **A** | Appointment book | staff | 🟢 | **Our product.** Dozens of industries, near-term. |
| **B** | Resource booking | room/bay/court/suite | 🟡 | Same product **after** the Bookable refactor. |
| **C** | Class / capacity | class seats | 🟡 | Same product + class engine + passes. Biggest market. |
| **D** | Field service / dispatch | crew on a route | 🟠 | **Net-new engine** (routing) — viable, no compliance. Back-burner. |
| **E** | Reservation / yield | tables / covers | 🔴 | Different product; two-sided demand moat. Integrate-only. Back-burner. |
| **F** | Clinical / regulated | provider + room | 🔴 | EHR + claims + HIPAA = different company. Cash-pay edge only. Back-burner. |

**This doc focuses on A + B + C.** D/E/F are tracked but parked.

---

## 3. A — Appointment book (our product, just wider)

The engine already serves this. Breadth is unlocked by **Vertical Config** (terminology +
service templates), **Forms** (clinical-lite intake/consent), and **chair-rent comp**.

| Sub-segment | Incremental need |
|---|---|
| Barber / spa / lash / brow / wax / tattoo | Vertical config; chair-rent comp; (tattoo) deposits ✓ already |
| Chiropractic / acupuncture / PT / massage / therapy | Forms + SOAP-lite charting; recurring care plans |
| Tutoring / music & driving lessons / photography | Terminology only — engine fits as-is |
| Auto detailing / oil change / opticians | A bay/chair = a resource (bleeds into B) |

**Compete with:** Square Appointments, Acuity, Vagaro, GlossGenius, Boulevard, Fresha.
**Edge they lack:** integrated POS + payroll/1099 + retail + multi-tech splits + walk-in +
deposits. Point schedulers have no back office.
**Distance:** weeks (Vertical Config is the unlock).

---

## 4. B — Resource booking (the unit is a *thing*)

Bookable = a room/bay/court/suite/studio/equipment. Capacity 1, but **staff is optional or
absent** — the new wrinkle vs today's "a person is always booked."

**Needs:** generic Resource bookable + resource calendars, time-slot/duration inventory,
per-hour/per-block pricing, buffers (turnover/cleanup), optional add-on staff, waivers.
Checkout/deposits/memberships **reuse as-is**.

| Sub-segment | Note |
|---|---|
| **Salon-suite rental** | Same customer you already have — rent suites to independent stylists |
| Coworking / meeting rooms | Skedda's core |
| Golf sims, pickleball/tennis courts, batting cages | Court/bay inventory |
| Escape rooms, recording/photo studios | Per-block pricing + waivers |
| Equipment / bike / kayak rental, event venues | Per-block + deposit (have) |

**Compete with:** Skedda, Resova, Peek, FareHarbor, Acuity.
**Distance:** ~1 quarter, gated almost entirely on the Bookable/Resource abstraction.

---

## 5. C — Class / capacity (the big prize)

Bookable = a class series on a recurring grid; capacity = N seats; a booking consumes 1 seat
**+ 1 pass/credit**.

**Needs (the real net-new work):**
- Class schedule templates (recurring weekly grid → dated instances)
- Capacity + roster + waitlist with auto-promote
- **Passes / credits / packs / unlimited** — extends memberships (today flat-recurring only)
- Check-in, late-cancel/no-show fees (card-on-file ✓), instructor **pay-per-head** (comp extension)
- (advanced) spot/equipment selection

| Sub-segment | Note |
|---|---|
| Yoga / pilates / spin / HIIT / CrossFit | Mindbody's core; hated incumbent |
| Dance / martial arts / swim schools | Roster + packages + minors (guardian record) |
| Music & cooking classes, workshops | One-off + series |

**Compete with:** Mindbody (entrenched, disliked, expensive), Glofox, Momence, Walla, Pike13,
Punchpass; ClassPass on demand.
**Why attractive:** huge TAM, hated incumbent, and Mindbody's weak spots (POS, retail,
payroll, modern UX) are exactly Plume's strengths.
**Distance:** ~1 quarter on top of B — the largest build, the largest market.

---

## 6. Required engines → what each unlocks

| Engine (roadmap epic) | Unlocks | Effort |
|---|---|---|
| **Vertical Config & Terminology** | breadth of **A** | S |
| **Bookable + Resources** (keystone) | all of **B**, rooms/bays in **A** | M |
| **Passes / Packages / Credits** | **C**, multi-visit in A/B, med-spa series | M |
| **Class Scheduling** | **C** | M–L |
| **Forms / Intake / Consent / e-Sign** | clinical-lite **A**, waivers in **B**/**C** | M |

---

## 7. Build sequence

| Phase | Build | Unlocks |
|---|---|---|
| 0 | Vertical Config (wire the dormant `industry` field) | A breadth |
| 1 | Bookable + Resource abstraction | B + A-rooms |
| 2 | Passes / Packages | C + A/B multi-visit |
| 3 | Class Scheduling | C |
| ∥ | Forms engine (parallel) | clinical-lite A, B/C waivers |

**Discipline:** spend on the Bookable abstraction, not per-vertical bolt-ons. Every A/B/C
industry keys off it — consistent with the committed "generalize, don't fork" principle
(`project_custom_build_service`).

---

## 8. How far off — honestly

- **A:** essentially now + a few weeks of config.
- **B:** ~1 quarter, gated on the Resource abstraction.
- **C:** ~1 quarter more, but the biggest single market (fitness).
- **A+B+C is one product, ~2 quarters of focused work.**

---

## 9. Positioning

> *"Run any business that books a person, a space, or a class — with POS, payroll, retail,
> and marketing built in."*

That integrated back office is the wedge against Acuity (A), Skedda (B), and Mindbody (C)
**simultaneously** — none of them have it.

---

## 10. Back-burner (tracked, not pursued)

- **D — Field service / routing** (lawn, cleaning, HVAC, pest, mobile detailing): net-new
  routing engine (Google Distance Matrix + Route Optimization), property model, crew dispatch,
  truck-first mobile. *No compliance.* The most attractive of the parked three; revisit after
  A/B/C. Competes with Jobber / Housecall Pro / ServiceTitan.
- **E — Reservation / yield** (restaurants, OpenTable/Resy): different primitives (tables,
  covers, turn-time, waitlist) + a two-sided demand moat. APIs are partner-gated. Integrate,
  don't rebuild.
- **F — Clinical + insurance** (dental, primary care, vet-with-Rx): scheduling is ~15% of the
  product; EHR + claims + HIPAA is the rest. Only the **cash-pay aesthetic** edge (cosmetic
  dentistry, med-spa) is reachable, via the A/Forms path.
