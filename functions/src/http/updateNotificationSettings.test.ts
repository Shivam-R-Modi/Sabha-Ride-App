/**
 * A manager changing which notifications the app sends.
 *
 * THE ASSERTIONS THAT EARN THIS FILE are the three things a Firestore rule cannot do,
 * which is the whole reason this is a callable rather than a client write:
 *
 *   - it refuses anybody who is not an approved manager
 *   - it NORMALISES what is stored, so the panel and the enforcer cannot disagree
 *   - it writes an audit row that NAMES what was silenced
 *
 * The last one matters most. "Sarthi has arrived" going quiet is exactly the change
 * somebody will need explained months later, and a count ("2 notifications changed")
 * answers nothing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
let written: any;
let auditRows: any[];
let existing: any;

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) { super(message); this.name = 'HttpsError'; }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});
vi.mock('firebase-admin', () => ({ firestore: () => db }));

const approvedManager = vi.fn(async () => ({ name: 'Mira' }));
vi.mock('../utils/authz', () => ({
    assertApprovedManager: (...a: any[]) => approvedManager(...(a as [])),
}));

const checkRateLimit = vi.fn(async () => undefined);
vi.mock('../utils/rateLimiter', () => ({
    checkRateLimit: (...a: any[]) => checkRateLimit(...(a as [])),
}));

vi.mock('../utils/audit', () => ({
    writeAuditLog: async (_db: any, entry: any) => { auditRows.push({ ...entry }); return null; },
}));

const clearCache = vi.fn();
vi.mock('../utils/notificationSettings', async (importOriginal) => {
    const real = await importOriginal<typeof import('../utils/notificationSettings')>();
    return {
        ...real,
        clearNotificationSettingsCache: () => clearCache(),
        // Reads the same fixture the "before" comparison needs, without the cache.
        getNotificationSettings: async () =>
            (await import('../constants/notifications')).resolveNotificationSettings(existing),
    };
});

import { updateNotificationSettings } from './updateNotificationSettings';
import { DEFAULT_ALERT_BANDS } from '../constants/notifications';

const call = (data: any = {}, auth: any = { uid: 'mgr_1' }) =>
    (updateNotificationSettings as any)(data, { auth });

beforeEach(() => {
    vi.clearAllMocks();
    auditRows = []; written = undefined; existing = {};
    db = {
        doc: () => ({ set: async (data: any) => { written = data; } }),
    };
});

describe('who may do this', () => {
    it('refuses an unauthenticated caller', async () => {
        await expect(call({}, null)).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('refuses anybody the manager check rejects', async () => {
        approvedManager.mockRejectedValueOnce(new Error('not a manager'));
        await expect(call()).rejects.toThrow(/not a manager/);
        expect(written).toBeUndefined();
    });

    it('asks the shared rate limiter', async () => {
        await call();
        expect(checkRateLimit).toHaveBeenCalled();
    });
});

describe('what gets stored', () => {
    it('writes a complete configuration, not a patch', async () => {
        await call({ enabled: { notice: false } });

        expect(written.enabled.notice).toBe(false);
        // Every other key present and on, so the document can never be half-written.
        expect(written.enabled.sarthi_arrived).toBe(true);
        expect(written.alertBands).toEqual([...DEFAULT_ALERT_BANDS]);
        expect(written.reminderHour).toBe(10);
        expect(written.updatedBy).toBe('mgr_1');
    });

    it('normalises a band list rather than storing it raw', async () => {
        // Out of order, with a duplicate and a value not in the choice list.
        await call({ alertBands: [2, 24, 2, 99] });
        expect(written.alertBands).toEqual([24, 2]);
    });

    it('drops a junk value back to the shipped default instead of refusing', async () => {
        // Refusing would lose the legitimate changes sent alongside it.
        await call({ enabled: { notice: false }, nudgeCooldownSec: 9999 });
        expect(written.nudgeCooldownSec).toBe(60);
        expect(written.enabled.notice).toBe(false);
    });

    it('drops the server cache so the change is not held for a minute', async () => {
        await call();
        expect(clearCache).toHaveBeenCalled();
    });
});

describe('the audit row', () => {
    it('NAMES what was switched off, not how many', async () => {
        await call({ enabled: { sarthi_arrived: false } });

        expect(auditRows[0]).toMatchObject({
            action: 'settings.notifications',
            actorUid: 'mgr_1',
            actorName: 'Mira',
        });
        expect(auditRows[0].summary).toMatch(/switched off Sarthi has arrived/);
        expect(auditRows[0].details.muted).toEqual(['sarthi_arrived']);
    });

    it('names what was switched back on', async () => {
        existing = { enabled: { notice: false } };
        await call({ enabled: {} });

        expect(auditRows[0].summary).toMatch(/switched on New notice/);
        expect(auditRows[0].details.unmuted).toEqual(['notice']);
    });

    it('records a frequency-only change as such rather than inventing a toggle', async () => {
        await call({ alertBands: [24, 6] });

        expect(auditRows[0].summary).toMatch(/frequency only/);
        expect(auditRows[0].details.alertBands).toEqual([24, 6]);
    });

    it('does not report a key nobody touched as a change', async () => {
        // A document written before a new notification existed has no entry for it.
        // Resolved, that reads as "on", so adding a key must not look like a manager
        // switching it on.
        existing = { enabled: { notice: true } };
        await call({ enabled: { notice: true } });

        expect(auditRows[0].details.muted).toEqual([]);
        expect(auditRows[0].details.unmuted).toEqual([]);
    });
});
