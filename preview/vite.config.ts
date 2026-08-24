/**
 * Build config for the screen previews in this folder.
 *
 *     npx vite build --config preview/vite.config.ts
 *     npx vite preview --outDir preview-dist   # then open /preview/rider.html
 *
 * WHY THIS EXISTS
 * ---------------
 * docs/STATUS.md has carried the same note for months: two screens "have never
 * been seen rendered ... because reaching them needs a sign-in". That is the
 * standing problem here — the app cannot boot without Firebase credentials, and
 * most screens sit behind an account, a role and live data. So nobody looks at
 * them, and visual regressions ship.
 *
 * These previews render real components with the real stylesheets, stubbing only
 * the Firestore boundary. They are a way to LOOK at a screen; the tests are what
 * prove it behaves.
 *
 * Not part of `npm run build`, and not shipped.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const REPO = path.resolve(__dirname, '..');

const FIREBASE_STUB = path.resolve(__dirname, 'firebase-stub.ts');
const CF_STUB = path.resolve(__dirname, 'cloud-functions-stub.ts');
const HOOKS_STUB = path.resolve(__dirname, 'hooks-stub.ts');
const AUTH_STUB = path.resolve(__dirname, 'auth-stub.tsx');
const ADMIN_DB_STUB = path.resolve(__dirname, 'admin-db-stub.ts');
const EVENTS_STUB = path.resolve(__dirname, 'events-stub.ts');
const FIRESTORE_STUB = path.resolve(__dirname, 'firestore-stub.ts');

/** Any import ending in firebase/config becomes the stub, however it is spelled. */
const stubFirebase = {
  name: 'stub-firebase',
  enforce: 'pre' as const,
  resolveId(source: string, importer: string | undefined) {
    // A stub may import the real module for a pure helper — events-stub takes
    // `formatTime` from useSettings rather than reimplementing it, and a second
    // copy would let the preview show times the app would not. Without this the
    // rewrite would point that import back at the stub itself.
    if (importer && importer.includes('/preview/')) return null;
    if (/(^|\/)firebase\/config(\.ts)?$/.test(source)) return FIREBASE_STUB;
    if (/(^|\/)utils\/cloudFunctions(\.ts)?$/.test(source)) return CF_STUB;
    if (/(^|\/)hooks\/(useCurrentEvent|useFirestore|useNotices)(\.ts)?$/.test(source)) return HOOKS_STUB;
    if (/(^|\/)contexts\/AuthContext(\.tsx)?$/.test(source)) return AUTH_STUB;
    if (/(^|\/)hooks\/useAdminDatabase(\.ts)?$/.test(source)) return ADMIN_DB_STUB;
    if (/(^|\/)hooks\/(useEvents|useSettings)(\.ts)?$/.test(source)) return EVENTS_STUB;
    if (source === 'firebase/firestore') return FIRESTORE_STUB;
    return null;
  },
};

export default defineConfig({
  root: REPO,
  plugins: [stubFirebase, react()],
  resolve: { alias: [{ find: /^@\//, replacement: REPO + '/' }] },
  build: {
    outDir: path.resolve(REPO, 'preview-dist'),
    emptyOutDir: true,
    rollupOptions: { input: [path.resolve(__dirname, 'rider.html'), path.resolve(__dirname, 'driver.html'), path.resolve(__dirname, 'manager.html'), path.resolve(__dirname, 'shell.html'), path.resolve(__dirname, 'records.html'), path.resolve(__dirname, 'splash.html')] },
  },
});
