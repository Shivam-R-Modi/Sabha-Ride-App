// ============================================
// SCHEDULED: expireNotices
// Takes down notices that are past, and their images. Also clears the agenda off
// sabhas that have already happened — the same "manager-authored text that
// expires" job, sharing one nightly slot rather than paying for a second
// scheduler entry to run one bounded query.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { DEFAULT_TIME_ZONE, zonedDateKey } from '../utils/time';
import { deleteNoticeImage } from '../utils/noticeStorage';
import { clearPastAgendas } from '../utils/pastAgendas';

/** Same ceiling as expireStaleRequests: a runaway sweep is worse than a slow one. */
const MAX_PER_RUN = 200;

/**
 * A notice is past when the day it names has ENDED.
 *
 * Compared as `YYYY-MM-DD` strings in the sabha's own timezone, via
 * `zonedDateKey` — not `toISOString().slice(0, 10)`. A UTC comparison would take
 * an evening notice down five hours early on the east coast, which is exactly
 * during the sabha it was advertising.
 *
 * `showUntil` wins if both are set; `eventId` is the fallback so a notice tied to
 * a sabha disappears with it without the manager also picking a date.
 */
export function noticeIsPast(
    notice: { showUntil?: string | null; eventId?: string | null },
    todayKey: string,
): boolean {
    const until = notice.showUntil ?? notice.eventId ?? null;
    if (!until) return false;          // no date given: it stays until removed
    return until < todayKey;           // shows for the whole of its own day
}

export const expireNotices = functions.pubsub
    .schedule('every day 03:00')
    .timeZone(DEFAULT_TIME_ZONE)
    .onRun(async () => {
        const db = admin.firestore();

        const todayKey = zonedDateKey(new Date(), DEFAULT_TIME_ZONE);

        // Its OWN try/catch, ahead of the notice sweep and outside it. Two
        // independent jobs share this slot, and neither may take the other down —
        // the same reasoning that keeps this whole handler from throwing at the
        // ride-request sweep beside it. `clearPastAgendas` already swallows its
        // own errors; this ordering is what stops a notice failure from skipping
        // it silently.
        const agendasCleared = await clearPastAgendas(db, todayKey);
        if (agendasCleared > 0) {
            console.log(`[expireNotices] cleared the agenda on ${agendasCleared} past sabha(s)`);
        }

        try {
            const snapshot = await db.collection('notices').get();

            const past = snapshot.docs
                .filter(doc => noticeIsPast(doc.data() ?? {}, todayKey))
                .slice(0, MAX_PER_RUN);

            if (past.length === 0) {
                console.log('[expireNotices] nothing to take down');
                return null;
            }

            let imagesLeft = 0;
            for (const doc of past) {
                // Image FIRST. Deleting the document first loses the only
                // reference to the object and orphans it for ever.
                const removed = await deleteNoticeImage(doc.data()?.imagePath);
                if (!removed) imagesLeft += 1;
                await doc.ref.delete();
            }

            console.log(
                `[expireNotices] removed ${past.length} notice(s)` +
                (imagesLeft ? `; ${imagesLeft} image(s) could not be deleted` : ''),
            );
            return null;
        } catch (error) {
            // Never throw. This shares the 03:00 slot with the sweep that expires
            // ride requests, and a notice-board failure must not take that down.
            console.error('[expireNotices] Error:', error);
            return null;
        }
    });
