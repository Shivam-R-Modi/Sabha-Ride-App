/**
 * Whether push is possible, and what to offer.
 *
 * Push has never delivered a message in this app. The client half did not exist:
 * two rival modules, neither called from anywhere, both tree-shaken out of the
 * bundle. This is the replacement's decision table.
 *
 * The case that matters most is `needs-install`. On iOS, Safari delivers push
 * ONLY to an app added to the Home Screen — in a tab there is no push at all.
 * Offering a toggle there would spend the single permission prompt iOS allows on
 * a request that cannot work, and a denial can then only be undone in Settings.
 * So an uninstalled iPhone must be told to install, never asked for permission.
 */

import { describe, it, expect } from 'vitest';
import {
    pushAvailability, pushIsPossible, isDeadTokenError, tokenKey,
    deviceLabel, readDeviceToken, writeDeviceToken,
    shouldOfferPush, readPushDismissals, writePushDismissals,
} from '../../src/utils/push';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/** A browser that supports push, running the given UA. */
const win = (opts: {
    ua?: string;
    permission?: string;
    standalone?: boolean;
    touch?: number;
    noNotification?: boolean;
    noServiceWorker?: boolean;
    noPushManager?: boolean;
} = {}) => ({
    Notification: opts.noNotification ? undefined : { permission: opts.permission ?? 'default' },
    PushManager: opts.noPushManager ? undefined : {},
    matchMedia: () => ({ matches: opts.standalone === true }),
    navigator: {
        userAgent: opts.ua ?? ANDROID,
        maxTouchPoints: opts.touch ?? 0,
        serviceWorker: opts.noServiceWorker ? undefined : {},
    },
});

describe('pushAvailability', () => {
    it('says nothing is possible without the APIs', () => {
        expect(pushAvailability(win({ noNotification: true }), false)).toBe('unsupported');
        expect(pushAvailability(win({ noServiceWorker: true }), false)).toBe('unsupported');
        expect(pushAvailability(win({ noPushManager: true }), false)).toBe('unsupported');
        expect(pushAvailability(undefined, false)).toBe('unsupported');
    });

    it('tells an uninstalled iPhone to install, and does NOT offer the toggle', () => {
        // The whole point: iOS delivers push only to an installed app, and
        // spends its one permission prompt whether or not it could have worked.
        expect(pushAvailability(win({ ua: IPHONE }), false)).toBe('needs-install');
    });

    it('offers it on an INSTALLED iPhone', () => {
        expect(pushAvailability(win({ ua: IPHONE, standalone: true }), false)).toBe('off');
    });

    it('treats an iPad sending a Mac user-agent as iOS', () => {
        // Same trap as the install flow: iPadOS 13+ sends a desktop UA and is
        // separated from a real Mac only by its touch points.
        expect(pushAvailability(win({ ua: MAC, touch: 5 }), false)).toBe('needs-install');
    });

    it('does NOT send a real Mac looking for a Home Screen', () => {
        expect(pushAvailability(win({ ua: MAC, touch: 0 }), false)).toBe('off');
    });

    it('offers it on Android with no install step', () => {
        expect(pushAvailability(win({ ua: ANDROID }), false)).toBe('off');
    });

    it('reports a refusal honestly rather than masking it as "install me"', () => {
        // Checked before the install gate on purpose. Telling someone to install
        // when the real problem is a denied permission sends them round a loop
        // that cannot end.
        expect(pushAvailability(win({ ua: IPHONE, permission: 'denied' }), false)).toBe('blocked');
        expect(pushAvailability(win({ ua: ANDROID, permission: 'denied' }), false)).toBe('blocked');
    });

    it('is only "on" when a token is actually held', () => {
        // Permission granted but no token means the registration failed. Saying
        // "on" there would be the dead-control failure this repo keeps removing.
        expect(pushAvailability(win({ permission: 'granted' }), false)).toBe('off');
        expect(pushAvailability(win({ permission: 'granted' }), true)).toBe('on');
    });
});

describe('pushIsPossible', () => {
    it('is false only when the browser cannot do it at all', () => {
        expect(pushIsPossible('unsupported')).toBe(false);
        for (const v of ['needs-install', 'blocked', 'off', 'on'] as const) {
            expect(pushIsPossible(v)).toBe(true);
        }
    });
});

describe('isDeadTokenError', () => {
    it('recognises the codes that mean the token is gone', () => {
        expect(isDeadTokenError('messaging/registration-token-not-registered')).toBe(true);
        expect(isDeadTokenError('messaging/invalid-registration-token')).toBe(true);
    });

    it('does not prune on a transient failure', () => {
        // Dropping a live token because the network blipped would silently
        // unsubscribe someone, and nothing would ever put it back.
        expect(isDeadTokenError('messaging/server-unavailable')).toBe(false);
        expect(isDeadTokenError('messaging/internal-error')).toBe(false);
        expect(isDeadTokenError(undefined)).toBe(false);
    });
});

