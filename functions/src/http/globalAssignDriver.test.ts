/**
 * The regression guard for the reported "Open in Google Maps does nothing" bug.
 *
 * The URL used to be built AFTER the batch committed and returned only in the
 * callable's response. So the driver who had just tapped Assign Me held a
 * working URL in memory, and the very next Firestore snapshot — which reads
 * `googleMapsUrl` off the ride document, where it had never been written —
 * replaced it with ''. `if (ride.googleMapsUrl)` then returned immediately.
 * The button worked exactly once per assignment and was dead after any reload,
 * with no error anywhere.
 *
 * These tests assert on the batch.update payload, because that is the thing
 * that was wrong: the response was always fine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── module mocks ───────────────────────────────────────────
// Set by each test before invoking the handler.
let db: any;

// The factory is hoisted above every top-level declaration in this file, so
// the error class has to be defined inside it.
vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
            this.name = 'HttpsError';
        }
    }
    return {
        https: {
            // onCall returns the handler itself so the test can call it directly.
            onCall: (handler: any) => handler,
            HttpsError: FakeHttpsError,
        },
    };
});

vi.mock('firebase-admin', () => ({
    firestore: () => db,
}));

vi.mock('../utils/rateLimiter', () => ({
    checkRateLimit: vi.fn(async () => undefined),
}));

vi.mock('../utils/notifications', () => ({
    notifyStudentDriverAssigned: vi.fn(async () => undefined),
    notifyDriverStudentsAssigned: vi.fn(async () => undefined),
}));

const SABHA = { lat: 42.339925, lng: -71.088182, address: 'Sabha' };

vi.mock('../utils/settings', () => ({
    getSabhaLocation: async () => ({ lat: 42.339925, lng: -71.088182, address: 'Sabha' }),
    // Real behaviour, not a stub: the venue fallback chain is what these tests
    // are asserting on.
    resolveVenue: (candidate: any, fallback: any) => {
        const usable = (v: any) => !!v
            && Number.isFinite(v.lat) && Number.isFinite(v.lng)
            && !(v.lat === 0 && v.lng === 0);
        return usable(candidate)
            ? { lat: candidate.lat, lng: candidate.lng, address: candidate.address || fallback.address }
            : fallback;
    },
}));

import { globalAssignDriver, isValidPendingRide } from './globalAssignDriver';

// ── fake Firestore ─────────────────────────────────────────

interface Fixture {
    rideType: string;
    driver: Record<string, unknown>;
    car: Record<string, unknown>;
    rides: Array<{ id: string; data: Record<string, unknown> }>;
    /** Per-event venue override published on system/rideContext. */
    venue?: { lat: number; lng: number; address: string } | null;
    eventId?: string;
    /**
     * The whole fleet, which decides whether an oversized group waits for a
     * bigger vehicle or gets split across several. Absent means the vehicles
     * query comes back empty, which is the "fleet unknown" path.
     */
    vehicles?: Array<Record<string, unknown>>;
}

/** Records everything written through the batch so tests can assert on it. */
interface Recorder {
    updates: Array<{ path: string; data: any }>;
    sets: Array<{ path: string; data: any }>;
    committed: boolean;
    /** Every where() chain built, so query filters can be asserted on. */
    queries: Array<{ collection: string; clauses: Array<[string, string, unknown]> }>;
}

