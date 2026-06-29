import { test, expect } from '@playwright/test';

// Mutation (write-path) E2E behind staff auth, DEMO TENANT ONLY. Exercises real
// CRUD through the UI: create a Service (name only — other fields have valid
// blank defaults), prove it PERSISTS across a reload (i.e. reached Firestore),
// then delete it; and create + delete a Client. Every record uses the marker
// name "ZZZ-CLAUDE-TEST …" so scripts/claude-test-account.cjs purge-test can
// guarantee cleanup of anything the UI delete's soft-undo leaves behind.
// window.confirm dialogs are auto-accepted. No payments, no external sends.
//
//   export CLAUDE_TEST_PASSWORD="$(cat ~/.config/plumenexus/claude-test-pw)"
//   CLAUDE_TEST_EMAIL=claude-test@plumenexus.test PLAYWRIGHT_BASE_URL=https://demo.plumenexus.com \
//     npx playwright test claude-mutation.spec.js --project=chromium --workers=1

const API_KEY  = 'AIzaSyDyZkqpU30oiZYtm79ZFLAV7QNzZFvQEIo';
const EMAIL    = process.env.CLAUDE_TEST_EMAIL || 'claude-test@plumenexus.test';
const PASSWORD = process.env.CLAUDE_TEST_PASSWORD;
const MARKER_SVC    = 'ZZZ-CLAUDE-TEST Service';
const MARKER_CLIENT = 'ZZZ-CLAUDE-TEST Client';

async function signIn(page) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }) });
  const { idToken, refreshToken } = await r.json();
  await page.goto('/manage');
  await page.waitForFunction(() => !!window.__plumeAuth, null, { timeout: 30000 });
  await page.evaluate(({ key, value }) => new Promise((res, rej) => { const o = indexedDB.open('firebaseLocalStorageDb'); o.onsuccess = () => { const db = o.result; const tx = db.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value }); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); }), { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, value: { uid: 'claude-test-demo', email: EMAIL, emailVerified: true, isAnonymous: false, providerData: [], stsTokenManager: { refreshToken, accessToken: idToken, expirationTime: Date.now() + 3600000 }, createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]' } });
  await page.reload();
  await page.waitForFunction((e) => window.__plumeAuth?.currentUser?.email === e, EMAIL, { timeout: 30000 });
}

