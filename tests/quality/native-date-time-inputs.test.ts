/**
 * Native `<input type="time">` on iOS, which does not behave like the one on
 * the machine this is written on.
 *
 * Reported TWICE from a phone: the Setup screen's `Default Start` / `Default
 * End` pair looked cut off. The first attempt added `min-w-0` to the grid cells
 * — the textbook fix for a grid child refusing to shrink — and it changed
 * nothing, because it was aimed at the wrong thing.
 *
 * WHY IT COULD NOT BE FOUND HERE: Chromium's time control shrinks happily, down
 * to a 200px container and past it. Measured before and after, at 326/240/200px,
 * `min-w-0` was an exact no-op. The desktop engine simply does not have the
 * bug, so no amount of measuring here would have shown it.
 *
 * So this stopped being a diagnosis and became two things at once:
 *
 *   1. Fix the mechanism. WebKit's widget claims its own width and centres its
 *      value with margins; `appearance:none` plus a normalised
 *      `::-webkit-date-and-time-value` takes both away.
 *   2. Remove the constraint. The two-up rows stack on phones, so each control
 *      gets the full card width and there is nothing left to overflow — true
 *      whatever the widget decides it wants.
 *
 * (2) is the part that does not depend on being right about (1).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** Every two-up row that holds a pair of time inputs. */
const STACKING_ROWS: Array<[file: string, row: string]> = [
    ['components/manager/LocationSettings.tsx', 'grid grid-cols-1 sm:grid-cols-2 gap-3'],
    ['components/manager/RecurringSabha.tsx', 'grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4'],
    ['components/manager/SabhaCalendar.tsx', 'grid grid-cols-1 sm:grid-cols-2 gap-2'],
];

describe('the WebKit widget is normalised', () => {
    const css = read('index.css');

    it('drops the native widget, which is what claims the width', () => {
        expect(css).toMatch(/input\[type="time"\][\s\S]{0,160}appearance: none/);
    });

    it('covers date and datetime-local too, not just time', () => {
        // SabhaCalendar has a date input, and it is in the same narrow cards.
        for (const type of ['time', 'date', 'datetime-local']) {
            expect(css, `${type} is not normalised`).toContain(`input[type="${type}"]`);
        }
    });

    it('left-aligns the value and takes its margins off', () => {
        // It is centred with its own margins by default, which is how the text
        // ends up outside the box it was given.
        expect(css).toMatch(/::-webkit-date-and-time-value[\s\S]{0,120}text-align: left/);
        expect(css).toMatch(/::-webkit-date-and-time-value[\s\S]{0,120}margin: 0/);
    });

    it('does NOT hide the calendar picker indicator', () => {
        // Over-reaching here would remove the only affordance on desktop.
        // Verified in a browser: it still computes to inline-block.
        expect(css).not.toMatch(/::-webkit-calendar-picker-indicator[\s\S]{0,120}display: none/);
    });
});

describe('two-up time rows stack on a phone', () => {
    for (const [file, row] of STACKING_ROWS) {
        it(`${file.split('/').pop()} gives each control the full width below sm`, () => {
            expect(read(file)).toContain(row);
        });
    }

    it('no time row is left on a bare two-column grid', () => {
        // The failure mode being locked out: a `grid-cols-2` with no `sm:` in
        // front of it, in a file that holds time inputs — which is what every
        // one of these rows was before.
        for (const [file] of STACKING_ROWS) {
            const bare = [...read(file).matchAll(/(\S*)grid-cols-2/g)]
                .filter(match => match[1] !== 'sm:')
                .map(match => match[0]);

            expect(bare, `${file} still has a phone-width two-column grid`).toEqual([]);
        }
    });
});
