// End-to-end Phone OTP flow test, run against the Firebase Auth EMULATOR.
//
// Why the emulator (not a prod test phone): a Firebase test phone number
// configured in the live project is a real verification backdoor (that one
// number bypasses SMS with a fixed code in prod). We don't want to keep one
// just for CI. The emulator gives the same coverage with zero prod surface:
//   - SignupPage's reCAPTCHA verifier mounts without CSP errors
//   - sendOtp resolves to the awaiting-code state
//   - verifyOtp transitions to verified
//   - the CSP doesn't block the iframes/scripts the flow needs
//
// Driven by `npm run test:otp:emulated`, which boots the Auth emulator
// (firebase emulators:exec --only auth) and serves the marketing app pointed
// at it (VITE_USE_EMULATORS=1, see plumenexus/src/lib/firebase.js +
// scripts/otp-emulator-run.cjs). The verification code is read back from the
// emulator's REST API rather than hardcoded — no test phone needed anywhere.
//
// Skipped unless OTP_EMULATOR=1 so it never runs against a real backend
// (e.g. the generic `npm run e2e` smoke run or a deployed preview channel).
//
// Cannot test the actual Create-my-salon submit because provisionTenant
// requires a real phone number (verifiedPhone from Admin SDK userRecord),
// which the emulator flow doesn't set. That part is covered by the existing
// 'Create my salon button is disabled until signed in' test + server unit logic.

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4175';
const PROJECT_ID = 'plumenexus-prod';
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
// Any well-formed US number works against the emulator (no SMS is sent).
const PHONE_FORMATTED = '(555) 123-4599';
const PHONE_E164 = '+15551234599';

// Pull the most recent verification code the Auth emulator generated for our
// number from its REST API. Polls briefly because the code lands a moment
// after linkWithPhoneNumber resolves.
async function readEmulatorCode(request, phoneE164) {
  const url = `http://${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/verificationCodes`;
  for (let i = 0; i < 30; i++) {
    const res = await request.get(url);
    if (res.ok()) {
      const body = await res.json();
      const codes = (body.verificationCodes || []).filter(c => c.phoneNumber === phoneE164);
      if (codes.length) return codes[codes.length - 1].code;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`No verification code surfaced by the Auth emulator for ${phoneE164}`);
}

test.describe('signup OTP flow (Firebase Auth emulator)', () => {
  test.skip(process.env.OTP_EMULATOR !== '1', 'emulator-only — run via `npm run test:otp:emulated`');

  test('end-to-end: anonymous sign-in → linkWithPhoneNumber → verified', async ({ page, request }) => {
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

    // Sign in anonymously via the page's already-initialized Firebase Auth
    // instance (exposed as window.__plumeAuth, connected to the emulator). We
    // can't use signInWithGoogle from a Playwright context (popup blocked); any
    // signed-in user lets linkWithPhoneNumber attach the phone.
    const signedIn = await page.evaluate(async () => {
      const t0 = Date.now();
      while (!window.__plumeAuth && Date.now() - t0 < 5000) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!window.__plumeAuth) return { error: '__plumeAuth never appeared' };
      // Bypass the reCAPTCHA app-verifier for E2E (the emulator still issues a
      // code, read back via its REST API). Documented Firebase E2E pattern.
      window.__plumeAuth.settings.appVerificationDisabledForTesting = true;
      const { signInAnonymously } = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js');
      try {
        await signInAnonymously(window.__plumeAuth);
        return window.__plumeAuth.currentUser?.uid || null;
      } catch (e) {
        return { error: e.message };
      }
    });
    expect(typeof signedIn, `Anon sign-in failed: ${JSON.stringify(signedIn)}`).toBe('string');

    // Phone field is visible regardless of sign-in state.
    const phoneInput = page.getByPlaceholder('(555) 123-4567');
    await expect(phoneInput).toBeVisible();
    await phoneInput.fill(PHONE_FORMATTED);

    // Click Send code — should transition to awaiting-code.
    await page.getByRole('button', { name: /Send code/ }).click();
    await expect(page.getByPlaceholder('6-digit code')).toBeVisible({ timeout: 15000 });

    // Read the emulator-generated code and verify.
    const code = await readEmulatorCode(request, PHONE_E164);
    await page.getByPlaceholder('6-digit code').fill(code);
    await page.getByRole('button', { name: /Verify/ }).click();

    // Verified badge appears.
    await expect(page.getByText('✓ Verified')).toBeVisible({ timeout: 10000 });

    expect(errors, `Unexpected errors:\n${errors.join('\n')}`).toEqual([]);

    // Cleanup — delete the just-linked anonymous user. Emulator state is
    // ephemeral, but this keeps reruns within one emulator session clean.
    await page.evaluate(async () => {
      try { await window.__plumeAuth?.currentUser?.delete(); } catch (_) { /* best-effort */ }
    });
  });
});
