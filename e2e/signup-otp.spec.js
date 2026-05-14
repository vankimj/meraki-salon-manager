// End-to-end Phone OTP flow test, driven entirely from the browser
// context. Uses Firebase Auth's test-phone-number feature so no real
// SMS is sent and reCAPTCHA validation is bypassed for that one number.
// Test phone configured server-side via scripts/preflight-phone-auth.cjs
// (which surfaces test phones in its report).
//
// The signed-in user is provisioned via signInAnonymously, then
// linkWithPhoneNumber attaches the test phone to that anon user. This
// proves:
//   - SignupPage's reCAPTCHA verifier mounts without CSP errors
//   - sendOtp resolves to the awaiting-code state
//   - verifyOtp transitions to verified
//   - CSP doesn't block any of the iframes/scripts needed
//
// Cannot test the actual Create-my-salon submit because provisionTenant
// requires a real phone number (verifiedPhone from Admin SDK userRecord),
// which the test phone shortcut doesn't set. That part is covered by
// the existing 'Create my salon button is disabled until signed in'
// test plus the server unit logic.

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://plumenexus.com';
const TEST_PHONE_DIGITS = '5005550006'; // E.164: +15005550006
const TEST_PHONE_FORMATTED = '(500) 555-0006';
const TEST_OTP_CODE = '123456';

test.describe('signup OTP flow (Firebase test phone)', () => {
  test('end-to-end: anonymous sign-in → linkWithPhoneNumber → verified', async ({ page }) => {
    // Watch for CSP / network errors that would silently break the flow.
    const errors = [];
    page.on('console', msg => {
      const t = msg.text();
      if (msg.type() === 'error' && /Content Security Policy|Refused to|auth\/internal-error/i.test(t)) {
        errors.push(t);
      }
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE}/signup`);
    await expect(page.getByRole('heading', { name: 'Start your salon' })).toBeVisible();

    // Sign in anonymously via the page's already-initialized Firebase
    // Auth instance (exposed as window.__plumeAuth). We can't use
    // signInWithGoogle from a Playwright context (popup blocked); any
    // signed-in user lets linkWithPhoneNumber attach the test phone.
    const signedIn = await page.evaluate(async () => {
      // Wait up to 5s for plumeAuth to surface (in case the bundle
      // hasn't initialized yet by the time we eval).
      const t0 = Date.now();
      while (!window.__plumeAuth && Date.now() - t0 < 5000) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!window.__plumeAuth) return { error: '__plumeAuth never appeared' };
      const { signInAnonymously } = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js');
      try {
        await signInAnonymously(window.__plumeAuth);
        return window.__plumeAuth.currentUser?.uid || null;
      } catch (e) {
        return { error: e.message };
      }
    });
    expect(typeof signedIn, `Anon sign-in failed: ${JSON.stringify(signedIn)}`).toBe('string');

    // Wait for the phone field — it should be visible regardless of
    // sign-in state (we removed disabled={!user}).
    const phoneInput = page.getByPlaceholder('(555) 123-4567');
    await expect(phoneInput).toBeVisible();
    await phoneInput.fill(TEST_PHONE_FORMATTED);

    // Click Send code — should transition to awaiting-code.
    await page.getByRole('button', { name: /Send code/ }).click();
    // Code-input field has placeholder '6-digit code' once awaiting state.
    await expect(page.getByPlaceholder('6-digit code')).toBeVisible({ timeout: 15000 });

    // Enter the test code, click Verify.
    await page.getByPlaceholder('6-digit code').fill(TEST_OTP_CODE);
    await page.getByRole('button', { name: /Verify/ }).click();

    // Verified badge appears.
    await expect(page.getByText('✓ Verified')).toBeVisible({ timeout: 10000 });

    expect(errors, `Unexpected errors:\n${errors.join('\n')}`).toEqual([]);

    // Cleanup — delete the just-linked anonymous user so the test phone
    // (+15005550006) is released. Without this, the next run hits
    // 'auth/account-exists-with-different-credential' because the phone
    // is permanently linked to the previous run's anon user.
    await page.evaluate(async () => {
      try { await window.__plumeAuth?.currentUser?.delete(); } catch (_) { /* best-effort */ }
    });
  });
});
