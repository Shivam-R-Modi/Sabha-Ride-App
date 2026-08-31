// ============================================
// SCHEDULED FUNCTION: updateRideTypeContext
// Runs every 1 minute to publish which rides are currently open
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { RideType } from '../types';
import { DEFAULT_TIME_ZONE } from '../utils/time';
import {
    resolveScheduleWindow, buildCurrentEvent, ScheduleWindow, CurrentEvent,
} from '../utils/schedule';
import { findCurrentEvent } from '../utils/events';
import { notifyEveryone } from '../utils/notifications';
import { drainAttendanceDelete } from '../http/deleteSabhaEvent';
import { SEED_MARKER_DOC } from '../utils/events';
import { assertApprovedManager } from '../utils/authz';
import { readRecurrence } from '../http/sabhaRecurrence';

const CONTEXT_DOC = 'system/rideContext';

/**
 * Does the attendance header need rewriting?
 *
 * THE BUG THIS FIXES
 * ------------------
 * The caller used to ask only `current?.eventId !== event.eventId` — rewrite when
 * the gathering CHANGES. So editing the current gathering's time never reached the
 * attendance record, and this function's own comment claimed the opposite:
 * "manager edits to the venue mid-week are picked up". They were not.
 *
 * Measured in production on 2026-08-17. `weeklyAttendance/2026-08-17` said the
 * sabha started at **4:00 AM**; it actually started at 11:00 PM — nineteen hours
 * out. `2026-08-14` said 3:15 PM for a gathering that ran at 7:45 PM. Two of five
 * headers were wrong, on the one record whose entire purpose is remembering what
 * people were coming to.
 *
 * `attendanceLocksAt` agreed in both cases, which is why it went unnoticed: it is
 * derived from the DATE, so it stays right while the times drift.
 *
 * Compared against `system/rideContext`, which is read at the top of every tick
 * and carries the same fields — so this costs no extra reads, and still writes
 * only when something really moved rather than 1,440 times a day.
 *
 * Pure and exported: the guard is the whole of the defect.
 */
export function attendanceHeaderChanged(
    current: Record<string, unknown> | undefined,
    event: CurrentEvent,
): boolean {
    if (!current) return true;
    if (current.eventId !== event.eventId) return true;

    for (const field of ['startsAt', 'endsAt', 'attendanceLocksAt'] as const) {
        if (current[field] !== event[field]) return true;
    }

    // Structural, because a venue is an object. Absent and null are the same
    // thing here — "use the default" — and must not read as a change.
    const before = (current.venue ?? null) as { lat?: number; lng?: number } | null;
    const after = (event.venue ?? null) as { lat?: number; lng?: number } | null;
    if (!before !== !after) return true;
    if (before && after && (before.lat !== after.lat || before.lng !== after.lng)) return true;

    return false;
}

/**
 * Stamp the gathering's own details onto its attendance record.
 *
 * Attendance lives at `weeklyAttendance/{eventId}/responses/{uid}`, and the
 * parent document was never written — so a record said who was coming but
 * nothing about what they were coming to. Once the sabha time or venue can
 * change week to week, "the 7th of August" alone stops being enough to
 * reconstruct what happened.
 *
 * set+merge, so re-running is harmless.
 */
async function recordEventDetails(
    db: admin.firestore.Firestore,
    event: CurrentEvent,
    venue: unknown,
): Promise<void> {
    try {
        await db.collection('weeklyAttendance').doc(event.eventId).set({
            eventId: event.eventId,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            attendanceLocksAt: event.attendanceLocksAt,
            venue: venue ?? null,
            updatedAt: new Date().toISOString(),
        }, { merge: true });
    } catch (error) {
        // Best-effort. Losing the header must not stop the window opening.
        console.error('[rideContext] Could not record event details:', error);
    }
}

/**
 * Read the manager-set sabha times.
 *
 * These used to be literals in this file, so moving sabha meant a code change
 * and a deploy. Missing or malformed values fall through to the defaults inside
 * resolveScheduleWindow rather than closing the service.
 */
async function readSabhaTimes(db: admin.firestore.Firestore) {
    try {
        const snap = await db.collection('settings').doc('main').get();
        const data = snap.data();
        return {
            sabhaStart: data?.sabhaStartTime,
            sabhaEnd: data?.sabhaEndTime,
            timeZone: data?.timeZone || DEFAULT_TIME_ZONE,
            venue: data?.sabhaLocation,
            // Validated inside buildCurrentEvent, so a typo falls back to the default
            // rather than reopening the midnight behaviour this replaced.
            requestsOpenTime: data?.requestsOpenTime,
        };
    } catch (error) {
        console.error('[rideContext] Could not read settings/main:', error);
        return {
            sabhaStart: undefined, sabhaEnd: undefined,
            timeZone: DEFAULT_TIME_ZONE, venue: undefined,
            requestsOpenTime: undefined,
        };
    }
}

