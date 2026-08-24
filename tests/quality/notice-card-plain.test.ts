/**
 * The notice board uses the ORDINARY card. It has no style of its own.
 *
 * This is an owner decision, taken on 2026-08-19 after seeing it on a phone:
 * "No need to make it stand out. keep it like other plain cards."
 *
 * It replaces a bespoke `.clay-card-notice` — a gold gradient with a gold cast
 * shadow — and it is worth recording WHY that is gone rather than merely toned
 * down, because "give the notice a warm tint" is a natural thing to reach for
 * again:
 *
 *   - In dark mode a TINTED cast shadow cannot be depth. theme-contrast.test.ts
 *     pins the reason: on dark, elevation comes from lightness, because a cast
 *     shadow is invisible. So a coloured shadow is only ever a glow, and the card
 *     read as a lamp on the dashboard.
 *   - Toning it down was tried first — a matte shadow and a shallower ramp — and
 *     the answer was still that it should not stand out at all.
 *
 * So the tokens and the rule were deleted rather than adjusted. Dead CSS that
 * nothing renders is how a "toned down" version quietly comes back.
 *
 * If a notice ever genuinely needs its own treatment, this test is the objection
 * to answer, not an obstacle to delete.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const board = readFileSync(path.join(ROOT, 'components/shared/NoticeBoard.tsx'), 'utf8');
const clay = readFileSync(path.join(ROOT, 'claymorphism.css'), 'utf8');
const theme = readFileSync(path.join(ROOT, 'theme.css'), 'utf8');

describe('the notice board looks like every other card', () => {
    it('uses clay-card for its cards', () => {
        // ONE occurrence, not two: with the agenda's label gone, its card and a
        // notice's card were the same <article> twice, so they are one component.
        expect(board.match(/className="clay-card p-4 text-left"/g) ?? []).toHaveLength(1);
    });

    it('has no agenda-specific label or styling left', () => {
        // The owner asked for the label to go too, after the card styling. What is
        // left must not quietly reintroduce a distinction.
        expect(board).not.toMatch(/Sabha agenda</);
        expect(board).not.toMatch(/AgendaCard/);
    });

    it('uses no bespoke notice card class', () => {
        expect(board).not.toMatch(/clay-card-notice/);
    });

    it('has no .clay-card-notice rule left to come back', () => {
        expect(clay).not.toMatch(/clay-card-notice/);
    });

    it('leaves no --notice-* tokens behind in either theme', () => {
        // A token nothing reads is invisible, survives review, and is exactly what
        // a future "let us just tint it slightly" would pick up again.
        expect(theme).not.toMatch(/--notice-/);
    });
});

/**
 * A notice image is never cropped.
 *
 * It was `object-cover max-h-72`: capped at 288px and then cut to fill. A flyer
 * lost its edges and a portrait photo lost its top and bottom. Reported by the
 * owner the first time an image ever reached the board, which was the same day
 * uploading one started working at all — see *Fixed 2026-08-24* in
 * docs/STATUS.md.
 *
 * The reason this is a ratchet and not a preference: a notice image IS the
 * message. Cropping it silently removes information the manager chose to send,
 * and neither they nor the reader can tell anything is missing. `object-cover` is
 * the right default for an avatar or a thumbnail, which is exactly why it is easy
 * to reach for again here.
 *
 * Textual, because jsdom computes no Tailwind and so cannot see an object-fit.
 */
describe('a notice image is shown whole', () => {
    // Comments stripped BEFORE matching, and both halves of that matter. The
    // prose above this <img> says the words `<img>`, `object-cover` and
    // `max-h-72` — the first made a naive /<img/ match start inside the comment,
    // and the other two made the "must not contain" assertions read the
    // explanation of the fix as if it were the fix being undone. A guard that
    // passes or fails on its own documentation is worse than no guard.
    const code = board
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    const img = code.match(/<img[\s\S]*?\/>/)?.[0] ?? '';

    it('has an image to check', () => {
        // Guards the regex above: if the <img> moves or changes shape, the
        // assertions below would otherwise pass against an empty string.
        //
        // It has already earned its keep once. When the notice card became a
        // collapsed ROW on 2026-08-24 the image moved into the opened panel and
        // its source became `notice.imageUrl`; this line failed, and the four
        // below it would otherwise have gone quietly vacuous.
        expect(img).toContain('src={notice.imageUrl}');
    });

    it('never uses object-cover, which crops', () => {
        // The one that actually cut the picture. `object-cover` is right for an
        // avatar or a thumbnail, which is exactly why it is easy to reach for here.
        expect(img).not.toContain('object-cover');
    });

    it('takes the full width and its own natural height', () => {
        expect(img).toContain('w-full');
        expect(img).toContain('h-auto');
        expect(img).not.toMatch(/\bh-\d+\b/);
    });

    it('has NO height ceiling, so the image is never shrunk either', () => {
        // Owner's call, 2026-08-24: not cropping was not enough — a `max-h` with
        // `object-contain` still made a tall flyer smaller than it was sent. Any
        // `max-h-*` reintroduces that, so the assertion is against the whole
        // family rather than the one value that used to be here.
        expect(img).not.toMatch(/max-h-/);
    });

    it('sets no object-fit at all, because there is nothing left to fit', () => {
        // With no height constraint the box already IS the image's aspect ratio.
        // An `object-contain` would be inert, and an inert utility reads as though
        // something were being handled — this file exists partly because dead CSS
        // is how a reverted decision quietly comes back.
        expect(img).not.toMatch(/object-(cover|contain|fill|none|scale-down)/);
    });
});
