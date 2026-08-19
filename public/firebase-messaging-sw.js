/* Background push handler for Bhulka Gaadi.
 *
 * SCOPE IS EVERYTHING HERE. This worker is registered explicitly at
 * `/firebase-cloud-messaging-push-scope`, which is what the FCM SDK uses by
 * default. It must NEVER control `/`, because the Workbox worker does, and
 * components/UpdateBanner.tsx turns `controllerchange` into a full page reload.
 * Two workers contending for `/` would be a reload loop on a Sarthi's phone
 * mid-carload. That is why there is no `skipWaiting()` and no `clients.claim()`
 * below, and why they must never be added.
 *
 * The Firebase config arrives on the QUERY STRING rather than being hardcoded.
 * `public/` is copied verbatim and Vite substitutes nothing here, so a hardcoded
 * copy would be a fourth place the config lives and the one that goes stale.
 * It also means the script URL changes when the config does, so the browser
 * correctly installs a replacement worker.
 *
 * There is deliberately no `onBackgroundMessage` handler: the server sends a
 * `notification` block, which FCM displays itself. Adding one would show two
 * banners for every push.
 */
importScripts('https://www.gstatic.com/firebasejs/12.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.8.0/firebase-messaging-compat.js');

firebase.initializeApp(Object.fromEntries(new URL(self.location).searchParams));
firebase.messaging();

/* Without this, tapping the notification does nothing — a dead control in the
 * one place the user is most engaged. Focus an open tab if there is one. */
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
            for (const client of all) {
                if ('focus' in client) return client.focus();
            }
            return self.clients.openWindow('/');
        }),
    );
});
