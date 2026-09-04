/**
 * How `system/rideContext` is SHAPED, separately from when it is written.
 *
 * Pure functions, no Firestore. They were inside `updateRideTypeContext` until
 * `deleteSabhaEvent` needed them too — and that would have been a cycle, because the
 * scheduler already imports `drainAttendanceDelete` back out of `deleteSabhaEvent` to
 * finish an interrupted cascade. A cycle here would resolve at runtime and break the
 * day someone reordered an import, so the shared half moved out instead.
 *
 * Both writers of this document therefore build it through the same code. That matters
 * more than the cycle did: the delete path used to write the document with a partial
 * `set`, which erased `byLocation` and `locationIds` for up to a minute.
 */

import {
    resolveScheduleWindow, buildCurrentEvent, ScheduleWindow, CurrentEvent,
} from './schedule';
import { applyHallException, toVenue, type EventException } from './recurrence';
import { FOUNDING_LOCATION_ID } from '../constants/tenancy';
import { eventIdFor } from './locations';
import { resolveVenue } from './settings';

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

