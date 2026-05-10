import { test, expect } from '@playwright/test';

// Public-surface smoke tests — exercise routes that don't require Firebase
// auth. The dev server starts via playwright.config.js webServer block.

test.describe('Public surfaces', () => {
  test('main app renders without auth and shows the splash', async ({ page }) => {
    await page.goto('/');
    // The splash sticks around for ~2.6s; both the brand mark and "NAIL STUDIO"
    // line are visible during it. Either one being present means the app
    // mounted (didn't white-screen).
    await expect(page.locator('body')).not.toHaveText(/Cannot read|undefined|Error/i);
    // The shell should produce some text content within a reasonable window.
    await expect.poll(async () => (await page.locator('body').innerText()).length, { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('terms page (?terms) renders standalone', async ({ page }) => {
    await page.goto('/?terms=1');
    // Stand-alone routes should NOT mount the full AppShell. They render
    // their own minimal page.
    const body = await page.locator('body').innerText();
    expect(body.toLowerCase()).toMatch(/terms/);
  });

  test('privacy page (?privacy) renders standalone', async ({ page }) => {
    await page.goto('/?privacy=1');
    const body = await page.locator('body').innerText();
    expect(body.toLowerCase()).toMatch(/privacy/);
  });

  test('booking page (?book) loads without auth', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?book=1');
    // The booking page either shows the welcome step OR a "Book online" /
    // "Choose a service" prompt. If it crashed, errors[] would be populated.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    expect(errors).toEqual([]);
  });

  test('signup wizard (?signup) renders without crashing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?signup=1');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    expect(errors).toEqual([]);
    // Onboarding wizard is brand-prominent — "TipFlow" or "Plume Nexus"
    // appears at the top of the panel.
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(0);
  });

  test('console is free of uncaught errors on the home route', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Firebase emits noisy benign warnings in dev (cache-init, persistence,
        // emulator hints). We only fail on app-level errors.
        if (/firestore|firebase|persistence|cache|service worker/i.test(text)) return;
        errors.push(`CONSOLE: ${text}`);
      }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
