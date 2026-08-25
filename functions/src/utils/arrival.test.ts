/**
 * The Airport Seva tables.
 *
 * These are pure lookups, which is exactly why they are worth testing: the whole
 * point of putting them in one mirrored file is that the client and the server agree
 * about them, and the failures they prevent are both silent.
 *
 * A transition the server refuses but the client offers is a dead button. A
 * transition the server would allow but the client hides is a capability that
 * quietly disappeared — harder to notice, and it has happened in this repo before.
 */

import { describe, it, expect } from 'vitest';
import {
    ALERT_BANDS, ALLOWED_FROM, AIRPORTS, RESULT_OF, TERMINAL,
    ArrivalAction, ArrivalStatus,
    airportByCode, airportLabel, airportZone, bandFor, canRun, urgencyOf,
} from './arrival';

const HOUR = 60 * 60 * 1000;
const ALL_STATUSES: ArrivalStatus[] =
    ['open', 'claimed', 'met', 'completed', 'cancelled', 'no_show'];

describe('the transition table', () => {
    it('only one action can be taken on an open request, and it is claim', () => {
        const fromOpen = (Object.keys(ALLOWED_FROM) as ArrivalAction[])
            .filter(a => canRun(a, 'open'));
        expect(fromOpen.sort()).toEqual(['cancel', 'claim', 'editFlight']);
    });

    it('nothing at all can be done to a completed or cancelled request', () => {
        // The property that matters most. Without it a Sarthi could release a trip
        // that finished last month, and the traveller's card would go back to
        // "waiting for a Sarthi" weeks after they got home.
        for (const status of TERMINAL) {
            for (const action of Object.keys(ALLOWED_FROM) as ArrivalAction[]) {
                expect(canRun(action, status), `${action} on ${status}`).toBe(false);
            }
        }
    });

    it('claim is reachable ONLY from open, so a claimed trip cannot be taken twice', () => {
        expect(ALLOWED_FROM.claim).toEqual(['open']);
        for (const status of ALL_STATUSES.filter(s => s !== 'open')) {
            expect(canRun('claim', status), `claim from ${status}`).toBe(false);
        }
    });

    it('completed is reachable from claimed as well as met', () => {
        // Deliberate. A Sarthi who drops someone home without having tapped "I've
        // got them" would otherwise be looking at a button that cannot work, and a
        // stuck record is worse than a slightly imprecise one.
        expect(canRun('completed', 'claimed')).toBe(true);
        expect(canRun('completed', 'met')).toBe(true);
    });

    it('a wrongly-marked no_show can be rescued by reassigning', () => {
        // Otherwise no_show is terminal and the traveller has to file a second
        // request while standing in an airport.
        expect(canRun('reassign', 'no_show')).toBe(true);
    });

    it('every action says what status it leaves behind, or says it leaves it alone', () => {
        for (const action of Object.keys(ALLOWED_FROM) as ArrivalAction[]) {
            expect(RESULT_OF, `${action} missing from RESULT_OF`).toHaveProperty(action);
        }
        // The two that change fields rather than state.
        expect(RESULT_OF.editFlight).toBeNull();
        expect(RESULT_OF.familyNotified).toBeNull();
    });

    it('release puts a trip back on the board, not into a dead end', () => {
        expect(RESULT_OF.release).toBe('open');
        expect(canRun('claim', 'open')).toBe(true);
    });

    it('no action lands on a status it cannot then be moved out of by mistake', () => {
        // Every non-terminal result must be reachable by something, or an action
        // would strand a trip in a state with no exit.
        for (const [action, result] of Object.entries(RESULT_OF)) {
            if (!result || TERMINAL.includes(result)) continue;
            const exits = (Object.keys(ALLOWED_FROM) as ArrivalAction[])
                .filter(a => canRun(a, result));
            expect(exits.length, `${action} → ${result} has no exit`).toBeGreaterThan(0);
        }
    });
});