function makeDb(fixture: Fixture): { db: any; recorder: Recorder } {
    const recorder: Recorder = { updates: [], sets: [], committed: false, queries: [] };

    const snap = (exists: boolean, data?: any) => ({
        exists,
        data: () => data,
    });

    const docFor = (collection: string, id: string) => {
        switch (`${collection}/${id}`) {
            case 'system/rideContext':
                return snap(true, {
                    rideType: fixture.rideType,
                    venue: fixture.venue ?? null,
                    eventId: fixture.eventId ?? '2026-08-07',
                });
            case `users/${'driver-1'}`:
                return snap(true, fixture.driver);
            case `cars/${'car-1'}`:
                return snap(true, fixture.car);
            default:
                // Student profile reads during the notification step.
                return snap(true, {});
        }
    };

    const querySnap = (docs: Array<{ id: string; data: Record<string, unknown> }>) => ({
        empty: docs.length === 0,
        docs: docs.map(d => ({ id: d.id, data: () => d.data })),
    });

    /**
     * Rides default to the gathering AND the direction being dispatched.
     *
     * Dispatch filters the pool on both, so a fixture ride missing either is
     * correctly rejected and the test sees an empty pool. Defaulting here says
     * "these riders asked for the run being dispatched", which is the
     * precondition all these tests actually mean — they are about seats,
     * splitting, routing and venues, not about the filters.
     *
     * Note the asymmetry, which is real rather than a test convenience: a pickup
     * request genuinely carries NO rideType (hooks/useRides.ts never writes one),
     * while studentReadyToLeave stamps 'sabha-to-home'. So only the drop-off
     * fixtures need stamping, and leaving pickups bare keeps them faithful.
     *
     * A test that wants to prove either filter sets the field explicitly and this
     * leaves it alone. Both filters also have direct unit tests, so neither rests
     * on this default.
     */
    const ridesForThisEvent = () => fixture.rides.map(r => {
        const data: Record<string, unknown> = { ...r.data };
        if (!('eventDate' in data) && !('eventId' in data)) {
            data.eventDate = fixture.eventId ?? '2026-08-07';
        }
        if (!('rideType' in data) && fixture.rideType === 'sabha-to-home') {
            data.rideType = 'sabha-to-home';
        }
        return { id: r.id, data };
    });

    let generated = 0;

    const collection = (name: string) => {
        // where() records rather than discarding: the driver-pool query silently
        // matched nobody for months, and a filter nothing asserts on is exactly
        // how that survived.
        const clauses: Array<[string, string, unknown]> = [];
        const chain: any = {
            // `.doc()` with no id mints one, the way Firestore does. That is how
            // the remainder of a split group is created.
            doc: (id?: string) => {
                const docId = id ?? `generated-${++generated}`;
                return { id: docId, path: `${name}/${docId}`, get: async () => docFor(name, docId) };
            },
            where: (field: string, op: string, value: unknown) => {
                clauses.push([field, op, value]);
                recorder.queries.push({ collection: name, clauses: [...clauses] });
                return chain;
            },
            get: async () => {
                if (name === 'rides') return querySnap(ridesForThisEvent());
                if (name === 'vehicles') {
                    return querySnap((fixture.vehicles ?? []).map((v, i) => ({ id: `veh-${i}`, data: v })));
                }
                // The "other available drivers" query. Only the tapping driver
                // exists in these fixtures.
                return querySnap([]);
            },
        };
        return chain;
    };

    const db = {
        doc: (path: string) => ({
            path,
            get: async () => snap(false),
            set: async () => undefined,
            delete: async () => undefined,
        }),
        collection,
        batch: () => ({
            update: (ref: any, data: any) => recorder.updates.push({ path: ref.path, data }),
            set: (ref: any, data: any) => recorder.sets.push({ path: ref.path, data }),
            delete: () => undefined,
            commit: async () => { recorder.committed = true; },
        }),
    };

    return { db, recorder };
}

const DRIVER_HOME = { lat: 42.3600, lng: -71.0600 };

const baseFixture = (
    rideType: string,
    driverOverride?: Record<string, unknown>,
    carOverride?: Record<string, unknown>,
): Fixture => ({
    rideType,
    // accountStatus and roles are defaults rather than part of the override, so
    // every fixture describes a driver who is actually allowed to drive. A test
    // that wants a revoked or non-driver caller sets them explicitly and the
    // spread below lets it win.
    driver: {
        accountStatus: 'approved',
        roles: ['driver'],
        ...(driverOverride ?? {
            name: 'Asha',
            phone: '555-0100',
            location: { lat: DRIVER_HOME.lat, lng: DRIVER_HOME.lng },
        }),
    },
    car: carOverride ?? { name: 'Odyssey', color: 'Silver', licensePlate: 'ABC123', capacity: 4, status: 'available' },
    rides: [
        { id: 'ride-a', data: { studentId: 'stu-a', studentName: 'A', pickupLat: 42.35, pickupLng: -71.07, pickupAddress: '1 St', status: 'requested' } },
        { id: 'ride-b', data: { studentId: 'stu-b', studentName: 'B', pickupLat: 42.37, pickupLng: -71.05, pickupAddress: '2 St', status: 'requested' } },
    ],
});

async function run(fixture: Fixture) {
    return runAs('driver-1', fixture);
}

/** Invoke with a caller uid that may differ from the `driverId` in the body. */
async function runAs(callerUid: string, fixture: Fixture) {
    const made = makeDb(fixture);
    db = made.db;
    const result: any = await (globalAssignDriver as any)(
        { driverId: 'driver-1', carId: 'car-1' },
        { auth: { uid: callerUid } }
    );
    return { result, recorder: made.recorder };
}

// ── tests ──────────────────────────────────────────────────

describe('globalAssignDriver — a driver may only dispatch themselves', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('refuses a caller dispatching a different driver', async () => {
        // `driverId` came out of the request body and was never compared to the
        // caller. Any signed-in account could assign students to any driver, take
        // their car, overwrite their status and activeRideId, and hold the global
        // lock — under that driver's name, on that driver's dashboard.
        await expect(runAs('someone-else', baseFixture('home-to-sabha')))
            .rejects.toThrow(/only request an assignment for themselves/i);
    });

    it('refuses before touching the fleet or the lock', async () => {
        // The point of rejecting at the top: a partial run would leave the car
        // marked in_use or the assignment lock held by the impersonator.
        const made = makeDb(baseFixture('home-to-sabha'));
        db = made.db;

        await expect((globalAssignDriver as any)(
            { driverId: 'driver-1', carId: 'car-1' },
            { auth: { uid: 'someone-else' } },
        )).rejects.toThrow(/only request an assignment for themselves/i);

        expect(made.recorder.sets).toEqual([]);
        expect(made.recorder.updates).toEqual([]);
        expect(made.recorder.committed).toBe(false);
    });

    it('allows the driver to dispatch themselves', async () => {
        const { result } = await runAs('driver-1', baseFixture('home-to-sabha'));
        expect(result.status).toBe('success');
    });
});

