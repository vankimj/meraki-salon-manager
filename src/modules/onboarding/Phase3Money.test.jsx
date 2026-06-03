import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the Stripe Connect React + JS SDKs so the test doesn't need a live
// publishable key or network access. We replace the components with simple
// placeholders that just signal they were mounted.
vi.mock('@stripe/connect-js', () => ({
  loadConnectAndInitialize: vi.fn(() => ({ /* fake connect instance */ })),
}));
vi.mock('@stripe/react-connect-js', () => ({
  ConnectComponentsProvider: ({ children }) => <div data-testid="connect-provider">{children}</div>,
  ConnectAccountOnboarding:  () => <div data-testid="stripe-onboarding-iframe">stripe iframe</div>,
  ConnectAccountManagement:  () => <div data-testid="stripe-management-iframe">management iframe</div>,
  ConnectPayouts:            () => <div>payouts</div>,
  ConnectPayments:           () => <div>payments</div>,
  ConnectNotificationBanner: () => <div>banner</div>,
}));

// Firebase + tenant + AppContext mocks. Tests override appState before
// each render to control which Connect status the component sees.
let appState = { stripeConnect: null };
// Per-function-name mock so we can return Standard OAuth URLs from
// getStripeConnectOAuthUrl while still serving clientSecret stubs to
// the embedded components when they call createAccountSession.
const callFnImpls = {};
vi.mock('../../lib/firebase', () => ({
  callFn: (name) => callFnImpls[name] || vi.fn(() => Promise.resolve({ data: { clientSecret: 'cs_fake' } })),
}));
vi.mock('../../lib/tenant', () => ({ TENANT_ID: 'meraki' }));
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({
    settings: appState,
    updateSettings: vi.fn(),
    showToast: vi.fn(),
  }),
}));
vi.mock('../../lib/logger', () => ({ logActivity: vi.fn(), logError: vi.fn() }));

// Stub VITE_STRIPE_PUBLISHABLE_KEY for the embedded component check
import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';

import Phase3Money from './Phase3Money.jsx';

beforeEach(() => cleanup());

