// ============================================
// SCHEDULED FUNCTION: updateRideTypeContext
// Runs every 1 minute to publish which rides are currently open
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { RideType } from '../types';
import { DEFAULT_TIME_ZONE } from '../utils/time';
import { resolveScheduleWindow, resolveCurrentEvent, ScheduleWindow, CurrentEvent } from '../utils/schedule';
import { notifyEveryone } from '../utils/notifications';

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
            ? 'Tap to request your ride to sabha this Friday.'
            : 'Drivers are heading out. Tap when you are ready to leave.',
        { rideType: next.rideType, reason: 'window-opened' },
    );
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

            const { sabhaStart, sabhaEnd, timeZone, venue } = await readSabhaTimes(db);
            const window = resolveScheduleWindow(now, timeZone, sabhaStart, sabhaEnd);
            const event = resolveCurrentEvent(now, timeZone, sabhaStart, sabhaEnd);

            await db.doc(CONTEXT_DOC).set({
                ...window,
                ...event,
                overrideUntil: null,
                lastUpdated: now.toISOString(),
            });

            // Only when the gathering changes, not every minute.
            if (current?.eventId !== event.eventId) {
                await recordEventDetails(db, event, venue);
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
    const callerDoc = await db.collection('users').doc(context.auth.uid).get();
    const caller = callerDoc.data();
    const isManager = caller?.accountStatus === 'approved' && (
        caller?.role === 'manager'
        || caller?.registeredRole === 'manager'
        || (Array.isArray(caller?.roles) && caller.roles.includes('manager'))
    );
    if (!isManager) {
        throw new functions.https.HttpsError('permission-denied', 'Only managers can change the ride window.');
    }

    const { sabhaStart, sabhaEnd, timeZone } = await readSabhaTimes(db);
    const event = resolveCurrentEvent(now, timeZone, sabhaStart, sabhaEnd);

    // Reset — hand control straight back to the schedule.
    if (data?.reset) {
        const window = resolveScheduleWindow(now, timeZone, sabhaStart, sabhaEnd);
        await db.doc(CONTEXT_DOC).set({
            ...window,
            ...event,
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

    await db.doc(CONTEXT_DOC).set({
        ...window,
        ...event,
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
