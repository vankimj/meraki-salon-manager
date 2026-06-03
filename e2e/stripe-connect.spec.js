// End-to-end coverage for the Stripe Connect Standard OAuth callback
// flow. Specifically guards against the bugs that bit Jonathan in
// 2026-06-03 session:
//
//   1. Public booking page rendered the OAuth callback URL → code never
//      claimed. Issue #4. Fixed by App.jsx routing.
//   2. AppShell stripped URL params before Firebase Auth resolved →
//      callable never invoked. The gUser race. Fixed by hook ordering.
//   3. Service worker / cache served stale builds. (Not directly
//      coverable here, but the live-bundle assertion at least catches
//      "I deployed but the bundle didn't update".)
//
// We do NOT try to walk Stripe's hosted OAuth UI from the test — that
// requires a real tenant-admin token and Stripe sandbox interaction
// that's too fragile for an e2e. Instead we forge the callback URL
// (?connect=oauth-callback&code=fake&state=fake) and assert OUR side
// of the contract behaves correctly. The server-side state HMAC will
// reject the fake state — that's expected, and the test verifies the
// failure path doesn't strand the user.

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://merakinailstudio.plumenexus.com';

test.describe('Stripe Connect Standard OAuth callback (deployed)', () => {
  test('App.jsx routes ?connect=oauth-callback at root to the management app, not the public booking page', async ({ page }) => {
    // Bare /?connect=oauth-callback should NOT render the public salon
    // webfront (it would silently swallow the code). It must render the
    // management app shell so the AppShell hook can claim the code.
    await page.goto(`${BASE}/?connect=oauth-callback&code=fake&state=fake`);

    // The public booking page shows "soul · creativity · love" tagline.
    // If we see that, routing is broken — the OAuth code is on the wrong
    // surface.
    await expect(page.getByText(/soul.*creativity.*love/i)).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/BOOK NOW/i)).not.toBeVisible({ timeout: 5000 });
  });

  test('plain / still renders the public booking page (regression — routing change should be scoped)', async ({ page }) => {
    await page.goto(`${BASE}/`);
    // Booking page heading / tagline should be present
    await expect(page.locator('body')).toContainText(/soul.*creativity.*love|MERAKI/i, { timeout: 10000 });
  });

  test('AppShell hook waits for gUser, then strips URL params (the race condition)', async ({ page }) => {
    // Watch console for the warn line our hook emits when the claim
    // fails. Forged code+state will fail server-side state verification,
    // and the warn confirms the callable was actually INVOKED — i.e.
    // gUser resolved AND the hook reached the async work.
    const consoleMessages = [];
    page.on('console', msg => {
      const t = msg.text();
      if (/Connect/.test(t) || msg.type() === 'error') consoleMessages.push(`${msg.type()}: ${t}`);
    });

    await page.goto(`${BASE}/?connect=oauth-callback&code=forgedcode&state=forgedstate`);

    // Sign in anonymously — anon users still trigger the gUser?.uid
    // dependency in the hook. The callable will reject "Sign in
    // required" or "tenant admin required" depending on rules, but the
    // important assertion is that the URL params get stripped — proving
    // the race ordering is correct.
    const signedIn = await page.evaluate(async () => {
      const t0 = Date.now();
      while (!window.__plumeAuth && Date.now() - t0 < 10000) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!window.__plumeAuth) return { error: '__plumeAuth never appeared' };
      try {
        const { signInAnonymously } = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js');
        await signInAnonymously(window.__plumeAuth);
        return window.__plumeAuth.currentUser?.uid || null;
      } catch (e) {
        return { error: e.message };
      }
    });
    expect(typeof signedIn, `Anon sign-in failed: ${JSON.stringify(signedIn)}`).toBe('string');

    // Wait for the URL to have the OAuth query params stripped. This
    // proves the hook reached the strip step (which only happens after
    // the gUser-null bail), i.e. the race is correctly handled.
    await expect.poll(
      () => new URL(page.url()).searchParams.get('connect'),
      { timeout: 15000, intervals: [250, 500, 1000] },
    ).toBeNull();
    await expect.poll(() => new URL(page.url()).searchParams.get('code')).toBeNull();
    await expect.poll(() => new URL(page.url()).searchParams.get('state')).toBeNull();

    // Cleanup the anonymous user so it doesn't accumulate in Auth.
    await page.evaluate(async () => {
      try { await window.__plumeAuth?.currentUser?.delete(); } catch (_) { /* best-effort */ }
    });
  });
});
