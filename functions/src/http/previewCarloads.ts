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
import { assertApprovedManager, isApprovedDriverData } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { rejectionFor } from '../utils/ridePool';
import {
    previewCarloads as simulate, PreviewRider, PreviewCar,
} from '../utils/carloadPreview';
import { resolveVehicleHolder } from '../utils/fleet';
import { resolveHomeCoords } from '../utils/coords';
import { maxPassengerSeats } from '../utils/seats';
import { seatsOf } from '../constants/seats';
import { RideType } from '../types';
import { GEO_FENCE_MILES } from '../utils/carload';
import { dateKeyOfEventId, LOCATION_ID_PATTERN } from '../utils/locations';
import {
    resolveVenue, getSabhaLocation, locationsOrFoundingFallback,
} from '../utils/settings';
import { FOUNDING_LOCATION_ID } from '../constants/tenancy';

const CONTEXT_DOC = 'system/rideContext';

/** Passenger seats in a vehicle — the driver occupies one. Same as globalAssignDriver. */
function seatsOfVehicle(vehicle: unknown): number {
    const capacity = Math.floor(Number((vehicle as { capacity?: unknown })?.capacity));
    return Number.isFinite(capacity) ? Math.max(0, capacity - 1) : 0;
}

/** A car this preview could not simulate, and why — so it is not silently absent. */
export interface UnusableCar {
    /** The Sarthi holding it, or the vehicle id when the problem is the vehicle. */
    id: string;
    reason: 'no-home-address' | 'driver-not-approved';
}

/**
 * The cars to simulate, in the order they are assumed to tap.
 *
 * SARTHIS WHO ACTUALLY HOLD A VEHICLE COME FIRST, largest car first, because those are
 * the taps that will really happen and their fence is real. Unclaimed vehicles follow,
 * with `from: null` — nobody has taken them, so there is no home to measure a fence from
 * and the group says a limit was not checked. Without them a Friday evening before
 * anyone has picked a car would show an empty board, which is the common early state and
 * says nothing true.
 *
 * Largest first WITHIN each band, and that is the one assumption left: which Sarthi taps
 * first is unknowable and the split depends on it. Largest first shows the fewest cars
 * needed to clear the queue, which is the question a manager watching a queue build up is
 * actually asking. Every group is labelled, and the board says it re-forms on each tap.
 *
 * A Sarthi with NO HOME ADDRESS is reported rather than simulated: `globalAssignDriver`
 * refuses them outright ("Your location is not set"), so their car can collect nobody and
 * quietly leaving it out of the board would hide a thing a manager can fix in one call.
 */
async function carsToSimulate(
    db: admin.firestore.Firestore,
    fleet: admin.firestore.QueryDocumentSnapshot[],
): Promise<{ cars: PreviewCar[]; unusable: UnusableCar[] }> {
    const held: Array<PreviewCar & { seats: number }> = [];
    const free: PreviewCar[] = [];
    const unusable: UnusableCar[] = [];

    for (const doc of fleet) {
        const vehicle = doc.data();
        // The same two states globalAssignDriver accepts. A vehicle in maintenance
        // cannot be dispatched at all, by anybody.
        if (vehicle?.status !== 'available' && vehicle?.status !== 'in_use') continue;

        const seats = seatsOfVehicle(vehicle);
        if (seats <= 0) continue;

        const holder = resolveVehicleHolder(vehicle);
        if (!holder) {
            // Free and unclaimed. Simulated, but unfenced and labelled as such.
            free.push({ id: doc.id, seats, from: null });
            continue;
        }

        const driverSnap = await db.collection('users').doc(holder).get();
        const driver = driverSnap.data();

        // Revoked mid-evening while still holding a car. Dispatch refuses them, so their
        // car takes nobody — and this is the one screen that would show a manager why.
        if (!isApprovedDriverData(driver)) {
            unusable.push({ id: holder, reason: 'driver-not-approved' });
            continue;
        }

        const from = resolveHomeCoords(driver);
        if (!from) {
            unusable.push({ id: holder, reason: 'no-home-address' });
            continue;
        }

        // Keyed by the SARTHI, not the vehicle: the board names a person, and the fence
        // is measured from their home.
        held.push({ id: holder, seats, from });
    }

    const bySeats = (a: { seats: number }, b: { seats: number }) => b.seats - a.seats;
    return {
        cars: [...held.sort(bySeats), ...free.sort(bySeats)],
        unusable,
    };
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
    const { cars, unusable } = await carsToSimulate(db, fleetSnap.docs);
    const maxFleetSeats = maxPassengerSeats(fleetSnap.docs.map(d => d.data()?.capacity));

    const { groups, leftover } = simulate(pool, venue, cars, maxFleetSeats);

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
        /**
         * The cars it simulated: whose, how many seats, and whether a fence applied.
         *
         * No coordinates. The Sarthi's home is what the fence is measured FROM, and it
         * has no business leaving the server — the board only needs to know that a limit
         * was applied, not from where.
         */
        cars: cars.map(c => ({ id: c.id, seats: c.seats, fenced: c.from !== null })),
        /** Cars that exist but could collect nobody, so they are not silently absent. */
        unusable,
        /** The bound applied, so the screen can name the number rather than hardcode it. */
        fenceMiles: GEO_FENCE_MILES,
        maxFleetSeats,
    };
});
