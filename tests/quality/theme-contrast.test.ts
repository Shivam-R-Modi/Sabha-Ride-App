/**
 * WCAG contrast, measured rather than eyeballed.
 *
 * docs/compliance/privacy-and-data.md holds this app to WCAG 2.1 AA, and an
 * earlier design pass took the failure count from 111 to 1. Adding a whole
 * second theme is exactly the change that could quietly undo that: dark palettes
 * are usually picked by eye, and "it looks fine on my monitor" is not a ratio.
 *
 * So every token whose NAME says it carries text is checked against both
 * surfaces it can appear on, in both themes. The numbers in theme.css's comments
 * are asserted here too, which means those comments cannot rot into fiction.
 *
 * Verified against Chromium's computed values on 2026-08-12 — the light figures
 * below are byte-identical to what the app shipped before this refactor.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.resolve(__dirname, '../../theme.css'), 'utf8');

function tokens(selector: string): Record<string, [number, number, number]> {
    const start = css.indexOf(selector);
    const open = css.indexOf('{', start);
    const body = css.slice(open, css.indexOf('\n}', open));

    const out: Record<string, [number, number, number]> = {};
    for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        const parts = value.trim().split(/\s+/).map(Number);
        if (parts.length === 3 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
            out[name] = parts as [number, number, number];
        }
    }
    return out;
}

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
    const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

const THEMES = {
    light: tokens(":root,\n:root[data-theme='light']"),
    dark: tokens(":root[data-theme='dark']"),
};

/** Every token intended to carry text. --text-faint is excluded by design. */
const TEXT_ROLES = [
    '--text-strong', '--text', '--text-soft',
    '--accent-text', '--gold-text',
    '--success-text', '--warning-text', '--danger-text', '--info-text',
];

const AA_NORMAL = 4.5;