describe('globalAssignDriver — who is allowed to be handed riders', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    /**
     * These replaced two tests of the K-means SEED query, which is gone: a driver
     * pool is not needed once the carload is built by seed-and-grow.
     *
     * One of them was called "requires an approved account, so a revoked driver
     * gets no riders" and asserted that the seed query contained an
     * `accountStatus == approved` clause. That clause decided who could be a
     * clustering centroid. It authorised nobody. Nothing in this function ever
     * checked the CALLER's account status or role, so a revoked account still
     * signed in and still holding a car could tap Assign Me and be handed
     * children's names, phone numbers and home addresses.
     *
     * These assert the thing the old name promised.
     */

    it('refuses a revoked account', async () => {
        const fixture = baseFixture('home-to-sabha');
        fixture.driver = { ...fixture.driver, accountStatus: 'revoked' };

        await expect(runAs('driver-1', fixture)).rejects.toThrow(/approved drivers/i);
    });

    it('refuses an account still awaiting approval', async () => {
        const fixture = baseFixture('home-to-sabha');
        fixture.driver = { ...fixture.driver, accountStatus: 'pending' };

        await expect(runAs('driver-1', fixture)).rejects.toThrow(/approved drivers/i);
    });

    it('refuses an approved account that is not a driver', async () => {
        const fixture = baseFixture('home-to-sabha');
        fixture.driver = { ...fixture.driver, roles: ['student'] };

        await expect(runAs('driver-1', fixture)).rejects.toThrow(/approved drivers/i);
    });

    it('refuses before writing anything at all', async () => {
        // The check must land before the fleet is touched or riders are moved.
        const fixture = baseFixture('home-to-sabha');
        fixture.driver = { ...fixture.driver, accountStatus: 'revoked' };
        const made = makeDb(fixture);
        db = made.db;

        await expect((globalAssignDriver as any)(
            { driverId: 'driver-1', carId: 'car-1' }, { auth: { uid: 'driver-1' } },
        )).rejects.toThrow();

        expect(made.recorder.updates).toHaveLength(0);
        expect(made.recorder.committed).toBe(false);
    });

    it('allows a manager who also drives, which is how every driver here is recorded', async () => {
        // hasGrantedRole, not hasRecordedRole. In this congregation every driver
        // is a manager who drives; reading only the recorded set would refuse
        // all of them.
        const fixture = baseFixture('home-to-sabha');
        fixture.driver = { ...fixture.driver, role: 'manager', roles: ['manager', 'driver', 'student'] };

        const { result } = await runAs('driver-1', fixture);

        expect((result as any).status).not.toBe('locked');
    });
});

describe('globalAssignDriver — persisted navigation URL', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes googleMapsUrl onto every assigned ride document', async () => {
        const { result, recorder } = await run(baseFixture('home-to-sabha'));

        expect(result.status).toBe('success');
        expect(recorder.committed).toBe(true);

        const rideUpdates = recorder.updates.filter(u => u.path.startsWith('rides/'));
        expect(rideUpdates.length).toBeGreaterThan(0);

        for (const update of rideUpdates) {
            expect(update.data.googleMapsUrl).toBeTruthy();
            expect(update.data.googleMapsUrl).toContain('google.com/maps/dir/');
        }
    });

    it('persists the same URL it returns, so a reload behaves like the fresh response', async () => {
        const { result, recorder } = await run(baseFixture('home-to-sabha'));

        const rideUpdate = recorder.updates.find(u => u.path.startsWith('rides/'))!;
        expect(rideUpdate.data.googleMapsUrl).toBe(result.googleMapsUrl);
    });

    it('points a drop-off run at the driver\'s home, not the venue', async () => {
        const { recorder } = await run(baseFixture('sabha-to-home'));

        const rideUpdate = recorder.updates.find(u => u.path.startsWith('rides/'))!;
        const url = new URL(rideUpdate.data.googleMapsUrl);

        expect(url.searchParams.get('destination')).toBe(`${DRIVER_HOME.lat},${DRIVER_HOME.lng}`);
        expect(url.searchParams.get('destination')).not.toBe(`${SABHA.lat},${SABHA.lng}`);
    });

    it('resolves a homeLocation written as {latitude, longitude}', async () => {
        // ProfileSetup writes this shape. Read raw, `.lat` was undefined and the
        // End waypoint — and every URL built from it — became NaN.
        const { recorder } = await run(baseFixture('sabha-to-home', {
            name: 'Asha',
            homeLocation: { latitude: DRIVER_HOME.lat, longitude: DRIVER_HOME.lng },
        }));

        const rideUpdate = recorder.updates.find(u => u.path.startsWith('rides/'))!;
        const url = new URL(rideUpdate.data.googleMapsUrl);

        expect(url.searchParams.get('destination')).toBe(`${DRIVER_HOME.lat},${DRIVER_HOME.lng}`);
        expect(rideUpdate.data.googleMapsUrl).not.toContain('NaN');
        expect(rideUpdate.data.googleMapsUrl).not.toContain('undefined');
    });

    it('refuses the 0,0 placeholder instead of routing into the Atlantic', async () => {
        await expect(run(baseFixture('home-to-sabha', {
            name: 'Asha',
            location: { latitude: 0, longitude: 0 },
        }))).rejects.toThrow(/location is not set/i);
    });
});

