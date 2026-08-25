/**
 * Airport Seva — the tables the client and the server must agree about.
 *
 * MIRROR of functions/src/utils/arrival.ts, and that file carries the reasoning for
 * what lives here. Separate tsconfigs, no shared path, same arrangement as
 * roles.ts / schedule.ts / tenancy.ts.
 *
 * The two are pinned together by tests/quality/arrival-table-parity.test.ts. Read
 * that test before editing either copy: it compares the transition table, the
 * urgency thresholds, the airport zones and the caps structurally, so reformatting
 * is free and a changed meaning is not.
 *
 * The cost of drift, in the two directions:
 *
 *   Client MORE permissive than the server → a button that renders, is tapped, and
 *   returns failed-precondition. A dead control.
 *
 *   Client LESS permissive → an action the server would have allowed is never
 *   offered. A capability that silently disappears, which is harder to notice and
 *   has happened in this repo before.
 */

export const PICKUPS_COLLECTION = 'airportPickups';
export const PROFILES_COLLECTION = 'airportProfiles';

/**
 * Which way the traveller is going.
 *
 * Written on EVERY document, never omitted, so there is no absent-means-arrival
 * default to get wrong. `seatsRequested` and `rideType` both took the other route
 * and both needed a paragraph of explanation on the type; this one costs a string
 * per document and needs none. Only 'arrival' is reachable from the UI today.
 */
export type ArrivalDirection = 'arrival' | 'departure';

export type ArrivalStatus =
    | 'open'        // on the board, nobody has taken it
    | 'claimed'     // a Sarthi has taken it
    | 'met'         // the Sarthi has the passenger — this is when the family can be told
    | 'completed'   // dropped off
    | 'cancelled'   // withdrawn by the traveller or a coordinator
    | 'no_show';    // they never found each other

export type ArrivalAction =
    | 'claim'
    | 'release'
    | 'met'
    | 'completed'
    | 'no_show'
    | 'cancel'
    | 'editFlight'
    | 'reassign'
    // Not a state change: the Sarthi opened the pre-filled WhatsApp message to the
    // family. Stamped so the board can tell "told them" from "meant to" — without
    // it, the one reassurance the family was promised can quietly never go.
    | 'familyNotified';

/** Which number the traveller can actually be reached on via WhatsApp. */
export type WhatsappOn = 'primary' | 'alt' | 'none';

/**
 * The transition table. An action absent from a status's list is refused by the
 * server AND not rendered by the client — one table, so those cannot disagree.
 *
 * `completed` is reachable from 'claimed' as well as 'met' ON PURPOSE. A Sarthi who
 * drops someone home without having tapped "I've got them" would otherwise be
 * looking at a button that cannot work, and a stuck record is worse than a slightly
 * imprecise one.
 *
 * `reassign` is reachable from 'no_show' for the same reason: a wrongly-tapped
 * no-show would otherwise be terminal, and the traveller would have to file a
 * second request while standing in an airport.
 */
export const ALLOWED_FROM: Record<ArrivalAction, ArrivalStatus[]> = {
    claim: ['open'],
    release: ['claimed'],
    met: ['claimed'],
    completed: ['claimed', 'met'],
    no_show: ['claimed', 'met'],
    cancel: ['open', 'claimed'],
    editFlight: ['open', 'claimed'],
    reassign: ['claimed', 'no_show'],
    // From 'claimed' as well as 'met', because a Sarthi who has the passenger in the
    // car and has not yet tapped "I've got them" should still be able to reassure
    // the family. Refusing would render a button that cannot work.
    familyNotified: ['claimed', 'met'],
};

/** The status an action leaves behind. `editFlight` changes fields, not state. */
export const RESULT_OF: Record<ArrivalAction, ArrivalStatus | null> = {
    claim: 'claimed',
    release: 'open',
    met: 'met',
    completed: 'completed',
    no_show: 'no_show',
    cancel: 'cancelled',
    editFlight: null,
    reassign: 'claimed',
    familyNotified: null,
};

export function canRun(action: ArrivalAction, from: ArrivalStatus): boolean {
    return ALLOWED_FROM[action].includes(from);
}

/** Nothing transitions out of these. */
export const TERMINAL: ArrivalStatus[] = ['completed', 'cancelled'];

// ============================================
// URGENCY
// ============================================

const HOUR_MS = 60 * 60 * 1000;

/**
 * The four points at which an unclaimed arrival is worth waking a coordinator for.
 *
 * Ordered widest-first. `bandFor` returns the TIGHTEST band already crossed, which
 * is what stops three alerts firing at once for a request filed nine hours before
 * landing — and what makes `alertsSent` a sufficient record: time only ever
 * decreases, so a band that has been passed can never come round again.
 */
export const ALERT_BANDS = ['48h', '24h', '10h', '2h'] as const;
export type AlertBand = (typeof ALERT_BANDS)[number];

const BAND_HOURS: Record<AlertBand, number> = { '48h': 48, '24h': 24, '10h': 10, '2h': 2 };

