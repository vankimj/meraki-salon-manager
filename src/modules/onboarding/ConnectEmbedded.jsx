// Stripe Embedded Connect components — Plume-branded onboarding +
// dashboard without redirecting to stripe.com. Stripe ships pre-built
// React components that mount inline in our app, fed by a short-lived
// AccountSession client_secret minted by the Cloud Function.
//
// Customer never sees stripe.com URLs. The component renders inside
// Plume's container with Plume's branding around it.

import { useEffect, useRef, useState } from 'react';
import { loadConnectAndInitialize } from '@stripe/connect-js';
import {
  ConnectComponentsProvider,
  ConnectAccountOnboarding,
  ConnectAccountManagement,
  ConnectPayouts,
  ConnectPayments,
  ConnectNotificationBanner,
} from '@stripe/react-connect-js';
import { callFn } from '../../lib/firebase';
import { TENANT_ID } from '../../lib/tenant';

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

// Wraps any embedded Connect component with the provider + session-fetch
// boilerplate. Pass the component names you need and we'll mint a session
// with exactly those scopes. Re-fetches on session expiry automatically.
function ConnectShell({ components, children, onError }) {
  const [stripeConnect, setStripeConnect] = useState(null);
  const [err, setErr] = useState('');
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    if (!PUBLISHABLE_KEY) {
      const msg = 'VITE_STRIPE_PUBLISHABLE_KEY not configured';
      setErr(msg);
      onError?.(msg);
      return;
    }

    const instance = loadConnectAndInitialize({
      publishableKey: PUBLISHABLE_KEY,
      fetchClientSecret: async () => {
        try {
          const { data } = await callFn('createAccountSession')({
            tenantId: TENANT_ID,
            components,
          });
          if (!data?.clientSecret) throw new Error('No client_secret returned');
          return data.clientSecret;
        } catch (e) {
          setErr(e.message || 'Failed to mint session');
          onError?.(e.message);
          throw e;
        }
      },
      appearance: {
        // Plume brand colors so the embedded UI feels native
        variables: {
          colorPrimary:    '#2D7A5F',  // green
          colorBackground: '#ffffff',
          colorText:       '#1a1a1a',
          colorDanger:     '#dc2626',
          fontFamily:      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          borderRadius:    '10px',
        },
      },
    });
    setStripeConnect(instance);
  }, [components, onError]);

  if (err) {
    return (
      <div style={{ padding: 14, borderRadius: 8, background: 'var(--pn-danger-bg)', border: '1px solid #fecaca', color: 'var(--pn-danger)', fontSize: 13 }}>
        {err}
      </div>
    );
  }
  if (!stripeConnect) {
    return (
      <div style={{ padding: 14, color: 'var(--pn-text-muted)', fontSize: 13 }}>Loading…</div>
    );
  }
  return (
    <ConnectComponentsProvider connectInstance={stripeConnect}>
      {children}
    </ConnectComponentsProvider>
  );
}

// Embedded account onboarding flow — replaces the redirect to
// connect.stripe.com/setup. Salon stays inside Plume the whole time;
// Stripe renders its form inside an iframe styled with Plume's brand.
export function EmbeddedOnboarding({ onExit }) {
  return (
    <ConnectShell components={['account_onboarding']}>
      <ConnectAccountOnboarding
        onExit={() => onExit?.()}
      />
    </ConnectShell>
  );
}

// Embedded account management — replaces the "Open Stripe Dashboard"
// login link. Salon sees their settings + bank account + business
// details in a Plume-branded panel.
export function EmbeddedAccountManagement() {
  return (
    <ConnectShell components={['account_management']}>
      <ConnectAccountManagement />
    </ConnectShell>
  );
}

// Embedded payouts — replaces the "Payouts" tab of the Stripe dashboard.
// Salon sees their balance, pending payouts, payout history.
export function EmbeddedPayouts() {
  return (
    <ConnectShell components={['payouts']}>
      <ConnectPayouts />
    </ConnectShell>
  );
}

// Embedded payments — the salon's transaction list (charges, refunds).
export function EmbeddedPayments() {
  return (
    <ConnectShell components={['payments']}>
      <ConnectPayments />
    </ConnectShell>
  );
}

// Notification banner — Stripe surfaces required actions (e.g.
// "Upload ID document", "Verify bank account") at the top of any
// embedded component. Keep this mounted globally so the salon always
// sees the latest action items.
export function EmbeddedNotificationBanner() {
  return (
    <ConnectShell components={['notification_banner']}>
      <ConnectNotificationBanner />
    </ConnectShell>
  );
}
