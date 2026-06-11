import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const gitSha = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'dev'; }
})();
const now = new Date();
const buildStamp = now.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__:  JSON.stringify(buildStamp),
    __BUILD_SHA__:   JSON.stringify(gitSha),
  },
  build: {
    rollupOptions: {
      output: {
        // Vite 8 / Rolldown was splitting Firebase into multiple chunks
        // whose load order broke the service registration at runtime
        // ("Ap is not a constructor" + "Service firestore is not
        // available" — the firestore chunk was loading before the app
        // chunk had registered the component factory). Force every
        // firebase-* module into a single chunk so the SDK initializes
        // with all services registered together. Rolldown requires the
        // function form (object form is rejected at config validation).
        manualChunks(id) {
          if (id.includes('node_modules/firebase') ||
              id.includes('node_modules/@firebase')) {
            return 'firebase';
          }
          return null;
        },
      },
    },
  },
  plugins: [
    react(),
    // Emit /version.json (the current build sha) so the app can self-heal a stale
    // cache: on load it fetches this (cache-busted), and if its baked-in sha
    // doesn't match, it unregisters the service worker, clears caches, and reloads.
    {
      name: 'write-version-json',
      closeBundle() {
        try {
          mkdirSync('dist', { recursive: true });
          writeFileSync('dist/version.json', JSON.stringify({ sha: gitSha, version: pkg.version, builtAt: now.toISOString() }));
        } catch (e) { /* noop */ }
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Meraki Nail Studio',
        short_name: 'Meraki',
        description: 'Salon management for Meraki Nail Studio',
        theme_color: '#2D7A5F',
        background_color: '#2D7A5F',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Take over open tabs immediately on new SW activation, so deploys
        // don't strand users on a stale bundle until they close every tab.
        skipWaiting:  true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Bundle has grown past 2 MB as differentiator features ship; raise
        // the precache size limit so the main JS chunk still gets cached.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Cache the app shell and static assets
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}'],
        globIgnores: ['version.json'],   // never precache the version probe — it must always hit the network
        // Disable the auto-added NavigationRoute(CacheFirst on index.html).
        // It registers BEFORE any runtimeCaching entry, so our NetworkFirst
        // navigation handler below would never run with the default. We
        // implement the navigate-with-offline-fallback pattern manually in
        // runtimeCaching using NetworkFirst + the precached index.html via
        // the cacheName 'workbox-precache-v2-https://...index.html'.
        navigateFallback: null,
        // NetworkFirst for HTML navigation. The default Workbox setup
        // serves the precached index.html (CacheFirst) on every
        // navigation, which means a user already on the app can see a
        // stale index.html — referencing old hashed assets — for an
        // entire session after a deploy, even though skipWaiting +
        // clientsClaim are set. NetworkFirst on navigation requests
        // means fresh HTML when online, with the precached copy as
        // the offline fallback.
        //
        // Registered FIRST so workbox tries it before the auto-added
        // NavigationRoute(createHandlerBoundToURL('index.html'))
        // fallback.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages-cache',
              networkTimeoutSeconds: 3, // fall back to cache if network is slow
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.js'],
    // Exclude the e2e directory so Playwright specs aren't pulled into the
    // unit suite — they need a real browser, not jsdom. Defaults from vitest
    // (node_modules, dist, etc.) included explicitly because setting `exclude`
    // overrides them.
    exclude: [
      '**/node_modules/**', '**/dist/**', '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      'e2e/**', 'platform-admin/**', 'plumenexus/**', 'mobile/**',
    ],
  },
});
