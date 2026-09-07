/**
 * The manager's carload preview — a read-only view of the queue, grouped as dispatch
 * would group it.
 *
 * The arithmetic is tested in utils/carloadPreview.test.ts. What this file pins is
 * everything AROUND it, which is where a preview goes wrong:
 *
 *   - it must be scoped to the same gathering, direction and hall dispatch is serving,
 *     or it shows a manager a grouping for the wrong evening;
 *   - it must return NO personal data, because the client already has it and a second
 *     path carrying children's names and addresses earns nothing;
 *   - a closed window is an ANSWER, not an error — a manager looking at the queue
 *     between sabhas has not done anything wrong;
 *   - it must write nothing and take no lock.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
let rides: Array<{ id: string; data: Record<string, unknown> }>;
let vehicles: Array<Record<string, unknown>>;
let context: Record<string, unknown> | undefined;
let openHalls: Array<{ id: string; name: string; venue: unknown; active: boolean; order: number }>;
/** Anything written during a call. Must stay empty — see the last block. */
let writes: string[];

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) { super(message); this.name = 'HttpsError'; }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});
vi.mock('firebase-admin', () => ({ firestore: () => db }));

const assertApprovedManager = vi.fn(async () => ({ name: 'Mira' }));
vi.mock('../utils/authz', () => ({
    assertApprovedManager: (...a: any[]) => assertApprovedManager(...(a as [])),
}));
vi.mock('../utils/rateLimiter', () => ({ checkRateLimit: async () => undefined }));
vi.mock('../utils/settings', () => ({
    locationsOrFoundingFallback: async () => openHalls,
    getSabhaLocation: async () => ({ lat: 42.339925, lng: -71.088182, address: 'default' }),
    // The real one, near enough: first argument if it has coordinates, else the second.
    resolveVenue: (a: any, b: any) =>
        (a && Number.isFinite(a.lat) && Number.isFinite(a.lng) && !(a.lat === 0 && a.lng === 0))
            ? a : b,
}));

import { previewCarloads } from './previewCarloads';

const VENUE = { lat: 42.339925, lng: -71.088182, address: 'Huntington Ave' };
const HUNTINGTON = {
    id: 'boston-huntington', name: 'Huntington', active: true, order: 0, venue: VENUE,
};
const SOMERVILLE = {
    id: 'somerville', name: 'Elm Street', active: true, order: 1,
    venue: { lat: 42.387, lng: -71.099, address: '5 Elm Street' },
};

/** A pending pickup request `miles` north of the venue. */
const req = (id: string, miles: number, over: Record<string, unknown> = {}) => ({
    id,
    data: {
        studentId: `stu_${id}`, studentName: id, studentPhone: '555-0000',
        pickupAddress: `${id} Street`, pickupLat: VENUE.lat + miles / 69, pickupLng: VENUE.lng,
        status: 'requested', eventDate: '2026-09-07', locationId: 'boston-huntington',
        ...over,
    },
});

function makeDb() {
    writes = [];
    const snap = (exists: boolean, data?: any) => ({ exists, data: () => data });

    db = {
        collection: (name: string) => ({
            get: async () => ({
                docs: name === 'vehicles'
                    ? vehicles.map((v, i) => ({ id: `veh_${i}`, data: () => v }))
                    : [],
            }),
            where: () => ({
                get: async () => ({
                    docs: name === 'rides'
                        ? rides.map(r => ({ id: r.id, data: () => r.data }))
                        : [],
                }),
            }),
            doc: (id: string) => ({
                get: async () => snap(true, undefined),
                set: async () => { writes.push(`${name}/${id}`); },
                update: async () => { writes.push(`${name}/${id}`); },
            }),
        }),
        doc: (path: string) => ({
            get: async () => snap(context !== undefined, context),
            set: async () => { writes.push(path); },
        }),
        batch: () => ({
            set: (r: any) => writes.push(r?.path ?? 'batch'),
            commit: async () => { writes.push('commit'); },
        }),
    };
}

const call = (data: any = {}, uid = 'mgr-1') =>
    (previewCarloads as any)(data, { auth: { uid } });

beforeEach(() => {
    vi.clearAllMocks();
    assertApprovedManager.mockResolvedValue({ name: 'Mira' } as any);
    openHalls = [HUNTINGTON];
    vehicles = [{ capacity: 4, status: 'available' }];
    rides = [req('a', 1), req('b', 2), req('c', 9)];
    context = {
        rideType: 'home-to-sabha', eventId: '2026-09-07', venue: null,
        byLocation: {
            'boston-huntington': {
                rideType: 'home-to-sabha', eventId: '2026-09-07', venue: null,
            },
        },
    };
    makeDb();
});

