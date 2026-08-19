/**
 * The notice card must not glow in dark mode.
 *
 * It did, twice over, and both causes are worth naming because each looks
 * perfectly reasonable on its own:
 *
 *   1. Its cast shadow was painted in `--gold`. On cream that is a warm lift. On a
 *      near-black dashboard the same gold at 20% around a card IS a glow — there is
 *      nothing behind it for a light-coloured shadow to be a shadow ON.
 *   2. Its dark background ramp climbed 46 39 22 → 71 58 28, a 25-step rise, next
 *      to a surface ramp that climbs 16. Steeper and much more saturated, so the
 *      card also brightened towards one corner like a light source.
 *
 * theme-contrast.test.ts already pins the principle this violates: on dark,
 * elevation comes from LIGHTNESS because a cast shadow cannot be seen. A TINTED
 * cast shadow is therefore never depth — it can only be glow.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const clay = readFileSync(path.join(ROOT, 'claymorphism.css'), 'utf8');
const theme = readFileSync(path.join(ROOT, 'theme.css'), 'utf8');

/** The .clay-card-notice rule body, comments stripped. */
const noticeRule = (() => {
    const start = clay.indexOf('.clay-card-notice {');
    if (start === -1) throw new Error('claymorphism.css has no .clay-card-notice rule');
    const body = clay.slice(start, clay.indexOf('}', start));
    return body.replace(/\/\*[\s\S]*?\*\//g, '');
})();

/** A token's `r g b` triplet from one theme block. */
function token(selector: string, name: string): [number, number, number] {
    const start = theme.indexOf(selector);
    if (start === -1) throw new Error(`theme.css has no ${selector} block`);
    const body = theme.slice(theme.indexOf('{', start), theme.indexOf('\n}', start));
    const match = body.match(new RegExp(`${name}:\\s*([\\d\\s]+);`));
    if (!match) throw new Error(`${name} is not declared in ${selector}`);
    const parts = match[1]!.trim().split(/\s+/).map(Number);
    return [parts[0]!, parts[1]!, parts[2]!];
}

const relative = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const LIGHT = ':root';
const DARK = ":root[data-theme='dark']";

describe('the notice card casts a matte shadow, not a glow', () => {
    it('does not paint its shadow in --gold', () => {
        // The exact regression. --gold is a fixed warm colour in BOTH themes, so
        // using it here cannot be made matte by the theme.
        expect(noticeRule).not.toMatch(/--gold/);
    });

    it('paints its shadow with --notice-shadow, which the theme can re-point', () => {
        expect(noticeRule).toMatch(/--notice-shadow/);
    });

    it('is a neutral, unseeable cast shadow in dark mode', () => {
        // Anything with colour in it becomes a halo on a near-black canvas.
        const [r, g, b] = token(DARK, '--notice-shadow');
        expect(Math.max(r, g, b), 'a dark cast shadow must be black, or it glows').toBeLessThan(20);
    });

    it('keeps the warm cast shadow in light mode, where it is a lift', () => {
        // Guards against over-correcting: light mode never had this problem.
        expect(relative(token(LIGHT, '--notice-shadow'))).toBeGreaterThan(100);
    });
});

describe('the dark notice background does not brighten like a light source', () => {
    it('climbs no more steeply than the surface ramp it sits beside', () => {
        const noticeClimb = relative(token(DARK, '--notice-3')) - relative(token(DARK, '--notice-1'));
        const surfaceClimb = relative(token(DARK, '--surface-deep')) - relative(token(DARK, '--surface'));

        expect(
            noticeClimb,
            'a notice that brightens faster than an ordinary card reads as lit, not raised',
        ).toBeLessThanOrEqual(surfaceClimb + 1);
    });

    it('still climbs upward, so it reads as raised rather than as a hole', () => {
        // The other direction of the same mistake, per theme-contrast.test.ts.
        expect(relative(token(DARK, '--notice-3')))
            .toBeGreaterThan(relative(token(DARK, '--notice-1')));
    });

    it('stays warmer than a plain surface, so it is still recognisably a notice', () => {
        // Matte must not mean indistinguishable — it is an announcement.
        const [nr, , nb] = token(DARK, '--notice-1');
        const [sr, , sb] = token(DARK, '--surface');
        expect(nr - nb, 'notice must be warmer than surface').toBeGreaterThan(sr - sb);
    });
});
