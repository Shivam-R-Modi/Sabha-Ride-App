// ============================================
// HTTP FUNCTION: deleteSabhaEvent
//
// Removing a gathering is not a one-document delete. Three things hang off a
// gathering's date, and Firestore will clean up none of them:
//
//  - `weeklyAttendance/{date}/responses/*` — a SUBCOLLECTION, which survives its
//    parent being deleted. Every read path for it derives the id from
//    system/rideContext, so once the event is gone the data is unreachable rather
//    than merely untidy: names, phone numbers and home addresses left in
//    Firestore with no screen that could ever show them again.
//  - outstanding `rides` with `status: 'requested'` — globalAssignDriver queries
//    that status with NO date filter, so leaving them means the next sabha
//    inherits requests for a gathering that no longer exists.
//  - `system/rideContext`, which is only recomputed once a minute. For up to 60
//    seconds it would name a deleted document, and in that window a student could
//    re-create the very attendance response this function just deleted.
//
// firestore.rules therefore denies event deletion to everyone, including managers,
// and this is the only path.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { DEFAULT_TIME_ZONE, zonedDateKey } from '../utils/time';
import { resolveCurrentEvent, EVENTS_COLLECTION, SEED_MARKER_DOC } from '../utils/events';
import { getRequestsOpenTime, locationsOrFoundingFallback } from '../utils/settings';
import { buildRideContextDoc, hallContexts } from '../utils/rideContext';
import {
    eventIdFor, locationOfRide, LOCATION_ID_PATTERN, type SabhaLocationRecord,
} from '../utils/locations';
import { sendNotification, tokensOf } from '../utils/notifications';
import { checkRateLimit } from '../utils/rateLimiter';
import { assertApprovedManager } from '../utils/authz';
import { FOUNDING_LOCATION_ID } from '../constants/tenancy';
import { writeAuditLog } from '../utils/audit';
// No cycle: sabhaRecurrence imports only pure helpers and authz/audit.
import { readRecurrence } from './sabhaRecurrence';
import { effectiveEventFor, normaliseException } from '../utils/recurrence';

const CONTEXT_DOC = 'system/rideContext';

/** Ride states that mean a driver is already on the road for this gathering. */
const IN_FLIGHT_STATUSES = ['assigned', 'driver_en_route', 'arriving', 'in_progress'];

interface DeletePreview {
    date: string;
    /**
     * The hall this cancels, or null for the whole evening.
     *
     * Echoed back so the confirmation dialog can name what it is about to do. A dialog
     * that says "cancel the sabha on the 21st" when the manager picked one room is how
     * somebody cancels both by accident.
     */
    locationId: string | null;
    /** The hall's name, for the same reason. Null for the whole evening. */
    locationName: string | null;
    /** People who said yes or no for this gathering. */
    responseCount: number;
    /** Ride requests that would be cancelled. */
    requestedRideCount: number;
    /** True when this is the gathering the app is currently pointing at. */
    isCurrentEvent: boolean;
}

/**
 * The event id `system/rideContext` currently names FOR ONE HALL.
 *
 * Reads that hall's own slice, falling back to the top level when `byLocation` is
 * absent — the first minute after the per-hall context deploys, and the founding hall
 * only. A second hall has no honest answer from the aggregate, so it gets null.
 */
function eventIdOfSlice(
    published: Record<string, unknown> | undefined,
    locationId: string | null,
): string | null {
    if (!published) return null;
    const byLocation = published.byLocation as Record<string, { eventId?: unknown }> | undefined;
    const key = locationId ?? FOUNDING_LOCATION_ID;
    const slice = byLocation?.[key];
    if (slice) return typeof slice.eventId === 'string' ? slice.eventId : null;
    if (key !== FOUNDING_LOCATION_ID) return null;
    return typeof published.eventId === 'string' ? published.eventId : null;
}

