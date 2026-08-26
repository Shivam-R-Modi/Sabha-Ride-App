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
let merges: any[];
let pushes: any[];
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

/**
 * Push, recorded rather than sent. Both helpers land here so a test can assert WHO was
 * told and WHAT — the two cases go to opposite people, which is the easy thing to get
 * backwards.
 */
vi.mock('../utils/notifications', () => ({
    tokensOf: (uid: string, data: any) => (data?.fcmTokens
        ? Object.keys(data.fcmTokens).map(token => ({ uid, token }))
        : []),
    notifyArrivalChanged: async (to: any[], changed: string[], pickupId: string) => {
        pushes.push({ kind: 'changed', to, changed, pickupId });
    },
    notifyTravellerSarthiAssigned: async (to: any[], sarthiName: string, pickupId: string) => {
        pushes.push({ kind: 'claimed', to, sarthiName, pickupId });
    },
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
    updates = []; merges = []; pushes = []; auditRows = []; txRuns = 0; readAfterWrite = false;
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
                // `editRequest` merges the person into airportProfiles as well, the
                // same way the create path does — so the long-lived record does not
                // keep last month's phone number. Recorded separately from `update`
                // so `written()` still means "what happened to the pickup".
                set: (ref: any, data: any, options: any) => {
                    hasWritten = true;
                    merges.push({ path: ref.path, data, options });
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
                set: () => { /* discarded too */ },
            });
            // The retry, after the other Sarthi committed.
            txRuns += 1;
            return fn({
                get: async (ref: any) => ({ exists: true, data: () => secondAttemptState, ref }),
                update: (ref: any, data: any) => { updates.push({ path: ref.path, data }); },
                set: (ref: any, data: any, options: any) => {
                    merges.push({ path: ref.path, data, options });
                },
            });
        },
    };
}

const call = (data: Record<string, unknown>, uid: string) =>
    (updateAirportPickup as any)({ pickupId: 'p1', ...data }, { auth: { uid } });

