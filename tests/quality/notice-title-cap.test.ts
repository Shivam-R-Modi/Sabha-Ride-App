/**
 * The notice title's ceiling must be the SAME number in all three places that
 * hold it.
 *
 * `firestore.rules` cannot import a TypeScript constant and neither can the
 * callable import the client's, so 80 is written three times: `NOTICE_TITLE_MAX`
 * in `src/utils/notice.ts`, `MAX_TITLE` in `functions/src/http/publishNotice.ts`,
 * and a literal in the `notices` block. Same arrangement as `MAX_FEEDBACK` and
 * `AGENDA_MAX_CHARS` — see tests/quality/feedback-cap.test.ts for the reasoning,
 * which applies verbatim.
 *
 * Drift is silent in the worse direction. Raise the client constant alone and the
 * composer cheerfully accepts a title the callable then refuses, so a manager
 * writes a notice and loses it behind an error naming a limit the form never
 * showed. Raise the callable alone and Firestore refuses the write AFTER the audit
 * row claims it published.
 *
 * The second block pins the one asymmetry on purpose: the callable REQUIRES a
 * title and the rules only constrain its shape. Requiring it in the rules would
 * make the two notices that predate the field — 2026-08-24 — impossible to update
 * from any client, including to correct them.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NOTICE_TITLE_MAX } from '../../src/utils/notice';

const ROOT = path.resolve(__dirname, '../..');
const rules = readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const callable = readFileSync(path.join(ROOT, 'functions/src/http/publishNotice.ts'), 'utf8');

/** Just the notices block, so a match cannot come from a neighbouring rule. */
const noticesBlock = (() => {
    const start = rules.indexOf('match /notices/{noticeId}');
    expect(start).toBeGreaterThan(-1);
    return rules.slice(start, rules.indexOf('match /', start + 10));
})();

describe('the title cap is one number', () => {
    it('firestore.rules bounds the title at NOTICE_TITLE_MAX', () => {
        const bound = noticesBlock.match(/title\.size\(\)\s*<=\s*(\d+)/);

        expect(bound, 'the notices block stopped bounding the title').not.toBeNull();
        expect(Number(bound![1])).toBe(NOTICE_TITLE_MAX);
    });

    it('the callable caps it at the same number', () => {
        const bound = callable.match(/const MAX_TITLE = (\d+);/);

        expect(bound, 'publishNotice stopped declaring MAX_TITLE').not.toBeNull();
        expect(Number(bound![1])).toBe(NOTICE_TITLE_MAX);
    });

    it('the rules also insist it is a string', () => {
        // Without this a number or a map is stored, and `noticeHeading` calls
        // `.trim()` on it on every dashboard.
        expect(noticesBlock).toMatch(/title is string/);
    });
});

describe('required on the way in, shape-checked at rest', () => {
    it('the callable refuses a notice with no title', () => {
        expect(callable).toMatch(/A title is required/);
    });

    it('the rules do NOT require one, so the two legacy notices stay editable', () => {
        // The guard has to be conditional on the field being present.
        expect(noticesBlock).toMatch(/!\('title' in request\.resource\.data\)/);
    });

    it('the body cap is still enforced alongside it', () => {
        // A canary. If the whole condition were rewritten, the assertions above
        // could pass against a rule that no longer bounds anything else.
        expect(noticesBlock).toMatch(/body\.size\(\) <= 4000/);
    });
});
