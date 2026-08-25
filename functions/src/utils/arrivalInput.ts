/**
 * Turning an untrusted callable payload into airport-pickup fields.
 *
 * Pure functions over plain objects, exported so they can be exhaustively tested
 * without a Firestore fake — the same reason `isValidPendingRide` and
 * `isAssignableTo` are exported out of globalAssignDriver. The truth table is the
 * part that goes wrong.
 *
 * THE TYPING TRAP THIS FILE EXISTS TO AVOID
 *
 * A callable's `data` is `any`, and NARROWING `any` WITH `!==` LEAVES IT `any`.
 * Validating `role !== 'driver' && role !== 'student'` therefore gives `role` no
 * type at all, and the next line indexing a `Record<UserRole, string>` with it is
 * unchecked. A functions deploy has already failed on exactly that shape — see
 * CLAUDE.md. Every value here is bound to a real type by `String(...)`,
 * `Number(...)` or an explicit annotation BEFORE it is checked, so what comes out
 * is typed and what went in never escapes.
 *
 * THE OTHER TRAP: A DATE THAT ROLLS OVER SILENTLY
 *
 * `/^\d{4}-\d{2}-\d{2}$/` accepts `2026-13-45`, and `Date.UTC(2026, 12, 45)`
 * cheerfully returns an instant in February 2027 rather than failing. A regex alone
 * would turn a typo into a request that sits on the board under the wrong month
 * with nothing reporting a problem. So the parts are range-checked and then
 * round-tripped: if formatting the parsed date does not give back the string that
 * came in, it was not a real date.
 */

import * as functions from 'firebase-functions';
import { zonedTimeToInstant } from './time';
import {
    airportZone,
    ArrivalDirection, WhatsappOn,
    MAX_ADDRESS, MAX_BAGS, MAX_DAYS_AHEAD, MAX_NAME, MAX_NOTES, MAX_PARTY_SIZE,
    MAX_PHONE_DIGITS, MAX_SHORT_TEXT, MIN_PHONE_DIGITS,
} from './arrival';

