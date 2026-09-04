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
import { resolveCurrentEvent } from '../utils/events';
import { applyHallException, toVenue, type EventException } from '../utils/recurrence';
import { notifyEveryone } from '../utils/notifications';
import { drainAttendanceDelete } from '../http/deleteSabhaEvent';
import { SEED_MARKER_DOC } from '../utils/events';
import { assertApprovedManager } from '../utils/authz';
import { readRecurrence } from '../http/sabhaRecurrence';
import { FOUNDING_LOCATION_ID } from '../constants/tenancy';
import { eventIdFor } from '../utils/locations';
import { locationsOrFoundingFallback, resolveVenue } from '../utils/settings';

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

/** One hall's published window. */
export interface HallContext {
    locationId: string;
    event: CurrentEvent | null;
    window: ScheduleWindow;
}

/**
 * The `system/rideContext` document, per hall, as ONE pure function.
 *
 * Extracted so the shape can be asserted directly. This scheduler had no test file at
 * all, and the property that matters most about this change is *"with one hall the
 * published document is identical to what it published before"* — which is a statement
 * about a value, not about a Firestore write.
 *
 * ── WHY THE TOP-LEVEL FIELDS SURVIVE ────────────────────────────────────────────────
 *
 * Every client reads `rideType`, `venue` and `eventId` from the TOP LEVEL of this
 * document. This is an installed PWA — `src/utils/swUpdate.ts` warns that a driver can
 * keep a tab alive for weeks — so moving those fields under `byLocation` would leave
 * every un-refreshed phone reading `undefined`, which resolves to "no sabha scheduled"
 * and a refusal to dispatch. Silent, and only for the people who never tap the update
 * banner.
 *
 * So the top level stays, as a COMPATIBILITY AGGREGATE with a stated meaning: it is the
 * FOUNDING hall's window, falling back to the first active hall. Not the widest window
 * across halls, which was the other candidate — a stale client reading "open" when the
 * rider's own hall is closed would let them file a request nothing can serve, whereas
 * reading "closed" when another hall is open merely makes them wait and update. The
 * conservative direction is the right one for a field nobody can see the age of.
 *
 * With exactly one hall — every day until a manager adds a second — the aggregate IS
 * that hall, so the document is byte-identical to the single-hall shape.
 */
export function buildRideContextDoc(
    halls: ReadonlyArray<HallContext>,
    now: Date,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    const primary = halls.find(h => h.locationId === FOUNDING_LOCATION_ID) ?? halls[0];

    const byLocation: Record<string, unknown> = {};
    for (const hall of halls) {
        byLocation[hall.locationId] = {
            ...hall.window,
            ...(hall.event ?? { eventId: null }),
            // Lets a screen say "you cancelled everything" instead of leaving
            // "No rides available" looking like a malfunction.
            calendarStatus: hall.event ? 'ok' : 'no-scheduled-event',
        };
    }

    return {
        ...(primary?.window ?? { rideType: null, displayText: 'No rides available', timeContext: '' }),
        ...(primary?.event ?? { eventId: null }),
        calendarStatus: primary?.event ? 'ok' : 'no-scheduled-event',
        byLocation,
        /**
         * The halls this document actually describes.
         *
         * Published so a client can tell "my hall is closed" from "my hall is not in
         * here at all". The second is a server fault and must render as one — without
         * this list a missing `byLocation` key is indistinguishable from a closed
         * window, which is the ambiguity `calendarStatus` was invented to remove.
         */
        locationIds: halls.map(h => h.locationId),
        overrideUntil: null,
        lastUpdated: now.toISOString(),
        ...extra,
    };
}

