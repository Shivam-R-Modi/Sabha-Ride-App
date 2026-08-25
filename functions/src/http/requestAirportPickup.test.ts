/**
 * Filing an airport pickup request.
 *
 * Asserted on the BATCH PAYLOAD rather than the return value, the same way
 * globalAssignDriver's tests are: what matters is the two documents that get
 * written, and a function can return `{success:true}` while writing the wrong thing.
 *
 * The assertions that carry weight:
 *
 *  - **both documents are in one batch.** The trip and the traveller's durable
 *    record have to land together or neither; a trip whose passenger snapshot never
 *    got written is a card with no name on it.
 *  - **no undefined reaches Firestore.** The Admin SDK is not configured with
 *    `ignoreUndefinedProperties`, and a fake Firestore accepts undefined happily —
 *    so this is the only place the real failure can be caught.
 *  - **`createdAt` on the profile is written once.** It is a merge, and including it
 *    every time overwrites the first-seen date on every subsequent trip.
 *  - **one live request per person.** Two open requests means two Sarthis driving to
 *    the same terminal, and the second finds nobody.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

let db: any;
let sets: Array<{ path: string; data: any; opts: any }>;
let auditRows: any[];
let existingRequests: any[];
let profileExists: boolean;
let committed: boolean;

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) { super(message); this.name = 'HttpsError'; }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});
vi.mock('firebase-admin', () => ({ firestore: () => db }));

const approvedStudent = vi.fn(async () => ({ name: 'Ramesh' }));
vi.mock('../utils/authz', () => ({
    assertApprovedStudent: (...a: any[]) => approvedStudent(...(a as [])),
}));

const rateLimit = vi.fn(async () => undefined);
vi.mock('../utils/rateLimiter', () => ({ checkRateLimit: (...a: any[]) => rateLimit(...(a as [])) }));

vi.mock('../utils/settings', () => ({ getTimeZone: async () => 'America/New_York' }));

vi.mock('../utils/audit', () => ({
    writeAuditLog: async (_db: any, entry: any) => {
        auditRows.push({ ...entry });
        return { set: async (p: any) => { Object.assign(auditRows[auditRows.length - 1], p); } };
    },
}));

import { requestAirportPickup } from './requestAirportPickup';

function makeDb() {
    sets = []; auditRows = []; committed = false;
    db = {
        collection: (name: string) => ({
            where: () => ({ get: async () => ({ docs: existingRequests }) }),
            doc: (id?: string) => ({
                id: id ?? 'pickup_new',
                path: `${name}/${id ?? 'pickup_new'}`,
                get: async () => ({ exists: profileExists }),
            }),
        }),
        batch: () => ({
            set: (ref: any, data: any, opts?: any) => { sets.push({ path: ref.path, data, opts }); },
            commit: async () => { committed = true; },
        }),
    };
}

/**
 * The clock is frozen for this whole file.
 *
 * Not decoration: `parseFlight` refuses an arrival in the past AND one more than two
 * years out, so any hardcoded fixture date eventually falls off one end or the other.
 * A frozen clock also makes the UTC assertions below deterministic across daylight
 * saving, which is the thing they exist to check.
 */
const FROZEN = new Date('2026-09-01T12:00:00Z');

const VALID = {
    arrivalDate: '2026-09-20',
    arrivalTime: '22:00',
    airportCode: 'BOS',
    isInternational: true,
    airline: 'Emirates',
    flightNumber: 'EK237',
    partySize: 2,
    largeBags: 4,
    cabinBags: 2,
    dropoffAddress: '360 Huntington Ave, Boston',
    dropoffLat: 42.3399,
    dropoffLng: -71.0881,
    hasUsWorkingPhone: false,
    fullName: 'Ramesh Patel',
    dateOfBirth: '2007-04-11',
    email: 'ramesh@example.com',
    phone: '+16175550123',
    whatsappOn: 'primary',
    familyContact: {
        name: 'Bhavna Patel', relationship: 'Mother',
        phone: '+919876543210', hasWhatsapp: true,
    },
};

const request = (over: Record<string, unknown> = {}, uid = 'rider_1') =>
    (requestAirportPickup as any)({ ...VALID, ...over }, { auth: { uid } });

const pickupWrite = () => sets.find(s => s.path.startsWith('airportPickups/'))!;
const profileWrite = () => sets.find(s => s.path.startsWith('airportProfiles/'))!;