test.describe('claude mutation pass', () => {
  test.skip(!PASSWORD, 'set CLAUDE_TEST_PASSWORD');

  test('demo-tenant CRUD: service + client (self-cleaning)', async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1366, height: 2200 });
    page.on('dialog', (d) => d.accept().catch(() => {}));
    const errors = [];
    let current = 'boot';
    page.on('pageerror', (e) => errors.push(`[${current}] ${e.message.slice(0, 160)}`));
    const steps = [];
    const rec = async (name, fn) => { try { const d = await fn(); steps.push(`  ✓ ${name}${d ? ` — ${d}` : ''}`); } catch (e) { steps.push(`  ✗ ${name} — ${String(e).replace(/\s+/g, ' ').slice(0, 130)}`); throw e; } };

    // Robust: retry the home-tile click until the in-shell sidebar appears
    // (the click occasionally fires before the grid wires its handler).
    const enterShell = async () => {
      for (let i = 0; i < 4; i++) {
        const t = page.getByRole('button', { name: /^Schedule/ }).first();
        await t.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
        await t.click().catch(() => {});
        try { await page.locator('button[title="Clients"]').first().waitFor({ state: 'attached', timeout: 6000 }); return; } catch { await page.waitForTimeout(900); }
      }
      throw new Error('could not enter ModuleShell');
    };
    const navTo = async (label) => {
      current = label;
      const b = page.locator(`button[title="${label}"]`).first();
      await b.waitFor({ state: 'attached', timeout: 8000 }); // fail fast instead of hanging
      try { await b.click({ timeout: 4000 }); } catch { await b.evaluate((el) => el.click()); }
      await page.waitForTimeout(1500);
    };

    await signIn(page);
    await enterShell();

    // ===== SERVICE: create → persist-across-reload → delete =====
    await navTo('Services');
    await rec('Service: create via "+ Add Service"', async () => {
      await page.getByRole('button', { name: '+ Add Service' }).first().click();
      await page.waitForTimeout(700);
      await page.getByPlaceholder('e.g. Gel Manicure').first().fill(MARKER_SVC);
      await page.getByRole('button', { name: 'Add Service', exact: true }).first().click();
      await page.waitForTimeout(1500);
      await expect(page.getByText(MARKER_SVC).first()).toBeVisible({ timeout: 8000 });
      return 'created + visible in list';
    });

    await rec('Service: PERSISTS across reload (reached Firestore)', async () => {
      await page.reload();
      await page.waitForFunction((e) => window.__plumeAuth?.currentUser?.email === e, EMAIL, { timeout: 30000 });
      await enterShell();
      await navTo('Services');
      await expect(page.getByText(MARKER_SVC).first()).toBeVisible({ timeout: 10000 });
      return 'still present after reload';
    });

    await rec('Service: edit price + save (UPDATE)', async () => {
      const row = page.locator('div').filter({ hasText: MARKER_SVC }).filter({ has: page.getByRole('button', { name: 'Edit', exact: true }) }).last();
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.waitForTimeout(800);
      const price = page.locator('input[type="number"]').first(); // basePrice
      await price.fill('137');
      await page.getByRole('button', { name: 'Save Changes', exact: true }).first().click();
      await page.waitForTimeout(1500);
      await expect(page.locator('div').filter({ hasText: MARKER_SVC }).filter({ hasText: '137' }).first()).toBeVisible({ timeout: 8000 });
      return 'price → 137, reflected in list';
    });

    await rec('Service: edit PERSISTS across reload', async () => {
      await page.reload();
      await page.waitForFunction((e) => window.__plumeAuth?.currentUser?.email === e, EMAIL, { timeout: 30000 });
      await enterShell();
      await navTo('Services');
      await expect(page.locator('div').filter({ hasText: MARKER_SVC }).filter({ hasText: '137' }).first()).toBeVisible({ timeout: 10000 });
      return 'edited price survived reload';
    });

    await rec('Service: delete (confirm auto-accepted)', async () => {
      const row = page.locator('div').filter({ hasText: MARKER_SVC }).filter({ has: page.getByRole('button', { name: 'Del', exact: true }) }).last();
      await row.getByRole('button', { name: 'Del', exact: true }).click();
      await page.waitForTimeout(1500);
      await expect(page.getByText(MARKER_SVC)).toHaveCount(0, { timeout: 8000 });
      return 'removed from list';
    });

    // ===== CLIENT: create → search → delete =====
    await navTo('Clients');
    await rec('Client: create via "+ Add Client"', async () => {
      await page.getByRole('button', { name: '+ Add Client' }).first().click();
      await page.waitForTimeout(700);
      await page.getByPlaceholder('Jane Smith').first().fill(MARKER_CLIENT);
      await page.getByRole('button', { name: 'Add Client', exact: true }).first().click();
      await page.waitForTimeout(1500);
      return 'saved';
    });
    await rec('Client: find via search + delete', async () => {
      await page.getByPlaceholder('Search by name, phone, or email…').first().fill('ZZZ-CLAUDE-TEST');
      await page.waitForTimeout(1200);
      await expect(page.getByText(MARKER_CLIENT).first()).toBeVisible({ timeout: 8000 });
      const row = page.locator('div').filter({ hasText: MARKER_CLIENT }).filter({ has: page.getByRole('button', { name: 'Del', exact: true }) }).last();
      await row.getByRole('button', { name: 'Del', exact: true }).click();
      await page.waitForTimeout(1500);
      await expect(page.getByText(MARKER_CLIENT)).toHaveCount(0, { timeout: 8000 });
      return 'created, found via search, deleted';
    });

    await page.screenshot({ path: 'test-results/claude-mutation-last.png' }).catch(() => {});
    console.log('\n========== MUTATION PASS (demo tenant, self-cleaning) ==========');
    for (const s of steps) console.log(s);
    console.log(`\nPAGE ERRORS: ${errors.length}`);
    for (const e of errors) console.log('  ' + e);
    console.log('================================================================\n');
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
