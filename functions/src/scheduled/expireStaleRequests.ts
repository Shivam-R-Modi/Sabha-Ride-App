// ============================================
// SCHEDULED FUNCTION: expireStaleRequests
// Closes ride requests that no driver ever answered.
// ============================================

/**
 * Requests do not expire, and that turns out to be permanent.
 *
 * Riders book ahead — a request sitting in the queue with no driver on it is the
 * ordinary case, not a fault, and the app is right to accept it. But nothing ever
 * closes one. A request that no driver answers before the window shuts stays
 * `requested` for ever: invisible to the next gathering's dispatch, because the
 * event key will not match, and permanently "waiting" on the rider's own record
 * and the manager's board.
 *
 * Measured in production on 2026-08-14: two riders tapped "Ready to leave" four
 * minutes after the last driver went home. Their requests would have sat there
 * indefinitely, and both riders would have shown as waiting for a drop-off that
 * happened a week ago. Three older rows from a previous sabha were found and
 * cleared by hand the same day.
 *
 * WHY THIS IS SAFE TO RUN UNATTENDED
 * ----------------------------------
 * It only ever touches requests belonging to a gathering that is **strictly in
 * the past**, and only those still in `requested` — never assigned, never in
 * progress, never one a driver is on the way to. Today's queue is untouchable by
 * construction, so a rider waiting right now cannot be cancelled out from under
 * a driver who is about to tap.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { DEFAULT_TIME_ZONE, zonedDateKey } from '../utils/time';
import { writeAuditLog } from '../utils/audit';
import { getTimeZone } from '../utils/settings';

/** The only status this touches. Anything a driver has taken is off limits. */
const UNSERVED = 'requested';

/** Waiting statuses a rider can be left stranded in. */
const WAITING_STATUSES = ['waiting_for_pickup', 'waiting_for_dropoff'];

/**
 * ponytail: one batch per run, so at most ~200 requests are closed per night
 * (2 writes each, against Firestore's 500-write batch limit). A backlog larger
 * than that drains over successive nights rather than failing the whole commit.
 * Upgrade path is a paged loop if the congregation ever leaves that many behind.
 */
const MAX_PER_RUN = 200;

/** The gathering a ride belongs to, under any of the three names in use. */
export function eventKeyOfRide(ride: any): string | null {
    const key = ride?.eventId ?? ride?.eventDate ?? ride?.date;
    return typeof key === 'string' && key ? key : null;
}

/**
 * Is this request past saving?
 *
 * Exported and pure: the entire risk of this function is answering "yes" to a
 * ride that is still live, so the answer is worth asserting directly.
 *
 * A request with NO event key at all is left alone. It cannot be dated, so it
 * cannot be shown to be stale — and the failure mode of guessing wrong here is
 * cancelling a rider who is standing outside waiting. Unlike the vehicle sweep,
 * where an undateable record meant "certainly forgotten", here it means only
 * "unknown", and unknown must not cost somebody their lift.
 */
export function shouldExpire(ride: any, todayKey: string): boolean {
    if (ride?.status !== UNSERVED) return false;

    const key = eventKeyOfRide(ride);
    if (!key) return false;

    // Strictly before today. A gathering that is still today keeps its queue,
    // however late it is — drop-off runs legitimately cross midnight.
    return key < todayKey;
}

/**
 * Daily at 03:00, after the ride window has closed and the fleet sweep has run.
 *
 * Deliberately not at the moment the window shuts: a transition-triggered sweep
 * misses every request left behind by a run that crashed, a deploy during the
 * transition minute, or a gathering nobody opened. A dated sweep catches all of
 * them, and re-running it is harmless.
 */
export const expireStaleRequests = functions.pubsub
    .schedule('every day 03:00')
    .timeZone(DEFAULT_TIME_ZONE)
    .onRun(async () => {
        const db = admin.firestore();

        try {
            const timeZone = await getTimeZone();
            const todayKey = zonedDateKey(new Date(), timeZone);

            const snap = await db.collection('rides').where('status', '==', UNSERVED).get();
            if (snap.empty) {
                console.log('[expireStaleRequests] No open requests — nothing to do');
                return null;
            }

            const stale = snap.docs
                .filter(d => shouldExpire(d.data(), todayKey))
                .slice(0, MAX_PER_RUN);

            if (stale.length === 0) {
                console.log(`[expireStaleRequests] ${snap.size} open request(s), all current`);
                return null;
            }

            const now = new Date().toISOString();
            const batch = db.batch();

            // A rider can have several unserved rows — a split leg, or two
            // gatherings they never got to. Their user document must be written
            // once, or the batch rejects a duplicate reference.
            const strandedRiders = new Map<string, string>();

            for (const doc of stale) {
                const ride = doc.data();

                batch.update(doc.ref, {
                    // Reusing the existing status rather than inventing one: every
                    // list in the app already filters `cancelled` out of "ongoing",
                    // so these drop off the manager's board with no UI change. The
                    // reason field is what keeps it honest — nobody cancelled.
                    status: 'cancelled',
                    cancellationReason: 'window-closed',
                    cancelledAt: now,
                    cancelledBy: 'system:expireStaleRequests',
                });

                if (typeof ride?.studentId === 'string') {
                    strandedRiders.set(ride.studentId, doc.id);
                }
            }

            // Only rewrite a rider who is still visibly waiting. One who has since
            // been picked up, gone home, or requested again has moved on, and
            // stamping `missed_ride` over that would replace stale data with wrong
            // data.
            let ridersReset = 0;
            for (const [riderId, rideId] of strandedRiders) {
                const riderRef = db.collection('users').doc(riderId);
                const riderSnap = await riderRef.get();
                if (!riderSnap.exists) continue;

                const rider = riderSnap.data();
                if (!WAITING_STATUSES.includes(rider?.status)) continue;

                const points = rider?.currentRideId;
                if (points && points !== rideId) continue;

                batch.update(riderRef, { status: 'missed_ride', currentRideId: null });
                ridersReset++;
            }

            await batch.commit();

            // After the commit, and never allowed to throw — a request that was
            // closed but unlogged is recoverable; one left open because its audit
            // row failed is the rot this exists to remove.
            await writeAuditLog(db, {
                action: 'doc.update',
                actorUid: 'system:expireStaleRequests',
                actorName: 'Stale request sweep',
                targetCollection: 'rides',
                targetDocumentId: stale[0].id,
                summary: `Expired ${stale.length} unserved ride request(s) from past gatherings`,
                details: {
                    count: stale.length,
                    ridersReset,
                    rideIds: stale.slice(0, 20).map(d => d.id),
                },
            });

            console.log(`[expireStaleRequests] Expired ${stale.length}, `
                + `reset ${ridersReset} rider(s)`);
            return null;
        } catch (error) {
            console.error('[expireStaleRequests] Sweep failed:', error);
            return null;
        }
    });
