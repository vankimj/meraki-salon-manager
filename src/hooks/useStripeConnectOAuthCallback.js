import { useEffect } from 'react';
import { callFn, auth } from '../lib/firebase';
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
export function useStripeConnectOAuthCallback({ gUser, settings, updateSettings, onSuccess, onError, getLocation, replaceState }) {
  // Indirection on window access so tests can drive the URL without JSDOM.
  const loc = getLocation || (() => window.location);
  const replace = replaceState || ((href) => window.history.replaceState({}, '', href));

  useEffect(() => {
    const location = loc();
    const params = new URLSearchParams(location.search);
    const connectVal = params.get('connect');
    const hasGUser = !!gUser;
    // Always log when this effect runs so we can see whether the
    // routing put the callback on this surface AND whether auth
    // resolved. Without these logs a silent bail looks the same as
    // "nothing happened" — making the failure undiagnosable.
    console.log('[Connect] effect fired', {
      url:        location.href.split('?')[0],
      connectVal,
      hasGUser,
      gUserUid:   gUser?.uid,
      gUserEmail: gUser?.email,
    });
    if (connectVal !== 'oauth-callback') {
      console.log('[Connect] bail: no connect=oauth-callback in URL');
      return;
    }
    if (!hasGUser) {
      console.log('[Connect] bail: gUser still null, waiting for auth to resolve');
      return;
    }

    const code  = params.get('code');
    const state = params.get('state');

    const url = new URL(location.href);
    ['connect', 'code', 'state', 'scope', 'tenant'].forEach(k => url.searchParams.delete(k));
    // Stripe registers the redirect URI as <tenant-subdomain>/?connect=oauth-callback
    // (no /manage path) — so on return we're at "/". If we just strip the
    // params, the URL becomes plain "/", and the next refresh would render
    // the public SalonWebfront instead of the management app. Rewrite the
    // path to /manage so a refresh keeps the salon in the admin surface.
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '/manage';
    }
    replace(url.toString());

    let cancelled = false;
    (async () => {
      try {
        // Logs intentionally verbose — we hit a "auth: MISSING" on the
        // server side in 2026-06-03 session that we couldn't diagnose
        // without seeing what was true on the client at call time.
        console.log('[Connect] hook fired', {
          hasGUser:           !!gUser,
          gUserUid:           gUser?.uid,
          gUserEmail:         gUser?.email,
          authCurrentUserUid: auth?.currentUser?.uid,
          authCurrentEmail:   auth?.currentUser?.email,
          codePresent:        !!code,
          statePresent:       !!state,
        });
        // Explicitly force an ID-token refresh BEFORE the callable so
        // the httpsCallable SDK definitely has a fresh token to attach.
        // If auth.currentUser is null we can't even get one — surface
        // that case loudly instead of silently posting unauthenticated.
        if (!auth?.currentUser) {
          console.error('[Connect] auth.currentUser is NULL — cannot claim OAuth code. Reload and re-sign-in.');
          if (!cancelled) onError?.(new Error('You were signed out during the redirect — reload and try again.'));
          return;
        }
        const idToken = await auth.currentUser.getIdToken(/* forceRefresh */ true);
        console.log('[Connect] got fresh ID token, len=', idToken?.length || 0);

        if (code && state) {
          const claimRes = await callFn('completeStripeConnectOAuth')({ code, state, tenantId: TENANT_ID });
          console.log('[Connect] claim result', claimRes?.data);
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
          // Fire the success hook so the host (AppShell) can toast +
          // restore wizard context. Called AFTER settings updates so
          // the consumer sees the fresh stripeConnect in their next
          // render if they re-read it.
          onSuccess?.(data.status);
        } else if (!cancelled) {
          onError?.(new Error('Connected, but we couldn’t read the account status. Open Settings → Payments to check.'));
        }
      } catch (e) {
        console.warn('[Connect] OAuth callback finalise failed:', e?.message, e?.code);
        if (!cancelled) onError?.(e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [gUser?.uid]);
}
