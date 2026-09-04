/**
 * A manager putting one rider into a Sarthi's car by hand.
 *
 * THIS HANDLER HAD NO TESTS, and it is the only path that can break the headline
 * multi-location invariant through ORDINARY USE — no race, no bad actor, just a manager
 * tapping a button that has been there for months.
 *
 * The rider's waiting request was found with `.find(r => r.status === 'requested')`:
 * no gathering, no direction, no hall. So a leftover request from a previous sabha, a
 * pickup request while a drop-off run was being built, or a request for the OTHER hall
 * all satisfied it, and the rider was added anyway with that request's seat count.
 * Today the visible cost is a wrong seat count. With two halls it is a child driven to
 * the wrong building.
 *
 * `rejectionFor` is now the filter — the same predicate `globalAssignDriver` uses — so
 * the manual path and the automatic one cannot disagree about who belongs in a car.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) { super(message); this.name = 'HttpsError'; }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});
vi.mock('firebase-admin', () => ({ firestore: () => db }));

vi.mock('../utils/notifications', () => ({
    notifyStudentDriverAssigned: async () => undefined,
    tokensOf: () => [],
}));
vi.mock('../utils/authz', () => ({
    assertApprovedManager: async () => ({ name: 'Mira' }),
}));

const HALL_A = { lat: 42.339925, lng: -71.088182, address: '360 Huntington Ave' };
const HALL_B = { lat: 42.387, lng: -71.099, address: '5 Elm Street' };

vi.mock('../utils/settings', () => ({
    getSabhaLocation: async () => ({ lat: 42.339925, lng: -71.088182, address: 'settings/main' }),
    getLocation: async (id: string) => (id === 'somerville'
        ? { id, name: 'Somerville', venue: HALL_B, active: true, order: 1 }
        : { id, name: 'Sabha', venue: HALL_A, active: true, order: 0 }),
    // Real behaviour: the venue precedence is one of the things asserted here.
    resolveVenue: (candidate: any, fallback: any) => {
        const usable = (v: any) => !!v
            && Number.isFinite(v.lat) && Number.isFinite(v.lng)
            && !(v.lat === 0 && v.lng === 0);
        return usable(candidate)
            ? { lat: candidate.lat, lng: candidate.lng, address: candidate.address || fallback.address }
            : fallback;
    },
}));

import { manualAssignStudent } from './manualAssignStudent';

const DATE = '2026-08-14';
const RIDER = 'stu_new';
const DRIVER = 'driver_1';

interface Fixture {
    /** The Sarthi's active ride documents — one carload, one document per rider. */
    activeRides: Array<Record<string, unknown>>;
    /** Every ride document belonging to the rider being added. */
    riderRides: Array<Record<string, unknown>>;
    rider?: Record<string, unknown>;
}

let updates: Array<{ path: string; data: any }>;

function makeDb(f: Fixture) {
    updates = [];
    // `id` on the SNAPSHOT, not only on the ref: the handler builds its rider from
    // `{ id: studentDoc.id, ...studentDoc.data() }`, so a stub without it produced a
    // roster entry with `id: undefined`.
    const snap = (exists: boolean, data?: any, id = '') => ({ exists, id, data: () => data });

    const rider = {
        name: 'New Rider', status: 'waiting_for_pickup',
        location: { lat: 42.35, lng: -71.07, address: '9 St' },
        ...(f.rider ?? {}),
    };

    const collection = (name: string) => {
        let field: string | null = null;
        const chain: any = {
            doc: (id: string) => ({
                id,
                path: `${name}/${id}`,
                get: async () => {
                    if (name === 'users' && id === DRIVER) {
                        return snap(true, {
                            name: 'Asha', roles: ['driver'], accountStatus: 'approved',
                            capacity: 6, homeLocation: { lat: 42.36, lng: -71.06 },
                        }, id);
                    }
                    if (name === 'users') return snap(true, rider, id);
                    if (name === 'vehicles') return snap(true, { capacity: 6 }, id);
                    return snap(false, undefined, id);
                },
            }),
            where: (f2: string) => { field = field ?? f2; return chain; },
            get: async () => {
                const docs = field === 'driverId' ? f.activeRides : f.riderRides;
                return {
                    empty: docs.length === 0,
                    docs: docs.map((d, i) => ({ id: (d.id as string) ?? `r${i}`, data: () => d })),
                };
            },
        };
        return chain;
    };

    db = {
        collection,
        batch: () => ({
            update: (ref: any, data: any) => updates.push({ path: ref.path, data }),
            commit: async () => undefined,
        }),
    };
}

const call = () => (manualAssignStudent as any)(
    { studentId: RIDER, driverId: DRIVER }, { auth: { uid: 'mgr_1' } },
);

/** One document of the Sarthi's current carload. */
const activeRide = (over: Record<string, unknown> = {}) => ({
    id: 'ride_car',
    driverId: DRIVER,
    status: 'assigned',
    rideType: 'home-to-sabha',
    eventId: DATE,
    locationId: 'boston-huntington',
    carId: 'veh_1',
    students: [{ id: 'stu_old', name: 'Old', seats: 1, location: { lat: 42.34, lng: -71.08 } }],
    venue: HALL_A,
    ...over,
});

