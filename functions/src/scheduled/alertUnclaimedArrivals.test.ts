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
 *
 * THE BANDS ARE NOW MANAGER-EDITABLE, which changed the record from a map keyed by
 * band name to one number — the tightest band already fired. The cases that matter for
 * that are at the bottom: a custom list is honoured, the old map is still read so a
 * deploy does not re-alert everything, and turning the alert off stamps NOTHING, which
 * is the non-obvious one.
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

/**
 * The manager's configuration, faked per case.
 *
 * Mocked rather than driven through the db stub deliberately: `getNotificationSettings`
 * caches for a minute, so a real read in a test file would leak one case's settings
 * into the next.
 */
let settings: any;
vi.mock('../utils/notificationSettings', () => ({
    getNotificationSettings: async () => settings,
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
    settings = { enabled: { 'airport-unclaimed': true }, alertBands: [48, 24, 10, 2] };
    makeDb();
});

describe('which band fires', () => {
    it('sends the tightest band already crossed, and only that one', async () => {
        pickups = [arrival({ arrivalAt: inHours(9) })];
        await run();

        expect(sent).toHaveLength(1);
        expect(sent[0].body).toMatch(/under ten hours/);
        expect(merges[0].data.lastAlertedBandHours).toBe(10);
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
        expect(merges[0].data.lastAlertedBandHours).toBe(2);
    });
});

describe('a band is never sent twice', () => {
    it('skips one already stamped', async () => {
        // 96 copies of the same alert is how a coordinator learns to turn
        // notifications off — which disables the channel for everything else too.
        pickups = [arrival({ arrivalAt: inHours(9), lastAlertedBandHours: 10 })];
        await run();

        expect(sent).toHaveLength(0);
        expect(merges).toHaveLength(0);
    });

    it('still fires the NEXT band down', async () => {
        pickups = [arrival({ arrivalAt: inHours(1), lastAlertedBandHours: 10 })];
        await run();

        expect(sent).toHaveLength(1);
        expect(merges[0].data.lastAlertedBandHours).toBe(2);
    });

    it('skips a band no TIGHTER than the one already sent', async () => {
        // The comparison that replaced the per-band map. A stamp at 2h means every
        // wider band is behind us, whatever the list currently says.
        pickups = [arrival({ arrivalAt: inHours(9), lastAlertedBandHours: 2 })];
        await run();

        expect(sent).toHaveLength(0);
        expect(merges).toHaveLength(0);
    });

    it('reads the OLD map, so the deploy does not re-alert every open trip', async () => {
        // Pickups in flight when this shipped carry `alertsSent`. Read as "never
        // alerted", every one of them would start again from the widest band.
        pickups = [arrival({ arrivalAt: inHours(9), alertsSent: { '48h': 'x', '10h': 'x' } })];
        await run();

        expect(sent).toHaveLength(0);
        expect(merges).toHaveLength(0);
    });
});

describe('the bands a manager chose', () => {
    it('honours a custom list', async () => {
        settings.alertBands = [24, 6];
        pickups = [arrival({ arrivalAt: inHours(5) })];
        await run();

        expect(sent).toHaveLength(1);
        expect(sent[0].body).toMatch(/under six hours/);
        expect(merges[0].data.lastAlertedBandHours).toBe(6);
    });

    it('says nothing before the widest band a manager kept', async () => {
        // Dropping 48h and 24h means a trip two days out is no longer worth waking
        // anybody for.
        settings.alertBands = [6, 2];
        pickups = [arrival({ arrivalAt: inHours(30) })];
        await run();

        expect(sent).toHaveLength(0);
    });

    it('does not re-alert a trip whose old band is no longer in the list', async () => {
        // The exact failure the numeric stamp exists to prevent: a stamp of 10 with
        // 10 removed from the list still means "wider than 6 is behind us".
        settings.alertBands = [24, 6];
        pickups = [arrival({ arrivalAt: inHours(9), lastAlertedBandHours: 10 })];
        await run();

        expect(sent).toHaveLength(0);
    });
});

describe('when a manager switches the alert off', () => {
    beforeEach(() => { settings.enabled['airport-unclaimed'] = false; });

    it('sends nothing', async () => {
        await run();
        expect(sent).toHaveLength(0);
    });

    it('STAMPS NOTHING, so turning it back on does not skip the band', async () => {
        // The non-obvious half. `dispatch` would refuse the send on its own, but only
        // after this loop had recorded the band as done — and a band recorded but
        // never announced is silently lost for the life of the trip.
        await run();
        expect(merges).toHaveLength(0);
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
        expect(merges[0].data.lastAlertedBandHours).toBe(10);
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
        expect(auditRows[0].details).toMatchObject({ band: 10, recipients: 1 });
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
