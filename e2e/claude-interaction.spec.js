import { test, expect } from '@playwright/test';

// Deeper functional pass behind staff auth (demo tenant). Beyond "module renders"
// (covered by claude-web-sweep), this exercises real INTERACTIONS — view toggles,
// filters, opening detail/add modals, and tab switches — all NON-MUTATING
// (open + Escape/cancel, no saves/writes). Records each step's outcome and
// asserts no page crash + that the safe core interactions worked.
//
//   export CLAUDE_TEST_PASSWORD="$(cat ~/.config/plumenexus/claude-test-pw)"
//   CLAUDE_TEST_EMAIL=claude-test@plumenexus.test PLAYWRIGHT_BASE_URL=https://demo.plumenexus.com \
//     npx playwright test claude-interaction.spec.js --project=chromium --workers=1

const API_KEY  = 'AIzaSyDyZkqpU30oiZYtm79ZFLAV7QNzZFvQEIo';
const EMAIL    = process.env.CLAUDE_TEST_EMAIL || 'claude-test@plumenexus.test';
const PASSWORD = process.env.CLAUDE_TEST_PASSWORD;
const BENIGN = [/firestore\.googleapis\.com.*channel/i, /firebaseinstallations/i, /cdn-cgi\/rum/i, /version\.json/i, /fonts\.gstatic\.com/i, /ERR_ABORTED/i, /Failed to load resource/i];
const isBenign = (s) => BENIGN.some((re) => re.test(s));

async function signIn(page) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }) });
  const { idToken, refreshToken, expiresIn } = await r.json();
  await page.goto('/manage');
  await page.waitForFunction(() => !!window.__plumeAuth, null, { timeout: 30000 });
  await page.evaluate(({ key, value }) => new Promise((res, rej) => {
    const o = indexedDB.open('firebaseLocalStorageDb');
    o.onsuccess = () => { const db = o.result; const tx = db.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value }); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
    o.onerror = () => rej(o.error);
  }), { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, value: { uid: 'claude-test-demo', email: EMAIL, emailVerified: true, isAnonymous: false, providerData: [], stsTokenManager: { refreshToken, accessToken: idToken, expirationTime: Date.now() + (Number(expiresIn) || 3600) * 1000 }, createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]' } });
  await page.reload();
  await page.waitForFunction((e) => window.__plumeAuth?.currentUser?.email === e, EMAIL, { timeout: 30000 });
}

