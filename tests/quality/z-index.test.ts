/**
 * The stacking ladder, and the one rule that makes it mean anything.
 *
 * THE BUG THIS PREVENTS
 * ---------------------
 * The app header is `position: sticky` with a z-index. That combination
 * CREATES A STACKING CONTEXT, which means every z-index *inside* the header is
 * resolved against its siblings inside the header — and then the whole header
 * competes with the rest of the page as a single unit at its own z-index.
 *
 * So when the header sat on `z-sticky` (100), the role-switcher menu's
 * `z-dropdown` (1000) was not worth 1000 to the rest of the page. It was worth
 * 100. And four in-page sticky headers — the manager's tab strip, RequestTable,
 * ActiveRide, AssignmentPreview — also sit on `z-sticky` (100) and all appear
 * LATER in the DOM. Equal z-index, later in document order, so they won: the
 * open menu was painted over by the page underneath it.
 *
 * The bigger number lost to the smaller one, which is why reading the class
 * names is not enough to catch this and a test that only checked "dropdown >
 * sticky" would have passed the whole time it was broken.
 *
 * `chrome` (200) is the fix: chrome outranks page content, so anything opened
 * from chrome clears page content too. These tests hold that in place.
 *
 * WHAT THESE CANNOT DO
 * --------------------
 * jsdom has no layout and no compositor, so nothing here can actually observe
 * paint order. The real before/after was confirmed in a browser against the
 * compiled CSS with document.elementFromPoint: header on z-sticky returned the
 * tab strip, header on z-chrome returned the dropdown. These tests guard the
 * inputs to that result — the ladder's ordering, and which rung each element
 * is on.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const config = read('tailwind.config.js');
const layout = read('components/Layout.tsx');
const roleSwitcher = read('components/RoleSwitcher.tsx');

/** The zIndex block from tailwind.config.js, as name -> number. */
function ladder(): Record<string, number> {
    const start = config.indexOf('zIndex: {');
    if (start === -1) throw new Error('tailwind.config.js has no zIndex block');

    const body = config.slice(start, config.indexOf('}', start));
    const rungs: Record<string, number> = {};
    for (const [, name, value] of body.matchAll(/(\w+):\s*'(\d+)'/g)) {
        rungs[name] = Number(value);
    }
    return rungs;
}

describe('the stacking ladder is ordered', () => {
    const z = ladder();

    it('defines every rung the app uses', () => {
        expect(Object.keys(z).sort()).toEqual(
            ['base', 'chrome', 'dropdown', 'modal', 'raised', 'sticky', 'toast'],
        );
    });

    it('climbs strictly, so no two rungs can tie', () => {
        const order = ['base', 'raised', 'sticky', 'chrome', 'dropdown', 'modal', 'toast'];
        const values = order.map(name => z[name]);

        expect(values).toEqual([...values].sort((a, b) => a - b));
        expect(new Set(values).size).toBe(values.length);
    });

    it('puts chrome above in-page sticky', () => {
        // The whole point. If these ever tie again, DOM order decides which
        // wins, and page content is always later in the DOM than the header.
        expect(z.chrome).toBeGreaterThan(z.sticky);
    });

    it('keeps modal and toast above chrome', () => {
        // A modal must cover the header, not slide underneath it.
        expect(z.modal).toBeGreaterThan(z.chrome);
        expect(z.toast).toBeGreaterThan(z.modal);
    });
});

describe('chrome sits on the chrome rung', () => {
    it('the mobile header does', () => {
        const header = layout.match(/<header className="app-header[^"]*"/)?.[0] ?? '';
        expect(header).toContain('z-chrome');
        expect(header).not.toContain('z-sticky');
    });

    it('the desktop sidebar does — it holds a role switcher too', () => {
        const aside = layout.match(/<aside className=\{`[^`]*`/)?.[0] ?? '';
        expect(aside).toContain('z-chrome');
        expect(aside).not.toContain('z-sticky');
    });
});

describe('page content stays off the chrome rung', () => {
    /** Every component that pins a header inside the scrolling page. */
    const inPageSticky = [
        'components/manager/ManagerDashboard.tsx',
        'components/manager/RequestTable.tsx',
        'components/driver/ActiveRide.tsx',
        'components/driver/AssignmentPreview.tsx',
    ];

    it.each(inPageSticky)('%s does not claim z-chrome', file => {
        // Promoting one of these to chrome would re-create the tie this whole
        // ladder exists to remove — and it would do it silently.
        expect(read(file)).not.toContain('z-chrome');
    });

    it('pins every `sticky top-0` header below chrome', () => {
        const z = ladder();

        for (const file of inPageSticky) {
            // Only the pinned headers. These files also contain modals, and a
            // modal SHOULD outrank chrome — it covers the header rather than
            // sliding under it. Asserting "everything here is below chrome"
            // fails on those, and rightly so.
            const pinned = [...read(file).matchAll(
                /className=(?:"|\{`)[^"`]*\bsticky\b[^"`]*"|className=(?:"|\{`)[^"`]*\bshrink-0\b[^"`]*"/g,
            )].map(m => m[0]);

            for (const el of pinned) {
                const rung = el.match(/\bz-(base|raised|sticky|chrome|dropdown|modal|toast)\b/)?.[1];
                if (!rung) continue;
                expect(z[rung], `${file}: pinned header on z-${rung}`).toBeLessThan(z.chrome);
            }
        }
    });

    it('still lets overlays cover the header', () => {
        // The other half of the rule, so narrowing the test above cannot
        // quietly permit a modal that opens BEHIND the header.
        const z = ladder();
        const dash = read('components/manager/ManagerDashboard.tsx');

        expect(dash).toContain('z-modal');
        expect(z.modal).toBeGreaterThan(z.chrome);
    });
});

describe('the role menu still asks for the dropdown rung', () => {
    it('the menu and its backdrop are both on z-dropdown', () => {
        // Inside the header's stacking context these resolve against each
        // other, not against the page — but they must still agree, or the
        // backdrop covers the menu it is meant to sit behind.
        const hits = roleSwitcher.match(/z-dropdown/g) ?? [];
        expect(hits).toHaveLength(2);
    });

    it('uses no raw numeric z-index', () => {
        expect(roleSwitcher).not.toMatch(/\bz-\d+\b/);
        expect(roleSwitcher).not.toMatch(/zIndex:/);
    });
});