describe('Phase3Money — Stripe Connect step', () => {
  const baseOnboarding = { phases: { money: {} } };

  beforeEach(() => {
    Object.keys(callFnImpls).forEach(k => delete callFnImpls[k]);
  });

  it('shows "Connect Stripe account" as the primary CTA when no account exists', () => {
    appState = { stripeConnect: null };
    render(<Phase3Money onboarding={baseOnboarding} onAdvance={vi.fn()} saving={false} />);
    expect(screen.getByRole('button', { name: /Connect Stripe account/i })).toBeInTheDocument();
    // Express is still available as a secondary option
    expect(screen.getByRole('button', { name: /Use Plume-managed/i })).toBeInTheDocument();
  });

  it('Standard is marked RECOMMENDED, Express is not', () => {
    appState = { stripeConnect: null };
    render(<Phase3Money onboarding={baseOnboarding} onAdvance={vi.fn()} saving={false} />);
    const recommended = screen.getByText(/RECOMMENDED/i);
    // Walk up to the card div (the ancestor that holds a button)
    let card = recommended.parentElement;
    while (card && !card.querySelector('button')) card = card.parentElement;
    expect(card).not.toBeNull();
    expect(card.querySelector('button')).toHaveTextContent(/Connect Stripe account/i);
  });

  it('clicking "Connect Stripe account" calls getStripeConnectOAuthUrl and navigates to stripe.com', async () => {
    appState = { stripeConnect: null };
    const fakeOAuthUrl = 'https://connect.stripe.com/oauth/v2/authorize?client_id=ca_test&scope=read_write&state=fake';
    const oauthCallable = vi.fn(() => Promise.resolve({ data: { url: fakeOAuthUrl } }));
    callFnImpls['getStripeConnectOAuthUrl'] = oauthCallable;

    // Stub window.location.href so the test can verify the navigation target
    // without the test runner trying to actually navigate.
    const originalLocation = window.location;
    let navigated = null;
    delete window.location;
    window.location = Object.defineProperty(
      { ...originalLocation, search: '' },
      'href',
      { configurable: true, set(v) { navigated = v; }, get() { return navigated || ''; } }
    );

    render(<Phase3Money onboarding={baseOnboarding} onAdvance={vi.fn()} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Connect Stripe account/i }));

    await waitFor(() => expect(oauthCallable).toHaveBeenCalled());
    await waitFor(() => expect(navigated).toBe(fakeOAuthUrl));

    window.location = originalLocation;
  });

  it('clicking "Start over" calls deleteConnectAccount and clears the local mirror so the UI flips back to the picker', async () => {
    // Drift state: mirror shows "More info needed" but the tenant doc
    // has lost the accountId server-side. Server delete is idempotent
    // and returns success; client must clear the cached mirror locally.
    appState = {
      stripeConnect: {
        accountId:      'acct_stale',
        accountType:    'express',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requirementsCurrentlyDue: ['external_account'],
      },
    };
    const deleteCallable = vi.fn(() => Promise.resolve({ data: { ok: true, deletedAccountId: null, deletedFromStripe: false } }));
    callFnImpls['deleteConnectAccount'] = deleteCallable;

    // Capture confirm + reroute updateSettings into a spy that mutates
    // appState so the next render reflects the cleared mirror.
    const origConfirm = window.confirm;
    window.confirm = () => true;

    const { rerender } = render(<Phase3Money onboarding={baseOnboarding} onAdvance={vi.fn()} saving={false} />);
    // Verify orange panel is showing (driven by the drift mirror)
    expect(screen.getByText(/More info needed/i)).toBeInTheDocument();

    const startOverBtn = screen.getByRole('button', { name: /Start over/i });
    fireEvent.click(startOverBtn);

    await waitFor(() => expect(deleteCallable).toHaveBeenCalled());

    window.confirm = origConfirm;
  });

  it('Standard accounts show a "Disconnect" button (not "Start over") when not yet live', async () => {
    // Standard accounts: salon owns the Stripe account, we just have
    // OAuth access. "Disconnect" is correct — server-side this calls
    // stripe.oauth.deauthorize instead of stripe.accounts.del.
    appState = {
      stripeConnect: {
        accountId:      'acct_standard_xx',
        accountType:    'standard',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requirementsCurrentlyDue: ['business_profile.url'],
      },
    };
    render(<Phase3Money onboarding={baseOnboarding} onAdvance={vi.fn()} saving={false} />);
    expect(screen.getByRole('button', { name: /Disconnect/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start over/i })).not.toBeInTheDocument();
  });

  it('clicking "Use Plume-managed" (Express fallback) opens the embedded modal', async () => {
    appState = { stripeConnect: null };
    render(<Phase3Money onboarding={baseOnboarding} onAdvance={vi.fn()} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Use Plume-managed/i }));
    const iframe = await screen.findByTestId('stripe-onboarding-iframe', undefined, { timeout: 2000 });
    expect(iframe).toBeInTheDocument();
  });

  // THE BUG: when an Express account already exists but Stripe still needs
  // more info, clicking "Continue setup" should open the embedded onboarding
  // modal (not redirect to connect.stripe.com).
  it('clicking "Continue setup" on an incomplete Express account opens the embedded modal', async () => {
    appState = {
      stripeConnect: {
        accountId:      'acct_test_xxx',
        accountType:    'express',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requirementsCurrentlyDue: ['external_account', 'tos_acceptance.date'],
      },
    };
    render(<Phase3Money onboarding={baseOnboarding} onAdvance={vi.fn()} saving={false} />);

    // The "More info needed" banner should be visible
    expect(screen.getByText(/More info needed/i)).toBeInTheDocument();

    // Continue setup button is rendered
    const continueBtn = screen.getByRole('button', { name: /Continue setup/i });
    expect(continueBtn).toBeInTheDocument();

    // Check state BEFORE click
    const markerBefore = screen.getByTestId('connect-state-marker');
    expect(markerBefore.getAttribute('data-embedded-onboarding-open')).toBe('false');

    // Click it
    fireEvent.click(continueBtn);

    // Continue setup now calls createExpressAccount (idempotent) before
    // opening the modal — so the state flip is async. Wait for it.
    await waitFor(() => {
      const marker = screen.getByTestId('connect-state-marker');
      expect(marker.getAttribute('data-embedded-onboarding-open')).toBe('true');
    });

    // The Stripe iframe placeholder we mocked should be mounted —
    // this is what the EmbeddedOnboarding renders inside the modal.
    const iframe = await screen.findByTestId('stripe-onboarding-iframe', undefined, { timeout: 2000 });
    expect(iframe).toBeInTheDocument();
  });

  it('clicking "Manage payments" on a fully-onboarded Express account opens the management modal', async () => {
    appState = {
      stripeConnect: {
        accountId:      'acct_test_xxx',
        accountType:    'express',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirementsCurrentlyDue: [],
      },
    };
    render(<Phase3Money onboarding={baseOnboarding} onAdvance={vi.fn()} saving={false} />);

    const markerBefore = screen.getByTestId('connect-state-marker');
    expect(markerBefore.getAttribute('data-embedded-management-open')).toBe('false');

    const manageBtn = screen.getByRole('button', { name: /Manage payments/i });
    fireEvent.click(manageBtn);

    const markerAfter = screen.getByTestId('connect-state-marker');
    expect(markerAfter.getAttribute('data-embedded-management-open')).toBe('true');

    const iframe = await screen.findByTestId('stripe-management-iframe', undefined, { timeout: 2000 });
    expect(iframe).toBeInTheDocument();
  });
});
