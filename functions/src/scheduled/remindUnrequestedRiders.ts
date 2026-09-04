// ============================================
// SCHEDULED: remindUnrequestedRiders
// The window is open and a Bhulku still has not asked for a lift.
// ============================================
//
// THE ONLY REPEATING NOTIFICATION IN THE APP, and the only one aimed at somebody who
// has done nothing rather than reporting something that happened. That makes it the
// one most able to become noise, so the bounds are the point of this file:
//
//   1. It only fires while `home-to-sabha` requests are actually open. Outside the
//      window there is nothing to act on, and a reminder you cannot act on is spam.
//   2. It stops for a person the moment they have a ride for that gathering.
//   3. It fires in ONE hour of the day, chosen by a manager, defaulting to 10am.
//   4. At most one send per gathering per calendar day, whatever the scheduler does.
//   5. The manager can switch it off entirely.
//
// WHY IT RUNS HOURLY AND THEN MOSTLY DOES NOTHING. The hour is a manager's setting,
// and a pubsub cron expression is fixed at deploy time — a job scheduled at 10:00
// cannot be moved to 08:00 by editing Firestore. So it wakes every hour, compares the
// local hour against the setting, and returns. Twenty-three cheap no-ops a day is the
// price of the hour being editable without a deploy, and it is the same trade
// `updateRideTypeContext` already makes by running every minute.
//
// WHY 10AM AND NOT "WHEN THE WINDOW OPENS". The window used to open at local midnight,
// which is how `window-opened` came to announce itself in the middle of the night.
// That default moved to 10:00 in the same change (see DEFAULT_REQUESTS_OPEN_TIME), but
// the two are still separate settings: a congregation may well want requests to open
// early and the nagging to start at a civil hour.
//
// WHO IS EXCLUDED, and each exclusion is a real person who would otherwise be annoyed:
// anybody not approved, anybody still abroad waiting to arrive, anybody whose recorded
// role is Sarthi or manager — they drive, so "you have not booked a lift" is not a
// thing they have failed to do — and of course anybody who already asked.

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { DEFAULT_TIME_ZONE, getZonedParts, zonedDateKey, addDaysToDateKey } from '../utils/time';
import { readRecurrence } from '../http/sabhaRecurrence';
import { resolveCurrentEvent } from '../utils/events';
import { buildCurrentEvent, resolveScheduleWindow } from '../utils/schedule';
import {
    getTimeZone, getRequestsOpenTime, locationsOrFoundingFallback,
} from '../utils/settings';
import { getNotificationSettings } from '../utils/notificationSettings';
import { notifyRideReminder, tokensOf, Recipient } from '../utils/notifications';
import { hasGrantedRole } from '../utils/roles';
import { writeAuditLog } from '../utils/audit';

/**
 * One document recording the last reminder sent.
 *
 * THE DEDUPLICATION, and it is not optional. Pub/Sub delivers AT LEAST ONCE: a run
 * that succeeds but whose acknowledgement is lost is retried, and without this the
 * whole congregation is reminded twice in a minute. Keyed by gathering AND calendar
 * day, so 'daily' means daily and a second gathering in the same week gets its own
 * reminders.
 */
export const REMINDER_STATE_DOC = 'system/rideReminders';

/** Ceiling per run, like every other sweep here. */
const MAX_RECIPIENTS = 1000;

/**
 * Everybody who has already asked for a lift to this gathering.
 *
 * TWO QUERIES ON ONE FIELD EACH, unioned, rather than one clever query. Rides carry
 * the gathering under `eventDate` OR `date` depending on which client wrote them —
 * `eventKeyOfRide` in expireStaleRequests documents the same three-name mess — and
 * Firestore has no OR across fields without a composite index. A missing composite
 * index does not error, it returns an EMPTY RESULT, which here would mean reminding
 * every single person including the ones who already booked.
 *
 * Any status counts, not just 'requested'. Somebody whose ride is already assigned or
 * finished has emphatically asked.
 */
export async function alreadyAsked(
    db: admin.firestore.Firestore,
    eventId: string,
): Promise<Set<string>> {
    const [byEventDate, byDate] = await Promise.all([
        db.collection('rides').where('eventDate', '==', eventId).get(),
        db.collection('rides').where('date', '==', eventId).get(),
    ]);

    const asked = new Set<string>();
    for (const doc of [...byEventDate.docs, ...byDate.docs]) {
        const ride = doc.data();
        if (typeof ride.studentId === 'string' && ride.studentId) asked.add(ride.studentId);
        // The dispatcher copies the whole car's roster onto every ride document, so a
        // passenger can appear only in `students` and never as `studentId`. Missing
        // them would remind somebody who is already in a car.
        if (Array.isArray(ride.students)) {
            for (const rider of ride.students) {
                if (rider && typeof rider.id === 'string' && rider.id) asked.add(rider.id);
            }
        }
    }
    return asked;
}

/**
 * Should this person be nudged?
 *
 * Pure and exported, because the whole risk of this job is who it reaches: the cost of
 * a wrong `true` is a push to somebody it does not apply to, repeated daily.
 */
