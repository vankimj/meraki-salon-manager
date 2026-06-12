import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests for the mobile app's PURE logic (no react-native imports), e.g.
// src/lib/kioskWalkin.js. Run from the repo root with the root vitest binary:
//   npx vitest run --config mobile/vitest.config.js
// (The root vitest config intentionally excludes mobile/** so RN files don't
// break the web suite; this config scopes back into mobile for pure modules.)
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['src/**/*.test.{js,jsx}'],
    environment: 'node',
    globals: true,
  },
});