export function bandFor(msRemaining: number): AlertBand | null {
    let tightest: AlertBand | null = null;
    for (const band of ALERT_BANDS) {
        if (msRemaining <= BAND_HOURS[band] * HOUR_MS) tightest = band;
    }
    return tightest;
}

/**
 * What the card shows. Separate from the alert bands because a chip needs a small
 * number of legible states and the alerts need four discrete firing points.
 *
 * 'overdue' is its own level rather than folded into 'critical': a plane that has
 * landed with nobody assigned is a different problem from one landing in an hour,
 * and a board that renders them the same hides the one that needs a phone call.
 */
export type UrgencyLevel = 'calm' | 'soon' | 'urgent' | 'critical' | 'overdue';

export function urgencyOf(arrivalAt: string, now: Date = new Date()): UrgencyLevel {
    const remaining = new Date(arrivalAt).getTime() - now.getTime();
    if (Number.isNaN(remaining)) return 'calm';
    if (remaining < 0) return 'overdue';
    if (remaining <= 10 * HOUR_MS) return 'critical';
    if (remaining <= 24 * HOUR_MS) return 'urgent';
    if (remaining <= 48 * HOUR_MS) return 'soon';
    return 'calm';
}

// ============================================
// AIRPORTS
// ============================================

export interface Airport {
    code: string;
    name: string;
    /** IANA identifier, never a fixed offset — daylight saving is the zone database's job. */
    zone: string;
}

/**
 * The airports this congregation actually collects people from, plus the handful
 * anyone connecting through would land at.
 *
 * NOT exhaustive, and not meant to be. An unlisted code falls back to the
 * congregation's own zone from `settings/main.timeZone`, which is right for the
 * whole Eastern seaboard and wrong by an hour or three further west. That is a real
 * limitation and it is why `airportZone` takes an explicit fallback rather than
 * guessing: the caller has read the setting and knows what it chose.
 */
export const AIRPORTS: Airport[] = [
    { code: 'BOS', name: 'Boston Logan', zone: 'America/New_York' },
    { code: 'JFK', name: 'New York JFK', zone: 'America/New_York' },
    { code: 'EWR', name: 'Newark', zone: 'America/New_York' },
    { code: 'LGA', name: 'New York LaGuardia', zone: 'America/New_York' },
    { code: 'PHL', name: 'Philadelphia', zone: 'America/New_York' },
    { code: 'IAD', name: 'Washington Dulles', zone: 'America/New_York' },
    { code: 'ATL', name: 'Atlanta', zone: 'America/New_York' },
    { code: 'DTW', name: 'Detroit', zone: 'America/Detroit' },
    { code: 'ORD', name: 'Chicago O’Hare', zone: 'America/Chicago' },
    { code: 'DFW', name: 'Dallas Fort Worth', zone: 'America/Chicago' },
    { code: 'IAH', name: 'Houston', zone: 'America/Chicago' },
    { code: 'DEN', name: 'Denver', zone: 'America/Denver' },
    { code: 'PHX', name: 'Phoenix', zone: 'America/Phoenix' },
    { code: 'SEA', name: 'Seattle', zone: 'America/Los_Angeles' },
    { code: 'SFO', name: 'San Francisco', zone: 'America/Los_Angeles' },
    { code: 'LAX', name: 'Los Angeles', zone: 'America/Los_Angeles' },
];

const BY_CODE: Record<string, Airport> = AIRPORTS.reduce(
    (acc, a) => { acc[a.code] = a; return acc; },
    {} as Record<string, Airport>,
);

export function airportByCode(code: string): Airport | null {
    return BY_CODE[code.trim().toUpperCase()] ?? null;
}

/** The zone to read the traveller's stated arrival time in. */
export function airportZone(code: string, fallback: string): string {
    return airportByCode(code)?.zone ?? fallback;
}

/** For display. Falls back to the raw code rather than to an empty string. */
export function airportLabel(code: string): string {
    const airport = airportByCode(code);
    return airport ? `${airport.code} — ${airport.name}` : code.toUpperCase();
}

// ============================================
// CAPS
// ============================================
//
// NOT mirrored into firestore.rules, unlike the agenda, notice and feedback caps —
// and the difference is the point. Those collections are written directly by a
// client, so the rules are the only trust boundary and the cap has to live there
// too. These two collections are `allow create, update, delete: if false` for every
// client, so the callable IS the boundary and there is exactly one place to enforce
// them. A cap repeated into rules that can never fire would be a guard protecting
// nothing, and a second copy to drift.
//
// The form uses these same numbers so a traveller sees the limit before they submit
// rather than after — but the server does not trust that, because a client is a
// trust boundary even when it belongs to a manager.

export const MAX_NAME = 120;
export const MAX_SHORT_TEXT = 200;   // meetingPointNote, needsStopOnTheWay, specialNeeds
export const MAX_NOTES = 1000;
export const MAX_ADDRESS = 300;
export const MAX_PARTY_SIZE = 8;
export const MAX_BAGS = 20;
/** How far ahead somebody may file. Two years is generous; twenty is a typo. */
export const MAX_DAYS_AHEAD = 730;
