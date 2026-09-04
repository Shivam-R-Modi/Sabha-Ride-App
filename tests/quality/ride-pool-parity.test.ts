/**
 * THE DISPATCH FILTER EXISTS TWICE, AND UNTIL NOW NOTHING HELD THE TWO TOGETHER.
 *
 * `functions/src/utils/ridePool.ts` decides which waiting requests a Sarthi is handed.
 * `src/utils/ridePool.ts` decides which ones the manager's Waiting count shows. They
 * cannot import each other — separate tsconfigs, no shared path — so the rule is
 * written out twice, and the client copy has carried the note *"If the server's rule
 * changes, change this too"* since the day it was written with nothing checking.
 *
 * THIS TEST IS THE REASON THE SERVER HALF MOVED. It used to live inside
 * `http/globalAssignDriver.ts`, which imports `firebase-functions`, so no test could
 * import it alongside the client's copy.
 *
 * WHAT DRIFT COSTS, and it has already cost it once:
 *
 *   On 2026-08-14 the manager's queue read `Waiting · 4` while a driver tapping Assign
 *   Me was told "Nobody is waiting right now". Four riders appeared queued whom no tap
 *   could serve. A count that cannot be acted on is worse than no count — it sends a
 *   manager looking for a fault in dispatch. `src/utils/ridePool.ts` exists because of
 *   that evening, and this test exists so it cannot happen from a new cause.
 *
 * ONE DELIBERATE DIVERGENCE, asserted by name below so it cannot quietly become two:
 * the client does NOT apply the GPS checks. A request with no usable coordinates is
 * still a real person waiting, and a manager should see them even though no driver can
 * be routed to them.
 */

import { describe, it, expect } from 'vitest';
import { isDispatchable, eventKeyOf, directionOf } from '../../src/utils/ridePool';
import { isValidPendingRide, rejectionFor } from '../../functions/src/utils/ridePool';
import { eventKeyFromRide } from '../../functions/src/utils/events';
import { FOUNDING_LOCATION_ID } from '../../src/constants/tenancy';

const DATE = '2026-08-14';
const OTHER_DATE = '2026-08-21';

/** A request both sides agree is real: coordinates present, rider present. */
const ok = (over: Record<string, unknown> = {}) => ({
    studentId: 'stu_1', pickupLat: 42.34, pickupLng: -71.09,
    eventDate: DATE, locationId: FOUNDING_LOCATION_ID, ...over,
});

describe('both copies read the gathering the same way', () => {
    it.each([
        { eventId: DATE },
        { eventDate: DATE },
        { eventId: DATE, eventDate: OTHER_DATE },
        { eventId: 'nonsense', eventDate: DATE },
        { eventId: '2026-8-14' },
        {},
    ])('%s', (ride) => {
        // `eventId` before `eventDate`, both validated against the same YYYY-MM-DD
        // shape. The server writes the first at assignment; the browser writes the
        // second at request time.
        expect(eventKeyOf(ride)).toBe(eventKeyFromRide(ride));
    });
});

describe('both copies read the direction the same way', () => {
    it.each([
        [undefined, 'home-to-sabha'],
        ['home-to-sabha', 'home-to-sabha'],
        ['sabha-to-home', 'sabha-to-home'],
        ['sabha-to-Home', 'sabha-to-Home'],
        ['', 'home-to-sabha'],
    ])('%s reads as %s', (raw, expected) => {
        // ABSENT MEANS PICKUP, and that default is load-bearing on both sides: every
        // pickup request ever written lacks the field.
        expect(directionOf({ rideType: raw })).toBe(expected);
        expect(directionOf({ rideType: raw })).toBe(expected === '' ? 'home-to-sabha' : expected);
    });
});

describe('both copies agree on the whole matrix', () => {
    const CASES: Array<{ ride: Record<string, unknown>; why: string }> = [
        { ride: ok(), why: 'the ordinary case' },
        { ride: ok({ eventDate: OTHER_DATE }), why: 'another evening' },
        { ride: ok({ eventDate: undefined }), why: 'no gathering at all' },
        { ride: ok({ rideType: 'sabha-to-home' }), why: 'the other direction' },
        { ride: ok({ rideType: 'sabha-to-Home' }), why: 'a hand-edited direction' },
        { ride: ok({ locationId: 'somerville' }), why: 'another hall' },
        { ride: ok({ locationId: undefined }), why: 'no hall named' },
        { ride: ok({ locationId: 'Hall B' }), why: 'a hall id that cannot be an event key' },
    ];

    it.each(CASES)('$why — one hall open', ({ ride }) => {
        expect(isDispatchable(ride, DATE, 'home-to-sabha', FOUNDING_LOCATION_ID, true))
            .toBe(isValidPendingRide(ride, DATE, 'home-to-sabha', FOUNDING_LOCATION_ID, true));
    });

    it.each(CASES)('$why — two halls open', ({ ride }) => {
        expect(isDispatchable(ride, DATE, 'home-to-sabha', FOUNDING_LOCATION_ID, false))
            .toBe(isValidPendingRide(ride, DATE, 'home-to-sabha', FOUNDING_LOCATION_ID, false));
    });

    it.each(CASES)('$why — no hall filter at all', ({ ride }) => {
        // The state until the manager's queue groups by hall.
        expect(isDispatchable(ride, DATE, 'home-to-sabha'))
            .toBe(isValidPendingRide(ride, DATE, 'home-to-sabha'));
    });
});

