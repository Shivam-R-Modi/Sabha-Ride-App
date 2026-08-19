/**
 * The agenda helpers.
 *
 * `agendaSummary` exists because the sabha calendar renders one row per sabha and
 * used to interpolate the whole agenda into it (` · ${event.agenda}`). That was
 * harmless while the field was a one-line input and breaks the moment it holds a
 * paragraph.
 */
import { describe, it, expect } from 'vitest';
import {
    AGENDA_MAX_CHARS, CARD_LINES, agendaSummary, describeAgendaProblem, isLongForCard,
} from '../../src/utils/agenda';

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

describe('isLongForCard', () => {
    /**
     * The point of this is that a dashboard stays usable. A full-length agenda
     * rendered whole pushes the rider's request button and the Sarthi's "go on
     * shift" off the screen — which is what the first version shipped doing.
     */
    it('leaves a short notice alone', () => {
        expect(isLongForCard('Sabha at 8:30 tonight, Ell Hall.')).toBe(false);
    });

    it('collapses a long flyer', () => {
        expect(isLongForCard('x'.repeat(281))).toBe(true);
    });

    it('collapses text with many short lines, not just many characters', () => {
        // A running order is short per line and long overall — the shape of the
        // real agendas.
        const runningOrder = Array.from({ length: CARD_LINES + 1 }, (_, i) => `${i}:00 item`).join('\n');
        expect(runningOrder.length).toBeLessThan(280);
        expect(isLongForCard(runningOrder)).toBe(true);
    });

    it('leaves exactly CARD_LINES lines alone', () => {
        const fits = Array.from({ length: CARD_LINES }, (_, i) => `${i}:00 item`).join('\n');
        expect(isLongForCard(fits)).toBe(false);
    });

    it('counts blank lines, because they take a line each on screen', () => {
        // Paragraph breaks are what make a flyer tall.
        expect(isLongForCard('a\n\nb\n\nc\n\nd')).toBe(true);
    });

    it('handles an empty string', () => {
        expect(isLongForCard('')).toBe(false);
    });

    it('never collapses something the full-length cap would reject', () => {
        // Sanity on the two limits: everything at the ceiling is collapsible.
        expect(isLongForCard('x'.repeat(AGENDA_MAX_CHARS))).toBe(true);
    });
});