describe('globalAssignDriver — one car, one driver', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const takenCar = (holder: Record<string, unknown>) => ({
        name: 'Odyssey', color: 'Silver', licensePlate: 'ABC123', capacity: 4,
        status: 'in_use', ...holder,
    });

    it('refuses a car another driver already holds', async () => {
        // The guard read carData.currentDriverId. Every writer sets
        // assignedDriverId, so it compared undefined against a uid and passed
        // every time — two drivers, one car.
        await expect(run(baseFixture('home-to-sabha', undefined,
            takenCar({ assignedDriverId: 'someone-else' }),
        ))).rejects.toThrow(/assigned to another driver/i);
    });

    it('still refuses when the holder is recorded under the legacy name', async () => {
        await expect(run(baseFixture('home-to-sabha', undefined,
            takenCar({ currentDriverId: 'someone-else' }),
        ))).rejects.toThrow(/assigned to another driver/i);
    });

    it('lets the same driver re-assign the car they already hold', async () => {
        const { result } = await run(baseFixture('home-to-sabha', undefined,
            takenCar({ assignedDriverId: 'driver-1' }),
        ));

        expect(result.status).toBe('success');
    });

    it('marks the car taken in BOTH collections', async () => {
        // Writing only `cars` left `vehicles` saying available, and
        // useAvailableVehicles queries `vehicles` — so the car stayed in every
        // other driver's picker while it was in use.
        const { recorder } = await run(baseFixture('home-to-sabha'));

        const fleetWrites = recorder.sets.filter(
            s => s.path === 'cars/car-1' || s.path === 'vehicles/car-1');

        expect(fleetWrites.map(s => s.path).sort()).toEqual(['cars/car-1', 'vehicles/car-1']);
        for (const write of fleetWrites) {
            expect(write.data.status).toBe('in_use');
            expect(write.data.assignedDriverId).toBe('driver-1');
        }
    });

    it('records the driver\'s car under the canonical name and clears the legacy one', async () => {
        // This wrote only currentCarId while the client reads currentVehicleId.
        // The two then drifted on release, and the stale one got a car freed out
        // from under whoever held it next.
        const { recorder } = await run(baseFixture('home-to-sabha'));

        const driverWrite = recorder.sets.find(s => s.path === 'users/driver-1')!;

        expect(driverWrite.data.currentVehicleId).toBe('car-1');
        expect(driverWrite.data.currentCarId).toBeNull();
    });
});

describe('globalAssignDriver — a request costs its seats', () => {
    // The measured fleet: two vehicles, both capacity 4 — three passenger seats.
    const FLEET = [{ capacity: 4 }, { capacity: 4 }];

    const seatFixture = (
        rides: Array<{ id: string; data: Record<string, unknown> }>,
        vehicles = FLEET,
    ): Fixture => ({ ...baseFixture('home-to-sabha'), rides, vehicles });

    const ride = (id: string, studentId: string, data: Record<string, unknown> = {}) => ({
        id,
        data: {
            studentId, studentName: studentId.toUpperCase(),
            pickupLat: 42.35, pickupLng: -71.07, pickupAddress: '1 St',
            status: 'requested', ...data,
        },
    });

    beforeEach(() => { vi.clearAllMocks(); });

    it('treats a ride with no seatsRequested as one seat', async () => {
        // Every ride written before this release. If the default ever moved, the
        // whole existing queue would start being mis-booked with no error.
        const { recorder } = await run(seatFixture([ride('r1', 'stu-a')]));

        const update = recorder.updates.find(u => u.path === 'rides/r1')!;
        expect(update.data.seatsRequested).toBe(1);
    });

    it('does not hand three seats to two two-person requests', async () => {
        // The reported defect: a request WAS a seat, so a family of four was
        // booked one place and the driver arrived with room for one. Two
        // two-person requests and three seats must serve exactly ONE of them,
        // for two seats — never both, never three.
        //
        // r2 is the one taken because it is farther from the VENUE and so is the
        // seed. This assertion used to name r1, back when the ordering was
        // nearest-to-the-driver; the defect being guarded is the seat arithmetic,
        // not which of the two is chosen.
        const { recorder } = await run(seatFixture([
            ride('r1', 'stu-a', { seatsRequested: 2, pickupLat: 42.359, pickupLng: -71.059 }),
            ride('r2', 'stu-b', { seatsRequested: 2, pickupLat: 42.450, pickupLng: -71.050 }),
        ]));

        const assigned = recorder.updates.filter(u => u.path.startsWith('rides/'));
        expect(assigned.map(u => u.path)).toEqual(['rides/r2']);
        expect(assigned[0].data.seatsRequested).toBe(2);
    });

    it('waits for a bigger vehicle rather than splitting, when one exists', async () => {
        // A 7-seater is in the fleet, so the family can travel together later.
        const { result, recorder } = await run(seatFixture(
            [ride('r1', 'stu-a', { seatsRequested: 5 })],
            [{ capacity: 4 }, { capacity: 7 }],
        ));

        expect(result.status).toBe('no_students');
        expect(result.waiting).toEqual([
            { reason: 'waiting-for-bigger-vehicle', groups: 1, seats: 5 },
        ]);
        expect(recorder.updates.filter(u => u.path.startsWith('rides/'))).toEqual([]);
    });

    it('reports a group nobody can serve rather than skipping it in silence', async () => {
        // Bigger than any vehicle AND opted out of splitting. They can never be
        // served as things stand; a manager has to see that, or the family waits
        // all evening for a car that was never coming.
        const { result } = await run(seatFixture(
            [ride('r1', 'stu-a', { seatsRequested: 6, allowSplit: false })]));

        expect(result.status).toBe('no_students');
        expect(result.waiting).toEqual([
            { reason: 'too-large-to-keep-together', groups: 1, seats: 6 },
        ]);
    });
});