const written = () => updates[0]?.data ?? {};
/** The airportProfiles merge, when there was one. */
const merged = () => merges[0]?.data ?? {};

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

    it('rearms the unclaimed alarm, so a late hand-back is not silent', async () => {
        // `alertsSent` stops a band firing twice. A trip that was open, claimed, then
        // handed back carries stamps from bands it is now past — and the scheduled job
        // skips any band it finds stamped, so it would stay quiet for the rest of the
        // trip. Exactly the case that most needs the alarm.
        pickup = {
            ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran',
            alertsSent: { '48h': '2026-09-19T00:00:00.000Z', '24h': '2026-09-20T00:00:00.000Z' },
        };
        await call({ action: 'release' }, 'sarthi_1');
        expect(written().alertsSent).toBeNull();
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

/**
 * EDITING A LIVE REQUEST. Was `editFlight`, which could only change the flight block —
 * so a traveller who moved terminal, doubled their luggage or lost their working phone
 * had no way to say so, and the Sarthi's card kept the stale answer.
 *
 * The whole guard here is that the edit path runs THE SAME THREE PARSERS as create.
 * `airportPickups` is `allow update: if false` for every client, so this callable is
 * the trust boundary — a laxer edit path would be a side door into it.
 */
describe('editing a request', () => {
    /** Everything the three parsers require, so a test can change one thing at a time. */
    const FULL = {
        arrivalDate: '2026-09-20', arrivalTime: '22:00', airportCode: 'BOS',
        partySize: 2, largeBags: 4, cabinBags: 2, hasUsWorkingPhone: false,
        fullName: 'Ramesh Patel', dateOfBirth: '2007-04-11',
        email: 'ramesh@example.com', phone: '+16175550123', whatsappOn: 'primary',
    };

    it('is allowed to the traveller and recomputes the instant', async () => {
        await call({ action: 'editRequest', ...FULL, arrivalTime: '06:30', arrivalDate: '2026-09-21' }, 'rider_1');
        expect(written().arrivalAt).toBe('2026-09-21T10:30:00.000Z');
        expect(written().arrivalDate).toBe('2026-09-21');
    });

    it('changes what is NOT the flight, which is the point of the rename', async () => {
        await call({ action: 'editRequest', ...FULL, partySize: 4, largeBags: 6 }, 'rider_1');
        expect(written()).toMatchObject({ partySize: 4, largeBags: 6 });
    });

    it('rewrites the passenger snapshot the Sarthi actually reads', async () => {
        await call({ action: 'editRequest', ...FULL, phone: '+16175559999' }, 'rider_1');
        expect(written().passenger).toMatchObject({ phone: '+16175559999' });
    });

    it('validates as strictly as the create path — same parsers, no side door', async () => {
        // A short phone number is refused on create; it must be refused here too.
        await expect(call({ action: 'editRequest', ...FULL, phone: '+1617' }, 'rider_1'))
            .rejects.toThrow(/phone/i);
        await expect(call({ action: 'editRequest', ...FULL, arrivalDate: '2020-01-01' }, 'rider_1'))
            .rejects.toThrow(/already passed/i);
    });

    it('is refused to an unrelated Sarthi', async () => {
        await expect(call({ action: 'editRequest', ...FULL }, 'sarthi_2'))
            .rejects.toThrow(/Only the traveller/i);
    });

    it('keeps the long-lived profile in step, so it does not hold last month’s number', async () => {
        // airportProfiles is what the Airport export reads and what the next trip is
        // seeded from. Updating only the pickup would leave it stale.
        await call({ action: 'editRequest', ...FULL, phone: '+16175559999' }, 'rider_1');
        expect(merged()).toMatchObject({ phone: '+16175559999' });
        expect(merges[0].path).toBe('airportProfiles/rider_1');
        expect(merges[0].options).toEqual({ merge: true });
    });

    it('does not wipe a field the edit form never shows', async () => {
        // A university or a preferred name lives only on the profile. The payload omits
        // blanks and the write merges, so both survive an edit untouched.
        await call({ action: 'editRequest', ...FULL }, 'rider_1');
        expect(merged()).not.toHaveProperty('university');
        expect(merged()).not.toHaveProperty('preferredName');
    });
});

describe('telling the Sarthi what changed', () => {
    const FULL = {
        arrivalDate: '2026-09-20', arrivalTime: '22:00', airportCode: 'BOS',
        partySize: 2, largeBags: 4, cabinBags: 2, hasUsWorkingPhone: false,
        terminal: 'E',
        fullName: 'Ramesh Patel', dateOfBirth: '2007-04-11',
        email: 'ramesh@example.com', phone: '+16175550123', whatsappOn: 'primary',
    };

    beforeEach(() => {
        // Deliberately a FULL document, matching what requestAirportPickup writes.
        // Leaving `hasUsWorkingPhone` out made every no-op edit report a change —
        // absent read as a difference from `false` — which is a fixture artefact
        // rather than a production one, since the create path always writes it.
        pickup = {
            ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran',
            partySize: 2, largeBags: 4, cabinBags: 2, terminal: 'E',
            hasUsWorkingPhone: false,
            passenger: { phone: '+16175550123' },
        };
    });

    it('marks a change that affects the drive, and names the fields', async () => {
        await call({ action: 'editRequest', ...FULL, arrivalTime: '06:30', arrivalDate: '2026-09-21' }, 'rider_1');
        expect(written().changedAt).toBeTruthy();
        expect(written().changedFields).toContain('arrivalAt');
    });

    it('marks luggage, because it decides which car can come', async () => {
        await call({ action: 'editRequest', ...FULL, largeBags: 8 }, 'rider_1');
        expect(written().changedFields).toContain('largeBags');
    });

    it('marks the traveller phone, which is how they are reached', async () => {
        await call({ action: 'editRequest', ...FULL, phone: '+16175559999' }, 'rider_1');
        expect(written().changedFields).toContain('passenger.phone');
    });

    it('stays SILENT for a change that alters nothing about the drive', async () => {
        // A note, a preferred name, an employer. A warning that fires on everything
        // stops being read, which is worse than one that fires on less.
        await call({ action: 'editRequest', ...FULL, notes: 'I have a cat', university: 'NEU' }, 'rider_1');
        expect(written()).not.toHaveProperty('changedAt');
    });

    it('stays silent when they saved without changing anything at all', async () => {
        await call({ action: 'editRequest', ...FULL }, 'rider_1');
        expect(written()).not.toHaveProperty('changedAt');
    });

    it('says nothing on an unclaimed request — there is nobody to tell', async () => {
        pickup = { ...OPEN, partySize: 2, largeBags: 4, cabinBags: 2, hasUsWorkingPhone: false };
        await call({ action: 'editRequest', ...FULL, largeBags: 8 }, 'rider_1');
        expect(written()).not.toHaveProperty('changedAt');
    });

    it('clears the marker when the Sarthi says they have found them', async () => {
        // The warning has done its job. One that follows a trip to the end decays into
        // wallpaper, which is how a loud signal stops being one.
        pickup = {
            ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1',
            changedAt: '2026-09-19T00:00:00.000Z', changedFields: ['arrivalAt'],
        };
        await call({ action: 'met' }, 'sarthi_1');
        expect(written()).toMatchObject({ changedAt: null, changedFields: null });
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

/**
 * WHO GETS TOLD. Added 2026-08-25 alongside the push permission prompt.
 *
 * The two pushes go to OPPOSITE people — a claim tells the traveller, an edit tells the
 * Sarthi — which is the easy thing to get backwards, and getting it backwards would
 * send a traveller's itinerary to a volunteer's lock screen or vice versa.
 */
describe('push, and who it reaches', () => {
    beforeEach(() => {
        users.rider_1 = { ...RIDER, fcmTokens: { tok_rider: {} } };
        users.sarthi_1 = { ...SARTHI, fcmTokens: { tok_sarthi: {} } };
    });

    it('tells the TRAVELLER when a Sarthi claims their pickup', async () => {
        // The one thing they are waiting for, and the reason their screen may ask for
        // notification permission at all.
        await call({ action: 'claim' }, 'sarthi_1');
        expect(pushes).toHaveLength(1);
        expect(pushes[0]).toMatchObject({ kind: 'claimed', sarthiName: 'Kiran', pickupId: 'p1' });
        expect(pushes[0].to).toEqual([{ uid: 'rider_1', token: 'tok_rider' }]);
    });

    it('tells the SARTHI when the traveller changes something that matters', async () => {
        pickup = {
            ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1', claimedByName: 'Kiran',
            partySize: 2, largeBags: 4, cabinBags: 2, terminal: 'E', hasUsWorkingPhone: false,
            passenger: { phone: '+16175550123' },
        };
        await call({
            action: 'editRequest',
            arrivalDate: '2026-09-20', arrivalTime: '22:00', airportCode: 'BOS', terminal: 'E',
            partySize: 2, largeBags: 8, cabinBags: 2, hasUsWorkingPhone: false,
            fullName: 'Ramesh Patel', dateOfBirth: '2007-04-11',
            email: 'ramesh@example.com', phone: '+16175550123', whatsappOn: 'primary',
        }, 'rider_1');

        expect(pushes).toHaveLength(1);
        expect(pushes[0]).toMatchObject({ kind: 'changed' });
        expect(pushes[0].to).toEqual([{ uid: 'sarthi_1', token: 'tok_sarthi' }]);
        expect(pushes[0].changed).toContain('the luggage');
    });

    it('sends nothing for a transition nobody is waiting on', async () => {
        pickup = { ...OPEN, status: 'claimed', claimedByUid: 'sarthi_1' };
        await call({ action: 'met' }, 'sarthi_1');
        expect(pushes).toHaveLength(0);
    });

    it('costs nothing when the recipient has no device registered', async () => {
        // Which is nearly everybody today. `sendNotification` never throws and an empty
        // recipient list must not change the outcome of the transition.
        users.rider_1 = { ...RIDER };
        const result = await call({ action: 'claim' }, 'sarthi_1');
        expect(result).toMatchObject({ success: true, status: 'claimed' });
        expect(pushes[0].to).toEqual([]);
    });
});
