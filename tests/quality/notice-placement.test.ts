/**
 * WHERE the notice board sits on each screen, which is not something a DOM test
 * can see cheaply.
 *
 * Textual, because there is no ManagerDashboard harness and standing one up would
 * mean mocking useAuth, six useFirestore hooks, the toast context, the confirm
 * dialog and two callables to assert a position. RiderHome and DriverShift do have
 * harnesses, and both assert their own order there too — this file is the ratchet
 * that survives a refactor moving JSX around.
 *
 * REPLACES manager-notice-placement.test.ts, whose five cases pinned the board
 * carefully INSIDE the manager dashboard's scroll region — after `RequestTable`,
 * after `flex-1 overflow-hidden`, exactly once. All five were correct, and all
 * five described a screen that no longer carries the board at all. The history is
 * in git; the reasoning that replaced it is below.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Comments stripped: every one of these files explains itself in prose beside the JSX. */
const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the manager dashboard does not carry the notice board', () => {
    /**
     * Removed 2026-08-24 at the owner's request. A manager WRITES the notices, and
     * Notices → "On the board now" already shows them exactly as everyone else
     * sees them, so a second copy on the dispatch screen was pushing the request
     * queue down to repeat what its author already knew.
     */
    const code = read('components/manager/ManagerDashboard.tsx');

    it('renders no board', () => {
        expect(code).not.toMatch(/<NoticeBoard/);
    });

    it('does not import it either', () => {
        // An unused import is how a removed component quietly comes back.
        expect(code).not.toMatch(/from '\.\.\/shared\/NoticeBoard'/);
    });

    it('still renders the request queue it was pushing down', () => {
        // A canary: if this file stopped being the dispatch screen the assertions
        // above would pass for the wrong reason.
        expect(code).toMatch(/<RequestTable/);
    });
});

describe("the board sits below the rider's action", () => {
    /**
     * It used to sit directly under the greeting and above the state card. Two
     * notices carrying flyers pushed "Request a ride" off the first screen
     * entirely — the board was burying the one thing the page exists for.
     */
    const code = read('components/student/RiderHome.tsx');
    const at = (needle: string) => code.indexOf(needle);

    it('renders the board', () => {
        expect(at('<NoticeBoard')).toBeGreaterThan(-1);
    });

    it('renders it after the state card, which holds the request button', () => {
        const card = at('{card()}');
        expect(card, 'the state card went missing').toBeGreaterThan(-1);
        expect(at('<NoticeBoard')).toBeGreaterThan(card);
    });

    it('renders it after the greeting, not above the page title', () => {
        expect(at('<NoticeBoard')).toBeGreaterThan(at('Jai Swaminarayan'));
    });

    it('appears exactly once', () => {
        expect(code.match(/<NoticeBoard/g) ?? []).toHaveLength(1);
    });
});

describe("the board sits below the Sarthi's shift controls", () => {
    /**
     * Same decision, same reason, on the other dashboard. The slot was called
     * `afterHeader` and rendered between the name and the shift card; it is
     * `afterShift` now and renders after the whole shift group, end-shift control
     * included. Squeezing the board between two controls of one decision would be
     * worse than either end.
     */
    const code = read('components/driver/DriverShift.tsx');
    const at = (needle: string) => code.indexOf(needle);

    it('renders the slot', () => {
        expect(at('{afterShift}')).toBeGreaterThan(-1);
    });

    it('renders it after the primary shift control', () => {
        const primary = at('onClick={hasCar ? onFindRiders : onOpenVehiclePicker}');
        expect(primary, 'the primary shift button went missing').toBeGreaterThan(-1);
        expect(at('{afterShift}')).toBeGreaterThan(primary);
    });

    it('renders it after the end-shift control', () => {
        const end = at('onClick={onEndShift}');
        expect(end).toBeGreaterThan(-1);
        expect(at('{afterShift}')).toBeGreaterThan(end);
    });

    it('carries no slot called afterHeader any more', () => {
        // The old name described the old position. Leaving it would be a comment
        // that lies in the shape of an identifier.
        expect(code).not.toMatch(/afterHeader/);
    });

    it('is passed the board by the dashboard that owns the data', () => {
        // The slot exists so this component knows nothing about notices. If the
        // dashboard stopped filling it, the board would silently vanish for every
        // Sarthi with nothing failing.
        const dashboard = read('components/driver/DriverDashboard.tsx');
        expect(dashboard).toMatch(/afterShift=\{<NoticeBoard \/>\}/);
    });
});
