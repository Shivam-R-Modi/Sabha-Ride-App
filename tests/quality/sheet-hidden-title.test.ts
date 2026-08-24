/**
 * Hiding a dialog's title must not take its NAME with it, or move the close button.
 *
 * `UserDetailSheet` showed the person's name twice — once as the Sheet's heading,
 * once beside the avatar as the first thing in the body. Reported from a
 * screenshot with a box drawn round the duplicate.
 *
 * The obvious fix is the wrong one. That heading is what `aria-labelledby` points
 * at, so deleting it leaves a `role="dialog"` with no accessible name at all —
 * a screen reader announces "dialog" and nothing else, and the loss is invisible
 * to anyone who does not use one. `Sheet` already had `hideTitle` for exactly
 * this: the heading stays in the DOM as `sr-only`, announced and not drawn.
 *
 * And hiding it exposed a latent bug in Sheet itself, which this file also pins.
 * `sr-only` is `position: absolute`, so the header row loses one of its two
 * in-flow children — and `justify-between` puts a LONE child at the start, which
 * slid the close button to the top LEFT. `ml-auto` on the button fixes it, and is
 * a no-op whenever the title is visible. UserDetailSheet was the first caller ever
 * to pass `hideTitle`, so nothing had exercised that path before.
 *
 * Textual, like records-tab-stability: jsdom computes no Tailwind, so a render test
 * cannot see `position: absolute` or a margin, and tests/setup.ts bans class-name
 * assertions from component tests. The accessible-name half IS behavioural and is
 * asserted in tests/components/UserDetailSheet.test.tsx instead.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (p: string) => readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

const sheet = read('components/shared/Sheet.tsx');
const detail = read('components/manager/UserDetailSheet.tsx');

/** Comments stripped, so the prose explaining a rule cannot satisfy it. */
const strip = (s: string) => s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('Sheet keeps its accessible name when the title is hidden', () => {
    it('renders the title sr-only rather than dropping the element', () => {
        // If this becomes `hideTitle ? null : <h2>` the dialog loses its name.
        expect(strip(sheet)).toMatch(/hideTitle \? 'sr-only' : ''/);
    });

    it('still points aria-labelledby at that title', () => {
        expect(strip(sheet)).toContain('aria-labelledby={titleId}');
        expect(strip(sheet)).toMatch(/id=\{titleId\}/);
    });

    it('keeps the close button right-aligned with ml-auto', () => {
        // Not redundant with justify-between: an sr-only title is out of flow, so
        // the row has ONE in-flow child and justify-between sends it to the start.
        // Removing this puts the close X at the top left of every hidden-title
        // sheet.
        const closeButton = strip(sheet).slice(
            strip(sheet).indexOf('aria-label="Close"'),
            strip(sheet).indexOf('aria-label="Close"') + 400,
        );
        expect(closeButton).toContain('ml-auto');
    });
});

describe('UserDetailSheet does not print the name twice', () => {
    it('hides the Sheet title, because the body already leads with the name', () => {
        expect(strip(detail)).toMatch(/\bhideTitle\b/);
    });

    it('still passes the name AS the title, so the dialog stays named', () => {
        // `hideTitle` without `title` would be an unnamed dialog, which is the
        // failure this whole file exists to prevent.
        expect(strip(detail)).toMatch(/title=\{name\}/);
    });
});
