import { defineConfig, devices } from '@playwright/test';

// Browser-side end-to-end harness. Scope is intentionally narrow to start:
// only the PUBLIC routes that don't require Firebase auth (booking page,
// signup wizard, terms, privacy, manage-link landing). Auth-gated flows
// (admin Schedule, Clients, etc.) need Firebase Auth Emulator + fixture
// accounts — we'll layer that in once the public-surface coverage is solid.
//
// Run locally:        npm run e2e
// Headed (debug):     npm run e2e:headed
// UI mode:            npm run e2e:ui
// Update snapshots:   npm run e2e -- --update-snapshots
//
// CI tip: set CI=1 to enable retries + html-only reporter.
//
// Pre-deploy smoke against a remote Firebase preview channel:
//   PLAYWRIGHT_BASE_URL=https://<channel>.web.app npm run e2e
// When PLAYWRIGHT_BASE_URL is set, the local dev server is skipped and
// tests run against the remote URL. Used by `npm run deploy:safe`.
const REMOTE_BASE_URL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: REMOTE_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // Skip the local dev server when running against a remote URL.
  ...(REMOTE_BASE_URL ? {} : {
    webServer: {
      // E2E_EMULATORS=1 serves the app pointed at the local Firebase emulators
      // (VITE_USE_EMULATORS=1) for the authed downgrade-gate spec.
      command: process.env.E2E_EMULATORS === '1' ? 'npm run dev:emulated' : 'npm run dev',
      url: 'http://localhost:5173',
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  }),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/mobile.spec.js'],
    },
    // Mobile project — most techs use the app on a phone, so we exercise
    // the public surfaces under an iPhone viewport too. Keeps regressions
    // like horizontal-overflow modals and tiny tap targets out of prod.
    // Mobile-only specs live under e2e/mobile.spec.js; the smoke suite
    // also runs here to verify nothing breaks at narrow widths.
    {
      name: 'mobile-iphone',
      use: { ...devices['iPhone 14'] },
    },
  ],
});
