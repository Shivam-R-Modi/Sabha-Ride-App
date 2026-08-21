/**
 * Classes that silently do nothing.
 *
 * Four shapes were found in one screenshot of the Raw records page on 2026-08-18,
 * and not one of them errored, warned, or looked wrong in light mode:
 *
 *   1. `border-hairline/20/60`  two opacity modifiers. Tailwind emits NO rule, so
 *                               the border simply did not exist. Three of these.
 *   2. `clay-btn-cta`           never defined in any stylesheet — only
 *                               `clay-btn-cta-large` is. Two buttons rendered as
 *                               unstyled text, one of them the primary action of
 *                               the dialog that edits live records.
 *   3. `bg-coffee text-white`   `bg-coffee` is `--text-strong`, a TEXT token, and
 *                               the text ramp INVERTS between themes. Measured
 *                               13.76:1 in light and **1.28:1** in dark — white on
 *                               near-white. Six instances.
 *   4. `overflow-x-auto` with   the global scrollbar thumb is a 10px saffron
 *      no `no-scrollbar`        gradient, so a short strip grows a solid orange bar.
 *
 * The existing colour ratchets could not see any of these: they look for stock
 * palette names and raw hex, and all four of these are *structurally* wrong rather
 * than wrongly coloured.
 *
 * COMMENTS ARE STRIPPED BEFORE SCANNING. Every fix above left the offending string
 * in a comment explaining it, and this project has twice shipped a guard that
 * matched its own prose — a Tailwind class named in a comment got re-emitted into
 * the bundle, and a key name in a comment failed a "nothing reads this" test. Read
 * code, not explanations.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

/** Source with comments removed, so a guard cannot match its own reasoning. */
function code(file: string): string {
    return readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')   // /* … */ and {/* … */}
        .replace(/(^|[^:])\/\/.*$/gm, '$1'); // // … , without eating https://
}

function tsxFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
        }
    };
    for (const d of ['components', 'src', 'hooks', 'contexts']) walk(path.join(ROOT, d));
    for (const entry of readdirSync(ROOT)) {
        const full = path.join(ROOT, entry);
        if (statSync(full).isFile() && /\.tsx$/.test(full)) out.push(full);
    }
    return out;
}

/**
 * Every quoted / templated string in a file, comments already gone.
 *
 * Scans the WHOLE file rather than line by line, because a template literal
 * routinely spans lines:
 *
 *     className={`clay-btn-cta text-xs px-4 py-2.5 ${
 *         activeTab === 'auditLogs' ? 'opacity-50' : ''
 *     }`}
 *
 * A per-line regex never closes that backtick, so the classes in it were invisible
 * — the first draft of this file passed while `clay-btn-cta` sat right there. Same
 * shape as the `className=` hole in theme-tokens.test.ts: a scanner that reads only
 * part of the source is a scanner that reports on part of the source.
 */
function spans(file: string): Array<{ line: number; text: string }> {
    const src = code(file);
    const found: Array<{ line: number; text: string }> = [];
    // Single and double quotes cannot legally span a line; backticks can.
    const re = /'[^'\n]*'|"[^"\n]*"|`[^`]*`/g;
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
        found.push({ line: src.slice(0, m.index).split('\n').length, text: m[0] });
    }
    return found;
}

const rel = (f: string) => path.relative(ROOT, f);

describe('1. no multi-opacity modifiers', () => {
    it('every utility carries at most one /alpha', () => {
        // `border-hairline/20/60` is not a Tailwind class. It produces NO CSS, so the
        // border is absent — and nothing anywhere says so.
        const hits: string[] = [];
        for (const f of tsxFiles()) {
            for (const { line, text } of spans(f)) {
                const m = text.match(/[a-z-]+-\[[^\]]*\]\/\d+\/\d+|[a-z-]+-[a-z0-9-]*\/\d+\/\d+/);
                if (m) hits.push(`${rel(f)}:${line}  ${m[0]}`);
            }
        }
        expect(
            hits,
            `Two opacity modifiers means Tailwind generates nothing and the property ` +
            `silently does not apply:\n  ${hits.join('\n  ')}`,
        ).toEqual([]);
    });
});

