/**
 * The order a person has chosen for their sidebar tabs.
 *
 * Pure, and deliberately so — mirroring src/utils/theme.ts, the other stored
 * preference in this app. Nothing here touches React or Firestore, so the rules
 * can be tested without rendering a sidebar or standing up an emulator.
 *
 * THE ONE THING THIS MUST NOT DO
 * ------------------------------
 * Lose a destination.
 *
 * Part of the nav list is now decided by data written months ago, possibly on
 * another machine. The failure that matters is not a wrong order — a manager can
 * see that and fix it. It is a tab that never renders: nothing looks broken, a
 * destination is simply gone, and the person has no reason to think it was theirs
 * to get back.
 *
 * The concrete way that happens is a release adding a nav item after somebody
 * saved their order. So `applyOrder` treats the stored list as a *preference
 * about sequence*, never as the set of things to show. The set always comes from
 * `getNavItems`. Every stored value — stale ids, missing ids, duplicates, an
 * empty array, or something that is not an array at all — resolves to the full
 * list in some order.
 *
 * Hiding a tab was considered and ruled out by the owner for the same reason.
 */

/**
 * Most tabs any one role has is eight. Sixteen leaves room for growth and still
 * makes an array that is being used as storage rather than as a preference
 * obvious.
 *
 * Mirrored in firestore.rules — rules cannot import this, so
 * tests/quality/nav-order-cap.test.ts fails if the two ever drift.
 */
export const MAX_NAV_ORDER = 16;

/** Anything with an id can be ordered. Keeps this module free of NavItem. */
interface Orderable {
    id: string;
}

/**
 * Is a stored value usable as an order?
 *
 * A shape check, not a contents check: whether the ids still name real
 * destinations is `applyOrder`'s business, because that answer changes with every
 * release while this one does not.
 */
export function isNavOrder(value: unknown): value is string[] {
    return Array.isArray(value)
        && value.length <= MAX_NAV_ORDER
        && value.every(entry => typeof entry === 'string');
}

/**
 * The default list, resequenced by a stored preference.
 *
 * Stored ids first, in their stored order, skipping any that no longer exist and
 * any repeat. Then everything the stored order did not mention, in its default
 * relative order — which is what keeps a newly added tab visible, and puts it
 * somewhere predictable rather than somewhere random.
 */
export function applyOrder<T extends Orderable>(items: T[], stored: unknown): T[] {
    if (!isNavOrder(stored) || stored.length === 0) return [...items];

    const byId = new Map(items.map(item => [item.id, item]));
    const ordered: T[] = [];
    const taken = new Set<string>();

    for (const id of stored) {
        const item = byId.get(id);
        if (!item || taken.has(id)) continue;
        ordered.push(item);
        taken.add(id);
    }

    // The remainder, in default order. This is the line that makes a stored
    // preference incapable of hiding anything.
    for (const item of items) {
        if (!taken.has(item.id)) ordered.push(item);
    }

    return ordered;
}

/**
 * Move one entry, for both the drag and the keyboard path.
 *
 * Out-of-range targets CLAMP rather than dropping the entry: Alt+Up on the first
 * item is an ordinary thing to press, and it must be a no-op rather than a lost
 * tab.
 */
export function moveItem<T extends string>(ids: T[], from: number, to: number): T[] {
    if (from < 0 || from >= ids.length) return [...ids];

    const target = Math.min(Math.max(to, 0), ids.length - 1);
    if (target === from) return [...ids];

    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved);
    return next;
}

/** The part of a DOMRect this needs. Passing the whole thing is fine. */
interface Bounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * Which row a pointer is over.
 *
 * Needed because the reorder is driven by POINTER events rather than HTML5
 * drag-and-drop. That was not a preference: `dragstart` is never produced from a
 * finger on iOS Safari or Android Chrome, so a reorder built on drag events works
 * with a mouse and silently does nothing on a phone — the failure the owner
 * reported. Pointer events cover mouse, touch and pen in one path, and they
 * report coordinates instead of a drop target, so the row has to be found.
 *
 * Both axes, deliberately. The mobile drawer lays destinations out in two
 * columns, and a y-only test would answer with whichever of a pair came first.
 *
 * Edges count as inside, so a point landing exactly on a boundary belongs to a
 * row rather than to nothing.
 */
export function itemAtPoint<T extends string>(
    rows: Array<{ id: T; rect: Bounds }>,
    x: number,
    y: number,
): T | null {
    for (const { id, rect } of rows) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return id;
    }
    return null;
}
