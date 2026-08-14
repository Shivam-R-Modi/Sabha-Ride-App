/**
 * The idle-vehicle sweep's decision.
 *
 * This is the whole of the risk in that function. Releasing too little leaves a
 * car stranded — which is what happened in production, where all three cars sat
 * `in_use` for up to nine days and no driver could start a shift. Releasing too
 * much takes a car off a driver who is halfway through a run with children in it.
 *
 * The two failures are not symmetrical, so neither are these tests: the
 * "never touch a live ride" case is asserted from several directions, including
 * with a timestamp old enough that every other rule would have released it.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-functions', () => ({
    pubsub: {
        schedule: () => ({ timeZone: () => ({ onRun: (h: any) => h }) }),
    },
}));

vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));

import { decideRelease } from './releaseIdleVehicles';

const NOW = new Date('2026-08-15T03:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

/**
 * A fake db answering the two reads decideRelease makes: the holder's user
 * document, and that holder's live rides.
 */
function makeDb(opts: {
    user?: Record<string, unknown> | null;
    liveRides?: number;
}) {
    return {
        collection: (name: string) => {
            if (name === 'users') {
                return {
                    doc: () => ({
                        get: async () => ({
                            exists: opts.user !== null && opts.user !== undefined,
                            data: () => opts.user,
                        }),
                    }),
                };
            }
            // rides
            const chain: any = {
                where: () => chain,
                get: async () => ({
                    empty: (opts.liveRides ?? 0) === 0,
                    size: opts.liveRides ?? 0,
                }),
            };
            return chain;
        },
    } as any;
}

const HELD_BY_DRIVER_1 = {
    status: 'in_use',
    name: 'Car1',
    assignedDriverId: 'driver_1',
    updatedAt: hoursAgo(12),
};

describe('decideRelease — leaves alone what it must', () => {
    it('ignores a vehicle that is already available', async () => {
        const db = makeDb({});

        const d = await decideRelease(db, 'veh_1', { status: 'available' }, NOW);

        expect(d.release).toBe(false);
    });

    it('ignores a vehicle in maintenance rather than making it available', async () => {
        // Releasing would set status 'available' and put a car a manager has
        // deliberately taken off the road back into the driver's picker.
        const db = makeDb({});

        const d = await decideRelease(db, 'veh_1', { status: 'maintenance' }, NOW);

        expect(d.release).toBe(false);
    });

    it('NEVER releases a car whose holder has a live ride', async () => {
        const db = makeDb({ user: { currentVehicleId: 'veh_1' }, liveRides: 2 });

        const d = await decideRelease(db, 'veh_1', HELD_BY_DRIVER_1, NOW);

        expect(d.release).toBe(false);
        expect(d.reason).toMatch(/live ride/i);
    });

    it('never releases a live-ride car however long it has been held', async () => {
        // The idle timer must not be able to override the live-ride check. A long
        // drop-off run on a slow night is not an abandoned car.
        const db = makeDb({ user: { currentVehicleId: 'veh_1' }, liveRides: 1 });

        const d = await decideRelease(
            db, 'veh_1', { ...HELD_BY_DRIVER_1, updatedAt: hoursAgo(400) }, NOW,
        );

        expect(d.release).toBe(false);
    });

    it('leaves a car a driver has only just picked up', async () => {
        // The sweep runs at 03:00. A driver who took a car at 02:58 and has not
        // tapped yet must keep it.
        const db = makeDb({ user: { currentVehicleId: 'veh_1' }, liveRides: 0 });

        const d = await decideRelease(
            db, 'veh_1', { ...HELD_BY_DRIVER_1, updatedAt: hoursAgo(0.03) }, NOW,
        );

        expect(d.release).toBe(false);
        expect(d.reason).toMatch(/only held/i);
    });

    it('holds the line right up to the threshold', async () => {
        const db = makeDb({ user: { currentVehicleId: 'veh_1' }, liveRides: 0 });

        const d = await decideRelease(
            db, 'veh_1', { ...HELD_BY_DRIVER_1, updatedAt: hoursAgo(5.9) }, NOW, 6,
        );

        expect(d.release).toBe(false);
    });
});

