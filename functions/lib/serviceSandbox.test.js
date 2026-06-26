import { describe, it, expect } from 'vitest';
import { DEFAULT_TENANT_CAPS, effectiveSandbox, effectiveCaps } from './serviceSandbox.js';

describe('effectiveSandbox', () => {
  it('missing tenant → sandboxed (fail-safe)', () => {
    expect(effectiveSandbox(null, 'emailSandboxMode')).toBe(true);
  });

  it('explicit per-service flag wins', () => {
    expect(effectiveSandbox({ emailSandboxMode: false, sandboxMode: true },  'emailSandboxMode')).toBe(false);
    expect(effectiveSandbox({ emailSandboxMode: true,  sandboxMode: false }, 'emailSandboxMode')).toBe(true);
  });

  it('MIGRATION-SAFE: unset per-service flag inherits the master sandboxMode', () => {
    // Existing LIVE tenant (sandboxMode:false, no email/stripe field yet) stays
    // live — the bug this guards against was silently sandboxing them on deploy.
    expect(effectiveSandbox({ sandboxMode: false }, 'emailSandboxMode')).toBe(false);
    expect(effectiveSandbox({ sandboxMode: false }, 'stripeSandboxMode')).toBe(false);
    // Existing sandboxed tenant stays sandboxed.
    expect(effectiveSandbox({ sandboxMode: true }, 'emailSandboxMode')).toBe(true);
    // Brand-new tenant (no fields at all) → sandboxed.
    expect(effectiveSandbox({}, 'stripeSandboxMode')).toBe(true);
  });

  it('once set, a per-service flag is independent of sandboxMode', () => {
    // Live for SMS but explicitly sandboxed for Stripe.
    expect(effectiveSandbox({ sandboxMode: false, stripeSandboxMode: true }, 'stripeSandboxMode')).toBe(true);
    // Sandboxed for SMS but explicitly live for email.
    expect(effectiveSandbox({ sandboxMode: true, emailSandboxMode: false }, 'emailSandboxMode')).toBe(false);
  });
});

describe('effectiveCaps', () => {
  it('falls back to platform defaults when unset', () => {
    expect(effectiveCaps(null)).toEqual(DEFAULT_TENANT_CAPS);
    expect(effectiveCaps({})).toEqual(DEFAULT_TENANT_CAPS);
    expect(effectiveCaps({ caps: {} })).toEqual(DEFAULT_TENANT_CAPS);
  });

  it('uses provided caps and defaults the rest', () => {
    const r = effectiveCaps({ caps: { smsPerDay: 50, maxChargeCents: 1000 } });
    expect(r.smsPerDay).toBe(50);
    expect(r.maxChargeCents).toBe(1000);
    expect(r.emailPerDay).toBe(DEFAULT_TENANT_CAPS.emailPerDay);
  });

  it('ignores non-finite cap values', () => {
    const r = effectiveCaps({ caps: { smsPerDay: 'lots', emailPerDay: NaN } });
    expect(r.smsPerDay).toBe(DEFAULT_TENANT_CAPS.smsPerDay);
    expect(r.emailPerDay).toBe(DEFAULT_TENANT_CAPS.emailPerDay);
  });

  it('allows 0 (a hard stop) as a valid cap', () => {
    expect(effectiveCaps({ caps: { smsPerDay: 0 } }).smsPerDay).toBe(0);
  });
});
