// ============================================
// The manager's recurring sabha schedule: read and write the rule.
// ============================================

/**
 * One record, no horizon.
 *
 * `topUpCalendar` used to live here and wrote one `events/{date}` document per
 * occurrence out to a chosen horizon. It is gone. The rule in
 * `settings/sabhaRecurrence` IS the schedule now, and `findCurrentEvent` computes
 * from it — see the long note at the top of utils/recurrence.ts for why that is
 * both simpler and one whole bug class smaller.
 *
 * So this file validates and stores the rule — and, since 2026-08-24, reconciles
 * the bookings the old rule left behind. Nothing is generated, which is why
 * nothing here needs a watermark or an `occupied` set.
 *
 * WHY THE RECONCILIATION IS HERE
 * ------------------------------
 * Changing the day silently stranded people. Found in production: the day moved
 * Friday -> Monday, two riders had already answered "yes" for Friday the 28th,
 * and they stayed attached to it — so the gathering that actually ran counted
 * nobody, and one of them had a ride request on a date `globalAssignDriver` could
 * never serve, because it queries status with no date filter.
 *
 * `expireStaleRequests` does not catch this and should not: it only touches
 * gatherings strictly in the PAST, which is what makes it safe to run unattended.
 * A request stranded on a FUTURE date that stopped being a sabha falls between
 * the two.
 *
 * The handshake is `deleteSabhaEvent`'s, deliberately — same problem, same shape:
 * `dryRun` returns a preview, and the real call must carry `acknowledge`. The
 * acknowledgement is enforced HERE rather than in the dialog, because a guard
 * whose failure mode is "silently do nothing" is how the cancel button died.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { writeAuditLog } from '../utils/audit';
import {
    RecurrenceRule, EventException, normaliseRecurrence, normaliseException,
    datesLosingTheirSabha, upcomingOccurrences,
} from '../utils/recurrence';
import { DEFAULT_TIME_ZONE, zonedDateKey, addDaysToDateKey } from '../utils/time';
import { formatTimeForDisplay } from '../utils/schedule';

export const RECURRENCE_DOC = 'settings/sabhaRecurrence';

/** Ride states that still expect a gathering to turn up to. */
const OPEN_RIDE_STATUSES = ['requested', 'assigned', 'driver_en_route', 'arriving', 'in_progress'];

/** How far ahead to look for somewhere to move people to. */
const TARGET_SEARCH_DAYS = 365;

