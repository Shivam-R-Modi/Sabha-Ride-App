/**
 * The manager's CSV export — every rider's name, phone number and home address.
 *
 * THIS HANDLER HAD NO TESTS, and it had no scoping either: `rides where status ==
 * 'requested'`, limit 500, no date and no location. So "export the 7th" returned
 * pending requests for every evening, and once there are two halls it would hand a
 * manager exporting one hall the other hall's children.
 *
 * THE PRINCIPLE THIS FILE PINS, because it is the opposite of the dispatch rule and
 * easy to get backwards later:
 *
 *   Dispatch REFUSES the ambiguous — a request naming no hall is not dispatched,
 *   because including it would send a car somewhere.
 *
 *   An export SHOWS the ambiguous and says so — dropping it would make a person
 *   disappear from the one document a manager uses to check who is waiting.
 *
 * Silently narrowing a PII export is how somebody gets left off a list and nobody
 * finds out.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
let rides: Array<Record<string, unknown>>;
/** `statistics/{id}` documents, keyed by id, so a per-hall read can be asserted. */
let stats: Record<string, unknown>;
let openHalls: Array<{ id: string; name: string; venue: unknown; active: boolean; order: number }>;

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) { super(message); this.name = 'HttpsError'; }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});
vi.mock('firebase-admin', () => ({ firestore: () => db }));
vi.mock('../utils/authz', () => ({ assertApprovedManager: async () => ({ name: 'Mira' }) }));
vi.mock('../utils/rateLimiter', () => ({ checkRateLimit: async () => undefined }));
vi.mock('../utils/settings', () => ({ locationsOrFoundingFallback: async () => openHalls }));

import { generateEventCSV } from './generateEventCSV';

const DATE = '2026-08-14';
const HUNTINGTON = {
    id: 'boston-huntington', name: 'Huntington', active: true, order: 0,
    venue: { lat: 42.3, lng: -71.0, address: 'a' },
};
const SOMERVILLE = {
    id: 'somerville', name: 'Somerville', active: true, order: 1,
    venue: { lat: 42.4, lng: -71.1, address: 'b' },
};

const req = (name: string, over: Record<string, unknown> = {}) => ({
    studentId: `stu_${name}`, studentName: name, studentPhone: '555',
    pickupAddress: `${name} Street`, status: 'requested',
    eventDate: DATE, locationId: 'boston-huntington', ...over,
});

function makeDb() {
    db = {
        collection: (n: string) => ({
            where: () => ({ limit: () => ({ get: async () => ({
                size: rides.length,
                docs: rides.map((r, i) => ({ id: `r${i}`, data: () => r })),
            }) }) }),
            doc: (id: string) => ({
                get: async () => ({
                    exists: stats[`${n}/${id}`] !== undefined,
                    data: () => stats[`${n}/${id}`],
                }),
            }),
        }),
    };
}

const call = (data: Record<string, unknown> = {}) =>
    (generateEventCSV as any)({ eventDate: DATE, ...data }, { auth: { uid: 'mgr_1' } });

