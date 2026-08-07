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

import { globalAssignDriver } from './globalAssignDriver';

// ── fake Firestore ─────────────────────────────────────────

interface Fixture {
    rideType: string;
    driver: Record<string, unknown>;
    car: Record<string, unknown>;
    rides: Array<{ id: string; data: Record<string, unknown> }>;
    /** Per-event venue override published on system/rideContext. */
    venue?: { lat: number; lng: number; address: string } | null;
    eventId?: string;
}

/** Records everything written through the batch so tests can assert on it. */
interface Recorder {
    updates: Array<{ path: string; data: any }>;
    sets: Array<{ path: string; data: any }>;
    committed: boolean;
}

function makeDb(fixture: Fixture): { db: any; recorder: Recorder } {
    const recorder: Recorder = { updates: [], sets: [], committed: false };

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

    const collection = (name: string) => {
        const chain: any = {
            doc: (id: string) => ({ id, path: `${name}/${id}`, get: async () => docFor(name, id) }),
            where: () => chain,
            get: async () => {
                if (name === 'rides') return querySnap(fixture.rides);
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
    driver: driverOverride ?? {
        name: 'Asha',
        phone: '555-0100',
        location: { lat: DRIVER_HOME.lat, lng: DRIVER_HOME.lng },
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
