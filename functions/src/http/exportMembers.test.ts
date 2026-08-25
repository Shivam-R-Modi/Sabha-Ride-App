/**
 * The member directory as a spreadsheet.
 *
 * Three assertions carry this file, and all three are about the fact that every scope
 * emits names, phone numbers and home addresses for a congregation that includes
 * minors:
 *
 *  - **the airport scope needs the coordinator flag.** That collection carries exact
 *    dates of birth, and firestore.rules gates it — but this runs on the Admin SDK
 *    and bypasses rules entirely, so the same gate has to be applied here by hand or
 *    the export is a way round it.
 *  - **a comma in an address does not shift the columns.** Without RFC 4180 quoting
 *    one address silently pairs the wrong phone number with the wrong person, and the
 *    file still opens and still looks fine.
 *  - **the export is audited even though it writes nothing.** The row is the only
 *    record that somebody took a copy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
let collections: Record<string, Array<{ id: string; data: any }>>;
let auditRows: any[];

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) { super(message); this.name = 'HttpsError'; }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});
vi.mock('firebase-admin', () => ({ firestore: () => db }));

let actor: any = { name: 'Mira', role: 'manager', roles: ['manager'], accountStatus: 'approved' };
const approvedManager = vi.fn(async () => actor);
vi.mock('../utils/authz', async () => {
    const real = await vi.importActual<typeof import('../utils/authz')>('../utils/authz');
    return {
        ...real,
        assertApprovedManager: (...a: unknown[]) => approvedManager(...(a as [])),
    };
});

const rateLimit = vi.fn(async () => undefined);
vi.mock('../utils/rateLimiter', () => ({ checkRateLimit: (...a: any[]) => rateLimit(...(a as [])) }));

vi.mock('../utils/audit', () => ({
    writeAuditLog: async (_db: any, entry: any) => { auditRows.push({ ...entry }); return null; },
}));

import { exportMembers } from './exportMembers';

function makeDb() {
    auditRows = [];
    db = {
        collection: (name: string) => {
            const docs = (collections[name] ?? []).map(d => ({ id: d.id, data: () => d.data }));
            const snap = { size: docs.length, docs };
            const chain: any = { limit: () => chain, get: async () => snap };
            return chain;
        },
    };
}

const call = (scope: unknown, uid = 'mgr_1') =>
    (exportMembers as any)({ scope }, { auth: { uid } });

/** Header plus rows, split the way a spreadsheet would. */
const lines = (csv: string) => csv.split('\r\n');

beforeEach(() => {
    vi.clearAllMocks();
    actor = { name: 'Mira', role: 'manager', roles: ['manager'], accountStatus: 'approved' };
    approvedManager.mockImplementation(async () => actor);
    rateLimit.mockResolvedValue(undefined);
    collections = {
        users: [
            { id: 'u1', data: { name: 'Ramesh Patel', email: 'r@x.com', phone: '+16175550123', address: '360 Huntington Ave, Boston, MA', role: 'student', accountStatus: 'approved' } },
            { id: 'u2', data: { name: 'Kiran', email: 'k@x.com', phone: '+16175550124', address: '1 Main St', role: 'driver', accountStatus: 'approved' } },
        ],
        airportPickups: [{ id: 'p1', data: { requesterUid: 'u1' } }],
        rides: [{ id: 'r1', data: { studentId: 'u2' } }],
        airportProfiles: [
            { id: 'u1', data: { fullName: 'Ramesh Patel', dateOfBirth: '2007-04-11', email: 'r@x.com', phone: '+16175550123', whatsappOn: 'primary', familyContact: { name: 'Bhavna', relationship: 'Mother', phone: '+919876543210' }, createdAt: '2026-09-01' } },
        ],
    };
    makeDb();
});