/**
 * Announce that ride requests have opened — once.
 *
 * This function runs every minute, so notifying whenever pickup is open would
 * send roughly 60 pushes an hour for three days. It fires only on the
 * transition INTO a ride type, which is why the previous rideType has to be
 * read before the new one is written.
 */
async function announceIfWindowJustOpened(
    previousRideType: RideType | null | undefined,
    next: ScheduleWindow,
): Promise<void> {
    if (!next.rideType || previousRideType === next.rideType) return;

    const isPickup = next.rideType === 'home-to-sabha';

    await notifyEveryone(
        isPickup ? 'Ride requests are open' : 'Drop-off rides are open',
        isPickup
            // Not "this Friday" any more — the date can move.
            ? 'Tap to request your ride to the next sabha.'
            : 'Sarthis are heading out. Tap when you are ready to leave.',
        // `type` is the key the manager's notification panel switches on — see
        // src/constants/notifications.ts. It was the one send with no tag, so it
        // was the one send nobody could turn off.
        { type: 'window-opened', rideType: next.rideType, reason: 'window-opened' },
    );
}

/**
 * `ensureSabhaEvents` is gone.
 *
 * It did two things, and the rule model removed the need for both. It seeded ONE
 * gathering on a brand-new project so the service was not closed on day one — now
 * an unset rule is honestly closed, and the calendar says so beside the control
 * that fixes it. And it topped the calendar up from the recurring pattern — now
 * there is nothing to top up, because the pattern IS the schedule and
 * `findCurrentEvent` reads it directly.
 *
 * A scheduled job that exists to materialise what can be computed is a scheduled
 * job that can be wrong at 03:00 and stay wrong all day.
 */

/**
 * Drain dates whose attendance cascade did not finish.
 *
 * Bounded to a few per tick: this is a repair path, not a queue, and a runaway
 * loop here would delay the ride window for everyone.
 */
async function sweepPendingAttendanceDeletes(db: admin.firestore.Firestore): Promise<void> {
    try {
        const marker = await db.doc(SEED_MARKER_DOC).get();
        const pending: unknown = marker.data()?.pendingAttendanceDeletes;
        if (!Array.isArray(pending) || pending.length === 0) return;

        for (const date of pending.slice(0, 3)) {
            if (typeof date !== 'string') continue;
            console.log(`[events] Draining pending attendance delete for ${date}`);
            await drainAttendanceDelete(db, date);
        }
    } catch (error) {
        console.error('[events] Could not sweep pending attendance deletes:', error);
    }
}

export const updateRideTypeContext = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async () => {
        const db = admin.firestore();

        try {
            const currentDoc = await db.doc(CONTEXT_DOC).get();
            const current = currentDoc.data();
            const now = new Date();

            // A manual override holds until it expires. Without the expiry a
            // manager who forgot to reset would freeze the schedule
            // indefinitely — and the failure mode of a frozen schedule is
            // people waiting for rides that never open.
            if (current?.overrideUntil && new Date(current.overrideUntil) > now) {
                console.log(`[rideContext] Manual override active until ${current.overrideUntil}`);
                return null;
            }

            // Finish any attendance cascade a deletion did not complete.
            // recursiveDelete cannot be part of the deleting batch, so a crash
            // between the two leaves exactly the invisible orphan the cascade
            // exists to prevent. The date is parked; this drains it.
            await sweepPendingAttendanceDeletes(db);

            const { timeZone, venue, requestsOpenTime } = await readSabhaTimes(db);

            // The gathering is computed from the manager's rule, with any
            // exception for that date applied. No rule and no one-off means
            // nothing is scheduled — closed, and said plainly rather than papered
            // over by seeding a date nobody asked for.
            //
            // A rule that cannot be parsed reads as null here, which closes the
            // service. That is deliberate and it is the safer direction: a missing
            // gathering is visible on the manager's calendar, a wrongly-placed one
            // sends drivers out.
            const rule = await readRecurrence(db);
            const scheduled = await findCurrentEvent(db, now, timeZone, rule);

            const event = scheduled
                ? buildCurrentEvent(scheduled.date, scheduled.startTime, scheduled.endTime, timeZone, {
                    venue: scheduled.venue,
                    agenda: scheduled.agenda,
                    requestsOpenTime,
                })
                : null;
            const window = resolveScheduleWindow(now, event, timeZone);

            await db.doc(CONTEXT_DOC).set({
                ...window,
                ...(event ?? { eventId: null }),
                // Lets the manager UI say "you cancelled everything" instead of
                // leaving "No rides available" looking like a malfunction.
                calendarStatus: event ? 'ok' : 'no-scheduled-event',
                overrideUntil: null,
                lastUpdated: now.toISOString(),
            });

            // When the gathering changes OR when its details do — see
            // attendanceHeaderChanged. Comparing eventId alone left the attendance
            // record showing a 4:00 AM start for an 11:00 PM sabha.
            if (event && attendanceHeaderChanged(current, event)) {
                await recordEventDetails(db, event, event.venue ?? venue);
            }

            await announceIfWindowJustOpened(current?.rideType, window);

            console.log('[rideContext] Updated:', window);
            return null;
        } catch (error) {
            console.error('[rideContext] Error updating ride context:', error);
            return null;
        }
    });

