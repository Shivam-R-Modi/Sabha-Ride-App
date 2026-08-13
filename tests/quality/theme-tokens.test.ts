/**
 * The token contract between light and dark.
 *
 * The failure this prevents is specific and nasty. CSS custom properties
 * INHERIT, and `[data-theme="dark"]` is declared on the same element as the
 * light block. So a token defined in light but forgotten in dark does not
 * error, does not fall back, and does not look obviously wrong at a glance —
 * it keeps its LIGHT value. One missed token is a cream-coloured card sitting
 * in an otherwise dark screen, and the only way to find it is for a human to
 * look at every screen in both themes.
 *
 * These tests turn that into a build failure instead.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const css = readFileSync(path.join(ROOT, 'theme.css'), 'utf8');

/** Custom properties declared inside one selector block. */
function tokensIn(selector: string): Map<string, string> {
    const start = css.indexOf(selector);
    if (start === -1) throw new Error(`theme.css has no ${selector} block`);

    const open = css.indexOf('{', start);
    const close = css.indexOf('\n}', open);
    const body = css.slice(open, close);

    const found = new Map<string, string>();
    for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        found.set(name, value.trim());
    }
    return found;
}

const light = tokensIn(":root,\n:root[data-theme='light']");
const dark = tokensIn(":root[data-theme='dark']");

/**
 * Tokens exempt from the "must differ between themes" rule.
 *
 * Geometry and alphas, which are shared by design — plus one colour:
 *
 *   --edge-light is white in BOTH themes on purpose. It is the specular top
 *   edge of a surface, and a specular highlight is white whatever it sits on;
 *   what changes is how much of it you see. Dark differentiates it through
 *   --edge-light-alpha (0.9 → 0.06) rather than through the colour, so the
 *   bevel becomes a hint instead of a rim.
 */
const NOT_COLOUR = new Set([
    '--glass-blur',
    '--glass-saturate',
    '--hairline-alpha',
    '--edge-light-alpha',
    '--glass-chrome-alpha',
    '--glass-surface-alpha',
    '--scrim-alpha',
    '--edge-light',
    // Whole shadow values, not colours — and they legitimately differ in KIND
    // between themes: light has a drop shadow under the button label, dark has
    // `none`, because dark inverts the fill to light-saffron-with-dark-text and
    // the same shadow becomes a muddy halo.
    '--cta-text-shadow',
    '--cta-text-shadow-lg',
]);

describe('theme.css token contract', () => {
    it('defines a meaningful number of tokens (the parser is working)', () => {
        // Guards against the regex silently matching nothing and every
        // assertion below passing vacuously.
        expect(light.size).toBeGreaterThan(40);
    });

    it('every light token has a dark counterpart', () => {
        const missing = [...light.keys()].filter(name => !dark.has(name));
        expect(
            missing,
            `These tokens would keep their LIGHT value in dark mode, because custom ` +
            `properties inherit and nothing errors:\n  ${missing.join('\n  ')}`,
        ).toEqual([]);
    });

    it('defines no dark token that light does not have', () => {
        // The reverse drift: a token only dark declares is one light silently
        // resolves to nothing, which drops the whole declaration.
        const orphans = [...dark.keys()].filter(name => !light.has(name));
        expect(orphans, `Declared only in dark:\n  ${orphans.join('\n  ')}`).toEqual([]);
    });

    it('every colour token actually differs between the themes', () => {
        // A colour identical in both is almost always a token someone
        // copy-pasted into the dark block without adjusting.
        const identical = [...light.entries()]
            .filter(([name, value]) => !NOT_COLOUR.has(name) && dark.get(name) === value)
            .map(([name, value]) => `${name}: ${value}`);

        expect(
            identical,
            `Identical in light and dark — either adjust for dark, or add to ` +
            `NOT_COLOUR with a reason:\n  ${identical.join('\n  ')}`,
        ).toEqual([]);
    });

    it('every colour token is a space-separated RGB triplet', () => {
        // Hex here would break both `rgb(var(--x) / .5)` and Tailwind's
        // <alpha-value>, and would do so at runtime rather than at build time.
        const malformed = [...light.entries()]
            .filter(([name]) => !NOT_COLOUR.has(name) && name !== '--color-scheme')
            .filter(([, value]) => !/^\d{1,3} \d{1,3} \d{1,3}$/.test(value))
            .map(([name, value]) => `${name}: ${value}`);

        expect(malformed, `Not "R G B":\n  ${malformed.join('\n  ')}`).toEqual([]);
    });
});

