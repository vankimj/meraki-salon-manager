# Bookable Engine — Data-Model Spec

**Status:** Proposal (2026-06-16) · **Owner:** Jonathan · **Tracks:** roadmap epic "Bookable + Resources engine"

The keystone refactor that turns Plume Nexus from a nail-salon appointment book into a
universal scheduler covering three market archetypes at once:

- **A. Appointment book** — staff ↔ client (salons, barbers, spas, chiro, lessons) — *what we are today*
- **B. Resource booking** — book a *thing* (rooms, suites, bays, courts, studios, equipment)
- **C. Class / capacity** — one provider ↔ many seats (fitness, dance, swim, workshops)

See `MULTI_VERTICAL_MARKET_MAP.md` for the market rationale. This doc is the schema.

---

## 1. The core idea

Today the schedulable axis is hardwired to **staff**: schedule columns come from the
`employees` collection (`techName`), and every appointment implicitly consumes a person at
capacity 1. (`src/modules/schedule/ScheduleAdmin.jsx`, `src/lib/booking.js`.)

Generalize that single assumption:

> A **Bookable** is anything that can be reserved for a time window. It has a `type` —
> `staff` | `resource` | `class` — and a **capacity**. A **Booking** consumes capacity on
> one or more Bookables for a time window.
>
> - `staff` → capacity 1 (one person, one client at a time)
> - `resource` → capacity 1 (one room/bay/court at a time)
> - `class` → capacity *N seats* (a roster; one Booking consumes 1 seat)

Everything else you already have — checkout, deposits, memberships, retail, payroll, the
self-booking widget, walk-in queue, reminders — hangs off Bookings unchanged.

**Non-goal:** field-service routing (archetype D), table/yield reservations (E), and
insurance/EHR clinical (F) are explicitly *out of scope* — they need different engines and
are back-burnered.

---

## 2. Glossary

| Term | Meaning |
|------|---------|
| **Bookable** | A reservable unit: a staff member, a resource, or a class series. |
| **Booking** | A reservation consuming capacity on Bookable(s) for `[start, end)`. Supersedes "appointment". |
| **Class series** | A `type:'class'` Bookable: a recurring template (e.g. "Vinyasa, Mon/Wed 6pm"). |
| **Class instance** | One dated occurrence of a class series, with its own roster + capacity. |
| **Pass / credit** | A prepaid right to consume bookings (10-class pack, unlimited monthly, 6-session series). |
| **Capacity** | Max concurrent Bookings a Bookable holds in a slot. |

---

## 3. Firestore schema

All under `tenants/{tenantId}/…`, consistent with existing `tenantCol`/`tenantDoc` helpers.

### 3.1 `bookables/{id}` — the unified schedulable unit

```jsonc
{
  "id": "bk_abc",
  "type": "staff" | "resource" | "class",
  "name": "Maya R." | "Treatment Room 2" | "Vinyasa Flow",
  "active": true,
  "locationId": "loc_x",            // multi-site (existing invariant: missing = all locations)

  // --- type:'staff' (back-compat: mirrors today's employee) ---
  "employeeId": "emp_123",          // link to employees/{id}; staff bookables are projections
  "capacity": 1,

  // --- type:'resource' ---
  "resourceKind": "room" | "bay" | "court" | "suite" | "equipment" | "table",
  "capacity": 1,
  "requiresStaff": false,           // some resources also need a person (e.g. a facial room)
  "bufferBeforeMin": 0,             // setup
  "bufferAfterMin": 15,             // cleanup/turnover

  // --- type:'class' ---
  "capacity": 18,                   // seats
  "instructorBookableId": "bk_maya",// who teaches (a staff bookable)
  "waitlistEnabled": true,
  "waitlistCap": 10,

  // --- availability (all types) ---
  "scheduleId": "sch_def",          // -> schedules/{id}; when this bookable is available
  "pricing": {                      // optional; bookings may still override per-line (existing)
    "mode": "service" | "perHour" | "perBlock" | "perSeat",
    "amount": 0
  }
}
```

**Why staff bookables are *projections* of `employees`:** payroll, comp, social, photos, RBAC
all stay on `employees/{id}` untouched. A `type:'staff'` bookable is a thin pointer so the
scheduler treats people and things uniformly without migrating the rich employee record.

### 3.2 `bookings/{id}` — supersedes appointments

```jsonc
{
  "id": "bkg_1",
  "kind": "appointment" | "reservation" | "classSeat",
  "bookableIds": ["bk_maya"],       // 1 for staff/resource; for class, the class bookable
  "classInstanceId": null,          // set when kind:'classSeat'
  "locationId": "loc_x",

  // who (generalized "client") — see §6 for pet/subject
  "clientId": "cl_9", "clientName": "Emma K.",
  "clientPhone": "…", "clientEmail": "…",

  // when
  "date": "2026-06-20", "startTime": "10:00", "duration": 60,

  // what (UNCHANGED from today's appt.services[])
  "services": [{ "name": "Gel Mani", "price": 48, "duration": 60, "optionId": null }],

  // money (UNCHANGED — deposits, checkout, receipts all reuse)
  "deposit": { "amount": 0, "status": null, "mode": null },
  "passId": null,                   // if redeemed from a pass/credit (archetype C/B)

  // existing fields preserved
  "status": "scheduled", "notes": "", "recurringGroupId": null,
  "bookingGroupId": null, "lane": null, "laneShape": null   // multi-lane (group booking)
}
```

**Migration shim:** keep reading `appointments/{id}` during transition; new writes go to
`bookings/{id}`; a `kind:'appointment'` booking with a single `type:'staff'` bookable is
*byte-for-byte equivalent* to today's appointment. (See §7.)

