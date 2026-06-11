// SINGLE SOURCE OF TRUTH for every automated, tenant-facing message's default
// copy. Required by the server renderer (functions/lib/messageTemplates.js) and
// imported by the web editor (src/lib/messageTemplates.js) so defaults, preview
// and the live send all read the SAME data. A blank tenant override therefore
// renders byte-identical wording to what shipped here.
//
// Each entry:
//   channel      'email' | 'sms'
//   group        editor grouping (see TEMPLATE_GROUPS)
//   label        human label in the editor list
//   description  one line of help shown under the editor
//   subject      (email) light-interpolated subject line
//   body         light-markup body (email) or plain text (sms) with {vars}
//   vars         the escaped/plain placeholders the owner may use
//   htmlVars     trusted, CODE-GENERATED HTML blocks injected raw (not owner copy)
//   email        per-template shell config { subtitle, gradient, footerNote, ... }
//
// Editing copy here changes the default for every tenant that hasn't overridden
// that template. Do NOT add new one-off copy settings elsewhere — add a template
// here and route the send through renderTemplate (see MESSAGE_TEMPLATES_PLAN.md).

const TEMPLATE_GROUPS = [
  { key: 'customer_email', label: 'Customer Emails' },
  { key: 'customer_sms',   label: 'Customer Texts' },
  { key: 'admin_alert',    label: 'Admin Alerts' },
];

