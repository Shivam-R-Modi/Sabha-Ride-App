/**
 * The agenda helpers.
 *
 * `agendaSummary` exists because the sabha calendar renders one row per sabha and
 * used to interpolate the whole agenda into it (` · ${event.agenda}`). That was
 * harmless while the field was a one-line input and breaks the moment it holds a
 * paragraph.
 */
import { describe, it, expect } from 'vitest';
import { AGENDA_MAX_CHARS, agendaSummary, describeAgendaProblem } from '../../src/utils/agenda';

describe('describeAgendaProblem', () => {
    it('accepts an empty agenda — it is optional', () => {
        expect(describeAgendaProblem('')).toBeNull();
    });

    it('accepts a paragraph with line breaks', () => {
        expect(describeAgendaProblem('Line one\n\nLine two\nLine three')).toBeNull();
    });

    it('accepts text exactly at the ceiling', () => {
        expect(describeAgendaProblem('x'.repeat(AGENDA_MAX_CHARS))).toBeNull();
    });

    it('rejects one character over, and says the actual length', () => {
        const problem = describeAgendaProblem('x'.repeat(AGENDA_MAX_CHARS + 1));
        expect(problem).toContain(String(AGENDA_MAX_CHARS + 1));
    });
});

describe('agendaSummary', () => {
    it('is empty for no agenda', () => {
        expect(agendaSummary('')).toBe('');
        expect(agendaSummary(null)).toBe('');
        expect(agendaSummary(undefined)).toBe('');
    });

    it('is empty for whitespace only, rather than a stray separator', () => {
        // The calendar renders ` · ${summary}`, so a blank-but-truthy value would
        // leave a dangling middot on the row.
        expect(agendaSummary('   \n\n  \n')).toBe('');
    });

    it('returns a short single line unchanged', () => {
        expect(agendaSummary('Youth sabha')).toBe('Youth sabha');
    });

    it('takes the first non-empty line, skipping leading blanks', () => {
        expect(agendaSummary('\n\n  Kirtan evening  \nmore text')).toBe('Kirtan evening …');
    });

    it('marks that more lines follow, even when the first line fits', () => {
        // Without this the row reads as though the agenda is one line long.
        expect(agendaSummary('Short title\nA second paragraph')).toBe('Short title …');
    });

    it('truncates a long first line with an ellipsis', () => {
        const summary = agendaSummary('x'.repeat(100), 20);
        expect(summary).toBe(`${'x'.repeat(20)}…`);
        expect(summary.length).toBe(21);
    });

    it('does not truncate a first line that exactly fits', () => {
        expect(agendaSummary('x'.repeat(20), 20)).toBe('x'.repeat(20));
    });
});
