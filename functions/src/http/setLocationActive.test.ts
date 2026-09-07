/**
 * Opening and closing a sabha hall.
 *
 * The two directions are NOT symmetrical, and that asymmetry is what these tests are
 * about. Opening one changes what every rider is asked and where every Sarthi can be
 * sent. Closing one leaves every rider already booked for it UNDISPATCHABLE —
 * `rejectionFor` refuses their ride, every Sarthi is told nobody is waiting, and nobody
 * is ever collected. Nothing throws and nothing logs.
 *
 * So closing is the guarded direction: refused with a Sarthi on the road, refused if it
 * would leave nowhere to drive to, and acknowledged explicitly if people are booked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
let locations: Array<{ id: string; data: Record<string, unknown> }>;
let rides: Array<{ id: string; data: Record<string, unknown> }>;
/** Every write the call made, so "it changed nothing" is assertable. */
let writes: Array<{ path: string; data: any }>;

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) { super(message); this.name = 'HttpsError'; }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});
vi.mock('firebase-admin', () => ({ firestore: () => db }));

const assertApprovedManager = vi.fn(async () => ({ name: 'Mira' }));
vi.mock('../utils/authz', () => ({
    assertApprovedManager: (...a: any[]) => assertApprovedManager(...(a as [])),
}));
vi.mock('../utils/rateLimiter', () => ({ checkRateLimit: async () => undefined }));

const auditRows: any[] = [];
vi.mock('../utils/audit', () => ({
    writeAuditLog: async (_db: unknown, entry: any) => {
        auditRows.push(entry);
        return { set: async () => undefined };
    },
}));

import { setLocationActive } from './setLocationActive';

const VENUE = { lat: 42.339925, lng: -71.088182, address: '346 Huntington Ave' };
const ELM = { lat: 42.387, lng: -71.099, address: '5 Elm Street' };

const hall = (id: string, name: string, active: boolean, venue = VENUE) =>
    ({ id, data: { name, active, order: 0, venue } });

const ride = (id: string, locationId: string | null, status = 'requested', seats = 1) => ({
    id,
    data: {
        status, studentId: `stu_${id}`, seatsRequested: seats,
        ...(locationId ? { locationId } : {}),
    },
});

function makeDb() {
    writes = [];
    db = {
        collection: (name: string) => ({
            get: async () => ({
                docs: (name === 'locations' ? locations : name === 'rides' ? rides : [])
                    .map(d => ({ id: d.id, data: () => d.data })),
            }),
            where: () => ({
                get: async () => ({
                    docs: (name === 'rides' ? rides : []).map(d => ({ id: d.id, data: () => d.data })),
                }),
            }),
            doc: (id: string) => ({
                set: async (data: any) => { writes.push({ path: `${name}/${id}`, data }); },
            }),
        }),
    };
}

const call = (data: any, uid = 'mgr-1') =>
    (setLocationActive as any)(data, { auth: { uid } });

beforeEach(() => {
    vi.clearAllMocks();
    auditRows.length = 0;
    assertApprovedManager.mockResolvedValue({ name: 'Mira' } as any);
    locations = [
        hall('boston-huntington', 'Huntington Ave', true),
        hall('south-boston', 'D Street', false, ELM),
    ];
    rides = [];
    makeDb();
});

