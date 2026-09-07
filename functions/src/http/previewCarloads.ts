// ============================================
// HTTP FUNCTION: previewCarloads  (manager, READ ONLY)
//
// Shows a manager the waiting queue split into the cars dispatch would form,
// instead of a flat list. It writes nothing, takes no lock, and assigns nobody.
//
// WHY IT IS A CALLABLE AND NOT A CLIENT-SIDE COMPUTATION
// -----------------------------------------------------
// The grouping has to be the SAME grouping `globalAssignDriver` produces, or a
// manager plans around it, moves somebody by hand, and the next tap does
// something else. This calls the real `orderForCarload` / `remaindersFirst` /
// `fillBySeats` and filters the pool with the real `rejectionFor`, so there is
// no second implementation to drift.
//
// The alternative was mirroring ~200 lines of geometry and seat arithmetic into
// the browser. `hooks/useAutoDispatch.ts` is what that looked like last time:
// dispatch logic running in a manager's tab, calling itself "the Server logic",
// throwing a ReferenceError on the first match for months while its `finally`
// logged "Processing complete".
//
// NO LOCK, DELIBERATELY. `globalAssignDriver` takes `system/assignmentLock__{hall}`
// because it reads the pool and then writes an assignment. This only reads, so a
// lock would buy nothing and could block a real dispatch behind a manager who
// happened to have the dashboard open.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { rejectionFor } from '../utils/ridePool';
import { previewCarloads as simulate, PreviewRider } from '../utils/carloadPreview';
import { maxPassengerSeats } from '../utils/seats';
import { seatsOf } from '../constants/seats';
import { RideType } from '../types';
import { dateKeyOfEventId, LOCATION_ID_PATTERN } from '../utils/locations';
import {
    resolveVenue, getSabhaLocation, locationsOrFoundingFallback,
} from '../utils/settings';
import { FOUNDING_LOCATION_ID } from '../constants/tenancy';

const CONTEXT_DOC = 'system/rideContext';

/**
 * Passenger seats in each car free right now, largest first.
 *
 * LARGEST FIRST IS AN ASSUMPTION, and the only one this function makes about the
 * future. Which Sarthi taps first is unknowable, and the split genuinely depends on
 * it — so rather than hide that, every group is labelled with the seat count it
 * assumed and the screen says the grouping re-forms on each tap.
 *
 * Largest first because it is the most useful of the arbitrary orders: it shows the
 * fewest cars needed to clear the queue, which is the question a manager watching a
 * queue build up is actually asking.
 *
 * `capacity - 1` throughout — the driver occupies a seat. Same arithmetic as
 * `availableSeats` in globalAssignDriver.
 */
function freeSeatsPerCar(docs: admin.firestore.QueryDocumentSnapshot[]): number[] {
    return docs
        .filter(d => d.data()?.status === 'available')
        .map(d => Math.max(0, Math.floor(Number(d.data()?.capacity)) - 1))
        .filter(seats => seats > 0)
        .sort((a, b) => b - a);
}

