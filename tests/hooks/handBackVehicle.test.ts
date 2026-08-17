/**
 * One function was doing two jobs, and it damaged the second one.
 *
 * `releaseVehicle(vehicleId, driverId)` served both a manager hard-releasing a
 * driver and a driver swapping cars. For the swap it set `status: 'offline'` and
 * zeroed `ridesCompletedToday`, `totalStudentsToday` and `totalDistanceToday` —
 * and nothing put them back. A volunteer who changed cars halfway through an
 * evening silently lost their whole day's tally, and so did the manager's board.
 *
 * It is split in two:
 *
 *   handBackVehicle(vehicleId)   — the VEHICLE only. What a swap actually needs,
 *                                  since assignVehicleToDriver overwrites every
 *                                  user field a swap changes.
 *   managerReleaseVehicle(id)    — the callable. Writes another user's document,
 *                                  so it needs a manager check, an audit row and
 *                                  a refusal while riders are still aboard.
 *
 * The load-bearing assertion here is a NEGATIVE one: no user document is touched.
 * That is the whole bug.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const setDoc = vi.fn(async (_ref: any, _data: any, _opts?: any) => undefined);
const writes: Array<{ path: string; data: any }> = [];

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    setDoc: (ref: any, data: any, opts: any) => {
        writes.push({ path: ref.path, data });
        return setDoc(ref, data, opts);
    },
    // Unused by handBackVehicle, present because the module imports them.
    collection: () => ({}),
    updateDoc: vi.fn(),
    onSnapshot: () => () => undefined,
    query: () => ({}),
    where: () => ({}),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    addDoc: vi.fn(),
    deleteDoc: vi.fn(),
    orderBy: () => ({}),
    limit: () => ({}),
    documentId: () => '__name__',
    startAfter: () => ({}),
    serverTimestamp: () => 'ts',
    writeBatch: () => ({ set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn() }),
}));

import { handBackVehicle } from '../../hooks/useVehicles';

beforeEach(() => {
    vi.clearAllMocks();
    writes.length = 0;
});

describe('handBackVehicle', () => {
    it('frees the vehicle in BOTH halves of the mirror', async () => {
        // The fleet lives in `vehicles` and `cars`. Writing one leaves the other
        // claiming the car is still held.
        await handBackVehicle('veh_1');

        expect(writes.map(w => w.path).sort()).toEqual(['cars/veh_1', 'vehicles/veh_1']);
    });

    it('marks it available with no holder', async () => {
        await handBackVehicle('veh_1');

        for (const w of writes) {
            expect(w.data.status).toBe('available');
            expect(w.data.assignedDriverId).toBeNull();
            expect(w.data.assignedDriverName).toBeNull();
        }
    });

    it('stamps updatedAt, which the idle sweep dates cars from', async () => {
        // releaseIdleVehicles treats a MISSING updatedAt as infinitely old, so a
        // path that skips it makes freshly handled cars look forgotten.
        await handBackVehicle('veh_1');

        for (const w of writes) {
            expect(w.data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        }
    });

    it('NEVER touches a user document — the bug this split fixes', async () => {
        // The old shared function wrote users/{driverId}, setting them offline and
        // zeroing the day's counters. A swap must not cost a volunteer their tally.
        await handBackVehicle('veh_1');

        expect(writes.some(w => w.path.startsWith('users/'))).toBe(false);
    });

    it('takes no driver id at all, so it cannot reset anyone\'s counters', async () => {
        // Enforced by the signature rather than by remembering. There is nothing
        // to pass that could identify a user.
        expect(handBackVehicle.length).toBe(1);
    });

    it('surfaces a failure rather than swallowing it', async () => {
        setDoc.mockRejectedValueOnce(new Error('permission denied'));

        await expect(handBackVehicle('veh_1')).rejects.toThrow(/permission denied/);
    });
});
