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
