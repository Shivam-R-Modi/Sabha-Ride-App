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
/** Driver documents, keyed by uid, for resolving a vehicle's holder. */
let drivers: Record<string, Record<string, unknown>>;
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
vi.mock('../utils/authz', async (importOriginal) => ({
    assertApprovedManager: (...a: any[]) => assertApprovedManager(...(a as [])),
    // THE REAL predicate. It decides whether a Sarthi holding a car can be dispatched,
    // and dispatch enforces the same one — a stub here would let these tests pass while
    // the preview showed a carload for a revoked account.
    isApprovedDriverData:
        (await importOriginal<typeof import('../utils/authz')>()).isApprovedDriverData,
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
import { GEO_FENCE_MILES } from '../utils/carload';

const VENUE = { lat: 42.339925, lng: -71.088182, address: 'Huntington Ave' };
/** A Sarthi who can actually be dispatched: approved, a driver, and locatable. */
const APPROVED_DRIVER = {
    role: 'driver', roles: ['driver', 'student'], accountStatus: 'approved',
    name: 'Ramesh', location: { latitude: 42.34, longitude: -71.09 },
};
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
                get: async () => snap(
                    name === 'users' ? id in drivers : true,
                    name === 'users' ? drivers[id] : undefined,
                ),
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
    drivers = {};
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

    it('reports the cars it simulated, largest first', async () => {
        // Published so the screen can say what it assumed. Which Sarthi taps first is
        // unknowable and the split depends on it, so hiding this would be the whole
        // defect.
        vehicles = [
            { capacity: 4, status: 'available' },
            { capacity: 7, status: 'available' },
        ];
        makeDb();

        const out: any = await call();
        expect(out.cars.map((c: any) => c.seats)).toEqual([6, 3]);
    });

    it('includes an IN-USE vehicle, because its Sarthi is the one who taps', async () => {
        /**
         * `in_use` means a Sarthi is holding it, which is exactly the car most likely to
         * dispatch next — `globalAssignDriver` accepts both states. Counting only
         * `available` ones, as an earlier version did, hid every car that had actually
         * been taken and showed only the ones nobody was driving.
         */
        vehicles = [
            { capacity: 5, status: 'in_use', assignedDriverId: 'drv-1' },
            { capacity: 4, status: 'available' },
        ];
        drivers = { 'drv-1': APPROVED_DRIVER };
        makeDb();

        const out: any = await call();
        expect(out.cars.map((c: any) => c.seats)).toEqual([4, 3]);
    });

    it('leaves out a vehicle in maintenance', async () => {
        vehicles = [
            { capacity: 4, status: 'available' },
            { capacity: 8, status: 'maintenance' },
        ];
        makeDb();

        const out: any = await call();
        expect(out.cars.map((c: any) => c.seats)).toEqual([3]);
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
            { capacity: 8, status: 'in_use', assignedDriverId: 'drv-1' },
        ];
        drivers = { 'drv-1': APPROVED_DRIVER };
        makeDb();

        const out: any = await call();
        expect(out.cars.map((c: any) => c.seats)).toEqual([7, 3]);
        expect(out.maxFleetSeats).toBe(7);
    });

    it('leaves everybody over when there is no usable car at all', async () => {
        vehicles = [{ capacity: 4, status: 'maintenance' }];
        makeDb();

        const out: any = await call();
        expect(out.cars).toEqual([]);
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

/**
 * THE CARS ARE SARTHI/VEHICLE PAIRS, and that is what makes the fence real.
 *
 * `globalAssignDriver` bounds how far a volunteer is sent from THEIR OWN HOME, so the
 * fence cannot be applied without knowing whose car it is. This block pins the pairing:
 * whose home is used, who is excluded and why, and that a car nobody has taken is
 * simulated WITHOUT a fence rather than being dropped or silently fenced from nowhere.
 */
describe('previewCarloads — Sarthis and their cars', () => {
    it('measures the fence from the SARTHI holding the car', async () => {
        /**
         * The rider is 9 miles north; the Sarthi lives 30 miles north, so they are 21
         * miles apart and dispatch would refuse. Measured from the VENUE the rider is
         * comfortably inside and would be shown in a car that cannot happen — which is
         * the defect this whole change exists to remove.
         */
        vehicles = [{ capacity: 4, status: 'in_use', assignedDriverId: 'drv-far' }];
        drivers = {
            'drv-far': {
                ...APPROVED_DRIVER,
                location: { latitude: VENUE.lat + 30 / 69, longitude: VENUE.lng },
            },
        };
        rides = [req('nine-miles-out', 9)];
        makeDb();

        const out: any = await call();

        expect(out.groups).toEqual([]);
        expect(out.leftover).toEqual([
            { id: 'nine-miles-out', seats: 1, reason: 'outside-every-fence' },
        ]);
    });

    it('names the SARTHI as the car, not the vehicle', async () => {
        // So the board can say "Ramesh's car" instead of "Car 2". A vehicle id would be
        // meaningless on screen and would need a second lookup to render.
        vehicles = [{ capacity: 4, status: 'in_use', assignedDriverId: 'drv-1' }];
        drivers = { 'drv-1': APPROVED_DRIVER };
        makeDb();

        const out: any = await call();
        expect(out.groups[0].carId).toBe('drv-1');
        expect(out.groups[0].fenced).toBe(true);
    });

    it('reads the OLDER holder field too', async () => {
        // `currentDriverId` is the server's older name for `assignedDriverId`, and
        // resolveVehicleHolder reads both. Missing it would silently unfence a car that
        // somebody is in fact driving.
        vehicles = [{ capacity: 4, status: 'in_use', currentDriverId: 'drv-1' }];
        drivers = { 'drv-1': APPROVED_DRIVER };
        makeDb();

        const out: any = await call();
        expect(out.groups[0].carId).toBe('drv-1');
        expect(out.groups[0].fenced).toBe(true);
    });

    it('simulates an UNCLAIMED car with no fence, and says so', async () => {
        /**
         * Nobody has taken it, so there is no home to measure from. Refusing everybody
         * would be worse than admitting the limit was not checked — and a Friday before
         * anyone picks a car is the common early state, where dropping unclaimed cars
         * would show an empty board.
         */
        vehicles = [{ capacity: 4, status: 'available' }];
        rides = [req('far', 40)];
        makeDb();

        const out: any = await call();

        expect(out.groups[0].fenced).toBe(false);
        expect(out.groups[0].riders.map((r: any) => r.id)).toEqual(['far']);
        expect(out.cars[0].fenced).toBe(false);
    });

    it('puts SARTHIS BEFORE unclaimed cars', async () => {
        // Those are the taps that will really happen, and their fences are real. A
        // hypothetical car ordered first would shape the whole grouping around it.
        vehicles = [
            { capacity: 8, status: 'available' },
            { capacity: 4, status: 'in_use', assignedDriverId: 'drv-1' },
        ];
        drivers = { 'drv-1': APPROVED_DRIVER };
        makeDb();

        const out: any = await call();
        expect(out.cars.map((c: any) => c.id)).toEqual(['drv-1', 'veh_0']);
        expect(out.cars.map((c: any) => c.fenced)).toEqual([true, false]);
    });

    it('REPORTS a Sarthi with no home address instead of hiding the car', async () => {
        /**
         * `globalAssignDriver` refuses them outright — "Your location is not set" — so
         * their car can collect nobody. Quietly leaving it out of the board hides a thing
         * a manager can fix in one phone call, and the Sarthi spends the evening tapping
         * a button that refuses them.
         */
        vehicles = [{ capacity: 4, status: 'in_use', assignedDriverId: 'drv-lost' }];
        drivers = { 'drv-lost': { ...APPROVED_DRIVER, location: undefined } };
        makeDb();

        const out: any = await call();

        expect(out.cars).toEqual([]);
        expect(out.unusable).toEqual([{ id: 'drv-lost', reason: 'no-home-address' }]);
    });

    it('does not accept 0,0 as a home', async () => {
        // The placeholder an ungeocoded address leaves behind. Treated as a real
        // location it puts the fence in the Gulf of Guinea and every rider outside it.
        vehicles = [{ capacity: 4, status: 'in_use', assignedDriverId: 'drv-zero' }];
        drivers = { 'drv-zero': { ...APPROVED_DRIVER, location: { latitude: 0, longitude: 0 } } };
        makeDb();

        const out: any = await call();
        expect(out.unusable).toEqual([{ id: 'drv-zero', reason: 'no-home-address' }]);
    });

    it('REPORTS a revoked Sarthi still holding a car', async () => {
        // Revoked mid-evening. Dispatch refuses them, so their car takes nobody — and
        // this is the one screen that would tell a manager why the queue is not moving.
        vehicles = [{ capacity: 4, status: 'in_use', assignedDriverId: 'drv-out' }];
        drivers = { 'drv-out': { ...APPROVED_DRIVER, accountStatus: 'revoked' } };
        makeDb();

        const out: any = await call();

        expect(out.cars).toEqual([]);
        expect(out.unusable).toEqual([{ id: 'drv-out', reason: 'driver-not-approved' }]);
    });

    it('reports a holder whose profile is GONE', async () => {
        // A deleted account still named on a vehicle. `isApprovedDriverData` refuses
        // undefined, which is the safe direction.
        vehicles = [{ capacity: 4, status: 'in_use', assignedDriverId: 'ghost' }];
        drivers = {};
        makeDb();

        const out: any = await call();
        expect(out.unusable).toEqual([{ id: 'ghost', reason: 'driver-not-approved' }]);
    });

    it('publishes the fence distance rather than making the screen hardcode it', async () => {
        /**
         * Asserted against the CONSTANT, not a literal. This was `toBe(15)` and it failed
         * when the owner narrowed the fence to 8 — which was the test doing its job, but
         * the thing worth pinning is that the number reaches the board at all. The board
         * carried its own `?? 15` fallback until that change, so a narrowed fence would
         * have left managers reading the old bound off a screen that claimed to describe
         * dispatch.
         */
        const out: any = await call();
        expect(out.fenceMiles).toBe(GEO_FENCE_MILES);
    });

    it('NEVER RETURNS A SARTHI\'S HOME COORDINATES', async () => {
        /**
         * The fence is measured FROM their home, on the server, and that is where it
         * stays. The board only needs to know a limit was applied — not from where — and
         * a volunteer's home address has no business in a payload that did not need it.
         */
        vehicles = [{ capacity: 4, status: 'in_use', assignedDriverId: 'drv-1' }];
        drivers = { 'drv-1': APPROVED_DRIVER };
        makeDb();

        const out: any = await call();
        const serialised = JSON.stringify(out);

        expect(serialised).not.toContain('42.34');
        expect(serialised).not.toContain('latitude');
        expect(serialised).not.toContain('Ramesh');
    });
});
