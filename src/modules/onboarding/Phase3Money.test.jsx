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
vi.mock('../../lib/firebase', () => ({
  callFn: () => vi.fn(() => Promise.resolve({ data: { clientSecret: 'cs_fake' } })),
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

  it('shows "Set up payments" when no account exists', () => {
    appState = { stripeConnect: null };
    render(<Phase3Money onboarding={baseOnboarding} onAdvance={vi.fn()} saving={false} />);
    expect(screen.getByRole('button', { name: /Set up payments/i })).toBeInTheDocument();
  });

  it('clicking "Set up payments" opens the embedded modal directly (no prefill, no redirect)', async () => {
    appState = { stripeConnect: null };
    render(<Phase3Money onboarding={baseOnboarding} onAdvance={vi.fn()} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Set up payments/i }));
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
