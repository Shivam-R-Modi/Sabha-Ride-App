/**
 * THE HALLS SABHA RUNS AT, AND HOW A GATHERING IS IDENTIFIED WHEN THERE IS MORE THAN
 * ONE OF THEM ON THE SAME EVENING.
 *
 * MIRRORED into functions/src/utils/locations.ts, byte for byte, and pinned by
 * tests/quality/location-table-parity.test.ts. Both sides decide dispatch from it and
 * neither can import the other: separate tsconfigs, no shared path. Same arrangement as
 * utils/arrival.ts and constants/notifications.ts.
 *
 * ── WHY AN EVENT ID IS NO LONGER JUST A DATE ────────────────────────────────────────
 *
 * `events/{YYYY-MM-DD}` used the date as the document id, so two gatherings could not
 * share a date. `docs/roadmap.md` §9 records that as deliberate — date-as-id buys free
 * chronological ordering, a "from today onward" query with no index, and a key shared
 * with attendance — and names suffixing as the way out if it ever became necessary.
 *
 * It has. So: **the founding hall keeps the bare date, every other hall gets
 * `${dateKey}__${locationId}`.**
 *
 * The bare-date special case is not tidiness, it is the entire migration. Every
 * `events/*`, `weeklyAttendance/*` and `statistics/*` document already written belongs
 * to the founding hall, and under this scheme its key is unchanged — so history needs
 * no move, and a backfill that touches records naming children is avoided.
 *
 * Verified lexicographic properties, all of which existing queries depend on:
 *
 *   '2026-08-07' < '2026-08-07__somerville' < '2026-08-08'
 *
 * so `documentId() >= today <= horizon` still selects the right window,
 * `orderBy(documentId())` is still chronological with halls grouped inside a date, and
 * `pastAgendas`' `documentId() < todayKey` still clears a suffixed doc for the 7th on
 * the 8th and not on the 7th.
 *
 * The one place that bites: a suffixed id on the EXACT horizon day sorts after the bare
 * horizon date, so the upper bound needs a day of slack. Named in
 * `LOOKAHEAD_NEEDS_SLACK` below so the next reader meets it before the bug does.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────────────
 *
 * `rides.eventId` keeps meaning **the gathering's date**, not a suffixed id. A ride
 * says which evening it is for in `eventId`/`eventDate` and which hall in `locationId`
 * — two fields, two facts. Stamping a suffixed id there would have `eventKeyFromRide`
 * reject its own field for failing the date pattern, and every date comparison in
 * dispatch would silently fall through to `eventDate`.
 */

import { toVenue, type Venue } from './recurrence';
import { FOUNDING_LOCATION_ID } from '../constants/tenancy';

export const EVENT_ID_SEPARATOR = '__';

/**
 * A hall id becomes part of an event id, so it is constrained rather than trusted.
 *
 * A `/` would change which document a key points at; a `.` is legal in a Firestore id
 * but not in a field path, and these ids are used as map keys on
 * `system/rideContext.byLocation`. Firestore also forbids ids matching `__.*__`, which
 * lower-case-and-hyphens cannot produce. Mirrored in firestore.rules
 * (`locationFieldsValid`) so a client cannot write one this rejects.
 */
export const LOCATION_ID_PATTERN = /^[a-z0-9-]+$/;

/** The same shape the server has always validated an event key against. */
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A range query's upper bound must be widened by this many days.
 *
 * `'2026-11-05__somerville' <= '2026-11-05'` is FALSE, so a suffixed gathering on the
 * exact horizon day falls outside `documentId() <= horizon` and vanishes. One extra day
 * of slack is cheaper to read than a `''` sentinel and does the same job.
 */
export const LOOKAHEAD_NEEDS_SLACK = 1;

/**
 * The document id for one gathering: one date, at one hall.
 *
 * Returns null on anything malformed rather than composing a key that points nowhere.
 * A guessed key here would read an empty document and report "no sabha scheduled",
 * which is indistinguishable from the truth.
 */
