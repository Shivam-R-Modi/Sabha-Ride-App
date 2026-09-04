// ============================================
// SCHEDULED FUNCTION: updateRideTypeContext
// Runs every 1 minute to publish which rides are currently open
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { RideType } from '../types';
import { DEFAULT_TIME_ZONE } from '../utils/time';
import { ScheduleWindow, CurrentEvent } from '../utils/schedule';
import { resolveCurrentEvent } from '../utils/events';
// Shaping this document lives in utils/rideContext so `deleteSabhaEvent` can build it
// the same way without a cycle. Re-exported because tests and callers still ask this
// module for them, and because this is where they were.
import {
    attendanceHeaderChanged, buildRideContextDoc, hallContexts, announcementFor,
    type HallContext,
} from '../utils/rideContext';
export {
    attendanceHeaderChanged, buildRideContextDoc, hallContexts, announcementFor,
    type HallContext,
};
import { notifyEveryone } from '../utils/notifications';
import { drainAttendanceDelete } from '../http/deleteSabhaEvent';
import { SEED_MARKER_DOC } from '../utils/events';
import { assertApprovedManager } from '../utils/authz';
import { readRecurrence } from '../http/sabhaRecurrence';
import { FOUNDING_LOCATION_ID } from '../constants/tenancy';
import { locationsOrFoundingFallback } from '../utils/settings';

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
 * Send the announcement `announcementFor` selected.
 *
 * This job runs every minute, so notifying whenever pickup is open would send roughly
 * 60 pushes an hour for three days. The transition test lives in `announcementFor`,
 * which is why the previous document has to be read before the new one is written.
 */
async function announceWindowOpened(next: ScheduleWindow): Promise<void> {
    if (!next.rideType) return;

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

        // EVENT IDS, not dates — a hall's attendance is `weeklyAttendance/{date}__{hall}`.
        // A bare date parked by an older revision is still an event id (the founding
        // hall's), so entries written before halls existed drain correctly and nothing
        // needs migrating.
        for (const eventId of pending.slice(0, 3)) {
            if (typeof eventId !== 'string') continue;
            console.log(`[events] Draining pending attendance delete for ${eventId}`);
            await drainAttendanceDelete(db, eventId);
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

            // HALLS FIRST, because the evening is resolved against them: an evening
            // every hall has cancelled separately is not an evening, and naming the
            // halls is what lets `resolveCurrentEvent` roll past it instead of opening
            // a window for a sabha nobody is holding.
            const halls = await locationsOrFoundingFallback(db);
            const { event: scheduled, hallExceptions } = await resolveCurrentEvent(
                db, now, timeZone, rule, halls.map(h => h.id),
            );

            // ONE gathering for the evening, then one context per open hall — with that
            // hall's own document laid over it. See `hallContexts`.
            const contexts = hallContexts(
                scheduled, halls.map(h => ({ id: h.id, venue: h.venue })),
                now, timeZone, requestsOpenTime, hallExceptions,
            );

            await db.doc(CONTEXT_DOC).set(buildRideContextDoc(contexts, now));

            // When the gathering changes OR when its details do — see
            // attendanceHeaderChanged. Comparing eventId alone left the attendance
            // record showing a 4:00 AM start for an 11:00 PM sabha.
            //
            // PER HALL, and the previous value is read from that hall's own slice. The
            // founding hall falls back to the TOP LEVEL, because on the first tick
            // after this deploys `byLocation` does not exist yet — without that
            // fallback every attendance header would be rewritten once for nothing.
            for (const hall of contexts) {
                if (!hall.event) continue;
                const before = (current?.byLocation as Record<string, never> | undefined)?.[hall.locationId]
                    ?? (hall.locationId === FOUNDING_LOCATION_ID ? current : undefined);
                if (!attendanceHeaderChanged(before, hall.event)) continue;
                await recordEventDetails(db, hall.event, hall.event.venue ?? venue);
            }

            // ONE ANNOUNCEMENT FOR THE EVENING, from whichever hall opens first — see
            // `announcementFor`. Still not one per hall: the news is hall-agnostic, so
            // two sends would tell half the congregation something it already acted on.
            const primary = contexts.find(h => h.locationId === FOUNDING_LOCATION_ID) ?? contexts[0];
            const announce = announcementFor(current, contexts);
            if (announce) await announceWindowOpened(announce);

            console.log(`[rideContext] Updated ${contexts.length} hall(s):`, primary.window);
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
    const halls = await locationsOrFoundingFallback(db);
    const { event: scheduled, hallExceptions } = await resolveCurrentEvent(
        db, now, timeZone, rule, halls.map(h => h.id),
    );
    const contexts = hallContexts(
        scheduled, halls.map(h => ({ id: h.id, venue: h.venue })),
        now, timeZone, requestsOpenTime, hallExceptions,
    );
    const primary = contexts.find(h => h.locationId === FOUNDING_LOCATION_ID) ?? contexts[0];
    const event = primary?.event ?? null;

    // Reset — hand control straight back to the schedule.
    if (data?.reset) {
        await db.doc(CONTEXT_DOC).set(buildRideContextDoc(contexts, now));
        return primary.window;
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

    /**
     * AN OVERRIDE OPENS EVERY HALL, and that is the honest reading of the control.
     *
     * The button says "Open ride requests now" with no hall on it, and it is reached
     * from a screen that has never had one. Opening only the founding hall would leave
     * the other one closed with nothing on screen saying so; opening all of them does
     * what the label promises. It stays hall-blind now that per-hall TIMES exist: a
     * manager reaching for this is reacting to something happening in the moment, and
     * making them pick a room first is friction on the wrong control.
     */
    await db.doc(CONTEXT_DOC).set(buildRideContextDoc(
        contexts.map(h => ({ ...h, window })),
        now,
        {
            overrideUntil: endOfLocalDay(now, timeZone),
            openedBy: context.auth.uid,
        },
    ));

    // Same one-shot rule as the scheduler, through the same function — so re-tapping
    // the button does not notify the congregation twice, and a founding hall that was
    // closed does not make the check read "nobody was open" and send anyway.
    const announce = announcementFor(previous, contexts.map(h => ({ ...h, window })));
    if (announce) await announceWindowOpened(announce);

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