const names = (csv: string) => csv.split('\n')
    .filter(l => l && !l.startsWith('#') && !l.startsWith('Bhulku Name'))
    .map(l => l.split(',')[0].replace(/"/g, ''));

beforeEach(() => {
    vi.clearAllMocks();
    openHalls = [HUNTINGTON, SOMERVILLE];
    stats = {};
    makeDb();
});

describe('scoping to one sabha location', () => {
    it('leaves the other hall\'s riders OUT', async () => {
        // The privacy regression two halls would otherwise create.
        rides = [req('Asha'), req('Bhavesh', { locationId: 'somerville' })];
        const { csvContent } = await call({ locationId: 'boston-huntington' });

        expect(names(csvContent)).toEqual(['Asha']);
    });

    it('exports every hall when none is named, which is what it always did', async () => {
        rides = [req('Asha'), req('Bhavesh', { locationId: 'somerville' })];
        const { csvContent } = await call();

        expect(names(csvContent).sort()).toEqual(['Asha', 'Bhavesh']);
    });

    it('names the scope IN THE FILE, not only in the filename', async () => {
        // A spreadsheet of children's addresses that does not say which evening and
        // which hall it covers is a document nobody can safely file or delete later.
        rides = [req('Asha')];
        const one = await call({ locationId: 'somerville' });
        const all = await call();

        expect(one.csvContent.split('\n')[0]).toContain('Somerville');
        expect(one.csvContent.split('\n')[0]).toContain(DATE);
        expect(all.csvContent.split('\n')[0]).toContain('all locations');
    });

    it('REFUSES a location that is not running, rather than exporting nothing', async () => {
        // An empty PII export reads as "nobody is waiting". A typo must not produce it.
        rides = [req('Asha')];
        await expect(call({ locationId: 'cambridge' }))
            .rejects.toThrow(/not running/i);
    });
});

describe('scoping to one evening', () => {
    it('leaves another evening out — it never did before', async () => {
        rides = [req('Asha'), req('Old', { eventDate: '2026-08-07' })];
        const { csvContent } = await call();

        expect(names(csvContent)).toEqual(['Asha']);
    });
});

describe('the ambiguous rows are SHOWN, not dropped', () => {
    it('includes a request that names no sabha date, and says so', async () => {
        // Dropping it would make a person vanish from the document a manager uses to
        // check who is waiting. Dispatch refuses such a request; an export shows it.
        rides = [req('Nameless', { eventDate: undefined })];
        const { csvContent } = await call();

        expect(names(csvContent)).toEqual(['Nameless']);
        expect(csvContent).toMatch(/no sabha date/);
    });

    it('includes a request that names no location, and says so', async () => {
        rides = [req('Unplaced', { locationId: undefined })];
        const { csvContent } = await call({ locationId: 'boston-huntington' });

        expect(names(csvContent)).toEqual(['Unplaced']);
        expect(csvContent).toMatch(/no location/);
    });

    it('reports both gaps at once', async () => {
        rides = [req('Both', { eventDate: undefined, locationId: undefined })];
        const { csvContent } = await call();

        expect(csvContent).toMatch(/no sabha date, no location/);
    });

    it('says nothing extra about a complete row', async () => {
        rides = [req('Asha')];
        const { csvContent } = await call();

        expect(csvContent).toMatch(/Pending Request,/);
        expect(csvContent).not.toMatch(/no sabha date|no location/);
    });
});

/**
 * COMPLETED rides come from the statistics documents, and those are per hall.
 *
 * A single read of `statistics/{date}` returns only the FOUNDING hall's, because that
 * is the one that keeps the bare date. On a two-hall evening a manager's report would
 * be quietly missing half the people who travelled — the wrong direction entirely for
 * a document used to check that everybody got home.
 */
describe('completed rides, across halls', () => {
    const completed = (name: string) => ({
        pickup: { students: [{ id: `stu_${name}`, name, driverName: 'Asha' }] },
    });

    it('reads BOTH halls when no hall is named', async () => {
        rides = [];
        stats[`statistics/${DATE}`] = completed('Huntington Rider');
        stats[`statistics/${DATE}__somerville`] = completed('Somerville Rider');

        const { csvContent } = await call();

        expect(csvContent).toMatch(/Huntington Rider/);
        expect(csvContent).toMatch(/Somerville Rider/);
    });

    it('reads only the named hall when one is given', async () => {
        rides = [];
        stats[`statistics/${DATE}`] = completed('Huntington Rider');
        stats[`statistics/${DATE}__somerville`] = completed('Somerville Rider');

        const { csvContent } = await call({ locationId: 'somerville' });

        expect(csvContent).toMatch(/Somerville Rider/);
        expect(csvContent).not.toMatch(/Huntington Rider/);
    });

    it('reads the founding hall from the BARE date, not a suffixed key', async () => {
        // Every statistics document written before halls existed is filed there.
        rides = [];
        stats[`statistics/${DATE}`] = completed('Historic Rider');

        const { csvContent } = await call({ locationId: 'boston-huntington' });

        expect(csvContent).toMatch(/Historic Rider/);
    });

    it('copes with a hall that has no statistics yet', async () => {
        rides = [];
        stats[`statistics/${DATE}`] = completed('Huntington Rider');

        const { csvContent } = await call();

        expect(csvContent).toMatch(/Huntington Rider/);
    });
});
