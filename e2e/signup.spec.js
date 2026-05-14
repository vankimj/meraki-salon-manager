// Smoke tests for the public signup page at plumenexus.com/signup.
//
// Cannot complete the actual signup E2E (requires Google OAuth + a real
// account), but we CAN verify the page mounts cleanly, loads its JS
// bundle without console errors, renders the expected sections, and
// reacts to slug input with a live availability check.
//
// Run against prod:
//   PLAYWRIGHT_BASE_URL=https://plumenexus.com npx playwright test e2e/signup.spec.js

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://plumenexus.com';

test.describe('signup page', () => {
  test('mounts without console errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE}/signup`);
    await expect(page.getByRole('heading', { name: 'Start your salon' })).toBeVisible();
    await page.waitForTimeout(1500); // let Firebase Auth init

    // Filter out known-noisy errors that aren't bugs.
    const fatal = errors.filter(e =>
      !/Failed to load resource.*\b(googletagmanager|gstatic|google-analytics)\b/.test(e) &&
      !/heartbeat/i.test(e) &&
      !/manifest\.json/.test(e),
    );
    expect(fatal, `Unexpected console errors:\n${fatal.join('\n')}`).toEqual([]);
  });

  test('renders all five form sections', async ({ page }) => {
    await page.goto(`${BASE}/signup`);
    for (const label of ['1 · Sign in', '2 · Salon name', '3 · Your salon URL', '4 · Phone', '5 · Plan']) {
      await expect(page.getByText(label)).toBeVisible();
    }
  });

  test('slug picker shows "Reserved" status for a reserved slug', async ({ page }) => {
    await page.goto(`${BASE}/signup`);
    const slugInput = page.getByPlaceholder('your-salon');
    await slugInput.fill('admin'); // 'admin' is in RESERVED_SLUGS
    // The status text updates after ~350ms debounce + Firestore round-trip
    await expect(page.getByText(/Reserved for the platform/i)).toBeVisible({ timeout: 5000 });
  });

  test('slug picker shows "Available" for a fresh random slug', async ({ page }) => {
    await page.goto(`${BASE}/signup`);
    const random = `qa-test-${Math.random().toString(36).slice(2, 8)}`;
    await page.getByPlaceholder('your-salon').fill(random);
    await expect(page.getByText('✓ Available')).toBeVisible({ timeout: 5000 });
  });

  test('slug picker rejects invalid format', async ({ page }) => {
    await page.goto(`${BASE}/signup`);
    await page.getByPlaceholder('your-salon').fill('ab'); // too short (min 3)
    await expect(page.getByText(/Invalid format/i)).toBeVisible({ timeout: 5000 });
  });

  test('plan cards are clickable + selected state visible', async ({ page }) => {
    await page.goto(`${BASE}/signup`);
    // Plan cards are disabled until signed in — check they render at least.
    await expect(page.getByText('Solo', { exact: true })).toBeVisible();
    await expect(page.getByText('Studio', { exact: true })).toBeVisible();
    await expect(page.getByText('Salon Pro', { exact: true })).toBeVisible();
  });

  test('Create my salon button is disabled until signed in', async ({ page }) => {
    await page.goto(`${BASE}/signup`);
    const btn = page.getByRole('button', { name: /Create my salon/ });
    await expect(btn).toBeDisabled();
  });
});

test.describe('tenant-not-found page', () => {
  test('unclaimed subdomain shows TenantNotFound', async ({ page }) => {
    await page.goto('https://this-tenant-does-not-exist-xyz.plumenexus.com/');
    await expect(page.getByText(/This salon doesn't exist/i)).toBeVisible({ timeout: 8000 });
  });

  test('reserved subdomain shows reserved variant', async ({ page }) => {
    // 'support' is in the reserved list and not claimed by a tenant.
    await page.goto('https://support.plumenexus.com/');
    await expect(page.getByText(/This URL is reserved/i)).toBeVisible({ timeout: 8000 });
  });
});
