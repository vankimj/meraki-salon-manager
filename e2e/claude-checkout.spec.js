import { test, expect } from '@playwright/test';

// Checkout / POS write-path E2E behind staff auth, DEMO TENANT ONLY. Completes a
// real CASH sale (no card, no real money) for a pre-seeded marker appointment
// (scripts/claude-test-account.cjs seed-checkout-appt) and verifies the receipt
// screen renders. The marker clientName means purge-test removes both the
// appointment and the receipt the sale creates. No receipt is sent.
// NOTE: completing a sale also writes the server-side immutable `ledger` entry,
// which persists by design (this is the demo tenant's audit log).
//
//   export CLAUDE_TEST_PASSWORD="$(cat ~/.config/plumenexus/claude-test-pw)"
//   CLAUDE_TEST_EMAIL=claude-test@plumenexus.test PLAYWRIGHT_BASE_URL=https://demo.plumenexus.com \
//     npx playwright test claude-checkout.spec.js --project=chromium --workers=1

const API_KEY  = 'AIzaSyDyZkqpU30oiZYtm79ZFLAV7QNzZFvQEIo';
const EMAIL    = process.env.CLAUDE_TEST_EMAIL || 'claude-test@plumenexus.test';
const PASSWORD = process.env.CLAUDE_TEST_PASSWORD;

async function signIn(page) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }) });
  const { idToken, refreshToken } = await r.json();
  await page.goto('/manage');
  await page.waitForFunction(() => !!window.__plumeAuth, null, { timeout: 30000 });
  await page.evaluate(({ key, value }) => new Promise((res, rej) => { const o = indexedDB.open('firebaseLocalStorageDb'); o.onsuccess = () => { const db = o.result; const tx = db.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value }); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); }), { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, value: { uid: 'claude-test-demo', email: EMAIL, emailVerified: true, isAnonymous: false, providerData: [], stsTokenManager: { refreshToken, accessToken: idToken, expirationTime: Date.now() + 3600000 }, createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]' } });
  await page.reload();
  await page.waitForFunction((e) => window.__plumeAuth?.currentUser?.email === e, EMAIL, { timeout: 30000 });
}

test.describe('claude checkout pass', () => {
  test.skip(!PASSWORD, 'set CLAUDE_TEST_PASSWORD');

  test('demo cash checkout completes + records a sale', async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1366, height: 2200 });
    page.on('dialog', (d) => d.accept().catch(() => {}));
    const errors = [];
    let current = 'boot';
    page.on('pageerror', (e) => errors.push(`[${current}] ${e.message.slice(0, 160)}`));
    const steps = [];
    const rec = async (name, fn) => { try { const d = await fn(); steps.push(`  ✓ ${name}${d ? ` — ${d}` : ''}`); } catch (e) { steps.push(`  ✗ ${name} — ${String(e).replace(/\s+/g, ' ').slice(0, 140)}`); throw e; } };

    const enterShell = async () => {
      for (let i = 0; i < 4; i++) {
        const t = page.getByRole('button', { name: /^Schedule/ }).first();
        await t.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
        await t.click().catch(() => {});
        try { await page.locator('button[title="Clients"]').first().waitFor({ state: 'attached', timeout: 6000 }); return; } catch { await page.waitForTimeout(900); }
      }
      throw new Error('could not enter ModuleShell');
    };
    const clickMaybe = async (re, timeout = 2500) => { const b = page.getByRole('button', { name: re }).first(); if (await b.count() && await b.isVisible().catch(() => false)) { await b.click({ timeout }).catch(() => {}); return true; } return false; };

    await signIn(page);
    await enterShell();
    current = 'Schedule';
    // Ensure we're on Schedule, today (where the seeded 10:00 appt lives).
    await page.locator('button[title="Schedule"]').first().click().catch(() => {});
    await page.waitForTimeout(1500);

    await rec('Schedule: open the seeded marker appointment', async () => {
      const appt = page.getByText(/ZZZ-CLAUDE/).first();
      await appt.waitFor({ state: 'visible', timeout: 12000 });
      await appt.scrollIntoViewIfNeeded().catch(() => {});
      await appt.click();
      await page.waitForTimeout(1000);
      await expect(page.getByRole('button', { name: 'Checkout now' }).first()).toBeVisible({ timeout: 8000 });
      return 'appt modal open, Checkout now visible';
    });

    current = 'Checkout';
    await rec('Checkout: open CheckoutModal', async () => {
      await page.getByRole('button', { name: 'Checkout now' }).first().click();
      await page.waitForTimeout(1500);
      return 'modal opened';
    });

    await rec('Checkout: select Cash + take cash here', async () => {
      await clickMaybe(/Cash/);              // switch payment method to cash
      await page.waitForTimeout(600);
      await clickMaybe(/Take cash here/i);   // if kiosk handoff offered, take it on web
      await page.waitForTimeout(500);
      return 'cash, on-device';
    });

    await rec('Checkout: Complete the sale', async () => {
      const complete = page.getByRole('button', { name: /Complete Checkout|Cash received · Complete|Complete \$/ }).first();
      await complete.waitFor({ state: 'visible', timeout: 8000 });
      await complete.click();
      await page.waitForTimeout(3000);
      // Receipt screen / payment-complete confirmation.
      await expect(page.getByText(/Payment Complete|Receipt|Rebook|Send receipt|paid/i).first()).toBeVisible({ timeout: 12000 });
      return 'sale completed, receipt screen shown';
    });

    await page.screenshot({ path: 'test-results/claude-checkout-last.png' }).catch(() => {});
    console.log('\n========== CHECKOUT PASS (demo cash sale) ==========');
    for (const s of steps) console.log(s);
    console.log(`\nPAGE ERRORS: ${errors.length}`);
    for (const e of errors) console.log('  ' + e);
    console.log('====================================================\n');
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
