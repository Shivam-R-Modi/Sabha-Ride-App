/**
 * Editing a date must not change WHAT KIND of date it is.
 *
 * THE BUG, AND WHAT IT COST
 * ------------------------
 * `editOccurrence` used to hardcode `kind: 'override'`. An override on a date the
 * weekly rule does NOT cover is deliberately inert — that is the mechanism that
 * lets a manager switch the rule off without stray gatherings reappearing. So
 * editing a ONE-OFF converted it to an override and made it vanish.
 *
 * Observed in production on 2026-08-17: a manager changed the end time of that
 * evening's Monday gathering. The app rolled forward to the following Friday, with
 * two riders already marked `at_sabha` against a gathering that was no longer
 * current. Four minutes, and nothing on any screen said so.
 *
 * The whole file exists for the first test below. The read side was already
 * covered — `useUpcomingEvents` has cases proving a one-off document stays visible
 * and an off-pattern override goes inert — but nothing checked that the EDITOR
 * writes the right one of the two.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const writes: Array<{ path: string; data: any }> = [];

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('../../hooks/useCurrentEvent', () => ({ useCurrentEvent: () => ({ eventId: null }) }));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    setDoc: async (ref: any, data: any) => { writes.push({ path: ref.path, data }); },
    collection: () => ({}),
    documentId: () => '__name__',
    onSnapshot: () => () => undefined,
    orderBy: () => ({}),
    query: () => ({}),
    where: () => ({}),
}));

import { editOccurrence, createOneOff } from '../../hooks/useEvents';

const VALUES = { startTime: '23:00', endTime: '23:45', agenda: '', venue: null };
const written = () => writes[0]!.data;

beforeEach(() => { writes.length = 0; });

describe('editOccurrence — the kind survives the edit', () => {
    it('a ONE-OFF stays a one-off', async () => {
        // The production failure, as a test. Writing 'override' here is what made
        // a Monday gathering disappear against a Friday rule.
        await editOccurrence('2026-08-17', VALUES, 'mgr_1', 'one-off');

        expect(written().kind).toBe('one-off');
    });

    it('a rule occurrence becomes an override', async () => {
        // Editing one Friday detaches that Friday only — the rule and every other
        // week are untouched.
        await editOccurrence('2026-08-21', VALUES, 'mgr_1', 'rule');

        expect(written().kind).toBe('override');
    });

    it('an existing override stays an override', async () => {
        await editOccurrence('2026-08-21', VALUES, 'mgr_1', 'override');

        expect(written().kind).toBe('override');
    });

    it('the source is REQUIRED, not defaulted', async () => {
        // A default is exactly what silently deleted a gathering. The signature
        // takes four arguments so a caller cannot forget the fourth.
        expect(editOccurrence.length).toBe(4);
    });
});

describe('editOccurrence — what else it writes', () => {
    it('stores a full snapshot, so the date keeps its own times', async () => {
        await editOccurrence('2026-08-17', VALUES, 'mgr_1', 'one-off');

        expect(written()).toMatchObject({
            date: '2026-08-17',
            status: 'scheduled',
            startTime: '23:00',
            endTime: '23:45',
            updatedBy: 'mgr_1',
        });
    });

    it('writes only the one date, never the rule', async () => {
        // Editing a week must not touch settings/sabhaRecurrence. That is the
        // owner's requirement — one week diverging leaves the rest alone.
        await editOccurrence('2026-08-17', VALUES, 'mgr_1', 'one-off');

        expect(writes).toHaveLength(1);
        expect(writes[0]!.path).toBe('events/2026-08-17');
    });

    it('clears a venue to null rather than writing a coordinate-less address', async () => {
        // An address with no lat/lng poisons routing, so "use the default" is null.
        await editOccurrence('2026-08-17', { ...VALUES, venue: null }, 'mgr_1', 'rule');

        expect(written().venue).toBeNull();
    });
});

describe('createOneOff', () => {
    it('marks a deliberate extra date as a one-off, not an override', async () => {
        // An override on a date the rule does not cover is inert, which is correct
        // for an edited week and wrong for a date somebody meant to add.
        await createOneOff('2026-08-19', '18:00', '20:00', '', 'mgr_1');

        expect(written().kind).toBe('one-off');
        expect(written().status).toBe('scheduled');
    });

    it('re-adding a cancelled date brings it back', async () => {
        // The only escape from a cancellation, since cancelling writes a document
        // rather than deleting one.
        await createOneOff('2026-09-18', '19:30', '22:00', '', 'mgr_1');

        expect(written().status).toBe('scheduled');
    });
});