describe('decideRelease — releases what nothing else can', () => {
    it('releases a car held by nobody at all', async () => {
        const db = makeDb({});

        const d = await decideRelease(
            db, 'veh_1', { status: 'in_use', assignedDriverId: null, updatedAt: hoursAgo(1) }, NOW,
        );

        expect(d.release).toBe(true);
        expect(d.reason).toMatch(/no assignedDriverId/i);
    });

    it('releases a car held by a deleted account, regardless of the timer', async () => {
        // The production case. No amount of waiting brings the holder back, so
        // this must not be gated on the idle threshold — the car was picked up
        // minutes ago as far as `updatedAt` knows.
        const db = makeDb({ user: null });

        const d = await decideRelease(
            db, 'veh_1', { ...HELD_BY_DRIVER_1, updatedAt: hoursAgo(0.01) }, NOW,
        );

        expect(d.release).toBe(true);
        expect(d.reason).toMatch(/no user document/i);
    });

    it('releases a car the holder no longer thinks they have', async () => {
        // The driver moved to another car. This one is stranded: no release path
        // will ever name it again.
        const db = makeDb({ user: { currentVehicleId: 'veh_OTHER' }, liveRides: 0 });

        const d = await decideRelease(db, 'veh_1', HELD_BY_DRIVER_1, NOW);

        expect(d.release).toBe(true);
        expect(d.reason).toMatch(/not this vehicle/i);
    });

    it('releases when the holder holds nothing at all', async () => {
        const db = makeDb({ user: { currentVehicleId: null }, liveRides: 0 });

        const d = await decideRelease(db, 'veh_1', HELD_BY_DRIVER_1, NOW);

        expect(d.release).toBe(true);
    });

    it('releases an idle car once past the threshold', async () => {
        const db = makeDb({ user: { currentVehicleId: 'veh_1' }, liveRides: 0 });

        const d = await decideRelease(db, 'veh_1', HELD_BY_DRIVER_1, NOW);

        expect(d.release).toBe(true);
        expect(d.reason).toMatch(/no live ride/i);
    });

    it('treats a missing updatedAt as infinitely old', async () => {
        // Deliberate. The field is written whenever a car is picked, so its
        // absence means the document predates that and has sat untouched.
        // Defaulting to "too new" would make the most stuck cars the ones this
        // never fixes.
        const db = makeDb({ user: { currentVehicleId: 'veh_1' }, liveRides: 0 });

        const d = await decideRelease(
            db, 'veh_1', { status: 'in_use', assignedDriverId: 'driver_1' }, NOW,
        );

        expect(d.release).toBe(true);
        expect(d.reason).toMatch(/no updatedAt/i);
    });

    it('treats an unparseable updatedAt as infinitely old too', async () => {
        const db = makeDb({ user: { currentVehicleId: 'veh_1' }, liveRides: 0 });

        const d = await decideRelease(
            db, 'veh_1', { ...HELD_BY_DRIVER_1, updatedAt: 'last Tuesday' }, NOW,
        );

        expect(d.release).toBe(true);
    });
});

describe('decideRelease — the legacy field name', () => {
    it('accepts currentCarId when currentVehicleId is absent', async () => {
        // completeRide and releaseAssignment once cleared only currentVehicleId,
        // so documents exist carrying the older name. Reading only the canonical
        // one would release a car the driver is genuinely holding.
        const db = makeDb({ user: { currentCarId: 'veh_1' }, liveRides: 0 });

        const d = await decideRelease(
            db, 'veh_1', { ...HELD_BY_DRIVER_1, updatedAt: hoursAgo(1) }, NOW,
        );

        expect(d.release).toBe(false);
    });

    it('reads a holder recorded as currentDriverId on the vehicle', async () => {
        const db = makeDb({ user: { currentVehicleId: 'veh_1' }, liveRides: 1 });

        const d = await decideRelease(
            db, 'veh_1',
            { status: 'in_use', currentDriverId: 'driver_1', updatedAt: hoursAgo(12) },
            NOW,
        );

        expect(d.release).toBe(false);
    });
});
