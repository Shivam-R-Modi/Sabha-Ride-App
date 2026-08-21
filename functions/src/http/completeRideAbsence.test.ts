/**
 * A Bhulku who never got in the car must not be recorded as having arrived.
 *
 * THE LIE THIS REMOVES
 * --------------------
 * A run is several ride documents, and `completeRide` closed all of them
 * identically. So the Sarthi who waited outside, rang twice and drove on had no
 * way to say so: the rider's document went to `completed` and the rider went to
 * `at_sabha`. Three consequences, each worse than the last —
 *
 *   1. The manager's board said a child was at the temple who was at home.
 *   2. The attendance figures and the exported CSV counted them present.
 *   3. `at_sabha` is what unlocks "I need a lift home", so the app would later
 *      offer a ride home from a sabha they never reached.
 *
 * The roster the Sarthi confirms at the venue is now the record, and this is the
 * file that holds it to that. The empty list — every normal night — has to behave
 * exactly as it did before, so that is tested first.
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

const notifyStudentRideCompleted = vi.fn(async () => undefined);
vi.mock('../utils/notifications', () => ({
    notifyStudentRideCompleted: (...a: unknown[]) => notifyStudentRideCompleted(...(a as [])),
    tokensOf: () => ['token'],
}));
vi.mock('../utils/settings', () => ({ getTimeZone: async () => 'America/New_York' }));

import { completeRide } from './completeRide';

interface Recorder {
    sets: Array<{ path: string; data: any }>;
    updates: Array<{ path: string; data: any }>;
}

const DRIVER = {
    accountStatus: 'approved',
    roles: ['driver'],
    name: 'Asha',
    currentVehicleId: 'veh_1',
    ridesCompletedToday: 0,
    totalStudentsToday: 0,
    totalDistanceToday: 0,
};

/**
 * One ride document per rider — how a carload of three is actually stored.
 * `eventDate` is set so the statistics document is keyed off the sabha rather
 * than off a clock this test does not control.
 */
function rideFor(studentId: string, name: string) {
    return {
        id: `ride_${studentId}`,
        data: {
            driverId: 'driver_1',
            status: 'in_progress',
            rideType: 'home-to-sabha',
            eventDate: '2026-08-21',
            estimatedDistance: 4,
            studentId,
            studentName: name,
        },
    };
}

/**
 * The queries this handler makes, answered by which field was filtered on:
 * `driverId` is the carload being closed, `studentId` is "does this rider have
 * another leg still running" — answered from the same set, so every rider's only
 * open ride is one of the ones being closed.
 */
function makeDb(group: Array<{ id: string; data: any }>) {
    const recorder: Recorder = { sets: [], updates: [] };
    const snap = (exists: boolean, data?: any) => ({ exists, data: () => data });

    const collection = (name: string) => {
        const filters: Array<[string, unknown]> = [];
        const chain: any = {
            doc: (id: string) => ({
                path: `${name}/${id}`,
                get: async () => {
                    if (name === 'rides') {
                        const found = group.find(g => g.id === id);
                        return snap(!!found, found?.data);
                    }
                    if (name === 'users') return snap(true, DRIVER);
                    return snap(false, undefined);   // statistics: first run of the evening
                },
            }),
            where: (field: string, _op: string, value: unknown) => { filters.push([field, value]); return chain; },
            get: async () => {
                const studentFilter = filters.find(([f]) => f === 'studentId');
                const docs = studentFilter
                    ? group.filter(g => g.data.studentId === studentFilter[1])
                    : group;
                return { empty: docs.length === 0, size: docs.length, docs: docs.map(g => ({ id: g.id, ref: { path: `rides/${g.id}` }, data: () => g.data })) };
            },
        };
        return chain;
    };

    db = {
        collection,
        batch: () => ({
            set: (ref: any, data: any) => recorder.sets.push({ path: ref.path, data }),
            update: (ref: any, data: any) => recorder.updates.push({ path: ref.path, data }),
            delete: () => undefined,
            commit: async () => undefined,
        }),
    };
    return recorder;
}

const CARLOAD = [
    rideFor('stu_a', 'Bhulku A'),
    rideFor('stu_b', 'Bhulku B'),
    rideFor('stu_c', 'Bhulku C'),
];

const call = (absentStudentIds?: unknown) => (completeRide as any)(
    { rideId: 'ride_stu_a', ...(absentStudentIds === undefined ? {} : { absentStudentIds }) },
    { auth: { uid: 'driver_1' } },
);

const write = (r: Recorder, path: string) => r.updates.find(w => w.path === path)?.data;
const driverWrite = (r: Recorder) => write(r, 'users/driver_1');

beforeEach(() => vi.clearAllMocks());

