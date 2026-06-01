// Smoke test for the hosted /r/{token} receipt view route.
//
// Scope: verifies the SPA route is wired and the page handles the
// "receipt not found" path cleanly. Full happy-path (checkout creates
// receipt → token resolves → rating submits → smart Google routing) is
// covered by:
//   - unit tests in functions/lib/receiptEmail.test.js (rating CTA HTML)
//   - manual sandbox-mode walkthrough documented in
//     docs/SMS_TFN_REGISTRATION_DRAFT.md
//
// We can't seed a real receipt from a public Playwright run (writes
// require admin auth), so we exercise the failure path which still
// proves the route resolves, the React app boots, and the callable
// returns 'not-found' rather than 500.

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://plumenexus-prod.web.app';
const BOGUS_TOKEN = 'NotARealTokenJustForTesting42';

test.describe('Hosted receipt view (/r/{token})', () => {
  test('unknown token renders Receipt-not-found message', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));

    await page.goto(`${BASE}/r/${BOGUS_TOKEN}`, { waitUntil: 'networkidle' });

    // Wait up to 10s for either the not-found message or the loading
    // spinner to clear into one. Either is acceptable as long as the
    // page doesn't crash.
    await expect(page.locator('text=/receipt not found/i')).toBeVisible({ timeout: 10_000 });

    // Hard requirement: no uncaught React/runtime errors.
    expect(consoleErrors, `Page errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('malformed path (token too short) falls through to webfront', async ({ page }) => {
    // /r/ with a 3-char token doesn't match our token regex — should
    // route to the salon webfront (default), not the receipt view.
    await page.goto(`${BASE}/r/abc`, { waitUntil: 'networkidle' });

    // The receipt-not-found message must NOT appear because we never
    // entered the receipt view at all.
    await expect(page.locator('text=/receipt not found/i')).toHaveCount(0);
  });
});