describe('globalAssignDriver — splitting a group across cars', () => {
    const FLEET = [{ capacity: 4 }, { capacity: 4 }];

    const sixSeats = (): Fixture => ({
        ...baseFixture('home-to-sabha'),
        vehicles: FLEET,
        rides: [{
            id: 'r1',
            data: {
                studentId: 'stu-a', studentName: 'A', studentPhone: '555',
                pickupLat: 42.35, pickupLng: -71.07, pickupAddress: '1 St',
                status: 'requested', seatsRequested: 6, date: '2026-08-07',
            },
        }],
    });

    beforeEach(() => { vi.clearAllMocks(); });

    it('assigns only what fits and books the rest as a fresh request', async () => {
        // No single tap can commit a second driver, so a group larger than any
        // vehicle is served sequentially: this car takes three, the remaining
        // three go back in the pool for whoever taps next.
        const { recorder } = await run(sixSeats());

        const assigned = recorder.updates.find(u => u.path === 'rides/r1')!;
        expect(assigned.data.seatsRequested).toBe(3);
        expect(assigned.data.groupSeatsTotal).toBe(6);
        expect(assigned.data.status).toBe('assigned');

        const remainder = recorder.sets.find(
            s => s.path.startsWith('rides/') && s.data.status === 'requested')!;
        expect(remainder).toBeDefined();
        expect(remainder.data.seatsRequested).toBe(3);
        expect(remainder.data.studentId).toBe('stu-a');
        expect(remainder.data.splitFromRideId).toBe('r1');
    });

    it('loses no seats in the split', async () => {
        const { recorder } = await run(sixSeats());

        const assigned = recorder.updates.find(u => u.path === 'rides/r1')!;
        const remainder = recorder.sets.find(
            s => s.path.startsWith('rides/') && s.data.status === 'requested')!;

        expect(assigned.data.seatsRequested + remainder.data.seatsRequested).toBe(6);
    });

    it('links both halves under one groupId', async () => {
        // Without it the rider's screen cannot say "3 of your 6 are with Ravi",
        // and completion would declare the family home while half are waiting.
        const { recorder } = await run(sixSeats());

        const assigned = recorder.updates.find(u => u.path === 'rides/r1')!;
        const remainder = recorder.sets.find(
            s => s.path.startsWith('rides/') && s.data.status === 'requested')!;

        expect(assigned.data.groupId).toBeTruthy();
        expect(remainder.data.groupId).toBe(assigned.data.groupId);
        expect(remainder.data.groupSeatsTotal).toBe(6);
    });

    it('leaves exactly one waiting request for the rider, so the pool cannot drop it', async () => {
        // The pool used to be keyed by studentId, keeping the FIRST request per
        // person. Under that key the remainder of a split simply vanished — the
        // family's other three seats stopped existing with no error anywhere.
        const { recorder } = await run(sixSeats());

        const stillWaiting = recorder.sets.filter(
            s => s.path.startsWith('rides/') && s.data.status === 'requested');

        expect(stillWaiting).toHaveLength(1);
        expect(stillWaiting[0].data.studentId).toBe('stu-a');
    });

    it('stamps the remainder with tenancy and the gathering it belongs to', async () => {
        // A ride created without cityId is exactly the document the tenancy
        // verifier exists to catch, and it would be created on a Friday evening.
        const { recorder } = await run(sixSeats());

        const remainder = recorder.sets.find(
            s => s.path.startsWith('rides/') && s.data.status === 'requested')!;

        expect(remainder.data.cityId).toBe('boston');
        expect(remainder.data.locationId).toBe('boston-huntington');
        expect(remainder.data.eventDate).toBe('2026-08-07');
    });

    it('divides the remainder again without inventing people', async () => {
        // A party of 8 against 3-seat cars splits more than once. The second car
        // is dividing a 5-seat REMAINDER, and measuring that against the party's
        // original 8 would book 8-3=5 more seats instead of 5-3=2 — three people
        // who do not exist, and a car sent for them every round for ever.
        const { recorder } = await run({
            ...baseFixture('home-to-sabha'),
            vehicles: FLEET,
            rides: [{
                id: 'r2',
                data: {
                    studentId: 'stu-a', studentName: 'A',
                    pickupLat: 42.35, pickupLng: -71.07, pickupAddress: '1 St',
                    status: 'requested',
                    seatsRequested: 5, groupId: 'r1', groupSeatsTotal: 8,
                },
            }],
        });

        const assigned = recorder.updates.find(u => u.path === 'rides/r2')!;
        const remainder = recorder.sets.find(
            s => s.path.startsWith('rides/') && s.data.status === 'requested')!;

        expect(assigned.data.seatsRequested).toBe(3);
        expect(remainder.data.seatsRequested).toBe(2);
        // The party is still 8, and the group key still points at the original.
        expect(remainder.data.groupSeatsTotal).toBe(8);
        expect(remainder.data.groupId).toBe('r1');
    });

    it('writes no undefined values anywhere, at any depth', async () => {
        // The Admin SDK is not configured with ignoreUndefinedProperties, so a
        // single undefined — including one nested in the students array — makes
        // the whole batch throw. That would break EVERY assignment, split or not,
        // and the fake Firestore in this file accepts it without complaint.
        const hasUndefined = (v: unknown): boolean => {
            if (v === undefined) return true;
            if (Array.isArray(v)) return v.some(hasUndefined);
            if (v && typeof v === 'object') return Object.values(v).some(hasUndefined);
            return false;
        };

        for (const fixture of [sixSeats(), baseFixture('home-to-sabha')]) {
            const { recorder } = await run(fixture);
            for (const write of [...recorder.updates, ...recorder.sets]) {
                expect(hasUndefined(write.data), `undefined in ${write.path}`).toBe(false);
            }
        }
    });

    it('writes rider state under the rider uid, not the ride id', async () => {
        // The pool is keyed by ride document now. Carrying that id through to the
        // profile write would have created users/<rideId> and left the real rider
        // untouched.
        const { recorder } = await run(sixSeats());

        expect(recorder.sets.some(s => s.path === 'users/stu-a')).toBe(true);
        expect(recorder.sets.some(s => s.path === 'users/r1')).toBe(false);
    });
});