describe.each(Object.entries(THEMES))('%s theme meets WCAG AA', (themeName, t) => {
    it.each(TEXT_ROLES)('%s is readable on the canvas', (role) => {
        const ratio = contrast(t[role], t['--canvas']);
        expect(ratio, `${role} on --canvas in ${themeName} is ${ratio}:1`)
            .toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it.each(TEXT_ROLES)('%s is readable on a surface', (role) => {
        const ratio = contrast(t[role], t['--surface']);
        expect(ratio, `${role} on --surface in ${themeName} is ${ratio}:1`)
            .toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('a filled button is readable', () => {
        // White on the raw brand accent is 2.84:1, which is why the --cta ramp
        // exists at all. On dark the ramp inverts — light fill, dark text.
        expect(contrast(t['--text-on-accent'], t['--cta'])).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it.each(['--success-fill', '--warning-fill', '--danger-fill', '--info-fill'])(
        'a filled %s button is readable', (fill) => {
            // The bug this catches shipped: an "Approve" button used the
            // SATURATED --success (34 197 94) behind white text — 2.28:1. A
            // mid-tone cannot carry white, which is the same lesson the saffron
            // ramp already encodes. Every status hue now has its own fill step.
            const ratio = contrast(t['--text-on-accent'], t[fill]);
            expect(ratio, `${fill} in ${themeName} is ${ratio}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
        });
});

describe('tokens that must NOT be used for text are still unsafe', () => {
    it.each(['--accent', '--gold', '--success', '--danger'])(
        '%s remains below AA with white, as documented', (role) => {
        // If one of these ever clears 4.5:1 against white, someone has changed
        // the hue and the -fill ramps that exist to work around it are stale.
        expect(contrast(THEMES.light[role], [255, 255, 255])).toBeLessThan(AA_NORMAL);
    });
});

/**
 * SECONDARY TEXT DOES NOT ONLY SIT ON THE CANVAS.
 *
 * The rest of this file checks text tokens against `--canvas` and `--surface`, which is
 * where the *page* is — and that is exactly the gap this block closes. `--text-soft` was
 * chosen against `--canvas`, where it measured a comfortable 4.89, and it failed everywhere
 * a chip or a card put it on a sunken surface:
 *
 *   light, on --sunken (cream-400: nav pills, active segments, the service switch)  3.92
 *   light, on --canvas-deep (cream-300: every chip and hover)                       4.22
 *   dark,  on --surface-deep (the far corner of every .clay-card gradient)          4.28
 *
 * The dark case is the least obvious and the most widespread: `.clay-card` runs
 * `--surface` → `--surface-mid` → `--surface-deep`, and dark mode deliberately gets
 * LIGHTER as surfaces come forward (asserted below), so a card's far corner is lighter
 * than `--surface` and the token that passed on `--surface` failed on the card.
 *
 * None of it was reachable by comparing token pairs, because nothing declares "this text
 * goes on that surface". It came out of a computed-style sweep of the rendered preview
 * screens.
 *
 * COVERS `--text-soft` AND `--gold-text`. Two more light-mode pairings still fail and are
 * deliberately still outside it, because dragging them into an unrelated change is how a
 * fix becomes a refactor:
 *
 *   --accent-text on --sunken   4.15   (live: FeedbackCard's active segment)
 *   --warning-text on --sunken  4.18   (no live pairing found)
 *
 * `--gold-text` was the third of those at 3.84 and was folded in on 2026-08-25, once the
 * token was darkened to clear all seven. Its worst surface is --sunken at 4.55, so the
 * margin is thin — which is exactly why it is pinned rather than trusted.
 *
 * Those two are recorded in docs/STATUS.md. When they are fixed, fold them in here too.
 */
describe('secondary text clears AA on every surface it can land on', () => {
    const NEUTRAL_SURFACES = [
        '--canvas', '--canvas-mid', '--canvas-deep', '--sunken',
        '--surface', '--surface-mid', '--surface-deep',
    ];

    // Both tokens, both themes, all seven surfaces. `--gold-text` joined on 2026-08-25.
    for (const token of ['--text-soft', '--gold-text'] as const) {
        for (const theme of ['light', 'dark'] as const) {
            it.each(NEUTRAL_SURFACES)(`${token} is AA on %s in ${theme}`, (surface) => {
                expect(contrast(THEMES[theme][token], THEMES[theme][surface]))
                    .toBeGreaterThanOrEqual(AA_NORMAL);
            });
        }
    }

    it('and the card gradient is the reason --surface-deep is in that list', () => {
        // A guard on the reasoning rather than the number: if dark ever stops getting
        // lighter as surfaces come forward, the worst case moves and this block should be
        // re-derived rather than trusted.
        expect(luminance(THEMES.dark['--surface-deep']))
            .toBeGreaterThan(luminance(THEMES.dark['--surface']));
    });
});

describe('the ratios written in theme.css comments are true', () => {
    // Documentation that drifts is worse than none — these are the numbers a
    // future reader will trust when choosing a token.
    const DOCUMENTED_LIGHT: Record<string, number> = {
        '--text-strong': 13.07,
        '--text': 8.10,
        '--text-soft': 5.76,
        '--accent-text': 5.18,
        '--gold-text': 5.68,
    };

    it.each(Object.entries(DOCUMENTED_LIGHT))('%s really is %s:1 on cream', (role, claimed) => {
        expect(contrast(THEMES.light[role], THEMES.light['--canvas'])).toBeCloseTo(claimed, 1);
    });
});

describe('dark is not merely inverted light', () => {
    it('lifts the accent, because the light-mode saffron is muddy on dark', () => {
        // Straight inversion is the usual dark-mode failure. The accent has to
        // move up the ramp or it disappears into the surface.
        expect(luminance(THEMES.dark['--accent']))
            .toBeGreaterThan(luminance(THEMES.light['--accent']));
    });

    it('builds depth by getting LIGHTER as surfaces come forward', () => {
        // The other half of the naive-inversion failure. On light, a raised
        // surface is separated by a cast shadow. On dark a cast shadow is
        // invisible, so elevation has to come from lightness: sunken < canvas
        // < surface < surface-mid < surface-deep. Get this backwards and every
        // card looks like a hole rather than a card.
        const steps = ['--sunken', '--canvas', '--surface', '--surface-mid', '--surface-deep'];
        const lums = steps.map(s => luminance(THEMES.dark[s]));

        for (let i = 1; i < lums.length; i++) {
            expect(
                lums[i],
                `${steps[i]} must be lighter than ${steps[i - 1]} in dark mode`,
            ).toBeGreaterThan(lums[i - 1]);
        }
    });

    it('does not carry light mode\'s white inset highlight into dark', () => {
        // claymorphism.css paints inset highlights at alphas up to 0.95. White
        // there would be a hard glare on every card and button.
        expect(luminance(THEMES.dark['--shadow-glow']))
            .toBeLessThan(luminance(THEMES.light['--shadow-glow']));
    });
});
