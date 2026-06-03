import { useEffect } from 'react';
import { callFn } from '../lib/firebase';
import { TENANT_ID } from '../lib/tenant';

// Claims the Stripe Connect Standard OAuth code returned to the tenant's
// root URL (?connect=oauth-callback&code=...&state=...). Used at the
// AppShell level so it fires regardless of which view the user lands on.
//
// CRITICAL ordering: do NOT strip URL params until gUser is resolved.
// AppContext loads auth asynchronously, so this effect typically fires
// twice — once on mount with gUser=null, again when auth resolves. If we
// stripped on the first pass, the code+state would disappear before the
// second pass could claim them.
export function useStripeConnectOAuthCallback({ gUser, settings, updateSettings, getLocation, replaceState }) {
  // Indirection on window access so tests can drive the URL without JSDOM.
  const loc = getLocation || (() => window.location);
  const replace = replaceState || ((href) => window.history.replaceState({}, '', href));

  useEffect(() => {
    const location = loc();
    const params = new URLSearchParams(location.search);
    if (params.get('connect') !== 'oauth-callback') return;
    if (!gUser) return;

    const code  = params.get('code');
    const state = params.get('state');

    const url = new URL(location.href);
    ['connect', 'code', 'state', 'scope', 'tenant'].forEach(k => url.searchParams.delete(k));
    replace(url.toString());

    let cancelled = false;
    (async () => {
      try {
        if (code && state) {
          await callFn('completeStripeConnectOAuth')({ code, state, tenantId: TENANT_ID });
        }
        const { data } = await callFn('getStripeConnectStatus')({ tenantId: TENANT_ID });
        if (!cancelled && data?.status) {
          await updateSettings({ ...(settings || {}), stripeConnect: {
            accountId:                data.status.accountId,
            accountType:              data.status.accountType,
            chargesEnabled:           data.status.chargesEnabled,
            payoutsEnabled:           data.status.payoutsEnabled,
            detailsSubmitted:         data.status.detailsSubmitted,
            businessName:             data.status.businessName,
            statementDescriptor:      data.status.statementDescriptor,
            requirementsCurrentlyDue: data.status.requirementsCurrentlyDue,
            updatedAt:                data.status.updatedAt,
          }});
        }
      } catch (e) {
        console.warn('[Connect] OAuth callback finalise failed:', e?.message, e?.code);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [gUser?.uid]);
}
