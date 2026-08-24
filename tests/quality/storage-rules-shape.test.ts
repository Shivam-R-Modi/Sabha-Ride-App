/**
 * `storage.rules` must never grant a bare `allow write` on notice images.
 *
 * This guard exists because NO behavioural test can replace it, which is worth
 * spelling out.
 *
 * In Storage rules `write` expands to create, update AND delete, and allow
 * statements are OR'd — a later `allow delete: if false` cannot take back what an
 * earlier `allow write` gave. So `allow write` beside `allow delete: if false`
 * reads as "managers may not delete" and means the opposite.
 *
 * The reason it is not caught by the emulator suite: with `allow write`, a
 * manager's direct delete STILL fails, because the condition calls
 * isReasonableImage(), which reads `request.resource.size` — and
 * `request.resource` is null on a delete, so the condition errors and the engine
 * denies. Verified by making the change and watching all 16 storage rules tests
 * keep passing. The denial is real but it is a side effect of an unrelated null,
 * not of the line that claims to forbid it. Add one image-independent clause to
 * that condition and the hole opens silently.
 *
 * Textual on purpose: the property being protected is which METHODS the grant
 * names, and that is invisible to a rules evaluation that can only ever see a
 * null request.resource on the operation in question.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const rules = readFileSync(path.resolve(__dirname, '../../storage.rules'), 'utf8');

/** Strip comments, so prose about `allow write` is not mistaken for a grant. */
const code = rules
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('storage.rules grants delete to nobody', () => {
    it('never uses a bare `allow write`', () => {
        const offenders = code
            .split('\n')
            .map((line, i) => ({ line: line.trim(), n: i + 1 }))
            .filter(({ line }) => /^allow\s+write\b/.test(line));

        expect(offenders, [
            'A bare `allow write` includes delete, and allow rules are OR\'d, so',
            '`allow delete: if false` below it is decoration. Name the methods:',
            '`allow create, update:`.',
        ].join(' ')).toEqual([]);
    });

    it('still spells out create and update for notice images', () => {
        // If this stops matching, the grant was rewritten and the guard above may
        // be checking a rule that no longer exists. Loosened from naming
        // isApprovedManager() specifically to naming the two METHODS, which is what
        // this file is actually about: the grant now reads
        // `(isManagerToken() || isApprovedManager())` because the cross-service
        // document read needs an IAM grant a CLI deploy does not create. Which
        // predicates guard it is pinned in role-table-parity.test.ts.
        expect(code).toMatch(/allow\s+create,\s*update:\s*if\s/);
        expect(code).toMatch(/isReasonableImage\(\)/);
    });

    it('keeps an explicit delete denial and a catch-all', () => {
        expect(code).toMatch(/allow\s+delete:\s*if\s+false;/);
        expect(code).toMatch(/allow\s+read,\s*write:\s*if\s+false;/);
    });
});
