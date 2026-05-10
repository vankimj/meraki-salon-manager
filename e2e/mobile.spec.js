import { test, expect } from '@playwright/test';

// Mobile-specific tests. Run only under the mobile-iphone Playwright
// project (the chromium project sets testIgnore: ['**/mobile.spec.js']).
// They check that public surfaces don't introduce horizontal scroll on
// a 390px-wide viewport — the most common regression class for a
// salon-management app where the team builds on iPad and the techs
// check on phones.
test.describe('Mobile public surfaces', () => {
  async function noHorizontalOverflow(page) {
    const overflow = await page.evaluate(() => {
      const w = document.documentElement.scrollWidth;
      const v = window.innerWidth;
      return { scrollWidth: w, viewportWidth: v };
    });
    expect(overflow.scrollWidth, `body wider than viewport (${overflow.scrollWidth} vs ${overflow.viewportWidth})`)
      .toBeLessThanOrEqual(overflow.viewportWidth + 1); // +1 for rounding
  }

  test('booking page fits the viewport without horizontal scroll', async ({ page }) => {
    await page.goto('/?book=1');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await noHorizontalOverflow(page);
  });

  test('home / sign-in screen fits the viewport', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await noHorizontalOverflow(page);
  });

  test('terms page fits the viewport', async ({ page }) => {
    await page.goto('/?terms=1');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await noHorizontalOverflow(page);
  });

  test('signup wizard fits the viewport', async ({ page }) => {
    await page.goto('/?signup=1');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await noHorizontalOverflow(page);
  });
});
