import { test, expect } from '@playwright/test';

// Verifies the multi-site PUBLIC booking location chooser (Phase 4) end-to-end
// against the `demo` tenant, which has two active locations (Downtown +
// Northside). This depends on data/locations being PUBLICLY readable — without
// that rule the unauthenticated read fails, the page silently falls back to
// single-location, and the chooser never renders. So this spec is the
// regression guard for both the chooser UI and the public-read rule.
//
// Read-only: it stops after picking a location (before any "Confirm booking"),
// so it never writes an appointment.

test.describe('online booking — multi-location location chooser', () => {
  test('a 2-location tenant shows the chooser, and picking one advances the wizard', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    // ?tenant=demo pins the session to the demo tenant (detectTenantId).
    await page.goto('/book?tenant=demo');

    const chooser     = page.getByText('Choose a location');
    const unavailable = page.getByText(/Online booking unavailable/i);
    await Promise.race([
      chooser.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}),
      unavailable.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}),
    ]);
    test.skip(await unavailable.isVisible(), 'Online booking disabled on demo tenant');

    // The chooser renders, listing both demo branches.
    await expect(chooser).toBeVisible();
    await expect(page.getByText('Downtown')).toBeVisible();
    await expect(page.getByRole('button', { name: /Northside/ })).toBeVisible();

    // Picking a location clears the gate and drops into the booking wizard.
    await page.getByRole('button', { name: /Northside/ }).click();
    await expect(chooser).toBeHidden({ timeout: 15000 });
    // Landed on the booking wizard's flow chooser (past the location gate).
    await expect(page.getByText('How would you like to book?')).toBeVisible({ timeout: 15000 });

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