describe('tokenKey', () => {
    it('strips characters Firestore will not accept in a field path', () => {
        // A map key containing a dot would be read as a nested path and the
        // write would land somewhere else entirely.
        expect(tokenKey('abc.def')).toBe('abc_def');
        expect(tokenKey('a[0]*b`c')).toBe('a_0__b_c');
    });

    it('leaves a normal FCM token recognisable', () => {
        const token = 'fMEP0vJqS0:APA91bHqX-9_abcDEF';
        expect(tokenKey(token)).toBe(token);
    });
});

describe('deviceLabel', () => {
    it('names the device and browser so two entries can be told apart', () => {
        expect(deviceLabel(IPHONE)).toBe('iPhone · Safari');
        expect(deviceLabel(ANDROID)).toBe('Android · Chrome');
        expect(deviceLabel(MAC)).toBe('Mac · Chrome');
    });

    it('does not call Chrome-for-iOS "Safari"', () => {
        // Every iOS browser claims Safari in its UA, so the order of the checks
        // is what makes this right.
        expect(deviceLabel('Mozilla/5.0 (iPhone) CriOS/122.0 Safari/604.1')).toBe('iPhone · browser');
    });
});

describe('remembering this device token', () => {
    it('round-trips and clears', () => {
        const store = new Map<string, string>();
        const storage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        };
        writeDeviceToken('tok', storage);
        expect(readDeviceToken(storage)).toBe('tok');
        writeDeviceToken(null, storage);
        expect(readDeviceToken(storage)).toBeNull();
    });

    it('never throws when storage is forbidden', () => {
        // Lockdown Mode and sandboxed iframes.
        const hostile = {
            getItem: () => { throw new Error('SecurityError'); },
            setItem: () => { throw new Error('SecurityError'); },
            removeItem: () => { throw new Error('SecurityError'); },
        };
        expect(() => writeDeviceToken('t', hostile)).not.toThrow();
        expect(readDeviceToken(hostile)).toBeNull();
    });
});

describe('shouldOfferPush — when it is fair to ask', () => {
    const never = { count: 0, lastAt: 0 };
    const NOW = 1_000_000_000_000;
    const DAY = 24 * 60 * 60 * 1000;

    it('asks someone who has push available and has not been asked', () => {
        expect(shouldOfferPush({ availability: 'off', dismissals: never, now: NOW })).toBe(true);
    });

    it('never asks when the browser already refused', () => {
        // The OS will not show the dialog again, so a prompt here is a button
        // that cannot do anything.
        expect(shouldOfferPush({ availability: 'blocked', dismissals: never, now: NOW })).toBe(false);
    });

    it('never asks in an iOS tab', () => {
        // Tapping would spend the one permission prompt iOS allows on a context
        // that can never receive push.
        expect(shouldOfferPush({ availability: 'needs-install', dismissals: never, now: NOW })).toBe(false);
    });

    it('does not pester someone who already turned it on', () => {
        expect(shouldOfferPush({ availability: 'on', dismissals: never, now: NOW })).toBe(false);
    });

    it('waits a week after a dismissal', () => {
        const once = { count: 1, lastAt: NOW };
        expect(shouldOfferPush({ availability: 'off', dismissals: once, now: NOW + 6 * DAY })).toBe(false);
        expect(shouldOfferPush({ availability: 'off', dismissals: once, now: NOW + 8 * DAY })).toBe(true);
    });

    it('stops asking after two refusals, however long it has been', () => {
        const twice = { count: 2, lastAt: NOW };
        expect(shouldOfferPush({ availability: 'off', dismissals: twice, now: NOW + 365 * DAY })).toBe(false);
    });
});

describe('dismissal storage', () => {
    it('round-trips', () => {
        const store = new Map<string, string>();
        const storage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
        };
        writePushDismissals({ count: 1, lastAt: 42 }, storage);
        expect(readPushDismissals(storage)).toEqual({ count: 1, lastAt: 42 });
    });

    it('treats corrupt or absent data as never dismissed', () => {
        expect(readPushDismissals({ getItem: () => 'not json' })).toEqual({ count: 0, lastAt: 0 });
        expect(readPushDismissals({ getItem: () => null })).toEqual({ count: 0, lastAt: 0 });
        expect(readPushDismissals({ getItem: () => { throw new Error('x'); } })).toEqual({ count: 0, lastAt: 0 });
    });
});
