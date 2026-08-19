/**
 * Web push: deciding whether it is possible, and turning it on.
 *
 * This replaces TWO abandoned modules that both tried to do this job and
 * disagreed with each other — `src/utils/fcm.ts` (deleted) and the older half of
 * `src/utils/notifications.ts`. Neither was ever called from anywhere, and both
 * were tree-shaken out of the production bundle, so push has never delivered a
 * single message in this app. See docs/STATUS.md.
 *
 * The verdict function is PURE and takes the browser in as arguments, so the
 * whole matrix can be tested without a browser — the same shape as
 * `src/utils/pwaInstall.ts` and `src/utils/swUpdate.ts`.
 *
 * iOS is the constraint that shapes this. Safari only delivers web push to an
 * app that has been added to the Home Screen; in a browser tab there is no push
 * at all, and asking for permission there is worse than not asking, because iOS
 * gives exactly ONE prompt and a denial can only be undone in Settings.
 */

import { isIosLike, isStandalone } from './pwaInstall';

/** What, if anything, we can offer this browser. */
export type PushAvailability =
    /** No Notification API, no service worker, or no PushManager. Show nothing. */
    | 'unsupported'
    /** iOS in a browser tab. Possible, but only after the app is installed. */
    | 'needs-install'
    /** Permission was refused. On iOS this is now a Settings-level change. */
    | 'blocked'
    /** Can ask. */
    | 'off'
    /** Permission granted and a token is held. */
    | 'on';

interface NavigatorLike {
    userAgent?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
    serviceWorker?: unknown;
}

interface WindowLike {
    Notification?: { permission?: string };
    PushManager?: unknown;
    matchMedia?: (query: string) => { matches: boolean };
    navigator?: NavigatorLike;
}

/**
 * The single verdict both the Profile control and the post-assignment prompt
 * read, so the two can never disagree about whether push is possible.
 *
 * Order matters. `unsupported` beats everything because there is nothing to say.
 * `needs-install` is checked BEFORE `off`: on an uninstalled iPhone the honest
 * answer is "install first", not "turn it on", and offering the toggle there
 * would burn the one permission prompt iOS allows.
 */
export function pushAvailability(win: WindowLike | undefined, hasToken: boolean): PushAvailability {
    const nav = win?.navigator;
    const permission = win?.Notification?.permission;

    if (!win?.Notification || !nav?.serviceWorker || !win?.PushManager) return 'unsupported';
    if (permission === 'denied') return 'blocked';

    // An installed iOS app CAN receive push; a tab cannot, whatever the
    // permission says. Checked after `denied` so a previous refusal is still
    // reported honestly rather than being masked as "install me".
    if (isIosLike(nav.userAgent ?? '', nav.maxTouchPoints ?? 0) && !isStandalone(win)) {
        return 'needs-install';
    }

    if (permission === 'granted') return hasToken ? 'on' : 'off';
    return 'off';
}

/** Whether push could ever work here, install step aside. */
export function pushIsPossible(availability: PushAvailability): boolean {
    return availability !== 'unsupported';
}

/**
 * FCM error codes that mean the token is dead and should be dropped.
 *
 * Without pruning, dead tokens accumulate for ever and every send gets slower —
 * the difference between push that works for a month and push that works for a
 * year.
 */
const DEAD_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
]);

export function isDeadTokenError(code: string | undefined): boolean {
    return code !== undefined && DEAD_TOKEN_CODES.has(code);
}

/**
 * A stable key for one device's token, for the `fcmTokens` map on the user doc.
 *
 * A MAP rather than a single string, because the old shape meant last device
 * wins: register on a phone, later open the app on a laptop, and the phone
 * silently stops receiving. A map rather than an array because pruning a dead
 * token is then a single field delete instead of a read-modify-write race.
 *
 * Firestore field paths cannot contain `.`, `/`, `[`, `]`, `*` or backtick, and
 * FCM tokens contain `:` and `-` but the registration id can also contain other
 * characters, so the key is sanitised rather than trusted.
 */
export function tokenKey(token: string): string {
    return token.replace(/[./[\]*`~]/g, '_');
}

/**
 * A human name for this device, so Profile can distinguish "this phone" from
 * "that laptop" rather than showing a 160-character token.
 */
export function deviceLabel(userAgent: string): string {
    const device = /iphone/i.test(userAgent) ? 'iPhone'
        : /ipad/i.test(userAgent) ? 'iPad'
            : /android/i.test(userAgent) ? 'Android'
                : /macintosh/i.test(userAgent) ? 'Mac'
                    : /windows/i.test(userAgent) ? 'Windows'
                        : 'This device';
    // Order matters: Chrome and Edge both claim Safari in their UA.
    const browser = /crios|edgios|fxios/i.test(userAgent) ? 'browser'
        : /edg\//i.test(userAgent) ? 'Edge'
            : /chrome/i.test(userAgent) ? 'Chrome'
                : /firefox/i.test(userAgent) ? 'Firefox'
                    : /safari/i.test(userAgent) ? 'Safari'
                        : 'browser';
    return device + ' · ' + browser;
}

// ── Which token belongs to THIS device ──────────────────────────────────────
//
// The user document holds every device's token, so on logout we have to know
// which entry is ours — otherwise we would either clear everybody's (silently
// unsubscribing the user's other phone) or clear nothing.
//
// Remembered locally rather than re-derived: re-deriving means calling
// `getToken`, which needs permission and a live service worker, and on logout
// neither is worth depending on.
//
// Never throws. Same contract as theme.ts: localStorage is a SecurityError in a
// sandboxed iframe and in Lockdown Mode, and this is not worth taking the app
// down for.

export const DEVICE_TOKEN_KEY = 'sabha-push-device-token';

export function readDeviceToken(storage?: Pick<Storage, 'getItem'>): string | null {
    try {
        return (storage ?? globalThis.localStorage)?.getItem(DEVICE_TOKEN_KEY) ?? null;
    } catch {
        return null;
    }
}

export function writeDeviceToken(
    token: string | null,
    storage?: Pick<Storage, 'setItem' | 'removeItem'>,
): void {
    try {
        const store = storage ?? globalThis.localStorage;
        if (token) store?.setItem(DEVICE_TOKEN_KEY, token);
        else store?.removeItem(DEVICE_TOKEN_KEY);
    } catch {
        // Push still works this session; it just forgets which token was ours.
    }
}