### 3.3 `classInstances/{id}` — one dated occurrence of a class series

```jsonc
{
  "id": "ci_555",
  "classBookableId": "bk_vinyasa",
  "date": "2026-06-20", "startTime": "18:00", "duration": 60,
  "instructorBookableId": "bk_maya",
  "capacity": 18,
  "rosterCount": 14,                // denormalized for fast availability
  "waitlist": ["cl_22", "cl_31"],   // ordered; auto-promote on cancel
  "status": "scheduled" | "cancelled",
  "locationId": "loc_x"
}
```

Generated from the class series' `scheduleId` (recurring grid) on a rolling horizon, the same
way demo future-appointments are generated today (`src/data/seedDemo.js` pattern).

### 3.4 `passes/{id}` — prepaid consumption (extends memberships)

```jsonc
{
  "id": "pass_7",
  "clientId": "cl_9",
  "kind": "pack" | "unlimited" | "series",
  "name": "10-Class Pack" | "Unlimited Monthly" | "6-Session Laser",
  "creditsTotal": 10,               // null for unlimited
  "creditsUsed": 3,
  "appliesTo": { "bookableIds": [], "serviceIds": [], "any": true },
  "validFrom": "2026-06-01", "validUntil": "2026-09-01",
  "membershipId": null,             // link if granted by a recurring membership
  "status": "active" | "expired" | "exhausted"
}
```

Today `memberships/{id}` is **flat recurring only** (no consumption tracking). Passes add the
decrement-on-use layer that classes (C), session series (med-spa adjacency), and resource
multi-packs (B) all need. A redemption is: `booking.passId = pass.id` + atomic
`creditsUsed += 1` in the same `writeBatch` as the booking write.

### 3.5 `schedules/{id}` — availability windows (all types)

```jsonc
{
  "id": "sch_def",
  "weekly": [{ "dow": 1, "open": "09:00", "close": "20:00" }, …],
  "exceptions": [{ "date": "2026-07-04", "closed": true }],
  "timeOff": [{ "start": "…", "end": "…" }]   // staff PTO; resource maintenance; class cancellations
}
```

Unifies today's per-employee working hours + time-off into one shape reused by resources and
class series.

---

## 4. How each archetype maps

| | Bookable.type | capacity | Booking.kind | Distinctive need |
|---|---|---|---|---|
| **A — Appointment** | `staff` | 1 | `appointment` | (today) optional `resource` co-booking for rooms/bays |
| **B — Resource** | `resource` | 1 | `reservation` | `requiresStaff`, buffers, per-hour pricing, no person required |
| **C — Class** | `class` | N | `classSeat` | roster + waitlist + pass redemption + per-head instructor pay |

**Co-booking (A∩B):** a facial appointment needs *Maya* **and** *Room 2*. A booking with
`bookableIds: ["bk_maya", "bk_room2"]` reserves both; availability = intersection of both
calendars. This one mechanic also handles "any open room" by resolving a resource *pool* at
book time.

---

## 5. Availability computation

A slot `[start, end)` is bookable on Bookable `b` iff:

1. Within `b.schedule.weekly`, minus `exceptions`/`timeOff`.
2. `concurrentBookings(b, slot) + 1 ≤ b.capacity` (staff/resource: <1; class: <seats).
3. Respects `bufferBeforeMin`/`bufferAfterMin` (resource turnover).
4. For multi-bookable bookings: the slot is free on **every** required bookable (intersection).
5. Pass redemption (if any): `pass.status==='active'` and `appliesTo` matches.

This generalizes `src/lib/booking.js`'s `techsForServices` + slot logic; the staff path stays
a special case (capacity 1, single bookable).

---

## 6. Client vs subject (pet/owner) — forward hook

Archetypes A/B/C are human-client. Pet grooming/vet (back-burner) need **owner → pets**. Reserve
the seam now without building it: a Booking already carries `clientId`; add an optional
`subjectId` (→ a future `subjects/{id}` for pets/vehicles/etc.) so the model doesn't need a
second migration later. Not implemented in this phase.

---

## 7. Migration & backward-compat

**Invariants (do not break):**
- Existing `appointments/{id}` keep working until fully cut over. Dual-read during transition.
- `employees/{id}` is the source of truth for people; staff bookables are projections.
- Multi-location rule preserved: missing `locationId` = all locations.
- `bookingGroupId`/`lane`/`laneShape` (group booking) and `recurringGroupId` carry over verbatim.

**Steps:**
1. Introduce `bookables` + backfill one `type:'staff'` bookable per active employee.
2. Write a `bookings` adapter: new appointments write to both shapes; readers prefer `bookings`.
3. Ship `resource` type (B) — no class work yet.
4. Ship `passes` (extend memberships UI).
5. Ship `class` type + `classInstances` (C).
6. Flip the schedule grid + booking widget to read `bookings`; retire `appointments` writes.

Each step is independently shippable and reversible (pre-production, clean-break OK per
`project_pre_production`).

---

## 8. What explicitly stays the same

Checkout/POS, deposits (3 modes), receipts, retail+inventory, tips & multi-tech splits,
payroll comp (commission/hourly), reminders/notifications, the self-booking widget shell,
walk-in queue + turn rotation, reports/ledger. They consume Bookings; they don't care what
type the Bookable is.

---

## 9. Open decisions

1. **Hard cut vs dual-write** for the appointments→bookings migration (pre-prod favors hard cut).
2. **Instructor pay-per-head** — extend the comp model now or defer to the Class epic.
3. **Resource pools** ("any open room") — book-time resolution vs explicit pick.
4. **Pass sharing** (family/household passes) — defer.
5. Whether `type:'staff'` bookables are a real collection or a *view* computed from `employees`
   (a view avoids sync bugs but complicates queries).
