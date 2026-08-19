/**
 * The Firebase edge of push: permission, token, and the message stream.
 *
 * Kept apart from `src/utils/push.ts` on purpose. `firebase/config.ts` calls
 * `getAuth()` at module scope, so anything importing it transitively cannot be
 * unit-tested without a live API key — `tests/utils/cloudFunctions.test.ts`
 * documents that trap. All the DECISIONS live in `push.ts`, which imports
 * nothing and is fully tested; this file is the thin part that talks to the
 * network.
 *
 * `firebase/messaging` is loaded with a dynamic import so a user who never
 * enables notifications never downloads the messaging SDK.
 */

import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db, initializeMessaging } from '../../firebase/config';
import { deviceLabel, tokenKey, writeDeviceToken } from './push';

/** Where FCM expects its worker, and the scope that keeps it off `/`. */
const SW_PATH = '/firebase-messaging-sw.js';
const SW_SCOPE = '/firebase-cloud-messaging-push-scope';

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

export function hasVapidKey(): boolean {
    return typeof vapidKey === 'string' && vapidKey.length > 0;
}

/**
 * Register the messaging worker, passing the Firebase config on the query
 * string so there is exactly one copy of it.
 *
 * `register()` resolves BEFORE activation, and `getToken` throws
 * `messaging/failed-service-worker-registration` against a registration that is
 * not yet active — which surfaces to the user as "turning on failed" for a setup
 * that is actually fine. So this waits for `active`.
 */
async function registerMessagingSw(): Promise<ServiceWorkerRegistration> {
    const config = new URLSearchParams({
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
        appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
    });

    // The explicit scope is the single most important argument here — see the
    // header of public/firebase-messaging-sw.js.
    const registration = await navigator.serviceWorker.register(
        `${SW_PATH}?${config}`, { scope: SW_SCOPE },
    );

    if (registration.active) return registration;
    await new Promise<void>(resolve => {
        const worker = registration.installing ?? registration.waiting;
        if (!worker) return resolve();
        worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') resolve();
        });
    });
    return registration;
}

/**
 * Ask for permission and store a token for THIS device.
 *
 * Must be called from a click. Safari rejects `Notification.requestPermission()`
 * outside a user gesture, and on iOS the prompt is one-shot — a refusal can only
 * be undone in Settings, so it must never be spent from an effect.
 */
export async function enablePush(uid: string): Promise<{ ok: boolean; token?: string; reason?: string }> {
    try {
        if (!hasVapidKey()) return { ok: false, reason: 'no-vapid-key' };

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return { ok: false, reason: 'denied' };

        const messaging = await initializeMessaging();
        if (!messaging) return { ok: false, reason: 'unsupported' };

        const { getToken } = await import('firebase/messaging');
        const registration = await registerMessagingSw();
        const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
        if (!token) return { ok: false, reason: 'no-token' };

        // A map entry, not a single field: another device's token must survive.
        await updateDoc(doc(db, 'users', uid), {
            [`fcmTokens.${tokenKey(token)}`]: {
                label: deviceLabel(navigator.userAgent),
                updatedAt: new Date().toISOString(),
            },
        });
        writeDeviceToken(token);
        return { ok: true, token };
    } catch (error) {
        console.error('[push] could not enable:', error);
        return { ok: false, reason: 'error' };
    }
}

/**
 * Turn it off for this device only.
 *
 * `deleteToken` first, so FCM stops treating it as deliverable rather than us
 * merely forgetting it. Then the document. Order matters on logout: after
 * `signOut` the rules deny the write.
 */
export async function disablePush(uid: string, token: string): Promise<void> {
    try {
        const messaging = await initializeMessaging();
        if (messaging) {
            const { deleteToken } = await import('firebase/messaging');
            await deleteToken(messaging).catch(() => {});
        }
        await updateDoc(doc(db, 'users', uid), {
            [`fcmTokens.${tokenKey(token)}`]: deleteField(),
        });
        writeDeviceToken(null);
    } catch (error) {
        console.error('[push] could not disable:', error);
    }
}

/**
 * Foreground messages.
 *
 * FCM suppresses the system notification while the tab is focused, so without
 * this a Sarthi looking at the route screen never learns a new assignment
 * landed. Routed to a toast rather than a second OS banner over an app the user
 * is already reading.
 *
 * Returns an unsubscriber — React StrictMode double-invokes effects in dev, so
 * without it every message appears twice.
 */
export async function onForegroundMessage(
    handler: (message: { title: string; body: string }) => void,
): Promise<() => void> {
    const messaging = await initializeMessaging();
    if (!messaging) return () => {};

    const { onMessage } = await import('firebase/messaging');
    return onMessage(messaging, payload => {
        handler({
            title: payload.notification?.title ?? 'Bhulka Gaadi',
            body: payload.notification?.body ?? '',
        });
    });
}
