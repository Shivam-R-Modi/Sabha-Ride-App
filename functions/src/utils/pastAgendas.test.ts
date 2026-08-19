/**
 * Clearing the agenda off sabhas that have already happened.
 *
 * Two things are worth pinning, and the second is the dangerous one.
 *
 * The DATE BOUNDARY: an agenda must survive the whole of its own day. Comparing
 * in UTC would clear an evening agenda five hours early on the east coast, during
 * the sabha it describes — the same trap `expireNotices` documents.
 *
 * The FIELD, not the DOCUMENT. The event document is the anchor for
 * `weeklyAttendance/{date}`; deleting it would strand names, phone numbers and
 * home addresses with no screen that can ever show them again. That is why
 * `events` is undeletable from the client, and this sweep must not become a way
 * around it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const DELETE_SENTINEL = { __delete__: true };

let updates: Array<{ id: string; data: any }>;
let events: Array<{ id: string; data: any }>;
let queryBound: any;
let getShouldThrow = false;

const db: any = {
    collection: (name: string) => {
        if (name !== 'events') throw new Error(`unexpected collection ${name}`);
        return {
            where: (_field: any, op: string, value: string) => {
                queryBound = { op, value };
                return {
                    get: async () => {
                        if (getShouldThrow) throw new Error('firestore down');
                        return {
                            docs: events.map(e => ({
                                id: e.id,
                                data: () => e.data,
                                ref: { update: async (data: any) => { updates.push({ id: e.id, data }); } },
                            })),
                        };
                    },
                };
            },
        };
    },
};

vi.mock('firebase-admin', () => ({
    firestore: {
        FieldPath: { documentId: () => '__name__' },
        FieldValue: { delete: () => DELETE_SENTINEL },
    },
}));

import { agendaIsPast, clearPastAgendas } from './pastAgendas';

beforeEach(() => {
    updates = [];
    events = [];
    queryBound = undefined;
    getShouldThrow = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('agendaIsPast', () => {
    it('leaves today alone — an agenda lasts its whole day', () => {
        // This is the assertion that fails if the comparison becomes `<=`, or if
        // the caller switches to a UTC date key.
        expect(agendaIsPast({ agenda: 'Kirtan' }, '2026-08-21', '2026-08-21')).toBe(false);
    });

    it('clears yesterday', () => {
        expect(agendaIsPast({ agenda: 'Kirtan' }, '2026-08-20', '2026-08-21')).toBe(true);
    });

    it('leaves a future sabha alone', () => {
        expect(agendaIsPast({ agenda: 'Kirtan' }, '2026-08-28', '2026-08-21')).toBe(false);
    });

    it('ignores an event with no agenda', () => {
        // Nearly every event has agenda: '' — writing to all of them nightly
        // would be a lot of writes for nothing.
        expect(agendaIsPast({}, '2026-08-20', '2026-08-21')).toBe(false);
        expect(agendaIsPast({ agenda: '' }, '2026-08-20', '2026-08-21')).toBe(false);
        expect(agendaIsPast({ agenda: '   \n ' }, '2026-08-20', '2026-08-21')).toBe(false);
    });

    it('ignores a non-string agenda rather than throwing', () => {
        expect(agendaIsPast({ agenda: 42 }, '2026-08-20', '2026-08-21')).toBe(false);
        expect(agendaIsPast({ agenda: null }, '2026-08-20', '2026-08-21')).toBe(false);
    });
});

describe('clearPastAgendas', () => {
    it('deletes the FIELD, never the document', () => {
        // A ref.delete() here would strand the attendance subcollection.
        events = [{ id: '2026-08-14', data: { agenda: 'Old kirtan' } }];
        return clearPastAgendas(db, '2026-08-21').then(count => {
            expect(count).toBe(1);
            expect(updates).toEqual([{ id: '2026-08-14', data: { agenda: DELETE_SENTINEL } }]);
        });
    });

    it('only touches agenda, leaving times, venue and status intact', async () => {
        events = [{ id: '2026-08-14', data: { agenda: 'Old', startTime: '18:00', venue: { lat: 1 } } }];
        await clearPastAgendas(db, '2026-08-21');
        expect(Object.keys(updates[0]!.data)).toEqual(['agenda']);
    });

    it('queries only past documents, so a cleared field cannot be re-read', async () => {
        events = [];
        await clearPastAgendas(db, '2026-08-21');
        expect(queryBound).toEqual({ op: '<', value: '2026-08-21' });
    });

    it('leaves today and the future untouched', async () => {
        // The query bound already excludes these; belt and braces, because the
        // filter is what protects against the bound being loosened.
        events = [
            { id: '2026-08-21', data: { agenda: 'Tonight' } },
            { id: '2026-08-28', data: { agenda: 'Next week' } },
        ];
        expect(await clearPastAgendas(db, '2026-08-21')).toBe(0);
        expect(updates).toEqual([]);
    });

    it('skips past events that have no agenda', async () => {
        events = [
            { id: '2026-08-07', data: { agenda: '' } },
            { id: '2026-08-14', data: { agenda: 'Real one' } },
        ];
        expect(await clearPastAgendas(db, '2026-08-21')).toBe(1);
        expect(updates.map(u => u.id)).toEqual(['2026-08-14']);
    });

    it('caps a run at 200', async () => {
        events = Array.from({ length: 250 }, (_, i) => ({
            id: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
            data: { agenda: 'x' },
        }));
        expect(await clearPastAgendas(db, '2026-08-21')).toBe(200);
        expect(updates.length).toBe(200);
    });

    it('returns 0 instead of throwing when Firestore fails', async () => {
        // It shares the 03:00 slot with the notice sweep and the ride-request
        // sweep. Clearing old text is the least important thing at that hour.
        getShouldThrow = true;
        events = [{ id: '2026-08-14', data: { agenda: 'Old' } }];
        expect(await clearPastAgendas(db, '2026-08-21')).toBe(0);
    });
});
