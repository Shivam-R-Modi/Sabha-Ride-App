// ============================================
// HTTP FUNCTION: requestAirportPickup
// Somebody landing in the USA asks to be collected.
// ============================================
//
// A CALLABLE RATHER THAN A CLIENT WRITE, for two reasons that both matter.
//
// It writes TWO documents — the trip and the traveller's durable record — and the
// rules comments on `events`, `notices` and `weeklyAttendance` all say the same
// thing: anything touching a second document goes through a function.
//
// And it has to turn a wall-clock arrival time into an absolute instant, in the
// AIRPORT'S timezone. No client in this app computes an hour; deriving one from a
// UTC server clock or a device clock is the entire class of bug that broke drop-off
// rides every Friday (functions/src/utils/time.ts).

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedStudent } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { writeAuditLog } from '../utils/audit';
import { getTimeZone } from '../utils/settings';
import { FOUNDING_CITY_ID, FOUNDING_LOCATION_ID } from '../constants/tenancy';
import {
    PICKUPS_COLLECTION, PROFILES_COLLECTION, ArrivalStatus, airportLabel,
} from '../utils/arrival';
import {
    compact, parseFlight, parsePerson, parseTrip, retainUntilFor,
} from '../utils/arrivalInput';

/**
 * A traveller may have one live request at a time.
 *
 * Same reasoning as the duplicate guard in `createRideRequest` (hooks/useRides.ts):
 * two open requests for one person means two Sarthis driving to the same terminal
 * for the same passenger, and the second one finds nobody there.
 *
 * 'no_show' is deliberately NOT here. Somebody who was missed needs to be able to
 * ask again from the airport, immediately.
 */
const LIVE_STATUSES: ArrivalStatus[] = ['open', 'claimed', 'met'];

export const requestAirportPickup = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const requester = await assertApprovedStudent(db, uid, 'request an airport pickup');

    const now = new Date();
    const congregationZone = await getTimeZone();

    const flight = parseFlight(data, congregationZone, now);
    const trip = parseTrip(data);
    const person = parsePerson(data, now);

    // AFTER authorisation, deliberately, the same ordering as generateEventCSV: a
    // stranger probing this endpoint is refused for the right reason and never
    // consumes a legitimate traveller's budget. Generous, because filing a request
    // for a family of four is one call and correcting a typo is another.
    await checkRateLimit(uid, {
        maxRequests: 10, windowMs: 60 * 60 * 1000, functionName: 'requestAirportPickup',
    });

    // ONE FIELD in the query, then filtered in memory. The deliberate house pattern
    // (studentReadyToLeave, manualAssignStudent): a `status in [...]` clause here
    // would need a composite index that does not exist, and an index missing at
    // runtime fails as an empty result rather than an error — which would silently
    // turn this guard off.
    const mine = await db.collection(PICKUPS_COLLECTION)
        .where('requesterUid', '==', uid)
        .get();
    const live = mine.docs.find(d => LIVE_STATUSES.includes(d.data()?.status));
    if (live) {
        throw new functions.https.HttpsError(
            'already-exists',
            'You already have an airport pickup request open. Edit or cancel that one first.',
        );
    }

    const requesterName = person.preferredName || person.fullName;
    const timestamp = now.toISOString();
    const retainUntil = retainUntilFor(flight.arrivalAt);

    const auditRef = await writeAuditLog(db, {
        action: 'airport.request',
        actorUid: uid,
        actorName: String(requester.name ?? requesterName),
        targetCollection: PICKUPS_COLLECTION,
        targetDocumentId: 'new',
        summary: `Asked to be collected from ${airportLabel(flight.airportCode)}`
            + ` on ${flight.arrivalDate} at ${flight.arrivalTime}`,
        details: {
            airportCode: flight.airportCode,
            arrivalAt: flight.arrivalAt,
            partySize: trip.partySize,
        },
        outcome: 'pending',
    });

    const pickupRef = db.collection(PICKUPS_COLLECTION).doc();
    const profileRef = db.collection(PROFILES_COLLECTION).doc(uid);

    // Read before the merge so `createdAt` is written ONCE. A merge that includes it
    // every time overwrites the first-seen date on every subsequent trip, which
    // makes the field a lie and the Airport export unsortable by it.
    const existingProfile = await profileRef.get();

    const batch = db.batch();

    batch.set(pickupRef, compact({
        cityId: FOUNDING_CITY_ID,
        locationId: FOUNDING_LOCATION_ID,
        requesterUid: uid,
        requesterName,
        ...flight,
        ...trip,
        // The snapshot the Sarthi's card reads, so a Sarthi never needs permission on
        // airportProfiles — which is where the date of birth and the family contact
        // live for every traveller, past trips included.
        passenger: compact({
            name: person.fullName,
            dateOfBirth: person.dateOfBirth,
            phone: person.phone,
            altPhone: person.altPhone,
            whatsappOn: person.whatsappOn,
            email: person.email,
            familyContact: person.familyContact,
        }),
        status: 'open' as ArrivalStatus,
        claimedByUid: null,
        claimedByName: null,
        claimedAt: null,
        metAt: null,
        completedAt: null,
        familyNotifiedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        changedAt: null,
        changedFields: null,
        retainUntil,
        createdAt: timestamp,
        updatedAt: timestamp,
    }));

    // MERGE, not set: this record outlives any one trip, and a second request must
    // not wipe a university or a referrer the traveller filled in the first time and
    // left blank the second.
    batch.set(profileRef, compact({
        cityId: FOUNDING_CITY_ID,
        locationId: FOUNDING_LOCATION_ID,
        uid,
        ...person,
        retainUntil,
        updatedAt: timestamp,
        createdAt: existingProfile.exists ? undefined : timestamp,
    }), { merge: true });

    await batch.commit();

    if (auditRef) {
        await auditRef.set(
            { outcome: 'ok', targetDocumentId: pickupRef.id, completedAt: new Date().toISOString() },
            { merge: true },
        );
    }

    return { success: true, pickupId: pickupRef.id, arrivalAt: flight.arrivalAt };
});
