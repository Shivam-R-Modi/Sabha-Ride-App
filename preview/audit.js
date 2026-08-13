/**
 * Accessibility audit for a rendered preview page.
 *
 * WHY THIS EXISTS
 * ---------------
 * tests/quality/theme-contrast.test.ts checks the TOKENS against each other.
 * That catches a bad palette but not a bad *pairing* — it cannot know that
 * someone put `text-on-accent` on top of the saturated `--success` rather than
 * `--success-fill`. That exact mistake shipped a filled "Approve" button at
 * 2.28:1, and only this audit found it.
 *
 * So: the tests guard the palette, this guards the composition.
 *
 * HOW TO RUN
 * ----------
 *   npx vite build --config preview/vite.config.ts
 *   npx vite preview --outDir preview-dist
 *
 * Open a page, paste this file into the console, then:
 *
 *   audit()        every text node below its WCAG AA threshold
 *   targets()      controls smaller than 44x44 that lack `tap-target`
 *
 * Do both themes by URL — /preview/rider.html and /preview/rider.html?theme=dark.
 *
 * ⚠ ALWAYS SET THE THEME VIA THE URL, NOT BY FLIPPING data-theme AT RUNTIME.
 *   Toggling it works fine in the real app, but a headless screenshot pipeline
 *   can hand back a frame from before the change, and getComputedStyle can
 *   return values from before the recalc. That combination produced a dark
 *   screen that photographed as light and ~20 phantom contrast failures which
 *   all evaporated once the page was loaded dark from the start. Half an hour
 *   went into chasing those; the URL parameter exists so nobody repeats it.
 */

/* eslint-disable no-undef */

const _lum = ([r, g, b]) => {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const _parse = s => { const m = (s || '').match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : null; };

/** Composite a possibly-translucent colour onto an opaque one. */
const _over = (fg, bg) => {
    const a = fg.length === 4 ? fg[3] : 1;
    return [0, 1, 2].map(i => Math.round(fg[i] * a + bg[i] * (1 - a)));
};

const _ratio = (a, b) => {
    const [hi, lo] = [_lum(a), _lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

/**
 * The colour actually behind an element, by walking ancestors and compositing
 * every translucent layer. Necessary because this design uses glass surfaces:
 * `backgroundColor` on the element itself is usually `rgba(...,0.88)` or
 * transparent, so reading it alone gives a meaningless answer.
 *
 * Gradients contribute their FIRST colour stop. Approximate, but the stops in
 * this design are within a shade of each other.
 */
const _effectiveBg = el => {
    const layers = [];
    let n = el;
    while (n && n !== document.documentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') {
            const stop = cs.backgroundImage.match(/rgba?\(([\d.,\s]+)\)/);
            if (stop) layers.push(_parse('rgb(' + stop[1] + ')'));
        }
        const c = _parse(cs.backgroundColor);
        if (c && (c.length === 3 || c[3] > 0)) layers.push(c);
        n = n.parentElement;
    }
    let base = (_parse(getComputedStyle(document.documentElement).backgroundColor)
        || _parse(getComputedStyle(document.body).backgroundColor)
        || [255, 255, 255]).slice(0, 3);
    for (let i = layers.length - 1; i >= 0; i--) base = _over(layers[i], base);
    return base;
};

/** Text nodes whose contrast is below the AA threshold for their size. */
function audit() {
    const problems = [];
    document.querySelectorAll('*').forEach(el => {
        // Only elements with their OWN text, or every ancestor reports its
        // children's failures too.
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;

        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.3) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;

        const fg = _parse(cs.color);
        if (!fg) return;
        const bg = _effectiveBg(el);
        const ratio = _ratio(_over(fg, bg), bg);

        const px = parseFloat(cs.fontSize);
        const bold = Number(cs.fontWeight) >= 700;
        // WCAG 1.4.3: large text is 24px, or 18.66px when bold.
        const need = (px >= 24 || (bold && px >= 18.66)) ? 3 : 4.5;

        if (ratio < need) {
            problems.push({
                text: el.textContent.trim().slice(0, 40),
                ratio: +ratio.toFixed(2), need, px: +px.toFixed(1), bold,
                fg: `rgb(${fg.slice(0, 3)})`, bg: `rgb(${bg})`,
            });
        }
    });
    console.table(problems);
    return problems;
}

/** Controls below the 44x44 minimum that do not expand their hit area. */
function targets() {
    const small = [];
    document.querySelectorAll('button,a[href],input,select,textarea,[role="button"]').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        if (String(el.className).includes('sr-only')) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;

        // `.tap-target` (index.css) grows the HIT area to 44x44 with a
        // pseudo-element while leaving the visual box small — so a small rect
        // there is not a small target.
        if (String(el.className).includes('tap-target')) return;

        if (r.height < 44 || r.width < 44) {
            small.push({
                tag: el.tagName.toLowerCase(),
                label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
                w: Math.round(r.width), h: Math.round(r.height),
            });
        }
    });
    console.table(small);
    return small;
}

if (typeof window !== 'undefined') Object.assign(window, { audit, targets });
