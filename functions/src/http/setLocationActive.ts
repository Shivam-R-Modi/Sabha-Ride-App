// ============================================
// HTTP FUNCTION: setLocationActive
//
// Opening and closing a sabha hall — the most consequential act in the whole
// multi-location feature, which is why it is a callable and not a field a
// browser can write.
//
// firestore.rules denies `active` to every client in both directions:
//
//     allow create: ... && request.resource.data.get('active', false) == false;
//     allow update: ... && !changedKeys().hasAny(['active']);
//
// So a manager may create a hall and correct its address from the app, and this
// is the only path that can open one. That split is deliberate: getting an
// address wrong is visible and fixable, whereas opening a hall changes what
// every rider is asked and where every Sarthi can be sent.
//
// WHAT CLOSING ONE DOES, AND WHY IT NEEDS GUARDING
// ------------------------------------------------
// A retired hall is not merely hidden. `rejectionFor` refuses a ride whose
// `locationId` names a hall that is not open, so every rider already booked for
// it becomes undispatchable — the driver is told nobody is waiting and the rider
// is never collected. Nothing throws and nothing logs. So closing a hall with
// people booked into it requires an acknowledgement, exactly as deleting a
// sabha does, and closing one with a Sarthi already on the road is refused
// outright.
//
// It also refuses to close the LAST open hall. `locationsOrFoundingFallback`
// would then synthesise the founding hall from `settings/main` and log an error
// — that is a bridge for a project whose seed has not run, not a state to leave
// production in, and it would silently re-open a hall a manager had just shut.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { writeAuditLog } from '../utils/audit';
import { LOCATION_ID_PATTERN, locationOfRide, normaliseLocation } from '../utils/locations';
import { seatsOf } from '../constants/seats';

const LOCATIONS = 'locations';

/** Ride states that mean a Sarthi is already on the road for this hall. */
const IN_FLIGHT_STATUSES = ['assigned', 'driver_en_route', 'arriving', 'in_progress'];

export interface LocationActivePreview {
    locationId: string;
    name: string;
    /** What it would become. */
    active: boolean;
    /** Riders booked for this hall who are still waiting for a car. */
    requestedRideCount: number;
    /** People those requests are for — seven requests can be fourteen riders. */
    requestedSeatCount: number;
    /** How many halls would be open afterwards. */
    openAfter: number;
}

