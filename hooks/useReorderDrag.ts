/**
 * Dragging a list into a new order, with a finger as well as a mouse.
 *
 * WHY NOT HTML5 DRAG-AND-DROP
 * ---------------------------
 * Because it does not work on a phone. `draggable` plus `dragstart` / `drop` is
 * mouse-only: iOS Safari and Android Chrome have never produced a drag event from
 * a finger. A reorder built on it works perfectly on a laptop and does *nothing*
 * on a touch screen, with no error and nothing to notice — which is exactly what
 * was reported, and exactly the silent-failure class this codebase keeps removing.
 *
 * Pointer events cover mouse, touch and pen in one path, so there is one
 * implementation rather than a drag path plus a touch path that drift.
 *
 * TWO THINGS THAT ARE EASY TO GET WRONG
 * -------------------------------------
 * `touch-action: none` on the handle is not optional. Without it the browser
 * claims the gesture for scrolling the moment the finger moves, and `pointermove`
 * stops arriving mid-drag.
 *
 * `setPointerCapture` is what makes the drag survive leaving the handle. Without
 * it, moves are delivered to whatever element is under the finger and the drag
 * ends the instant it travels past the handle's own few pixels.
 */

import { useCallback, useRef, useState } from 'react';
import { itemAtPoint } from '../src/utils/navOrder';

export interface ReorderDrag<T extends string> {
    /** The row being moved, for dimming it. Null when nothing is in flight. */
    draggingId: T | null;
    /** The row the pointer is over, for showing where it would land. */
    overId: T | null;
    /** Spread onto each row so it can be measured. */
    rowRef: (id: T) => (element: HTMLElement | null) => void;
    /** Spread onto the handle. */
    handleProps: (id: T) => {
        onPointerDown: (event: React.PointerEvent) => void;
        onPointerMove: (event: React.PointerEvent) => void;
        onPointerUp: (event: React.PointerEvent) => void;
        onPointerCancel: (event: React.PointerEvent) => void;
        style: { touchAction: 'none' };
    };
}

export function useReorderDrag<T extends string>(
    onMove: (from: T, to: T) => void,
): ReorderDrag<T> {
    const [draggingId, setDraggingId] = useState<T | null>(null);
    const [overId, setOverId] = useState<T | null>(null);

    /** Live element per row, so the hit test measures what is actually laid out. */
    const rows = useRef(new Map<T, HTMLElement>());

    // Refs as well as state: the pointerup handler must not depend on React
    // having re-rendered since pointerdown. The same mistake the drag-event
    // version made, where a drop in the same tick silently did nothing.
    const draggingRef = useRef<T | null>(null);
    const overRef = useRef<T | null>(null);

    const rowRef = useCallback((id: T) => (element: HTMLElement | null) => {
        if (element) rows.current.set(id, element);
        else rows.current.delete(id);
    }, []);

    const reset = useCallback(() => {
        draggingRef.current = null;
        overRef.current = null;
        setDraggingId(null);
        setOverId(null);
    }, []);

    const handleProps = useCallback((id: T) => ({
        onPointerDown: (event: React.PointerEvent) => {
            // Left button or a finger. A right-click must not begin a drag.
            if (event.button !== 0) return;
            event.preventDefault();
            // Guarded, because a throw here would take the whole drag with it —
            // `draggingRef` would never be set, nothing would move, and there
            // would be no feedback at all. Chrome throws NotFoundError when the
            // pointer is not active, which a real gesture never hits but a
            // synthetic one does. Without capture the drag still works while the
            // pointer stays over the list, which is worse than capture and much
            // better than nothing.
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
                // Nothing to do: the drag proceeds uncaptured.
            }
            draggingRef.current = id;
            setDraggingId(id);
        },
        onPointerMove: (event: React.PointerEvent) => {
            if (!draggingRef.current) return;
            const measured = [...rows.current.entries()]
                .map(([rowId, element]) => ({ id: rowId, rect: element.getBoundingClientRect() }));
            const target = itemAtPoint(measured, event.clientX, event.clientY);
            overRef.current = target;
            setOverId(target);
        },
        onPointerUp: () => {
            const from = draggingRef.current;
            const to = overRef.current;
            reset();
            if (from && to && from !== to) onMove(from, to);
        },
        // A cancel is the browser taking the gesture back — a system swipe, a
        // call arriving. Nothing moves, rather than moving somewhere arbitrary.
        onPointerCancel: () => reset(),
        style: { touchAction: 'none' as const },
    }), [onMove, reset]);

    return { draggingId, overId, rowRef, handleProps };
}
