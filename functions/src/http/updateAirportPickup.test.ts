/**
 * Every state change an airport trip can go through.
 *
 * THE ONE THAT MATTERS MOST: two Sarthis tapping Claim at the same moment.
 *
 * A fake Firestore cannot really race, so pretending otherwise would be theatre.
 * What this file tests instead is the thing that makes the real race safe — that the
 * status check happens INSIDE the transaction body, so when Firestore aborts the
 * loser and re-runs it, the re-run sees 'claimed' and refuses. `retryingDb` below
 * drives exactly that: the transaction callback is invoked twice with different
 * document state, the way a real contended transaction is. If the guard were hoisted
 * out of the callback — an easy and invisible refactor — that test fails and nothing
 * else would.
 *
 * The others worth their lines:
 *
 *  - **a Sarthi cannot claim their own arrival.** They would be driving themselves.
 *  - **only the holder or a coordinator can mark met/completed/no_show.** Otherwise
 *    any Sarthi could close somebody else's trip.
 *  - **release clears the holder's name.** Leaving it renders an unclaimed card with
 *    a Sarthi's name on it.
 *  - **a no_show can still be released.** It is the only way out of that status since
 *    reassign was removed, and a frozen no_show is invisible to every count.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

let db: any;
let updates: any[];
let auditRows: any[];
let pickup: any;
let users: Record<string, any>;
let txRuns: number;
/**
 * Set when the code under test reads inside a transaction AFTER writing.
 *
 * Firestore refuses that — "all reads must be executed before all writes" — and the
 * real SDK throws. A fake that quietly allows it is how a completion that fails on
 * every single production call passes every test, which is exactly what happened while
 * this was being written.
 */
let readAfterWrite: boolean;

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) { super(message); this.name = 'HttpsError'; }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});
vi.mock('firebase-admin', () => ({ firestore: () => db }));

const rateLimit = vi.fn(async () => undefined);
vi.mock('../utils/rateLimiter', () => ({ checkRateLimit: (...a: any[]) => rateLimit(...(a as [])) }));

vi.mock('../utils/settings', () => ({ getTimeZone: async () => 'America/New_York' }));

vi.mock('../utils/audit', () => ({
    writeAuditLog: async (_db: any, entry: any) => { auditRows.push({ ...entry }); return null; },
}));

import { updateAirportPickup } from './updateAirportPickup';

const FROZEN = new Date('2026-09-01T12:00:00Z');

/** An approved Sarthi. Note the hierarchy: a manager is also a granted driver. */
const SARTHI = { name: 'Kiran', role: 'driver', roles: ['driver', 'student'], accountStatus: 'approved' };
const RIDER = { name: 'Ramesh', role: 'student', roles: ['student'], accountStatus: 'approved' };
const MANAGER = {
    name: 'Mira', role: 'manager', roles: ['manager', 'driver', 'student'], accountStatus: 'approved',
};
const COORDINATOR = { ...MANAGER, airportCoordinator: true };

const OPEN = {
    requesterUid: 'rider_1',
    requesterName: 'Ramesh',
    status: 'open',
    arrivalAt: '2026-09-21T02:00:00.000Z',
    arrivalDate: '2026-09-20',
    arrivalTime: '22:00',
    airportCode: 'BOS',
};

function makeDb() {
    updates = []; auditRows = []; txRuns = 0; readAfterWrite = false;
    db = {
        collection: (name: string) => ({
            doc: (id: string) => ({
                path: `${name}/${id}`,
                id,
                get: async () => ({
                    exists: name === 'users' ? !!users[id] : pickup !== null,
                    data: () => (name === 'users' ? users[id] : pickup),
                }),
            }),
        }),
        runTransaction: async (fn: any) => {
            txRuns += 1;
            let hasWritten = false;
            return fn({
                get: async (ref: any) => {
                    // Firestore refuses a read that follows a write inside a
                    // transaction. The real SDK throws; this fake records it so the test
                    // below can assert the ordering, because getting it wrong throws on
                    // EVERY completion in production and on none of them here.
                    if (hasWritten) readAfterWrite = true;
                    if (String(ref.path).startsWith('users/')) {
                        const id = String(ref.path).split('/')[1];
                        return { exists: !!users[id], data: () => users[id], ref };
                    }
                    return { exists: pickup !== null, data: () => pickup, ref };
                },
                update: (ref: any, data: any) => {
                    hasWritten = true;
                    updates.push({ path: ref.path, data });
                },
            });
        },
    };
}

