/**
 * Ratchets against the repo's recurring failure mode: UI that looks wired up and
 * silently does nothing.
 *
 * `window.confirm` is already banned — a suppressed dialog returns false, so
 * every destructive button took the "user said no" branch and did nothing.
 * `components/shared/useConfirm.tsx` replaced it.
 *
 * `window.alert` went unswept far longer — 27 calls, all removed in Phase 2. The
 * harm is different but from the same family: a suppressed alert does not make
 * the button inert (the write already happened), it makes the FAILURE invisible.
 * `alert('Failed to unassign student')` where dialogs are suppressed means the
 * manager taps unassign, it fails, and the screen says nothing at all. Browsers
 * suppress dialogs in sandboxed frames, in embedded webviews, and after the user
 * ticks "prevent this page from creating additional dialogs" — and this app
 * ships as a PWA, which is one of those contexts.
 *
 * `alert`, `confirm` and `prompt` are now flat bans. The overlay count further
 * down is still a ratchet: it may only fall.
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
     * Was a ratchet at 27 while Phase 2 worked through them. Now zero, and it
     * stays zero — this is a ban, like `confirm` above.
     */
    it('window.alert is banned too — a suppressed alert hides the failure', () => {
        const hits = callSites('alert');
        expect(
            hits,
            `Use useToast() from contexts/ToastContext. A suppressed alert does not make ` +
            `the button inert — the write already happened — it makes the FAILURE ` +
            `INVISIBLE.\n${format(hits)}`,
        ).toHaveLength(0);
    });

    it('window.prompt is banned as well, for the same reason', () => {
        // Not currently used anywhere. Asserted so it cannot arrive later as
        // the "quick" way to collect a value — suppressed, it returns null and
        // the caller silently takes the cancel path.
        const hits = callSites('prompt');
        expect(hits, format(hits)).toHaveLength(0);
    });
});

/**
 * Hand-rolled overlays.
 *
 * Twelve files built their own `fixed inset-0` modal and exactly one announced
 * itself as a dialog. `components/shared/Sheet.tsx` now provides the real thing
 * — focus trap, scroll lock, Escape, focus restored to the opener — and
 * useConfirm is migrated onto it, which upgrades every destructive action in
 * the app at once.
 *
 * The rest are migrated by the phase that rewrites their screen, so this is a
 * ratchet rather than a ban: the count may only fall. Rewriting a screen and
 * leaving its bespoke overlay behind should fail the build.
 */
describe('hand-rolled overlays', () => {
    const OVERLAY_BUDGET = 5;

    /**
     * Full-bleed layers that are not dialogs and should never become Sheets:
     *
     *   Sheet.tsx       is the primitive itself.
     *   SplashScreen    is a whole screen, not something layered over one. It
     *                   has nothing behind it to trap focus away from.
     *   RoleSwitcher    is the invisible click-catcher behind a dropdown menu.
     *                   A dropdown is not modal — Escape and click-away are its
     *                   whole interaction, and making it a dialog would trap
     *                   focus in a three-item menu.
     */
    const NOT_DIALOGS = ['shared/Sheet.tsx', 'auth/SplashScreen.tsx', 'RoleSwitcher.tsx'];

    /** A `fixed inset-0` that ought to be a Sheet and is not one yet. */
    function overlays(): { file: string; line: number; text: string }[] {
        const hits: { file: string; line: number; text: string }[] = [];
        for (const file of sourceFiles()) {
            const relative = path.relative(ROOT, file);
            if (NOT_DIALOGS.some(exempt => relative.endsWith(exempt))) continue;

            readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                if (/fixed inset-0/.test(line) && !/pointer-events-none/.test(line)) {
                    hits.push({ file: relative, line: i + 1, text: line.trim() });
                }
            });
        }
        return hits;
    }

    it(`is capped at ${OVERLAY_BUDGET} and may only go down`, () => {
        const hits = overlays();
        expect(
            hits.length,
            hits.length > OVERLAY_BUDGET
                ? `A new hand-rolled overlay appeared. Use <Sheet> — it traps focus, locks ` +
                  `background scroll, closes on Escape and restores focus.\n${format(hits)}`
                : `Down to ${hits.length}. Lower OVERLAY_BUDGET to ${hits.length}.`,
        ).toBe(OVERLAY_BUDGET);
    });

    it('the shared confirm dialog is not one of them', () => {
        // Every destructive action in the app routes through useConfirm, so it
        // was the one worth migrating before any screen rewrite.
        const hits = overlays().filter(h => h.file.includes('useConfirm'));
        expect(hits, format(hits)).toHaveLength(0);
    });
});
