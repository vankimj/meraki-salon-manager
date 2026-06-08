// In-app staff Help & Guide content. Keyed by topic id. Module topics reuse the
// module id so HelpScreen can show only what the tenant has enabled (via
// getVisibleModules); feature topics (kiosks, ratings) are always listed.
// Keep entries TERSE — what it does, the steps, one gotcha. No screenshots
// (they age fastest). Update alongside the feature, not later.

export const HELP_GENERAL = [
  {
    id: 'getting-started', icon: 'sparkles', title: 'Getting started',
    what: 'The basics of running the day on the app.',
    steps: [
      'Manage tab = every tool (tap a tile). Home/Schedule is your day view.',
      'Tap a client or appointment to open it; “Add to tab” collects items for checkout.',
      'Checkout takes cash, card (reader / Tap to Pay on iPhone), and records tips + receipts.',
      'Admins set everything up in Manage → Admin → Settings (deeper config is on the web app).',
    ],
    tip: 'Most lists support pull-to-refresh and a search box up top.',
  },
];

export const HELP_TOPICS = {
  schedule: {
    icon: 'calendar', what: 'Day view of appointments by tech.',
    steps: [
      'Tap an empty slot to add an appointment; pick the client (or “No client / walk-in”).',
      'Tap an existing appointment to edit, move, or check the client in.',
      'Use the date arrows up top to change days.',
      '“Add to tab” on an appointment sends it to checkout.',
    ],
    tip: 'Time-off shows as a blocked column so you don’t double-book a tech who’s out.',
  },
  clients: {
    icon: 'users', what: 'Client profiles, contact info, and visit history.',
    steps: [
      'Search by name or phone at the top.',
      'Tap a client to see Profile / visits / store-credit balance.',
      'Edit to update contact info, allergies, notes, or social handles.',
    ],
    tip: 'A client’s store-credit balance shows on their profile and applies automatically at checkout.',
  },
  walkin: {
    icon: 'walk', what: 'Walk-in turn rotation + waitlist (Mango-style). Admin-only to edit.',
    steps: [
      'Techs join the rotation automatically when they clock in at the Clock Kiosk.',
      '“＋ Add walk-in”: search the client by phone (or add name + phone to create a profile), pick services + a tech preference.',
      'Tap “Seat” on a waiting guest → pick a tech. Only techs who can do the requested service show first.',
      'Next-up = fewest turns. Use Away/Back when a tech steps out; +1 to nudge the order.',
    ],
    tip: 'When the rotation changes, affected techs get a push with their spot in line + how many are waiting.',
  },
  checkout: {
    icon: 'dollar', what: 'Ring up a sale — services, retail, discounts, tips, card or cash.',
    steps: [
      'Edit line prices / techs, add retail products, apply a discount, promo, or gift card.',
      'Tip: pick %/$, or “Per tech” to split tips by tech.',
      'Take payment: Cash, or Card (Bluetooth reader on iPad / Tap to Pay on iPhone).',
      'A receipt (with a rating link) is sent by text/email automatically.',
    ],
    tip: 'Gift card → “Find” looks one up by the recipient’s name, phone, or email if they forgot the code.',
  },
  giftcards: {
    icon: 'gift', what: 'Sell, track, and void gift cards + promo codes.',
    steps: [
      'New card: set value and (recommended) recipient name / phone / email.',
      'Recipient info lets staff find the card later by name/phone/email at checkout.',
      'Redeem at checkout by code, or via the “Find” search.',
    ],
    tip: 'Only cards saved with recipient info are searchable by name/phone — older code-only cards still work by code.',
  },
  services: {
    icon: 'list', what: 'Your service menu + pricing.',
    steps: [
      'Add/edit a service: name, category, price, duration.',
      '“Walk-in turn weight” controls how much of a turn it counts (full set = 1, fill = 0.5, etc.).',
      'Mark inactive to hide a service without deleting it.',
    ],
    tip: 'Set each tech’s “Services performed” in Employees so walk-in routing knows who can do what.',
  },
  products: {
    icon: 'box', what: 'Retail inventory + stock.',
    steps: ['Add a product with price + stock count.', 'Stock decrements automatically when sold at checkout.'],
    tip: 'Out-of-stock products are hidden from the checkout product picker.',
  },
  employees: {
    icon: 'user', what: 'Team profiles, skills, and clock-in PINs.',
    steps: [
      'Edit a tech: name, photo, contact, social handles.',
      '“Services performed” = which services they can do (drives walk-in routing).',
      'Set their 4-digit Clock-in PIN here (for the Clock Kiosk).',
    ],
    tip: 'Seniority/sort order can break walk-in turn ties when that setting is on.',
  },
  reports: {
    icon: 'chart', what: 'Revenue, leaderboards, ratings, and an AI assistant.',
    steps: [
      'Pick a date range up top. Overview = revenue, techs, services, fees, tips, refunds, clients.',
      'Ratings tab = customer satisfaction (averages, low-rating comments).',
      'Ask AI = ask plain-English questions about your data (read-only).',
    ],
    tip: 'Tap a tech filter chip to drill into one tech; tap a top client for their visit history.',
  },
  earnings: {
    icon: 'wallet', what: 'Per-tech tips, service revenue, and take-home.',
    steps: ['Pick a tech + date range to see their tips and services.'],
    tip: 'Earnings come straight from completed checkouts, so they update the moment a sale is rung up.',
  },
  receipts: {
    icon: 'receipt', what: 'Sales & Receipts — browse sales, resend, and refund.',
    steps: [
      'Search by client name (all time) or browse a date range.',
      'Open a sale for the line-item breakdown.',
      'Refund: card sales refund to the card via Stripe; cash sales are recorded. Optional store credit.',
    ],
    tip: 'Every refund alerts all admins with who issued it.',
  },
  attendance: {
    icon: 'clock', what: 'Clock-in / clock-out times (manual override).',
    steps: ['Pick a date to view/adjust times.', 'Use this to fix a missed punch; day-to-day clocking happens at the Clock Kiosk.'],
    tip: 'This is the admin override — the self-service kiosk is where techs normally clock in/out.',
  },
  chat: {
    icon: 'chat', what: 'Message clients by SMS / email + in-app threads.',
    steps: ['“New message” to start a thread.', 'Open a thread to reply by text or email.'],
    tip: 'Replies go out as real SMS/email to the client.',
  },
  memberships: {
    icon: 'star', what: 'Recurring member plans + discounts.',
    steps: ['Create a plan with a discount %.', 'A member’s discount auto-applies at checkout.'],
    tip: '',
  },
  marketing: {
    icon: 'mail', what: 'Campaign drafts (sending is on the web app).',
    steps: ['Draft a campaign here.', 'Schedule/send it from the web app.'],
    tip: 'Mobile manages drafts; the web app fires real email/SMS campaigns.',
  },
  hr: {
    icon: 'briefcase', what: 'Compensation + payroll (admin).',
    steps: ['View per-tech compensation and payroll figures.'],
    tip: 'Detailed payroll edits live on the web app.',
  },
};

