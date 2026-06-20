import { test, expect } from '@playwright/test';

// Complete functional + performance sweep of the web app behind staff auth,
// against the LIVE demo tenant. Signs in as the demo-admin test account (see
// scripts/claude-test-account.cjs), visits every management module + Admin, and
// records: errors (benign-filtered + attributed to the active module), real
// per-module render time (DOM-stabilization, NOT networkidle — the app holds a
// Firestore stream open so the network never idles), cold-load perf (Navigation
// Timing, LCP, JS/total transfer), and a rendered snapshot. A second test
// sweeps the public (no-auth) surfaces.
//
//   export CLAUDE_TEST_PASSWORD="$(cat ~/.config/plumenexus/claude-test-pw)"
//   CLAUDE_TEST_EMAIL=claude-test@plumenexus.test PLAYWRIGHT_BASE_URL=https://demo.plumenexus.com \
//     npx playwright test claude-web-sweep.spec.js --project=chromium --workers=1

const API_KEY  = 'AIzaSyDyZkqpU30oiZYtm79ZFLAV7QNzZFvQEIo';
const EMAIL    = process.env.CLAUDE_TEST_EMAIL || 'claude-test@plumenexus.test';
const PASSWORD = process.env.CLAUDE_TEST_PASSWORD;

const MODULE_LABELS = [
  'Schedule', 'Clients', 'Services', 'Employees', 'Walk-in Manager', 'Reports',
  'Sales & Receipts', 'Earnings', 'Gift Cards', 'Communications', 'Attendance',
  'Meetings', 'Products', 'Marketing', 'HR', 'Memberships', 'Launch & Grow',
];

// Known-benign network noise: Firestore long-poll channels aborted on reload,
// Firebase Installations, Cloudflare RUM beacon, version.json kill-switch poll,
// and gstatic font fetches that fail only under headless Chromium (CSP allows
// them; real users get the fonts).
const BENIGN = [
  /firestore\.googleapis\.com.*channel/i, /firebaseinstallations\.googleapis\.com/i,
  /cdn-cgi\/rum/i, /version\.json/i, /fonts\.gstatic\.com/i, /ERR_ABORTED/i,
  /Failed to load resource/i,
];
const isBenign = (s) => BENIGN.some((re) => re.test(s));

async function installObservers(page) {
  await page.addInitScript(() => {
    window.__lcp = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (_) {}
  });
}

// Time until body text stops changing AND has real content (proxy for "finished
// rendering"). Requires >= minChars so we don't bail during the pre-render lull
// when innerText is momentarily empty; returns the cap for a genuinely blank page.
async function renderTime(page, capMs = 7000, minChars = 25) {
  const start = Date.now();
  let last = -1, stableSince = Date.now();
  while (Date.now() - start < capMs) {
    const len = await page.evaluate(() => ((document.body && document.body.innerText) || '').length).catch(() => last);
    if (len !== last) { last = len; stableSince = Date.now(); }
    else if (len >= minChars && Date.now() - start > 500 && Date.now() - stableSince > 350) break;
    await page.waitForTimeout(100);
  }
  return Date.now() - start;
}

async function snapshot(page) {
  return (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 120);
}