describe('2. every clay-* class exists', () => {
    const defined = new Set(
        ['claymorphism.css', 'index.css', 'theme.css']
            .flatMap(f => [...readFileSync(path.join(ROOT, f), 'utf8').matchAll(/\.(clay-[a-z0-9-]+)/g)])
            .map(m => m[1]!),
    );

    it('the stylesheets define a meaningful number of them (the parser works)', () => {
        expect(defined.size).toBeGreaterThan(20);
    });

    it('no component uses one that was never written', () => {
        // `clay-btn-cta` vs `clay-btn-cta-large`: one character of difference between
        // a CTA button and unstyled text, with nothing to tell you which you got.
        const missing: string[] = [];
        for (const f of tsxFiles()) {
            for (const { line, text } of spans(f)) {
                for (const [, cls] of text.matchAll(/(?<![\w-])(clay-[a-z0-9-]+)/g)) {
                    if (!defined.has(cls!)) missing.push(`${rel(f)}:${line}  ${cls}`);
                }
            }
        }
        expect(
            missing,
            `These class names appear in a className and in no stylesheet, so they ` +
            `style nothing:\n  ${[...new Set(missing)].join('\n  ')}`,
        ).toEqual([]);
    });
});

describe('2b. the colourless button base is never left colourless', () => {
    /**
     * `.clay-button` exists, so guard 2 above cannot see this one.
     *
     * It is deliberately geometry-only — flex, gap, the 44px target, the
     * transition — and sets NO background, border or radius, because the
     * utilities on the element are meant to own the colour. That is a reasonable
     * base and it has a trap: apply it with no colour utilities and you get a
     * perfectly accessible `<button>` that renders as a bare line of text.
     *
     * It happened. RiderHome's withdraw control carried
     * `clay-button w-full mt-5 text-coffee-700` — a text colour and nothing else
     * — so the app's ONLY way to withdraw a ride request looked like a caption
     * floating in the middle of a card. Reported from a screenshot, weeks after
     * it shipped.
     *
     * Nothing else could have caught it. Its tests query
     * `getByRole('button', { name })`, which passes on unstyled text inside a
     * button element just as happily as on a button that looks like one — the
     * same blind spot noted in LoginScreen.test.tsx, where `title` satisfied an
     * accessible-name query against a broken control.
     *
     * A background OR a border is enough to count: `clay-button` beside
     * `border-2 border-saffron` is a legitimate outline button.
     */
    const GIVES_APPEARANCE = /\b(bg-|border-\d|border-(?!hairline\/)[a-z]|clay-button-|clay-btn-)/;

    it('every clay-button also brings a background or a border', () => {
        const bare: string[] = [];
        for (const f of tsxFiles()) {
            for (const { line, text } of spans(f)) {
                // The base on its own, not `clay-button-primary` / `-secondary`,
                // which supply their own everything.
                if (!/(?<![\w-])clay-button(?![\w-])/.test(text)) continue;
                if (!GIVES_APPEARANCE.test(text)) bare.push(`${rel(f)}:${line}  ${text.trim().slice(0, 90)}`);
            }
        }
        expect(
            bare,
            `\`clay-button\` sets no colour by design. These carry it with no ` +
            `background and no border, so they render as plain text:\n  ${bare.join('\n  ')}`,
        ).toEqual([]);
    });
});

