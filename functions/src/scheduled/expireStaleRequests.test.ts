/**
 * A request nobody answered must not wait for ever.
 *
 * The whole risk of this sweep is answering "yes, expire it" to a ride somebody
 * is still standing outside waiting for, so `shouldExpire` is asserted directly
 * and every "leave it alone" branch has its own case.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;

vi.mock('firebase-functions', () => ({
    pubsub: {
        schedule: () => ({ timeZone: () => ({ onRun: (h: any) => h }) }),
    },
}));
vi.mock('firebase-admin', () => ({ firestore: () => db }));
vi.mock('../utils/settings', () => ({ getTimeZone: async () => 'America/New_York' }));

import { expireStaleRequests, shouldExpire, eventKeyOfRide } from './expireStaleRequests';

const TODAY = '2026-08-14';

describe('shouldExpire — only what is genuinely past saving', () => {
    it('expires an unserved request from a past gathering', () => {
        expect(shouldExpire({ status: 'requested', eventId: '2026-08-07' }, TODAY)).toBe(true);
    });

    it('leaves today\'s queue alone, however late it is', () => {
        // Drop-off runs legitimately cross midnight. Today's requests are the
        // ones a driver is about to tap for.
        expect(shouldExpire({ status: 'requested', eventId: TODAY }, TODAY)).toBe(false);
    });

    it('leaves a future booking alone', () => {
        expect(shouldExpire({ status: 'requested', eventId: '2026-08-21' }, TODAY)).toBe(false);
    });

    it('never touches a ride a driver has taken', () => {
        for (const status of ['assigned', 'driver_en_route', 'arriving', 'in_progress']) {
            expect(shouldExpire({ status, eventId: '2026-08-07' }, TODAY)).toBe(false);
        }
    });

    it('never touches an already-finished ride', () => {
        expect(shouldExpire({ status: 'completed', eventId: '2026-08-07' }, TODAY)).toBe(false);
        expect(shouldExpire({ status: 'cancelled', eventId: '2026-08-07' }, TODAY)).toBe(false);
    });

    it('leaves an undateable request alone', () => {
        // Unlike a stranded car, an undated request means "unknown", not
        // "certainly forgotten" — and guessing wrong cancels somebody's lift.
        expect(shouldExpire({ status: 'requested' }, TODAY)).toBe(false);
        expect(shouldExpire({ status: 'requested', eventId: null }, TODAY)).toBe(false);
        expect(shouldExpire({ status: 'requested', eventId: '' }, TODAY)).toBe(false);
    });

    it('reads the gathering under any of its three field names', () => {
        expect(eventKeyOfRide({ eventId: 'a' })).toBe('a');
        expect(eventKeyOfRide({ eventDate: 'b' })).toBe('b');
        expect(eventKeyOfRide({ date: 'c' })).toBe('c');
        expect(eventKeyOfRide({})).toBeNull();
        // eventId wins when several are present.
        expect(eventKeyOfRide({ eventId: 'a', eventDate: 'b', date: 'c' })).toBe('a');
    });
});

// ── the sweep itself ────────────────────────────────────────────

interface Recorder {
    updates: Array<{ path: string; data: any }>;
    committed: boolean;
    audits: any[];
}

function makeDb(rides: Array<{ id: string; data: any }>, riders: Record<string, any>) {
    const recorder: Recorder = { updates: [], committed: false, audits: [] };

    const collection = (name: string) => {
        const chain: any = {
            doc: (id: string) => ({
                id,
                path: `${name}/${id}`,
                get: async () => ({
                    exists: name === 'users' ? riders[id] !== undefined : true,
                    data: () => (name === 'users' ? riders[id] : undefined),
                }),
                set: async (row: any) => { recorder.audits.push(row); },
            }),
            where: () => chain,
            get: async () => ({
                empty: rides.length === 0,
                size: rides.length,
                docs: rides.map(r => ({
                    id: r.id,
                    ref: { path: `rides/${r.id}` },
                    data: () => r.data,
                })),
            }),
        };
        return chain;
    };

    db = {
        collection,
        batch: () => ({
            update: (ref: any, data: any) => recorder.updates.push({ path: ref.path, data }),
            set: (ref: any, data: any) => recorder.updates.push({ path: ref.path, data }),
            commit: async () => { recorder.committed = true; },
        }),
    };
    return recorder;
}

const rideWrites = (r: Recorder) => r.updates.filter(w => w.path.startsWith('rides/'));
const riderWrites = (r: Recorder) => r.updates.filter(w => w.path.startsWith('users/'));

beforeEach(() => vi.clearAllMocks());

describe('expireStaleRequests — the sweep', () => {
    it('closes a stale request and says why', async () => {
        const rec = makeDb(
            [{ id: 'r1', data: { status: 'requested', eventId: '2026-08-07', studentId: 's1' } }],
            { s1: { status: 'waiting_for_dropoff', currentRideId: 'r1' } },
        );

        await (expireStaleRequests as any)();

        const [write] = rideWrites(rec);
        expect(write.data.status).toBe('cancelled');
        expect(write.data.cancellationReason).toBe('window-closed');
        expect(write.data.cancelledBy).toBe('system:expireStaleRequests');
        expect(rec.committed).toBe(true);
    });

    it('frees the rider from a wait that already ended', async () => {
        const rec = makeDb(
            [{ id: 'r1', data: { status: 'requested', eventId: '2026-08-07', studentId: 's1' } }],
            { s1: { status: 'waiting_for_dropoff', currentRideId: 'r1' } },
        );

        await (expireStaleRequests as any)();

        expect(riderWrites(rec)[0].data).toEqual({ status: 'missed_ride', currentRideId: null });
    });

    it('does not overwrite a rider who has since moved on', async () => {
        // Stale data replaced by wrong data is not an improvement. This rider
        // was picked up in the end.
        const rec = makeDb(
            [{ id: 'r1', data: { status: 'requested', eventId: '2026-08-07', studentId: 's1' } }],
            { s1: { status: 'home_safe', currentRideId: null } },
        );

        await (expireStaleRequests as any)();

        expect(rideWrites(rec)).toHaveLength(1);
        expect(riderWrites(rec)).toEqual([]);
    });

    it('does not touch a rider now waiting on a different ride', async () => {
        const rec = makeDb(
            [{ id: 'r1', data: { status: 'requested', eventId: '2026-08-07', studentId: 's1' } }],
            { s1: { status: 'waiting_for_pickup', currentRideId: 'r_new' } },
        );

        await (expireStaleRequests as any)();

        expect(riderWrites(rec)).toEqual([]);
    });

    it('writes a rider with two stale rides only once', async () => {
        // Two references to the same document in one batch is a rejected commit.
        const rec = makeDb(
            [
                { id: 'r1', data: { status: 'requested', eventId: '2026-08-07', studentId: 's1' } },
                { id: 'r2', data: { status: 'requested', eventId: '2026-07-31', studentId: 's1' } },
            ],
            { s1: { status: 'waiting_for_dropoff', currentRideId: null } },
        );

        await (expireStaleRequests as any)();

        expect(rideWrites(rec)).toHaveLength(2);
        expect(riderWrites(rec)).toHaveLength(1);
    });

    it('commits nothing when every open request is current', async () => {
        const rec = makeDb(
            [{ id: 'r1', data: { status: 'requested', eventId: '2026-08-14', studentId: 's1' } }],
            { s1: { status: 'waiting_for_dropoff', currentRideId: 'r1' } },
        );

        await (expireStaleRequests as any)();

        expect(rec.committed).toBe(false);
        expect(rec.updates).toEqual([]);
    });

    it('leaves a rider with no user document alone rather than creating one', async () => {
        const rec = makeDb(
            [{ id: 'r1', data: { status: 'requested', eventId: '2026-08-07', studentId: 'gone' } }],
            {},
        );

        await (expireStaleRequests as any)();

        expect(rideWrites(rec)).toHaveLength(1);
        expect(riderWrites(rec)).toEqual([]);
    });

    it('records an audit row', async () => {
        const rec = makeDb(
            [{ id: 'r1', data: { status: 'requested', eventId: '2026-08-07', studentId: 's1' } }],
            { s1: { status: 'waiting_for_dropoff', currentRideId: 'r1' } },
        );

        await (expireStaleRequests as any)();

        expect(rec.audits).toHaveLength(1);
        expect(rec.audits[0].actorUid).toBe('system:expireStaleRequests');
        expect(rec.audits[0].summary).toMatch(/Expired 1 unserved/);
    });
});