describe('the scope', () => {
    it('refuses one that is not on the list, rather than defaulting to everything', async () => {
        // A silent default here would hand back the whole directory to somebody who
        // asked for something else.
        await expect(call('everyone')).rejects.toThrow(/Scope must be one of/);
        await expect(call('')).rejects.toThrow(/Scope must be one of/);
        await expect(call(undefined)).rejects.toThrow(/Scope must be one of/);
    });

    it('refuses an unauthenticated caller', async () => {
        await expect((exportMembers as any)({ scope: 'all' }, {})).rejects.toThrow(/authenticated/i);
    });

    it('refuses a revoked manager', async () => {
        // This check was once missing from generateEventCSV, and a rejected manager
        // could still export the lot.
        approvedManager.mockRejectedValue(new Error('Only approved managers can export the member directory.'));
        await expect(call('all')).rejects.toThrow(/approved managers/i);
        expect(auditRows).toHaveLength(0);
    });

    it('authorises BEFORE it throttles', async () => {
        approvedManager.mockRejectedValue(new Error('nope'));
        await expect(call('all')).rejects.toThrow();
        expect(rateLimit).not.toHaveBeenCalled();
    });
});

describe('the airport scope is coordinator-only', () => {
    it('is refused to a plain manager', async () => {
        // firestore.rules gates airportProfiles on the flag, and this function runs on
        // the Admin SDK and bypasses rules — so without this check the export is a way
        // straight round it.
        await expect(call('airport')).rejects.toThrow(/airport coordinators/i);
    });

    it('is allowed to a coordinator', async () => {
        actor = { ...actor, airportCoordinator: true };
        const result = await call('airport');
        expect(result.rowCount).toBe(1);
    });

    it('carries the date of birth and the family contact', async () => {
        actor = { ...actor, airportCoordinator: true };
        const { csv } = await call('airport');
        expect(csv).toContain('2007-04-11');
        expect(csv).toContain('+919876543210');
    });

    it('does not gate the other two scopes on the flag', async () => {
        await expect(call('all')).resolves.toMatchObject({ success: true });
        await expect(call('sabha')).resolves.toMatchObject({ success: true });
    });
});

describe('the file itself', () => {
    it('quotes a field containing a comma, so the columns do not shift', async () => {
        // A home address contains commas by definition. Without the quoting, one row
        // silently pairs the wrong phone number with the wrong person — and the file
        // still opens and still looks fine.
        const { csv } = await call('all');
        expect(csv).toContain('"360 Huntington Ave, Boston, MA"');
    });

    it('doubles an embedded quote rather than breaking the row', async () => {
        collections.users = [{ id: 'u1', data: { name: 'Ram "Rocky" Patel', accountStatus: 'approved' } }];
        const { csv } = await call('all');
        expect(csv).toContain('"Ram ""Rocky"" Patel"');
    });

    it('uses CRLF, because Excel on Windows reads a bare newline as one long line', async () => {
        const { csv } = await call('all');
        expect(csv).toContain('\r\n');
    });

    it('marks who uses which service', async () => {
        const rows = lines((await call('all')).csv);
        expect(rows[0]).toContain('Uses Sabha Seva');
        // u1 asked for an airport pickup; u2 asked for a sabha ride.
        expect(rows.find(r => r.includes('Ramesh'))).toMatch(/no,yes$/);
        expect(rows.find(r => r.includes('Kiran'))).toMatch(/yes,no$/);
    });

    it('the sabha scope holds only the people who use it', async () => {
        const rows = lines((await call('sabha')).csv);
        expect(rows).toHaveLength(2);                  // header + Kiran
        expect(rows[1]).toContain('Kiran');
    });

    it('counts rows without counting the header', async () => {
        // Otherwise an empty export reports 1 and nobody notices it is empty.
        collections.users = [];
        const result = await call('all');
        expect(result.rowCount).toBe(0);
    });

    it('reports honestly when it is not truncated', async () => {
        expect((await call('all')).truncated).toBe(false);
    });
});

describe('the audit row', () => {
    it('is written even though nothing was written to the database', async () => {
        await call('all');
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0].action).toBe('members.export');
        expect(auditRows[0].details).toMatchObject({ scope: 'all' });
    });

    it('names the manager who took the copy', async () => {
        await call('all');
        expect(auditRows[0].actorName).toBe('Mira');
        expect(auditRows[0].actorUid).toBe('mgr_1');
    });

    it('is NOT written when the scope was refused', async () => {
        await expect(call('airport')).rejects.toThrow();
        expect(auditRows).toHaveLength(0);
    });

    it('points at the collection the scope actually read', async () => {
        actor = { ...actor, airportCoordinator: true };
        await call('airport');
        expect(auditRows[0].targetCollection).toBe('airportProfiles');
    });
});