describe('theme.css guardrails that carry a decision', () => {
    it('keeps the 88% opacity floor on text-bearing glass', () => {
        // Glass everywhere was chosen over the chrome-only recommendation.
        // This number is what makes that choice survive an AA audit: contrast
        // is only computable against a known colour, and at 88% the surface
        // dominates whatever scrolls beneath it. Lowering it silently breaks
        // the compliance commitment in docs/compliance/privacy-and-data.md.
        expect(light.get('--glass-surface-alpha')).toBe('0.88');
        expect(dark.get('--glass-surface-alpha')).toBe('0.88');
    });

    it('does not paint white inset highlights on dark surfaces', () => {
        // The inset highlights in claymorphism.css carry alphas up to 0.95.
        // White here would draw a hard glare across the top-left of every card
        // and button — the single value that decides whether dark mode looks
        // designed or looks like light mode with the lights off.
        expect(dark.get('--shadow-glow')).not.toBe('255 255 255');
    });

    it('provides both a fill accent and a separate readable accent', () => {
        // The brand accent is 2.84:1 and cannot carry text. One variable
        // cannot serve both roles; the ramp exists so nobody has to remember.
        for (const theme of [light, dark]) {
            expect(theme.get('--accent')).toBeDefined();
            expect(theme.get('--accent-text')).toBeDefined();
            expect(theme.get('--accent-text')).not.toBe(theme.get('--accent'));
        }
    });

    it('has an unblurred fallback, so glass is a designed state either way', () => {
        expect(css).toContain('@supports not ((backdrop-filter: blur(1px))');
    });
});

describe('no colour literals survive outside theme.css', () => {
    const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

    it.each(['claymorphism.css', 'index.css'])('%s uses tokens, not hex', (file) => {
        const hex = read(file).match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
        expect(hex, `Hardcoded and therefore unthemeable: ${[...new Set(hex)].join(', ')}`)
            .toEqual([]);
    });

    it('claymorphism.css has no untokenised rgba, except the documented button shading', () => {
        // rgba(0, 0, 0, x) is the inner shading on a FILLED button. The fill is
        // saturated saffron in both themes, so black shading is correct on
        // either — see the note in claymorphism.css.
        const rgba = (read('claymorphism.css').match(/rgba\([^)]+\)/g) ?? [])
            .filter(v => !/rgba\(0,\s*0,\s*0,/.test(v));
        expect(rgba, `Untokenised: ${[...new Set(rgba)].join(', ')}`).toEqual([]);
    });
});

/**
 * Tailwind's stock palette in components.
 *
 * `bg-white`, `text-gray-500`, `bg-blue-100` and friends are FIXED values. They
 * do not move when `data-theme` flips, so every one is a light-coloured patch
 * sitting in a dark screen — the ETA chip that was white text in a white box,
 * the route dots that were white squares.
 *
 * There were roughly 200 at the start of this work. They are gone; this keeps
 * them gone. Use the brand ramps (`text-coffee`, `bg-cream-300`, `text-saffron`)
 * or a semantic token (`bg-[rgb(var(--success-bg))]`).
 */
describe('components use themed colours, not Tailwind stock', () => {
    /**
     * The NUMBERED scales only — `gray-500`, `blue-100` and so on. Those are
     * fixed lightness steps chosen for a light background and are simply wrong
     * on dark.
     *
     * `text-white` and `bg-black` are deliberately NOT matched. They sit on
     * saturated fills and on scrims, where they are frequently correct in both
     * themes, and a pattern match cannot tell the difference between a white
     * label on a saffron button and a white label on a surface. Those are
     * measured in tests/quality/theme-contrast.test.ts and in Phase 6's audit,
     * which is the right tool for the question.
     */
    const OFFENDERS = new RegExp(
        String.raw`(?<![\w/-])(?:bg|text|border|from|to|divide|ring)-` +
        String.raw`(?:gray|slate|zinc|neutral|stone|blue|green|red|orange|amber|` +
        String.raw`yellow|purple|teal|indigo|pink|rose|cyan|emerald|lime|violet|fuchsia|sky)` +
        String.raw`-\d{2,3}(?![\w-])`,
    );

    /** Inside a className, not in prose or a comment. */
    function offences(): string[] {
        const found: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = path.join(dir, entry);
                if (statSync(full).isDirectory()) { walk(full); continue; }
                if (!/\.tsx$/.test(entry)) continue;

                readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
                    if (!/class(Name)?=|clsx|tone:|className:/.test(line) && !/^\s*['"`].*['"`],?\s*$/.test(line)) return;
                    const hit = line.match(OFFENDERS);
                    if (hit) found.push(`${path.relative(ROOT, full)}:${i + 1}  ${hit[0]}`);
                });
            }
        };
        walk(path.join(ROOT, 'components'));
        return found;
    }

    it('none are left', () => {
        const hits = offences();
        expect(hits, `Fixed colours cannot follow the theme:\n  ${hits.join('\n  ')}`).toEqual([]);
    });
});
