/**
 * The calendar list is COMPUTED, not stored.
 *
 * This hook used to map `events/{date}` documents straight to rows, because the
 * server materialised one document per occurrence. Now the schedule is a rule and
 * those documents are only exceptions, so the list is derived — and the hazard
 * moves with it.
 *
 * The case worth the most care is a document that predates the rule model. It has
 * no `kind`, so it reads as an override, and an override on a date the rule does
 * not cover is inert. Left unmigrated, a gathering the manager can currently see
 * simply disappears from the calendar. That is asserted here, because it is the
 * reason scripts/migrate-recurrence-to-rule.cjs exists.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

let eventDocs: Array<{ id: string; data: Record<string, unknown> }> = [];
let ruleDoc: Record<string, unknown> | undefined;
const useCurrentEvent = vi.fn();
/** The lower bound the hook actually queried on, so the anchor is assertable. */
let lowerBound: unknown = null;

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('../../hooks/useCurrentEvent', () => ({ useCurrentEvent: () => useCurrentEvent() }));
vi.mock('firebase/firestore', () => ({
    collection: () => ({}),
    doc: () => ({ __rule: true }),
    documentId: () => '__name__',
    orderBy: () => ({}),
    query: () => ({ __events: true }),
    setDoc: vi.fn(),
    where: (_f: unknown, op: string, value: unknown) => {
        if (op === '>=') lowerBound = value;
        return {};
    },
    // One listener factory for both subscriptions: the rule doc is a `doc()` ref,
    // the events list is a `query()`.
    onSnapshot: (ref: any, next: any) => {
        if (ref?.__rule) next({ data: () => ruleDoc });
        else next({ docs: eventDocs.map(d => ({ id: d.id, data: () => d.data })) });
        return () => undefined;
    },
}));

import { useUpcomingEvents } from '../../hooks/useEvents';

/** Anchor every case on a fixed Monday so weekday maths is readable. */
const FROM = '2026-08-17';

beforeEach(() => {
    vi.clearAllMocks();
    eventDocs = [];
    lowerBound = null;
    ruleDoc = { enabled: true, daysOfWeek: [5], startTime: '19:30', endTime: '22:00' };
    useCurrentEvent.mockReturnValue({ eventId: FROM });
});

const dates = (events: Array<{ date: string }>) => events.map(e => e.date);

describe('useUpcomingEvents', () => {
    it('lists occurrences from the rule with no documents at all', async () => {
        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(dates(result.current.events))
            .toEqual(['2026-08-21', '2026-08-28', '2026-09-04', '2026-09-11']);
        expect(result.current.events.every(e => e.source === 'rule')).toBe(true);
    });

    it('shows nothing, rather than guessing, when no rule is stored', async () => {
        ruleDoc = undefined;

        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.events).toEqual([]);
        expect(result.current.rule).toBeNull();
    });

    it('marks an edited week and leaves the others alone', async () => {
        eventDocs = [{
            id: '2026-08-28',
            data: { kind: 'override', status: 'scheduled', startTime: '17:00', endTime: '19:00' },
        }];

        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        const edited = result.current.events.find(e => e.date === '2026-08-28')!;
        expect(edited).toMatchObject({ startTime: '17:00', source: 'override' });
        for (const other of result.current.events.filter(e => e.date !== '2026-08-28')) {
            expect(other).toMatchObject({ startTime: '19:30', source: 'rule' });
        }
    });

    it('drops a cancelled week and keeps the rest', async () => {
        eventDocs = [{ id: '2026-08-28', data: { status: 'cancelled' } }];

        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(dates(result.current.events)).not.toContain('2026-08-28');
        expect(dates(result.current.events)).toContain('2026-08-21');
    });

    it('shows a one-off on a day the rule never covers', async () => {
        eventDocs = [{
            id: '2026-08-19',
            data: { kind: 'one-off', status: 'scheduled', startTime: '18:00', endTime: '20:00' },
        }];

        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.events[0]).toMatchObject({
            date: '2026-08-19', source: 'one-off', startTime: '18:00',
        });
    });

    it('an UNMIGRATED document off the pattern VANISHES — why the migration exists', async () => {
        // A Wednesday gathering with no `kind`, written before the rule model. It
        // reads as an override, and an override off the pattern is inert. This is
        // exactly what scripts/migrate-recurrence-to-rule.cjs stamps as a one-off,
        // and the dry run against production found one.
        eventDocs = [{
            id: '2026-08-19',
            data: { status: 'scheduled', startTime: '18:00', endTime: '20:00' },
        }];

        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(dates(result.current.events)).not.toContain('2026-08-19');
    });

    it('the same document stamped one-off appears again', async () => {
        // The migration's whole job, stated as the other half of the pair above.
        eventDocs = [{
            id: '2026-08-19',
            data: { kind: 'one-off', status: 'scheduled', startTime: '18:00', endTime: '20:00' },
        }];

        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(dates(result.current.events)).toContain('2026-08-19');
    });

    it('honours the limit', async () => {
        const { result } = renderHook(() => useUpcomingEvents(2));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.events).toHaveLength(2);
    });

    it('anchors on the server-published event, not the device clock', async () => {
        // A UTC lower bound made today's sabha vanish from the calendar during the
        // sabha itself: at 20:30 in Boston it is already tomorrow in UTC.
        useCurrentEvent.mockReturnValue({ eventId: '2026-08-21' });

        const { result } = renderHook(() => useUpcomingEvents(2));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.events[0]!.date).toBe('2026-08-21');
    });
});

