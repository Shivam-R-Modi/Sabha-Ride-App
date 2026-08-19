/**
 * Header actions must not be squeezed until their LABEL wraps.
 *
 * Reported from an iPhone: "Add Vehicle" and "Download CSV" were each broken
 * across two lines, sitting beside titles that were also broken across two
 * lines, and the whole header read as noise.
 *
 * The cause is a flex default, not a size choice. In `justify-between` a flex
 * child will not shrink below its own content — but its content is text, and
 * text's minimum is one WORD, not one line. So the button happily narrowed to
 * the width of "Download" and wrapped "CSV" underneath. The title is what
 * should give way; the control should keep its shape.
 *
 * Measured in a browser at the real widths, against the real stylesheet:
 *
 *   Fleet header (345px)       "Add Vehicle"   2 lines -> 1
 *   Weekly card  (297px)       "Download CSV"  2 lines -> 1
 *
 * 297px, not 345px, for the card: the page has `p-6` and the card inside it has
 * `p-6` again. Measuring at the page width said "nothing wraps" and was wrong.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/**
 * The className of the `<button>` whose body contains `label`.
 *
 * Each chunk is cut at `</button>` so a label appearing AFTER a button cannot
 * be attributed to it.
 */
function buttonClasses(source: string, label: string): string {
    const chunk = source
        .split('<button')
        .slice(1)
        .map(part => part.split('</button>')[0]!)
        .find(part => part.includes(label));

    if (chunk === undefined) throw new Error(`no <button> containing "${label}" — did the label change?`);

    const match = chunk.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
    return match ? (match[1] ?? match[2] ?? '') : '';
}

/** Action buttons that share a header row with a heading. */
const HEADER_ACTIONS: Array<[file: string, label: string]> = [
    ['components/manager/FleetManagement.tsx', 'Add Vehicle'],
    ['components/manager/ManagerReports.tsx', 'Download CSV'],
    ['components/manager/ManagerReports.tsx', 'Refresh'],
];

describe('header actions keep their shape', () => {
    for (const [file, label] of HEADER_ACTIONS) {
        it(`"${label}" cannot be squeezed until it wraps`, () => {
            const classes = buttonClasses(read(file), label);

            expect(classes, `${file}: "${label}" needs shrink-0`).toMatch(/\bshrink-0\b/);
            expect(classes, `${file}: "${label}" needs whitespace-nowrap`).toMatch(/\bwhitespace-nowrap\b/);
        });
    }

    it('the label lookup really finds a button — this test cannot pass vacuously', () => {
        // The recurring failure in this repo's quality tests is a matcher that
        // matches nothing and reports success. Absent labels must THROW.
        expect(() => buttonClasses(read('components/manager/FleetManagement.tsx'), 'No Such Button'))
            .toThrow(/no <button>/);
    });
});

describe('text that must not be broken up', () => {
    it('the week ending date stays on one line', () => {
        // It was breaking at its own hyphens — "Week ending 2026-08-" / "21",
        // which reads as two different dates until you look twice. Only the
        // date is held together; the words before it may still wrap.
        const source = read('components/manager/ManagerReports.tsx');

        expect(source).toMatch(/Week ending <span className="whitespace-nowrap">/);
    });
});

describe('the day chips sit on an even grid', () => {
    it('is a 4-wide grid, not a ragged wrap', () => {
        // Seven chips sized to their own labels wrapped 5 + 2 at widths from
        // 44px to 54px. A 4-wide grid gives 4 + 3, every chip 68px.
        //
        // Not 7-across: `min-w-11` fights a 7-column track at 297px and the
        // measured result was SEVEN rows, one chip each.
        const source = read('components/manager/RecurringSabha.tsx');

        expect(source).toMatch(/grid grid-cols-4 gap-2 mb-4/);
        expect(source, 'the ragged flex-wrap is back').not.toMatch(/flex flex-wrap gap-2 mb-4/);
    });
});
