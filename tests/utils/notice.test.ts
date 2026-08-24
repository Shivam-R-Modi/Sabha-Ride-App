import { describe, it, expect } from 'vitest';
import { NOTICE_TITLE_MAX, noticeHeading } from '../../src/utils/notice';

/**
 * The one line a collapsed notice row shows.
 *
 * The fallback half of this is not hypothetical: two notices were already on the
 * board when `title` landed, and neither can be asked for one retrospectively.
 */
describe('noticeHeading', () => {
    it('uses the title when there is one', () => {
        expect(noticeHeading({ title: 'Sabha this Sunday', body: 'Please arrive by 9.' }))
            .toBe('Sabha this Sunday');
    });

    it('trims the title', () => {
        expect(noticeHeading({ title: '  Sabha this Sunday \n', body: 'x' }))
            .toBe('Sabha this Sunday');
    });

    it('falls back to the first line of the body', () => {
        // The shape the composer's placeholder has always taught, and the shape
        // both production notices are written in.
        expect(noticeHeading({ body: 'Housekeeping\n\nNo password was used…' }))
            .toBe('Housekeeping');
    });

    it('treats a whitespace-only title as absent', () => {
        expect(noticeHeading({ title: '   ', body: 'Housekeeping\n\nmore' }))
            .toBe('Housekeeping');
    });

    it('caps a paragraph-only body, which has no first line to speak of', () => {
        // THE REASON THE CAP EXISTS. A body written as one long paragraph makes
        // the whole body the "first line" — 655 characters in the live case — and
        // a row cannot render that.
        const heading = noticeHeading({ body: 'x'.repeat(400) });
        expect(heading).toHaveLength(NOTICE_TITLE_MAX + 1); // + the ellipsis
        expect(heading.endsWith('…')).toBe(true);
    });

    it('caps an over-long title the same way', () => {
        // The composer refuses one this long, and the rules refuse to store one.
        // This is the third line of defence, for the two documents that predate
        // both.
        expect(noticeHeading({ title: 'y'.repeat(200), body: 'x' }))
            .toHaveLength(NOTICE_TITLE_MAX + 1);
    });

    it('never puts the ellipsis after a space', () => {
        const heading = noticeHeading({ body: `${'word '.repeat(30)}end` });
        expect(heading).not.toMatch(/ …$/);
    });

    it('survives an empty body rather than rendering a nameless row', () => {
        // A row with no text is a control nobody can see or describe. The callable
        // has always refused an empty body, so this is a floor, not a feature.
        expect(noticeHeading({ body: '' })).toBe('Notice');
        expect(noticeHeading({})).toBe('Notice');
    });
});
