/**
 * A soft release must not leave the driver pointing at a ride that is no longer
 * theirs.
 *
 * THE BUG
 * -------
 * `returnStudentToPool` is the manager's "Soft Release": it puts riders back in
 * the queue while deliberately KEEPING the driver on shift in their car, so they
 * can be handed new riders. That part is correct and is the whole difference
 * between soft and hard release.
 *
 * What it did not do was clear the driver's `activeRideId`. The ride went back to
 * the pool with `driverId: null`, and the driver went on naming it. Observed in
 * production on 2026-08-14: Tonny Stark still held `activeRideId igFK1kHP` after
 * that ride had been returned to the queue and picked up by nobody.
 *
 * A dangling pointer of this shape is the same family as the orphaned vehicle
 * earlier the same day — one side of a two-sided relationship cleared, the other
 * left behind, and nothing anywhere reporting the mismatch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Every write the code under test performs, in order. */
const updates: Array<{ path: string; data: any }> = [];
/** Documents the fake store will return. */
let store: Record<string, any> = {};

vi.mock('firebase/firestore', () => ({
    doc: (_db: any, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    getDoc: async (ref: any) => ({
        exists: () => store[ref.path] !== undefined,
        data: () => store[ref.path],
    }),
    updateDoc: async (ref: any, data: any) => { updates.push({ path: ref.path, data }); },
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    onSnapshot: vi.fn(),
    getDocs: vi.fn(),
    addDoc: vi.fn(),
    setDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    writeBatch: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    increment: vi.fn(),
    Timestamp: { now: vi.fn() },
    documentId: vi.fn(),
}));
vi.mock('../../firebase/config', () => ({ db: {}, auth: {} }));

import { returnStudentToPool } from '../../hooks/useRides';

const RIDE = 'rides/ride_1';
const DRIVER = 'users/driver_1';

beforeEach(() => {
    updates.length = 0;
    store = {
        [RIDE]: { studentId: 'student_1', driverId: 'driver_1', carId: 'veh_1' },
        [DRIVER]: { activeRideId: 'ride_1', currentVehicleId: 'veh_1', status: 'available' },
    };
});

const writeTo = (path: string) => updates.find(u => u.path === path)?.data;

describe('returnStudentToPool — the ride goes back', () => {
    it('returns the ride to the queue', async () => {
        await returnStudentToPool('ride_1');

        expect(writeTo(RIDE).status).toBe('requested');
        expect(writeTo(RIDE).driverId).toBeNull();
        expect(writeTo(RIDE).carId).toBeNull();
    });

    it('puts the student back to waiting', async () => {
        await returnStudentToPool('ride_1');

        expect(writeTo('users/student_1').status).toBe('waiting');
        expect(writeTo('users/student_1').currentRideId).toBeNull();
    });
});

describe('returnStudentToPool — the driver side is cleared too', () => {
    it('clears the driver\'s activeRideId', async () => {
        await returnStudentToPool('ride_1');

        expect(writeTo(DRIVER)).toBeDefined();
        expect(writeTo(DRIVER).activeRideId).toBeNull();
    });

    it('KEEPS the driver in their car — that is what makes it a soft release', async () => {
        // Clearing currentVehicleId here would collapse soft release into hard
        // release and take a car off a driver who is still on shift waiting for
        // riders.
        await returnStudentToPool('ride_1');

        expect(writeTo(DRIVER)).not.toHaveProperty('currentVehicleId');
        expect(writeTo(DRIVER)).not.toHaveProperty('currentCarId');
    });

    it('does not touch a driver who has moved on to another ride', async () => {
        // The pointer must only be cleared when it still names THIS ride.
        // Blanking it unconditionally would wipe a live assignment.
        store[DRIVER].activeRideId = 'ride_99';

        await returnStudentToPool('ride_1');

        expect(writeTo(DRIVER)).toBeUndefined();
    });

    it('survives a ride that had no driver', async () => {
        store[RIDE].driverId = null;

        await returnStudentToPool('ride_1');

        expect(writeTo(RIDE).status).toBe('requested');
        expect(writeTo(DRIVER)).toBeUndefined();
    });

    it('survives a driver whose record has already gone', async () => {
        delete store[DRIVER];

        await expect(returnStudentToPool('ride_1')).resolves.not.toThrow();
        expect(writeTo(RIDE).status).toBe('requested');
    });

    it('reads driverId before clearing it, or there is nothing left to find', async () => {
        // The ride write nulls driverId. If the driver were resolved after that,
        // the pointer could never be cleared — which is exactly how this bug
        // would come back.
        await returnStudentToPool('ride_1');

        const rideIndex = updates.findIndex(u => u.path === RIDE);
        const driverIndex = updates.findIndex(u => u.path === DRIVER);

        expect(rideIndex).toBeGreaterThanOrEqual(0);
        expect(driverIndex).toBeGreaterThan(rideIndex);
        expect(writeTo(DRIVER).activeRideId).toBeNull();
    });
});