describe('globalAssignDriver — per-event venue', () => {
    const HALL_B = { lat: 42.3800, lng: -71.1200, address: 'Hall B, Somerville' };

    it('routes a pickup run to the gathering\'s own venue, not settings/main', async () => {
        // The venue used to come from settings/main unconditionally, so moving one
        // sabha to a different hall had no effect on where drivers were sent.
        const { recorder } = await run({ ...baseFixture('home-to-sabha'), venue: HALL_B });

        const rideUpdate = recorder.updates.find(u => u.path.startsWith('rides/'))!;
        const url = new URL(rideUpdate.data.googleMapsUrl);

        expect(url.searchParams.get('destination')).toBe(`${HALL_B.lat},${HALL_B.lng}`);
        expect(url.searchParams.get('destination')).not.toBe(`${SABHA.lat},${SABHA.lng}`);
    });

    it('starts a drop-off run from the gathering\'s own venue', async () => {
        const { recorder } = await run({ ...baseFixture('sabha-to-home'), venue: HALL_B });

        const rideUpdate = recorder.updates.find(u => u.path.startsWith('rides/'))!;
        expect(rideUpdate.data.route[0].lat).toBe(HALL_B.lat);
        expect(rideUpdate.data.route[0].lng).toBe(HALL_B.lng);
    });

    it('falls back to settings/main when the gathering has no override', async () => {
        // The compatibility guarantee: with no override anywhere, behaviour is
        // byte-identical to before per-event venues existed.
        const { recorder } = await run({ ...baseFixture('home-to-sabha'), venue: null });

        const rideUpdate = recorder.updates.find(u => u.path.startsWith('rides/'))!;
        const url = new URL(rideUpdate.data.googleMapsUrl);

        expect(url.searchParams.get('destination')).toBe(`${SABHA.lat},${SABHA.lng}`);
    });

    it('ignores a 0,0 override rather than routing into the Atlantic', async () => {
        const { recorder } = await run({
            ...baseFixture('home-to-sabha'),
            venue: { lat: 0, lng: 0, address: 'Never geocoded' },
        });

        const rideUpdate = recorder.updates.find(u => u.path.startsWith('rides/'))!;
        const url = new URL(rideUpdate.data.googleMapsUrl);

        expect(url.searchParams.get('destination')).toBe(`${SABHA.lat},${SABHA.lng}`);
    });

    it('snapshots the venue and eventId onto every assigned ride', async () => {
        // manualAssignStudent reads ride.venue rather than resolving live, so that
        // adding a passenger cannot re-point everyone already on board.
        const { recorder } = await run({
            ...baseFixture('home-to-sabha'),
            venue: HALL_B,
            eventId: '2026-08-11',
        });

        const rideUpdates = recorder.updates.filter(u => u.path.startsWith('rides/'));
        expect(rideUpdates.length).toBeGreaterThan(0);

        for (const update of rideUpdates) {
            expect(update.data.venue).toEqual(HALL_B);
            expect(update.data.eventId).toBe('2026-08-11');
        }
    });
});

