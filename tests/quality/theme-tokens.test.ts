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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

/**
 * Two DIFFERENT tokens resolving to the SAME colour inside one theme.
 *
 * The existing contract above checks that each token differs between light and
 * dark. Every token passed that, and the sidebar was still broken: in dark mode
 * `--canvas-deep` and `--surface` are both `39 34 29`, so the selected nav item
 * (`bg-cream-300`) had no fill at all against the panel it sits on
 * (`bg-surface`). The only cues left were a hairline border and orange text —
 * and because `hover:bg-cream-200` DOES differ from the panel, hovering an
 * unselected item looked more selected than the selected one.
 *
 * The mobile bottom nav had the identical bug, because `.clay-bottom-nav` is a
 * `--surface` gradient and its active chip was also `bg-cream-300`.
 *
 * "Differs between themes" is the wrong question for anything stacked. The right
 * one is "does this fill differ from the thing it sits ON, in every theme".
 */
describe('tokens that stack must not collide within a theme', () => {
    /** The two ramps that get stacked on each other: page/panel vs fills. */
    const STACKING = [
        '--canvas', '--canvas-mid', '--canvas-deep', '--sunken',
        '--surface', '--surface-mid', '--surface-deep',
    ];

    /**
     * Collisions that remain, and why each is harmless.
     *
     * `dark: --canvas-deep == --surface` USED TO BE HERE, and it was the one that
     * bit: it made every `bg-cream-300` fill invisible on a `bg-surface` panel.
     * The dark surface ramp was lifted one step on 2026-08-18 to separate them, so
     * that entry is gone and the whole class of bug with it.
     *
     * The two that stay are in LIGHT, where the surface ramp is squeezed against
     * white and has almost no headroom. They are unexploitable rather than merely
     * unexploited: **`bg-surface-mid` and `bg-surface-deep` have zero usages in the
     * codebase**, so nothing can stack on them. `.clay-bottom-nav` reads
     * `--surface-mid` in a gradient, and its light end matching `--canvas` is
     * invisible only against the page — which that nav never sits on, being fixed
     * over content.
     *
     * If either class ever gets used as a background, delete the matching entry
     * here first and find the headroom.
     */
    const KNOWN = new Set([
        'light: --canvas == --surface-mid',
        'light: --canvas-mid == --surface-deep',
    ]);

    function collisions(theme: Map<string, string>, label: string): string[] {
        const byValue = new Map<string, string[]>();
        for (const name of STACKING) {
            const value = theme.get(name);
            if (!value) continue;
            byValue.set(value, [...(byValue.get(value) ?? []), name]);
        }
        return [...byValue.values()]
            .filter(names => names.length > 1)
            .flatMap(names => names.slice(1).map(n => `${label}: ${names[0]} == ${n}`));
    }

    it('no NEW collision appears in either theme', () => {
        const found = [...collisions(light, 'light'), ...collisions(dark, 'dark')];
        const novel = found.filter(c => !KNOWN.has(c));

        expect(
            novel,
            `Two stacking tokens now resolve to the same colour. Anything using one ` +
            `as a fill on the other becomes invisible in that theme — which is how ` +
            `the selected nav item disappeared in dark mode. Separate them, or add ` +
            `to KNOWN with a note that nothing stacks them:\n  ${novel.join('\n  ')}`,
        ).toEqual([]);
    });

    it('the allowlist has no stale entries', () => {
        // A recorded collision that no longer exists means the ramp was fixed and
        // the note should go, rather than sitting there excusing a future one.
        const found = new Set([...collisions(light, 'light'), ...collisions(dark, 'dark')]);
        const stale = [...KNOWN].filter(c => !found.has(c));

        expect(stale, `Fixed — drop from KNOWN:\n  ${stale.join('\n  ')}`).toEqual([]);
    });

    /** Channel-sum distance, so "differs by 1" cannot pass as a fix. */
    const distance = (a: string, b: string) => {
        const pa = a.split(' ').map(Number), pb = b.split(' ').map(Number);
        return pa.reduce((n, v, i) => n + Math.abs(v - pb[i]!), 0);
    };

    it('the selected nav fill is visible on the panel it sits on, in BOTH themes', () => {
        // The specific property the sidebar and bottom nav depend on. Class ->
        // token: `bg-cream-400` is `--sunken`, `bg-surface` is `--surface`, and
        // `.clay-bottom-nav` runs `--surface` -> `--surface-mid`.
        for (const [themeName, theme] of [['light', light], ['dark', dark]] as const) {
            const fill = theme.get('--sunken')!;
            for (const panel of ['--surface', '--surface-mid'] as const) {
                expect(
                    distance(fill, theme.get(panel)!),
                    `${themeName}: --sunken is indistinguishable from ${panel}, so the ` +
                    `selected nav item has no fill`,
                ).toBeGreaterThan(12);
            }
        }
    });

    it('cream-300 — the most common fill — is visible on a surface in BOTH themes', () => {
        // What lifting the dark surface ramp actually bought. `bg-cream-300`
        // (`--canvas-deep`) is used 64 times, mostly as a chip, badge or hover on a
        // card. Before the lift the dark distance here was ZERO and every one of
        // those was invisible; the three in the navigation were merely the ones
        // somebody noticed.
        //
        // A margin, not mere inequality: "differs by 1" is not a visible fill.
        for (const [themeName, theme] of [['light', light], ['dark', dark]] as const) {
            expect(
                distance(theme.get('--canvas-deep')!, theme.get('--surface')!),
                `${themeName}: --canvas-deep is indistinguishable from --surface, so ` +
                `every bg-cream-300 chip, badge and hover on a card vanishes`,
            ).toBeGreaterThanOrEqual(18);
        }
    });

    it('Layout.tsx really uses those classes, so this test cannot drift', () => {
        // Without this the assertion above guards a pairing the component no
        // longer has — a test that passes while the screen is broken, which is
        // exactly what happened here the first time.
        const layout = readFileSync(path.join(ROOT, 'components/Layout.tsx'), 'utf8');

        expect(layout).toMatch(/<aside className=\{`fixed[^`]*bg-surface/);
        // Four fills: the sidebar's active pill, its Sign Out button, the dock's
        // active chip (DockButton, shared by the visible row and the overflow
        // drawer), and the dock's More control, which takes the same chip while
        // one of the hidden destinations is current.
        expect(layout.match(/bg-cream-400/g) ?? []).toHaveLength(4);
        // And none of them back on the colliding token.
        expect(layout).not.toMatch(/isActive\s*\?\s*'bg-cream-300/);
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
describe('the app uses themed colours, not Tailwind stock', () => {
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
     *
     * GRADIENT STOPS are the exception, and they get their own rule below: a
     * `via-white` is never a label, it is a surface.
     */
    const OFFENDERS = new RegExp(
        // `shadow` and `via` were missing from this list, which let
        // `shadow-green-200` sit under the success circle on CompletionScreen —
        // a green glow that stayed green on a dark surface. Same omission-shaped
        // hole as the missing hex rule below.
        // The DIRECTIONAL forms matter: `border-l-blue-500` does not match
        // `border-` followed by a palette name, so two fixed stock colours sat in
        // DriverHistory's stat stripes for the whole life of this test — right next
        // to a themed `border-l-saffron`, and with the numbers beside them already
        // using --info-text and --success-text.
        String.raw`(?<![\w/-])(?:bg|text|border(?:-[trblxy])?|from|via|to|divide(?:-[xy])?|ring|shadow|outline)-` +
        String.raw`(?:gray|slate|zinc|neutral|stone|blue|green|red|orange|amber|` +
        String.raw`yellow|purple|teal|indigo|pink|rose|cyan|emerald|lime|violet|fuchsia|sky)` +
        String.raw`-\d{2,3}(?![\w-])`,
    );

    /**
     * A raw hex inside an arbitrary-value utility — `bg-[#FAF9F6]`,
     * `from-[#F5F0E8]`, `text-[#B84318]`.
     *
     * This rule was missing, and the gap cost two screens. `AssignmentPreview`
     * and `CompletionScreen` painted their root with
     * `bg-gradient-to-br from-[#FAF9F6] to-[#F5F0E8]`, which is cream in BOTH
     * themes — so a driver in dark mode got a cream page in the middle of an
     * otherwise dark app, on the two screens they see most during a run.
     * Reported from the field on 2026-08-17, after the theme work was supposedly
     * finished, because nothing here looked for a hex in a component.
     *
     * Both stops had exact tokens (`cream`, `cream-200`). That is the usual case:
     * the hex is a token somebody had not looked up.
     */
    const RAW_HEX = new RegExp(
        // Directional forms included for the same reason as OFFENDERS above.
        String.raw`(?<![\w/-])(?:bg|text|border(?:-[trblxy])?|from|to|via|ring|` +
        String.raw`divide(?:-[xy])?|outline|decoration|caret|accent|fill|stroke|shadow)-` +
        String.raw`\[#[0-9A-Fa-f]{3,8}\]`,
    );

    /**
     * Hexes that are correct in both themes, with the reason.
     *
     * A fixed colour is only defensible when what it sits on is also fixed. The
     * login heading lies on a PHOTOGRAPH (`/assets/login-background.jpg`), which
     * does not change with `data-theme` — so a token there would drift away from
     * the image it has to stay legible against. Anything on a themed surface
     * belongs in the ramps instead.
     */
    const HEX_ALLOWED = new Map<string, string>([
        ['components/auth/LoginScreen.tsx', 'heading sits on a fixed background photo'],
    ]);

    /**
     * `white` and `black` as a GRADIENT STOP.
     *
     * The rule above deliberately ignores bare `text-white` / `bg-black`, because
     * a white label on a saturated saffron fill is correct in both themes and a
     * regex cannot tell that apart from white-on-a-surface.
     *
     * A gradient stop carries no such ambiguity. `from-`/`via-`/`to-` paint a
     * BACKGROUND, and a fixed white band in a background is wrong in dark mode
     * every single time.
     *
     * Found on 2026-08-17 by grepping the DEPLOYED bundle rather than the source,
     * while chasing a different report: five screens carried one —
     * `from-saffron/10 via-white to-gold/10` on four onboarding screens
     * (role selection, email verification, pending approval, profile setup) and
     * `from-cream to-white` on the manager's driver header. In dark mode each one
     * is a white stripe across an otherwise dark screen.
     *
     * All five had an exact token: `--surface` is `255 255 255` in light, so
     * `white` → `surface` is byte-identical in light mode and correct in dark.
     */
    const FIXED_GRADIENT_STOP = new RegExp(
        String.raw`(?<![\w/-])(?:from|via|to)-(?:white|black)(?![\w-])`,
    );

    /**
     * Gradient stops over something that is itself fixed.
     *
     * `LoginScreen` darkens a PHOTOGRAPH with `from-black/20 to-black/30` so the
     * heading stays legible against it. The image does not change with the theme,
     * so neither should the scrim — a token there would lighten the overlay in
     * dark mode and make white text sit on a bright photo.
     */
    const GRADIENT_ALLOWED = new Map<string, string>([
        ['components/auth/LoginScreen.tsx', 'scrim darkens a fixed background photo'],
    ]);

    /**
     * Every .tsx that can carry a className — not just `components/`.
     *
     * This walked ONLY `components/`, which meant the app's own root file was
     * never checked. `App.tsx` had `from-amber-50 to-orange-50` on the
     * account-rejected screen and `from-red-400 to-red-500` on its sign-out
     * button, both invisible to this test for as long as it has existed.
     */
    const ROOTS = ['components', 'src', 'hooks', 'contexts'];

    /** Inside a className, not in prose or a comment. */
    function offences(pattern: RegExp, skip: (file: string) => boolean = () => false): string[] {
        const found: string[] = [];

        const inspect = (full: string) => {
            if (!/\.tsx$/.test(full)) return;
            const rel = path.relative(ROOT, full);
            if (skip(rel)) return;

            readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
                const trimmed = line.trim();
                if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

                // Test inside QUOTED SPANS, rather than requiring `className=` on
                // the same line.
                //
                // That requirement was a real hole. Class lists in this codebase are
                // routinely built across several lines:
                //
                //     className={`... border-2 border-mocha/20 ... ${
                //         validation.isValid ? 'pr-10 border-green-500/50' : ''
                //     }`}
                //
                // The continuation line holds the offending class and mentions
                // neither `className` nor sits alone in quotes, so it was skipped
                // outright — which is how a stock `border-green-500/50` survived in
                // PhoneNumberInput next to a checkmark already using --success-text.
                // Quoted spans catch the class wherever the expression puts it.
                for (const [span] of line.matchAll(/'[^']*'|"[^"]*"|`[^`]*`/g)) {
                    const hit = span.match(pattern);
                    if (hit) { found.push(`${rel}:${i + 1}  ${hit[0]}`); return; }
                }
            });
        };

        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = path.join(dir, entry);
                if (statSync(full).isDirectory()) walk(full);
                else inspect(full);
            }
        };

        // Root-level .tsx (App.tsx, index.tsx) plus every source directory.
        for (const entry of readdirSync(ROOT)) inspect(path.join(ROOT, entry));
        for (const dir of ROOTS) {
            const full = path.join(ROOT, dir);
            if (existsSync(full)) walk(full);
        }
        return found;
    }

    it('none are left', () => {
        const hits = offences(OFFENDERS);
        expect(hits, `Fixed colours cannot follow the theme:\n  ${hits.join('\n  ')}`).toEqual([]);
    });

    it('no raw hex in an arbitrary-value utility, including gradient stops', () => {
        const hits = offences(RAW_HEX, file => HEX_ALLOWED.has(file));
        expect(
            hits,
            `A hex cannot follow data-theme. Use the ramp (bg-cream, text-coffee) or a ` +
            `token (bg-[rgb(var(--success-bg))]). If the colour sits on something that ` +
            `is itself fixed, add the file to HEX_ALLOWED with the reason:\n  ${hits.join('\n  ')}`,
        ).toEqual([]);
    });

    it('no fixed white/black gradient stop', () => {
        const hits = offences(FIXED_GRADIENT_STOP, f => GRADIENT_ALLOWED.has(f));
        expect(
            hits,
            `A gradient stop paints a BACKGROUND, so a fixed white or black band is ` +
            `wrong in one of the two themes. \`--surface\` is pure white in light, so ` +
            `\`white\` -> \`surface\` usually changes nothing in light mode. If the ` +
            `gradient sits over something itself fixed (a photo), add the file to ` +
            `GRADIENT_ALLOWED with the reason:\n  ${hits.join('\n  ')}`,
        ).toEqual([]);
    });

    it('scans the app root, not only components/', () => {
        // A guard on the guard. `App.tsx` carried two stock-palette gradients for
        // the whole life of this test because the walk started at components/.
        // If this file ever stops being reachable, the rules above go quiet
        // without failing.
        // Probes for a class App.tsx genuinely contains, INSIDE a quoted span —
        // the walker no longer looks at bare `className=` text, so probing for
        // that would silently match nothing and this guard would pass vacuously.
        const seen = offences(/bg-cream/);
        expect(seen.some(h => h.startsWith('App.tsx:'))).toBe(true);
    });

    it('the hex allowlist has no stale entries', () => {
        // An allowed file that no longer contains a hex means the exemption has
        // outlived its reason, and would silently cover the next one added.
        const stale = [...HEX_ALLOWED.keys()]
            .filter(file => offences(RAW_HEX, f => f !== file).length === 0);
        expect(stale, `Allowlisted but clean — drop the entry:\n  ${stale.join('\n  ')}`).toEqual([]);
    });
});

/**
 * The two banners that share the bottom slot.
 *
 * `UpdateBanner` and `PWAPrompt` are both `fixed bottom-safe-nav`, so on a phone
 * they occupy the same strip and are frequently seen one after the other. They
 * were styled as an inverted pair — `bg-coffee text-cream` — which is
 * contrast-correct but paints the panel from the TEXT ramp, and that ramp flips
 * between themes. The result in dark mode was a near-white slab on a dark app:
 * technically legible, visibly foreign.
 *
 * Both now use `bg-surface`, which moves with the rest of the app's cards. The
 * risk this guards is drift — restyling one and forgetting the other, leaving
 * two differently-coloured notices in the same corner.
 *
 * `bg-coffee` is NOT banned generally. It is a deliberate emphasis idiom in
 * RideWindowControl and DatabaseConsole, where a dark chip on a page is the
 * point. It is banned only for these two, which are panels, not chips.
 */
describe('the bottom banners stay one pair', () => {
    const BANNERS = ['components/UpdateBanner.tsx', 'components/PWAPrompt.tsx'];

    const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

    it('both paint from the panel ramp', () => {
        for (const file of BANNERS) {
            expect(read(file), `${file} should use bg-surface`).toMatch(/bg-surface\b/);
        }
    });

    it('neither paints its panel from the inverting text ramp', () => {
        // The specific regression: `bg-coffee` is `--text-strong`, 61 41 20 in
        // light and 232 227 220 in dark. As a panel it inverts the whole banner.
        for (const file of BANNERS) {
            expect(read(file).includes('bg-coffee'), `${file} is back on the text ramp`).toBe(false);
        }
    });

    it('both are still in the shared bottom slot, so this pairing still matters', () => {
        // A guard on the guard: if either stops being a bottom banner, the
        // reasoning above no longer applies and this block should be revisited
        // rather than left passing for the wrong reason.
        for (const file of BANNERS) {
            expect(read(file), `${file} no longer sits in the bottom slot`).toMatch(/fixed bottom-safe-nav/);
        }
    });
});
