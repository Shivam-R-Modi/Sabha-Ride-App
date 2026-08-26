// ============================================
// HTTP FUNCTION: updateAirportPickup
// Every state change an airport trip can go through.
// ============================================
//
// ONE CALLABLE, ONE TRANSACTION, ONE DOCUMENT.
//
// A REAL TRANSACTION, not the advisory lock globalAssignDriver uses. That function
// needs `system/assignmentLock` because it writes across many ride documents at
// once and its read-then-write of the lock is itself non-atomic — a known ceiling,
// documented there. A claim here touches exactly ONE document, so `runTransaction`
// (already used in sarthiArrived, managerInvites, nudgeRider) is both correct and
// smaller. Two Sarthis tapping Claim in the same second: one wins, the other is told
// who won.
//
// The actions live in one function rather than nine because they all do the same
// thing — read one document, check the transition table, write it back — and the
// table is what differs. Nine files would be nine copies of the transaction.

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
    isAirportCoordinatorData, isApprovedDriverData, isApprovedStudentData,
} from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { writeAuditLog, AuditAction } from '../utils/audit';
import { getTimeZone } from '../utils/settings';
import {
    PICKUPS_COLLECTION, PROFILES_COLLECTION,
    ArrivalAction, ArrivalStatus, RESULT_OF, canRun, MAX_SHORT_TEXT,
    NOTIFIABLE_FIELDS, changeSummary,
} from '../utils/arrival';
import {
    compact, parseFlight, parseTrip, parsePerson, retainUntilFor,
} from '../utils/arrivalInput';
import { notifyArrivalChanged, tokensOf } from '../utils/notifications';

const ACTIONS: ArrivalAction[] = [
    'claim', 'release', 'met', 'completed', 'no_show',
    'cancel', 'editRequest', 'familyNotified',
];

/** Which audit action each transition records. See the union for why these are split. */
const AUDIT_FOR: Record<ArrivalAction, AuditAction> = {
    claim: 'airport.claim',
    release: 'airport.release',
    met: 'airport.update',
    completed: 'airport.update',
    no_show: 'airport.update',
    editRequest: 'airport.update',
    familyNotified: 'airport.update',
    cancel: 'airport.cancel',
};

