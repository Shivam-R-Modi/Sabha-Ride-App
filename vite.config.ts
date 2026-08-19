import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// firebase/config.ts calls getAuth() at module scope, so a missing API key
// throws `auth/invalid-api-key` before React mounts and the user gets a blank
// white page with nothing in the DOM. Vite substitutes `undefined` for an
// absent VITE_* var, so that broken bundle builds and deploys silently.
// Fail the build instead of shipping it.
const REQUIRED_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
];

function assertFirebaseEnv(env: Record<string, string>, command: string) {
  const missing = REQUIRED_ENV.filter((k) => !env[k]);
  if (!missing.length) return;
  const message =
    `Missing Firebase environment variables: ${missing.join(', ')}\n` +
    `  Expected in .env / .env.local at the project root (see .env.example).\n` +
    `  Without them the app compiles fine but renders a blank page, because\n` +
    `  getAuth() throws auth/invalid-api-key before React can mount.`;
  if (command === 'build') throw new Error(message);
  console.warn(`\n[vite] WARNING - ${message}\n`);
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', '');
  assertFirebaseEnv(env, command);
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      VitePWA({
        // 'prompt', not 'autoUpdate'. THIS IS THE FIX FOR A REAL FAILURE.
        //
        // Under 'autoUpdate' the generated registerSW.js is a bare
        // `navigator.serviceWorker.register('/sw.js')` — no update handling of any
        // kind. The new worker installed and claimed clients, but an ALREADY-OPEN
        // page kept running the JavaScript it had already downloaded, and nothing
        // told the user. On 2026-08-17 that cost an hour of chasing a dark-mode
        // bug that was already fixed in production; on a phone with the PWA left
        // open it means a driver can run last week's client against this week's
        // rules and functions indefinitely.
        //
        // 'prompt' makes the new worker WAIT, and components/UpdateBanner.tsx
        // offers the reload. Deliberately not an automatic reload: a driver
        // mid-ride must not have the page pulled out from under them — but they
        // must be told, so the banner is persistent rather than dismissible.
        registerType: 'prompt',
        includeAssets: ['fonts/**/*', 'assets/**/*', 'icons/**/*'],
        manifest: {
          name: 'Bhulka Gaadi',
          short_name: 'Bhulka Gaadi',
          description: 'Ride coordination for the Sabha community',
          theme_color: '#3D2914',
          background_color: '#FAF9F6',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/icons/icon-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/icons/icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              // Its own file, with the mark at 60% of the tile. Android may crop
              // a maskable icon to a CIRCLE, and the plain icon above clears the
              // safe zone by only 3px — fine as a square, a gamble as a circle.
              src: '/icons/icon-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Precache all static assets including index.html
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          // Clean up old caches
          cleanupOutdatedCaches: true,
          // skipWaiting is deliberately ABSENT (i.e. false).
          //
          // It is what made the swap silent: the new worker took over without
          // anybody being asked, while the open page carried on with stale code.
          // With it off the worker parks in `waiting`, which is the signal
          // UpdateBanner watches for, and the reload happens when the user says
          // so. `clientsClaim` stays: once the user accepts, the fresh worker
          // should control the page immediately rather than after another
          // navigation.
          clientsClaim: true,
          runtimeCaching: [
            {
              // Google Fonts stylesheets — cache first, long TTL
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-stylesheets',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Google Fonts webfont files
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts',
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Firebase / Firestore API calls — network first with fallback
              urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'firestore-api',
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
                networkTimeoutSeconds: 10,
              },
            },
            {
              // Firebase Auth
              urlPattern: /^https:\/\/identitytoolkit\.googleapis\.com\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'firebase-auth',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 },
                networkTimeoutSeconds: 10,
              },
            },
            {
              // Cloud Functions
              urlPattern: /^https:\/\/us-central1-.*\.cloudfunctions\.net\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'cloud-functions',
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 5 },
                networkTimeoutSeconds: 15,
              },
            },
            {
              // Google Maps API (tiles, geocoding, places)
              urlPattern: /^https:\/\/maps\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-maps-api',
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 }, // 7 days
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Google Maps static tiles
              urlPattern: /^https:\/\/maps\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-maps-tiles',
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }, // 30 days
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            // 'vendor-leaflet' was here. leaflet and react-leaflet were declared
            // dependencies that no file ever imported — the dashboard map was
            // hand-rolled divs, not leaflet — so this named a chunk that never
            // had anything in it. Removed with the map.
            'vendor-charts': ['recharts'],
            'vendor-firebase-auth': ['firebase/auth'],
            'vendor-firebase-firestore': ['firebase/firestore'],
            'vendor-firebase-functions': ['firebase/functions'],
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          }
        }
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
