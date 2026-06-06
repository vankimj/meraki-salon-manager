# 💳 Stripe vs. Helcim — Salon Owner Battle Card

Companion to `HELCIM_INTEGRATION_PLAN.md`. Source copy for the future in-app
"choose your processor" screen. All rates illustrative — interactive model in
`payments-economics-calculator.html`.

### The one-line framing
> **Helcim = lower fees, but you give up Tap-to-Pay and accept variable per-transaction cost.
> Stripe = predictable flat fees and phone-as-reader, but you pay more per swipe.**

---

### Head-to-head

| What the owner cares about | **Stripe** | **Helcim** | Edge |
|---|---|---|---|
| Effective in-person rate | ~2.7% + 5¢ (flat) | ~1.93% + 8¢ (interchange-plus avg) | 🟢 Helcim |
| Effective online rate | 2.9% + 30¢ (flat) | ~2.49% + 25¢ (avg) | 🟢 Helcim |
| Predictability | 🟢 Flat — same % on every card | 🔴 Variable — cost swings with card type | 🟢 Stripe |
| Tap to Pay on iPhone (phone = reader) | 🟢 Yes | 🔴 No — not offered at all | 🟢 Stripe |
| Hardware to start | 🟢 **$0** (Tap to Pay on iPhone), or M2 ~$59 | 🔴 **$199 floor** (Card Reader); Smart Terminal $349 | 🟢 Stripe |
| Monthly fee / contract | None | None | ⚖️ Tie |
| Fee transparency | Blended rate, simple | 🟢 Itemized interchange breakdown | 🟢 Helcim |
| Surcharging (pass fees to client) | Limited | 🟢 Built-in surcharging tools | 🟢 Helcim |
| Payouts | 2-day standard; instant available | Next-business-day typical | 🟢 Stripe |
| Best fit | Lower volume / lower tickets / simplicity | Higher volume / higher tickets — IC+ savings compound | depends |

---

### The cost story ("lower but variable")

- Helcim uses **interchange-plus**: card network's true cost (**interchange**, differs per card)
  **+ a small fixed Helcim markup** (e.g. +0.40% + 8¢ in person).
- The **markup is fixed**; the **interchange underneath moves**. Debit ≈ ~1.2% all-in; premium
  rewards card ≈ ~2.4%. **Blended cost rides on the client card mix.**
- Stripe charges a flat 2.7% on every card — predictable, but you pay more on cheap cards.

**$30,000/mo in-person example:**

| | Monthly cost | vs. GlossGenius ($780) |
|---|---:|---:|
| Stripe (flat) | ~$835 | +$55 |
| **Helcim (avg)** | **~$619** | **−$161 cheaper (~$1,900/yr)** |

A heavy-rewards-card month might run Helcim ~$650 instead of $619 — still well under Stripe,
just not a fixed number.

---

### The Tap-to-Pay trade (sharpest deciding factor)
- **Stripe:** tap card/phone **on the iPhone itself** — no dongle, **$0 hardware**, hand-to-any-tech.
- **Helcim:** **no Tap to Pay** — must buy + maintain hardware: **Card Reader $199** (Bluetooth, cheapest)
  or **Smart Terminal $349** (+ ~$7/mo data if not on Wi-Fi, after 2026-04-01).

Honest trade: **Helcim's lower fees vs. Stripe's zero-hardware convenience.** A salon recoups the $199
reader in ~5–6 weeks of Helcim savings at $30k/mo volume — but it's still real upfront friction.

---

### Who should pick what

**✅ Helcim** — higher volume/tickets, fee-sensitive, OK buying a terminal, wants surcharging,
values itemized statements.

**✅ Stripe** — smaller/newer, wants zero hardware (Tap to Pay), wants predictable flat fees,
roaming/mobile checkout, wants instant payouts.

---

### Talk track
> *"Two ways to take cards. **Stripe** is the easy button — tap cards right on your iPhone, no
> hardware, flat predictable fees. **Helcim** is the saver — noticeably lower processing fees, but
> you'll buy a small countertop terminal and your cost varies a little by card type. Low-volume or
> want zero hardware? Stripe. High-volume and want the lowest fees? Helcim. Start on Stripe today
> and switch later."*

---

### Platform-side note (not shown to the owner)
- On Helcim **you can't set your own markup** — revenue is Helcim's profit-share (you don't control it).
- On Stripe you control the application fee, **but** today's code defaults it to 0, so you currently
  absorb Stripe's fee. See `HELCIM_INTEGRATION_PLAN.md` §6.2/§6.5.
- In-person hardware is **processor- and platform-locked** either way — a salon migrating from
  GlossGenius/Square/etc. brings its *data*, never its readers.