export const updateAirportPickup = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;

    // Bound to real types BEFORE they are checked. `data` is `any`, and narrowing
    // `any` with `!==` leaves it `any` — a functions deploy has already failed on
    // exactly that shape, and `action` is used to index two Records below.
    const pickupId: string = String(data?.pickupId ?? '').trim();
    if (!pickupId) {
        throw new functions.https.HttpsError('invalid-argument', 'A pickup id is required');
    }
    const rawAction: string = String(data?.action ?? '').trim();
    const action = ACTIONS.find(a => a === rawAction);
    if (!action) {
        throw new functions.https.HttpsError('invalid-argument', `Unknown action "${rawAction}"`);
    }

    // ONE read of the actor, reused by every predicate below. assertApprovedDriver
    // and friends each do their own get; three of them here would be three billed
    // reads of the same document to answer one question.
    const actorSnap = await db.collection('users').doc(uid).get();
    const actor = actorSnap.data();
    const actorName = String(actor?.name ?? 'Somebody');
    const isCoordinator = isAirportCoordinatorData(actor);
    const isDriver = isApprovedDriverData(actor);
    const isRider = isApprovedStudentData(actor);

    await checkRateLimit(uid, {
        maxRequests: 60, windowMs: 60 * 60 * 1000, functionName: 'updateAirportPickup',
    });

    const now = new Date();
    const timestamp = now.toISOString();

    // `editRequest` needs work done before the transaction: reading settings inside
    // one is legal but pointless, and it is not part of the invariant being protected.
    // The invariant is the pickup document's own status, and that is all the
    // transaction reads.
    let edit: {
        flight: ReturnType<typeof parseFlight>;
        trip: ReturnType<typeof parseTrip>;
        person: ReturnType<typeof parsePerson>;
    } | null = null;
    if (action === 'editRequest') {
        /**
         * THE SAME THREE PARSERS THE CREATE PATH USES, and that is the whole guard.
         *
         * `airportPickups` is `allow update: if false` for every client, so this
         * callable IS the trust boundary. An edit path with its own laxer validation
         * would let a traveller store, on their second attempt, a value the first
         * attempt refused — which is a trust boundary with a side door.
         */
        edit = {
            flight: parseFlight(data, await getTimeZone(), now),
            trip: parseTrip(data),
            person: parsePerson(data, now),
        };
    }

    const reason: string = String(data?.reason ?? '').trim().slice(0, MAX_SHORT_TEXT);

    const ref = db.collection(PICKUPS_COLLECTION).doc(pickupId);

    const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
            throw new functions.https.HttpsError('not-found', 'That airport request no longer exists.');
        }
        const pickup = snap.data() ?? {};
        const status: ArrivalStatus = pickup.status;

        // The transition table decides first, so every refusal below is about WHO
        // rather than about WHEN, and the message a person sees says which it was.
        if (!canRun(action, status)) {
            const who = pickup.claimedByName ? ` It is with ${pickup.claimedByName}.` : '';
            throw new functions.https.HttpsError(
                'failed-precondition',
                `That cannot be done to a request that is "${status}".${who}`,
            );
        }

        /**
         * READ BEFORE ANY WRITE. Firestore transactions refuse a read that follows a
         * write — "all reads must be executed before all writes" — so the traveller's
         * document is fetched here, alongside the pickup, rather than down beside the
         * `tx.update` that uses it. Getting that order wrong throws on EVERY completion,
         * and the fake Firestore in the tests would not have noticed.
         *
         * Only for a completion, so no other action pays for a read it does not use.
         */
        const travellerRef = action === 'completed' && pickup.requesterUid
            ? db.collection('users').doc(String(pickup.requesterUid))
            : null;
        const travellerSnap = travellerRef ? await tx.get(travellerRef) : null;

        const isMine = pickup.claimedByUid === uid;
        const isRequester = pickup.requesterUid === uid;

        /** Who to push to once this commits, if anybody. See the editRequest branch. */
        let notify: { uid: string; summary: string[] } | null = null;

        switch (action) {
            case 'claim':
                if (!isDriver) {
                    throw new functions.https.HttpsError(
                        'permission-denied', 'Only approved Sarthis can claim an airport pickup.');
                }
                // A person cannot drive themselves from the airport. The sabha side
                // enforces the mirror of this with `isHoldingAVehicle()` in the rules.
                if (isRequester) {
                    throw new functions.https.HttpsError(
                        'failed-precondition', 'You cannot claim your own arrival.');
                }
                break;

            case 'release':
            case 'met':
            case 'completed':
            case 'no_show':
            case 'familyNotified':
                if (!(isMine || isCoordinator)) {
                    throw new functions.https.HttpsError(
                        'permission-denied',
                        'Only the Sarthi who claimed this, or a coordinator, can do that.');
                }
                break;

            case 'cancel':
                if (!(isRequester || isCoordinator)) {
                    throw new functions.https.HttpsError(
                        'permission-denied',
                        'Only the traveller, or a coordinator, can cancel a request.');
                }
                if (isRequester && !isRider) {
                    throw new functions.https.HttpsError(
                        'permission-denied', 'Your account is not approved.');
                }
                break;

            case 'editRequest':
                if (!(isRequester || isMine || isCoordinator)) {
                    throw new functions.https.HttpsError(
                        'permission-denied',
                        'Only the traveller, their Sarthi, or a coordinator, can change these details.');
                }
                break;

        }

        const nextStatus = RESULT_OF[action];
        const update: Record<string, unknown> = { updatedAt: timestamp };
        if (nextStatus) update.status = nextStatus;

        switch (action) {
            case 'claim':
                update.claimedByUid = uid;
                update.claimedByName = actorName;
                update.claimedAt = timestamp;
                break;

            case 'release':
                // Back to nobody. Every trace of the previous holder goes, or the
                // board shows an unclaimed card with a Sarthi's name on it.
                update.claimedByUid = null;
                update.claimedByName = null;
                update.claimedAt = null;
                update.metAt = null;
                // Cleared because a release out of a no_show puts the trip back in front
                // of somebody. Left set, the card would say both "nobody yet" and
                // "nobody turned up" — the second being about a Sarthi who has gone.
                update.noShowAt = null;
                if (reason) update.releaseReason = reason;
                /**
                 * AND THE ALARM IS REARMED.
                 *
                 * `alertsSent` records which urgency bands have already fired, and
                 * `alertUnclaimedArrivals` skips any band it finds stamped. Time only
                 * decreases, so that is a sufficient record for a trip that stays
                 * open — but a trip that was open, claimed, and then handed back has
                 * a stamp from a band it is now PAST, and the job would stay silent
                 * for the rest of the trip's life.
                 *
                 * Which is the one case that most needs it: a hand-back the night
                 * before a landing is exactly when nobody is watching the board.
                 */
                update.alertsSent = null;
                break;

            case 'met':
                update.metAt = timestamp;
                // The warning has done its job — they have the person. Left standing it
                // would follow the trip to the end and decay into wallpaper, which is
                // how a loud signal stops being one.
                update.changedAt = null;
                update.changedFields = null;
                break;

            case 'completed':
                update.completedAt = timestamp;
                break;

            case 'no_show':
                update.noShowAt = timestamp;
                break;

            case 'familyNotified':
                update.familyNotifiedAt = timestamp;
                break;

            case 'cancel':
                update.cancelledAt = timestamp;
                update.cancelledBy = uid;
                update.cancellationReason = reason || null;
                break;

            case 'editRequest': {
                const { flight, trip, person } = edit!;
                const passenger = compact({
                    name: person.fullName,
                    dateOfBirth: person.dateOfBirth,
                    phone: person.phone,
                    altPhone: person.altPhone,
                    whatsappOn: person.whatsappOn,
                    email: person.email,
                    familyContact: person.familyContact,
                });
                Object.assign(update, compact({ ...flight, ...trip }), { passenger });
                update.retainUntil = retainUntilFor(flight.arrivalAt);

                /**
                 * WHAT ACTUALLY CHANGED, DIFFED AGAINST THE STORED DOCUMENT.
                 *
                 * Not "they pressed save" — a traveller who opens the form, changes a
                 * note and saves must not put a red warning on a Sarthi's card. Only
                 * the fields in NOTIFIABLE_FIELDS are compared, and only a real
                 * difference counts.
                 *
                 * Only while somebody is driving to meet it, too. A change to an
                 * unclaimed request is news to nobody.
                 */
                if (status === 'claimed') {
                    const before: Record<string, unknown> = {
                        ...pickup,
                        'passenger.phone': pickup.passenger?.phone,
                    };
                    const after: Record<string, unknown> = {
                        ...pickup, ...update, passenger,
                        'passenger.phone': passenger.phone,
                    };
                    const changed = Object.keys(NOTIFIABLE_FIELDS)
                        .filter(key => (before[key] ?? null) !== (after[key] ?? null));
                    if (changed.length > 0) {
                        update.changedAt = timestamp;
                        update.changedFields = changed;
                        // Carried out on the outcome rather than assigned to an outer
                        // `let`: TypeScript does not narrow a variable written inside a
                        // callback, so the push site would have seen `never`.
                        notify = {
                            uid: String(pickup.claimedByUid ?? ''),
                            summary: changeSummary(changed),
                        };
                    }
                }
                break;
            }
        }

        tx.update(ref, update);

        /**
         * THE LONG-LIVED RECORD MOVES WITH THE TRIP.
         *
         * `requestAirportPickup` writes the person to `airportProfiles` as well as to
         * the pickup, so an edit that changed only the pickup would leave a traveller
         * whose profile still holds last month's phone number — and that profile is
         * what the Airport export reads and what their next trip is seeded from.
         *
         * MERGE, and `compact` strips the blanks, so a field the edit form does not
         * show (a university, a preferred name) survives untouched rather than being
         * overwritten with nothing. That is the same reason the create path merges.
         */
        if (action === 'editRequest') {
            tx.set(
                db.collection(PROFILES_COLLECTION).doc(String(pickup.requesterUid)),
                compact({ ...edit!.person, updatedAt: timestamp }),
                { merge: true },
            );
        }

        /**
         * THEY HAVE ARRIVED, SO THEY ARE NOT ARRIVING ANY MORE.
         *
         * Dropping somebody off is the moment a traveller becomes a local member, so it
         * is the moment their app should stop being the newcomer's one screen and start
         * being Sabha Seva. Doing it here rather than asking them to notice a setting is
         * the difference between a service that hands over and one that leaves people
         * stranded in the wrong app.
         *
         * `isArriving` is only ever CLEARED here, never set, so this cannot promote
         * anybody into a service they should not have — and it is not a privilege field,
         * see the note in types.ts.
         *
         * AND their home address, but ONLY IF THEY HAVE NONE. The trip's destination came
         * from the same AddressAutocomplete that ProfileSetup uses, so it is already
         * geocoded and already the shape `resolveHomeCoords` reads — which means their
         * first sabha ride works with no extra typing. Guarded on absence because a
         * returning local already has an address, and a trip destination might be a
         * friend's sofa for the first week; overwriting a real home with that would send
         * a Sarthi to the wrong door every Friday.
         *
         * Inside the transaction, so it lands with the completion or not at all. A
         * traveller marked delivered who is still stuck in the newcomer app is exactly
         * the half-done state this avoids.
         */
        if (travellerRef) {
            const traveller = travellerSnap?.data();
            const graduation: Record<string, unknown> = { isArriving: false };

            const hasAddress = typeof traveller?.address === 'string'
                && traveller.address.trim().length > 0;
            const lat = Number(pickup.dropoffLat);
            const lng = Number(pickup.dropoffLng);
            // 0,0 is the "never geocoded" placeholder resolveHomeCoords rejects; seeding
            // it would put a Sarthi in the Atlantic.
            const usableDestination = Number.isFinite(lat) && Number.isFinite(lng)
                && !(lat === 0 && lng === 0);

            if (!hasAddress && usableDestination && pickup.dropoffAddress) {
                graduation.address = String(pickup.dropoffAddress);
                graduation.location = {
                    latitude: lat,
                    longitude: lng,
                    formattedAddress: String(pickup.dropoffAddress),
                    // Says where this came from, because it was not typed on the profile
                    // screen and somebody looking at the record later will wonder.
                    seededFromPickupId: pickupId,
                };
            }

            // `update`, not a `set` merge: the document is guaranteed to exist — they
            // filed the request — and a merge would quietly create a ghost user document
            // if the id were ever wrong, which is harder to notice than a failure.
            tx.update(travellerRef, graduation);
        }

        return {
            previousStatus: status,
            nextStatus: nextStatus ?? status,
            requesterName: String(pickup.requesterName ?? 'a traveller'),
            previousHolder: pickup.claimedByName ? String(pickup.claimedByName) : null,
            notify,
        };
    });

    /**
     * AFTER THE COMMIT, and only then.
     *
     * Inside the transaction a retry would send the push twice, and a push cannot be
     * rolled back. `sendNotification` never throws, so a Sarthi with no token — which
     * is nearly all of them — costs nothing and changes nothing.
     */
    const notify = outcome.notify;
    if (notify?.uid) {
        const sarthiSnap = await db.collection('users').doc(notify.uid).get();
        await notifyArrivalChanged(
            tokensOf(notify.uid, sarthiSnap.data()), notify.summary, pickupId);
    }

    // AFTER the commit, so a row is never written for a transition that lost the
    // race. writeAuditLog never throws, so losing the row cannot undo the change.
    await writeAuditLog(db, {
        action: AUDIT_FOR[action],
        actorUid: uid,
        actorName,
        targetCollection: PICKUPS_COLLECTION,
        targetDocumentId: pickupId,
        summary: `${action} on ${outcome.requesterName}'s airport pickup`
            + ` (${outcome.previousStatus} → ${outcome.nextStatus})`,
        details: compact({
            action,
            previousStatus: outcome.previousStatus,
            nextStatus: outcome.nextStatus,
            previousHolder: outcome.previousHolder,
            reason: reason || undefined,
            newArrivalAt: edit?.flight.arrivalAt,
        }),
    });

    return { success: true, status: outcome.nextStatus };
});
