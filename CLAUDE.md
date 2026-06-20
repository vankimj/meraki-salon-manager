# Plume Nexus Salon Manager — Claude Context

## What this is
**Plume Nexus Salon Manager** is a multi-tenant salon-management SaaS, owned by Jonathan (jvankim@gmail.com). The first production tenant is **Meraki Nail Studio** (Columbus, OH), which is replacing GlossGenius. Built with React 19 + Vite 8 + Firebase (Firestore + Auth + Hosting).

The underlying Firebase project ID is still `plumenexus-prod` — Firebase project IDs cannot be renamed without a full project migration. User-visible branding everywhere else is "Plume Nexus Salon Manager". Any remaining references to "meraki" in the codebase refer specifically to the Meraki Nail Studio tenant (its slug, its data path, its brand assets).

**Live URL (platform):** https://plumenexus-prod.web.app (Firebase-issued; routed via `*.plumenexus.com`)  
**Live URL (Meraki tenant):** https://merakinailstudio.plumenexus.com  
**Firebase project:** `plumenexus-prod`  
**Meraki tenant slug + doc ID:** `merakinailstudio` (the same value is both)

---

## Build & deploy
```bash
npm run build                        # Vite build → dist/
firebase deploy --only hosting       # Push to Firebase Hosting
firebase deploy --only firestore:rules  # Push Firestore security rules
npm run dev                          # Local dev server
npm test                             # Vitest unit tests
```

No CI/CD — all deploys are manual from the local machine.

---

## Architecture

### Two app modes
| Mode | Container | Purpose |
|------|-----------|---------|
| **TipFlow (kiosk)** | Fixed 700×620 card, centered | Front-desk iPad tip display |
| **Management** | Full viewport (100vw × 100vh) | Admin/staff tools |

Switching between modes is controlled by `view` state in `src/App.jsx`. The `#deck-app` div adapts its CSS (`alignSelf: stretch` for management vs fixed size for TipFlow). Splash renders once on mount inside the same div.

### State & auth
- `src/context/AppContext.jsx` — single global context: slides, users, settings, gUser (Firebase auth), syncState, toast
- Auth: Google sign-in only (for now). `ALLOWED_EMAILS = ['jvankim@gmail.com']` in `src/lib/firebase.js` is the bootstrap admin.
- Role system stored in Firestore `tenants/meraki/data/users` doc: `role` = `'admin' | 'readonly' | 'pending' | 'denied'`
- Auto-logout timer: configurable (default 5 min inactivity), resets on user interaction
- `isAdmin` = gUser is bootstrap admin OR has `role: 'admin'`
- `isReadOnly` = role is `'readonly'`

### Firestore structure
```
tenants/meraki/
  data/slides        — TipFlow slide array + def/cur indexes
  data/users         — staff user array with roles
  data/settings      — { timeoutMin }
  services/{id}      — service menu items
  clients/{id}       — client profiles
  employees/{id}     — employee profiles
  appointments/{id}  — appointments
  logs/{id}          — activity log entries
```

**Critical path rule:** `tenantDoc(path)` builds doc refs as `doc(db, 'tenants', TENANT_ID, 'data', ...path.split('/'))` — this maintains an even segment count (Firestore requires even segments for documents). Collections use `tenantCol(path)` = `collection(db, 'tenants', TENANT_ID, path)`.

**Index gotcha:** `where(field) + orderBy(differentField)` requires a composite index in Firestore. Avoid by filtering with `where` alone and sorting client-side. Example already fixed in `fetchAppointments`.

### Photo/image storage
Photos (client `picture`, employee `photo`, TipFlow slide `img`) are stored as **base64 strings** directly in Firestore documents. `resizeImg(file, w, h, quality)` in `src/utils/helpers.js` compresses before storing.

---

## Module map