export function eventIdFor(dateKey: unknown, locationId: unknown): string | null {
    if (typeof dateKey !== 'string' || !DATE_KEY_PATTERN.test(dateKey)) return null;
    if (typeof locationId !== 'string' || !LOCATION_ID_PATTERN.test(locationId)) return null;
    // The founding hall keeps the bare date. See the header — this is the migration.
    if (locationId === FOUNDING_LOCATION_ID) return dateKey;
    return `${dateKey}${EVENT_ID_SEPARATOR}${locationId}`;
}

/**
 * Split an event id back into its date and its hall.
 *
 * A BARE DATE RESOLVES TO THE FOUNDING HALL, which is what makes every pre-existing
 * document readable without a backfill. Null for anything that is not one of the two
 * shapes — never a partial answer, because the callers use this to decide which pool a
 * rider belongs to.
 */
export function parseEventId(
    eventId: unknown,
): { dateKey: string; locationId: string } | null {
    if (typeof eventId !== 'string' || !eventId) return null;

    const at = eventId.indexOf(EVENT_ID_SEPARATOR);
    if (at === -1) {
        return DATE_KEY_PATTERN.test(eventId)
            ? { dateKey: eventId, locationId: FOUNDING_LOCATION_ID }
            : null;
    }

    const dateKey = eventId.slice(0, at);
    const locationId = eventId.slice(at + EVENT_ID_SEPARATOR.length);
    if (!DATE_KEY_PATTERN.test(dateKey)) return null;
    if (!LOCATION_ID_PATTERN.test(locationId)) return null;
    // A suffix naming the founding hall is not a shape this ever writes, and accepting
    // it would give one gathering two keys.
    if (locationId === FOUNDING_LOCATION_ID) return null;
    return { dateKey, locationId };
}

/**
 * The DATE half of an event id, or null.
 *
 * Exists because four separate places compare an event id against a date and would
 * quietly get the wrong answer on a suffixed one:
 *
 *   - `dayOfWeekForKey` does `.split('-').map(Number)`, so a suffixed id yields NaN,
 *     `coversDate` reads false, and the date is reported as **losing its sabha** —
 *     which makes `reconcileDate` cancel its rides.
 *   - `useUpcomingEvents` bounds its query at `documentId() >= rideContext.eventId`;
 *     a suffixed current event sorts after the bare date, so today's founding-hall
 *     gathering disappears from the manager's calendar during the sabha.
 *   - `deleteSabhaEvent`'s "today cannot be deleted" guard compares the id to today,
 *     and `'2026-08-07__x' <= '2026-08-07'` is false — the guard is bypassed.
 *   - `pastAgendas` compares against today's key.
 *
 * Every one of those must compare the extracted date, not the id.
 */
export function dateKeyOfEventId(eventId: unknown): string | null {
    return parseEventId(eventId)?.dateKey ?? null;
}

/**
 * Which hall a ride is for, or null when the ride does not say.
 *
 * NULL IS A REAL ANSWER AND CALLERS MUST REFUSE IT. There is deliberately no
 * "absent means the founding hall" default, which is the idiom this codebase uses
 * elsewhere (`seatsOf`, `rideType`, `isArriving`) — and it is the wrong tool here.
 *
 * Those defaults describe a real legacy population with one unambiguous correct value.
 * `scripts/tenancy.cjs verify` asserts that population is EMPTY for `locationId`: every
 * ride already carries it. So a default would be load-bearing for a set that does not
 * exist — never exercised, never checked against reality — and it would silently absorb
 * the one case that must be loud, which is a bug that drops the field.
 *
 * `isValidPendingRide`'s own comment already settles the argument: *"The first failure
 * is visible to a manager in the Waiting queue, the second sends a car to the wrong
 * place."*
 */
export function locationOfRide(ride: unknown): string | null {
    const r = ride as { locationId?: unknown } | null | undefined;
    const raw = r?.locationId;
    if (typeof raw !== 'string' || !LOCATION_ID_PATTERN.test(raw)) return null;
    return raw;
}

