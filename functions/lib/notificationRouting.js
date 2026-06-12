// CommonJS twin of src/lib/notificationRouting.js — keep in sync. Used by Cloud
// Functions to decide which staff role gets which internal alert on which
// channel, and whether a customer-facing message is enabled. Defaults mirror
// the historic behavior (owner gets every internal alert on all channels;
// every customer message enabled), so the feature is a no-op until edited.

const NOTIF_ROLES    = ['owner', 'manager', 'staff', 'scheduler'];
const NOTIF_CHANNELS = ['push', 'email', 'sms'];

const INTERNAL_EVENTS = [
  { key: 'clock_in_out', defaults: { owner: { push: true, email: true, sms: true } } },
  { key: 'low_rating',   defaults: { owner: { push: true, email: true, sms: true } } },
  { key: 'refund',       defaults: { owner: { push: true, email: true, sms: true } } },
];

const CUSTOMER_EVENTS = [
  'booking_confirmation', 'appointment_reminder', 'cancellation_notice', 'receipt', 'review_request',
];

const emptyRoleChannels = () => ({ push: false, email: false, sms: false });

function defaultInternalRouting(eventKey) {
  const ev = INTERNAL_EVENTS.find(e => e.key === eventKey);
  const out = {};
  NOTIF_ROLES.forEach(r => { out[r] = emptyRoleChannels(); });
  if (ev && ev.defaults) {
    Object.keys(ev.defaults).forEach(r => {
      const ch = ev.defaults[r];
      if (out[r]) out[r] = { push: ch.push === true, email: ch.email === true, sms: ch.sms === true };
    });
  }
  return out;
}

function resolveInternalRouting(settings, eventKey) {
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

function isCustomerNotifEnabled(settings, eventKey) {
  const v = settings && settings.notificationRouting
    && settings.notificationRouting.customer
    && settings.notificationRouting.customer[eventKey]
    && settings.notificationRouting.customer[eventKey].enabled;
  return v !== false;
}

module.exports = {
  NOTIF_ROLES,
  NOTIF_CHANNELS,
  INTERNAL_EVENTS,
  CUSTOMER_EVENTS,
  defaultInternalRouting,
  resolveInternalRouting,
  isCustomerNotifEnabled,
};