describe('setLocationActive — who may ask', () => {
    it('refuses an unauthenticated caller', async () => {
        await expect((setLocationActive as any)({}, {})).rejects.toThrow(/authenticated/);
    });

    it('goes through assertApprovedManager', async () => {
        await call({ locationId: 'south-boston', active: true });
        expect(assertApprovedManager).toHaveBeenCalled();
    });

    it('refuses when the manager check throws', async () => {
        assertApprovedManager.mockRejectedValue(new Error('Manager access revoked'));
        await expect(call({ locationId: 'south-boston', active: true }))
            .rejects.toThrow(/revoked/);
        expect(writes).toEqual([]);
    });

    it('refuses an id that could not be a document id', async () => {
        await expect(call({ locationId: '../system', active: true }))
            .rejects.toThrow(/not valid/);
    });

    it('refuses a hall that does not exist', async () => {
        await expect(call({ locationId: 'brookline', active: true }))
            .rejects.toThrow(/does not exist/);
    });

    it('refuses a call that does not say which way', async () => {
        // `active` absent would otherwise read as falsy and CLOSE a hall somebody meant
        // to open. A boolean is required rather than coerced.
        await expect(call({ locationId: 'south-boston' }))
            .rejects.toThrow(/open or close/);
    });
});

describe('setLocationActive — opening', () => {
    it('opens a hall', async () => {
        const out: any = await call({ locationId: 'south-boston', active: true });

        expect(out.changed).toBe(true);
        expect(writes).toEqual([{
            path: 'locations/south-boston',
            data: expect.objectContaining({ active: true }),
        }]);
    });

    it('REFUSES to open one with no usable address', async () => {
        /**
         * `normaliseLocation` drops a hall with no name or a 0,0 venue, and
         * `getActiveLocations` never returns it — so `active: true` on such a document
         * appears in no list anywhere. A manager would tap Open, watch nothing happen,
         * and have no way to find out why. The address has to be fixed first.
         */
        locations = [
            hall('boston-huntington', 'Huntington Ave', true),
            { id: 'broken', data: { name: 'Broken', active: false, venue: { lat: 0, lng: 0, address: 'x' } } },
        ];
        makeDb();

        await expect(call({ locationId: 'broken', active: true }))
            .rejects.toThrow(/missing a name or a valid address/);
        expect(writes).toEqual([]);
    });

    it('is a no-op on a hall already open, rather than an error', async () => {
        // Two managers on the same screen is a race, not a mistake.
        const out: any = await call({ locationId: 'boston-huntington', active: true });

        expect(out.changed).toBe(false);
        expect(writes).toEqual([]);
    });

    it('audits the opening', async () => {
        await call({ locationId: 'south-boston', active: true });

        expect(auditRows[0]).toMatchObject({
            action: 'location.open',
            targetDocumentId: 'south-boston',
        });
        expect(auditRows[0].summary).toContain('D Street');
    });
});

