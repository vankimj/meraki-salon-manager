// Authenticated, full-stack e2e for the guarded-downgrade gate. Runs against
// the Firebase emulators (auth + firestore + functions) so it exercises the
// REAL callable wiring — requireTenantAdmin, Firestore membership count, the
// blocker logic — not mocks. Stripe is never hit: the gate's dryRun path and
// the seeded membership (no stripeSubscriptionId) are both Stripe-free.
//
// Prereqs: emulators running + seeded (scripts/e2e-seed.cjs) + the app served
// with VITE_USE_EMULATORS=1. The npm run e2e:emulated runner wires all of that.
// Requires Java (Firestore/Auth emulators). Skipped automatically unless
// E2E_EMULATORS=1 so it never runs in the default (no-emulator) suite.
import { test, expect } from '@playwright/test';

const RUN = process.env.E2E_EMULATORS === '1';
const EMAIL = 'e2e-admin@plumenexus.test';
const PASSWORD = 'e2e-password-123';

test.describe('guarded downgrade gate (emulated, authed)', () => {
  test.skip(!RUN, 'set E2E_EMULATORS=1 and run via `npm run e2e:emulated`');

  test('Pro→Studio is blocked until memberships are cancelled and modules turned off', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/');
    // Sign in through the real onAuthStateChanged → checkUserAccess path.
    await page.waitForFunction(() => !!window.__e2eSignIn, null, { timeout: 20000 });
    await page.evaluate(async ([e, p]) => { await window.__e2eSignIn(e, p); }, [EMAIL, PASSWORD]);
    await page.waitForFunction(() => !!window.__e2eCall, null, { timeout: 20000 });

    const call = (name, data) => page.evaluate(([n, d]) => window.__e2eCall(n, d), [name, data]);

    // 1) Blocked: Pro→Studio drops chat/hr/marketing (still on) + memberships (1 active).
    const before = await call('changeTenantPlan', { targetPlan: 'studio', dryRun: true });
    expect(before.ok).toBe(false);
    const ids = before.blockers.map(b => b.moduleId).sort();
    expect(ids).toEqual(['chat', 'hr', 'marketing', 'memberships']);
    const mem = before.blockers.find(b => b.moduleId === 'memberships');
    expect(mem.count).toBe(1);

    // 2) Memberships gate is HARD: turning the module off must be refused while it bills.
    await expect(call('setModuleEnabled', { moduleId: 'memberships', enabled: false }))
      .rejects.toThrow(/cancel/i);

    // 3) Clear each blocker: cancel the membership, turn off the other modules.
    await call('cancelMembership', { membershipId: 'e2e-mem-1' });
    for (const id of ['chat', 'hr', 'marketing']) {
      await call('setModuleEnabled', { moduleId: id, enabled: false });
    }

    // 4) Gate now clears.
    const after = await call('changeTenantPlan', { targetPlan: 'studio', dryRun: true });
    expect(after.ok).toBe(true);
    expect(after.blockers).toEqual([]);

    expect(errors.join('\n')).not.toMatch(/Content Security Policy|auth\/internal-error/i);
  });
});
