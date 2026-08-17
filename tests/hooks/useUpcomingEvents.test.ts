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

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('../../hooks/useCurrentEvent', () => ({ useCurrentEvent: () => useCurrentEvent() }));
vi.mock('firebase/firestore', () => ({
    collection: () => ({}),
    doc: () => ({ __rule: true }),
    documentId: () => '__name__',
    orderBy: () => ({}),
    query: () => ({ __events: true }),
    setDoc: vi.fn(),
    where: () => ({}),
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