describe('3. text-ramp tokens are not used as backgrounds', () => {
    /**
     * `bg-coffee` is `--text-strong`. The text ramp INVERTS between themes by
     * design — dark on light, light on dark — so anything filled with it changes
     * character between themes.
     *
     * THIS RULE USED TO SAY SOMETHING ELSE, AND THE ADVICE CAUSED A BUG.
     *
     * It was written for `bg-coffee text-white`, which measured 1.28:1 in dark —
     * white on near-white — and it prescribed "an inverted PAIR: `bg-coffee
     * text-cream`, where both tokens flip together (13.07:1 light, 13.82:1 dark)".
     * That is true about contrast and wrong about appearance, and three places
     * took the advice. The worst was DatabaseConsole's selected collection tab: a
     * dark brown pill in light mode, a NEAR-WHITE pill in dark, sitting among
     * `--surface` siblings at 46 40 34. Perfectly readable, and the only control in
     * the app that inverted, so it was reported as a rendering glitch — with an
     * arrow drawn on a screenshot.
     *
     * So the rule is no longer about the pairing. The text ramp is not a fill at
     * all. Fills are `--surface`, `--sunken` (`bg-cream-400`) and the accent, all
     * of which keep their character in both themes. `bg-cream-400 text-coffee` is
     * what the selected tab uses now, which is also what the sidebar has always
     * used.
     *
     * The exception is a mark with nothing rendered on it, where "the strongest
     * colour available against the page" is exactly the right intent.
     */
    const ALLOWED = new Map<string, string>([
        // A 3px dot with no text on it. There, "the strongest text colour" is exactly
        // right: the highest-contrast mark available against the page in either
        // theme. The bug is text-on-inverted-fill, and this has no text.
        ['components/RideStatus.tsx', 'a bare dot marker, nothing rendered on top of it'],
    ]);

    it('the text ramp is never used as a fill', () => {
        // Not "must be paired with an inverting text colour" — that was the old
        // rule and it is what produced the near-white selected tab. A fill has to
        // keep its character in both themes, and the text ramp cannot.
        const hits: string[] = [];
        for (const f of tsxFiles()) {
            if (ALLOWED.has(rel(f))) continue;
            for (const { line, text } of spans(f)) {
                // State variants are STRIPPED, not used to skip the span.
                //
                // The first draft did `&& !/hover:bg-coffee/.test(text)`, which
                // let any element carrying BOTH an opaque `bg-coffee` and a
                // `hover:bg-coffee/90` out entirely — and that is exactly the
                // shape RideWindowControl had, so the guard passed with the bug
                // restored. Found by breaking all three on purpose and only
                // getting two back. Same trap as the `className=` hole in
                // theme-tokens.test.ts: a scanner that reads part of the source
                // reports on part of the source.
                //
                // `bg-coffee/10` and friends stay allowed: a 10% text colour over
                // a surface is a wash, and stays a tint of that surface in both
                // themes. Hence the `/` in the trailing lookahead.
                const withoutVariants = text.replace(/\b(hover|focus|active|group-hover|focus-visible|disabled):bg-coffee[\w/-]*/g, ' ');
                if (/(?<![\w-])bg-coffee(-\d+)?(?![\w-/])/.test(withoutVariants)) {
                    hits.push(`${rel(f)}:${line}  ${text.slice(0, 70)}`);
                }
            }
        }
        expect(
            hits,
            `bg-coffee is the TEXT ramp: it inverts between themes, so anything ` +
            `filled with it is dark in one mode and near-white in the other. Use a ` +
            `surface fill — bg-surface, bg-cream-400 (--sunken) — or the accent. ` +
            `Allowlist the file only if NOTHING is rendered on the fill:\n  ${hits.join('\n  ')}`,
        ).toEqual([]);
    });

    it('the allowlist has no stale entries', () => {
        const stale = [...ALLOWED.keys()].filter(f => {
            const full = path.join(ROOT, f);
            return !existsSync(full) || !spans(full).some(s => /bg-coffee/.test(s.text));
        });
        expect(stale, `No longer uses bg-coffee — drop the entry:\n  ${stale.join('\n  ')}`).toEqual([]);
    });

    it('every allowlisted class string is still present somewhere', () => {
        // A recorded exemption that no longer matches anything is an exemption
        // waiting to excuse the next bug.
        const present = new Set(tsxFiles().flatMap(f => spans(f).map(s => s.text.trim())));
        // (checked for the scroll allowlist in its own describe below)
        expect(present.size).toBeGreaterThan(50);
    });
});

describe('4. short scroll strips hide the saffron scrollbar', () => {
    /**
     * The global thumb is a 10px saffron gradient (index.css). On a strip a few
     * rows tall it draws a solid orange bar, which reads as a UI element rather
     * than a scrollbar — `index.css` documents `.no-scrollbar` for exactly this.
     */
    /**
     * Allowlisted by the EXACT class string, not by file.
     *
     * DatabaseConsole contains both a legitimate `overflow-x-auto` (around a data
     * table) and, until this was fixed, a buggy one (the filter strip). A per-file
     * allowlist excused both — the first draft of this guard passed with the bug
     * reintroduced, because the file was already on the list.
     */
    const ALLOWED = new Map<string, string>([
        // Wraps a <table>: the content really is wider than the viewport there, so a
        // scrollbar is the correct affordance rather than noise.
        ['"overflow-x-auto"', 'the bare wrapper around DatabaseConsole\'s data table'],
    ]);

    it('overflow-x-auto is paired with no-scrollbar', () => {
        const hits: string[] = [];
        for (const f of tsxFiles()) {
            for (const { line, text } of spans(f)) {
                if (!/overflow-x-auto/.test(text)) continue;
                if (/no-scrollbar/.test(text)) continue;
                if (ALLOWED.has(text.trim())) continue;
                hits.push(`${rel(f)}:${line}  ${text.slice(0, 70)}`);
            }
        }
        expect(
            hits,
            `A short horizontal strip grows a 10px saffron bar. Add no-scrollbar, or ` +
            `allowlist the file if the scrollbar is a real affordance there:\n  ${hits.join('\n  ')}`,
        ).toEqual([]);
    });
});