describe('the one deliberate divergence', () => {
    it('the client counts a rider with no usable coordinates; the server will not route to them', () => {
        // Asserted BY NAME so it cannot quietly become a second divergence. A request
        // with no coordinates is still a real person waiting, and the manager should be
        // able to see them and phone them.
        const noCoords = ok({ pickupLat: 0, pickupLng: 0 });

        expect(isDispatchable(noCoords, DATE, 'home-to-sabha')).toBe(true);
        expect(isValidPendingRide(noCoords, DATE, 'home-to-sabha')).toBe(false);
        expect(rejectionFor(noCoords, {
            eventKey: DATE, rideType: 'home-to-sabha',
            locationId: null, singleActiveLocation: true,
        })).toBe('no-coords');
    });

    it('and that is the ONLY one — every other shape agrees', () => {
        // A shape the client accepts and the server refuses, for any reason other than
        // coordinates, is a drift. This walks the matrix again and demands the reason.
        const drifted: string[] = [];
        for (const ride of [
            ok(), ok({ eventDate: OTHER_DATE }), ok({ rideType: 'sabha-to-home' }),
            ok({ locationId: 'somerville' }), ok({ locationId: undefined }),
            ok({ studentId: undefined }),
        ]) {
            for (const single of [true, false]) {
                const client = isDispatchable(ride, DATE, 'home-to-sabha', FOUNDING_LOCATION_ID, single);
                const server = isValidPendingRide(ride, DATE, 'home-to-sabha', FOUNDING_LOCATION_ID, single);
                if (client === server) continue;
                const reason = rejectionFor(ride, {
                    eventKey: DATE, rideType: 'home-to-sabha',
                    locationId: FOUNDING_LOCATION_ID, singleActiveLocation: single,
                });
                if (reason !== 'no-coords' && reason !== 'no-rider') {
                    drifted.push(`${JSON.stringify(ride)} → ${reason}`);
                }
            }
        }
        expect(drifted).toEqual([]);
    });
});

describe('a refusal always says why, because a bare false becomes one screen', () => {
    it.each([
        [{}, 'no-rider'],
        [ok({ pickupLat: 0, pickupLng: 0 }), 'no-coords'],
        [ok({ studentId: undefined }), 'no-rider'],
        [ok({ eventDate: OTHER_DATE }), 'other-gathering'],
        [ok({ rideType: 'sabha-to-home' }), 'other-direction'],
        [ok({ locationId: 'somerville' }), 'other-location'],
    ])('%s → %s', (ride, reason) => {
        expect(rejectionFor(ride as Record<string, unknown>, {
            eventKey: DATE, rideType: 'home-to-sabha',
            locationId: FOUNDING_LOCATION_ID, singleActiveLocation: false,
        })).toBe(reason);
    });

    it('names an unstamped request only when the hall is genuinely unknowable', () => {
        const unstamped = ok({ locationId: undefined });
        const expected = {
            eventKey: DATE, rideType: 'home-to-sabha' as const,
            locationId: FOUNDING_LOCATION_ID,
        };

        // One hall open: the request can only be for that hall, so refusing it would
        // strand a rider over a field they had no way to send.
        expect(rejectionFor(unstamped, { ...expected, singleActiveLocation: true })).toBeNull();
        // Two open: genuinely unknowable, so it is refused LOUDLY rather than guessed.
        expect(rejectionFor(unstamped, { ...expected, singleActiveLocation: false }))
            .toBe('no-location');
    });

    it('puts the caller ahead of everything else, so a Sarthi is never their own passenger', () => {
        expect(rejectionFor(ok({ studentId: 'drv_1' }), {
            eventKey: DATE, rideType: 'home-to-sabha',
            locationId: FOUNDING_LOCATION_ID, singleActiveLocation: true,
            driverId: 'drv_1',
        })).toBe('own-request');
    });
});