describe('previewCarloads — who may ask', () => {
    it('refuses an unauthenticated caller', async () => {
        await expect((previewCarloads as any)({}, {})).rejects.toThrow(/authenticated/);
    });

    it('goes through assertApprovedManager', async () => {
        // The queue is children's names and addresses; the shape of it is the same
        // authority as the queue itself.
        await call();
        expect(assertApprovedManager).toHaveBeenCalled();
    });

    it('refuses when the manager check throws', async () => {
        assertApprovedManager.mockRejectedValue(new Error('Manager access revoked'));
        await expect(call()).rejects.toThrow(/revoked/);
    });

    it('refuses a hall id that could not be a document id', async () => {
        await expect(call({ locationId: '../system' })).rejects.toThrow(/not valid/);
    });

    it('refuses a hall that is not open', async () => {
        // Loud rather than falling back to the founding hall, which would show a
        // grouping for a different room than the one asked about.
        await expect(call({ locationId: 'brookline' })).rejects.toThrow(/not open/);
    });
});

describe('previewCarloads — grouping', () => {
    it('groups the queue and names the anchor', async () => {
        const out: any = await call();

        expect(out.status).toBe('ok');
        expect(out.groups).toHaveLength(1);
        // A 4-seater carries 3 passengers. The farthest rider anchors it.
        expect(out.groups[0].seats).toBe(3);
        expect(out.groups[0].anchorId).toBe('c');
        expect(out.groups[0].riders.map((r: any) => r.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('reports the free cars it assumed, largest first', async () => {
        // Published so the screen can say what it assumed. Which Sarthi taps first is
        // unknowable and the split depends on it, so hiding this would be the whole
        // defect.
        vehicles = [
            { capacity: 4, status: 'available' },
            { capacity: 7, status: 'available' },
            { capacity: 5, status: 'in_use' },
        ];
        makeDb();

        const out: any = await call();
        expect(out.carSeats).toEqual([6, 3]);
    });

    it('counts only vehicles that are actually free', async () => {
        vehicles = [
            { capacity: 4, status: 'available' },
            { capacity: 8, status: 'maintenance' },
            { capacity: 8, status: 'in_use' },
        ];
        makeDb();

        const out: any = await call();
        expect(out.carSeats).toEqual([3]);
    });

    it('still reports maxFleetSeats from the WHOLE fleet', async () => {
        /**
         * Whether a family COULD travel together is a property of the fleet, not of
         * this minute — otherwise the same family is split tonight and kept together
         * next week for reasons nobody can explain. `maxPassengerSeats` counts every
         * vehicle; `carSeats` counts the free ones. They are different questions and
         * this pins that they stay different.
         */
        vehicles = [
            { capacity: 4, status: 'available' },
            { capacity: 8, status: 'in_use' },
        ];
        makeDb();

        const out: any = await call();
        expect(out.carSeats).toEqual([3]);
        expect(out.maxFleetSeats).toBe(7);
    });

    it('leaves everybody over when no car is free', async () => {
        vehicles = [{ capacity: 4, status: 'in_use' }];
        makeDb();

        const out: any = await call();
        expect(out.groups).toEqual([]);
        expect(out.leftover.map((l: any) => l.id).sort()).toEqual(['a', 'b', 'c']);
    });
});

describe('previewCarloads — scoped exactly as dispatch is', () => {
    it('excludes a request for ANOTHER GATHERING', async () => {
        // A leftover request from a previous sabha. Dispatch will not serve it, so
        // showing it in a car would have a manager planning around a rider no tap
        // reaches.
        rides = [req('a', 1), req('stale', 2, { eventDate: '2026-08-31' })];
        makeDb();

        const out: any = await call();
        expect(out.groups.flatMap((g: any) => g.riders.map((r: any) => r.id))).toEqual(['a']);
    });

    it('excludes a request for the OTHER DIRECTION', async () => {
        rides = [req('a', 1), req('going-home', 2, { rideType: 'sabha-to-home' })];
        makeDb();

        const out: any = await call();
        expect(out.groups.flatMap((g: any) => g.riders.map((r: any) => r.id))).toEqual(['a']);
    });

    it('excludes a request for the OTHER HALL', async () => {
        openHalls = [HUNTINGTON, SOMERVILLE];
        rides = [req('a', 1), req('elsewhere', 2, { locationId: 'somerville' })];
        makeDb();

        const out: any = await call();
        expect(out.groups.flatMap((g: any) => g.riders.map((r: any) => r.id))).toEqual(['a']);
    });

    it('previews the OTHER hall when asked for it', async () => {
        openHalls = [HUNTINGTON, SOMERVILLE];
        rides = [req('a', 1), req('elsewhere', 2, { locationId: 'somerville' })];
        context = {
            rideType: 'home-to-sabha', eventId: '2026-09-07', venue: null,
            byLocation: {
                'boston-huntington': { rideType: 'home-to-sabha', eventId: '2026-09-07', venue: null },
                somerville: { rideType: 'home-to-sabha', eventId: '2026-09-07__somerville', venue: null },
            },
        };
        makeDb();

        const out: any = await call({ locationId: 'somerville' });
        expect(out.locationId).toBe('somerville');
        expect(out.groups.flatMap((g: any) => g.riders.map((r: any) => r.id))).toEqual(['elsewhere']);
    });

    it('reads the DATE out of a suffixed event id', async () => {
        /**
         * `rideContext.eventId` is `2026-09-07__somerville` for a second hall, while a
         * ride's own `eventDate` is always the bare date. Compared raw, nothing matches
         * and every rider reads as belonging to another gathering — so the second hall's
         * queue would render permanently empty, with no error anywhere.
         */
        openHalls = [HUNTINGTON, SOMERVILLE];
        rides = [req('elsewhere', 2, { locationId: 'somerville', eventDate: '2026-09-07' })];
        context = {
            rideType: 'home-to-sabha', eventId: '2026-09-07', venue: null,
            byLocation: {
                somerville: { rideType: 'home-to-sabha', eventId: '2026-09-07__somerville', venue: null },
                'boston-huntington': { rideType: 'home-to-sabha', eventId: '2026-09-07', venue: null },
            },
        };
        makeDb();

        const out: any = await call({ locationId: 'somerville' });
        expect(out.groups.flatMap((g: any) => g.riders.map((r: any) => r.id))).toEqual(['elsewhere']);
    });

    it('does NOT drop a request just because it names no hall, with one hall open', async () => {
        // A cached client that predates the hall picker files a ride with no
        // `locationId`. With one hall open there is no ambiguity, so dispatch serves it
        // — and the preview has to agree or the manager's queue is missing a person.
        rides = [req('unstamped', 2, { locationId: undefined })];
        makeDb();

        const out: any = await call();
        expect(out.groups.flatMap((g: any) => g.riders.map((r: any) => r.id))).toEqual(['unstamped']);
    });

    it('DOES drop it once two halls are open, and it is not silently lost', async () => {
        // Genuinely unknowable, so dispatch refuses it. It must not appear in a car —
        // but `scripts/locations.cjs verify` is what surfaces it, not this screen.
        openHalls = [HUNTINGTON, SOMERVILLE];
        rides = [req('unstamped', 2, { locationId: undefined })];
        makeDb();

        const out: any = await call();
        expect(out.groups).toEqual([]);
    });
});

describe('previewCarloads — a closed window is an answer', () => {
    it('reports window-closed rather than throwing', async () => {
        /**
         * `globalAssignDriver` throws here, and rightly: a Sarthi tapped a button that
         * cannot work. A manager looking at the queue on a Tuesday has done nothing
         * wrong, and an error on a screen they did not act on reads as a fault in the
         * app — which is how somebody ends up debugging a working system.
         */
        context = { rideType: null, eventId: null, byLocation: { 'boston-huntington': { rideType: null } } };
        makeDb();

        const out: any = await call();
        expect(out.status).toBe('window-closed');
        expect(out.groups).toEqual([]);
    });

    it('reports a MISSING SLICE as a fault, not as a quiet evening', async () => {
        // Once `byLocation` exists every open hall must have an entry. A missing one is
        // an inconsistent document, and rendering it as "no rides" would make a broken
        // scheduler indistinguishable from a Tuesday.
        context = { rideType: 'home-to-sabha', eventId: '2026-09-07', byLocation: { somerville: {} } };
        makeDb();

        await expect(call()).rejects.toThrow(/no ride window published/);
    });

    it('falls back to the top level when byLocation is absent entirely', async () => {
        // The first minute after the per-hall context deploys, and nothing else.
        context = { rideType: 'home-to-sabha', eventId: '2026-09-07', venue: null };
        makeDb();

        const out: any = await call();
        expect(out.status).toBe('ok');
        expect(out.groups).toHaveLength(1);
    });
});

describe('previewCarloads — what it returns, and what it must not', () => {
    it('returns RIDE IDS ONLY, no names, phones or addresses', async () => {
        /**
         * The client already has every one of those from its own `rides` subscription
         * and joins on the id. A second path carrying children's personal data earns
         * nothing, and this app's standing rule is that the narrower option wins on
         * anything touching it.
         */
        const out: any = await call();
        const serialised = JSON.stringify(out);

        expect(serialised).not.toContain('555-0000');
        expect(serialised).not.toContain('Street');
        expect(serialised).not.toContain('stu_');
        // The ids are there, which is what makes the join possible.
        expect(serialised).toContain('"a"');
    });

    it('WRITES NOTHING', async () => {
        // It assigns nobody and takes no lock. A preview that mutated would be able to
        // race a real dispatch from a screen nobody tapped.
        await call();
        expect(writes).toEqual([]);
    });
});