describe('a normal night, where everybody travelled', () => {
    it('completes every ride in the carload', async () => {
        const rec = makeDb(CARLOAD);

        await call();

        for (const g of CARLOAD) {
            expect(write(rec, `rides/${g.id}`).status).toBe('completed');
        }
    });

    it('marks all three riders as arrived', async () => {
        const rec = makeDb(CARLOAD);

        await call();

        for (const id of ['stu_a', 'stu_b', 'stu_c']) {
            expect(write(rec, `users/${id}`).status).toBe('at_sabha');
        }
    });

    it('behaves identically whether the list is absent or empty', async () => {
        const withoutList = makeDb(CARLOAD);
        await call();
        const withEmptyList = makeDb(CARLOAD);
        await call([]);

        expect(withEmptyList.updates).toEqual(withoutList.updates);
    });

    it('counts all three seats towards the day', async () => {
        const rec = makeDb(CARLOAD);

        await call();

        expect(driverWrite(rec).totalStudentsToday).toBe(3);
    });
});

describe('one Bhulku did not come out of the house', () => {
    it('cancels their ride instead of completing it', async () => {
        const rec = makeDb(CARLOAD);

        await call(['stu_b']);

        expect(write(rec, 'rides/ride_stu_b').status).toBe('cancelled');
        expect(write(rec, 'rides/ride_stu_b').noShowAt).toBeTruthy();
        expect(write(rec, 'rides/ride_stu_b')).not.toHaveProperty('completedAt');
    });

    it('does NOT mark them as arrived at the sabha', async () => {
        // The whole point. `at_sabha` is what unlocks a ride home.
        const rec = makeDb(CARLOAD);

        await call(['stu_b']);

        expect(write(rec, 'users/stu_b').status).toBe('missed_pickup');
    });

    it('frees them from the ride so they are not left pointing at it', async () => {
        // A rider still holding currentRideId on a cancelled ride is the silent
        // failure this repo keeps finding: a screen that says a ride is running
        // for ever, with nothing to tap.
        const rec = makeDb(CARLOAD);

        await call(['stu_b']);

        expect(write(rec, 'users/stu_b').currentRideId).toBeNull();
    });

    it('sends them no "you have arrived" message', async () => {
        const rec = makeDb(CARLOAD);

        await call(['stu_b']);

        expect(notifyStudentRideCompleted).toHaveBeenCalledTimes(2);
        expect(rec.updates.some(w => w.path === 'users/stu_b')).toBe(true);
    });

    it('leaves the other two completed and arrived', async () => {
        const rec = makeDb(CARLOAD);

        await call(['stu_b']);

        for (const id of ['stu_a', 'stu_c']) {
            expect(write(rec, `rides/ride_${id}`).status).toBe('completed');
            expect(write(rec, `users/${id}`).status).toBe('at_sabha');
        }
    });

    it('counts two seats, not three', async () => {
        const rec = makeDb(CARLOAD);

        await call(['stu_b']);

        expect(driverWrite(rec).totalStudentsToday).toBe(2);
    });

    it('keeps them out of the sabha attendance figures', async () => {
        const rec = makeDb(CARLOAD);

        await call(['stu_b']);

        const stats = rec.sets.find(w => w.path === 'statistics/2026-08-21')!.data;
        const ids = stats.pickup.students.map((s: any) => s.id);
        expect(ids).not.toContain('stu_b');
        // Two, not three. These rides carry no `students[]` array, so the
        // attendance roster falls back to the carload the run actually closed —
        // which is the branch worth pinning, because that fallback is what used
        // to sweep the no-show back in.
        expect(stats.pickup.totalStudents).toBe(2);
    });
});

describe('nobody came out at all', () => {
    it('cancels every ride and counts nobody', async () => {
        const rec = makeDb(CARLOAD);

        await call(['stu_a', 'stu_b', 'stu_c']);

        for (const g of CARLOAD) {
            expect(write(rec, `rides/${g.id}`).status).toBe('cancelled');
        }
        expect(driverWrite(rec).totalStudentsToday).toBe(0);
    });
});

describe('the return leg', () => {
    const RETURN = CARLOAD.map(g => ({ ...g, data: { ...g.data, rideType: 'sabha-to-home' } }));

    it('marks everyone who travelled as home safe', async () => {
        const rec = makeDb(RETURN);

        await call();

        expect(write(rec, 'users/stu_a').status).toBe('home_safe');
    });

    it('never says home safe about somebody still standing at the temple', async () => {
        // The single most dangerous write in this handler. A no-show on the way
        // back is still AT the sabha — which is both the truth and what lets them
        // ask for another lift.
        const rec = makeDb(RETURN);

        await call(['stu_b']);

        expect(write(rec, 'users/stu_b').status).toBe('at_sabha');
        expect(write(rec, 'users/stu_b').status).not.toBe('home_safe');
    });
});

describe('the argument itself', () => {
    it('refuses a list that is not a list', async () => {
        // Silently treating a malformed payload as "everybody travelled" is the
        // wrong default in the one direction that matters.
        makeDb(CARLOAD);

        await expect(call('stu_b')).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('ignores ids that are not on this run', async () => {
        const rec = makeDb(CARLOAD);

        await call(['someone_elses_child', '', 'stu_b']);

        expect(rec.updates.some(w => w.path === 'users/someone_elses_child')).toBe(false);
        expect(write(rec, 'users/stu_b').status).toBe('missed_pickup');
    });
});
