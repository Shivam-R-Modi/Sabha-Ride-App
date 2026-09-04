/**
 * THE LOCATION TABLE EXISTS TWICE. IT MUST SAY THE SAME THING.
 *
 * `src/utils/locations.ts` decides which hall a rider's screen offers and which pool
 * the manager's Waiting count filters to. `functions/src/utils/locations.ts` decides
 * which riders a Sarthi is actually handed. Separate tsconfigs, no shared path, so the
 * file is written out twice — the same arrangement as arrival.ts and
 * constants/notifications.ts.
 *
 * WHAT DRIFT COSTS HERE, in the two directions:
 *
 *   Client MORE permissive → a rider picks a hall, or a manager sees them queued for
 *   one, and no tap can ever serve them. That is the 2026-08-14 defect
 *   (`Waiting · 4` beside "Nobody is waiting right now") from a new cause, and
 *   src/utils/ridePool.ts exists because of it.
 *
 *   Client LESS permissive → a rider who is genuinely dispatchable is hidden from the
 *   queue, so a manager cannot see somebody a driver could collect.
 *
 * Compared BY VALUE rather than by parsing source, because both copies are
 * dependency-light TypeScript. Reformatting is free; a changed meaning is not.
 */

import { describe, it, expect } from 'vitest';
import * as client from '../../src/utils/locations';
import * as server from '../../functions/src/utils/locations';
import * as clientTenancy from '../../src/constants/tenancy';
import * as serverTenancy from '../../functions/src/constants/tenancy';

describe('the two copies are the same table', () => {
    it('agree about the separator, the id shape and the horizon slack', () => {
        expect(client.EVENT_ID_SEPARATOR).toBe(server.EVENT_ID_SEPARATOR);
        expect(client.LOCATION_ID_PATTERN.source).toBe(server.LOCATION_ID_PATTERN.source);
        expect(client.LOOKAHEAD_NEEDS_SLACK).toBe(server.LOOKAHEAD_NEEDS_SLACK);
    });

    it('export the same helpers, so neither side can grow one the other lacks', () => {
        expect(Object.keys(client).sort()).toEqual(Object.keys(server).sort());
    });

    /**
     * The founding hall id is what makes every already-written `events`,
     * `weeklyAttendance` and `statistics` document readable with no backfill: under
     * `eventIdFor` it keeps the bare date. If the two copies disagreed about that one
     * string, one side would compose suffixed keys for history the other reads bare —
     * and the reads would return empty rather than erroring.
     *
     * `tenancy.ts` says "the two must hold the same values" and, until this test,
     * nothing checked.
     */
    it('agree about the founding city and hall', () => {
        expect(clientTenancy.FOUNDING_CITY_ID).toBe(serverTenancy.FOUNDING_CITY_ID);
        expect(clientTenancy.FOUNDING_LOCATION_ID).toBe(serverTenancy.FOUNDING_LOCATION_ID);
    });

    it('compose the same event id for every shape, including the malformed ones', () => {
        const dates = ['2026-08-07', '2026-11-05', 'not-a-date', '', '2026-8-7'];
        const halls = [
            serverTenancy.FOUNDING_LOCATION_ID, 'somerville', 'Hall B', 'hall.b', '', null,
        ];
        for (const d of dates) {
            for (const h of halls) {
                expect(client.eventIdFor(d, h), `${d} / ${h}`)
                    .toBe(server.eventIdFor(d, h));
            }
        }
    });

    it('parse the same event ids back, and reject the same ones', () => {
        const ids = [
            '2026-08-07',
            '2026-08-07__somerville',
            `2026-08-07__${serverTenancy.FOUNDING_LOCATION_ID}`,
            '2026-08-07__Hall B',
            '__somerville',
            'nonsense',
            '',
            null,
            undefined,
        ];
        for (const id of ids) {
            expect(client.parseEventId(id), String(id))
                .toEqual(server.parseEventId(id));
            expect(client.dateKeyOfEventId(id), String(id))
                .toBe(server.dateKeyOfEventId(id));
        }
    });

    it('read the same hall off a ride, and refuse the same rides', () => {
        const rides: unknown[] = [
            { locationId: 'somerville' },
            { locationId: serverTenancy.FOUNDING_LOCATION_ID },
            { locationId: 'Hall B' },
            { locationId: '' },
            { locationId: 42 },
            {},
            null,
            undefined,
        ];
        for (const ride of rides) {
            expect(client.locationOfRide(ride), JSON.stringify(ride))
                .toBe(server.locationOfRide(ride));
        }
    });

    it('normalise a hall document identically, junk included', () => {
        const raws: unknown[] = [
            { name: 'Somerville', venue: { lat: 42.4, lng: -71.1, address: '5 Elm' }, active: true, order: 2 },
            { name: 'Somerville', venue: { lat: 42.4, lng: -71.1, address: '5 Elm' } },
            { name: '  ', venue: { lat: 42.4, lng: -71.1, address: '5 Elm' } },
            { name: 'Nowhere', venue: { lat: 0, lng: 0, address: 'x' } },
            { name: 'Nowhere', venue: null },
            { venue: { lat: 42.4, lng: -71.1, address: '5 Elm' } },
            'nonsense',
            null,
        ];
        for (const raw of raws) {
            expect(client.normaliseLocation('somerville', raw), JSON.stringify(raw))
                .toEqual(server.normaliseLocation('somerville', raw));
        }
    });

    it('order the active halls the same way', () => {
        const halls = [
            { id: 'c', name: 'Cambridge', venue: { lat: 42, lng: -71, address: 'c' }, active: true, order: 1 },
            { id: 'a', name: 'Allston', venue: { lat: 42, lng: -71, address: 'a' }, active: true, order: 1 },
            { id: 'h', name: 'Huntington', venue: { lat: 42, lng: -71, address: 'h' }, active: true, order: 0 },
            { id: 'r', name: 'Retired', venue: { lat: 42, lng: -71, address: 'r' }, active: false, order: 0 },
        ];
        expect(client.activeLocations(halls).map(h => h.id))
            .toEqual(server.activeLocations(halls).map(h => h.id));
    });
});
