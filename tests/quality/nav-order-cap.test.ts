/**
 * The nav-order cap must be the SAME number in both places that hold it.
 *
 * `firestore.rules` cannot import a TypeScript constant, so the limit is written
 * twice: `MAX_NAV_ORDER` in `src/utils/navOrder.ts` and a literal in the `users`
 * block. Same arrangement as `AGENDA_MAX_CHARS` — see
 * tests/quality/agenda-cap.test.ts for the reasoning, which applies verbatim.
 *
 * Drift here is quieter than the agenda case, because the sidebar writes on a
 * DRAG. Raise the TS constant alone and a manager reordering their tabs gets a
 * silent permission error in a console nobody watches, the write never lands, and
 * the order springs back to where it was with no explanation at all.
 *
 * The second block guards the property the whole feature rests on: the stored
 * order decides sequence, never which tabs exist. That is asserted properly in
 * tests/utils/navOrder.test.ts; this only makes sure the sidebar still goes
 * through the function that guarantees it, rather than reading the stored list.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_NAV_ORDER } from '../../src/utils/navOrder';

const ROOT = path.resolve(__dirname, '../..');
const rules = readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const layout = readFileSync(path.join(ROOT, 'components/Layout.tsx'), 'utf8');

describe('the cap is one number', () => {
    it('firestore.rules bounds the list at MAX_NAV_ORDER', () => {
        const bound = rules.match(/list\.size\(\)\s*<=\s*(\d+)/);

        expect(bound).not.toBeNull();
        expect(Number(bound![1])).toBe(MAX_NAV_ORDER);
    });

    it('the rules keep the map to the three roles', () => {
        // A profile field used as a scratch pad is the thing the cap cannot catch.
        expect(rules).toMatch(/navOrder\.keys\(\)\.hasOnly\(\['manager', 'driver', 'student'\]\)/);
    });

    it('the bound is ANDed with the privilege guard, not swapped for it', () => {
        expect(rules).toMatch(/isOwner\(userId\) && !touchesPrivilegeFields\(\) && navOrderWithinLimits\(\)/);
    });
});

describe('the sidebar cannot lose a tab to a stored order', () => {
    it('resolves its list through applyOrder', () => {
        expect(layout).toMatch(/applyOrder\(/);
    });

    it('does not render the stored order directly', () => {
        // The bug this whole design exists to prevent: mapping over the saved ids
        // instead of over the resolved list hides any tab the saved order predates.
        expect(layout).not.toMatch(/navOrder\?\.\[role\]\s*\)?\.map\(/);
        expect(layout).not.toMatch(/stored\.map\(/);
    });

    it('writes the full resolved order rather than the stored fragment', () => {
        // Writing only what was stored would save a two-entry list on the first
        // drag and leave the rest to be appended in an order nobody chose.
        expect(layout).toMatch(/const ids = items\.map\(item => item\.id\)/);
    });
});
