/**
 * A saved order must never be able to lose a destination.
 *
 * The sidebar's tabs can be dragged into whatever order a manager prefers, and
 * that order is stored on their user document. So from now on the nav list is
 * partly decided by data written months ago on another machine — and the failure
 * that matters is not "the order is wrong", it is **a tab that does not appear at
 * all**. Nothing looks broken; a destination is simply gone, and the manager has
 * no idea it was theirs to get back.
 *
 * The concrete way that happens: someone sets an order today, a release next
 * month adds a nav item, and a naive "render the saved list" drops it. Same shape
 * as the dead buttons and the silent queries this codebase keeps removing, only
 * arriving through storage instead of through code.
 *
 * So every case below is really one question asked six ways: can this shrink the
 * list? It must not, for any stored value at all — stale ids, missing ids,
 * duplicates, an empty array, or something that is not an array.
 */

import { describe, it, expect } from 'vitest';
import { applyOrder, isNavOrder, moveItem, itemAtPoint } from '../../src/utils/navOrder';

/** Stand-ins for NavItem — applyOrder only needs an id. */
const items = (...ids: string[]) => ids.map(id => ({ id, label: id.toUpperCase() }));

/** The manager's eight, in their default order. */
const MANAGER = items('home', 'people', 'history', 'fleet', 'setup', 'profile', 'notices', 'records');
const idsOf = <T extends { id: string }>(list: T[]) => list.map(i => i.id);

describe('applyOrder', () => {
    it('follows a stored order', () => {
        const result = applyOrder(MANAGER, ['records', 'fleet', 'home']);

        expect(idsOf(result).slice(0, 3)).toEqual(['records', 'fleet', 'home']);
    });

    it('keeps every destination, whatever the stored order says', () => {
        const result = applyOrder(MANAGER, ['records', 'fleet', 'home']);

        expect(idsOf(result).sort()).toEqual(idsOf(MANAGER).sort());
        expect(result).toHaveLength(MANAGER.length);
    });

    it('still shows a destination the stored order has never heard of', () => {
        // The case that will actually happen: an order saved before `notices`
        // existed. Rendering the saved list alone would hide it for ever, on
        // every device that person signs in on.
        const savedBeforeNotices = ['records', 'home', 'people', 'history', 'fleet', 'setup', 'profile'];

        const result = applyOrder(MANAGER, savedBeforeNotices);

        expect(idsOf(result)).toContain('notices');
        expect(result).toHaveLength(MANAGER.length);
    });

    it('appends unlisted destinations in their default relative order', () => {
        const result = applyOrder(MANAGER, ['setup']);

        expect(idsOf(result)).toEqual([
            'setup',
            'home', 'people', 'history', 'fleet', 'profile', 'notices', 'records',
        ]);
    });

    it('ignores a stored id that is no longer a destination', () => {
        // A tab that was removed in a release. It must not leave a gap, a crash,
        // or a phantom button.
        const result = applyOrder(MANAGER, ['records', 'weather', 'home']);

        expect(idsOf(result).slice(0, 2)).toEqual(['records', 'home']);
        expect(idsOf(result)).not.toContain('weather');
        expect(result).toHaveLength(MANAGER.length);
    });

    it('renders a duplicated id exactly once', () => {
        const result = applyOrder(MANAGER, ['home', 'home', 'fleet', 'home']);

        expect(idsOf(result).filter(id => id === 'home')).toHaveLength(1);
        expect(result).toHaveLength(MANAGER.length);
    });

    it('treats an empty array as no preference', () => {
        // Not as "no tabs". This is the difference between a sidebar and a blank
        // rail with no way to navigate anywhere.
        expect(idsOf(applyOrder(MANAGER, []))).toEqual(idsOf(MANAGER));
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['a string', 'home,fleet'],
        ['a number', 7],
        ['an object', { home: 1 }],
        ['an array of numbers', [1, 2, 3]],
        ['an array with a nested array', [['home'], 'fleet']],
    ])('falls back to the default order for %s', (_label, stored) => {
        expect(idsOf(applyOrder(MANAGER, stored as never))).toEqual(idsOf(MANAGER));
    });

    it('does not mutate the list it was given', () => {
        const original = [...MANAGER];

        applyOrder(MANAGER, ['records', 'home']);

        expect(MANAGER).toEqual(original);
    });

    it('works for a three-item role too', () => {
        const rider = items('home', 'rides', 'profile');

        expect(idsOf(applyOrder(rider, ['profile']))).toEqual(['profile', 'home', 'rides']);
    });

    it('survives an empty list of destinations', () => {
        expect(applyOrder([], ['home'])).toEqual([]);
    });
});

