/**
 * Three audit row shapes exist in production and none may be rewritten — editing
 * audit history is the one migration that undermines the record it migrates. So
 * the reader has to cope with all three, and these tests pin each one.
 *
 * The third shape is the reason this work exists: deleteSabhaEvent wrote
 * `performedAt` where every other writer wrote `timestamp`, and the console orders
 * by `timestamp`. Firestore excludes documents lacking the orderBy field, so the
 * most destructive action in the app was the one action the audit screen could
 * never display.
 */

import { describe, it, expect, vi } from 'vitest';

// normaliseAuditRow is pure, but the module imports firebase/firestore and the
// app's config at load time.
vi.mock('firebase/firestore', () => ({
    addDoc: vi.fn(),
    collection: vi.fn(),
}));
vi.mock('../../firebase/config', () => ({ db: {} }));

import { normaliseAuditRow, buildAuditRow } from '../../src/utils/audit';

describe('normaliseAuditRow — the current shape', () => {
    const row = normaliseAuditRow({
        timestamp: '2026-08-07T18:00:00.000Z',
        actorUid: 'mgr1', actorName: 'Mira',
        action: 'doc.update',
        targetCollection: 'users', targetDocumentId: 'student_alice_long_id',
        summary: 'Updated fields: phone',
    });

    it('reads every field', () => {
        expect(row.actorName).toBe('Mira');
        expect(row.action).toBe('doc.update');
        expect(row.summary).toBe('Updated fields: phone');
        expect(row.timestamp).toBe('2026-08-07T18:00:00.000Z');
    });

    it('truncates the target id so the column cannot blow out', () => {
        expect(row.target).toBe('users / student_alic');
    });
});

describe('normaliseAuditRow — the old console shape', () => {
    // { managerId, managerName, action: 'UPDATE', collection, documentId, details }
    const row = normaliseAuditRow({
        timestamp: '2026-08-07T18:00:00.000Z',
        managerId: 'mgr1', managerName: 'Mira',
        action: 'UPDATE',
        collection: 'vehicles', documentId: 'car-1',
        details: 'Updated fields: plate',
    });

    it('falls back to managerName and collection', () => {
        expect(row.actorName).toBe('Mira');
        expect(row.target).toBe('vehicles / car-1');
    });

    it('uses the string details as the summary', () => {
        expect(row.summary).toBe('Updated fields: plate');
    });

    it('still colours UPDATE as neutral', () => {
        expect(row.tone).toBe('neutral');
    });
});

describe('normaliseAuditRow — the old deleteSabhaEvent shape', () => {
    // No `timestamp`, no `summary`, details is an OBJECT, and the actor is a raw uid.
    const raw = {
        action: 'deleteSabhaEvent',
        collectionName: 'events',
        documentId: '2026-09-11',
        performedBy: 'mgr1',
        performedAt: '2026-08-07T21:30:00.000Z',
        state: 'done',
        details: { responseCount: 3, requestedRideIds: ['r1'], wasCurrentEvent: false },
    };

    it('recovers a timestamp from performedAt', () => {
        // Without this the row renders "N/A" even once the query returns it.
        expect(normaliseAuditRow(raw).timestamp).toBe('2026-08-07T21:30:00.000Z');
    });

    it('falls back to the uid when there is no name', () => {
        expect(normaliseAuditRow(raw).actorName).toBe('mgr1');
    });

    it('renders the details object rather than leaving the column blank', () => {
        expect(normaliseAuditRow(raw).summary).toContain('responseCount');
    });

    it('reads collectionName', () => {
        expect(normaliseAuditRow(raw).target).toBe('events / 2026-09-11');
    });
});

describe('normaliseAuditRow — tone', () => {
    const toneOf = (action: string) => normaliseAuditRow({ action }).tone;

    it('marks anything deleting as destructive, in either naming style', () => {
        expect(toneOf('doc.delete')).toBe('destructive');
        expect(toneOf('user.delete')).toBe('destructive');
        expect(toneOf('event.delete')).toBe('destructive');
        expect(toneOf('DELETE')).toBe('destructive');
        expect(toneOf('deleteSabhaEvent')).toBe('destructive');
    });

    it('marks creates as create', () => {
        expect(toneOf('doc.create')).toBe('create');
        expect(toneOf('CREATE')).toBe('create');
    });
});

describe('normaliseAuditRow — junk', () => {
    it('never throws on an empty or partial row', () => {
        const row = normaliseAuditRow({});
        expect(row.actorName).toBe('Unknown');
        expect(row.timestamp).toBeNull();
        expect(row.target).toBe('? / ?');
        expect(row.action).toBe('unknown');
    });
});

describe('buildAuditRow', () => {
    it('always writes timestamp, so the row can never be invisible to the query', () => {
        const built = buildAuditRow({
            action: 'doc.update', actorUid: 'u', actorName: 'N',
            targetCollection: 'users', targetDocumentId: 'd', summary: 's',
        }, new Date('2026-08-07T18:00:00.000Z'));

        expect(built.timestamp).toBe('2026-08-07T18:00:00.000Z');
    });

    it('stamps the founding city and location', () => {
        const built = buildAuditRow({
            action: 'doc.update', actorUid: 'u', actorName: 'N',
            targetCollection: 'users', targetDocumentId: 'd', summary: 's',
        });

        expect(built.cityId).toBe('boston');
        expect(built.locationId).toBe('boston-huntington');
    });

    it('defaults details to an object, never a string', () => {
        // The old writers put a string here and the new schema promises an object;
        // a reader doing details.foo on a string gets undefined, not a crash, which
        // is the kind of silent difference worth pinning.
        const built = buildAuditRow({
            action: 'doc.update', actorUid: 'u', actorName: 'N',
            targetCollection: 'users', targetDocumentId: 'd', summary: 's',
        });

        expect(built.details).toEqual({});
    });

    it('falls back to "Manager" for a missing actor name', () => {
        const built = buildAuditRow({
            action: 'doc.update', actorUid: 'u', actorName: '',
            targetCollection: 'users', targetDocumentId: 'd', summary: 's',
        });

        expect(built.actorName).toBe('Manager');
    });
});
