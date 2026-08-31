/**
 * Read the manager's notification configuration, and never let reading it break a send.
 *
 * ONE DOCUMENT, `settings/notifications`, resolved through the shared pure function in
 * ../constants/notifications. Everything about validation, defaults and failing open
 * lives there so the client panel and this reader cannot disagree about what a
 * half-written document means.
 *
 * WHY IT IS CACHED. `dispatch` consults this on every single send, and
 * `globalAssignDriver` sends once per rider — an uncached read would add a Firestore
 * round trip per Bhulku to Friday dispatch, on the path where a manager is waiting.
 * The cache is per function INSTANCE and short, so a manager's change lands within a
 * minute without anybody redeploying. That delay is stated on the panel.
 *
 * WHY IT NEVER THROWS. A settings read that failed would take down whatever was trying
 * to notify — a completing ride, a claimed pickup. Every failure path here returns the
 * shipped defaults, which is "send everything". A config bug that sends a notification
 * somebody muted is a nuisance; a config bug that swallows "Your Sarthi is outside
 * waiting for you" leaves a volunteer parked outside and a child indoors.
 */

import * as admin from 'firebase-admin';
import {
    DEFAULT_NOTIFICATION_SETTINGS,
    NotificationSettings,
    resolveNotificationSettings,
} from '../constants/notifications';

export const NOTIFICATION_SETTINGS_DOC = 'settings/notifications';

/**
 * Long enough to spare Friday dispatch a read per rider, short enough that a manager
 * who flips a switch and tests it sees the new behaviour rather than filing a bug.
 */
export const CACHE_TTL_MS = 60_000;

let cached: { at: number; value: NotificationSettings } | null = null;

/** Drop the cache. For tests, and for the callable that has just written a change. */
export function clearNotificationSettingsCache(): void {
    cached = null;
}

export async function getNotificationSettings(
    db?: admin.firestore.Firestore,
): Promise<NotificationSettings> {
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

    try {
        const snap = await (db ?? admin.firestore()).doc(NOTIFICATION_SETTINGS_DOC).get();
        const value = resolveNotificationSettings(snap.exists ? snap.data() : undefined);
        cached = { at: now, value };
        return value;
    } catch (error) {
        console.error('[notificationSettings] Could not read config — sending anyway:', error);
        // NOT cached. A transient Firestore blip must not pin the defaults in place for
        // a minute; the next send should try again.
        return DEFAULT_NOTIFICATION_SETTINGS;
    }
}

/**
 * Is this notification switched on?
 *
 * An UNKNOWN key returns true. Only a key in the catalogue can be managed, so anything
 * else is either a send that predates the catalogue or one somebody forgot to register
 * — and in both cases delivering it is the safe answer. The parity ratchet in
 * tests/quality/notifications-are-manageable.test.ts is what stops that becoming a way
 * to smuggle in an unmanageable notification.
 */
export async function notificationEnabled(
    key: string | undefined,
    db?: admin.firestore.Firestore,
): Promise<boolean> {
    if (!key) return true;
    const settings = await getNotificationSettings(db);
    const value = settings.enabled[key as keyof typeof settings.enabled];
    return value !== false;
}
