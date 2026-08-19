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