/** The waiting request of the rider being added. */
const waiting = (over: Record<string, unknown> = {}) => ({
    id: 'ride_waiting',
    studentId: RIDER,
    status: 'requested',
    eventDate: DATE,
    locationId: 'boston-huntington',
    pickupLat: 42.35,
    pickupLng: -71.07,
    seatsRequested: 2,
    ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

describe('the ordinary case', () => {
    it('adds the rider and takes the seats their request asked for', async () => {
        makeDb({ activeRides: [activeRide()], riderRides: [waiting()] });
        await call();

        const rideUpdate = updates.find(u => u.path === 'rides/ride_car')!;
        const added = (rideUpdate.data.students as any[]).find(s => s.id === RIDER);
        expect(added.seats).toBe(2);
        expect(updates.find(u => u.path === `users/${RIDER}`)!.data.currentRideId).toBe('ride_car');
    });
});

/**
 * WHOSE REQUEST COUNTS. Each of these used to satisfy `.find(r => r.status ===
 * 'requested')` and be silently accepted.
 */
describe('the request has to be for THIS run', () => {
    it('REFUSES a request for another sabha location', async () => {
        // The headline invariant, and the only way to break it by ordinary use.
        makeDb({
            activeRides: [activeRide()],
            riderRides: [waiting({ locationId: 'somerville' })],
        });

        await expect(call()).rejects.toThrow(/no waiting request for this run/i);
    });

    it('refuses a request from another evening', async () => {
        makeDb({
            activeRides: [activeRide()],
            riderRides: [waiting({ eventDate: '2026-08-07' })],
        });

        await expect(call()).rejects.toThrow(/no waiting request for this run/i);
    });

    it('refuses a pickup request while a drop-off run is being built', async () => {
        makeDb({
            activeRides: [activeRide({ rideType: 'sabha-to-home' })],
            riderRides: [waiting()],          // absent rideType means pickup
        });

        await expect(call()).rejects.toThrow(/no waiting request for this run/i);
    });

    it('refuses when they hold no waiting request at all', async () => {
        // Was accepted with `seatsOf(undefined)` — one seat, invented.
        makeDb({
            activeRides: [activeRide()],
            riderRides: [waiting({ status: 'completed' })],
        });

        await expect(call()).rejects.toThrow(/no waiting request for this run/i);
    });

    it('picks the RIGHT request when they hold several', async () => {
        // A rider can hold two documents: the assigned share of a split group and a
        // waiting remainder. Order in the collection must not decide the answer.
        makeDb({
            activeRides: [activeRide()],
            riderRides: [
                waiting({ id: 'wrong', locationId: 'somerville', seatsRequested: 5 }),
                waiting({ id: 'right', seatsRequested: 3 }),
            ],
        });
        await call();

        const rideUpdate = updates.find(u => u.path === 'rides/ride_car')!;
        expect((rideUpdate.data.students as any[]).find(s => s.id === RIDER).seats).toBe(3);
    });

    it('accepts an unstamped request, because the car already names its hall', async () => {
        // The rider is being added to a SPECIFIC run, not matched against an ambiguous
        // pool, so there is nothing to guess. Refusing would strand a rider over a
        // field they had no way to send.
        makeDb({
            activeRides: [activeRide()],
            riderRides: [waiting({ locationId: undefined })],
        });

        await expect(call()).resolves.toBeTruthy();
    });
});

describe('one carload, one hall', () => {
    it('refuses when a Sarthi somehow holds runs for two halls', async () => {
        // Already a broken state. Saying so is more use than silently picking one and
        // driving somebody to the wrong building.
        makeDb({
            activeRides: [activeRide(), activeRide({ id: 'ride_b', locationId: 'somerville' })],
            riderRides: [waiting()],
        });

        await expect(call()).rejects.toThrow(/more than one sabha location/i);
    });

    it('is happy with several documents of ONE carload, which is the normal shape', async () => {
        // globalAssignDriver writes one ride document per rider; they all share the
        // driver, the car and the hall.
        makeDb({
            activeRides: [activeRide(), activeRide({ id: 'ride_b' })],
            riderRides: [waiting()],
        });

        await expect(call()).resolves.toBeTruthy();
    });
});

describe('where the car is routed', () => {
    it('keeps the venue snapshotted on the ride', async () => {
        makeDb({ activeRides: [activeRide()], riderRides: [waiting()] });
        await call();

        const route = updates.find(u => u.path === 'rides/ride_car')!.data.route as any[];
        expect(route[route.length - 1]).toMatchObject({ lat: HALL_A.lat, lng: HALL_A.lng });
    });

    it('falls back to the ride HALL, not settings/main, when there is no snapshot', async () => {
        // A ride written before venues existed, or hand-made in the Raw records
        // console. Routed by settings/main it would go to the wrong building as soon
        // as the ride belongs to another hall.
        makeDb({
            activeRides: [activeRide({ venue: null, locationId: 'somerville' })],
            riderRides: [waiting({ locationId: 'somerville' })],
        });
        await call();

        const route = updates.find(u => u.path === 'rides/ride_car')!.data.route as any[];
        expect(route[route.length - 1]).toMatchObject({ lat: HALL_B.lat, lng: HALL_B.lng });
    });
});
