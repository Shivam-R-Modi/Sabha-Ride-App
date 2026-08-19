/**
 * One run ending is not the evening ending.
 *
 * THE MODEL THAT WAS WRONG
 * ------------------------
 * `completeRide` and `releaseAssignment` both released the driver's vehicle and
 * cleared `currentVehicleId`. That treats a single run as the end of the driver's
 * relationship with the car. A volunteer keeps one car all evening and does
 * several runs in it, so it produced two failures:
 *
 *  - "Assign next" on the completion screen guards on
 *    `userProfile.currentVehicleId`. AuthContext subscribes to the user document,
 *    so the snapshot nulled that field in ~50-200ms while handleAssignNext waited
 *    a hardcoded 100ms. Whichever won decided whether the driver got riders or
 *    "Pick a car before finding riders" — intermittent, and unexplainable from
 *    the screen.
 *
 *  - Quieter and worse: the car went back to `available` with no holder, so
 *    ANOTHER driver could take it between runs. The first driver then got
 *    "Vehicle is assigned to another driver" for a car they had used all evening.
 *
 * Only `driverDoneForToday` releases now — the explicit "everyone is home and so
 * am I". A driver who just closes the app is caught by releaseIdleVehicles at
 * 03:00, or freed sooner by managerReleaseVehicle.
 *
 * None of these three handlers had a single test before this file, which is why
 * changing their core behaviour broke nothing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
            this.name = 'HttpsError';
        }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});

vi.mock('firebase-admin', () => ({ firestore: () => db }));
vi.mock('../utils/notifications', () => ({
    notifyStudentRideCompleted: vi.fn(async () => undefined),
    notifyStudentRideStarting: vi.fn(async () => undefined),
}));

import { completeRide } from './completeRide';
import { releaseAssignment } from './releaseAssignment';
import { driverDoneForToday } from './driverDoneForToday';

interface Recorder {
    sets: Array<{ path: string; data: any }>;
    updates: Array<{ path: string; data: any }>;
    committed: boolean;
}

const DRIVER = {
    name: 'Asha',
    currentVehicleId: 'veh_1',
    activeRideId: 'ride_1',
    ridesCompletedToday: 1,
    totalStudentsToday: 2,
    totalDistanceToday: 5,
};

function makeDb(opts: {
    ride?: Record<string, unknown> | null;
    driver?: Record<string, unknown> | null;
    /** Rides still assigned to the driver, for the done-for-today guard. */
    stillAssigned?: Array<Record<string, unknown>>;
}) {
    const recorder: Recorder = { sets: [], updates: [], committed: false };
    const snap = (exists: boolean, data?: any) => ({ exists, data: () => data });
    const assigned = opts.stillAssigned ?? [];

    const collection = (name: string) => {
        const chain: any = {
            doc: (id: string) => ({
                path: `${name}/${id}`,
                get: async () => {
                    if (name === 'rides') return snap(opts.ride !== null && opts.ride !== undefined, opts.ride);
                    return snap(opts.driver !== null && opts.driver !== undefined, opts.driver);
                },
            }),
            where: () => chain,
            get: async () => ({
                empty: assigned.length === 0,
                size: assigned.length,
                docs: assigned.map((d, i) => ({ id: `r${i}`, data: () => d })),
            }),
        };
        return chain;
    };

    db = {
        collection,
        batch: () => ({
            set: (ref: any, data: any) => recorder.sets.push({ path: ref.path, data }),
            update: (ref: any, data: any) => recorder.updates.push({ path: ref.path, data }),
            delete: () => undefined,
            commit: async () => { recorder.committed = true; },
        }),
    };
    return recorder;
}

/** Anything written to either half of the fleet mirror. */
const fleetWrites = (r: Recorder) =>
    [...r.sets, ...r.updates].filter(w => w.path.startsWith('vehicles/') || w.path.startsWith('cars/'));

const driverWrite = (r: Recorder) => r.updates.find(w => w.path.startsWith('users/'))?.data;

beforeEach(() => vi.clearAllMocks());

describe('completeRide — the driver keeps their car', () => {
    const ride = {
        driverId: 'driver_1', status: 'in_progress', carId: 'veh_1',
        rideType: 'home-to-sabha', students: [{ id: 'stu_1', seats: 2 }],
        estimatedDistance: 4,
    };

    it('does NOT release the vehicle', async () => {
        const rec = makeDb({ ride, driver: DRIVER });

        await (completeRide as any)({ rideId: 'ride_1' }, { auth: { uid: 'driver_1' } });

        expect(fleetWrites(rec)).toEqual([]);
    });

    it('does NOT clear currentVehicleId', async () => {
        // The field "Assign next" guards on. Clearing it is what made the next
        // tap a race against a Firestore snapshot.
        const rec = makeDb({ ride, driver: DRIVER });

        await (completeRide as any)({ rideId: 'ride_1' }, { auth: { uid: 'driver_1' } });

        expect(driverWrite(rec)).not.toHaveProperty('currentVehicleId');
        expect(driverWrite(rec)).not.toHaveProperty('currentCarId');
    });

    it('leaves the driver on shift and ready for the next tap', async () => {
        const rec = makeDb({ ride, driver: DRIVER });

        await (completeRide as any)({ rideId: 'ride_1' }, { auth: { uid: 'driver_1' } });

        expect(driverWrite(rec).status).toBe('available');
    });

    it('still clears activeRideId, because that ride really is over', async () => {
        const rec = makeDb({ ride, driver: DRIVER });

        await (completeRide as any)({ rideId: 'ride_1' }, { auth: { uid: 'driver_1' } });

        expect(driverWrite(rec).activeRideId).toBeNull();
    });

    it('still counts the run towards the day', async () => {
        const rec = makeDb({ ride, driver: DRIVER });

        await (completeRide as any)({ rideId: 'ride_1' }, { auth: { uid: 'driver_1' } });

        expect(driverWrite(rec).ridesCompletedToday).toBe(2);
        // 2 already + 1. The fake returns no grouped ride documents, so
        // `seatsCarried` is 0 and the handler falls back to
        // `ride.students.length` — a real fallback, exercised here rather than
        // asserted away.
        expect(driverWrite(rec).totalStudentsToday).toBe(3);
    });
});