/**
 * HTTP Callable: manager opens a ride window early, or returns to automatic.
 *
 * Input:
 *   { rideType: 'home-to-sabha' | 'sabha-to-home' }  → open it now
 *   { reset: true }                                   → back to the schedule
 *
 * The override expires at the end of the current day in Sabha local time, so
 * the schedule always resumes on its own even if nobody resets it.
 */
export const manuallyUpdateRideContext = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const now = new Date();

    // Only a manager may move the service window for everyone.
    await assertApprovedManager(db, context.auth.uid, 'change the ride window');

    const { timeZone, requestsOpenTime } = await readSabhaTimes(db);
    const rule = await readRecurrence(db);
    const scheduled = await findCurrentEvent(db, now, timeZone, rule);
    const event = scheduled
        ? buildCurrentEvent(scheduled.date, scheduled.startTime, scheduled.endTime, timeZone, {
            venue: scheduled.venue,
            agenda: scheduled.agenda,
            requestsOpenTime,
        })
        : null;

    // Reset — hand control straight back to the schedule.
    if (data?.reset) {
        const window = resolveScheduleWindow(now, event, timeZone);
        await db.doc(CONTEXT_DOC).set({
            ...window,
            ...(event ?? { eventId: null }),
            calendarStatus: event ? 'ok' : 'no-scheduled-event',
            overrideUntil: null,
            lastUpdated: now.toISOString(),
        });
        return window;
    }

    const rideType = data?.rideType as RideType | undefined;
    if (rideType !== 'home-to-sabha' && rideType !== 'sabha-to-home') {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'rideType must be home-to-sabha or sabha-to-home, or pass reset: true',
        );
    }

    const previous = (await db.doc(CONTEXT_DOC).get()).data();

    const window: ScheduleWindow = {
        rideType,
        displayText: rideType === 'home-to-sabha' ? 'Home → Sabha' : 'Sabha → Home',
        timeContext: 'Opened by a manager',
    };

    if (!event) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'No sabha is scheduled. Add one in the Sabha Calendar before opening a ride window.',
        );
    }

    await db.doc(CONTEXT_DOC).set({
        ...window,
        ...event,
        calendarStatus: 'ok',
        overrideUntil: endOfLocalDay(now, timeZone),
        openedBy: context.auth.uid,
        lastUpdated: now.toISOString(),
    });

    // Same one-shot rule as the scheduler: announce only a real change, so
    // re-tapping the button does not notify the congregation twice.
    await announceIfWindowJustOpened(previous?.rideType, window);

    return window;
});

/**
 * Midnight tonight, in Sabha local time, as an ISO instant.
 *
 * Derived by asking what the local date is and walking forward in hours, rather
 * than by assuming a fixed UTC offset — the offset changes twice a year.
 */
function endOfLocalDay(now: Date, timeZone: string): string {
    const localDate = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);

    // Step forward in 30-minute jumps until the local calendar date changes.
    // At most 48 hours of steps, so this terminates regardless of the zone.
    let cursor = now.getTime();
    for (let i = 0; i < 96; i++) {
        cursor += 30 * 60 * 1000;
        const candidate = new Intl.DateTimeFormat('en-CA', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(cursor));
        if (candidate !== localDate) return new Date(cursor).toISOString();
    }

    return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}
