import { test, expect } from '@playwright/test';

// E2E for the additive add-on feature, run against a PREVIEW CHANNEL carrying
// the feat/service-addons build (the feature isn't on live prod yet). Depends
// on the seeded demo pair (scripts/claude-test-account.cjs seed-addons):
//   "ZZZ-CLAUDE-TEST Base" ($40 / 45m) offers add-on "ZZZ-CLAUDE-TEST Add-On" ($15 / 15m).
// Drives the public /book flow: add the base, toggle the add-on, and assert the
// sticky cart total stacks ($40 → $55) and the line count rises (1 → 2).
// Read-only: stops before submitting any booking. Skips unless the add-on env
// flag is set so it never runs by accident.

const BASE  = 'ZZZ-CLAUDE-TEST Base';
const ADDON = 'ZZZ-CLAUDE-TEST Add-On';

test.describe('claude add-ons', () => {
  test.skip(!process.env.CLAUDE_ADDON_E2E, 'set CLAUDE_ADDON_E2E=1 (preview channel + seeded add-on pair)');

  test('booking: toggling an add-on stacks its price + time onto the base', async ({ page }) => {
    test.setTimeout(120000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));

    await page.goto('/book?tenant=demo', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Location chooser (demo has 2 locations) — auto-waiting click; .catch in
    // case a config ever skips straight to the flow chooser.
    await page.getByRole('button', { name: /Northside/ }).first().click({ timeout: 20000 }).catch(() => {});

    // Flow chooser → service-first path lands on the service catalog.
    await page.getByText('Pick a time that works for me').first().click({ timeout: 20000 });

    // Service catalog: add the seeded base service.
    await expect(page.getByText(BASE).first()).toBeVisible({ timeout: 15000 });
    const baseCard = page.locator('div')
      .filter({ hasText: BASE })
      .filter({ has: page.getByRole('button', { name: '+ Add' }) })
      .last();
    await baseCard.getByRole('button', { name: '+ Add' }).click();

    // Sticky cart now shows the base alone.
    await expect(page.getByText(/1 service · \$40\b/).first()).toBeVisible({ timeout: 10000 });

    // The add-on toggle appears on the (now in-cart) base service. Toggle it on.
    const addOnToggle = baseCard.getByRole('button', { name: new RegExp(ADDON) }).first();
    await expect(addOnToggle).toBeVisible({ timeout: 8000 });
    await addOnToggle.click();

    // Add-on stacked: 2 lines, total $40 + $15 = $55.
    await expect(page.getByText(/2 services · \$55\b/).first()).toBeVisible({ timeout: 10000 });

    // Toggle it back off → returns to the base alone.
    await addOnToggle.click();
    await expect(page.getByText(/1 service · \$40\b/).first()).toBeVisible({ timeout: 10000 });

    console.log('[claude-addons] add-on stacked $40 → $55 and back; line count 1 → 2 → 1');
    const real = errors.filter((m) => !/ERR_ABORTED|Failed to load resource|fonts\.gstatic/i.test(m));
    expect(real, real.join('\n')).toEqual([]);
  });
});