export const deleteSabhaEvent = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;

    const caller = await assertApprovedManager(db, uid, 'delete a sabha');

    const date: unknown = data?.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new functions.https.HttpsError('invalid-argument', 'A sabha date is required.');
    }

    /**
     * WHICH HALL, or the whole evening.
     *
     * The client sends a hall id, never a composed event id: the id shape is this
     * function's business and validating a bare date plus a bare hall is a tighter
     * boundary than parsing a suffixed string back apart. `eventIdFor` composes it,
     * and it returns null for a hall id that does not match the pattern — so a bad
     * one cannot reach a document path.
     */
    const rawLocation: unknown = data?.locationId;
    if (rawLocation !== undefined && rawLocation !== null
        && (typeof rawLocation !== 'string' || !LOCATION_ID_PATTERN.test(rawLocation))) {
        throw new functions.https.HttpsError('invalid-argument', 'That sabha location is not valid.');
    }
    const locationId: string | null = typeof rawLocation === 'string' ? rawLocation : null;

    const dryRun = data?.dryRun === true;

    // Rate limit the real deletions only — the preview runs on every dialog open.
    if (!dryRun) {
        await checkRateLimit(uid, {
            maxRequests: 20,
            windowMs: 60 * 1000,
            functionName: 'deleteSabhaEvent',
        });
    }

    const settingsSnap = await db.collection('settings').doc('main').get();
    const timeZone = settingsSnap.data()?.timeZone || DEFAULT_TIME_ZONE;
    const now = new Date();
    const today = zonedDateKey(now, timeZone);

    // ── Is this date actually on the calendar? ──────────────────────────
    //
    // This used to be `if (!eventSnap.exists) throw`, which assumed a gathering IS
    // a document. Under the rule model most of them are not: a weekly sabha is
    // computed from `settings/sabhaRecurrence`, and only divergences are stored.
    //
    // So the trash icon failed on every rule-derived row — nine of the ten on the
    // manager's calendar — with "That sabha is no longer on the calendar" for a
    // sabha plainly listed on it. A visible control that cannot work, which is the
    // one failure this codebase keeps removing. I introduced it when deletion
    // became a cancellation and this guard was left asking the old question.
    //
    // `effectiveEvent` is the single answer to "is there a gathering here", and it
    // already handles all three ways there can be none: cancelled, inert
    // off-pattern override, or simply not covered by the rule.
    // The halls come first: the hall named has to exist and be open before anything
    // else is read, and the whole-evening path needs them to rebuild the context.
    const halls = await locationsOrFoundingFallback(db);
    const hall: SabhaLocationRecord | null = locationId
        ? halls.find(h => h.id === locationId) ?? null
        : null;
    if (locationId && !hall) {
        // Loud, not a silent widening to the whole evening. A stale tab whose hall a
        // manager has since retired must not turn one tap into cancelling both rooms.
        throw new functions.https.HttpsError('not-found', 'That sabha location is not open.');
    }

    /**
     * The document being cancelled. `events/{date}` for the whole evening,
     * `events/{date}__{hall}` for one room — and the bare date for the FOUNDING hall
     * either way, which is the migration: its history never moves.
     *
     * So naming the founding hall explicitly and naming no hall write the same
     * document. That is correct rather than a collision — with one hall open there is
     * no difference between "cancel this hall" and "cancel the evening", and the
     * client only offers the choice when there is more than one.
     */
    const eventId = eventIdFor(date, locationId ?? FOUNDING_LOCATION_ID);
    if (!eventId) {
        throw new functions.https.HttpsError('invalid-argument', 'That sabha location is not valid.');
    }

    const eventRef = db.collection(EVENTS_COLLECTION).doc(eventId);
    const rule = await readRecurrence(db);

    // TWO DOCUMENTS, TWO LAYERS. A hall's own exception does not replace the evening's
    // — it sits on top of it — so cancelling one hall has to read both to know whether
    // there is anything there to cancel. Reading only the hall's document would report
    // "not on the calendar" for a hall running on the rule with no document of its own,
    // which is every hall on almost every evening.
    const [eventSnap, dateSnap] = await Promise.all([
        eventRef.get(),
        eventId === date ? Promise.resolve(null) : db.collection(EVENTS_COLLECTION).doc(date).get(),
    ]);
    const existing = normaliseException(eventSnap.data());
    const dateException = dateSnap ? normaliseException(dateSnap.data()) : existing;
    const hallException = eventId === date ? null : existing;

    if (!effectiveEventFor(date, rule, dateException, hallException)) {
        throw new functions.https.HttpsError(
            'not-found',
            existing?.status === 'cancelled'
                ? 'That sabha is already cancelled.'
                : 'That sabha is not on the calendar.',
        );
    }

    // ── Guard: the past is history ──────────────────────────────────────
    // Completed rides, attendance and statistics all reference it, and deleting
    // it would orphan them with no way to tell what happened. This also removes
    // the ambiguity that today IS a weekly slot date.
    if (date <= today) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            date === today
                ? 'Today\'s sabha cannot be deleted. Change its time instead, or wait until tomorrow.'
                : 'A sabha that has already happened cannot be deleted.',
        );
    }

    // ── Guard: nobody is mid-route ──────────────────────────────────────
    //
    // ONE `where`, on a field every ride carries, then the hall filtered IN MEMORY.
    // Adding `where('locationId', '==', …)` would be the shorter query and the wrong
    // one: no index carries that field, and an equality filter on a field a document
    // may not have returns EMPTY rather than erroring — so a hall with rides in flight
    // would read as "nobody is mid-route" and the cancellation would go through under
    // a driver already on the road.
    const ridesForDate = await db.collection('rides')
        .where('eventDate', '==', date)
        .get();

    // A ride that names no hall at all counts for BOTH scopes. It cannot be dispatched
    // (isValidPendingRide refuses it), but it is somebody's request and it must not
    // survive the evening being cancelled just because a field is missing.
    const inScope = ridesForDate.docs.filter(d => {
        if (!locationId) return true;
        const of = locationOfRide(d.data());
        return of === null || of === locationId;
    });

    const inFlight = inScope.filter(d =>
        IN_FLIGHT_STATUSES.includes(d.data()?.status));

    if (inFlight.length > 0) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            `${inFlight.length} ride${inFlight.length === 1 ? '' : 's'} already assigned for this sabha. Release them first.`,
        );
    }

    const requestedRides = inScope.filter(d => d.data()?.status === 'requested');

    // Attendance is keyed by EVENT id, so this is already per hall.
    const responsesSnap = await db
        .collection('weeklyAttendance').doc(eventId)
        .collection('responses').get();

    const currentContext = (await db.doc(CONTEXT_DOC).get()).data();
    const preview: DeletePreview = {
        date,
        locationId,
        locationName: hall?.name ?? null,
        responseCount: responsesSnap.size,
        requestedRideCount: requestedRides.length,
        // PER HALL, read from that hall's own slice. Against the top level this would
        // say false for a second hall's gathering — and `isCurrentEvent` is what
        // decides whether rideContext gets rewritten in the same commit, so a false
        // here leaves the document naming a sabha that was just cancelled until the
        // next minute tick, with the request window still open.
        isCurrentEvent: eventIdOfSlice(currentContext, locationId) === eventId,
    };

    if (dryRun) return preview;

    // ── Enforced acknowledgement ────────────────────────────────────────
    // Server-side, not client-side. A guard whose failure mode is "silently do
    // nothing" is how the cancel button died: window.confirm returned false when
    // suppressed and the handler just bailed.
    const affectsPeople = preview.responseCount > 0 || preview.requestedRideCount > 0;
    if (affectsPeople && data?.acknowledge !== true) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'This sabha has responses or ride requests. Confirm the deletion to continue.',
        );
    }

    // Gather who to tell BEFORE anything is deleted.
    const affectedUids = new Set<string>();
    responsesSnap.docs.forEach(d => affectedUids.add(d.id));
    requestedRides.forEach(d => {
        const studentId = d.data()?.studentId;
        if (typeof studentId === 'string') affectedUids.add(studentId);
    });

    // Written BEFORE the destructive batch and closed after, so a crash leaves a
    // row saying an attempt was made. It used to use its own field names —
    // `performedAt` where every other writer said `timestamp` — and the console
    // orders by `timestamp`, so Firestore excluded these rows entirely: deleting
    // a sabha was the one action the audit screen could never show.
    const auditRef = await writeAuditLog(db, {
        action: 'event.delete',
        actorUid: uid,
        actorName: String(caller.name || 'Manager'),
        targetCollection: EVENTS_COLLECTION,
        targetDocumentId: eventId,
        summary: `Deleted the sabha on ${date}`
            + (hall ? ` at ${hall.name}` : '')
            + (preview.responseCount || preview.requestedRideCount
                ? ` — ${preview.responseCount} attending, ${preview.requestedRideCount} ride request(s) cancelled`
                : ' — nobody had responded'),
        details: {
            locationId,
            responseCount: preview.responseCount,
            requestedRideIds: requestedRides.map(d => d.id),
            wasCurrentEvent: preview.isCurrentEvent,
        },
        outcome: 'pending',
    });

    // ── One batch: everything that must be all-or-nothing ───────────────
    const batch = db.batch();

    // A CANCELLATION EXCEPTION, not a delete.
    //
    // Under the rule model the schedule is `settings/sabhaRecurrence`, so deleting
    // this document would not remove the gathering — the rule would simply place it
    // again, and the manager's cancellation would evaporate on the next tick. The
    // document IS the cancellation, and it persists by existing.
    //
    // That also retires the old high-water mark: there is nothing left to
    // "remember not to regenerate".
    batch.set(eventRef, {
        date,
        // Stamped so `events` is readable without parsing document ids, and so the
        // backfill in scripts/locations.cjs has something to verify against.
        locationId: locationId ?? FOUNDING_LOCATION_ID,
        // Preserved where there was one. It makes little difference — a
        // cancellation short-circuits `effectiveEvent` before `kind` is consulted —
        // but a one-off that comes back via "Add a sabha" then reads consistently.
        kind: existing?.kind ?? 'override',
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancelledBy: uid,
    }, { merge: true });

    // Cancelled, not deleted: the rider keeps a visible record and an explanation,
    // and `status: 'cancelled'` is what takes them out of globalAssignDriver's
    // `status == 'requested'` pool.
    requestedRides.forEach(d => {
        batch.update(d.ref, {
            status: 'cancelled',
            cancelledReason: 'sabha-deleted',
            cancelledAt: new Date().toISOString(),
        });
    });

    // recursiveDelete cannot join a batch, so park the date and let the
    // per-minute job finish the job if this process dies before step two.
    // THE EVENT ID, not the date — `weeklyAttendance` is keyed by event id, so parking
    // the bare date would have the sweeper recursively delete the FOUNDING hall's
    // attendance when the manager cancelled a different room.
    batch.set(db.doc(SEED_MARKER_DOC), {
        pendingAttendanceDeletes: admin.firestore.FieldValue.arrayUnion(eventId),
    }, { merge: true });

    // Recompute the window in the same commit when this was the current
    // gathering, so rideContext never names a document that no longer exists.
    if (preview.isCurrentEvent) {
        /**
         * THE WHOLE DOCUMENT, through the same builder the scheduler uses.
         *
         * This used to be a partial `set` of the top-level fields, which erased
         * `byLocation` and `locationIds` until the next minute tick. A client reading
         * its own hall's slice then fell back to the aggregate — so for up to a minute
         * every hall showed the founding hall's window, and a client that had learned
         * to expect `locationIds` could no longer tell "my hall is closed" from "my
         * hall is not described here".
         *
         * `pendingCancellation` is what makes this correct for one hall: the batch has
         * not committed, so the resolver would otherwise still read this evening as
         * open. Telling it what is about to be cancelled also answers the per-hall case
         * the old find-then-look-after-it helper could not — the evening may still be
         * on for another room, in which case nothing rolls forward and only this hall's
         * slice goes quiet.
         */
        const { event: nextEvent, hallExceptions } = await resolveCurrentEvent(
            db, now, timeZone, rule, halls.map(h => h.id), eventId,
        );
        const contexts = hallContexts(
            nextEvent, halls.map(h => ({ id: h.id, venue: h.venue })),
            now, timeZone, await getRequestsOpenTime(), hallExceptions,
        );

        batch.set(db.doc(CONTEXT_DOC), buildRideContextDoc(contexts, now));
    }

    await batch.commit();

    // ── Step two: the cascade, then tell people ─────────────────────────
    await drainAttendanceDelete(db, eventId);

    if (affectedUids.size > 0) {
        await notifyAffected(db, Array.from(affectedUids), date, hall?.name ?? null);
    }

    // writeAuditLog swallows its own failures and returns null, so the close is
    // conditional. An unclosed row reads as 'pending', which is the honest answer.
    if (auditRef) {
        await auditRef.set({ outcome: 'ok', completedAt: new Date().toISOString() }, { merge: true });
    }

    return { ...preview, deleted: true };
});