export const previewCarloads = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;

    // The queue holds children's names and home addresses, and this returns the shape
    // of it. Same authority as reading the queue itself.
    await assertApprovedManager(db, uid, 'preview the carloads');

    // Generous: this refreshes whenever a request arrives, and on a busy Friday that
    // is legitimately dozens of calls. Present so one stuck tab cannot hammer it.
    await checkRateLimit(uid, {
        maxRequests: 120,
        windowMs: 60 * 1000,
        functionName: 'previewCarloads',
    });

    const rawLocation: unknown = data?.locationId;
    if (rawLocation !== undefined && rawLocation !== null
        && (typeof rawLocation !== 'string' || !LOCATION_ID_PATTERN.test(rawLocation))) {
        throw new functions.https.HttpsError('invalid-argument', 'That sabha location is not valid.');
    }
    const halls = await locationsOrFoundingFallback(db);
    const locationId = typeof rawLocation === 'string' ? rawLocation : FOUNDING_LOCATION_ID;
    const hall = halls.find(h => h.id === locationId);
    if (!hall) {
        // Loud. A retired hall previewing as the founding one would show a manager a
        // grouping for the wrong room.
        throw new functions.https.HttpsError('not-found', 'That sabha location is not open.');
    }

    // ── The window, read exactly as dispatch reads it ───────────────────
    const published = (await db.doc(CONTEXT_DOC).get()).data();
    const byLocation = published?.byLocation as Record<string, Record<string, unknown>> | undefined;
    const slice = byLocation?.[locationId];
    // Once byLocation exists every open hall must have a slice; a missing one is an
    // inconsistent document rather than a quiet evening. Same reasoning, and the same
    // failure mode, as globalAssignDriver.
    if (byLocation && !slice) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'This sabha location has no ride window published yet. Please contact a manager.',
        );
    }
    const rideContext = slice ?? published;

    /**
     * A CLOSED WINDOW IS AN ANSWER, NOT AN ERROR.
     *
     * `globalAssignDriver` throws here because a Sarthi tapped a button that cannot
     * work. A manager merely looking at the queue between sabhas has done nothing
     * wrong, and an error toast on a screen they did not act on reads as a fault.
     */
    if (!rideContext?.rideType) {
        return { status: 'window-closed', groups: [], leftover: [], carSeats: [] };
    }
    const rideType = rideContext.rideType as RideType;

    const venue = resolveVenue(
        rideContext.venue,
        resolveVenue(hall.venue as never, await getSabhaLocation()),
    );
    // The DATE half. A ride's own eventId is always the bare date, so comparing the
    // raw suffixed context id against one would match nothing at all.
    const eventKey = dateKeyOfEventId(rideContext.eventId) ?? null;

    // ── The pool, filtered by the same predicate dispatch uses ──────────
    //
    // ONE `where`, on a field every ride carries. An equality filter on `locationId`
    // or `rideType` returns EMPTY for documents that predate the field, and this
    // screen's whole purpose is showing a manager who is waiting — silently showing
    // nobody is the worst answer available.
    const ridesSnap = await db.collection('rides').where('status', '==', 'requested').get();
    const singleActiveLocation = halls.length === 1;

    const pool: PreviewRider[] = [];
    for (const doc of ridesSnap.docs) {
        const d = doc.data();
        // No `driverId`: there is no tapping Sarthi, so the "cannot be handed your own
        // request" rule has nothing to apply to. Every other dimension is checked.
        const reason = rejectionFor(d, {
            eventKey, rideType, locationId, singleActiveLocation,
        });
        if (reason) continue;
        pool.push({
            id: doc.id,
            lat: d.pickupLat,
            lng: d.pickupLng,
            seats: seatsOf(d),
            allowSplit: d.allowSplit !== false,
            isRemainder: !!d.groupId,
            createdAt: typeof d.createdAt === 'string' ? d.createdAt : undefined,
        });
    }

    const fleetSnap = await db.collection('vehicles').get();
    const carSeats = freeSeatsPerCar(fleetSnap.docs);
    const maxFleetSeats = maxPassengerSeats(fleetSnap.docs.map(d => d.data()?.capacity));

    const { groups, leftover } = simulate(pool, venue, carSeats, maxFleetSeats);

    /**
     * RIDE IDS ONLY — no names, no phone numbers, no addresses.
     *
     * The client already has all of that from its own `rides` subscription and joins
     * on the id. Returning it again would add a second path carrying children's
     * personal data for no gain, and this app's rule is that the wordier, narrower
     * option wins on anything touching that.
     */
    return {
        status: 'ok' as const,
        rideType,
        locationId,
        groups,
        leftover,
        /** Every free car's seats, so the screen can say what it assumed. */
        carSeats,
        maxFleetSeats,
    };
});
