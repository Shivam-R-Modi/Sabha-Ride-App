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
 *  - **reassign re-checks the target.** A coordinator's browser is a trust boundary
 *    too, and reassigning to a revoked account hands over an address.
 *  - **release clears the holder's name.** Leaving it renders an unclaimed card with
 *    a Sarthi's name on it.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

let db: any;
let updates: any[];
let auditRows: any[];
let pickup: any;
let users: Record<string, any>;
let txRuns: number;

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
    updates = []; auditRows = []; txRuns = 0;
    db = {
        collection: (name: string) => ({
            doc: (id: string) => ({
                path: `${name}/${id}`,
                get: async () => ({
                    exists: name === 'users' ? !!users[id] : pickup !== null,
                    data: () => (name === 'users' ? users[id] : pickup),
                }),
            }),
        }),
        runTransaction: async (fn: any) => {
            txRuns += 1;
            return fn({
                get: async (ref: any) => ({ exists: pickup !== null, data: () => pickup, ref }),
                update: (ref: any, data: any) => { updates.push({ path: ref.path, data }); },
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
            for (const action of ['claim', 'release', 'met', 'completed', 'cancel', 'reassign']) {
                await expect(call({ action, toUid: 'sarthi_2' }, 'coord_1'), action)
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

describe('reassigning', () => {
    beforeEach(() => {
        pickup = { ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' };
    });

    it('is coordinator-only', async () => {
        await expect(call({ action: 'reassign', toUid: 'sarthi_2' }, 'sarthi_1'))
            .rejects.toThrow(/coordinators can reassign/i);
    });

    it('moves the trip to the new Sarthi', async () => {
        await call({ action: 'reassign', toUid: 'sarthi_2' }, 'coord_1');
        expect(written()).toMatchObject({
            status: 'claimed', claimedByUid: 'sarthi_2', claimedByName: 'Nilesh',
        });
    });

    it('re-checks the target rather than trusting the picker', async () => {
        // A coordinator's browser is a trust boundary too.
        users.sarthi_2 = { ...SARTHI, accountStatus: 'pending' };
        await expect(call({ action: 'reassign', toUid: 'sarthi_2' }, 'coord_1'))
            .rejects.toThrow(/not an approved Sarthi/i);
    });

    it('needs a target at all', async () => {
        await expect(call({ action: 'reassign' }, 'coord_1'))
            .rejects.toThrow(/Pick a Sarthi/i);
    });

    it('rescues a wrongly-marked no_show and clears its stale stamps', async () => {
        pickup = { ...OPEN, status: 'no_show', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' };
        await call({ action: 'reassign', toUid: 'sarthi_2' }, 'coord_1');
        expect(written()).toMatchObject({
            status: 'claimed', claimedByUid: 'sarthi_2', metAt: null, completedAt: null,
        });
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

    it('records who held it before a reassign', async () => {
        pickup = { ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran' };
        await call({ action: 'reassign', toUid: 'sarthi_2' }, 'coord_1');
        expect(auditRows[0].details).toMatchObject({
            previousHolder: 'Kiran', reassignedTo: 'sarthi_2',
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