export function needsReminder(data: FirebaseFirestore.DocumentData | undefined): boolean {
    if (!data) return false;
    if (data.accountStatus !== 'approved') return false;
    // Still abroad. They have no home address here and nothing to request.
    if (data.isArriving === true) return false;
    // ASKED AS "CAN THEY DRIVE", AND NOT AS "ARE THEY A BHULKU", which is the trap
    // this nearly shipped with. `hasRecordedRole(data, 'student')` reads as the
    // obvious test and is true for EVERYBODY: `roleFieldsFor` writes `roles` as the
    // GRANTED set, so a Sarthi's document literally records `['driver', 'student']`
    // and a manager's records all three. That check would have reminded the whole
    // congregation, every day, to book a lift.
    //
    // `hasGrantedRole(data, 'driver')` is the same predicate `canSwitchService` uses
    // for the same population — true for a Sarthi and a manager, false for a Bhulku —
    // and it says the thing that actually matters: somebody who drives has not failed
    // to book anything.
    return !hasGrantedRole(data, 'driver');
}

export const remindUnrequestedRiders = functions.pubsub
    // Hourly, then gated on the manager's chosen hour — see the header. A cron
    // expression cannot be edited from Firestore, and the hour has to be.
    .schedule('every 1 hours')
    .timeZone(DEFAULT_TIME_ZONE)
    .onRun(async () => {
        const db = admin.firestore();
        const now = new Date();

        const settings = await getNotificationSettings(db);
        if (!settings.enabled['ride-reminder']) return null;

        const timeZone = await getTimeZone();
        if (getZonedParts(now, timeZone).hour !== settings.reminderHour) return null;

        const rule = await readRecurrence(db);

        /**
         * THE HALLS ARE NAMED, so an evening no room is holding does not get reminders.
         *
         * A manager who cancels each hall separately rather than cancelling the date
         * leaves the date itself scheduled. Asked without the halls, this reads that as
         * a sabha and nudges everyone who has not booked — towards a request the app
         * will then refuse, which is the failure the window check below exists to
         * prevent, arriving from the other direction.
         *
         * The reminder itself stays ONE PER EVENING, keyed on the evening's date. The
         * text names no hall and a rider books a hall when they request, so a reminder
         * per room would be the same nudge twice. Rides carry the bare date in
         * `eventDate` whichever hall they are for, so `alreadyAsked` already spans both.
         */
        const halls = await locationsOrFoundingFallback(db);
        const { event: scheduled } = await resolveCurrentEvent(
            db, now, timeZone, rule, halls.map(h => h.id),
        );
        if (!scheduled) return null;

        const event = buildCurrentEvent(
            scheduled.date, scheduled.startTime, scheduled.endTime, timeZone,
            {
                venue: scheduled.venue,
                agenda: scheduled.agenda,
                requestsOpenTime: await getRequestsOpenTime(),
            },
        );

        // THE WINDOW IS THE AUTHORITY, not the calendar arithmetic. Asking
        // `resolveScheduleWindow` means this cannot drift from what the rider's own
        // screen says is open — a reminder to do something the app will refuse is
        // worse than silence.
        if (resolveScheduleWindow(now, event, timeZone).rideType !== 'home-to-sabha') {
            return null;
        }

        const todayKey = zonedDateKey(now, timeZone);
        if (settings.reminderCadence === 'day-before'
            && addDaysToDateKey(event.eventId, -1) !== todayKey) {
            return null;
        }

        // Reserved BEFORE the work, so a retry cannot double-send even if the run
        // below throws half way through. A reminder missed for one day is a smaller
        // failure than every phone buzzing twice.
        const stateRef = db.doc(REMINDER_STATE_DOC);
        const sendKey = `${event.eventId}:${todayKey}`;
        const claimed = await db.runTransaction(async tx => {
            const snap = await tx.get(stateRef);
            if (snap.data()?.lastSentKey === sendKey) return false;
            tx.set(stateRef, { lastSentKey: sendKey, lastSentAt: now.toISOString() }, { merge: true });
            return true;
        });
        if (!claimed) return null;

        const [asked, users] = await Promise.all([
            alreadyAsked(db, event.eventId),
            db.collection('users').get(),
        ]);

        const recipients: Recipient[] = [];
        let waiting = 0;
        for (const doc of users.docs) {
            if (asked.has(doc.id)) continue;
            if (!needsReminder(doc.data())) continue;
            waiting++;
            recipients.push(...tokensOf(doc.id, doc.data()));
            if (recipients.length >= MAX_RECIPIENTS) break;
        }

        if (recipients.length > 0) await notifyRideReminder(recipients);

        // AUDITED EVEN WHEN NOTHING WENT OUT. "Forty people had not booked and none of
        // them had push on" is the fact somebody needs when they ask why the reminder
        // is not working, and it is invisible everywhere else.
        await writeAuditLog(db, {
            action: 'reminder.send',
            actorUid: 'system:remindUnrequestedRiders',
            actorName: 'Scheduled reminder',
            targetCollection: 'events',
            targetDocumentId: event.eventId,
            summary: `Reminded ${waiting} Bhulka who had not asked for a ride`
                + ` (${recipients.length} devices).`,
            details: { waiting, devices: recipients.length, cadence: settings.reminderCadence },
        });

        console.log(`[remindUnrequestedRiders] ${waiting} waiting, ${recipients.length} devices`);
        return null;
    });