describe('isNavOrder', () => {
    it('accepts a list of ids', () => {
        expect(isNavOrder(['home', 'fleet'])).toBe(true);
        expect(isNavOrder([])).toBe(true);
    });

    it('refuses anything else', () => {
        for (const bad of [undefined, null, 'home', 7, { 0: 'home' }, [1], [null], [['home']]]) {
            expect(isNavOrder(bad)).toBe(false);
        }
    });

    it('refuses a list long enough to be abuse rather than a preference', () => {
        // Mirrors the cap in firestore.rules. The user document is read on every
        // page load and by every manager listing people, so an unbounded array
        // here costs everyone.
        expect(isNavOrder(Array.from({ length: 17 }, (_, i) => `t${i}`))).toBe(false);
    });
});

describe('moveItem', () => {
    it('moves an entry down', () => {
        expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    });

    it('moves an entry up', () => {
        expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    });

    it('is a no-op when the entry does not move', () => {
        expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
    });

    it('clamps rather than dropping an entry off either end', () => {
        // The keyboard path presses Alt+Up on the first item. Losing a tab
        // because an index went to -1 is exactly what must not happen.
        expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
        expect(moveItem(['a', 'b', 'c'], 2, 9)).toEqual(['a', 'b', 'c']);
    });

    it('ignores an index that is not in the list', () => {
        expect(moveItem(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c']);
    });

    it('does not mutate its input', () => {
        const list = ['a', 'b', 'c'];
        moveItem(list, 0, 2);
        expect(list).toEqual(['a', 'b', 'c']);
    });
});

describe('itemAtPoint', () => {
    /**
     * What the finger is over, for the pointer-driven drag.
     *
     * HTML5 drag-and-drop does not exist on touch — no `dragstart` is ever
     * produced from a finger on iOS Safari or Android Chrome — so a reorder built
     * on it works with a mouse and silently does nothing on a phone. Pointer
     * events replace it, and they report coordinates rather than a target, so the
     * row under the finger has to be worked out.
     *
     * Two dimensions, not one: the mobile drawer lays its destinations out in a
     * two-column grid, so a y-only calculation would put the finger on whichever
     * of the pair happened to be first.
     */
    const grid = [
        { id: 'home', rect: { left: 0, top: 0, right: 100, bottom: 50 } },
        { id: 'people', rect: { left: 100, top: 0, right: 200, bottom: 50 } },
        { id: 'fleet', rect: { left: 0, top: 50, right: 100, bottom: 100 } },
        { id: 'setup', rect: { left: 100, top: 50, right: 200, bottom: 100 } },
    ];

    it('finds the row under the point', () => {
        expect(itemAtPoint(grid, 50, 25)).toBe('home');
        expect(itemAtPoint(grid, 50, 75)).toBe('fleet');
    });

    it('tells the two columns apart', () => {
        // A y-only hit test would answer 'home' for both of these.
        expect(itemAtPoint(grid, 150, 25)).toBe('people');
        expect(itemAtPoint(grid, 150, 75)).toBe('setup');
    });

    it('returns null outside every row', () => {
        // A finger dragged off the list must not land the item somewhere random.
        expect(itemAtPoint(grid, 500, 25)).toBeNull();
        expect(itemAtPoint(grid, 50, 500)).toBeNull();
    });

    it('includes the edges, so a point on a boundary belongs somewhere', () => {
        expect(itemAtPoint(grid, 0, 0)).toBe('home');
        expect(itemAtPoint(grid, 100, 50)).toBe('home');
    });

    it('survives an empty list', () => {
        expect(itemAtPoint([], 10, 10)).toBeNull();
    });
});
