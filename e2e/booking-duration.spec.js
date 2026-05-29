import { test, expect } from '@playwright/test';

// Drives the PUBLIC online-booking wizard far enough to exercise the
// per-tech, duration-aware code paths added for per-service tech durations:
// Step 2 ("N min total" label) and Step 3 (slot grid) both now call
// cartTotalDuration() with the selected tech, and the no-preference branch
// checks each eligible tech against THEIR OWN per-service durations.
//
// This is a regression guard — it proves the wizard still renders and
// advances without throwing after that change. It intentionally STOPS
// before the final "Confirm booking" step so it never writes a real
// appointment to Firestore.
//
// The screens where the override is *set* (Employees admin) and where the
// schedule block is drawn (Schedule admin) are auth-gated and out of reach
// for this harness (no Firebase Auth Emulator yet). The duration math
// itself is unit-covered in src/lib/booking.test.js and
// src/utils/serviceHelpers.test.js.

test.describe('online booking — duration-aware wizard', () => {
  test('advances service → stylist → time without errors and shows a duration total', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.goto('/book');

    // Booking may be disabled on the tenant — then the wizard never renders.
    const chooser     = page.getByText('How would you like to book?');
    const unavailable = page.getByText(/Online booking unavailable/i);
    await Promise.race([
      chooser.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
      unavailable.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
    ]);
    test.skip(await unavailable.isVisible(), 'Online booking is disabled on this tenant');
    test.skip(!(await chooser.isVisible()), 'Booking wizard did not render (no config/services)');

    // time-first flow → service catalog
    await page.getByRole('button', { name: /Pick a time that works for me/i }).click();
    await expect(page.getByText('Choose your services')).toBeVisible({ timeout: 10000 });

    const addButtons = page.getByRole('button', { name: /\+\s*Add/ });
    test.skip((await addButtons.count()) === 0, 'No bookable services configured');
    await addButtons.first().click();

    // Sticky cart → stylist step
    await page.getByRole('button', { name: /Continue/i }).first().click();
    await expect(page.getByText('Choose your stylist')).toBeVisible({ timeout: 10000 });

    // If the only added service has no eligible tech we can't continue —
    // skip rather than fail (data-dependent, not a regression).
    const noEligible = page.getByText(/No single stylist offers all of these/i);
    test.skip(await noEligible.isVisible(), 'Added service has no eligible stylist');

    // Step 2 renders the tech-aware total duration ("N min total").
    await expect(page.getByText(/\d+\s*min total/i)).toBeVisible();

    // "No preference" exercises Step 3's per-tech availability branch (each
    // eligible tech checked against their own per-service durations).
    await page.getByText('No preference').click();
    await page.getByRole('button', { name: /Continue/i }).click();

    await expect(page.getByText('Pick a date')).toBeVisible({ timeout: 10000 });

    // No uncaught runtime errors anywhere along the driven path.
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