/**
 * Delete `weeklyAttendance/{eventId}` and its responses, then clear the pending mark.
 *
 * AN EVENT ID, NOT A DATE, and the parameter is named for it. `weeklyAttendance` is
 * keyed by event id — a bare date for the founding hall, `{date}__{hall}` for any
 * other — so passing a date here would recursively delete the FOUNDING hall's
 * attendance records when a manager had cancelled a different room. Children's names,
 * phone numbers and addresses, for the wrong sabha, unrecoverable.
 *
 * Exported so the per-minute job can finish a cascade this process did not.
 */
export async function drainAttendanceDelete(
    db: admin.firestore.Firestore,
    eventId: string,
): Promise<void> {
    try {
        await db.recursiveDelete(db.collection('weeklyAttendance').doc(eventId));
        await db.doc(SEED_MARKER_DOC).set({
            pendingAttendanceDeletes: admin.firestore.FieldValue.arrayRemove(eventId),
        }, { merge: true });
    } catch (error) {
        // Leave it parked; the sweeper retries. Do NOT rethrow — the event
        // is already gone and the caller must not see a failure for work that will
        // complete on its own.
        console.error(`[deleteSabhaEvent] Attendance cascade for ${eventId} failed, left pending:`, error);
    }
}

/** Tell the people who said yes, or who had asked for a ride. */
async function notifyAffected(
    db: admin.firestore.Firestore,
    uids: string[],
    date: string,
    /** Named when one hall was cancelled, so a rider knows which sabha is off. */
    locationName: string | null,
): Promise<void> {
    try {
        const recipients = [];
        for (const uid of uids) {
            const snap = await db.collection('users').doc(uid).get();
            recipients.push(...tokensOf(uid, snap.data()));
        }

        if (recipients.length === 0) return;

        const [year, month, day] = date.split('-').map(Number);
        const label = new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
        }).format(new Date(Date.UTC(year, month - 1, day, 12)));

        await sendNotification(
            recipients,
            'Sabha cancelled',
            // NAMES THE HALL when only one was cancelled, because otherwise this push
            // tells a rider the sabha is off when the other room is still meeting —
            // and the correction is a phone call somebody has to make.
            locationName
                ? `The sabha at ${locationName} on ${label} is no longer scheduled. `
                    + 'Your ride request has been cancelled.'
                : `The sabha on ${label} is no longer scheduled. Your ride request has been cancelled.`,
            // Tagged so the manager panel can name it. Muting it is behind a
            // confirmation: people who are not told wait outside for a ride.
            { type: 'sabha-deleted', reason: 'sabha-deleted', eventId: date },
        );
    } catch (error) {
        console.error('[deleteSabhaEvent] Could not notify affected riders:', error);
    }
}
