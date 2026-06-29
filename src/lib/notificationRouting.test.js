import { describe, it, expect } from 'vitest';
import {
  resolveInternalRouting,
  defaultInternalRouting,
  isCustomerNotifEnabled,
  NOTIF_ROLES,
} from './notificationRouting';

describe('defaultInternalRouting', () => {
  it('defaults clock_in_out to owner on all channels, everyone else off', () => {
    const r = defaultInternalRouting('clock_in_out');
    expect(r.owner).toEqual({ push: true, email: true, sms: true });
    expect(r.manager).toEqual({ push: false, email: false, sms: false });
    expect(r.staff).toEqual({ push: false, email: false, sms: false });
    expect(r.scheduler).toEqual({ push: false, email: false, sms: false });
  });
  it('returns a full role map even for an unknown event', () => {
    const r = defaultInternalRouting('nope');
    NOTIF_ROLES.forEach(role => expect(r[role]).toEqual({ push: false, email: false, sms: false }));
  });
});

describe('resolveInternalRouting', () => {
  it('uses defaults when nothing stored', () => {
    expect(resolveInternalRouting({}, 'refund').owner).toEqual({ push: true, email: true, sms: true });
  });
  it('merges stored role overrides over defaults', () => {
    const settings = { notificationRouting: { internal: {
      clock_in_out: {
        owner:   { push: true,  email: true,  sms: false },
        manager: { push: false, email: true,  sms: false },
      },
    } } };
    const r = resolveInternalRouting(settings, 'clock_in_out');
    expect(r.owner).toEqual({ push: true, email: true, sms: false });   // sms turned off
    expect(r.manager).toEqual({ push: false, email: true, sms: false }); // manager opted in to email
    expect(r.staff).toEqual({ push: false, email: false, sms: false });  // untouched → off
  });
  it('coerces missing channel flags to false', () => {
    const settings = { notificationRouting: { internal: { refund: { owner: { email: true } } } } };
    expect(resolveInternalRouting(settings, 'refund').owner).toEqual({ push: false, email: true, sms: false });
  });
});

describe('overlay: custom roles in the routing axis (extraRoles)', () => {
  const CUSTOM = ['custom_lead', 'custom_frontdesk'];
  it('defaultInternalRouting seeds custom roles all-off', () => {
    const r = defaultInternalRouting('clock_in_out', CUSTOM);
    expect(r.owner).toEqual({ push: true, email: true, sms: true });   // built-in default unchanged
    expect(r.custom_lead).toEqual({ push: false, email: false, sms: false });
    expect(r.custom_frontdesk).toEqual({ push: false, email: false, sms: false });
  });
  it('resolveInternalRouting merges stored custom-role overrides', () => {
    const settings = { notificationRouting: { internal: {
      low_rating: { custom_lead: { push: true, email: false, sms: true } },
    } } };
    const r = resolveInternalRouting(settings, 'low_rating', CUSTOM);
    expect(r.custom_lead).toEqual({ push: true, email: false, sms: true });
    expect(r.custom_frontdesk).toEqual({ push: false, email: false, sms: false });
    expect(r.owner).toEqual({ push: true, email: true, sms: true });   // built-in still defaulted
  });
  it('no extraRoles = original behavior (custom keys absent)', () => {
    const r = resolveInternalRouting({}, 'refund');
    expect(r.custom_lead).toBeUndefined();
    expect(Object.keys(r).sort()).toEqual([...NOTIF_ROLES].sort());
  });
});

describe('isCustomerNotifEnabled', () => {
  it('defaults to enabled', () => {
    expect(isCustomerNotifEnabled({}, 'receipt')).toBe(true);
    expect(isCustomerNotifEnabled({ notificationRouting: {} }, 'receipt')).toBe(true);
  });
  it('respects an explicit disable', () => {
    const settings = { notificationRouting: { customer: { receipt: { enabled: false } } } };
    expect(isCustomerNotifEnabled(settings, 'receipt')).toBe(false);
    expect(isCustomerNotifEnabled(settings, 'booking_confirmation')).toBe(true);
  });
  it('treats enabled:true explicitly as on', () => {
    const settings = { notificationRouting: { customer: { receipt: { enabled: true } } } };
    expect(isCustomerNotifEnabled(settings, 'receipt')).toBe(true);
  });
});