/** One date that holds bookings, and what would become of it. */
export interface StrandedDate {
    date: string;
    /** Where these bookings would move to, or null when the rule schedules nothing. */
    target: string | null;
    responseCount: number;
    requestedRideCount: number;
    /** For the sentence the manager reads. Capped — this is a dialog, not a report. */
    names: string[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Read the rule, already validated.
 *
 * A rule that cannot be understood returns null and schedules nothing — see the
 * note on `normaliseRecurrence` for why guessing is worse than stopping.
 */
export async function readRecurrence(
    db: admin.firestore.Firestore,
): Promise<RecurrenceRule | null> {
    const snap = await db.doc(RECURRENCE_DOC).get();
    return snap.exists ? normaliseRecurrence(snap.data()) : null;
}

/** How the schedule reads on a manager's screen and in an audit row. */
export function describeRule(rule: RecurrenceRule): string {
    if (!rule.enabled) return 'Recurring sabha turned off';
    const days = rule.daysOfWeek.map(d => DAY_NAMES[d]).join(', ');
    return `Every ${days}, ${rule.startTime}–${rule.endTime}`;
}

/**
 * Every future date somebody has booked, with its exception if it has one.
 *
 * Driven by where the bookings ARE, not by a window of rule dates: that is what
 * lets `datesLosingTheirSabha` need neither a horizon nor the previous rule.
 */
async function bookedDates(
    db: admin.firestore.Firestore,
    today: string,
): Promise<{ dateKey: string; exception: EventException | null }[]> {
    const attendanceDocs = await db.collection('weeklyAttendance').listDocuments();
    const futureAttendance = attendanceDocs.filter(d => d.id >= today);

    const dates = new Set<string>();

    // An attendance document with no responses left is not a booking.
    await Promise.all(futureAttendance.map(async d => {
        if ((await d.collection('responses').limit(1).get()).size > 0) dates.add(d.id);
    }));

    const openRides = await db.collection('rides')
        .where('status', 'in', OPEN_RIDE_STATUSES)
        .get();

    openRides.docs.forEach(d => {
        const key = d.data()?.eventDate || d.data()?.date;
        if (typeof key === 'string' && key >= today) dates.add(key);
    });

    return Promise.all([...dates].sort().map(async dateKey => ({
        dateKey,
        exception: normaliseException((await db.collection('events').doc(dateKey).get()).data()),
    })));
}

/** What the manager is shown before anything moves. */
async function previewStranded(
    db: admin.firestore.Firestore,
    rule: RecurrenceRule,
    today: string,
): Promise<StrandedDate[]> {
    const booked = await bookedDates(db, today);
    const stranded = datesLosingTheirSabha(rule, booked);
    if (stranded.length === 0) return [];

    // Exceptions matter when picking a target too — moving people onto a week the
    // manager has already cancelled would strand them a second time.
    const exceptions = new Map<string, EventException>();
    booked.forEach(b => { if (b.exception) exceptions.set(b.dateKey, b.exception); });

    return Promise.all(stranded.map(async date => {
        const responses = await db.collection('weeklyAttendance').doc(date)
            .collection('responses').get();
        const rides = (await db.collection('rides').where('eventDate', '==', date).get())
            .docs.filter(d => OPEN_RIDE_STATUSES.includes(d.data()?.status));

        const next = upcomingOccurrences(
            rule, exceptions, date, addDaysToDateKey(date, TARGET_SEARCH_DAYS), 1,
        );

        const names = new Set<string>();
        responses.docs.forEach(d => names.add(String(d.data()?.studentName || 'Someone')));
        rides.forEach(d => names.add(String(d.data()?.studentName || 'Someone')));

        return {
            date,
            target: next[0]?.date ?? null,
            responseCount: responses.size,
            requestedRideCount: rides.length,
            names: [...names].slice(0, 6),
        };
    }));
}

/**
 * HTTP Callable: a manager sets the recurring pattern.
 *
 * Input: { enabled, daysOfWeek, startTime, endTime, dryRun?, acknowledge? }
 * Output: { rule, stranded }
 *
 * No `weeksAhead`. There is no horizon any more: the rule repeats until a manager
 * changes it, and a single date is changed by writing an exception for that date
 * rather than by re-generating a window.
 */
export const updateSabhaRecurrence = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();

    // Changing when a whole congregation gathers. Manager only.
    await assertApprovedManager(db, context.auth.uid, 'change the sabha schedule');

    // Validated through the same function the scheduler uses, so a rule the
    // scheduler would refuse cannot be saved — otherwise the manager sees a saved
    // setting that silently schedules nothing.
    const rule = normaliseRecurrence({
        enabled: data?.enabled === true,
        daysOfWeek: data?.daysOfWeek,
        startTime: data?.startTime,
        endTime: data?.endTime,
        venue: data?.venue ?? null,
        agenda: data?.agenda ?? '',
    });

    if (!rule) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Pick at least one day, and an end time later than the start time.',
        );
    }

    const now = new Date();
    const timeZone = (await db.collection('settings').doc('main').get()).data()?.timeZone
        || DEFAULT_TIME_ZONE;
    const today = zonedDateKey(now, timeZone);

    // ── Who this rule would leave behind ────────────────────────────────
    const stranded = await previewStranded(db, rule, today);

    if (data?.dryRun === true) return { rule, stranded };

    // Enforced server-side. The dialog can be dismissed, suppressed, or simply
    // not built yet; this cannot.
    if (stranded.length > 0 && data?.acknowledge !== true) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'People have already booked dates this change would remove. Confirm to move them.',
        );
    }

    await db.doc(RECURRENCE_DOC).set({
        enabled: rule.enabled,
        daysOfWeek: rule.daysOfWeek,
        startTime: rule.startTime,
        endTime: rule.endTime,
        venue: rule.venue,
        agenda: rule.agenda,
        updatedAt: now.toISOString(),
        updatedBy: context.auth.uid,
        // Deleted along with the generator. Removed rather than left behind, so a
        // stale value cannot be read back by anything that has not been updated.
        weeksAhead: admin.firestore.FieldValue.delete(),
        generatedThrough: admin.firestore.FieldValue.delete(),
    }, { merge: true });

    await writeAuditLog(db, {
        action: 'doc.update',
        actorUid: context.auth.uid,
        actorName: 'Manager',
        targetCollection: 'settings',
        targetDocumentId: 'sabhaRecurrence',
        summary: describeRule(rule),
        details: { ...rule },
    });

    // ── Move the people the old rule left behind ────────────────────────
    //
    // After the rule is stored, so a crash between the two leaves the schedule
    // saved and the bookings where they were — visible and repairable. The other
    // order would move people to a date the rule does not yet place.
    for (const item of stranded) {
        await reconcileDate(db, item, context.auth.uid, rule);
    }

    return { rule, stranded };
});

