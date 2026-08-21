/**
 * Switching to a tab shows that tab, not a loading screen first.
 *
 * Reported as "Reports has extra animation when switching to it". The animation
 * was innocent: `.animate-in` and `.fade-in` are both hardcoded to `0.3s` in
 * index.css, so every tab fades at the same speed and always did. Reports also
 * carried `duration-500`, which LOOKS like the culprit and is not — `duration-*`
 * is Tailwind's `transition-duration`, and it has no effect whatever on an
 * `animation`. It was a no-op sitting exactly where the bug appeared to be.
 *
 * The real difference was a whole-screen loading state:
 *
 *     if (loading) return <spinner + "LOADING REPORTS..." />;
 *
 * So switching to Reports was a two-step no other tab did — the page replaced by
 * a spinner, then the page fading in — while its siblings render their frame
 * immediately and show loading inside it, the way ManagerPeople does. The header
 * and export buttons on that screen never depended on the fetch at all.
 *
 * WHY THIS GUARD AND NOT A DURATION ONE
 * -------------------------------------
 * The first version of this file pinned every tab to `duration-300`. It passed,
 * and it was worthless: it asserted a class that changes nothing on an animated
 * element. A guard that pins a no-op is worse than no guard, because it reads
 * like cover. This pins the thing that was actually wrong.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

/** Comments stripped, so the guard cannot match its own explanation. */
const code = (file: string) => readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every component App.tsx renders for a tab. */
function tabComponents(): string[] {
    const app = code(path.join(ROOT, 'App.tsx'));
    const names = new Set<string>();
    for (const [, name] of app.matchAll(/case\s+'[a-z]+'\s*:\s*(?:\n\s*)?(?:return\s*)?<([A-Z]\w+)/g)) {
        names.add(name!);
    }
    return [...names];
}

function findFile(component: string): string | null {
    const hits: string[] = [];
    const walk = (dir: string) => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (entry === `${component}.tsx`) hits.push(full);
        }
    };
    walk(path.join(ROOT, 'components'));
    return hits[0] ?? null;
}

/**
 * An early return that replaces the entire screen while data loads.
 *
 * `if (loading) return <…Loader2…>` at the top level of the component, before the
 * real render. A spinner INSIDE the page is fine and is the pattern this wants.
 */
function replacesScreenWhileLoading(file: string): boolean {
    const src = code(file);
    // Non-greedy up to the closing of that return, so the match cannot run on
    // into the component's real markup.
    const early = /if\s*\(\s*\w*[Ll]oading\w*\s*\)\s*\{?\s*return\s*\(([\s\S]{0,600}?)\);/g;
    for (const [, returned] of src.matchAll(early)) {
        if (/Loader2|animate-spin|animate-pulse/.test(returned)) return true;
    }
    return false;
}

describe('a tab shows the tab, not a loading screen', () => {
    const components = tabComponents();

    it('reads the tab list out of App.tsx (the parser works)', () => {
        // A parser that finds nothing makes the rule below vacuously true, which
        // is how a ratchet dies quietly.
        expect(components).toContain('ManagerReports');
        expect(components.length).toBeGreaterThanOrEqual(7);
    });

    it('no tab replaces its whole screen with a spinner', () => {
        const offenders = components
            .map(name => ({ name, file: findFile(name) }))
            .filter((c): c is { name: string; file: string } => c.file !== null)
            .filter(c => replacesScreenWhileLoading(c.file))
            .map(c => `${c.name}  (${path.relative(ROOT, c.file)})`);

        expect(
            offenders,
            `These tabs return a loading screen instead of rendering, so switching ` +
            `to them is a two-step that no other tab does. Render the frame and ` +
            `show the loading state inside it, as ManagerPeople does:\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
    });
});