/** One hall, as `locations/{locationId}` holds it. */
export interface SabhaLocationRecord {
    id: string;
    name: string;
    venue: Venue;
    active: boolean;
    order: number;
}

/**
 * Clean one `locations/{id}` document, or reject it.
 *
 * Rejects rather than repairs, for the same reason `normaliseRecurrence` does: this is
 * read by the per-minute scheduler and by dispatch, and a half-read hall that puts
 * sabha at the wrong coordinates is worse than one that puts it nowhere. `toVenue` is
 * reused rather than re-validated — it already refuses non-finite pairs and the `0,0`
 * "never geocoded" placeholder, which as a venue would be the farthest point from every
 * rider and would therefore seed every single carload.
 */
export function normaliseLocation(id: unknown, raw: unknown): SabhaLocationRecord | null {
    if (typeof id !== 'string' || !LOCATION_ID_PATTERN.test(id)) return null;
    if (!raw || typeof raw !== 'object') return null;

    const d = raw as Record<string, unknown>;
    const venue = toVenue(d.venue);
    if (!venue) return null;

    const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim() : '';
    if (!name) return null;

    return {
        id,
        name,
        venue,
        // Only an explicit true opens a hall for business. Absent-means-active would
        // make a half-finished hall live the moment a manager saved it, with no Sarthi
        // able to serve it and riders stranding silently.
        active: d.active === true,
        order: typeof d.order === 'number' && Number.isFinite(d.order) ? d.order : 0,
    };
}

/**
 * The halls currently open for business, in display order.
 *
 * AN EMPTY RESULT IS A FAULT, NOT "CLOSED", and every caller must treat it that way. A
 * congregation always has somewhere to meet; no active hall means the seed is missing
 * or every document is malformed, and rendering that as "no sabha tonight" hides a
 * server problem behind an ordinary-looking screen. Compare `calendarStatus:
 * 'no-scheduled-event'`, which exists precisely so the two can be told apart.
 */
export function activeLocations(
    records: ReadonlyArray<SabhaLocationRecord>,
): SabhaLocationRecord[] {
    return records
        .filter(r => r.active)
        // `order` then `name`, and `id` last so the list cannot reshuffle between
        // renders when a manager gives two halls the same order.
        .sort((a, b) => a.order - b.order
            || a.name.localeCompare(b.name)
            || a.id.localeCompare(b.id));
}

/**
 * One hall's slice of `system/rideContext`, or the document's own top level.
 *
 * THE SHARED READ, so every client surface resolves a hall's window the same way and
 * the server's `globalAssignDriver` and `studentReadyToLeave` do the same thing.
 *
 * `locationId` null asks for the AGGREGATE — the founding hall's window, published at
 * the top level for bundles that predate halls. That is what a rider who has not
 * chosen a hall yet should see.
 *
 * A missing slice while `byLocation` EXISTS is a fault, not a closed window, and the
 * caller is told which: `{ slice: null, fault: true }`. Rendering that as "no sabha
 * tonight" would make a broken scheduler indistinguishable from a quiet evening —
 * which is the ambiguity `calendarStatus: 'no-scheduled-event'` was invented to remove.
 */
export function windowForLocation(
    published: Record<string, unknown> | null | undefined,
    locationId: string | null,
): { slice: Record<string, unknown> | null; fault: boolean } {
    if (!published) return { slice: null, fault: false };

    const byLocation = published.byLocation as Record<string, Record<string, unknown>> | undefined;
    if (!locationId) return { slice: published, fault: false };

    // Absent entirely: the first minute after the per-hall context deploys, and a
    // bundle running against an older server. The aggregate is the right answer then.
    if (!byLocation) return { slice: published, fault: false };

    const slice = byLocation[locationId];
    return slice ? { slice, fault: false } : { slice: null, fault: true };
}