/**
 * The anchor is the event id's DATE, not the event id.
 *
 * With two halls a current gathering can be `2026-08-21__somerville`, and
 * `'2026-08-21' >= '2026-08-21__somerville'` is false. Anchoring on the id itself
 * therefore reproduces the defect this hook's header was written about — today's
 * gathering vanishing from the calendar during the sabha — by a different route, and
 * the row a manager would reach for to change it is the row that is gone.
 */
describe('useUpcomingEvents — anchored on a suffixed event id', () => {
    const SUFFIXED = '2026-08-21__somerville';

    it('still lists the gathering happening right now', async () => {
        useCurrentEvent.mockReturnValue({ eventId: SUFFIXED });

        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(dates(result.current.events)).toContain('2026-08-21');
    });

    it('queries from the bare date, so the evening\'s own document is in range', async () => {
        useCurrentEvent.mockReturnValue({ eventId: SUFFIXED });

        const { result } = renderHook(() => useUpcomingEvents(4));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(lowerBound).toBe('2026-08-21');
    });

    it('falls back to the device date when there is no current gathering', async () => {
        // Not a suffixed-id case, but it shares the line: dateKeyOfEventId returns null
        // for null, and a null lower bound would query the entire collection.
        useCurrentEvent.mockReturnValue({ eventId: null });

        const { result } = renderHook(() => useUpcomingEvents(4));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(lowerBound).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

/**
 * What each hall says on top of an evening.
 *
 * The hook already reads every document in the range, so a hall's exception is one it
 * has in hand — resolving them costs no read and it is the only way the manager's
 * calendar can SHOW a hall that diverges. It ignored them until something could write
 * one.
 */
describe('useUpcomingEvents — hallOverrides', () => {
    const EVE = { kind: 'override', status: 'scheduled', startTime: '18:00', endTime: '20:00' };

    it('is empty when no hall has a document, which is the ordinary case', async () => {
        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.events[0].hallOverrides).toEqual({});
    });

    it('resolves a hall\'s own times, keyed by the hall', async () => {
        eventDocs = [{ id: '2026-08-21__somerville', data: EVE }];

        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        const row = result.current.events.find(e => e.date === '2026-08-21')!;
        expect(row.startTime).toBe('19:30');                       // the evening is untouched
        expect(row.hallOverrides.somerville!.startTime).toBe('18:00');
        expect(row.hallOverrides.somerville!.source).toBe('hall-override');
    });

    it('DOES NOT file the evening\'s own exception as the founding hall\'s', async () => {
        /**
         * `parseEventId` resolves a bare date to the founding hall — right for a ride,
         * wrong here. The evening's edit would show up as that one room diverging, so
         * the calendar would draw a "Changed" badge against Huntington on an evening
         * where nothing about Huntington differs, and an Edit button that writes a
         * document nobody asked for. `parseExceptionId` returns a null hall for a bare
         * id, which is what this asserts.
         */
        eventDocs = [{ id: '2026-08-21', data: EVE }];

        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        const row = result.current.events.find(e => e.date === '2026-08-21')!;
        expect(row.startTime).toBe('18:00');       // applied to the EVENING
        expect(row.hallOverrides).toEqual({});     // and to no hall in particular
    });

    it('carries a hall CANCELLATION through as null', async () => {
        // A real answer, not an absence. The calendar draws it as "Cancelled"; treating
        // it as missing would fall back to the evening and reopen a room the manager
        // had shut.
        eventDocs = [{ id: '2026-08-21__somerville', data: { status: 'cancelled' } }];

        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        const row = result.current.events.find(e => e.date === '2026-08-21')!;
        expect(row.hallOverrides).toHaveProperty('somerville');
        expect(row.hallOverrides.somerville).toBeNull();
    });

    it('keeps one date\'s hall documents off another date\'s row', async () => {
        eventDocs = [{ id: '2026-08-28__somerville', data: EVE }];

        const { result } = renderHook(() => useUpcomingEvents(4));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.events.find(e => e.date === '2026-08-21')!.hallOverrides)
            .toEqual({});
        expect(result.current.events.find(e => e.date === '2026-08-28')!.hallOverrides)
            .toHaveProperty('somerville');
    });
});