/**
 * Build one gathering per open hall.
 *
 * ONE SHARED DATE, and by default one shared pair of times — both halls on the same
 * evening at the same time is what the owner asked for, so `resolveCurrentEvent`
 * answers ONCE for the evening and the fan-out happens here.
 *
 * A HALL MAY DIVERGE, for the rare case the owner also asked for. `hallExceptions`
 * holds that hall's own `events/{date}__{hall}` document, and `applyHallException`
 * lays it over the evening: different times, a different venue, or not this hall
 * tonight at all. A hall with no document is the ordinary case and takes the evening
 * unchanged, so the common path is identical to before.
 *
 * A closed hall gets `event: null`, which its `byLocation` slice then publishes as
 * `calendarStatus: 'no-scheduled-event'` — the same shape a closed evening produces,
 * because to a rider standing outside that hall it means the same thing.
 *
 * The gathering's KEY differs per hall (`eventIdFor`), because two halls cannot share
 * one `events/{date}` document, and that key is also the attendance key.
 */
export function hallContexts(
    scheduled: { date: string; startTime: string; endTime: string; venue: unknown; agenda: string } | null,
    halls: ReadonlyArray<{ id: string; venue: unknown }>,
    now: Date,
    timeZone: string,
    requestsOpenTime: unknown,
    hallExceptions: ReadonlyMap<string, EventException> = new Map(),
): HallContext[] {
    return halls.map(hall => {
        // Venue is resolved AFTER the hall layer, so a hall that overrides its venue
        // for one evening still beats its own standing venue, and both still beat
        // settings/main. `resolveVenue` does the choosing, as it always has.
        const forHall = applyHallException(
            scheduled && {
                ...scheduled,
                venue: toVenue(scheduled.venue),
                agenda: scheduled.agenda,
            },
            hallExceptions.get(hall.id) ?? null,
        );
        const event = forHall
            ? buildCurrentEvent(scheduled!.date, forHall.startTime, forHall.endTime, timeZone, {
                venue: resolveVenue(forHall.venue, hall.venue as never) as never,
                agenda: forHall.agenda,
                requestsOpenTime,
                eventId: eventIdFor(scheduled!.date, hall.id) ?? scheduled!.date,
                locationId: hall.id,
            })
            : null;
        return { locationId: hall.id, event, window: resolveScheduleWindow(now, event, timeZone) };
    });
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
 * Which window, if any, should be announced this tick.
 *
 * ONE ANNOUNCEMENT PER PHASE PER EVENING, however many halls are open. The text names
 * no time and no hall — "Ride requests are open" — so it is one piece of news for the
 * whole congregation, and sending it twice because two rooms opened two hours apart
 * would be spam to whoever was already served.
 *
 * The rule: announce when SOME hall now has this ride type and NO hall had it before.
 * That is the first hall to open, and it needs no new stored state — every hall's
 * previous `rideType` is already published in `byLocation` each tick.
 *
 * Reading all the halls rather than the founding one is the whole point. The previous
 * version announced on the founding hall's transition against the TOP-LEVEL previous
 * rideType, and both halves of that break the moment halls can diverge:
 *
 *   - A founding hall cancelled for one evening leaves the top-level rideType null all
 *     night, so an evening held entirely at the other hall announced NOTHING. Riders
 *     with no other prompt simply never heard the window had opened.
 *   - Read against per-hall state instead but still keyed on one hall, and the top-level
 *     null never advances, so the other hall's open window re-announces EVERY MINUTE.
 *
 * @param previous the `system/rideContext` document as it was before this tick.
 */
export function announcementFor(
    previous: Record<string, unknown> | null | undefined,
    contexts: readonly HallContext[],
): ScheduleWindow | null {
    const byLocation = previous?.byLocation as Record<string, { rideType?: unknown }> | undefined;

    const previousFor = (locationId: string): unknown => {
        const slice = byLocation?.[locationId];
        // THE FOUNDING HALL FALLS BACK TO THE TOP LEVEL, because on the first tick
        // after this deploys `byLocation` does not exist yet. Without the fallback that
        // tick reads "nobody was open" and re-announces a window that has been open for
        // two days. Same reason the attendance header comparison carries this fallback.
        if (slice) return slice.rideType ?? null;
        if (locationId === FOUNDING_LOCATION_ID) return previous?.rideType ?? null;
        return null;
    };

    for (const hall of contexts) {
        const rideType = hall.window.rideType;
        if (!rideType) continue;
        if (contexts.some(other => previousFor(other.locationId) === rideType)) continue;
        return hall.window;
    }
    return null;
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
