/**
 * Identifying one gathering when two halls run on the same evening.
 *
 * THE ASSERTIONS THAT EARN THIS FILE are the ones about the FOUNDING HALL KEEPING THE
 * BARE DATE, and about NOT GUESSING.
 *
 * The bare-date case is the whole migration: every `events`, `weeklyAttendance` and
 * `statistics` document already written belongs to the founding hall, and under this
 * scheme its key does not change. Get that wrong and the app composes suffixed keys for
 * records that are filed bare — reads return empty, nothing errors, and a manager sees
 * an evening with no attendance and no history.
 *
 * The not-guessing cases matter because these functions decide which car a rider is
 * offered. A plausible-but-wrong answer here sends a Sarthi to the wrong building; a
 * null is a visible stuck row in the Waiting queue. The second is strictly better and
 * every function is written to prefer it.
 */

import { describe, it, expect } from 'vitest';
import {
    EVENT_ID_SEPARATOR,
    LOOKAHEAD_NEEDS_SLACK,
    activeLocations,
    dateKeyOfEventId,
    eventIdFor,
    locationOfRide,
    normaliseLocation,
    parseEventId,
} from '../../src/utils/locations';
import { FOUNDING_LOCATION_ID } from '../../src/constants/tenancy';

const DATE = '2026-08-07';
const VENUE = { lat: 42.387, lng: -71.099, address: '5 Elm Street' };

describe('composing an event id', () => {
    it('gives the founding hall the BARE date — this is the migration', () => {
        expect(eventIdFor(DATE, FOUNDING_LOCATION_ID)).toBe(DATE);
    });

    it('suffixes every other hall', () => {
        expect(eventIdFor(DATE, 'somerville')).toBe(`${DATE}__somerville`);
    });

    it.each([
        ['not-a-date', 'somerville'],
        ['2026-8-7', 'somerville'],
        ['', 'somerville'],
        [DATE, 'Hall B'],
        [DATE, 'hall.b'],
        [DATE, 'hall/b'],
        [DATE, ''],
        [DATE, null],
        [null, null],
    ])('refuses (%s, %s) rather than composing a key that points nowhere', (d, h) => {
        expect(eventIdFor(d, h)).toBeNull();
    });
});

describe('the lexicographic properties every existing query depends on', () => {
    it('sorts a suffixed id inside its own date', () => {
        expect(DATE < `${DATE}__somerville`).toBe(true);
        expect(`${DATE}__somerville` < '2026-08-08').toBe(true);
    });

    it('needs slack at the horizon, which is why LOOKAHEAD_NEEDS_SLACK exists', () => {
        // The one place the scheme bites: a suffixed gathering on the exact horizon day
        // falls outside `documentId() <= horizon` and vanishes from the calendar.
        expect(`${DATE}__somerville` <= DATE).toBe(false);
        expect(LOOKAHEAD_NEEDS_SLACK).toBeGreaterThanOrEqual(1);
    });

    it('keeps a suffixed id on the right side of a past-agenda sweep', () => {
        // `pastAgendas` clears where `documentId() < todayKey`. On the 7th nothing for
        // the 7th may be cleared; on the 8th everything for the 7th must be.
        expect(`${DATE}__somerville` < DATE).toBe(false);
        expect(`${DATE}__somerville` < '2026-08-08').toBe(true);
    });
});

describe('reading an event id back', () => {
    it('resolves a bare date to the founding hall', () => {
        expect(parseEventId(DATE)).toEqual({
            dateKey: DATE, locationId: FOUNDING_LOCATION_ID,
        });
    });

    it('splits a suffixed id', () => {
        expect(parseEventId(`${DATE}__somerville`)).toEqual({
            dateKey: DATE, locationId: 'somerville',
        });
    });

    it('refuses a suffix naming the founding hall, which would give one gathering two keys', () => {
        expect(parseEventId(`${DATE}__${FOUNDING_LOCATION_ID}`)).toBeNull();
    });

    it.each([
        `${DATE}__Hall B`,
        '__somerville',
        'nonsense',
        '2026-8-7__somerville',
        '',
        null,
        undefined,
        42,
    ])('refuses %s', (id) => {
        expect(parseEventId(id as unknown)).toBeNull();
    });

    it('round-trips every hall', () => {
        for (const hall of [FOUNDING_LOCATION_ID, 'somerville', 'cambridge-2']) {
            const id = eventIdFor(DATE, hall)!;
            expect(parseEventId(id)).toEqual({ dateKey: DATE, locationId: hall });
        }
    });
});

/**
 * `dateKeyOfEventId` is the fix for four separate places that compare an event id
 * against a date. Each of them gets the wrong answer on a suffixed id, and one of them
 * CANCELS RIDES when it does.
 */
describe('extracting the date, which four callers must do', () => {
    it('reads it off both shapes', () => {
        expect(dateKeyOfEventId(DATE)).toBe(DATE);
        expect(dateKeyOfEventId(`${DATE}__somerville`)).toBe(DATE);
    });

    it('is null rather than a guess when the id is unreadable', () => {
        expect(dateKeyOfEventId('nonsense')).toBeNull();
        expect(dateKeyOfEventId(undefined)).toBeNull();
    });

    it('survives the split-on-hyphen that would otherwise produce NaN', () => {
        // `dayOfWeekForKey` does `.split('-').map(Number)`. On a suffixed id that
        // yields [2026, 8, NaN] → an Invalid Date → `coversDate` false → the date is
        // reported as LOSING ITS SABHA, and `reconcileDate` cancels its rides.
        const parts = `${DATE}__somerville`.split('-').map(Number);
        expect(Number.isNaN(parts[2])).toBe(true);
        expect(dateKeyOfEventId(`${DATE}__somerville`)!.split('-').map(Number))
            .toEqual([2026, 8, 7]);
    });
});