async function seedSessionTokens() {
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }) });
  const body = await resp.json();
  expect(resp.ok, `token exchange failed: ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

async function applySession(page, { idToken, refreshToken, expiresIn }) {
  await page.evaluate(({ key, value }) => new Promise((res, rej) => {
    const o = indexedDB.open('firebaseLocalStorageDb');
    o.onsuccess = () => { const db = o.result; const tx = db.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value }); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
    o.onerror = () => rej(o.error);
  }), { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, value: { uid: 'claude-test-demo', email: EMAIL, emailVerified: true, isAnonymous: false, providerData: [], stsTokenManager: { refreshToken, accessToken: idToken, expirationTime: Date.now() + (Number(expiresIn) || 3600) * 1000 }, createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]' } });
}

test.describe('claude web sweep', () => {
  test.skip(!PASSWORD, 'set CLAUDE_TEST_PASSWORD (node scripts/claude-test-account.cjs setpw)');

  test('authenticated management functional + performance sweep', async ({ page }) => {
    test.setTimeout(240000);
    // Tall viewport so the full 18-item ModuleShell sidebar is on-screen and
    // actionable (at 720px the lower modules sit below the fold).
    await page.setViewportSize({ width: 1366, height: 2200 });
    const errors = [];
    let current = 'boot';
    page.on('pageerror', (e) => errors.push({ where: current, type: 'pageerror', msg: e.message.slice(0, 200) }));
    page.on('console', (m) => { if (m.type() === 'error') errors.push({ where: current, type: 'console', msg: m.text().slice(0, 200) }); });
    await installObservers(page);

    const tokens = await seedSessionTokens();

    // Cold load (login screen) — capture true main-bundle perf BEFORE the reload
    // reuses cache.
    await page.goto('/manage');
    await page.waitForFunction(() => !!window.__plumeAuth, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const res = performance.getEntriesByType('resource');
      const sum = (a) => a.reduce((s, r) => s + (r.transferSize || 0), 0);
      const js = res.filter((r) => r.name.endsWith('.js') || r.initiatorType === 'script');
      return { ttfb: Math.round(nav.responseStart || 0), dcl: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0), lcp: Math.round(window.__lcp || 0), jsKB: Math.round(sum(js) / 1024), allKB: Math.round(sum(res) / 1024), reqs: res.length };
    });

    // Authenticate + land in the app.
    const tAuth = Date.now();
    await applySession(page, tokens);
    await page.reload();
    await page.waitForFunction((e) => window.__plumeAuth?.currentUser?.email === e, EMAIL, { timeout: 30000 });
    current = 'home';
    // Wait for the Home grid to actually render (its Schedule tile), then enter
    // the shell — the sidebar button[title="..."] nav only exists in-shell.
    const homeTile = page.getByRole('button', { name: /Schedule/ }).first();
    await homeTile.waitFor({ state: 'visible', timeout: 25000 });
    const authRenderMs = await renderTime(page, 9000);
    const signInMs = Date.now() - tAuth;
    const homeSnap = await snapshot(page);
    await homeTile.click().catch(() => {});
    await renderTime(page, 7000);

    const results = [];
    async function visit(label) {
      current = label;
      const btn = page.locator(`button[title="${label}"]`).first();
      if (!(await btn.count().catch(() => 0))) { results.push({ module: label, reached: false, note: 'n/a (gated/absent for this plan)' }); return; }
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      const t = Date.now();
      try {
        await btn.click({ timeout: 5000 });
      } catch (_) {
        // Fallback: fire the handler directly (robust against scroll/overlay).
        try { await btn.evaluate((el) => el.click()); }
        catch (e) { results.push({ module: label, reached: false, note: 'click failed (locator + DOM)' }); return; }
      }
      const ms = await renderTime(page);
      results.push({ module: label, reached: true, clickToStableMs: ms, totalMs: Date.now() - t, snap: await snapshot(page) });
    }

    for (const label of MODULE_LABELS) await visit(label);

    // Admin overlay
    current = 'Admin';
    const adminBtn = page.locator('button[title="Admin Settings"]').first();
    if (await adminBtn.count().catch(() => 0)) {
      const t = Date.now();
      try { await adminBtn.scrollIntoViewIfNeeded().catch(() => {}); try { await adminBtn.click({ timeout: 5000 }); } catch (_) { await adminBtn.evaluate((el) => el.click()); } const ms = await renderTime(page); results.push({ module: 'Admin', reached: true, clickToStableMs: ms, totalMs: Date.now() - t, snap: await snapshot(page) }); }
      catch (e) { results.push({ module: 'Admin', reached: false, note: String(e).slice(0, 100) }); }
      await page.keyboard.press('Escape').catch(() => {});
    }

    await page.screenshot({ path: 'test-results/claude-sweep-last.png' }).catch(() => {});

    const real = errors.filter((e) => !isBenign(e.msg));
    const benignCount = errors.length - real.length;

    console.log('\n========== AUTHENTICATED MANAGEMENT SWEEP ==========');
    console.log(`Signed in as ${EMAIL} (demo tenant, admin). sign-in→render: ${signInMs}ms, app render-stable: ${authRenderMs}ms`);
    console.log(`COLD LOAD (/manage): TTFB ${perf.ttfb}ms | DCL ${perf.dcl}ms | load ${perf.load}ms | LCP ${perf.lcp}ms | JS ${perf.jsKB}KB | total ${perf.allKB}KB | ${perf.reqs} reqs`);
    console.log(`HOME: ${homeSnap}`);
    console.log('\nMODULE                 RESULT   render   total');
    for (const r of results) {
      if (r.reached) console.log(`  ${r.module.padEnd(20)} ✓  ${String(r.clickToStableMs).padStart(5)}ms ${String(r.totalMs).padStart(6)}ms | ${r.snap}`);
      else           console.log(`  ${r.module.padEnd(20)} —  ${r.note}`);
    }
    console.log(`\nERRORS: ${real.length} real, ${benignCount} benign (filtered: Firestore-channel/installations/RUM/version.json/gstatic-font/ERR_ABORTED)`);
    for (const e of real) console.log(`  REAL [${e.where}] ${e.type}: ${e.msg}`);
    console.log('====================================================\n');

    const reached = results.filter((r) => r.reached).map((r) => r.module);
    expect(reached, 'should reach core modules').toEqual(expect.arrayContaining(['Schedule', 'Clients', 'Services', 'Reports']));
    const crashes = errors.filter((e) => e.type === 'pageerror' && !isBenign(e.msg));
    expect(crashes, `crashes:\n${crashes.map((c) => `[${c.where}] ${c.msg}`).join('\n')}`).toEqual([]);
  });

  test('public (no-auth) surfaces functional + performance sweep', async ({ page }) => {
    test.setTimeout(150000);
    const errors = [];
    let current = 'boot';
    page.on('pageerror', (e) => errors.push({ where: current, type: 'pageerror', msg: e.message.slice(0, 200) }));
    page.on('console', (m) => { if (m.type() === 'error') errors.push({ where: current, type: 'console', msg: m.text().slice(0, 200) }); });
    await installObservers(page);

    const routes = [
      { name: 'webfront (/)', path: '/' }, { name: 'booking', path: '/book?tenant=demo' },
      { name: 'signup', path: '/signup' }, { name: 'gift-card buy', path: '/gift?tenant=demo' },
      { name: 'terms', path: '/terms' }, { name: 'privacy', path: '/privacy' },
    ];
    const results = [];
    for (const r of routes) {
      current = r.name;
      const t = Date.now();
      try {
        await page.goto(r.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const ms = await renderTime(page);
        const m = await page.evaluate(() => ({ lcp: Math.round(window.__lcp || 0) }));
        results.push({ name: r.name, ms, lcp: m.lcp, snap: await snapshot(page) });
      } catch (e) { results.push({ name: r.name, ms: Date.now() - t, error: String(e).slice(0, 100) }); }
    }

    const real = errors.filter((e) => !isBenign(e.msg));
    console.log('\n========== PUBLIC SURFACES SWEEP ==========');
    for (const r of results) {
      if (r.error) console.log(`  ${r.name.padEnd(16)} ✗  ${r.error}`);
      else         console.log(`  ${r.name.padEnd(16)} ✓  render ${String(r.ms).padStart(5)}ms (LCP ${r.lcp}ms) | ${r.snap}`);
    }
    console.log(`\nERRORS: ${real.length} real, ${errors.length - real.length} benign`);
    for (const e of real) console.log(`  REAL [${e.where}] ${e.type}: ${e.msg}`);
    console.log('===========================================\n');

    const crashes = errors.filter((e) => e.type === 'pageerror' && !isBenign(e.msg));
    expect(crashes, `crashes:\n${crashes.map((c) => `[${c.where}] ${c.msg}`).join('\n')}`).toEqual([]);
  });
});
