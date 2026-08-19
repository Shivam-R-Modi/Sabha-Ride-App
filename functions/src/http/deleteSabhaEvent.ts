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
import { findCurrentEvent, EVENTS_COLLECTION, SEED_MARKER_DOC } from '../utils/events';
import { buildCurrentEvent, resolveScheduleWindow } from '../utils/schedule';
import { sendNotification, tokensOf } from '../utils/notifications';
import { checkRateLimit } from '../utils/rateLimiter';
import { assertApprovedManager } from '../utils/authz';
import { writeAuditLog } from '../utils/audit';
// No cycle: sabhaRecurrence imports only pure helpers and authz/audit.
import { readRecurrence } from './sabhaRecurrence';
import { effectiveEvent, normaliseException } from '../utils/recurrence';

const CONTEXT_DOC = 'system/rideContext';

/** Ride states that mean a driver is already on the road for this gathering. */
const IN_FLIGHT_STATUSES = ['assigned', 'driver_en_route', 'arriving', 'in_progress'];

interface DeletePreview {
    date: string;
    /** People who said yes or no for this gathering. */
    responseCount: number;
    /** Ride requests that would be cancelled. */
    requestedRideCount: number;
    /** True when this is the gathering the app is currently pointing at. */
    isCurrentEvent: boolean;
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
    const eventRef = db.collection(EVENTS_COLLECTION).doc(date);
    const eventSnap = await eventRef.get();
    const existing = normaliseException(eventSnap.data());
    const rule = await readRecurrence(db);

    if (!effectiveEvent(date, rule, existing)) {
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
    const ridesForDate = await db.collection('rides')
        .where('eventDate', '==', date)
        .get();

    const inFlight = ridesForDate.docs.filter(d =>
        IN_FLIGHT_STATUSES.includes(d.data()?.status));

    if (inFlight.length > 0) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            `${inFlight.length} ride${inFlight.length === 1 ? '' : 's'} already assigned for this sabha. Release them first.`,
        );
    }

    const requestedRides = ridesForDate.docs.filter(d => d.data()?.status === 'requested');

    const responsesSnap = await db
        .collection('weeklyAttendance').doc(date)
        .collection('responses').get();

    const currentContext = (await db.doc(CONTEXT_DOC).get()).data();
    const preview: DeletePreview = {
        date,
        responseCount: responsesSnap.size,
        requestedRideCount: requestedRides.length,
        isCurrentEvent: currentContext?.eventId === date,
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
        targetDocumentId: date,
        summary: `Deleted the sabha on ${date}`
            + (preview.responseCount || preview.requestedRideCount
                ? ` — ${preview.responseCount} attending, ${preview.requestedRideCount} ride request(s) cancelled`
                : ' — nobody had responded'),
        details: {
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
    batch.set(db.doc(SEED_MARKER_DOC), {
        pendingAttendanceDeletes: admin.firestore.FieldValue.arrayUnion(date),
    }, { merge: true });

    // Recompute the window in the same commit when this was the current
    // gathering, so rideContext never names a document that no longer exists.
    if (preview.isCurrentEvent) {
        const nextEvent = await findNextEventExcluding(db, now, timeZone, date);
        const built = nextEvent
            ? buildCurrentEvent(nextEvent.date, nextEvent.startTime, nextEvent.endTime, timeZone, {
                venue: nextEvent.venue,
                agenda: nextEvent.agenda,
            })
            : null;
        const window = resolveScheduleWindow(now, built, timeZone);

        batch.set(db.doc(CONTEXT_DOC), {
            ...window,
            ...(built ?? { eventId: null }),
            calendarStatus: built ? 'ok' : 'no-scheduled-event',
            overrideUntil: null,
            lastUpdated: now.toISOString(),
        });
    }

    await batch.commit();

    // ── Step two: the cascade, then tell people ─────────────────────────
    await drainAttendanceDelete(db, date);

    if (affectedUids.size > 0) {
        await notifyAffected(db, Array.from(affectedUids), date);
    }

    // writeAuditLog swallows its own failures and returns null, so the close is
    // conditional. An unclosed row reads as 'pending', which is the honest answer.
    if (auditRef) {
        await auditRef.set({ outcome: 'ok', completedAt: new Date().toISOString() }, { merge: true });
    }

    return { ...preview, deleted: true };
});

/**
 * The gathering that becomes current once `excluded` is gone.
 *
 * findCurrentEvent still sees the doc being deleted — it is deleted in the batch
 * we are building — so it has to be skipped explicitly.
 */
async function findNextEventExcluding(
    db: admin.firestore.Firestore,
    now: Date,
    timeZone: string,
    excluded: string,
) {
    // The rule has to come along. Without it this reads the exceptions alone,
    // which under the rule model is almost always empty — so it would report "no
    // sabha scheduled" to a manager cancelling one week out of a standing weekly
    // schedule.
    const rule = await readRecurrence(db);

    const found = await findCurrentEvent(db, now, timeZone, rule);
    if (found && found.date !== excluded) return found;

    // The excluded one was first. Look again from the day after it.
    const after = new Date(new Date(`${excluded}T12:00:00Z`).getTime() + 24 * 3600 * 1000);
    return findCurrentEvent(db, after, timeZone, rule);
}

/**
 * Delete `weeklyAttendance/{date}` and its responses, then clear the pending mark.
 *
 * Exported so the per-minute job can finish a cascade this process did not.
 */
export async function drainAttendanceDelete(
    db: admin.firestore.Firestore,
    date: string,
): Promise<void> {
    try {
        await db.recursiveDelete(db.collection('weeklyAttendance').doc(date));
        await db.doc(SEED_MARKER_DOC).set({
            pendingAttendanceDeletes: admin.firestore.FieldValue.arrayRemove(date),
        }, { merge: true });
    } catch (error) {
        // Leave the date parked; the sweeper retries. Do NOT rethrow — the event
        // is already gone and the caller must not see a failure for work that will
        // complete on its own.
        console.error(`[deleteSabhaEvent] Attendance cascade for ${date} failed, left pending:`, error);
    }
}

/** Tell the people who said yes, or who had asked for a ride. */
async function notifyAffected(
    db: admin.firestore.Firestore,
    uids: string[],
    date: string,
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
            `The sabha on ${label} is no longer scheduled. Your ride request has been cancelled.`,
            { reason: 'sabha-deleted', eventId: date },
        );
    } catch (error) {
        console.error('[deleteSabhaEvent] Could not notify affected riders:', error);
    }
}