describe('releaseAssignment — declining does not cost the driver their car', () => {
    const ride = {
        driverId: 'driver_1', status: 'assigned', carId: 'veh_1',
        rideType: 'home-to-sabha', students: [{ id: 'stu_1' }],
    };

    it('does NOT release the vehicle', async () => {
        // Declining a proposed run is ordinary — the preview exists so a driver
        // can look at who they were given and say no.
        const rec = makeDb({ ride, driver: DRIVER });

        await (releaseAssignment as any)({ rideId: 'ride_1' }, { auth: { uid: 'driver_1' } });

        expect(fleetWrites(rec)).toEqual([]);
    });

    it('does NOT clear currentVehicleId', async () => {
        const rec = makeDb({ ride, driver: DRIVER });

        await (releaseAssignment as any)({ rideId: 'ride_1' }, { auth: { uid: 'driver_1' } });

        expect(driverWrite(rec)).not.toHaveProperty('currentVehicleId');
    });

    it('still returns the ride to the queue', async () => {
        const rec = makeDb({ ride, driver: DRIVER });

        await (releaseAssignment as any)({ rideId: 'ride_1' }, { auth: { uid: 'driver_1' } });

        const rideWrite = rec.updates.find(w => w.path === 'rides/ride_1')!;
        expect(rideWrite.data.status).toBe('requested');
        expect(rideWrite.data.driverId).toBeNull();
    });
});

describe('driverDoneForToday — the only thing that releases, and only when clear', () => {
    const CLEAR_DRIVER = { ...DRIVER, activeRideId: null };

    it('refuses while riders are still assigned', async () => {
        // "Done for today" means everyone is home. Releasing the car and going
        // offline with people still expecting collection is the one failure worth
        // being loud about.
        makeDb({
            driver: CLEAR_DRIVER,
            stillAssigned: [{ studentName: 'Rebo Fe' }, { studentName: 'Joka Kab' }],
        });

        await expect((driverDoneForToday as any)({ driverId: 'driver_1' }, { auth: { uid: 'driver_1' } }))
            .rejects.toThrow(/still have 2 rider/i);
    });

    it('names who is still waiting', async () => {
        makeDb({ driver: CLEAR_DRIVER, stillAssigned: [{ studentName: 'Rebo Fe' }] });

        await expect((driverDoneForToday as any)({ driverId: 'driver_1' }, { auth: { uid: 'driver_1' } }))
            .rejects.toThrow(/Rebo Fe/);
    });

    it('checks the RIDES, not just activeRideId', async () => {
        // activeRideId names one ride; a carload is several documents, and the
        // pointer has been both stale and wrong in production on the same day.
        makeDb({ driver: CLEAR_DRIVER, stillAssigned: [{ studentName: 'Rebo Fe' }] });

        await expect((driverDoneForToday as any)({ driverId: 'driver_1' }, { auth: { uid: 'driver_1' } }))
            .rejects.toThrow(/Complete or release them first/i);
    });

    it('releases the car once nobody is left', async () => {
        const rec = makeDb({ driver: CLEAR_DRIVER, stillAssigned: [] });

        await (driverDoneForToday as any)({ driverId: 'driver_1' }, { auth: { uid: 'driver_1' } });

        const freed = fleetWrites(rec);
        expect(freed.map(w => w.path).sort()).toEqual(['cars/veh_1', 'vehicles/veh_1']);
        for (const w of freed) expect(w.data.status).toBe('available');
    });

    it('takes the driver offline', async () => {
        const rec = makeDb({ driver: CLEAR_DRIVER, stillAssigned: [] });

        await (driverDoneForToday as any)({ driverId: 'driver_1' }, { auth: { uid: 'driver_1' } });

        expect(driverWrite(rec).status).toBe('offline');
    });

    it('refuses a caller finishing someone else\'s shift', async () => {
        makeDb({ driver: CLEAR_DRIVER, stillAssigned: [] });

        await expect((driverDoneForToday as any)({ driverId: 'driver_1' }, { auth: { uid: 'someone_else' } }))
            .rejects.toThrow(/only the sarthi/i);
    });
});