/**
 * The event filter.
 *
 * A `requested` ride was only ever filtered by `status`, so a leftover request
 * from a PREVIOUS sabha stayed in the dispatch pool for ever. Three were live in
 * production on 2026-08-14, five days after their gathering, and the next tap
 * would have routed a driver to collect people for a sabha that had happened.
 *
 * The pool is the one input to every clustering and seat decision below it, so a
 * stale member is not a cosmetic problem — it sends a car to the wrong place.
 */
describe('isValidPendingRide — which gathering a request belongs to', () => {
    const good = {
        studentId: 'stu_1',
        pickupLat: 42.34,
        pickupLng: -71.09,
    };

    it('accepts a request stamped with the gathering being dispatched', () => {
        expect(isValidPendingRide({ ...good, eventId: '2026-08-14' }, '2026-08-14', 'home-to-sabha')).toBe(true);
    });

    it('accepts `eventDate`, which is what the client actually writes', () => {
        // hooks/useRides.ts stamps `date` and `eventDate`, never `eventId` — so a
        // filter that only read eventId would reject every real rider request.
        expect(isValidPendingRide({ ...good, eventDate: '2026-08-14' }, '2026-08-14', 'home-to-sabha')).toBe(true);
    });

    it('REJECTS a request for a past gathering — the reported bug', () => {
        expect(isValidPendingRide({ ...good, eventDate: '2026-08-09' }, '2026-08-14', 'home-to-sabha')).toBe(false);
    });

    it('rejects a request for a future gathering too', () => {
        // Requests open two days ahead, so a rider can hold one for next week
        // while tonight is being dispatched.
        expect(isValidPendingRide({ ...good, eventDate: '2026-08-21' }, '2026-08-14', 'home-to-sabha')).toBe(false);
    });

    it('rejects a request carrying no event key at all', () => {
        // Deliberate: accepting it means dispatching it to every gathering for
        // ever. Refusing leaves it visible in the manager's Waiting queue.
        expect(isValidPendingRide({ ...good }, '2026-08-14', 'home-to-sabha')).toBe(false);
    });

    it('prefers eventId over eventDate when the two disagree', () => {
        // eventId is written by the server, eventDate by the browser. Same order
        // as eventKeyFromRide uses everywhere else.
        expect(isValidPendingRide(
            { ...good, eventId: '2026-08-14', eventDate: '2026-08-09' }, '2026-08-14', 'home-to-sabha',
        )).toBe(true);
    });

    it('ignores a malformed event key rather than matching on it', () => {
        expect(isValidPendingRide({ ...good, eventDate: 'next friday' }, '2026-08-14', 'home-to-sabha')).toBe(false);
    });

    it('does not filter by event when no gathering is known', () => {
        // rideType is null whenever eventId is, so the handler throws before it
        // gets here. Kept permissive so a future caller cannot silently empty the
        // pool by passing null.
        expect(isValidPendingRide({ ...good, eventDate: '2026-08-09' }, null, 'home-to-sabha')).toBe(true);
    });

    it('still rejects the 0,0 placeholder that means "never geocoded"', () => {
        expect(isValidPendingRide(
            { studentId: 'stu_1', pickupLat: 0, pickupLng: 0, eventDate: '2026-08-14' },
            '2026-08-14', 'home-to-sabha',
        )).toBe(false);
    });

    it('still rejects a request with no studentId', () => {
        expect(isValidPendingRide(
            { pickupLat: 42.34, pickupLng: -71.09, eventDate: '2026-08-14' },
            '2026-08-14', 'home-to-sabha',
        )).toBe(false);
    });

    it('still rejects non-numeric coordinates', () => {
        expect(isValidPendingRide(
            { ...good, pickupLat: '42.34', eventDate: '2026-08-14' },
            '2026-08-14', 'home-to-sabha',
        )).toBe(false);
    });
});

/**
 * The same filter, proven through the handler rather than on the predicate.
 *
 * The unit tests above assert the decision; these assert that dispatch actually
 * applies it. Both are worth having: the predicate could be perfect and never
 * called, which is the shape of most bugs in this codebase.
 */
describe('globalAssignDriver — a stale request is never dispatched', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reports no students when the only requests are for a past sabha', async () => {
        const fixture = baseFixture('home-to-sabha');
        fixture.eventId = '2026-08-14';
        // Exactly the production state on 2026-08-14: requests left over from the
        // gathering on the 9th, which a tap would have dispatched.
        fixture.rides = fixture.rides.map(r => ({
            id: r.id,
            data: { ...r.data, eventDate: '2026-08-09' },
        }));

        const { result, recorder } = await runAs('driver-1', fixture);

        expect((result as any).status).toBe('no_students');
        // And nothing was written — no ride assigned, no car taken.
        expect(recorder.updates).toHaveLength(0);
    });

    it('still dispatches requests that belong to tonight', async () => {
        const fixture = baseFixture('home-to-sabha');
        fixture.eventId = '2026-08-14';
        fixture.rides = fixture.rides.map(r => ({
            id: r.id,
            data: { ...r.data, eventDate: '2026-08-14' },
        }));

        const { result } = await runAs('driver-1', fixture);

        expect((result as any).status).not.toBe('no_students');
    });

    it('dispatches tonight and leaves last week behind, from one mixed pool', async () => {
        // The case that matters operationally: a stale request must not poison a
        // pool that also holds real ones.
        const fixture = baseFixture('home-to-sabha');
        fixture.eventId = '2026-08-14';
        const [first, ...rest] = fixture.rides;
        fixture.rides = [
            { id: first.id, data: { ...first.data, eventDate: '2026-08-09' } },
            ...rest.map(r => ({ id: r.id, data: { ...r.data, eventDate: '2026-08-14' } })),
        ];

        const { recorder } = await runAs('driver-1', fixture);

        const assignedPaths = recorder.updates.map(u => u.path);
        expect(assignedPaths).not.toContain(`rides/${first.id}`);
        expect(assignedPaths.length).toBeGreaterThan(0);
    });
});