// Feature guides that aren't standalone modules.
export const HELP_FEATURES = [
  {
    id: 'front-desk-kiosk', icon: 'dollar', title: 'Front Desk Kiosk', adminOnly: true,
    what: 'A locked customer-facing checkout/tip display.',
    steps: [
      'Manage → Front Desk Kiosk (admins only). It locks the device.',
      'Customers pick a tip — Card (added to the bill), Venmo (QR, off-bill), or Cash (paid directly to the tech).',
      'Exit requires an admin’s kiosk PIN — set it in Admin → Settings → “Kiosk exit PIN”.',
    ],
    tip: 'The lock survives an app restart, so it can’t be escaped by force-quitting.',
  },
  {
    id: 'clock-kiosk', icon: 'clock', title: 'Clock Kiosk', adminOnly: true,
    what: 'Self-service time clock + a read-only Walk-in Monitor.',
    steps: [
      'Manage → Clock Kiosk (admins only). It locks the device.',
      'Two tiles: Time Clock (techs tap their tile → PIN → clock in/out) and Walk-in Monitor (live rotation + waitlist, read-only).',
      'Each tech’s PIN is set in Employees; clock events alert admins and update Attendance.',
      'Exit requires an admin’s kiosk PIN.',
    ],
    tip: 'Run the Walk-in Monitor on a spare screen so techs can see the rotation at a glance.',
  },
  {
    id: 'ratings', icon: 'star', title: 'Customer ratings',
    what: 'How the post-visit star rating works.',
    steps: [
      'The receipt (email/text) has tappable stars + a “Rate your visit” link.',
      'High ratings are routed to a public Google review; low ratings stay private.',
      'A low rating pings the owner/admins right away (push + email + text).',
    ],
    tip: 'See all results in Reports → Ratings.',
  },
];
