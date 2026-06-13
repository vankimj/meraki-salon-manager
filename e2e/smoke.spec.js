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

  test('terms via clean path (/terms) renders', async ({ page }) => {
    await page.goto('/terms');
    await expect.poll(
      async () => (await page.locator('body').innerText()).toLowerCase(),
      { timeout: 10000 },
    ).toMatch(/terms/);
  });

  test('privacy via clean path (/privacy) renders', async ({ page }) => {
    await page.goto('/privacy');
    await expect.poll(
      async () => (await page.locator('body').innerText()).toLowerCase(),
      { timeout: 10000 },
    ).toMatch(/privacy/);
  });

  test('book via clean path (/book) loads without auth', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/book');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    expect(errors).toEqual([]);
  });

  test('sms-consent via clean path (/sms-consent) renders', async ({ page }) => {
    await page.goto('/sms-consent');
    await expect.poll(
      async () => (await page.locator('body').innerText()).toLowerCase(),
      { timeout: 10000 },
    ).toMatch(/sms|opt|consent/i);
  });

  test('terms via legacy query (?terms=1) still renders for back-compat', async ({ page }) => {
    await page.goto('/?terms=1');
    // Stand-alone routes should NOT mount the full AppShell. They render
    // their own minimal page. App.jsx is dynamically imported after
    // resolveTenant() so the body briefly innerText='' — poll instead of
    // a one-shot read.
    await expect.poll(
      async () => (await page.locator('body').innerText()).toLowerCase(),
      { timeout: 10000 },
    ).toMatch(/terms/);
  });

  test('privacy page (?privacy) renders standalone', async ({ page }) => {
    await page.goto('/?privacy=1');
    await expect.poll(
      async () => (await page.locator('body').innerText()).toLowerCase(),
      { timeout: 10000 },
    ).toMatch(/privacy/);
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
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Allowed-list of known-benign Firebase console warnings. Anything
      // not on this list — including "Service firestore is not available"
      // and "is not a constructor" — fails the test. The 2026-05-10
      // Vite/Rolldown chunk-order regression produced exactly that
      // shape and would have been caught here pre-deploy.
      const benign = [
        /persistent cache init failed, falling back to memory/i,
        /Firestore.*Connection .* will not be retried/i,
        /service worker.*registration/i,
        /apple-mobile-web-app-capable.*deprecated/i,
        // Network-level resource failures are not app-init bugs: font-CDN
        // hiccups, Firestore long-poll aborts (normal lifecycle), RUM/analytics
        // beacons, and ORB/CORS-blocked third-party images. The Firebase
        // chunk-order regression this suite guards surfaces as a pageerror
        // ("is not a constructor" / "Service X not available") — caught above
        // and by the dedicated sentinel test — not as a net::ERR_ resource
        // failure. HTTP-status failures (e.g. a 404 on a broken app chunk) do
        // NOT match net::ERR_, so they still fail the test.
        /Failed to load resource:.*net::ERR_/i,
      ];
      if (benign.some(rx => rx.test(text))) return;
      errors.push(`CONSOLE: ${text}`);
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    expect(errors, errors.join('\n')).toEqual([]);
  });

  // Sentinel test for the Firebase chunk-order class of bug. Passes when
  // the bundle is healthy; fails the moment any Firebase service throws
  // "Ap is not a constructor" / "Service X is not available" / similar
  // class-resolution failure during init. Shape-matched to the 2026-05-10
  // Vite 8 + Rolldown regression so the same hole can't reopen silently.
  test('firebase services initialize without constructor errors', async ({ page }) => {
    const fatals = [];
    page.on('pageerror', e => {
      const m = e.message || '';
      if (/is not a constructor|Service \w+ is not available|firestore.*not available/i.test(m)) {
        fatals.push(`PAGE ERROR: ${m}`);
      }
    });
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const m = msg.text();
      if (/is not a constructor|Service \w+ is not available/i.test(m)) {
        fatals.push(`CONSOLE: ${m}`);
      }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    // Page should also have non-empty body; a constructor failure leaves
    // it blank because React never mounts.
    const bodyText = await page.locator('body').innerText();
    expect(fatals, fatals.join('\n')).toEqual([]);
    expect(bodyText.length, 'body is empty — bundle likely failed to mount').toBeGreaterThan(20);
  });
});