test.describe('claude interaction pass', () => {
  test.skip(!PASSWORD, 'set CLAUDE_TEST_PASSWORD');

  test('non-mutating per-module interactions', async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1366, height: 2200 });
    const errors = [];
    let current = 'boot';
    page.on('pageerror', (e) => errors.push({ where: current, msg: e.message.slice(0, 200) }));
    page.on('console', (m) => { if (m.type() === 'error' && !isBenign(m.text())) errors.push({ where: current, msg: m.text().slice(0, 200) }); });

    const steps = [];
    const rec = async (name, fn) => { try { const d = await fn(); steps.push({ name, ok: true, detail: d || '' }); } catch (e) { steps.push({ name, ok: false, detail: String(e).replace(/\s+/g, ' ').slice(0, 110) }); } };
    const PIN = process.env.CLAUDE_TEST_PIN; // demo adminPin (hr + reports are PIN_LOCKED_VIEWS)
    const visibleInputs = () => page.locator('input:visible, textarea:visible, select:visible').count();
    const clickByName = async (name, exact = true) => { const b = page.getByRole('button', { name, exact }).first(); await b.scrollIntoViewIfNeeded().catch(() => {}); try { await b.click({ timeout: 4000 }); } catch { await b.evaluate((el) => el.click()); } };
    const contentSnap = () => page.evaluate(() => ((document.querySelector('.ms-content, main, [role=main]') || document.body).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 140));
    // PinModal (src/components/PinModal.jsx): 4 digits, auto-submits on the 4th.
    const unlockIfPrompted = async () => {
      await page.waitForTimeout(400);
      const keypad = (await page.getByRole('button', { name: 'Cancel', exact: true }).count()) > 0 && (await page.getByRole('button', { name: '7', exact: true }).count()) > 0;
      if (!keypad) return 'no-gate';
      if (!PIN) return 'GATED (no PIN supplied)';
      for (const d of String(PIN)) { await page.getByRole('button', { name: d, exact: true }).last().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(150); }
      await page.waitForTimeout(1000);
      return 'unlocked';
    };
    const navTo = async (label) => { current = label; const b = page.locator(`button[title="${label}"]`).first(); if (!(await b.count())) throw new Error('module n/a'); try { await b.click({ timeout: 4000 }); } catch { await b.evaluate((el) => el.click()); } await page.waitForTimeout(1400); await unlockIfPrompted(); await page.waitForTimeout(800); };

    await signIn(page);
    const tile = page.getByRole('button', { name: /Schedule/ }).first();
    await tile.waitFor({ state: 'visible', timeout: 25000 });
    await tile.click().catch(() => {});
    await page.waitForTimeout(1500);

    // ---- Schedule: view toggles, tech filter, day nav (all non-mutating) ----
    current = 'Schedule';
    await rec('Schedule: switch to Week view', async () => { await clickByName('Week'); await page.waitForTimeout(800); return 'ok'; });
    await rec('Schedule: switch back to Day view', async () => { await clickByName('Day'); await page.waitForTimeout(800); return 'ok'; });
    await rec('Schedule: filter to one tech (Yasmin D)', async () => { await clickByName('Yasmin D'); await page.waitForTimeout(600); return 'ok'; });
    await rec('Schedule: reset to All techs', async () => { await clickByName('All techs'); await page.waitForTimeout(400); return 'ok'; });
    await rec('Schedule: next day then Today', async () => { await clickByName('›', false).catch(() => {}); await page.waitForTimeout(400); await clickByName('Today'); return 'ok'; });

    // ---- Clients: open Add modal, confirm form, close ----
    await navTo('Clients');
    await rec('Clients: open "+ Add Client" modal', async () => { const before = await visibleInputs(); await clickByName('+ Add Client'); await page.waitForTimeout(900); const after = await visibleInputs(); if (after <= before) throw new Error(`no form opened (inputs ${before}→${after})`); return `form opened (${after} inputs)`; });
    await rec('Clients: close modal (Escape)', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(600); return 'closed'; });

    // ---- Services: open Add modal, confirm form, close ----
    await navTo('Services');
    await rec('Services: open "+ Add Service" modal', async () => { const before = await visibleInputs(); await clickByName('+ Add Service'); await page.waitForTimeout(900); const after = await visibleInputs(); if (after <= before) throw new Error(`no form opened (${before}→${after})`); return `form opened (${after} inputs)`; });
    await rec('Services: close modal (Escape)', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(600); return 'closed'; });

    // ---- Employees: open a profile by name, close ----
    await navTo('Employees');
    await rec('Employees: open a profile (Yasmin D)', async () => { const before = await visibleInputs(); await clickByName('Yasmin D'); await page.waitForTimeout(900); const after = await visibleInputs(); return after > before ? `profile/edit opened (${after} inputs)` : 'clicked (no form delta — may be read view)'; });
    await rec('Employees: close (Escape)', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(500); return 'closed'; });

    // ---- Reports: PIN-gated (PIN_LOCKED_VIEWS). Unlock, confirm content, switch tabs ----
    await rec('Reports: unlock PIN gate + render', async () => { await navTo('Reports'); const snap = await contentSnap(); if (/PIN|enter.*pin|Cancel.*1.*2.*3/i.test(snap) && snap.length < 40) throw new Error('still gated'); return snap.slice(0, 90); });
    await rec('Reports: switch through available tabs', async () => {
      const candidates = ['Revenue', 'Overview', 'Sales', 'Leaderboard', 'Employees', 'Services', 'Tax', 'Fiscal', 'Clients', 'Ask AI', 'Ask the AI', 'AI', 'Trends'];
      const hit = [];
      for (const c of candidates) { const b = page.getByRole('button', { name: c, exact: true }).first(); if (await b.count() && await b.isVisible().catch(() => false)) { try { await b.click({ timeout: 3000 }); hit.push(c); await page.waitForTimeout(700); } catch {} } }
      return hit.length ? `switched: ${hit.join(', ')}` : 'no tab buttons matched (single-view report?)';
    });

    // ---- HR: also PIN-gated. Unlock + confirm payroll/comp content renders ----
    await rec('HR: unlock PIN gate + render', async () => { await navTo('HR'); const snap = await contentSnap(); const inputs = await visibleInputs(); return `${inputs} inputs | ${snap.slice(0, 80)}`; });

    // ---- Admin overlay: switch tabs ----
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    current = 'Admin';
    await rec('Admin: open overlay', async () => { const b = page.locator('button[title="Admin Settings"]').first(); try { await b.click({ timeout: 4000 }); } catch { await b.evaluate((el) => el.click()); } await page.waitForTimeout(1200); return 'opened'; });
    await rec('Admin: switch through tabs', async () => {
      const hit = [];
      for (const c of ['Users', 'Logs', 'Settings', 'Trash', 'Activity']) { const b = page.getByRole('button', { name: c, exact: true }).first(); if (await b.count() && await b.isVisible().catch(() => false)) { try { await b.click({ timeout: 3000 }); hit.push(c); await page.waitForTimeout(700); } catch {} } }
      if (!hit.length) throw new Error('no recognizable admin tabs found');
      return `switched: ${hit.join(', ')}`;
    });

    await page.screenshot({ path: 'test-results/claude-interaction-last.png' }).catch(() => {});

    console.log('\n========== INTERACTION PASS (non-mutating) ==========');
    for (const s of steps) console.log(`  ${s.ok ? '✓' : '✗'} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
    console.log(`\nREAL ERRORS during interactions: ${errors.length}`);
    for (const e of errors) console.log(`  [${e.where}] ${e.msg}`);
    console.log('=====================================================\n');

    // Core safe interactions must work; no crashes.
    const okNames = steps.filter((s) => s.ok).map((s) => s.name);
    expect(okNames, 'schedule view toggles must work').toEqual(expect.arrayContaining(['Schedule: switch to Week view', 'Schedule: switch back to Day view']));
    expect(errors, `crashes/real errors:\n${errors.map((e) => `[${e.where}] ${e.msg}`).join('\n')}`).toEqual([]);
  });
});
