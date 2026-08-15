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
    DEFAULT_SABHA_START, DEFAULT_SABHA_END,
} from '../utils/schedule';
import { findCurrentEvent, seedFirstEventIfNeeded } from '../utils/events';
import { notifyEveryone } from '../utils/notifications';
import { drainAttendanceDelete } from '../http/deleteSabhaEvent';
import { SEED_MARKER_DOC } from '../utils/events';
import { assertApprovedManager } from '../utils/authz';
import { readRecurrence, topUpCalendar } from '../http/sabhaRecurrence';

const CONTEXT_DOC = 'system/rideContext';

/**
 * Stamp the gathering's own details onto its attendance record.
 *
 * Attendance lives at `weeklyAttendance/{eventId}/responses/{uid}`, and the
 * parent document was never written — so a record said who was coming but
 * nothing about what they were coming to. Once the sabha time or venue can
 * change week to week, "the 7th of August" alone stops being enough to
 * reconstruct what happened.
 *
 * set+merge, so re-running is harmless and manager edits to the venue mid-week
 * are picked up.
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
        };
    } catch (error) {
        console.error('[rideContext] Could not read settings/main:', error);
        return {
            sabhaStart: undefined, sabhaEnd: undefined,
            timeZone: DEFAULT_TIME_ZONE, venue: undefined,
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
            : 'Drivers are heading out. Tap when you are ready to leave.',
        { rideType: next.rideType, reason: 'window-opened' },
    );
}

/**
 * Seed the calendar on a brand-new project — once, ever.
 *
 * A daily job rather than a one-off script so a fresh project cannot sit with
 * an empty calendar. It does nothing at all once the
 * marker is set, which is what lets a manager delete a gathering and have it stay
 * deleted. How many sabhas exist after the first is the manager's decision.
 */
export const ensureSabhaEvents = functions.pubsub
    .schedule('every day 03:00')
    .timeZone(DEFAULT_TIME_ZONE)
    .onRun(async () => {
        const db = admin.firestore();
        const now = new Date();

        try {
            const { sabhaStart, sabhaEnd, timeZone } = await readSabhaTimes(db);

            const created = await seedFirstEventIfNeeded(db, now, timeZone, {
                startTime: typeof sabhaStart === 'string' ? sabhaStart : DEFAULT_SABHA_START,
                endTime: typeof sabhaEnd === 'string' ? sabhaEnd : DEFAULT_SABHA_END,
            });

            console.log(created.length > 0
                ? `[events] Seeded ${created.join(', ')}`
                : '[events] Already seeded — the calendar is the manager\'s');

            // Then top up from the manager's recurring pattern, if they set one.
            //
            // Separate from the seed above and deliberately so: the seed exists
            // once to stop a brand-new project sitting closed, while this is the
            // standing schedule. Measured 2026-08-15, before this existed: the
            // calendar ran dry and `calendarStatus` read 'no-scheduled-event',
            // so nobody could request a ride until a manager hand-added a date.
            //
            // Its own try/catch — a broken pattern must not stop the seed, and
            // neither must stop this job returning.
            try {
                const recurrence = await readRecurrence(db);
                if (!recurrence) {
                    console.log('[events] No usable recurring pattern — nothing to top up');
                } else {
                    const added = await topUpCalendar(db, recurrence, now, timeZone);
                    console.log(added.length > 0
                        ? `[events] Recurring schedule added ${added.join(', ')}`
                        : '[events] Recurring schedule already satisfied');
                }
            } catch (recurrenceError) {
                console.error('[events] Could not apply the recurring schedule:', recurrenceError);
            }

            return null;
        } catch (error) {
            console.error('[events] Could not top up the calendar:', error);
            return null;
        }
    });

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

            const { sabhaStart, sabhaEnd, timeZone, venue } = await readSabhaTimes(db);

            // The gathering now comes from the events collection. No event means
            // nothing is scheduled — closed, and said plainly.
            let scheduled = await findCurrentEvent(db, now, timeZone);

            // Seed on the very first run, so a fresh deploy does not sit with the
            // service closed until 03:00. Once the marker is set this does
            // nothing — an empty calendar from then on is the manager's choice,
            // and `calendarStatus` below publishes it so the UI can say so rather
            // than leaving "No rides available" looking like a fault.
            //
            // This is also what makes deletion stick. The previous version treated
            // a missing document as "needs creating", so a deleted date reappeared
            // on the very next tick — within 60 seconds.
            if (!scheduled) {
                const created = await seedFirstEventIfNeeded(db, now, timeZone, {
                    startTime: typeof sabhaStart === 'string' ? sabhaStart : DEFAULT_SABHA_START,
                    endTime: typeof sabhaEnd === 'string' ? sabhaEnd : DEFAULT_SABHA_END,
                });
                if (created.length > 0) {
                    console.log(`[events] Seeded the calendar: ${created.join(', ')}`);
                    scheduled = await findCurrentEvent(db, now, timeZone);
                }
            }
            const event = scheduled
                ? buildCurrentEvent(scheduled.date, scheduled.startTime, scheduled.endTime, timeZone, {
                    venue: scheduled.venue,
                    agenda: scheduled.agenda,
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

            // Only when the gathering changes, not every minute.
            if (event && current?.eventId !== event.eventId) {
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

    const { timeZone } = await readSabhaTimes(db);
    const scheduled = await findCurrentEvent(db, now, timeZone);
    const event = scheduled
        ? buildCurrentEvent(scheduled.date, scheduled.startTime, scheduled.endTime, timeZone, {
            venue: scheduled.venue,
            agenda: scheduled.agenda,
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
