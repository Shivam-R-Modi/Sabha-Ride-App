/**
 * WHERE the notice board sits on the manager dashboard is the whole point of it
 * being there, and it is not something a DOM test can see.
 *
 * `.app-panel` is a fixed-height flex column. The tab content lives in
 * `flex-1 overflow-hidden`, so anything inserted as a SIBLING above it — at the
 * outer level, next to the tab bar — permanently steals height from whichever tab
 * is showing. During a sabha that is the waiting queue, which is the one thing a
 * manager cannot afford to have shrunk. That is why the board was left off this
 * screen when the board first shipped.
 *
 * The Waiting tab is not an option either: `RequestTable` returns `<EmptyState />`
 * before it ever renders its own scroller, so a board placed inside that scroller
 * would disappear exactly when a manager has time to read it — and placed above
 * the table it shrinks the queue again.
 *
 * So it belongs in the OTHER tab's `h-full overflow-y-auto` region, where it
 * scrolls with the ride cards and costs the queue nothing. Textual, because there
 * is no ManagerDashboard harness and standing one up would mean mocking useAuth,
 * six useFirestore hooks, the toast context, the confirm dialog and two callables
 * to assert a position.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
    path.resolve(__dirname, '../../components/manager/ManagerDashboard.tsx'), 'utf8',
);

/** Comments stripped: the file explains this placement in prose right beside it. */
const code = source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const at = (needle: string) => code.indexOf(needle);

describe('the notice board sits inside the manager dashboard scroll region', () => {
    it('is rendered at all', () => {
        expect(at('<NoticeBoard')).toBeGreaterThan(-1);
    });

    it('sits after the scrolling container, not above it', () => {
        const scroller = at('h-full overflow-y-auto');
        expect(scroller, 'the scrolling tab region went missing').toBeGreaterThan(-1);
        expect(at('<NoticeBoard')).toBeGreaterThan(scroller);
    });

    it('sits after RequestTable, so it is in the other tab and cannot shrink the queue', () => {
        const table = at('<RequestTable');
        expect(table).toBeGreaterThan(-1);
        expect(at('<NoticeBoard')).toBeGreaterThan(table);
    });

    it('is not a sibling of the fixed-height tab container', () => {
        // `flex-1 overflow-hidden` is the tab region. Anything before it is outer
        // chrome, and height taken there never comes back.
        const tabRegion = at('flex-1 overflow-hidden');
        expect(tabRegion).toBeGreaterThan(-1);
        expect(at('<NoticeBoard')).toBeGreaterThan(tabRegion);
    });

    it('appears exactly once', () => {
        // Two copies means one of them is in the wrong tab.
        expect(code.match(/<NoticeBoard/g) ?? []).toHaveLength(1);
    });
});
