/**
 * The feedback ceiling must be the SAME number in both places that hold it.
 *
 * `firestore.rules` cannot import a TypeScript constant, so 1000 is written twice:
 * `MAX_FEEDBACK` in `src/utils/feedback.ts` and a literal in the `feedback` block.
 * Same arrangement as `AGENDA_MAX_CHARS` — see tests/quality/agenda-cap.test.ts
 * for the reasoning, which applies verbatim.
 *
 * Drift is silent in the worse direction: raise the TS constant alone and the form
 * cheerfully accepts text that Firestore then rejects, so somebody types a long
 * piece of feedback and loses it behind a raw permission error.
 *
 * The second block pins the throttle. One submission per person per day is
 * enforced by the document id and by `allow update: if false` TOGETHER — remove
 * either and the guarantee is gone with nothing failing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_FEEDBACK } from '../../src/utils/feedback';

const ROOT = path.resolve(__dirname, '../..');
const rules = readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

/** Just the feedback block, so a match cannot come from a neighbouring rule. */
const feedbackBlock = (() => {
    const start = rules.indexOf('match /feedback/{feedbackId}');
    expect(start).toBeGreaterThan(-1);
    return rules.slice(start, rules.indexOf('match /', start + 10));
})();

describe('the cap is one number', () => {
    it('firestore.rules bounds the comment at MAX_FEEDBACK', () => {
        const bound = feedbackBlock.match(/comment\.size\(\)\s*<=\s*(\d+)/);

        expect(bound).not.toBeNull();
        expect(Number(bound![1])).toBe(MAX_FEEDBACK);
    });

    it('the rating is bounded to 1..5 server-side, not only in the form', () => {
        expect(feedbackBlock).toMatch(/rating is int/);
        expect(feedbackBlock).toMatch(/rating >= 1/);
        expect(feedbackBlock).toMatch(/rating <= 5/);
    });

    it('the uid is pinned to the caller', () => {
        expect(feedbackBlock).toMatch(/data\.uid == request\.auth\.uid/);
    });
});

describe('one submission per person per day stays enforceable', () => {
    it('nothing may update or delete a submission', () => {
        // Half of the throttle. If `update` is ever allowed, a second write to the
        // same id succeeds and the per-day limit quietly disappears.
        expect(feedbackBlock).toMatch(/allow update, delete: if false;/);
    });

    it('the client builds the id from the person and the day', () => {
        // The other half. A random id would make every submission a `create`.
        const util = readFileSync(path.join(ROOT, 'src/utils/feedback.ts'), 'utf8');
        expect(util).toMatch(/export function feedbackDocId/);

        const card = readFileSync(path.join(ROOT, 'components/shared/FeedbackCard.tsx'), 'utf8');
        expect(card).toMatch(/feedbackDocId\(/);
        // `addDoc` generates a random id, which would defeat the whole mechanism.
        expect(card).not.toMatch(/addDoc\(/);
    });
});
