import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock callFn so we can spy on which Cloud Function is invoked with what.
// Hoisted so the vi.mock factory below can reference them.
const { completeMock, statusMock } = vi.hoisted(() => ({
  completeMock: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  statusMock:   vi.fn(() => Promise.resolve({ data: { status: {
    accountId: 'acct_test_123', accountType: 'standard',
    chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true,
    businessName: 'Test Salon', statementDescriptor: 'TEST',
    requirementsCurrentlyDue: [], updatedAt: '2026-06-03',
  }}})),
}));
// Mutable auth.currentUser so tests can flip it between null and a user
// to mirror the real Firebase Auth lifecycle. vi.hoisted lets the mock
// factory (which gets hoisted above all other top-level code) reach
// values we can mutate from tests.
const { fakeAuth } = vi.hoisted(() => ({ fakeAuth: { currentUser: null } }));
vi.mock('../lib/firebase', () => ({
  callFn: (name) => {
    if (name === 'completeStripeConnectOAuth') return completeMock;
    if (name === 'getStripeConnectStatus')      return statusMock;
    return vi.fn(() => Promise.resolve({ data: {} }));
  },
  auth: fakeAuth,
}));
vi.mock('../lib/tenant', () => ({ TENANT_ID: 'meraki' }));

import { useStripeConnectOAuthCallback } from './useStripeConnectOAuthCallback';

beforeEach(() => {
  completeMock.mockClear();
  statusMock.mockClear();
  // Default to a present user (whose token we can mint) for the happy
  // path tests. The null-gUser tests don't care about auth.currentUser.
  fakeAuth.currentUser = { uid: 'u1', email: 'admin@example.com', getIdToken: vi.fn(() => Promise.resolve('id_token_abc')) };
});

describe('useStripeConnectOAuthCallback', () => {
  function fakeLocation(href) {
    const u = new URL(href);
    return { search: u.search, href: u.href };
  }

  it('does nothing when URL has no ?connect=oauth-callback', () => {
    const replaceState = vi.fn();
    renderHook(() => useStripeConnectOAuthCallback({
      gUser: { uid: 'u1' }, settings: {}, updateSettings: vi.fn(),
      getLocation: () => fakeLocation('https://merakinailstudio.plumenexus.com/manage'),
      replaceState,
    }));
    expect(completeMock).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('THE RACE: does NOT strip URL params when gUser is null on first pass', () => {
    const replaceState = vi.fn();
    renderHook(() => useStripeConnectOAuthCallback({
      gUser: null, settings: {}, updateSettings: vi.fn(),
      getLocation: () => fakeLocation('https://merakinailstudio.plumenexus.com/?connect=oauth-callback&code=ac_xx&state=s'),
      replaceState,
    }));
    // CRITICAL: if this fires, the next pass with gUser will see an empty URL
    // and silently no-op — which is the exact bug we're guarding against.
    expect(replaceState).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('claims the OAuth code and updates settings when gUser is present', async () => {
    const replaceState = vi.fn();
    const updateSettings = vi.fn();
    renderHook(() => useStripeConnectOAuthCallback({
      gUser: { uid: 'u1' }, settings: { existing: true }, updateSettings,
      getLocation: () => fakeLocation('https://merakinailstudio.plumenexus.com/?connect=oauth-callback&code=ac_real&state=meraki:abc:def'),
      replaceState,
    }));

    // Params should be stripped synchronously AND the path rewritten to
    // /manage. Without the path rewrite, a refresh would render the
    // public SalonWebfront instead of the management app.
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0][0]).toBe('https://merakinailstudio.plumenexus.com/manage');

    // Callable should be invoked with the captured code+state
    await waitFor(() => expect(completeMock).toHaveBeenCalledWith({
      code: 'ac_real', state: 'meraki:abc:def', tenantId: 'meraki',
    }));
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalled();
      const payload = updateSettings.mock.calls[0][0];
      expect(payload.existing).toBe(true);
      expect(payload.stripeConnect.accountId).toBe('acct_test_123');
      expect(payload.stripeConnect.accountType).toBe('standard');
    });
  });

  it('handles the auth-loading transition: bails on null-gUser pass, claims on user-present pass', async () => {
    const replaceState = vi.fn();
    const updateSettings = vi.fn();

    // First render: gUser is null (Firebase Auth still loading)
    const { rerender } = renderHook(({ gUser }) => useStripeConnectOAuthCallback({
      gUser, settings: {}, updateSettings,
      getLocation: () => fakeLocation('https://merakinailstudio.plumenexus.com/?connect=oauth-callback&code=ac_x&state=s_x'),
      replaceState,
    }), { initialProps: { gUser: null } });

    // First pass: params preserved, callable not fired
    expect(replaceState).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();

    // Auth resolves: gUser becomes a real user
    rerender({ gUser: { uid: 'u1' } });

    // Second pass: now we strip + rewrite path to /manage + claim
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0][0]).toBe('https://merakinailstudio.plumenexus.com/manage');
    await waitFor(() => expect(completeMock).toHaveBeenCalledWith({
      code: 'ac_x', state: 's_x', tenantId: 'meraki',
    }));
  });

  it('calls onSuccess with the status after a successful claim — wires up the toast + wizard-restore flow', async () => {
    const replaceState = vi.fn();
    const updateSettings = vi.fn();
    const onSuccess = vi.fn();
    renderHook(() => useStripeConnectOAuthCallback({
      gUser: { uid: 'u1', email: 'admin@example.com' },
      settings: {}, updateSettings, onSuccess,
      getLocation: () => fakeLocation('https://merakinailstudio.plumenexus.com/?connect=oauth-callback&code=ac_x&state=s_x'),
      replaceState,
    }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const status = onSuccess.mock.calls[0][0];
    expect(status.accountId).toBe('acct_test_123');
    expect(status.accountType).toBe('standard');
  });

  it('does NOT call the claim function when gUser is set but auth.currentUser is null (the drift case we saw in prod logs)', async () => {
    // React's gUser can be set while Firebase's auth.currentUser has
    // cleared (e.g., token expired during the Stripe round-trip).
    // Posting with no token caused the "auth: MISSING" we saw in
    // 06:45:01 server logs. Guard surfaces this as a console.error
    // and skips the claim, instead of silently posting unauthenticated.
    fakeAuth.currentUser = null;
    const replaceState = vi.fn();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() => useStripeConnectOAuthCallback({
      gUser: { uid: 'u1', email: 'admin@example.com' },
      settings: {}, updateSettings: vi.fn(),
      getLocation: () => fakeLocation('https://merakinailstudio.plumenexus.com/?connect=oauth-callback&code=cd&state=st'),
      replaceState,
    }));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    expect(completeMock).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('swallows server errors without surfacing them as unhandled promise rejections', async () => {
    completeMock.mockImplementationOnce(() => Promise.reject(new Error('CSRF state failed')));
    const replaceState = vi.fn();
    renderHook(() => useStripeConnectOAuthCallback({
      gUser: { uid: 'u1' }, settings: {}, updateSettings: vi.fn(),
      getLocation: () => fakeLocation('https://merakinailstudio.plumenexus.com/?connect=oauth-callback&code=bad&state=bad'),
      replaceState,
    }));
    await waitFor(() => expect(completeMock).toHaveBeenCalled());
    // No throw means the catch did its job
  });
});