/**
 * Move one date's bookings to `item.target`, or close them when there is none.
 *
 * Not a batch: the two collections are independent, a partial move is repairable,
 * and a batch that fails wholesale would leave the manager with a saved rule and
 * no idea which half ran. Every document written gets its own audit row so the
 * move is distinguishable later from something a rider did.
 */
async function reconcileDate(
    db: admin.firestore.Firestore,
    item: StrandedDate,
    actorUid: string,
    rule: RecurrenceRule,
): Promise<void> {
    const responses = await db.collection('weeklyAttendance').doc(item.date)
        .collection('responses').get();
    const rides = (await db.collection('rides').where('eventDate', '==', item.date).get())
        .docs.filter(d => OPEN_RIDE_STATUSES.includes(d.data()?.status));

    const audit = (targetCollection: string, targetDocumentId: string, summary: string) =>
        writeAuditLog(db, {
            action: 'doc.update',
            actorUid,
            actorName: 'Manager',
            targetCollection,
            targetDocumentId,
            summary,
            details: { from: item.date, to: item.target, reason: 'sabha day changed' },
        });

    if (!item.target) {
        // Nothing to move them to — the rule schedules nothing from here on. The
        // ride requests are closed, because an open request with no gathering sits
        // in the dispatcher's queue for ever. The attendance rows are LEFT: they
        // are keyed by date, so they mislead nobody, and deleting them would
        // destroy the only record that these people said they were coming.
        for (const ride of rides) {
            await ride.ref.update({ status: 'cancelled', cancelledAt: new Date().toISOString() });
            await audit('rides', ride.id,
                `Cancelled ${ride.data()?.studentName || 'a'}'s ride request — ${item.date} is no longer a sabha`);
        }
        return;
    }

    const target = item.target;

    for (const response of responses.docs) {
        const destination = db.collection('weeklyAttendance').doc(target)
            .collection('responses').doc(response.id);

        // Never overwrite an answer they gave for the destination itself.
        if ((await destination.get()).exists) continue;

        await destination.set({ ...response.data(), eventId: target });
        await response.ref.delete();
        await audit(`weeklyAttendance/${target}/responses`, response.id,
            `Moved ${response.data()?.studentName || 'a rider'}'s response from ${item.date} to ${target}`);
    }

    const occurrence = upcomingOccurrences(rule, new Map(), target, target, 1)[0];

    for (const ride of rides) {
        await ride.ref.update({
            date: target,
            eventDate: target,
            // The new week may start at a different time, and the rider is shown
            // this string rather than the event's own times.
            ...(occurrence ? { timeSlot: formatTimeForDisplay(occurrence.startTime) } : {}),
        });
        await audit('rides', ride.id,
            `Moved ${ride.data()?.studentName || 'a rider'}'s ride request from ${item.date} to ${target}`);
    }
}