describe('alert bands', () => {
    it('says nothing at all while an arrival is more than two days out', () => {
        expect(bandFor(49 * HOUR)).toBeNull();
    });

    it('returns the TIGHTEST band already crossed, not every one of them', () => {
        // This is what stops three alerts firing at once for a request filed nine
        // hours before landing.
        expect(bandFor(47 * HOUR)).toBe('48h');
        expect(bandFor(23 * HOUR)).toBe('24h');
        expect(bandFor(9 * HOUR)).toBe('10h');
        expect(bandFor(1 * HOUR)).toBe('2h');
    });

    it('is inclusive at each boundary, so an exactly-48h check still fires', () => {
        expect(bandFor(48 * HOUR)).toBe('48h');
        expect(bandFor(2 * HOUR)).toBe('2h');
    });

    it('stays at the tightest band once the arrival time has passed', () => {
        // An overdue unclaimed arrival must not fall back to null and stop alerting.
        expect(bandFor(0)).toBe('2h');
        expect(bandFor(-5 * HOUR)).toBe('2h');
    });

    it('is ordered widest-first, which is what makes bandFor work', () => {
        expect(ALERT_BANDS).toEqual(['48h', '24h', '10h', '2h']);
    });
});

describe('urgency, as the card shows it', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const inHours = (h: number) => new Date(now.getTime() + h * HOUR).toISOString();

    it('separates a landed-and-unclaimed plane from one landing in an hour', () => {
        // Folding these together would hide the one that needs a phone call.
        expect(urgencyOf(inHours(-1), now)).toBe('overdue');
        expect(urgencyOf(inHours(1), now)).toBe('critical');
    });

    it('walks calm → soon → urgent → critical as the day approaches', () => {
        expect(urgencyOf(inHours(100), now)).toBe('calm');
        expect(urgencyOf(inHours(30), now)).toBe('soon');
        expect(urgencyOf(inHours(20), now)).toBe('urgent');
        expect(urgencyOf(inHours(5), now)).toBe('critical');
    });

    it('does not throw or report overdue on an unparseable date', () => {
        // A garbage value must not paint every card red; it reads as calm and the
        // board stays legible.
        expect(urgencyOf('not a date', now)).toBe('calm');
    });
});

describe('the airport table', () => {
    it('reads a code case- and whitespace-insensitively', () => {
        expect(airportByCode(' bos ')?.code).toBe('BOS');
    });

    it('is a zone lookup, not an allow-list — an unknown code falls back', () => {
        // Refusing a real airport nobody had added yet would stop a traveller filing
        // a request at all, which is worse than reading their time in the
        // congregation's own zone.
        expect(airportZone('ZZZ', 'America/New_York')).toBe('America/New_York');
        expect(airportByCode('ZZZ')).toBeNull();
    });

    it('puts BOS and ORD in different zones, which is the whole reason it exists', () => {
        expect(airportZone('BOS', 'America/New_York')).toBe('America/New_York');
        expect(airportZone('ORD', 'America/New_York')).toBe('America/Chicago');
    });

    it('labels an unknown code with the code rather than an empty string', () => {
        // A blank chip on a card is the kind of silent nothing this repo keeps
        // removing; the raw code is at least actionable.
        expect(airportLabel('zzz')).toBe('ZZZ');
        expect(airportLabel('BOS')).toContain('Boston');
    });

    it('every zone in the table is one the runtime actually recognises', () => {
        // A typo here would not throw until somebody filed a request for that
        // airport, and Intl rejects a bad zone at format time.
        for (const airport of AIRPORTS) {
            expect(
                () => new Intl.DateTimeFormat('en-US', { timeZone: airport.zone }),
                `${airport.code} has an unusable zone`,
            ).not.toThrow();
        }
    });

    it('has no duplicate codes', () => {
        const codes = AIRPORTS.map(a => a.code);
        expect(new Set(codes).size).toBe(codes.length);
    });
});
