/**
 * The messaging service worker, and the reason its scope is not negotiable.
 *
 * There are two service workers in this app now. The Workbox one controls `/`,
 * and `components/UpdateBanner.tsx` turns `controllerchange` into
 * `window.location.reload()`. If the messaging worker were ever registered at
 * `/` as well, the two would contend for control and that reload becomes a LOOP
 * — on a Sarthi's phone, mid-carload.
 *
 * It is registered at `/firebase-cloud-messaging-push-scope`, which is the FCM
 * SDK's own `DEFAULT_SW_SCOPE` and a narrowing of the script's natural scope, so
 * it never becomes the page controller. `skipWaiting()` and `clients.claim()`
 * are absent for the same reason and must stay absent — boilerplate for Firebase
 * messaging workers often includes them.
 *
 * Push was dead for the entire life of this app partly because
 * `/firebase-messaging-sw.js` did not exist and the SPA rewrite answered it with
 * `index.html`; service worker registration fails on that MIME type.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

/**
 * The file with comments stripped.
 *
 * The comments here NAME the things being banned — "there is no skipWaiting()
 * below" — so matching raw text flags the very note explaining the rule. The
 * guard cares about code.
 */
const code = (f: string) => read(f)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the messaging service worker', () => {
    it('exists as a real file, so hosting serves it instead of the SPA rewrite', () => {
        expect(existsSync(path.join(ROOT, 'public/firebase-messaging-sw.js'))).toBe(true);
    });

    it('never claims the page — no skipWaiting, no clients.claim', () => {
        // Either one would put it in contention with the Workbox worker for `/`.
        const sw = code('public/firebase-messaging-sw.js');
        expect(sw, 'skipWaiting would fight the Workbox worker').not.toMatch(/skipWaiting\s*\(/);
        expect(sw, 'clients.claim would take over the page').not.toMatch(/clients\s*\.\s*claim\s*\(/);
    });

    it('is registered at the FCM scope, not at the site root', () => {
        const client = read('src/utils/pushClient.ts');
        expect(client).toMatch(/firebase-cloud-messaging-push-scope/);
        expect(client, 'the scope must be passed explicitly').toMatch(/scope:\s*SW_SCOPE/);
    });

    it('handles a tap, so the notification is not a dead control', () => {
        expect(code('public/firebase-messaging-sw.js')).toMatch(/notificationclick/);
    });

    it('the comment stripper leaves the code — this cannot pass vacuously', () => {
        // If `code()` returned nothing, every "not.toMatch" above would pass
        // while the file said anything at all.
        const sw = code('public/firebase-messaging-sw.js');
        expect(sw).toMatch(/importScripts/);
        expect(sw).toMatch(/firebase\.initializeApp/);
        expect(sw.length).toBeGreaterThan(200);
    });

    it('does not register a background handler that would double the banner', () => {
        // The server sends a `notification` block, which FCM displays itself.
        expect(code('public/firebase-messaging-sw.js')).not.toMatch(/onBackgroundMessage/);
    });
});

describe('build and hosting wiring', () => {
    it('is kept out of the Workbox precache', () => {
        // A service worker precached and re-served by another service worker is
        // meaningless, and keeps a stale copy alive across deploys.
        const config = read('vite.config.ts');
        expect(config).toMatch(/globIgnores/);
        expect(config).toMatch(/firebase-messaging-sw\.js/);
    });

    it('restates node_modules in globIgnores, which REPLACES the workbox default', () => {
        expect(read('vite.config.ts')).toMatch(/globIgnores:.*node_modules/s);
    });

    it('is served with no-cache, like the other entry points', () => {
        // Otherwise it inherits Firebase's default max-age=3600 and a fix to the
        // worker takes an hour to reach anyone.
        expect(read('firebase.json')).toMatch(/manifest\.webmanifest\|firebase-messaging-sw\.js/);
    });

    it('documents the VAPID key without making it fatal', () => {
        // REQUIRED_ENV is for values whose absence renders a blank white page. A
        // missing VAPID key just makes push unavailable, and `pushClient`
        // reports that honestly through `hasVapidKey()`.
        expect(read('.env.example')).toMatch(/VITE_FIREBASE_VAPID_KEY/);
        expect(read('vite.config.ts')).not.toMatch(/REQUIRED_ENV[\s\S]{0,200}VAPID/);
    });

    it('the rival modules stay deleted', () => {
        // Two abandoned attempts disagreed with each other for the life of the
        // app. A future session must not wire up a third.
        expect(existsSync(path.join(ROOT, 'src/utils/fcm.ts'))).toBe(false);
        expect(existsSync(path.join(ROOT, 'src/utils/notifications.ts'))).toBe(false);
    });
});
