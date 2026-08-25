/**
 * Alerting a coordinator that nobody has taken an arrival.
 *
 * THE ASSERTION THAT EARNS THIS FILE: a band already sent is never sent again.
 *
 * The job runs every thirty minutes and the widest band is two days out, so a
 * missing idempotency check does not fail — it sends the same alert 96 times, and
 * the coordinator turns notifications off. That is worse than never alerting, because
 * it silently disables the channel for everything else too.
 *
 * The other one worth its lines: the band is STAMPED even when there is nobody to
 * push to. A congregation with push switched off must not accumulate a backlog of
 * unsent bands that all fire at once the day somebody enables it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
let pickups: Array<{ id: string; data: any }>;
let users: Array<{ id: string; data: any }>;
let merges: Array<{ id: string; data: any }>;
let auditRows: any[];
let sent: Array<{ recipients: any[]; title: string; body: string }>;

vi.mock('firebase-functions', () => ({
    pubsub: {
        schedule: () => ({
            timeZone: () => ({ onRun: (handler: any) => handler }),
        }),
    },
}));
vi.mock('firebase-admin', () => ({ firestore: () => db }));

vi.mock('../utils/notifications', () => ({
    tokensOf: (uid: string, data: any) =>
        Object.keys(data?.fcmTokens ?? {}).map(token => ({ uid, token })),
    sendNotification: async (recipients: any[], title: string, body: string) => {
        sent.push({ recipients, title, body });
        return { delivered: recipients.length, failed: 0, pruned: 0 };
    },
}));

vi.mock('../utils/audit', () => ({
    writeAuditLog: async (_db: any, entry: any) => { auditRows.push({ ...entry }); return null; },
}));

import { alertUnclaimedArrivals } from './alertUnclaimedArrivals';

const NOW = new Date('2026-09-20T12:00:00Z');
const HOUR = 3600_000;
const inHours = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString();

const COORDINATOR = {
    role: 'manager', roles: ['manager'], accountStatus: 'approved',
    airportCoordinator: true, fcmTokens: { 'tok-coord': {} },
};
const PLAIN_MANAGER = {
    role: 'manager', roles: ['manager'], accountStatus: 'approved',
    fcmTokens: { 'tok-mgr': {} },
};
const SARTHI = {
    role: 'driver', roles: ['driver'], accountStatus: 'approved',
    fcmTokens: { 'tok-sarthi': {} },
};

function makeDb() {
    merges = []; auditRows = []; sent = [];
    const chain: any = {
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        get: async () => ({
            size: pickups.length,
            docs: pickups.map(p => ({
                id: p.id,
                data: () => p.data,
                ref: {
                    id: p.id,
                    set: async (data: any) => { merges.push({ id: p.id, data }); },
                },
            })),
        }),
    };
    db = {
        collection: (name: string) => {
            if (name === 'users') {
                return {
                    get: async () => ({
                        docs: users.map(u => ({ id: u.id, data: () => u.data })),
                    }),
                };
            }
            return chain;
        },
    };
}

const run = () => (alertUnclaimedArrivals as any)();

const arrival = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    data: {
        status: 'open',
        requesterName: 'Ramesh',
        airportCode: 'BOS',
        arrivalAt: inHours(9),
        ...over,
    },
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    pickups = [arrival()];
    users = [{ id: 'coord_1', data: COORDINATOR }];
    makeDb();
});

describe('which band fires', () => {
    it('sends the tightest band already crossed, and only that one', async () => {
        pickups = [arrival({ arrivalAt: inHours(9) })];
        await run();

        expect(sent).toHaveLength(1);
        expect(sent[0].body).toMatch(/under ten hours/);
        expect(merges[0].data.alertsSent).toHaveProperty('10h');
    });

    it('says nothing at all for something three days out', async () => {
        pickups = [arrival({ arrivalAt: inHours(72) })];
        await run();

        expect(sent).toHaveLength(0);
        expect(merges).toHaveLength(0);
    });

    it('still alerts on a plane that has already landed unclaimed', async () => {
        // The most urgent thing this job can find, so the window reaches backwards.
        pickups = [arrival({ arrivalAt: inHours(-1) })];
        await run();

        expect(sent).toHaveLength(1);
        expect(merges[0].data.alertsSent).toHaveProperty('2h');
    });
});

describe('a band is never sent twice', () => {
    it('skips one already stamped', async () => {
        // 96 copies of the same alert is how a coordinator learns to turn
        // notifications off — which disables the channel for everything else too.
        pickups = [arrival({
            arrivalAt: inHours(9),
            alertsSent: { '10h': '2026-09-20T11:00:00.000Z' },
        })];
        await run();

        expect(sent).toHaveLength(0);
        expect(merges).toHaveLength(0);
    });

    it('still fires the NEXT band down', async () => {
        pickups = [arrival({
            arrivalAt: inHours(1),
            alertsSent: { '48h': 'x', '24h': 'x', '10h': 'x' },
        })];
        await run();

        expect(sent).toHaveLength(1);
        expect(merges[0].data.alertsSent).toHaveProperty('2h');
    });

    it('merges the stamp rather than replacing the whole map', async () => {
        // A `set` without merge would wipe the earlier bands and let them all fire
        // again on the next run.
        pickups = [arrival({ arrivalAt: inHours(1), alertsSent: { '10h': 'x' } })];
        await run();

        expect(merges[0].data).toEqual({ alertsSent: { '2h': expect.any(String) } });
    });
});

describe('who hears about it', () => {
    it('goes to coordinators', async () => {
        await run();
        expect(sent[0].recipients).toEqual([{ uid: 'coord_1', token: 'tok-coord' }]);
    });

    it('does NOT go to a manager without the flag', async () => {
        // The one thing the flag really gates: who gets woken at 5am.
        users = [{ id: 'mgr_1', data: PLAIN_MANAGER }];
        await run();

        expect(sent).toHaveLength(0);
    });

    it('does NOT go to Sarthis', async () => {
        users = [{ id: 'sarthi_1', data: SARTHI }];
        await run();

        expect(sent).toHaveLength(0);
    });

    it('does NOT go to a revoked coordinator', async () => {
        users = [{ id: 'coord_1', data: { ...COORDINATOR, accountStatus: 'rejected' } }];
        await run();

        expect(sent).toHaveLength(0);
    });

    it('stamps the band anyway when nobody has push on', async () => {
        // Otherwise a congregation with notifications off builds up a backlog of
        // unsent bands that all fire the day somebody enables it.
        users = [];
        await run();

        expect(sent).toHaveLength(0);
        expect(merges[0].data.alertsSent).toHaveProperty('10h');
    });
});

describe('what it ignores', () => {
    for (const status of ['claimed', 'met', 'completed', 'cancelled', 'no_show']) {
        it(`says nothing about a "${status}" arrival`, async () => {
            pickups = [arrival({ status })];
            await run();

            expect(sent).toHaveLength(0);
            expect(merges).toHaveLength(0);
        });
    }
});

describe('the audit trail', () => {
    it('records the alert, with the band and how many devices heard it', async () => {
        await run();
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0].actorUid).toBe('system:alertUnclaimedArrivals');
        expect(auditRows[0].details).toMatchObject({ band: '10h', recipients: 1 });
    });

    it('records it even when nobody heard it', async () => {
        // "No coordinator had push on" is exactly the fact somebody needs when they
        // ask why nobody was told.
        users = [];
        await run();

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0].details).toMatchObject({ recipients: 0 });
    });

    it('names the traveller and the airport in a line a human can read', async () => {
        await run();
        expect(auditRows[0].summary).toMatch(/Ramesh/);
        expect(auditRows[0].summary).toMatch(/BOS/);
    });
});