/**
 * A Firestore that runs the transaction callback TWICE, the way a real contended
 * one does — with the document already claimed on the retry. This is the only way to
 * assert that the guard lives inside the callback.
 */
function retryingDb(secondAttemptState: any) {
    const base = db;
    db = {
        ...base,
        runTransaction: async (fn: any) => {
            txRuns += 1;
            const first = pickup;
            // First pass, as if uncontended.
            await fn({
                get: async (ref: any) => ({ exists: true, data: () => first, ref }),
                update: () => { /* discarded — Firestore aborted this attempt */ },
            });
            // The retry, after the other Sarthi committed.
            txRuns += 1;
            return fn({
                get: async (ref: any) => ({ exists: true, data: () => secondAttemptState, ref }),
                update: (ref: any, data: any) => { updates.push({ path: ref.path, data }); },
            });
        },
    };
}

const call = (data: Record<string, unknown>, uid: string) =>
    (updateAirportPickup as any)({ pickupId: 'p1', ...data }, { auth: { uid } });

const written = () => updates[0]?.data ?? {};

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);
    vi.clearAllMocks();
    rateLimit.mockResolvedValue(undefined);
    pickup = { ...OPEN };
    users = {
        rider_1: { ...RIDER },
        sarthi_1: { ...SARTHI },
        sarthi_2: { ...SARTHI, name: 'Nilesh' },
        manager_1: { ...MANAGER },
        coord_1: { ...COORDINATOR },
    };
    makeDb();
});

afterEach(() => { vi.useRealTimers(); });