/** Every leaf value, so an undefined anywhere in the payload is caught. */
function leaves(value: any, path = ''): Array<[string, any]> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
    }
    return [[path, value]];
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);
    vi.clearAllMocks();
    approvedStudent.mockResolvedValue({ name: 'Ramesh' });
    rateLimit.mockResolvedValue(undefined);
    existingRequests = [];
    profileExists = false;
    makeDb();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('what gets written', () => {
    it('writes the trip and the traveller record in ONE batch', async () => {
        await request();
        expect(committed).toBe(true);
        expect(sets).toHaveLength(2);
        expect(pickupWrite()).toBeDefined();
        expect(profileWrite()).toBeDefined();
    });

    it('opens the trip on the board with nobody assigned', async () => {
        await request();
        const trip = pickupWrite().data;
        expect(trip.status).toBe('open');
        expect(trip.claimedByUid).toBeNull();
        expect(trip.claimedByName).toBeNull();
    });

    it('pins requesterUid to the caller, never to anything in the payload', async () => {
        // Without this, one signed-in account could file a request attributed to
        // another — and the traveller would never see it on their own screen.
        await request({ requesterUid: 'somebody_else' }, 'rider_1');
        expect(pickupWrite().data.requesterUid).toBe('rider_1');
    });

    it('computes arrivalAt server-side in the airport zone', async () => {
        await request();
        // 22:00 EDT at BOS.
        expect(pickupWrite().data.arrivalAt).toBe('2026-09-21T02:00:00.000Z');
    });

    it('ignores an arrivalAt supplied by the client', async () => {
        await request({ arrivalAt: '2000-01-01T00:00:00.000Z' });
        expect(pickupWrite().data.arrivalAt).toBe('2026-09-21T02:00:00.000Z');
    });

    it('snapshots the passenger onto the trip, so a Sarthi never reads airportProfiles', async () => {
        await request();
        const passenger = pickupWrite().data.passenger;
        expect(passenger.name).toBe('Ramesh Patel');
        expect(passenger.dateOfBirth).toBe('2007-04-11');
        expect(passenger.phone).toBe('+16175550123');
        expect(passenger.familyContact.phone).toBe('+919876543210');
    });

    it('stamps the tenancy pair on both documents', async () => {
        await request();
        for (const write of sets) {
            expect(write.data.cityId).toBe('boston');
            expect(write.data.locationId).toBe('boston-huntington');
        }
    });

    it('writes direction explicitly, so nothing has to infer it from an absent field', async () => {
        await request();
        expect(pickupWrite().data.direction).toBe('arrival');
    });

    it('sends NO undefined to Firestore, in either document', async () => {
        // With airline/flightNumber/terminal/preferredName/university/altPhone all
        // optional, an unstripped undefined would throw for real and pass here.
        await request({ terminal: undefined, preferredName: undefined, university: '' });
        for (const write of sets) {
            for (const [path, value] of leaves(write.data)) {
                expect(value, `${write.path} → ${path} is undefined`).not.toBeUndefined();
            }
        }
    });
});

describe('the durable traveller record', () => {
    it('is merged, not replaced, so an earlier university survives a later trip', async () => {
        await request();
        expect(profileWrite().opts).toEqual({ merge: true });
    });

    it('is keyed by uid, giving one record per traveller', async () => {
        await request({}, 'rider_7');
        expect(profileWrite().path).toBe('airportProfiles/rider_7');
    });

    it('sets createdAt on a first request', async () => {
        profileExists = false;
        await request();
        expect(profileWrite().data.createdAt).toBeTruthy();
    });

    it('does NOT rewrite createdAt on a second request', async () => {
        // A merge that includes it every time makes the field a lie.
        profileExists = true;
        await request();
        expect(profileWrite().data).not.toHaveProperty('createdAt');
        expect(profileWrite().data.updatedAt).toBeTruthy();
    });
});

describe('one live request per traveller', () => {
    for (const status of ['open', 'claimed', 'met']) {
        it(`refuses a second request while one is "${status}"`, async () => {
            existingRequests = [{ data: () => ({ status }) }];
            await expect(request()).rejects.toThrow(/already have an airport pickup/i);
            expect(sets).toHaveLength(0);
        });
    }

    for (const status of ['completed', 'cancelled', 'no_show']) {
        it(`allows a new request after a "${status}" one`, async () => {
            existingRequests = [{ data: () => ({ status }) }];
            await expect(request()).resolves.toMatchObject({ success: true });
        });
    }

    it('lets somebody who was missed ask again immediately', async () => {
        // no_show is deliberately not a blocker: they are standing in the airport.
        existingRequests = [{ data: () => ({ status: 'no_show' }) }];
        await expect(request()).resolves.toBeDefined();
    });
});

describe('authorisation and limits', () => {
    it('refuses an unauthenticated caller', async () => {
        await expect((requestAirportPickup as any)(VALID, {})).rejects.toThrow(/authenticated/i);
    });

    it('refuses a pending or rejected account and writes nothing', async () => {
        approvedStudent.mockRejectedValue(new Error('Only approved riders can request an airport pickup.'));
        await expect(request()).rejects.toThrow(/approved riders/i);
        expect(sets).toHaveLength(0);
    });

    it('checks authorisation BEFORE the rate limit', async () => {
        // So a stranger probing the endpoint is refused for the right reason and
        // never consumes a legitimate traveller's budget.
        approvedStudent.mockRejectedValue(new Error('nope'));
        await expect(request()).rejects.toThrow();
        expect(rateLimit).not.toHaveBeenCalled();
    });

    it('does not write when the rate limit rejects', async () => {
        rateLimit.mockRejectedValue(new Error('Rate limit exceeded'));
        await expect(request()).rejects.toThrow(/rate limit/i);
        expect(sets).toHaveLength(0);
    });
});

describe('the audit row', () => {
    it('is opened as pending and closed with the real document id', async () => {
        await request();
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0].action).toBe('airport.request');
        expect(auditRows[0].outcome).toBe('ok');
        expect(auditRows[0].targetDocumentId).toBe('pickup_new');
    });

    it('names the airport and the date in a line a human can read', async () => {
        await request();
        expect(auditRows[0].summary).toMatch(/BOS/);
        expect(auditRows[0].summary).toMatch(/2026-09-20/);
    });

    it('is not written at all when validation refuses the payload', async () => {
        await expect(request({ dropoffLat: 0, dropoffLng: 0 })).rejects.toThrow();
        expect(auditRows).toHaveLength(0);
    });
});
