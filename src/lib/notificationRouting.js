// Notification routing — who (which staff role) gets which internal alert,
// through which channel (push / email / SMS), plus master on/off switches for
// the customer-facing messages.
//
// Stored on tenants/{tid}/data/settings.notificationRouting:
//   {
//     internal: {
//       clock_in_out: { owner: {push,email,sms}, manager:{...}, staff:{...}, scheduler:{...} },
//       low_rating:   { ... },
//       refund:       { ... },
//     },
//     customer: {
//       booking_confirmation: { enabled: true },
//       appointment_reminder: { enabled: true },
//       ...
//     },
//   }
//
// Defaults mirror today's behavior EXACTLY, so turning this feature on changes
// nothing until an admin edits the grid:
//   - internal alerts go to the Owner on all three channels (the old
//     notifyTenantAdmins behavior), and
//   - every customer message is enabled (the per-customer opt-in still applies
//     on top of the master switch).

export const NOTIF_ROLES    = ['owner', 'manager', 'staff', 'scheduler'];
export const NOTIF_CHANNELS = ['push', 'email', 'sms'];

export const ROLE_LABELS_SHORT = {
  owner:     'Owner',
  manager:   'Manager',
  staff:     'Staff',
  scheduler: 'Front desk',
};

export const CHANNEL_LABELS = { push: 'Push', email: 'Email', sms: 'SMS' };

// Internal staff alerts — fully role × channel configurable.
export const INTERNAL_EVENTS = [
  {
    key: 'clock_in_out',
    label: 'Tech clocks in / out',
    desc: 'When a technician clocks in or out for the day.',
    defaults: { owner: { push: true, email: true, sms: true } },
  },
  {
    key: 'low_rating',
    label: 'Low service rating',
    desc: 'When a client leaves a rating below your review-routing threshold.',
    defaults: { owner: { push: true, email: true, sms: true } },
  },
  {
    key: 'refund',
    label: 'Refund issued',
    desc: 'When a staff member issues a refund or store credit.',
    defaults: { owner: { push: true, email: true, sms: true } },
  },
];

// Customer-facing messages — a master on/off per message. The recipient is the
// customer, so there's no per-role routing; the per-customer opt-in (email/SMS
// preferences) still governs delivery on top of this switch.
export const CUSTOMER_EVENTS = [
  { key: 'booking_confirmation', label: 'Booking confirmation', desc: 'Sent to the customer right after they book.' },
  { key: 'appointment_reminder', label: 'Appointment reminder',  desc: 'Day-before reminder to the customer.' },
  { key: 'cancellation_notice',  label: 'Cancellation notice',   desc: 'Tells the customer their appointment was cancelled.' },
  { key: 'receipt',              label: 'Receipt',               desc: 'Emailed / texted receipt after checkout.' },
  { key: 'review_request',       label: 'Review request',        desc: 'Asks the customer to leave a Google review.' },
];

const emptyRoleChannels = () => ({ push: false, email: false, sms: false });

// The default routing for one internal event: every role off except those
// named in the event's `defaults`.
export function defaultInternalRouting(eventKey) {
  const ev = INTERNAL_EVENTS.find(e => e.key === eventKey);
  const out = {};
  NOTIF_ROLES.forEach(r => { out[r] = emptyRoleChannels(); });
  if (ev && ev.defaults) {
    Object.entries(ev.defaults).forEach(([r, ch]) => {
      if (out[r]) out[r] = { push: ch.push === true, email: ch.email === true, sms: ch.sms === true };
    });
  }
  return out;
}

// Merge stored routing over defaults for one event → a complete role×channel map.
export function resolveInternalRouting(settings, eventKey) {
  const base = defaultInternalRouting(eventKey);
  const stored = settings && settings.notificationRouting
    && settings.notificationRouting.internal
    && settings.notificationRouting.internal[eventKey];
  if (!stored || typeof stored !== 'object') return base;
  NOTIF_ROLES.forEach(r => {
    const s = stored[r];
    if (s && typeof s === 'object') {
      base[r] = { push: s.push === true, email: s.email === true, sms: s.sms === true };
    }
  });
  return base;
}

// Master switch for a customer message — default ON unless explicitly disabled.
export function isCustomerNotifEnabled(settings, eventKey) {
  const v = settings && settings.notificationRouting
    && settings.notificationRouting.customer
    && settings.notificationRouting.customer[eventKey]
    && settings.notificationRouting.customer[eventKey].enabled;
  return v !== false;
}
