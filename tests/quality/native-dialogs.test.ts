/**
 * Ratchets against the repo's recurring failure mode: UI that looks wired up and
 * silently does nothing.
 *
 * `window.confirm` is already banned — a suppressed dialog returns false, so
 * every destructive button took the "user said no" branch and did nothing.
 * `components/shared/useConfirm.tsx` replaced it.
 *
 * `window.alert` was never swept, and 27 calls remain. The harm is different but
 * the same family: a suppressed alert does not make the button inert (the write
 * already happened), it makes the FAILURE invisible. `alert('Failed to unassign
 * student')` in a context where dialogs are suppressed means the manager taps
 * unassign, it fails, and the screen says nothing at all. Browsers suppress
 * dialogs in sandboxed frames, in embedded webviews, and after the user ticks
 * "prevent this page from creating additional dialogs" — and this app ships as a
 * PWA, which is one of those contexts.
 *
 * These are ratchets, not pass/fail gates: the count may only go DOWN. Phase 2
 * of docs/plans/ui-ux-optimization.md replaces every remaining call with a toast
 * and drops the budget to zero.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SOURCE_DIRS = ['components', 'hooks', 'contexts', 'src'];

/** Every .ts/.tsx file under the app's own source directories. */
function sourceFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (entry === 'node_modules') continue;
                walk(full);
            } else if (/\.tsx?$/.test(entry)) {
                found.push(full);
            }
        }
    };
    for (const dir of SOURCE_DIRS) walk(path.join(ROOT, dir));
    return found;
}

/**
 * Calls to a global dialog function, ignoring comments and anything that is
 * plainly a property access (`foo.alert(`), which is not the global.
 */
function callSites(name: string): { file: string; line: number; text: string }[] {
    const pattern = new RegExp(`(?<![.\\w])(?:window\\.)?${name}\\s*\\(`);
    const hits: { file: string; line: number; text: string }[] = [];

    for (const file of sourceFiles()) {
        const lines = readFileSync(file, 'utf8').split('\n');
        let inBlockComment = false;

        lines.forEach((raw, i) => {
            const line = raw.trim();
            if (inBlockComment) {
                if (line.includes('*/')) inBlockComment = false;
                return;
            }
            if (line.startsWith('/*')) {
                if (!line.includes('*/')) inBlockComment = true;
                return;
            }
            if (line.startsWith('//') || line.startsWith('*')) return;

            if (pattern.test(raw)) {
                hits.push({ file: path.relative(ROOT, file), line: i + 1, text: line });
            }
        });
    }
    return hits;
}

const format = (hits: { file: string; line: number; text: string }[]) =>
    hits.map(h => `  ${h.file}:${h.line}  ${h.text}`).join('\n');

describe('native dialogs', () => {
    it('window.confirm stays banned — it silently returns false and makes buttons inert', () => {
        const hits = callSites('confirm');
        expect(hits, `window.confirm is banned. Use components/shared/useConfirm.tsx.\n${format(hits)}`)
            .toHaveLength(0);
    });

    /**
     * The budget. Lower it whenever calls are removed; never raise it.
     * Phase 2 takes it to 0.
     */
    const ALERT_BUDGET = 27;

    it(`window.alert is capped at ${ALERT_BUDGET} and may only go down`, () => {
        const hits = callSites('alert');

        expect(
            hits.length,
            hits.length > ALERT_BUDGET
                ? `New alert() calls were added. A suppressed alert makes failures invisible — ` +
                  `use a toast. Budget ${ALERT_BUDGET}, found ${hits.length}:\n${format(hits)}`
                : `alert() calls dropped to ${hits.length}. Lower ALERT_BUDGET in this file to ` +
                  `${hits.length} so the ratchet holds.`,
        ).toBe(ALERT_BUDGET);
    });

    it('no alert() has crept into the shared primitives, whatever the total is', () => {
        // Shared components are rendered inside every role's screens. An
        // invisible failure here is an invisible failure everywhere.
        const hits = callSites('alert').filter(h => h.file.includes('components/shared/'));
        expect(hits, format(hits)).toHaveLength(0);
    });
});