describe('two Sarthis claim the same arrival', () => {
    it('the second one is refused, and told who has it', async () => {
        pickup = { ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' };
        await expect(call({ action: 'claim' }, 'sarthi_2'))
            .rejects.toThrow(/It is with Kiran/);
    });

    it('the refusal is failed-precondition, not a silent no-op', async () => {
        pickup = { ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' };
        await call({ action: 'claim' }, 'sarthi_2').catch((e: any) => {
            expect(e.code).toBe('failed-precondition');
        });
        expect(updates).toHaveLength(0);
    });

    it('the check is INSIDE the transaction, so a retry sees the winner', async () => {
        // The assertion this whole file exists for. Hoisting the status check out of
        // the transaction callback is an invisible refactor that breaks the race and
        // breaks nothing else.
        retryingDb({ ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' });

        await expect(call({ action: 'claim' }, 'sarthi_2')).rejects.toThrow(/with Kiran/);
        expect(txRuns).toBeGreaterThan(1);
        expect(updates).toHaveLength(0);
    });

    it('the winner gets the claim recorded, with who and when', async () => {
        await call({ action: 'claim' }, 'sarthi_1');
        expect(written()).toMatchObject({
            status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran',
        });
        expect(written().claimedAt).toBeTruthy();
    });
});

describe('who may claim', () => {
    it('refuses a Bhulku who does not drive', async () => {
        await expect(call({ action: 'claim' }, 'rider_1')).rejects.toThrow(/approved Sarthis/i);
    });

    it('refuses a Sarthi claiming their OWN arrival', async () => {
        // They would be driving themselves. The sabha side enforces the mirror of
        // this with isHoldingAVehicle() in the rules.
        pickup = { ...OPEN, requesterUid: 'sarthi_1' };
        await expect(call({ action: 'claim' }, 'sarthi_1'))
            .rejects.toThrow(/cannot claim your own/i);
    });

    it('allows a manager, because the hierarchy grants them driver', async () => {
        await expect(call({ action: 'claim' }, 'manager_1')).resolves.toMatchObject({
            status: 'claimed',
        });
    });

    it('refuses a revoked account even though its role still says driver', async () => {
        users.sarthi_1 = { ...SARTHI, accountStatus: 'rejected' };
        await expect(call({ action: 'claim' }, 'sarthi_1')).rejects.toThrow(/approved Sarthis/i);
    });
});

describe('once claimed', () => {
    beforeEach(() => {
        pickup = { ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' };
    });

    it('the holder can mark that they have the traveller', async () => {
        await call({ action: 'met' }, 'sarthi_1');
        expect(written().status).toBe('met');
        expect(written().metAt).toBeTruthy();
    });

    it('another Sarthi cannot close a trip that is not theirs', async () => {
        await expect(call({ action: 'completed' }, 'sarthi_2'))
            .rejects.toThrow(/Sarthi who claimed this, or a coordinator/i);
    });

    it('a coordinator can act on a trip they do not hold', async () => {
        await expect(call({ action: 'no_show' }, 'coord_1')).resolves.toBeDefined();
    });

    it('a plain manager cannot — the flag is what gates this', async () => {
        await expect(call({ action: 'no_show' }, 'manager_1'))
            .rejects.toThrow(/coordinator/i);
    });

    it('release puts it back on the board and clears every trace of the holder', async () => {
        // Leaving claimedByName renders an unclaimed card with a Sarthi's name on it.
        await call({ action: 'release', reason: 'Car trouble' }, 'sarthi_1');
        expect(written()).toMatchObject({
            status: 'open', claimedByUid: null, claimedByName: null,
            claimedAt: null, metAt: null, releaseReason: 'Car trouble',
        });
    });

    it('a release with no reason is still allowed', async () => {
        await call({ action: 'release' }, 'sarthi_1');
        expect(written().status).toBe('open');
        expect(written()).not.toHaveProperty('releaseReason');
    });

    it('completed is reachable without having tapped met first', async () => {
        await call({ action: 'completed' }, 'sarthi_1');
        expect(written().status).toBe('completed');
    });

    it('tapping the WhatsApp link stamps it without changing the status', async () => {
        await call({ action: 'familyNotified' }, 'sarthi_1');
        expect(written().familyNotifiedAt).toBeTruthy();
        expect(written()).not.toHaveProperty('status');
    });
});

describe('a finished trip is finished', () => {
    for (const status of ['completed', 'cancelled']) {
        it(`refuses every action on a "${status}" trip`, async () => {
            pickup = { ...OPEN, status, claimedByUid: 'sarthi_1' };
            for (const action of ['claim', 'release', 'met', 'completed', 'cancel', 'no_show']) {
                await expect(call({ action }, 'coord_1'), action)
                    .rejects.toThrow(/cannot be done to a request that is/i);
            }
            expect(updates).toHaveLength(0);
        });
    }
});

describe('cancelling', () => {
    it('is allowed to the traveller', async () => {
        await call({ action: 'cancel', reason: 'Flight changed' }, 'rider_1');
        expect(written()).toMatchObject({
            status: 'cancelled', cancelledBy: 'rider_1', cancellationReason: 'Flight changed',
        });
    });

    it('is allowed to a coordinator', async () => {
        await expect(call({ action: 'cancel' }, 'coord_1')).resolves.toBeDefined();
    });

    it('is refused to an unrelated Sarthi', async () => {
        await expect(call({ action: 'cancel' }, 'sarthi_2'))
            .rejects.toThrow(/traveller, or a coordinator/i);
    });

    it('stores null rather than an empty string when no reason is given', async () => {
        await call({ action: 'cancel' }, 'rider_1');
        expect(written().cancellationReason).toBeNull();
    });
});

/**
 * REASSIGN IS GONE — removed 2026-08-25 on the owner's instruction, in favour of "a
 * Sarthi releases and another picks it up". These cases replace the reassign block and
 * exist mainly to guard the trap that removal set: `reassign` was the only transition
 * out of 'no_show'.
 */
describe('a no-show goes back on the board', () => {
    beforeEach(() => {
        pickup = { ...OPEN, status: 'no_show', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' };
    });

    it('is releasable, so a wrongly-tapped no-show is not a one-way door', async () => {
        // THE DEAD-END GUARD. With release limited to 'claimed', this throws and the
        // trip is frozen at a status no count in the app looks for.
        await call({ action: 'release' }, 'sarthi_1');
        expect(written().status).toBe('open');
    });

    it('clears the no-show stamp along with the holder', async () => {
        // Left set, the card would say both "nobody yet" and "nobody turned up" — the
        // second being about a Sarthi who is no longer on it.
        await call({ action: 'release' }, 'sarthi_1');
        expect(written()).toMatchObject({
            status: 'open', claimedByUid: null, claimedByName: null,
            claimedAt: null, metAt: null, noShowAt: null,
        });
    });

    it('can be released by a coordinator who does not hold it', async () => {
        // The ONLY remaining way to recover a trip from a Sarthi who has stopped
        // responding, now that the picker is gone.
        await call({ action: 'release' }, 'coord_1');
        expect(written().status).toBe('open');
    });

    it('refuses reassign outright — the action no longer exists', async () => {
        await expect(call({ action: 'reassign', toUid: 'sarthi_2' }, 'coord_1'))
            .rejects.toThrow(/Unknown action/i);
    });
});

describe('the flight moves', () => {
    const NEW_FLIGHT = { arrivalDate: '2026-09-21', arrivalTime: '06:30', airportCode: 'BOS' };

    it('is allowed to the traveller and recomputes the instant', async () => {
        await call({ action: 'editFlight', ...NEW_FLIGHT }, 'rider_1');
        expect(written().arrivalAt).toBe('2026-09-21T10:30:00.000Z');
        expect(written().arrivalDate).toBe('2026-09-21');
    });

    it('badges the change when somebody is already driving to meet it', async () => {
        // News the Sarthi has to see. On an unclaimed request it is just an edit.
        pickup = { ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1' };
        await call({ action: 'editFlight', ...NEW_FLIGHT }, 'rider_1');
        expect(written().arrivalTimeChangedAt).toBeTruthy();
    });

    it('does not badge an edit to an unclaimed request', async () => {
        await call({ action: 'editFlight', ...NEW_FLIGHT }, 'rider_1');
        expect(written()).not.toHaveProperty('arrivalTimeChangedAt');
    });

    it('does not badge a change that is not actually a change of time', async () => {
        pickup = { ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1' };
        await call({ action: 'editFlight', arrivalDate: '2026-09-20', arrivalTime: '22:00', airportCode: 'BOS', terminal: 'E' }, 'rider_1');
        expect(written()).not.toHaveProperty('arrivalTimeChangedAt');
    });

    it('validates the new time as strictly as the original', async () => {
        await expect(call({ action: 'editFlight', arrivalDate: '2026-02-30', arrivalTime: '06:30', airportCode: 'BOS' }, 'rider_1'))
            .rejects.toThrow(/not a real date/i);
    });

    it('is refused to an unrelated Sarthi', async () => {
        await expect(call({ action: 'editFlight', ...NEW_FLIGHT }, 'sarthi_2'))
            .rejects.toThrow(/traveller, their Sarthi, or a coordinator/i);
    });
});

describe('the payload itself', () => {
    it('refuses an unauthenticated caller', async () => {
        await expect((updateAirportPickup as any)({ pickupId: 'p1', action: 'claim' }, {}))
            .rejects.toThrow(/authenticated/i);
    });

    it('refuses a missing pickup id', async () => {
        await expect(call({ action: 'claim', pickupId: '  ' }, 'sarthi_1'))
            .rejects.toThrow(/pickup id is required/i);
    });

    it('refuses an action that is not in the table', async () => {
        // Rather than falling through a switch and returning success having done
        // nothing, which is the failure mode this repo keeps removing.
        await expect(call({ action: 'delete_everything' }, 'coord_1'))
            .rejects.toThrow(/Unknown action/i);
    });

    it('refuses a trip that no longer exists', async () => {
        pickup = null;
        await expect(call({ action: 'claim' }, 'sarthi_1')).rejects.toThrow(/no longer exists/i);
    });
});

describe('the audit row', () => {
    it('records the transition it made, in both directions', async () => {
        await call({ action: 'claim' }, 'sarthi_1');
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0].action).toBe('airport.claim');
        expect(auditRows[0].summary).toMatch(/open → claimed/);
    });

    it('records who held it before a release, and why they let it go', async () => {
        pickup = { ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' };
        await call({ action: 'release', reason: 'Car trouble' }, 'sarthi_1');
        expect(auditRows[0].details).toMatchObject({
            previousHolder: 'Kiran', reason: 'Car trouble',
        });
    });

    it('is NOT written when the transition was refused', async () => {
        // A row for a change that never happened is worse than no row.
        pickup = { ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1' };
        await expect(call({ action: 'claim' }, 'sarthi_2')).rejects.toThrow();
        expect(auditRows).toHaveLength(0);
    });

    it('separates a cancel from a claim, because only one strands somebody', async () => {
        await call({ action: 'cancel' }, 'rider_1');
        expect(auditRows[0].action).toBe('airport.cancel');
    });
});

describe('completing a trip graduates the traveller', () => {
    const claimed = {
        status: 'claimed' as const, claimedByUid: 'sarthi_1', claimedByName: 'Kiran',
        dropoffAddress: '360 Huntington Ave, Boston, MA',
        dropoffLat: 42.3399, dropoffLng: -71.0881,
    };

    const travellerWrite = () => updates.find(u => u.path === 'users/rider_1')?.data;

    beforeEach(() => { pickup = { ...OPEN, ...claimed }; });

    it('clears isArriving, so their app becomes Sabha Seva', async () => {
        // Dropping somebody off is the moment they stop arriving. Leaving the flag set
        // would keep a person who now lives here in a one-screen newcomer app.
        users.rider_1 = { ...RIDER, isArriving: true };
        await call({ action: 'completed' }, 'sarthi_1');

        expect(travellerWrite()).toMatchObject({ isArriving: false });
    });

    it('seeds their home address from the trip destination when they have none', async () => {
        // The destination came from the same AddressAutocomplete the profile screen uses,
        // so it is already geocoded and already the shape resolveHomeCoords reads. Their
        // first sabha ride works with no extra typing.
        users.rider_1 = { ...RIDER, isArriving: true };
        await call({ action: 'completed' }, 'sarthi_1');

        expect(travellerWrite()).toMatchObject({
            address: '360 Huntington Ave, Boston, MA',
            location: {
                latitude: 42.3399,
                longitude: -71.0881,
                formattedAddress: '360 Huntington Ave, Boston, MA',
                seededFromPickupId: 'p1',
            },
        });
    });

    it('does NOT overwrite an address they already had', async () => {
        // A returning local has a real home. A trip destination might be a friend's sofa
        // for the first week, and overwriting would send a Sarthi to the wrong door every
        // Friday from then on.
        users.rider_1 = { ...RIDER, address: '1 Real Home St', isArriving: false };
        await call({ action: 'completed' }, 'sarthi_1');

        expect(travellerWrite()).toEqual({ isArriving: false });
    });

    it('treats a blank address as none', async () => {
        users.rider_1 = { ...RIDER, address: '   ' };
        await call({ action: 'completed' }, 'sarthi_1');
        expect(travellerWrite()).toHaveProperty('address', '360 Huntington Ave, Boston, MA');
    });

    it('refuses to seed the 0,0 placeholder', async () => {
        // resolveHomeCoords rejects 0,0 as "never geocoded" precisely because somebody
        // once stored it. Seeding it would put a Sarthi in the Atlantic.
        pickup = { ...OPEN, ...claimed, dropoffLat: 0, dropoffLng: 0 };
        users.rider_1 = { ...RIDER, isArriving: true };
        await call({ action: 'completed' }, 'sarthi_1');

        expect(travellerWrite()).toEqual({ isArriving: false });
    });

    it('still clears the flag when the destination is unusable', async () => {
        // The graduation must not depend on the address seeding succeeding, or a bad
        // coordinate strands them in the newcomer app.
        pickup = { ...OPEN, ...claimed, dropoffAddress: '', dropoffLat: NaN, dropoffLng: NaN };
        users.rider_1 = { ...RIDER, isArriving: true };
        await call({ action: 'completed' }, 'sarthi_1');

        expect(travellerWrite()).toEqual({ isArriving: false });
    });

    it('touches the traveller for NO other action', async () => {
        for (const action of ['met', 'no_show', 'release', 'familyNotified']) {
            updates.length = 0;
            pickup = { ...OPEN, ...claimed };
            await call({ action }, 'sarthi_1');
            expect(travellerWrite(), action).toBeUndefined();
        }
    });

    it('reads the traveller BEFORE writing anything', async () => {
        // The bug this caught while being written. `tx.get` after `tx.update` throws in
        // Firestore, so getting the order wrong breaks EVERY completion in production and
        // nothing in a fake — which is why the fake now records it.
        users.rider_1 = { ...RIDER, isArriving: true };
        await call({ action: 'completed' }, 'sarthi_1');

        expect(readAfterWrite, 'a transaction read followed a write').toBe(false);
    });

    it('writes the trip and the traveller in the SAME transaction', async () => {
        // Or a traveller marked delivered could be left stuck in the newcomer app —
        // exactly the half-done state a transaction exists to prevent.
        users.rider_1 = { ...RIDER, isArriving: true };
        await call({ action: 'completed' }, 'sarthi_1');

        expect(txRuns).toBe(1);
        expect(updates.map(u => u.path).sort())
            .toEqual(['airportPickups/p1', 'users/rider_1']);
    });
});