const bad = (message: string): never => {
    throw new functions.https.HttpsError('invalid-argument', message);
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^\d{2}:\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Trim to a real string and refuse anything longer than the cap. */
function text(value: unknown, label: string, max: number): string {
    const out: string = String(value ?? '').trim();
    if (out.length > max) bad(`Keep ${label} under ${max} characters`);
    return out;
}

/** As `text`, but empty is refused. */
function required(value: unknown, label: string, max: number): string {
    const out = text(value, label, max);
    if (!out) bad(`${label} is required`);
    return out;
}

/** Empty becomes undefined, so an absent optional is absent rather than ''. */
function optional(value: unknown, label: string, max: number): string | undefined {
    return text(value, label, max) || undefined;
}

/**
 * A phone number, checked by DIGIT COUNT rather than by shape.
 *
 * Punctuation is stripped before counting, because `+91 98765 43210`,
 * `+919876543210` and `(987) 654-3210` are the same number typed by three people and
 * a regex over the whole string would refuse two of them. The bounds are the E.164
 * envelope and the reasoning for leaving the exact per-country length to the client
 * is on MIN_PHONE_DIGITS in ./arrival.
 *
 * NOT normalised to E.164 here. The stored string is what a Sarthi taps to call and
 * what `waLink` strips again, and rewriting it server-side would mean guessing a
 * country code for a number typed without one — turning a reachable local number
 * into an unreachable foreign one.
 */
function phoneDigits(value: string): number {
    return value.replace(/\D/g, '').length;
}

function checkPhone(value: string, label: string): string {
    const digits = phoneDigits(value);
    if (digits < MIN_PHONE_DIGITS || digits > MAX_PHONE_DIGITS) {
        bad(`${label} must have between ${MIN_PHONE_DIGITS} and ${MAX_PHONE_DIGITS} digits`);
    }
    return value;
}

/** As `required`, plus the digit count. */
function requiredPhone(value: unknown, label: string): string {
    return checkPhone(required(value, label, MAX_NAME), label);
}

/** As `optional`, plus the digit count when one was actually given. */
function optionalPhone(value: unknown, label: string): string | undefined {
    const out = optional(value, label, MAX_NAME);
    return out ? checkPhone(out, label) : undefined;
}

function count(value: unknown, label: string, min: number, max: number): number {
    const out = Number(value);
    if (!Number.isInteger(out) || out < min || out > max) {
        bad(`${label} must be a whole number between ${min} and ${max}`);
    }
    return out;
}

/**
 * A calendar date that survives being parsed and re-formatted.
 *
 * The round-trip is the check that catches `2026-02-30` and `2026-13-01`, both of
 * which the regex accepts and `Date.UTC` silently rolls over.
 */
function dateKey(value: unknown, label: string): string {
    const out: string = String(value ?? '').trim();
    if (!DATE_KEY.test(out)) bad(`${label} must be YYYY-MM-DD`);

    const [year, month, day] = out.split('-').map(Number);
    const asUtc = new Date(Date.UTC(year, month - 1, day));
    const pad = (n: number) => String(n).padStart(2, '0');
    const roundTrip =
        `${asUtc.getUTCFullYear()}-${pad(asUtc.getUTCMonth() + 1)}-${pad(asUtc.getUTCDate())}`;

    if (roundTrip !== out) bad(`${label} is not a real date`);
    return out;
}

function clockTime(value: unknown, label: string): string {
    const out: string = String(value ?? '').trim();
    if (!CLOCK_TIME.test(out)) bad(`${label} must be HH:MM`);

    const [hour, minute] = out.split(':').map(Number);
    if (hour > 23 || minute > 59) bad(`${label} is not a real time`);
    return out;
}

// ============================================
// FLIGHT
// ============================================

export interface ParsedFlight {
    arrivalDate: string;
    arrivalTime: string;
    arrivalAt: string;
    airportCode: string;
    airline?: string;
    flightNumber?: string;
    terminal?: string;
    isInternational: boolean;
}

/**
 * The flight half of a request. Shared by `requestAirportPickup` and by
 * `updateAirportPickup`'s `editFlight` action, because a flight time that moves has
 * to be validated exactly as strictly as one that is filed.
 *
 * `congregationZone` is the fallback from `settings/main.timeZone`, passed in rather
 * than read here so this stays pure. An airport not in the table resolves to it —
 * right for the whole Eastern seaboard, wrong by an hour or three further west, and
 * the honest limitation is recorded on AIRPORTS itself.
 *
 * `now` is a parameter so the future-date check is testable without waiting.
 */
export function parseFlight(
    data: any,
    congregationZone: string,
    now: Date = new Date(),
): ParsedFlight {
    const arrivalDate = dateKey(data?.arrivalDate, 'The arrival date');
    const arrivalTime = clockTime(data?.arrivalTime, 'The arrival time');

    const airportCode: string = String(data?.airportCode ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(airportCode)) {
        bad('The airport code must be three letters, like BOS');
    }
    // Unknown-but-well-formed codes are ACCEPTED, not refused. The table is a zone
    // lookup, not an allow-list: refusing a real airport nobody had added yet would
    // mean a traveller cannot file a request at all, which is a worse failure than
    // an arrival time read in the congregation's zone.
    const zone = airportZone(airportCode, congregationZone);
    const arrivalAt = zonedTimeToInstant(arrivalDate, arrivalTime, zone);

    const at = new Date(arrivalAt).getTime();
    if (Number.isNaN(at)) bad('That arrival date and time could not be understood');
    if (at <= now.getTime()) bad('That arrival time has already passed');
    if (at > now.getTime() + MAX_DAYS_AHEAD * DAY_MS) {
        bad('That arrival date is too far ahead — check the year');
    }

    return {
        arrivalDate,
        arrivalTime,
        arrivalAt,
        airportCode,
        airline: optional(data?.airline, 'the airline', MAX_NAME),
        flightNumber: optional(data?.flightNumber, 'the flight number', MAX_NAME),
        terminal: optional(data?.terminal, 'the terminal', MAX_NAME),
        isInternational: data?.isInternational === true,
    };
}

// ============================================
// THE REST OF A NEW REQUEST
// ============================================

export interface ParsedFamilyContact {
    name: string;
    relationship: string;
    phone: string;
    hasWhatsapp: boolean;
    preferredLanguage?: string;
}

export interface ParsedTrip {
    direction: ArrivalDirection;
    partySize: number;
    largeBags: number;
    cabinBags: number;
    /**
     * All three are OPTIONAL TOGETHER. Somebody filing from Ahmedabad a month before
     * they fly often does not yet know where they are staying, and refusing the
     * request over it left them with no way to ask at all.
     */
    dropoffAddress?: string;
    dropoffLat?: number;
    dropoffLng?: number;
    hasUsWorkingPhone: boolean;
    meetingPointNote?: string;
    needsStopOnTheWay?: string;
    notes?: string;
}

export interface ParsedPerson {
    fullName: string;
    preferredName?: string;
    dateOfBirth: string;
    email: string;
    phone: string;
    altPhone?: string;
    whatsappOn: WhatsappOn;
    university?: string;
    familyContact: ParsedFamilyContact | null;
}

export function parseTrip(data: any): ParsedTrip {
    // Only 'arrival' is reachable from the UI, but the field is validated rather
    // than hardcoded so turning departures on later is a UI change and not a
    // migration. An unrecognised value is refused, not defaulted — a silent default
    // here would file a departure as an arrival.
    const rawDirection: string = String(data?.direction ?? 'arrival');
    if (rawDirection !== 'arrival' && rawDirection !== 'departure') {
        bad('Direction must be arrival or departure');
    }
    const direction: ArrivalDirection = rawDirection === 'departure' ? 'departure' : 'arrival';

    /**
     * THE DESTINATION IS OPTIONAL, AND SO IS ITS LOCATION.
     *
     * It used to be required, and both halves of that were wrong for the person this
     * service exists for: somebody filing a month before they fly frequently does not
     * know their address yet, and somebody who knows the name of their dorm cannot
     * always make the autocomplete offer it. Refusing them meant no request at all,
     * which is a worse outcome than a card a Sarthi has to ask one question about.
     *
     * So free text is accepted WITHOUT coordinates. What the coordinates still buy is
     * the address seeding in `updateAirportPickup`'s completion — that is guarded on
     * a usable pair, so an ungeocoded address simply is not copied to the profile and
     * the traveller is asked for it on the normal setup screen instead.
     *
     * 0,0 is not treated as a location. It is the "never geocoded" placeholder that
     * `resolveHomeCoords` rejects, and seeding it would put a Sarthi in the Atlantic.
     */
    const dropoffAddress = optional(data?.dropoffAddress, 'the destination address', MAX_ADDRESS);
    const rawLat: number = Number(data?.dropoffLat);
    const rawLng: number = Number(data?.dropoffLng);
    const geocoded = Number.isFinite(rawLat) && Number.isFinite(rawLng)
        && !(rawLat === 0 && rawLng === 0);
    // Checked only when there IS a pair. An out-of-range value is still a typo worth
    // refusing rather than storing — but an absent one is now legitimate.
    if (geocoded && (Math.abs(rawLat) > 90 || Math.abs(rawLng) > 180)) {
        bad('That destination location is not on Earth');
    }
    // A location with no address is meaningless on the card, so it is dropped with it.
    const hasDestination = Boolean(dropoffAddress);

    return {
        direction,
        partySize: count(data?.partySize, 'The number of people', 1, MAX_PARTY_SIZE),
        largeBags: count(data?.largeBags, 'The number of large bags', 0, MAX_BAGS),
        cabinBags: count(data?.cabinBags, 'The number of cabin bags', 0, MAX_BAGS),
        dropoffAddress,
        dropoffLat: hasDestination && geocoded ? rawLat : undefined,
        dropoffLng: hasDestination && geocoded ? rawLng : undefined,
        hasUsWorkingPhone: data?.hasUsWorkingPhone === true,
        meetingPointNote: optional(data?.meetingPointNote, 'the meeting point note', MAX_SHORT_TEXT),
        needsStopOnTheWay: optional(data?.needsStopOnTheWay, 'the stop on the way', MAX_SHORT_TEXT),
        notes: optional(data?.notes, 'the notes', MAX_NOTES),
    };
}

export function parsePerson(data: any, now: Date = new Date()): ParsedPerson {
    const rawWhatsapp: string = String(data?.whatsappOn ?? 'none');
    if (rawWhatsapp !== 'primary' && rawWhatsapp !== 'alt' && rawWhatsapp !== 'none') {
        bad('Say which number has WhatsApp: primary, alt or none');
    }
    const whatsappOn: WhatsappOn =
        rawWhatsapp === 'primary' ? 'primary' : rawWhatsapp === 'alt' ? 'alt' : 'none';

    const altPhone = optionalPhone(data?.altPhone, 'The other phone number');
    // A dead control otherwise: "WhatsApp is on my alternate number" with no
    // alternate number renders a button that opens WhatsApp with nobody in it.
    if (whatsappOn === 'alt' && !altPhone) {
        bad('You chose the alternate number for WhatsApp but did not give one');
    }

    const dateOfBirth = dateKey(data?.dateOfBirth, 'The date of birth');
    const dob = new Date(`${dateOfBirth}T12:00:00Z`).getTime();
    if (dob > now.getTime()) bad('That date of birth is in the future');
    // 120 years. Not a validity rule so much as a typo catcher: a mistyped year is
    // the difference between an adult and a flagged minor on the Sarthi's card.
    if (now.getTime() - dob > 120 * 365.25 * DAY_MS) {
        bad('Check the year on that date of birth');
    }

    const familyName = text(data?.familyContact?.name, 'the family contact name', MAX_NAME);
    const familyPhone = text(data?.familyContact?.phone, 'the family contact phone', MAX_NAME);
    // Half a family contact is worse than none: a name with no number is a promise
    // of reassurance the app cannot keep. Require the pair or neither.
    if (Boolean(familyName) !== Boolean(familyPhone)) {
        bad('A family contact needs both a name and a phone number');
    }
    // Digit-checked only once we know there is one, so "no family contact" stays a
    // legitimate answer rather than failing as a zero-digit number.
    if (familyPhone) checkPhone(familyPhone, "The family contact's phone number");

    const familyLanguage = optional(
        data?.familyContact?.preferredLanguage, 'the preferred language', MAX_NAME);

    return {
        fullName: required(data?.fullName, 'The full name', MAX_NAME),
        preferredName: optional(data?.preferredName, 'the preferred name', MAX_NAME),
        dateOfBirth,
        email: required(data?.email, 'The email address', MAX_NAME),
        phone: requiredPhone(data?.phone, 'The phone number'),
        altPhone,
        whatsappOn,
        university: optional(data?.university, 'the university', MAX_NAME),
        familyContact: familyName
            ? {
                name: familyName,
                relationship: text(data?.familyContact?.relationship, 'the relationship', MAX_NAME),
                phone: familyPhone,
                hasWhatsapp: data?.familyContact?.hasWhatsapp === true,
                // Conditional spread, not `preferredLanguage: optional(...)`. This
                // object goes into Firestore NESTED, and `compact` at the write site
                // is shallow — so an undefined here survives the strip and throws
                // for real, while the fake Firestore in the tests accepts it. Found
                // by requestAirportPickup.test.ts, which walks every leaf.
                ...(familyLanguage ? { preferredLanguage: familyLanguage } : {}),
            }
            : null,
    };
}

/**
 * How long a record is kept, per compliance D7.
 *
 * Deliberately crude: the retention schedule tolls for minors until majority plus a
 * limitation period, and computing that properly needs a decision from counsel that
 * has not been taken. Seven years from the trip is longer than the three-year
 * personal-injury window used for a ride with no minor aboard, so nothing is
 * destroyed early. NOTHING PURGES ON THIS FIELD YET.
 *
 * ponytail: flat seven years, no tolling. Upgrade path is docs/compliance/privacy-and-data.md §5,
 * which needs the term confirmed before a purge job can honour it.
 */
export function retainUntilFor(arrivalAt: string): string {
    const at = new Date(arrivalAt);
    return new Date(Date.UTC(at.getUTCFullYear() + 7, at.getUTCMonth(), at.getUTCDate()))
        .toISOString();
}

/**
 * Drop keys whose value is `undefined`.
 *
 * THE ADMIN SDK IS NOT CONFIGURED WITH `ignoreUndefinedProperties`, so a single
 * undefined value anywhere in a payload makes the whole write throw — and the fake
 * Firestore used in these tests accepts it happily, so the failure only appears in
 * production. globalAssignDriver carries the same warning at its roster build, and
 * solves it with a conditional spread per field. With eight optional fields across
 * three parsed objects that is eight chances to forget one, so: one pass at the
 * write site instead.
 *
 * SHALLOW, and callers must know it. `familyContact` is nested and has an optional
 * `preferredLanguage`, so it is built with a conditional spread in `parsePerson`
 * rather than relying on this. A recursive version would be smaller to reason about
 * but would also silently rewrite arrays and Timestamps, which is worse.
 */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) out[key] = value;
    }
    return out as Partial<T>;
}
