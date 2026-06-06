# Front-Desk Kiosk Checkout (native iPad) — Plan

## Goal
The front-desk iPad runs the native app in **kiosk mode** (tip display). When a tech
taps **"Send to front desk"** on an appointment from her station, the kiosk
**auto-switches** to a **customer-facing checkout**: itemized services + tax + total,
a **tip** selector, then **Pay → Cash or Card**. Cash shows **change due**; Card uses
the **M2 Bluetooth reader** (Stripe Terminal) or the client's **card on file**. On
success it writes the canonical receipt (→ SMS + Reports) and **returns to the tip
display**.

## Decisions (2026-06-05)
- Kiosk = **native iPad app** (iPad-first; only path to a physical reader on the kiosk).
- Desk device = **iPad + Stripe M2 Bluetooth reader**. (No tap-to-pay — iPad can't; that's iPhone-only.)
- Cross-device signal = a Firestore **checkout session** doc the tech writes and the kiosk subscribes to.

## Architecture
- **Session doc:** `tenants/{tid}/data/checkoutSession` (single active session; simplest).
  Shape: `{ status: 'pending'|'paying'|'done'|'cancelled', cart: {appts, products}, clientId, clientName, createdBy, createdAt, totalsSnapshot }`.
- **Tech side:** "Send to front desk" writes the session from the appt/tab.
- **Kiosk side:** a `KioskScreen` subscribes to the session; idle → tip display; active session → customer checkout.
- **Shared money/receipt logic:** extract `CheckoutScreen.complete()` into `lib/completeSale.js` so the tech checkout AND the kiosk checkout write identical receipts (no duplicated split/tip/ccFee logic).

## Phases
- **P1 — Core takeover + cash + reader** (this build):
  - `lib/checkoutSession.js` + Firestore helpers (set/subscribe/clear).
  - Extract `lib/completeSale.js` (receipt writer) from CheckoutScreen.
  - `KioskScreen`: idle state + subscribe; renders customer checkout on active session.
  - Customer checkout UI: summary, tip selector, Pay → Cash (tendered + change) / Card (reuse `CardPayButton` → M2 reader).
  - Tech "Send to front desk" action (appt detail / tab).
  - On done: write receipt, clear session, return to idle.
- **P2 — Card on file:** charge the client's saved Stripe payment method (off-session PaymentIntent). Needs saved-card infra on mobile (web has SavedCardsTab).
- **P3 — Tip-display port:** bring the actual TipFlow slideshow into the kiosk idle state (today: a branded idle screen).
- **P4 — Polish:** kiosk lock (no nav away), customer-friendly chrome, receipt delivery prompt on the kiosk.

## Notes / guards
- Reuse `computeTotals` (already shared) — never re-derive money math.
- The receipt carries `apptIds` (dedup) + `clientPhone` (fires SMS) — same contract as today.
- Kiosk is customer-facing: no admin nav, no PII beyond the sale.
