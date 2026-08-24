/**
 * The overlay invariants of `components/shared/Sheet.tsx`.
 *
 * Every one of these was a real defect found by opening one dialog at 375x812,
 * and none of them is visible to a jsdom render test: Tailwind is not compiled in
 * tests, so nothing there can see a fill, a margin, a padding or a stacking
 * context. `tests/setup.ts` also bans class-name assertions from component tests,
 * which is why these live here. The two BEHAVIOURAL halves are asserted properly
 * in tests/components/Sheet.test.tsx and UserDetailSheet.test.tsx.
 *
 * 1. The title is hidden with `sr-only`, never dropped. It is what
 *    `aria-labelledby` points at, so removing it leaves a `role="dialog"` with no
 *    accessible name — announced as bare "dialog", and invisible to everyone who
 *    does not use a screen reader.
 *
 * 2. The close button carries `ml-auto`. An `sr-only` title is
 *    `position: absolute`, so the header row keeps only ONE in-flow child, and
 *    `justify-between` sends a lone child to the START. Without `ml-auto` the
 *    close X sits at the top LEFT of every hidden-title sheet.
 *
 * 3. The overlay declares its padding ONCE per variant. It used to carry a base
 *    `p-4` AND a `p-0` in the docked branch. Both are unprefixed utilities of
 *    equal specificity, so which wins is decided by Tailwind's OUTPUT order, not
 *    by the order they appear in the class string — and `p-4` won, making the
 *    `p-0` dead. A bottom sheet meant to sit flush had 16px gutters and a 16px
 *    gap under it while still being rounded on the top corners only.
 *
 * 4. The overlay is PORTALLED to document.body. Rendering in place made it a
 *    child of whichever component opened it, and fifteen of those are `space-y-*`
 *    containers: `.space-y-6 > :not([hidden]) ~ :not([hidden])` put
 *    `margin-top: 1.5rem` on a `position: fixed` element. Measured at 375x812 the
 *    overlay reported `top: 24px, height: 788px` against `inset-0`, so the scrim
 *    left the top 24px of the screen undimmed and docked sheets sat 24px low.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (p: string) => readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

/** Comments stripped, so the prose explaining a rule cannot satisfy it. */
const strip = (s: string) => s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const sheet = strip(read('components/shared/Sheet.tsx'));
const detail = strip(read('components/manager/UserDetailSheet.tsx'));

/** The one template literal that builds the overlay's classes. */
const overlayClasses = (() => {
    const m = sheet.match(/className=\{`fixed inset-0 z-modal[\s\S]*?`\}/);
    if (!m) throw new Error('could not find the overlay className in Sheet.tsx');
    return m[0];
})();

describe('Sheet keeps its accessible name when the title is hidden', () => {
    it('renders the title sr-only rather than dropping the element', () => {
        expect(sheet).toMatch(/hideTitle \? 'sr-only' : ''/);
    });

    it('still points aria-labelledby at that title', () => {
        expect(sheet).toContain('aria-labelledby={titleId}');
        expect(sheet).toMatch(/id=\{titleId\}/);
    });

    it('keeps the close button right-aligned with ml-auto', () => {
        const i = sheet.indexOf('aria-label="Close"');
        expect(sheet.slice(i, i + 400)).toContain('ml-auto');
    });
});

describe('Sheet declares its overlay padding once per variant', () => {
    it('has no unprefixed padding on the shared part of the class list', () => {
        // A base `p-*` here silently outranks or is outranked by the branch's own,
        // depending only on Tailwind's emit order.
        const shared = overlayClasses.split('${')[0]!;
        expect(shared).not.toMatch(/\bp-\d/);
    });

    it('gives the docked variant p-0 on mobile and p-4 from sm up', () => {
        expect(overlayClasses).toMatch(/items-end p-0 sm:items-center sm:p-4/);
    });

    it('does not declare p-0 and p-4 as competing unprefixed utilities', () => {
        const unprefixed = (overlayClasses.match(/(?<!:)\bp-\d\b/g) ?? []);
        // Exactly two: `p-0` for docked, `p-4` for the centred dialog — and they
        // are in different branches of the ternary, never both applied at once.
        expect(unprefixed.sort()).toEqual(['p-0', 'p-4']);
        expect(overlayClasses).toMatch(/'items-center p-4'/);
    });
});

describe('Sheet renders through a portal', () => {
    it('portals to document.body', () => {
        expect(sheet).toContain("import { createPortal } from 'react-dom'");
        expect(sheet).toMatch(/return createPortal\(/);
        expect(sheet).toMatch(/\), document\.body\);/);
    });
});

describe('UserDetailSheet does not print the name twice', () => {
    it('hides the Sheet title, because the body already leads with the name', () => {
        expect(detail).toMatch(/\bhideTitle\b/);
    });

    it('still passes the name AS the title, so the dialog stays named', () => {
        expect(detail).toMatch(/title=\{name\}/);
    });
});
