/**
 * Which notices this device has already opened.
 *
 * DEVICE-SCOPED, ON PURPOSE. Nothing in Firestore records "I have read this" for
 * any feature, and the two other "I have already dealt with this" flags in the
 * app — the install dismissal and the push pre-prompt — are both localStorage for
 * the same reason: a badge is worth no writes, no new field on a user document
 * holding a child's address, and no rules change. The cost is honest and small:
 * a new phone shows every notice as new once.
 *
 * Follows `readPushDismissals` / `writePushDismissals` in ./push.ts exactly —
 * `sabha-` prefix, JSON value, injected storage so it is testable with no DOM,
 * and a catch that treats unreadable as absent. localStorage is not merely empty
 * in Safari's Lockdown Mode and in a sandboxed iframe, it THROWS on access, and a
 * notice badge is not worth taking a dashboard down for.
 */
export const SEEN_NOTICES_KEY = 'sabha-seen-notices';

export function readSeenNotices(storage?: Pick<Storage, 'getItem'>): string[] {
    try {
        const raw = (storage ?? globalThis.localStorage)?.getItem(SEEN_NOTICES_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        // Every element checked, not just the array itself. A hand-edited or
        // half-written value would otherwise put a number into an id comparison.
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((id): id is string => typeof id === 'string' && id !== '');
    } catch {
        // Unreadable or malformed is the same as having seen nothing. That is the
        // safe direction: the badge appears, which is at worst a nudge to read
        // something already read — the opposite mistake hides a new notice.
        return [];
    }
}

export function writeSeenNotices(ids: string[], storage?: Pick<Storage, 'setItem'>): void {
    try {
        (storage ?? globalThis.localStorage)?.setItem(SEEN_NOTICES_KEY, JSON.stringify(ids));
    } catch {
        // Worst case the badge comes back on the next load. Not worth failing over.
    }
}

/**
 * The stored ids that still exist on the board, plus `justOpened` if given.
 *
 * Pruning here rather than in a sweep is what keeps the list bounded for free:
 * notices are deleted server-side once they expire, so intersecting on every
 * render drops their ids the first time the board loads without them. Left
 * ungroomed this key would grow for the life of the install and never shrink.
 */
export function pruneSeenNotices(stored: string[], liveIds: string[], justOpened?: string): string[] {
    const live = new Set(liveIds);
    const kept = stored.filter(id => live.has(id));
    if (justOpened && live.has(justOpened) && !kept.includes(justOpened)) kept.push(justOpened);
    return kept;
}