export const setLocationActive = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const caller = await assertApprovedManager(db, uid, 'open or close a sabha location');

    const rawId: unknown = data?.locationId;
    if (typeof rawId !== 'string' || !LOCATION_ID_PATTERN.test(rawId)) {
        throw new functions.https.HttpsError('invalid-argument', 'That sabha location is not valid.');
    }
    const locationId = rawId;

    if (typeof data?.active !== 'boolean') {
        throw new functions.https.HttpsError('invalid-argument', 'Say whether to open or close it.');
    }
    const active: boolean = data.active;
    const dryRun = data?.dryRun === true;

    // The preview runs on every dialog open; only the real thing is limited.
    if (!dryRun) {
        await checkRateLimit(uid, {
            maxRequests: 20,
            windowMs: 60 * 1000,
            functionName: 'setLocationActive',
        });
    }

    // ── The hall, and every other one ───────────────────────────────────
    const snap = await db.collection(LOCATIONS).get();
    const records = snap.docs
        .map(d => ({ id: d.id, record: normaliseLocation(d.id, d.data()) }));

    const target = records.find(r => r.id === locationId);
    if (!target) {
        throw new functions.https.HttpsError('not-found', 'That sabha location does not exist.');
    }
    /**
     * A MALFORMED DOCUMENT CANNOT BE OPENED.
     *
     * `normaliseLocation` returns null for one with no name or no usable venue — and
     * `getActiveLocations` drops those, so opening it would set `active: true` on a hall
     * that never appears in any list. A manager would tap Open, see nothing happen, and
     * have no way to find out why. The address has to be fixed first.
     */
    if (active && !target.record) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'That location is missing a name or a valid address. Fix those first — a hall '
            + 'without them cannot be opened.',
        );
    }

    const name = target.record?.name ?? locationId;
    const openNow = records.filter(r => r.record?.active).map(r => r.id);
    const alreadyThere = openNow.includes(locationId) === active;

    const openAfter = active
        ? new Set([...openNow, locationId]).size
        : openNow.filter(id => id !== locationId).length;

    // ── Riders booked for this hall ─────────────────────────────────────
    //
    // ONE `where`, on a field every ride carries, then the hall filtered in memory. An
    // equality filter on `locationId` returns EMPTY for documents written before that
    // field existed, so the "is anybody booked here" guard would read clear and close a
    // hall out from under them.
    const ridesSnap = await db.collection('rides')
        .where('status', 'in', [...IN_FLIGHT_STATUSES, 'requested'])
        .get();
    const forThisHall = ridesSnap.docs.filter(d => locationOfRide(d.data()) === locationId);
    const inFlight = forThisHall.filter(d => IN_FLIGHT_STATUSES.includes(d.data()?.status));
    const requested = forThisHall.filter(d => d.data()?.status === 'requested');

    const preview: LocationActivePreview = {
        locationId,
        name,
        active,
        requestedRideCount: requested.length,
        requestedSeatCount: requested.reduce((n, d) => n + seatsOf(d.data()), 0),
        openAfter,
    };

    if (dryRun) return preview;

    if (alreadyThere) {
        // Not an error worth throwing over — the answer is simply "nothing to do", and a
        // second manager having already done it is a race, not a mistake.
        return { ...preview, changed: false };
    }

    if (!active) {
        // ── Guard: the last hall stays open ─────────────────────────────
        if (openAfter === 0) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `${name} is the only sabha location open. Closing it would leave nowhere for `
                + 'anyone to be driven to. Open another one first.',
            );
        }

        // ── Guard: nobody is mid-route ──────────────────────────────────
        if (inFlight.length > 0) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `${inFlight.length} ride${inFlight.length === 1 ? ' is' : 's are'} already on the `
                + `way to ${name}. Wait for them to finish, or release them first.`,
            );
        }

        /**
         * ── Enforced acknowledgement ────────────────────────────────────
         *
         * Server-side, like `deleteSabhaEvent`. These riders do not get an error when the
         * hall closes — they get silence: `rejectionFor` refuses their ride, every Sarthi
         * is told nobody is waiting, and nobody is ever collected. So closing on top of
         * them is a decision a manager has to take explicitly.
         */
        if (requested.length > 0 && data?.acknowledge !== true) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `${requested.length} ride request${requested.length === 1 ? '' : 's'} for `
                + `${name} would stop being dispatchable. Confirm to continue.`,
            );
        }
    }

    // Written BEFORE the change and closed after, so a crash leaves a row saying an
    // attempt was made.
    const auditRef = await writeAuditLog(db, {
        action: active ? 'location.open' : 'location.close',
        actorUid: uid,
        actorName: String(caller.name || 'Manager'),
        targetCollection: LOCATIONS,
        targetDocumentId: locationId,
        summary: `${active ? 'Opened' : 'Closed'} the sabha location ${name}`
            + (!active && requested.length
                ? ` — ${requested.length} waiting request(s) left undispatchable`
                : ''),
        details: {
            active,
            openAfter,
            requestedRideCount: requested.length,
            requestedSeatCount: preview.requestedSeatCount,
        },
        outcome: 'pending',
    });

    await db.collection(LOCATIONS).doc(locationId).set({
        active,
        activeUpdatedAt: new Date().toISOString(),
        activeUpdatedBy: uid,
    }, { merge: true });

    /**
     * `system/rideContext` IS NOT REWRITTEN HERE, and that is deliberate.
     *
     * `updateRideTypeContext` reads the hall list live on every tick, so the new hall's
     * slice appears within a minute on its own. Rewriting it from here would mean a
     * second place that composes that document — the thing `utils/rideContext.ts` was
     * extracted to prevent — for a minute's head start on a change a manager has just
     * made deliberately and is watching.
     */

    if (auditRef) {
        await auditRef.set({ outcome: 'ok', completedAt: new Date().toISOString() }, { merge: true });
    }

    return { ...preview, changed: true };
});
