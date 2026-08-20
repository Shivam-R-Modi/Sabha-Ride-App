/**
 * `html` must paint itself, and the page must not rubber-band.
 *
 * Only `body` had a background. Anything the body does not cover therefore fell
 * through to the browser's default canvas — PURE BLACK in dark mode — and it showed
 * up twice on a real phone:
 *
 *   · pull the page past the top and a black band appears above the app, on mobile
 *     and on desktop, anywhere the scroll rubber-bands;
 *   · a black strip below the splash screen.
 *
 * The diagnosis came from the COLOUR, and that is the part worth keeping: this
 * app's dark canvas is `rgb(28 24 21)`, a warm near-black. What appeared was pure
 * black — a colour `theme.css` does not contain anywhere. So it could not have been
 * the app painting it, which ruled out every component and pointed at the one
 * element with no background rule.
 *
 * Verified in the browser after the fix: html computes rgb(28 24 21) in dark and
 * rgb(250 249 246) in light, and overscroll-behavior is none on both axes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const css = readFileSync(path.join(ROOT, 'index.css'), 'utf8');
const splash = readFileSync(path.join(ROOT, 'components/auth/SplashScreen.tsx'), 'utf8');

/** The `html { … }` rule body, comments stripped. */
const htmlRule = (() => {
    const start = css.search(/^html\s*\{/m);
    if (start === -1) throw new Error('index.css has no html rule');
    const body = css.slice(start, css.indexOf('\n}', start));
    return body.replace(/\/\*[\s\S]*?\*\//g, '');
})();

describe('the root element paints itself', () => {
    it('declares a background on html, not only on body', () => {
        expect(
            htmlRule,
            'without this, overscroll and the safe areas show the browser default — black in dark mode',
        ).toMatch(/background(-color)?\s*:/);
    });

    it('uses the canvas TOKEN, so it follows the theme', () => {
        // A hardcoded colour here is the `bg-coffee` trap in another costume: right
        // in one theme, wrong in the other, and only visible in overscroll where
        // nobody looks.
        expect(htmlRule).toMatch(/var\(--canvas\)/);
    });

    it('never hardcodes a colour on html', () => {
        expect(htmlRule).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        expect(htmlRule).not.toMatch(/background[^;]*rgb\(\s*\d/);
    });

    it('stops the document rubber-banding', () => {
        expect(htmlRule).toMatch(/overscroll-behavior\s*:\s*none/);
    });
});

describe('the splash screen reaches the bottom of a phone', () => {
    it('paints past the bottom on a separate layer from the content', () => {
        // Both units, deliberately: `svh` for the content box so the tap line stays
        // above browser chrome, `lvh` (+ the inset) for the photograph so no strip
        // is left when that chrome retracts. Sizing ONE element to lvh was tried and
        // sliced "Tap to continue" in half. Behaviour lives in
        // tests/components/SplashScreen.test.tsx; this is the CSS shape.
        expect(splash).toMatch(/100svh/);
        expect(splash).toMatch(/100lvh/);
        expect(splash).toMatch(/env\(safe-area-inset-bottom/);
    });

    it('never dismisses itself', () => {
        // The tap is the only way out, by the owner's decision. A timer here would
        // undo it silently; the behavioural proof is in
        // tests/components/SplashScreen.test.tsx.
        expect(splash).not.toMatch(/setTimeout/);
        expect(splash).not.toMatch(/SPLASH_MS/);
    });

    it('has a dark colour behind the photo', () => {
        // For the moment before the image decodes, and any sliver the crop misses.
        expect(splash).toMatch(/backgroundColor:\s*'#1C1815'/);
    });

    it('does NOT use a theme token for that fallback', () => {
        // The splash is dark in both themes, so `--canvas` would put a near-white
        // band under a dark photograph in light mode.
        const style = splash.slice(splash.indexOf('backgroundColor'), splash.indexOf('backgroundRepeat'));
        expect(style).not.toMatch(/var\(--canvas\)/);
    });
});
