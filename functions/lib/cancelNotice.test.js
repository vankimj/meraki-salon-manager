import { describe, it, expect } from 'vitest';
import { shouldSendCancelNotice, buildCancelSms } from './cancelNotice.js';

describe('shouldSendCancelNotice', () => {
  it('staff cancel: on by default', () => {
    expect(shouldSendCancelNotice({}, undefined)).toBe(true);
    expect(shouldSendCancelNotice({}, 'staff@x.com')).toBe(true);
  });
  it('staff cancel: off when disabled', () => {
    expect(shouldSendCancelNotice({ cancelNotifyCustomer: false }, 'staff@x.com')).toBe(false);
  });
  it('self-service: off by default', () => {
    expect(shouldSendCancelNotice({}, 'client_self_service')).toBe(false);
  });
  it('self-service: on when opted in', () => {
    expect(shouldSendCancelNotice({ cancelConfirmSelfService: true }, 'client_self_service')).toBe(true);
  });
  it('staff toggle does not affect self-service and vice versa', () => {
    expect(shouldSendCancelNotice({ cancelNotifyCustomer: false }, 'client_self_service')).toBe(false);
    expect(shouldSendCancelNotice({ cancelConfirmSelfService: true }, 'staff@x.com')).toBe(true);
  });
});

describe('buildCancelSms', () => {
  const base = { firstName: 'Mia', dateShort: 'Mon, Jun 10', timeShort: '2:30 PM', rebookUrl: 'https://x.plumenexus.com/book' };

  it('staff cancel: apologetic tone + rebook link, no rating', () => {
    const s = buildCancelSms({ ...base, selfService: false });
    expect(s).toContain("we're sorry");
    expect(s).toContain('Mon, Jun 10 2:30 PM');
    expect(s).toContain('Rebook anytime: https://x.plumenexus.com/book');
    expect(s.toLowerCase()).not.toContain('rate');
    expect(s.toLowerCase()).not.toContain('review');
  });

  it('self-service: confirmation tone', () => {
    const s = buildCancelSms({ ...base, selfService: true });
    expect(s).toContain('your Mon, Jun 10 2:30 PM appointment is cancelled');
    expect(s).not.toContain("we're sorry");
  });

  it('omits rebook clause when no url', () => {
    const s = buildCancelSms({ ...base, rebookUrl: '', selfService: false });
    expect(s).not.toContain('Rebook anytime');
  });

  it('falls back to "there" when no name', () => {
    expect(buildCancelSms({ ...base, firstName: '', selfService: true })).toContain('Hi there,');
  });
});