describe('which hall a ride is for', () => {
    it('reads a valid id', () => {
        expect(locationOfRide({ locationId: 'somerville' })).toBe('somerville');
    });

    it('is NULL for a ride that does not say — never the founding hall', () => {
        /**
         * There is deliberately no absent-means-founding default, unlike `seatsOf` and
         * `rideType`. Those describe a real legacy population; `scripts/tenancy.cjs
         * verify` asserts this one is empty. So a default would be load-bearing for a
         * set that does not exist, and would silently absorb a bug that drops the field
         * — dispatching a rider to whichever hall happened to ask.
         */
        expect(locationOfRide({})).toBeNull();
        expect(locationOfRide(null)).toBeNull();
        expect(locationOfRide({ locationId: '' })).toBeNull();
        expect(locationOfRide({ locationId: 42 })).toBeNull();
        expect(locationOfRide({ locationId: 'Hall B' })).toBeNull();
    });
});

describe('cleaning a hall document', () => {
    it('accepts a complete one', () => {
        expect(normaliseLocation('somerville', {
            name: 'Somerville', venue: VENUE, active: true, order: 2,
        })).toEqual({
            id: 'somerville', name: 'Somerville', venue: VENUE, active: true, order: 2,
        });
    });

    it('opens a hall only on an EXPLICIT true', () => {
        // Absent-means-active would make a half-finished hall live the moment a manager
        // saved it, with no Sarthi able to serve it and riders stranding silently.
        for (const active of [undefined, null, 0, '', 'true', 1]) {
            expect(normaliseLocation('somerville', {
                name: 'Somerville', venue: VENUE, active,
            })?.active, String(active)).toBe(false);
        }
        expect(normaliseLocation('somerville', {
            name: 'Somerville', venue: VENUE, active: true,
        })?.active).toBe(true);
    });

    it('refuses the 0,0 placeholder, which would seed every carload', () => {
        // 0,0 is "the address never geocoded". As a venue it is the farthest point
        // from every rider, and `chooseSeed` anchors on the farthest rider.
        expect(normaliseLocation('somerville', {
            name: 'Somerville', venue: { lat: 0, lng: 0, address: 'x' },
        })).toBeNull();
    });

    it('refuses rather than repairs anything it cannot read', () => {
        expect(normaliseLocation('somerville', { name: 'S' })).toBeNull();
        expect(normaliseLocation('somerville', { venue: VENUE })).toBeNull();
        expect(normaliseLocation('somerville', { name: '   ', venue: VENUE })).toBeNull();
        expect(normaliseLocation('Hall B', { name: 'S', venue: VENUE })).toBeNull();
        expect(normaliseLocation('somerville', 'nonsense')).toBeNull();
        expect(normaliseLocation('somerville', null)).toBeNull();
    });

    it('defaults a missing order to 0 rather than refusing over it', () => {
        // Order is presentation. A hall with no order is still a hall.
        expect(normaliseLocation('somerville', { name: 'S', venue: VENUE })?.order).toBe(0);
    });
});

describe('the halls open for business', () => {
    const hall = (id: string, over: Record<string, unknown> = {}) => ({
        id, name: id, venue: VENUE, active: true, order: 0, ...over,
    });

    it('drops the retired ones', () => {
        expect(activeLocations([hall('a'), hall('r', { active: false })]).map(h => h.id))
            .toEqual(['a']);
    });

    it('orders by order, then name, then id — so it cannot reshuffle between renders', () => {
        expect(activeLocations([
            hall('c', { name: 'Cambridge', order: 1 }),
            hall('a', { name: 'Allston', order: 1 }),
            hall('h', { name: 'Huntington', order: 0 }),
        ]).map(h => h.id)).toEqual(['h', 'a', 'c']);
    });

    it('returns an empty list, which every caller must read as a FAULT', () => {
        // A congregation always has somewhere to meet. No active hall means the seed is
        // missing or every document is malformed — rendering that as "no sabha tonight"
        // hides a server problem behind an ordinary screen.
        expect(activeLocations([])).toEqual([]);
        expect(activeLocations([hall('r', { active: false })])).toEqual([]);
    });

    it('does not mutate what it was given', () => {
        const input = [hall('b', { order: 1 }), hall('a', { order: 0 })];
        activeLocations(input);
        expect(input.map(h => h.id)).toEqual(['b', 'a']);
    });
});

describe('the separator itself', () => {
    it('is what Firestore allows and a field path tolerates', () => {
        // Firestore forbids ids matching `__.*__`; a single leading pair is fine.
        expect(EVENT_ID_SEPARATOR).toBe('__');
        expect(/^__.*__$/.test(`${DATE}${EVENT_ID_SEPARATOR}somerville`)).toBe(false);
    });
});