describe('setLocationActive — closing', () => {
    beforeEach(() => {
        locations = [
            hall('boston-huntington', 'Huntington Ave', true),
            hall('south-boston', 'D Street', true, ELM),
        ];
        makeDb();
    });

    it('closes a hall nobody is booked for', async () => {
        const out: any = await call({ locationId: 'south-boston', active: false });

        expect(out.changed).toBe(true);
        expect(writes[0].data.active).toBe(false);
    });

    it('REFUSES to close the last open hall', async () => {
        /**
         * `locationsOrFoundingFallback` would then synthesise the founding hall from
         * `settings/main` and log an error — a bridge for a project whose seed has not
         * run, not a state to leave production in. It would silently re-open a hall a
         * manager had just shut, which is the worst of both answers.
         */
        locations = [hall('boston-huntington', 'Huntington Ave', true)];
        makeDb();

        await expect(call({ locationId: 'boston-huntington', active: false }))
            .rejects.toThrow(/only sabha location open/);
        expect(writes).toEqual([]);
    });

    it('REFUSES while a Sarthi is on the road to it', async () => {
        rides = [ride('r1', 'south-boston', 'in_progress')];
        makeDb();

        await expect(call({ locationId: 'south-boston', active: false, acknowledge: true }))
            .rejects.toThrow(/already on the way/);
        expect(writes).toEqual([]);
    });

    it('is not blocked by a Sarthi on the road to the OTHER hall', async () => {
        rides = [ride('r1', 'boston-huntington', 'in_progress')];
        makeDb();

        const out: any = await call({ locationId: 'south-boston', active: false });
        expect(out.changed).toBe(true);
    });

    it('REFUSES without acknowledgement when riders are booked', async () => {
        /**
         * Those riders get silence, not an error: `rejectionFor` refuses their ride,
         * every Sarthi is told nobody is waiting, and nobody is ever collected. Closing
         * on top of them is a decision a manager has to take explicitly, which is why
         * the check is here and not only in the dialog.
         */
        rides = [ride('r1', 'south-boston'), ride('r2', 'south-boston')];
        makeDb();

        await expect(call({ locationId: 'south-boston', active: false }))
            .rejects.toThrow(/2 ride requests for D Street would stop being dispatchable/);
        expect(writes).toEqual([]);
    });

    it('closes with acknowledgement, and records who was left waiting', async () => {
        rides = [ride('r1', 'south-boston', 'requested', 3)];
        makeDb();

        const out: any = await call({
            locationId: 'south-boston', active: false, acknowledge: true,
        });

        expect(out.changed).toBe(true);
        expect(auditRows[0]).toMatchObject({ action: 'location.close' });
        expect(auditRows[0].summary).toContain('1 waiting request(s) left undispatchable');
        expect(auditRows[0].details).toMatchObject({
            requestedRideCount: 1, requestedSeatCount: 3,
        });
    });

    it('counts SEATS, not just requests', async () => {
        // Two requests can be nine people. A manager deciding whether to close a hall
        // on top of them needs the number of people, not the number of rows.
        rides = [ride('r1', 'south-boston', 'requested', 4), ride('r2', 'south-boston', 'requested', 5)];
        makeDb();

        const out: any = await call({ locationId: 'south-boston', active: false, dryRun: true });
        expect(out).toMatchObject({ requestedRideCount: 2, requestedSeatCount: 9 });
    });

    it('does not count a ride bound for ANOTHER hall', async () => {
        rides = [ride('r1', 'boston-huntington'), ride('r2', 'south-boston')];
        makeDb();

        const out: any = await call({ locationId: 'south-boston', active: false, dryRun: true });
        expect(out.requestedRideCount).toBe(1);
    });

    it('does not count a ride that names NO hall', async () => {
        // It is already undispatchable with two halls open, so closing one changes
        // nothing for them. Counting it would inflate the warning and it belongs on the
        // board's "names no sabha" row instead.
        rides = [ride('r1', null), ride('r2', 'south-boston')];
        makeDb();

        const out: any = await call({ locationId: 'south-boston', active: false, dryRun: true });
        expect(out.requestedRideCount).toBe(1);
    });
});

describe('setLocationActive — the preview', () => {
    it('changes nothing and writes no audit row', async () => {
        const out: any = await call({ locationId: 'south-boston', active: true, dryRun: true });

        expect(out).toMatchObject({ locationId: 'south-boston', name: 'D Street', active: true });
        expect(writes).toEqual([]);
        expect(auditRows).toEqual([]);
    });

    it('reports how many halls would be open afterwards', async () => {
        // What the dialog needs to warn that this is the last one.
        const opening: any = await call({ locationId: 'south-boston', active: true, dryRun: true });
        expect(opening.openAfter).toBe(2);

        const closing: any = await call({
            locationId: 'boston-huntington', active: false, dryRun: true,
        });
        expect(closing.openAfter).toBe(0);
    });

    it('previews a close WITHOUT refusing, so the dialog can show the numbers', async () => {
        // The guards fire on the real call. A preview that threw would leave the dialog
        // with nothing to say beyond the error.
        locations = [hall('boston-huntington', 'Huntington Ave', true)];
        rides = [ride('r1', 'boston-huntington')];
        makeDb();

        const out: any = await call({
            locationId: 'boston-huntington', active: false, dryRun: true,
        });
        expect(out).toMatchObject({ openAfter: 0, requestedRideCount: 1 });
    });
});
