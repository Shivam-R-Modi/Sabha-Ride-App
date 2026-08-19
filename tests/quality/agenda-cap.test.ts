/**
 * The agenda ceiling must be the SAME number in both places that hold it.
 *
 * `firestore.rules` cannot import a TypeScript constant, so the limit is written
 * twice: `AGENDA_MAX_CHARS` in `src/utils/agenda.ts` and a literal in the `events`
 * block. The two enforce different things and only one of them matters —
 * `editOccurrence` and `createOneOff` write `events/{date}` directly from the
 * browser, so the rules copy is the real boundary and the TS copy only produces
 * the message.
 *
 * Drift is therefore silent in the worse direction: raise the TS constant alone
 * and the composer cheerfully accepts text that Firestore then rejects, with the
 * manager's typing lost behind a raw permission error.
 *
 * The owner's standing instruction is "no parity so no future problems". This is
 * that check, in the same spirit as tests/quality/audit-collection.test.ts.
 *
 * The second block below guards the other consequence of widening the field: the
 * sabha calendar renders one row per sabha and used to interpolate the whole
 * agenda into it. There is no SabhaCalendar test harness to assert that through
 * the DOM, and standing one up would mean mocking useAuth, useUpcomingEvents,
 * useSettings, useConfirm, AddressAutocomplete and the callables for a single
 * assertion — so this is textual, like tests/quality/mobile-header-actions.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AGENDA_MAX_CHARS } from '../../src/utils/agenda';

const ROOT = path.resolve(__dirname, '../..');
const rules = readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

describe('the agenda ceiling has one value', () => {
    it('firestore.rules caps agenda at exactly AGENDA_MAX_CHARS', () => {
        const match = rules.match(/agenda\.size\(\)\s*<=\s*(\d+)/);
        expect(match, 'No `agenda.size() <= N` found in firestore.rules — the cap is the only thing enforcing this, since the client writes events/{date} directly.').not.toBeNull();
        expect(Number(match![1])).toBe(AGENDA_MAX_CHARS);
    });

    it('the rule tolerates a write that does not mention agenda', () => {
        // Editing only the times sends a merge without `agenda`. Requiring the
        // field would make every such edit fail.
        expect(rules).toMatch(/!\('agenda' in request\.resource\.data\)/);
    });

    it('the rule checks the type as well as the length', () => {
        // `size()` on a non-string errors, and an errored condition denies — but
        // relying on that makes the denial a side effect rather than the rule.
        expect(rules).toMatch(/request\.resource\.data\.agenda is string/);
    });

    it('both event write paths are guarded, not just create', () => {
        expect(rules).toMatch(/allow create: if isManager\(\) && agendaWithinLimit\(\)/);
        expect(rules).toMatch(/allow update: if isManager\(\) && agendaWithinLimit\(\)/);
    });
});

describe('the calendar row summarises the agenda instead of inlining it', () => {
    const calendar = readFileSync(
        path.join(ROOT, 'components/manager/SabhaCalendar.tsx'), 'utf8',
    );

    /** Comments stripped, so prose naming a pattern is not mistaken for code. */
    const code = calendar
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    it('never interpolates a raw event.agenda into the row', () => {
        // `· ${event.agenda}` was fine while the field was a one-line input. With
        // a paragraph in it, the times and venue get pushed off the card.
        expect(code).not.toMatch(/\$\{event\.agenda\}/);
    });

    it('uses agendaSummary for the row', () => {
        expect(code).toMatch(/agendaSummary\(event\.agenda\)/);
    });

    it('gives the manager a textarea, not a single-line input', () => {
        // Two of them: editing an occurrence, and adding a one-off. A paragraph
        // field that is still `type="text"` cannot hold line breaks at all.
        expect(code.match(/<textarea/g) ?? []).toHaveLength(2);
        expect(code).not.toMatch(/type="text" value=\{agenda\}/);
    });
});
