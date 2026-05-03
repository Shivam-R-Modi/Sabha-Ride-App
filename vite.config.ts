import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['fonts/**/*', 'assets/**/*', 'icons/**/*'],
        manifest: {
          name: 'Sabha Ride Seva',
          short_name: 'Sabha Ride',
          description: 'Ride coordination app for Sabha community',
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
              src: '/icons/icon-512x512.png',
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
          // Skip waiting and claim clients immediately
          skipWaiting: true,
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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