/**
 * The direction filter.
 *
 * The pool was filtered by status and event but never by DIRECTION, and the two
 * kinds of request do not look alike: a pickup carries no `rideType` at all,
 * while studentReadyToLeave stamps 'sabha-to-home'. So once the window flipped,
 * every unserved pickup was swept into the drop-off run.
 *
 * Reproduced in production on 2026-08-14: Rebo Fe asked to be COLLECTED from
 * home and was assigned a driver routed from the venue to her house — a sabha
 * she had never reached. Unserved pickups always outlive the pickup window, so
 * this fired every week.
 */
describe('isValidPendingRide — which direction the rider asked for', () => {
    const good = { studentId: 'stu_1', pickupLat: 42.34, pickupLng: -71.09, eventDate: '2026-08-14' };
    const EVENT = '2026-08-14';

    it('accepts a pickup request during the pickup window', () => {
        // No rideType field, which is exactly what hooks/useRides.ts writes.
        expect(isValidPendingRide(good, EVENT, 'home-to-sabha')).toBe(true);
    });

    it('REJECTS a pickup request during the drop-off window — the reported bug', () => {
        // Rebo Fe's case. Taking her home from a sabha she never reached.
        expect(isValidPendingRide(good, EVENT, 'sabha-to-home')).toBe(false);
    });

    it('accepts a drop-off request during the drop-off window', () => {
        expect(isValidPendingRide(
            { ...good, rideType: 'sabha-to-home' }, EVENT, 'sabha-to-home',
        )).toBe(true);
    });

    it('rejects a drop-off request during the pickup window', () => {
        // The mirror case: someone who asked to go home cannot be collected
        // from home for a sabha that has not started.
        expect(isValidPendingRide(
            { ...good, rideType: 'sabha-to-home' }, EVENT, 'home-to-sabha',
        )).toBe(false);
    });

    it('treats an ABSENT rideType as a pickup, because every real one is', () => {
        // Load-bearing. Every pickup request ever written lacks the field, so
        // treating absent as "no match" would refuse all of them.
        expect(isValidPendingRide(good, EVENT, 'home-to-sabha')).toBe(true);
        expect(isValidPendingRide({ ...good, rideType: null }, EVENT, 'home-to-sabha')).toBe(true);
    });

    it('honours an explicit home-to-sabha as well as an absent one', () => {
        expect(isValidPendingRide(
            { ...good, rideType: 'home-to-sabha' }, EVENT, 'home-to-sabha',
        )).toBe(true);
    });

    it('rejects an unrecognised direction rather than defaulting it', () => {
        // A hand-edited value should strand one request visibly, not quietly
        // join whichever run happens to be open.
        expect(isValidPendingRide(
            { ...good, rideType: 'sabha-to-Home' }, EVENT, 'home-to-sabha',
        )).toBe(false);
        expect(isValidPendingRide(
            { ...good, rideType: 'sabha-to-Home' }, EVENT, 'sabha-to-home',
        )).toBe(false);
    });

    it('applies both filters together, not one or the other', () => {
        // Right direction, wrong sabha.
        expect(isValidPendingRide(
            { ...good, eventDate: '2026-08-09', rideType: 'sabha-to-home' }, EVENT, 'sabha-to-home',
        )).toBe(false);
    });
});

describe('globalAssignDriver — a pickup is never served by a drop-off run', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('reports no students when only pickup requests remain at drop-off time', async () => {
        const fixture = baseFixture('sabha-to-home');
        fixture.eventId = '2026-08-14';
        // Unserved pickups, exactly as they sit in the queue when the window
        // flips. `rideType` is absent because that is what the client writes.
        fixture.rides = fixture.rides.map(r => ({
            id: r.id,
            data: { ...r.data, eventDate: '2026-08-14', rideType: undefined },
        }));

        const { result, recorder } = await runAs('driver-1', fixture);

        expect((result as any).status).toBe('no_students');
        expect(recorder.updates).toHaveLength(0);
    });

    it('still serves genuine drop-off requests', async () => {
        const fixture = baseFixture('sabha-to-home');
        fixture.eventId = '2026-08-14';
        fixture.rides = fixture.rides.map(r => ({
            id: r.id,
            data: { ...r.data, eventDate: '2026-08-14', rideType: 'sabha-to-home' },
        }));

        const { result } = await runAs('driver-1', fixture);

        expect((result as any).status).not.toBe('no_students');
    });
});
