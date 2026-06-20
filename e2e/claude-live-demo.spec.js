import { test, expect } from '@playwright/test';

// Proves a headless, custom-token sign-in to the LIVE deployed app behind staff
// auth, scoped to the DEMO tenant only. This is the "test account" loop:
//   1. scripts/claude-test-account.cjs mints a custom token for the demo-admin
//      test user (claude-test@plumenexus.test).
//   2. We exchange it for an idToken/refreshToken via Identity Toolkit REST.
//   3. We seed Firebase's own IndexedDB auth record, then reload — so the app's
//      onAuthStateChanged → checkUserAccess path runs exactly as for a real
//      signed-in admin, with NO prod app changes and no Google popup.
//
// Run:
//   TOKEN=$(node scripts/claude-test-account.cjs token | sed -n '/^ey/p')   # or grab the JWT line
//   CLAUDE_TEST_CUSTOM_TOKEN="$TOKEN" PLAYWRIGHT_BASE_URL=https://demo.plumenexus.com \
//     npx playwright test claude-live-demo.spec.js --project=chromium
//
// Never runs by accident: skips unless CLAUDE_TEST_CUSTOM_TOKEN is set.

const API_KEY  = 'AIzaSyDyZkqpU30oiZYtm79ZFLAV7QNzZFvQEIo'; // public Firebase web config
const EMAIL    = process.env.CLAUDE_TEST_EMAIL || 'claude-test@plumenexus.test';
const PASSWORD = process.env.CLAUDE_TEST_PASSWORD;

test.describe('claude live demo-tenant admin sign-in', () => {
  test.skip(!PASSWORD, 'set CLAUDE_TEST_PASSWORD (node scripts/claude-test-account.cjs setpw)');

  test('signs into the live demo tenant as admin via email+password', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    // 1) Exchange email+password for real session tokens (Identity Toolkit REST).
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }) },
    );
    const body = await resp.json();
    expect(resp.ok, `token exchange failed: ${JSON.stringify(body)}`).toBeTruthy();
    const { idToken, refreshToken, expiresIn } = body;
    expect(idToken && refreshToken, 'missing idToken/refreshToken').toBeTruthy();

    // 2) Boot the staff management app (/manage) once so it creates the
    //    firebaseLocalStorageDb / store and we're on the right origin.
    await page.goto('/manage');
    await page.waitForFunction(() => !!window.__plumeAuth, null, { timeout: 30000 });

    // 3) Seed the persisted auth user record, then reload so the SDK re-hydrates
    //    it through the normal onAuthStateChanged path.
    const persisted = {
      key: `firebase:authUser:${API_KEY}:[DEFAULT]`,
      value: {
        uid: 'claude-test-demo',
        email: EMAIL,
        emailVerified: true,
        isAnonymous: false,
        providerData: [],
        stsTokenManager: {
          refreshToken,
          accessToken: idToken,
          expirationTime: Date.now() + (Number(expiresIn) || 3600) * 1000,
        },
        createdAt: String(Date.now()),
        lastLoginAt: String(Date.now()),
        apiKey: API_KEY,
        appName: '[DEFAULT]',
      },
    };
    await page.evaluate(({ key, value }) => new Promise((resolve, reject) => {
      const open = indexedDB.open('firebaseLocalStorageDb');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('firebaseLocalStorage', 'readwrite');
        tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    }), persisted);

    await page.reload();

    // 4) The live backend accepted the session: SDK reports our user. (If the
    //    refreshToken were rejected, the SDK would sign out on load.)
    await page.waitForFunction(
      (email) => window.__plumeAuth?.currentUser?.email === email,
      EMAIL,
      { timeout: 30000 },
    );

    // 5) Give the app a moment to run checkUserAccess + render, then capture what
    //    an authed admin actually sees (ground truth for the manual log).
    await page.waitForTimeout(4000);
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400);
    console.log('[claude-live-demo] signed in as', EMAIL);
    console.log('[claude-live-demo] rendered body (first 400 chars):', bodyText);
    await page.screenshot({ path: 'test-results/claude-live-demo.png', fullPage: false });

    // Not gated to "pending access" / sign-in: an admin should not see those.
    expect(bodyText.toLowerCase()).not.toContain('access pending');
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
