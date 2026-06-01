import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_TYPES,
  buildOAuthState,
  verifyOAuthState,
  summariseAccountStatus,
  describeAccountStatus,
  normaliseAccountType,
} from './connect.js';

const SECRET = 'test-signing-secret-with-enough-entropy';

describe('buildOAuthState + verifyOAuthState', () => {
  it('round-trips a tenantId successfully', () => {
    const state = buildOAuthState('meraki', SECRET);
    const result = verifyOAuthState(state, SECRET);
    expect(result.ok).toBe(true);
    expect(result.tenantId).toBe('meraki');
  });

  it('embeds an unpredictable nonce so two states for the same tenant differ', () => {
    const s1 = buildOAuthState('meraki', SECRET);
    const s2 = buildOAuthState('meraki', SECRET);
    expect(s1).not.toBe(s2);
  });

  it('rejects a tampered tenantId (signature mismatch)', () => {
    const valid = buildOAuthState('meraki', SECRET);
    const parts = valid.split(':');
    parts[0] = 'attacker';
    const tampered = parts.join(':');
    const result = verifyOAuthState(tampered, SECRET);
    expect(result.ok).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const valid = buildOAuthState('meraki', SECRET);
    const parts = valid.split(':');
    parts[2] = '0'.repeat(32);
    expect(verifyOAuthState(parts.join(':'), SECRET).ok).toBe(false);
  });

  it('rejects a state signed with the wrong secret', () => {
    const valid = buildOAuthState('meraki', SECRET);
    expect(verifyOAuthState(valid, 'different-secret').ok).toBe(false);
  });

  it('rejects malformed input safely', () => {
    expect(verifyOAuthState(null, SECRET).ok).toBe(false);
    expect(verifyOAuthState('', SECRET).ok).toBe(false);
    expect(verifyOAuthState('no:colons', SECRET).ok).toBe(false);
    expect(verifyOAuthState('a:b:c:d', SECRET).ok).toBe(false);
  });

  it('throws if asked to sign without a tenantId', () => {
    expect(() => buildOAuthState('', SECRET)).toThrow(/tenantId required/);
  });

  it('throws if asked to sign without a secret', () => {
    expect(() => buildOAuthState('meraki', '')).toThrow(/signing secret required/);
  });
});

describe('summariseAccountStatus', () => {
  function makeAccount(overrides = {}) {
    return {
      id: 'acct_test',
      type: 'express',
      country: 'US',
      default_currency: 'usd',
      email: 'owner@salon.test',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      business_profile: { name: 'Acme Nails' },
      settings: { payments: { statement_descriptor: 'ACME NAILS' } },
      requirements: { currently_due: [], past_due: [], disabled_reason: null },
      ...overrides,
    };
  }

  it('extracts the UI-relevant fields', () => {
    const s = summariseAccountStatus(makeAccount());
    expect(s).toEqual({
      accountId: 'acct_test',
      accountType: 'express',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      country: 'US',
      defaultCurrency: 'usd',
      email: 'owner@salon.test',
      businessName: 'Acme Nails',
      statementDescriptor: 'ACME NAILS',
      requirementsCurrentlyDue: [],
      requirementsPastDue: [],
      requirementsDisabledReason: null,
      updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('caps requirements arrays at 20 entries (avoid runaway docs)', () => {
    const acct = makeAccount({
      requirements: {
        currently_due: Array.from({ length: 50 }, (_, i) => `field_${i}`),
        past_due: Array.from({ length: 30 }, (_, i) => `past_${i}`),
      },
    });
    const s = summariseAccountStatus(acct);
    expect(s.requirementsCurrentlyDue).toHaveLength(20);
    expect(s.requirementsPastDue).toHaveLength(20);
  });

  it('returns null for missing input', () => {
    expect(summariseAccountStatus(null)).toBeNull();
    expect(summariseAccountStatus({})).toBeNull();
    expect(summariseAccountStatus({ type: 'standard' })).toBeNull();
  });

  it('handles partially-formed accounts (missing nested objects)', () => {
    const s = summariseAccountStatus({
      id: 'acct_x', type: 'standard',
      charges_enabled: false, payouts_enabled: false, details_submitted: false,
    });
    expect(s.accountId).toBe('acct_x');
    expect(s.accountType).toBe('standard');
    expect(s.businessName).toBeNull();
    expect(s.statementDescriptor).toBeNull();
    expect(s.requirementsCurrentlyDue).toEqual([]);
  });
});

describe('describeAccountStatus', () => {
  it('idle: nothing connected yet', () => {
    const r = describeAccountStatus(null);
    expect(r.tone).toBe('idle');
    expect(r.headline).toMatch(/Not connected/);
  });

  it('success: charges + payouts both live', () => {
    const r = describeAccountStatus({
      chargesEnabled: true, payoutsEnabled: true, businessName: 'Acme Nails',
      requirementsCurrentlyDue: [],
    });
    expect(r.tone).toBe('success');
    expect(r.detail).toContain('Acme Nails');
  });

  it('pending: details submitted, awaiting Stripe review', () => {
    const r = describeAccountStatus({
      detailsSubmitted: true, chargesEnabled: false, payoutsEnabled: false,
      requirementsCurrentlyDue: [],
    });
    expect(r.tone).toBe('pending');
    expect(r.headline).toMatch(/reviewing/);
  });

  it('pending: charges enabled but bank not verified yet', () => {
    const r = describeAccountStatus({
      detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: false,
      requirementsCurrentlyDue: [],
    });
    expect(r.tone).toBe('pending');
    expect(r.detail).toMatch(/bank/i);
  });

  it('warning: explicit requirements outstanding', () => {
    const r = describeAccountStatus({
      detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false,
      requirementsCurrentlyDue: ['external_account', 'business_profile.url', 'tos_acceptance'],
    });
    expect(r.tone).toBe('warning');
    expect(r.detail).toContain('external_account');
    expect(r.detail).toContain('tos_acceptance');
  });

  it('pending: account created but onboarding not yet started', () => {
    const r = describeAccountStatus({
      detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false,
      requirementsCurrentlyDue: [],
    });
    expect(r.tone).toBe('pending');
    expect(r.headline).toMatch(/onboarding not started/);
  });
});

describe('normaliseAccountType', () => {
  it('defaults to express when empty', () => {
    expect(normaliseAccountType()).toBe('express');
    expect(normaliseAccountType('')).toBe('express');
    expect(normaliseAccountType(null)).toBe('express');
  });

  it('lower-cases valid input', () => {
    expect(normaliseAccountType('Express')).toBe('express');
    expect(normaliseAccountType('STANDARD')).toBe('standard');
  });

  it('rejects unknown types (prevents silently writing bad data)', () => {
    expect(() => normaliseAccountType('custom')).toThrow(/Unknown account type/);
    expect(() => normaliseAccountType('foo')).toThrow(/Unknown account type/);
  });
});

describe('ACCOUNT_TYPES export', () => {
  it('lists the two supported types', () => {
    expect(ACCOUNT_TYPES).toEqual(['express', 'standard']);
  });
});