| View key | File | Notes |
|----------|------|-------|
| `home` | `src/components/HomeScreen.jsx` | Tile grid + Launch TipFlow button. Content max-width 760px centered. |
| `tipflow` | `src/modules/tipflow/TipFlow.jsx` | Kiosk slide show. Slides edited via `SlideModal.jsx`. Can import from employee records. |
| `schedule` | `src/modules/schedule/ScheduleAdmin.jsx` | Day view grid. SLOT_H=40px, 9am–8pm, 30-min slots. Tech columns from Firestore employees (fallback hardcoded). Birthday banner on match. |
| `clients` | `src/modules/clients/ClientsAdmin.jsx` | Client list + modal (Profile / Social / Visits tabs). View-only and edit modes. `picture` field = base64 or URL. |
| `services` | `src/modules/services/ServicesAdmin.jsx` | Service menu CRUD. |
| `employees` | `src/modules/employees/EmployeesAdmin.jsx` | Employee profiles: name, photo, contact, social (instagram, facebook, tiktok, venmo, homepage), compensation (admin-only). `EmpAvatar` exported. |
| `admin` | `src/modules/admin/Admin.jsx` | Overlay (zIndex 50). Tabs: users, logs, settings. Settings tab has Demo Data section. |

### Shell components
- `src/components/ModuleShell.jsx` — top nav bar (← Home | icon + title | sync dot + admin gear + avatar) wrapping all management modules
- `src/components/Splash.jsx` — dark bg (#0f1923), Great Vibes + Cinzel fonts, nail polish SVG flourish logo, 2.6s display + 0.7s fade
- `src/components/Header.jsx` — used only inside TipFlow (slide dots, fullscreen toggle, user chip)

---

## Real salon data

**10 nail techs:** Yasmin D, Audriana L, Samantha T (@gelxbysammy), Tess D, Elizabeth L, Yan W, Jen T (@kidcozynails), Marisela I (@licenced2polish), Ana P, Jenesis B

Seeded via `src/data/seedEmployees.js` (run once manually, not part of demo seed).

---

## Demo data system (`src/data/seedDemo.js`)

Three exported functions, all triggered from Admin → Settings → Demo Data:

| Function | What it does |
|----------|-------------|
| `seedDemoData()` | Creates 500 regular + 100 celebrity clients, then ~1,200 past appointments (90 days, 30% walk-ins) + ~1,350 future appointments (90 days, per-tech scheduling). Takes 10–15 min. |
| `addFutureAppointments()` | Top-up: fetches existing demo client IDs, adds days 91–120. Fast (~1 min). |
| `clearDemoData()` | Deletes all records with `_demo: true`. Uses single `where('_demo','==',true)` queries (no composite index needed). |

**Future appointment model:** For each day, a random `salonFactor` × per-tech random `techFactor` × `maxPerTech` (6 weekday, 7 weekend) = 0–100% utilization per tech. Times are spread evenly through 9am–6pm by slot index.

**Celebrity clients** (`_celebrity: true`): 100 real celebrities with real Instagram handles, birthdays, `randomuser.me` portrait URLs (women/0–99), and VIP salon notes. Each guaranteed 2–4 past appointments + ~40% chance of future appointment.

**Walk-ins** (past only): `clientId: ''`, `clientName: 'Walk-in'`.

All demo records tagged `_demo: true` for targeted deletion.

---

## Fonts (loaded in `index.html`)
- **Great Vibes** — cursive script, used for "Meraki" in Splash and logo mark
- **Cinzel** — serif caps, used for "NAIL STUDIO" / "Salon Manager" labels

---

## Key patterns & conventions

- **Clickable links, ALWAYS (in replies to Jonathan).** Every file path, URL, dashboard (EAS/GitHub/Firebase), and console destination must be a markdown link — `[name](src/path#Lnn)` for files, `[text](https://…)` for URLs — never plain text or prose like "go to Firebase Console → Auth". He works in the VSCode extension where links are clickable; plain text forces manual navigation. He has asked for this many times — this is non-negotiable, scan every reply before sending.
- **No comments** unless the WHY is non-obvious.
- **All styling is inline** (`style={{...}}`). No CSS modules, no Tailwind.
- **Brand colors:** Green `#2D7A5F`, Blue `#3D95CE`, Teal `#3D9E8A`
- **No TypeScript** — plain JS/JSX throughout.
- Firestore writes always include `updatedAt: new Date().toISOString()`.
- `logActivity(action, details)` from `src/lib/logger.js` for audit trail.
- `showToast(msg)` from `useApp()` for transient user feedback.

---

## Task tracking — Kanban board (source of truth)

**All task/roadmap tracking lives on the GitHub Projects board, and Claude keeps it current every session.**

- **Board:** https://github.com/users/vankimj/projects/1 ("Plume Nexus Roadmap")
- **Cards are real GitHub issues** in `vankimj/Plumenexus-Salon-Manager`. Reference `Closes #NN` in PRs to auto-move a card to Done.
- **Columns** = the `Status` single-select field: Backlog → Todo → In Progress → In Review → Security Review → QA / E2E → Staging → Done, plus **Blocked** (holding lane for cards waiting on an external dependency).
- **Security Review is a hard gate** — nothing reaches Done without passing it (PII/payroll/Stripe is the #1 concern).

**Every session must, without being asked:**
1. At start, if the user is picking up roadmap/feature work, glance at the board (`gh project item-list 1 --owner vankimj`) to ground next steps.
2. When work begins on a card, move it to **In Progress**; when a PR is open, **Review**; when merged/shipped, **Done**.
3. When the user describes new work not on the board, create an issue + add it as a card in the right column.

**Operating the board via `gh` (token needs `project` scope — already granted):**
```bash
# IDs (stable):
PROJ=PVT_kwHOBbclvc4BZ3cw                 # project node id
FIELD=PVTSSF_lAHOBbclvc4BZ3cwzhUzJ7Y      # Status field id
# Status option ids (regenerated 2026-06-06 when columns were expanded):
#   Backlog=e701ac56 Todo=19669990 "In Progress"=54cdc0d9 "In Review"=0da981b4
#   "Security Review"=a4e683c4 "QA / E2E"=32a528bb Staging=c0ec43e9 Done=0897e59f Blocked=a8d44f01

# Add a new card:
url=$(gh issue create --title "..." --body "..." --label "feature")
item=$(gh project item-add 1 --owner vankimj --url "$url" --format json | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
gh project item-edit --id "$item" --project-id "$PROJ" --field-id "$FIELD" --single-select-option-id 19669990  # -> Todo

# Move an existing card: find its item id via `gh project item-list 1 --owner vankimj --limit 100 --format json` (MUST pass --limit 100; default ~30 silently truncates), then item-edit with the target option id.
```
Labels in use: `feature`, `infra`, `mobile`, `pos`, `sms`, `p1`, `p2`.

**⚠️ NEVER edit the Status field's options with `updateProjectV2Field` unless you pass the EXISTING option `id`s for every option you keep.** Omitting ids regenerates ALL option ids and **wipes the Status of every card on the board** (hit 2026-06-06 — wiped 47 cards, had to restore from issue open/closed state). To add a column safely, first query the field's current options + ids, then resubmit the full list with those ids preserved plus the new option(s).

---

## Roadmap (not yet built)
- **Reporting** — revenue dashboard, employee service history, leaderboard, IRS fiscal year report
- **POS / Checkout** — multi-tech credit split, discounts (friends & family, promo codes, gift cards), future credits, refunds with photos
- **HR module** — compensation info (admin-only), direct deposit, payroll reports (Gusto integration), performance reviews, bonuses
- **Employee auth** — Firebase email magic link for staff without Google accounts
- **Employee scheduling** — store hours, appointment-only extended hours per employee, personal calendar view with persistent tech overlay config
- **Multi-tenant SaaS** — subdomain routing, white-label, pricing tiers