const DEFAULT_TEMPLATES = {
  // ── Customer emails ────────────────────────────────────────────────
  booking_confirmation_email: {
    channel: 'email', group: 'customer_email',
    label: 'Booking confirmation',
    description: 'Emailed to the client when an appointment is booked.',
    subject: 'Booking confirmed — {date} at {time}',
    body:
`# Hi {clientName}!

Your appointment has been booked. We can't wait to see you!

{detailsCard}

[[Reschedule or cancel|{manageLink}]]

{policies}`,
    vars: ['clientName', 'salonName', 'date', 'time', 'service', 'tech', 'location', 'manageLink'],
    htmlVars: ['detailsCard', 'policies'],
    email: { subtitle: 'Booking Confirmation', footerBorder: false },
  },

  reminder_email: {
    channel: 'email', group: 'customer_email',
    label: 'Appointment reminder',
    description: 'Emailed the day before a scheduled appointment.',
    subject: 'Reminder: Your appointment tomorrow at {salonName}',
    body:
`# Hi {clientName}!

Just a reminder that you have an appointment **tomorrow** at {salonName}.

{detailsCard}

[[Reschedule or cancel|{manageLink}]]

> {helpLine}`,
    vars: ['clientName', 'salonName', 'date', 'time', 'service', 'tech', 'manageLink', 'helpLine'],
    htmlVars: ['detailsCard'],
    email: { subtitle: 'Appointment Reminder' },
    phrases: {
      helpLineWithReply: { label: 'Help line — when replies reach a real inbox', default: 'Need help? Reply to this email or call the salon.', previewVar: 'helpLine' },
      helpLineNoReply:   { label: 'Help line — when no reply-to address is set', default: 'Need help? Give the salon a call.' },
    },
  },

  cancellation_notice_email: {
    channel: 'email', group: 'customer_email',
    label: 'Cancellation notice',
    description: 'Emailed to the client when their appointment is cancelled.',
    subject: 'Your appointment at {salonName} was cancelled',
    body:
`# Hi {clientName},

{intro}

{detailsCard}

[[Book again|{rebookUrl}]]

> {questionsLine}`,
    vars: ['clientName', 'salonName', 'intro', 'rebookUrl', 'questionsLine'],
    htmlVars: ['detailsCard'],
    email: { subtitle: 'Appointment Cancelled' },
    phrases: {
      introStaff:       { label: 'Intro — salon/staff cancelled the appointment', default: "We're sorry — your appointment below has been cancelled. We'd love to find you a new time whenever you're ready.", previewVar: 'intro' },
      introSelfService: { label: 'Intro — client cancelled it themselves', default: 'Your appointment below has been cancelled, as requested. We hope to see you again soon!' },
      questionsLine:    { label: 'Closing line — when replies reach a real inbox', default: 'Questions? Just reply to this email.', previewVar: 'questionsLine' },
    },
  },

  receipt_email: {
    channel: 'email', group: 'customer_email',
    label: 'Receipt',
    description: 'Emailed after checkout with the itemized receipt and a rating prompt.',
    subject: 'Your receipt — {date}',
    body:
`# Hi {clientName}!

Thanks for visiting {salonName}. Here's your receipt.

{detailsCard}

{receiptTable}

{ratingBlock}`,
    vars: ['clientName', 'salonName', 'date'],
    htmlVars: ['detailsCard', 'receiptTable', 'ratingBlock'],
    email: { subtitle: 'Receipt' },
  },

  rating_request_email: {
    channel: 'email', group: 'customer_email',
    label: 'Rating / review request',
    description: 'Emailed to ask the client for a Google review after a visit.',
    subject: "How was your visit? We'd love your feedback 💅",
    body:
`# Hi {clientName}! 💅

Thank you so much for visiting us at {salonName}! We hope you loved your nails. If you have a moment, leaving us a Google review would mean the world to us and helps other clients find us.

[[⭐ Leave a Google Review|{reviewLink}]]

> It only takes 30 seconds and helps us so much 🙏

> We can't wait to see you again soon!
— The {salonName} Team`,
    vars: ['clientName', 'salonName', 'reviewLink'],
    htmlVars: [],
    email: { subtitle: "We'd love your feedback" },
  },

  gift_card_email: {
    channel: 'email', group: 'customer_email',
    label: 'Gift card',
    description: 'Emailed to a gift-card recipient with their code and balance.',
    subject: "🎁 You've received a ${amount} gift card",
    body:
`Hi {recipientName},

Someone has gifted you a {salonName} gift card. Use the code below at checkout next time you visit us.

{codeBlock}

Save this code — you'll need it at your next visit. Mention it to the front desk or enter it at checkout.

Book your appointment any time at {bookingLink}.`,
    vars: ['recipientName', 'salonName', 'amount'],
    htmlVars: ['codeBlock', 'bookingLink'],
    email: { gradient: '#7c3aed,#3D95CE', centerHeaderTitle: "🎁 You've received a gift card!" },
  },

  membership_invite_email: {
    channel: 'email', group: 'customer_email',
    label: 'Membership invite',
    description: 'Emailed to finish signing up for a recurring membership plan.',
    subject: 'Complete your {planName} membership',
    body:
`# Hi {clientName}!

You're all set to join the **{planName}** membership at {priceLine}.

Click the button below to add your payment method. Your subscription starts immediately and renews automatically. You can cancel anytime through your billing portal — we'll email you the link after sign-up.

[[Complete sign-up|{paymentLink}]]

> — The {salonName} Team`,
    vars: ['clientName', 'salonName', 'planName', 'priceLine', 'paymentLink'],
    htmlVars: [],
    email: { subtitle: '{planName} membership', footerNote: 'Reply to unsubscribe.' },
  },

  birthday_email: {
    channel: 'email', group: 'customer_email',
    label: 'Birthday',
    description: "Auto-sent on a client's birthday (if birthday automation is on).",
    subject: 'Happy Birthday, {clientName}! 🎂 A gift from {salonShort}',
    body:
`# Hi {clientName}!

🎉 Happy Birthday! We hope your special day is as fabulous as you are. As a little gift from all of us at {salonShort}, we'd love to treat you to something special this month. Come celebrate with us — you deserve it!

[[Book Your Birthday Visit|{bookingLink}]]

> — The {salonName} Team`,
    vars: ['clientName', 'salonName', 'salonShort', 'bookingLink'],
    htmlVars: [],
    email: { subtitle: 'Happy Birthday! 🎂', footerNote: 'Reply to unsubscribe.' },
  },

  win_back_email: {
    channel: 'email', group: 'customer_email',
    label: 'We miss you (win-back)',
    description: 'Auto-sent to lapsed clients (if win-back automation is on).',
    subject: 'We miss you, {clientName}! Come see us 💅',
    body:
`# Hi {clientName}!

It's been a while since your last visit, and we genuinely miss you! We have exciting new styles and services waiting for you. Come back and let us take care of you — your nails (and you!) deserve it.

[[Book Your Next Visit|{bookingLink}]]

> — The {salonName} Team`,
    vars: ['clientName', 'salonName', 'bookingLink'],
    htmlVars: [],
    email: { subtitle: 'We miss you! 💅', footerNote: 'Reply to unsubscribe.' },
  },

  // ── Customer texts (SMS) ───────────────────────────────────────────
  // The salon name prefix and "Reply STOP to opt out." footer are added
  // automatically by sendSms — do NOT add them here.
  booking_confirmation_sms: {
    channel: 'sms', group: 'customer_sms',
    label: 'Booking confirmation',
    description: 'Texted to the client when an appointment is booked.',
    body: 'Hi {clientName}! Your {service} at {salonName} is booked for {dateShort} at {timeShort}{techSuffix}.{manageSuffix}',
    vars: ['clientName', 'salonName', 'service', 'dateShort', 'timeShort', 'techSuffix', 'manageSuffix'],
  },

  reminder_sms: {
    channel: 'sms', group: 'customer_sms',
    label: 'Appointment reminder',
    description: 'Texted the day before a scheduled appointment.',
    body: '{salonName}: Hi {clientName}! Your appt tomorrow at {timeShort}{techSuffix}.{confirmSuffix}',
    vars: ['clientName', 'salonName', 'timeShort', 'techSuffix', 'confirmSuffix'],
  },

  receipt_sms: {
    channel: 'sms', group: 'customer_sms',
    label: 'Receipt',
    description: 'Texted after checkout with a link to view and rate the visit.',
    body: "{salonName}: Your receipt for today's ${total} visit with {tech} is ready — view & rate: {viewLink}",
    vars: ['salonName', 'total', 'tech', 'viewLink'],
  },

  cancellation_sms: {
    channel: 'sms', group: 'customer_sms',
    label: 'Cancellation notice',
    description: 'Texted to the client when their appointment is cancelled.',
    body: 'Hi {clientName}, {apology}your {when} appointment was cancelled.{rebookSuffix}',
    vars: ['clientName', 'apology', 'when', 'rebookSuffix'],
    phrases: {
      apologyStaff: { label: 'Apology prefix — salon/staff cancelled (a client self-cancel omits this)', default: "we're sorry — ", previewVar: 'apology' },
    },
  },

  // ── Admin alerts (emailed to salon admins) ─────────────────────────
  admin_new_booking: {
    channel: 'email', group: 'admin_alert',
    label: 'New booking (to admins)',
    description: 'Emailed to salon admins when a new appointment is booked.',
    subject: '🔔 Admin Alert · {bookingKind} — {clientName} on {date}',
    body:
`{introLine}

{detailsCard}`,
    vars: ['clientName', 'date', 'bookingKind', 'introLine'],
    htmlVars: ['detailsCard'],
    email: { subtitle: '{subtitleLine}', footerBorder: false },
    phrases: {
      introOnline: { label: 'Intro — booked online by a client', default: 'A new appointment was booked online.', previewVar: 'introLine' },
      introAdded:  { label: 'Intro — added by staff on the schedule', default: 'A new appointment was added to the schedule.' },
    },
  },

  admin_alert: {
    channel: 'email', group: 'admin_alert',
    label: 'General admin alert',
    description: 'Emailed to admins for refunds, low ratings, credit changes and other one-off alerts. {detail} is generated per event.',
    subject: '🔔 Admin Alert · {salonName}: {title}',
    body: '{detail}',
    vars: ['salonName', 'title', 'detail'],
    htmlVars: [],
    email: { subtitle: 'Admin Alert' },
  },

  admin_new_message: {
    channel: 'email', group: 'admin_alert',
    label: 'New client message (to admins)',
    description: 'Emailed to admins when a client sends a message.',
    subject: 'New message from {clientName}',
    body:
`# New message from {clientName}

{messageCard}

> Open the salon manager app and go to **Messages** to reply.`,
    vars: ['clientName'],
    htmlVars: ['messageCard'],
    email: { subtitle: 'New Client Message' },
  },

  admin_new_review: {
    channel: 'email', group: 'admin_alert',
    label: 'New review (to admins)',
    description: 'Emailed to admins (and the tech) when a new Google review comes in.',
    subject: 'New {rating}-star Google review — {clientName}',
    body:
`# ⭐ New review from {clientName}!

{reviewCard}

> Open the client's profile in the salon manager app to view the full review.`,
    vars: ['clientName', 'rating'],
    htmlVars: ['reviewCard'],
    email: { subtitle: 'New Google Review', gradient: '#f59e0b,#f97316' },
  },

  admin_access_request: {
    channel: 'email', group: 'admin_alert',
    label: 'Staff access request (to admins)',
    description: 'Emailed to admins when someone requests access to the app.',
    subject: 'Access request — {name}',
    body:
`A new user is requesting access to the salon manager app.

{detailsCard}

> Log in to the Admin panel to approve or deny this request.`,
    vars: ['name', 'email'],
    htmlVars: ['detailsCard'],
    email: { subtitle: 'New Access Request', footerBorder: false },
  },
};

const TEMPLATE_KEYS = Object.keys(DEFAULT_TEMPLATES);

module.exports = { DEFAULT_TEMPLATES, TEMPLATE_GROUPS, TEMPLATE_KEYS };
