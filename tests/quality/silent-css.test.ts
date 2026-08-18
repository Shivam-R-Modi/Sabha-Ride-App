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

describe('3. text-ramp tokens are not used as backgrounds', () => {
    /**
     * `bg-coffee` is `--text-strong`. The text ramp INVERTS between themes by
     * design — dark on light, light on dark — so anything using it as a background
     * flips from dark to light, and whatever text sits on it stops being readable
     * in exactly one theme. `bg-coffee text-white` measured 1.28:1 in dark.
     *
     * The fix is an inverted PAIR: `bg-coffee text-cream`, where both tokens flip
     * together (13.07:1 light, 13.82:1 dark).
     */
    const ALLOWED = new Map<string, string>([
        // A 3px dot with no text on it. There, "the strongest text colour" is exactly
        // right: the highest-contrast mark available against the page in either
        // theme. The bug is text-on-inverted-fill, and this has no text.
        ['components/RideStatus.tsx', 'a bare dot marker, nothing rendered on top of it'],
    ]);

    it('bg-coffee is always paired with text-cream', () => {
        // The rule is the PAIRING, not a ban. `bg-coffee` is a legitimate
        // maximum-contrast fill; what breaks is putting a non-inverting text colour
        // on it. So: if a span sets bg-coffee, it must set text-cream in the same
        // breath. `bg-coffee text-white` fails. So does bg-coffee with no text
        // colour at all, which inherits whatever the parent had.
        const hits: string[] = [];
        for (const f of tsxFiles()) {
            if (ALLOWED.has(rel(f))) continue;
            for (const { line, text } of spans(f)) {
                const usesFill = /(?<![\w-])bg-coffee(-\d+)?(\/\d+)?(?![\w-])/.test(text)
                    && !/hover:bg-coffee/.test(text);
                if (usesFill && !/(?<![\w-])text-cream(-\d+)?(\/\d+)?(?![\w-])/.test(text)) {
                    hits.push(`${rel(f)}:${line}  ${text.slice(0, 70)}`);
                }
            }
        }
        expect(
            hits,
            `bg-coffee is the TEXT ramp and inverts between themes, so text on it must ` +
            `invert too. Pair it with text-cream (13.07:1 light, 13.82:1 dark), or ` +
            `allowlist the file if nothing is rendered on the fill:\n  ${hits.join('\n  ')}`,
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
