import React, { useCallback, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * The one overlay in this app.
 *
 * Twelve files hand-rolled their own `fixed inset-0` overlay. Exactly one of
 * them — useConfirm — set `role="dialog"` and `aria-modal`. None of the twelve
 * trapped focus, locked background scroll, closed on Escape, or gave focus back
 * to whatever opened them. So for a keyboard or screen-reader user an open
 * "modal" was a page that had grown some new content near the bottom of the tab
 * order, with the whole page behind it still reachable and still scrolling.
 *
 * Behaviours worth not removing later:
 *
 *   - ESCAPE CLOSES. Only the topmost sheet, so nested sheets unwind one at a
 *     time rather than all at once.
 *   - FOCUS IS TRAPPED, and restored to the opener on close. Without the
 *     restore, closing a sheet dumps focus back to <body> and a keyboard user
 *     starts again from the top of the page.
 *   - BACKGROUND SCROLL IS LOCKED, compensating for the scrollbar so the page
 *     behind does not jump sideways as it disappears.
 *   - `dismissible={false}` for sheets in the middle of a write. Escape and the
 *     backdrop stop closing it, but the sheet must then supply its own way out.
 *     A sheet with no exit at all is a trap.
 */

interface SheetProps {
    open: boolean;
    onClose: () => void;
    /** Announced as the dialog's name. Rendered unless `hideTitle`. */
    title: string;
    hideTitle?: boolean;
    children: React.ReactNode;
    /** Backdrop click and Escape close it. Off during an in-flight write. */
    dismissible?: boolean;
    /** Docks to the bottom on mobile. Right for long lists, wrong for a short prompt. */
    variant?: 'sheet' | 'dialog';
    /** Tailwind max-width for the panel. */
    maxWidth?: string;
    footer?: React.ReactNode;
    /**
     * Take focus on open instead of the panel.
     *
     * Only for a sheet that is ITSELF a single question, where the safe answer
     * should be under the user's finger — a confirm prompt. Do not point this
     * at a destructive control, and do not use it to focus a text field in a
     * form: that skips past the title, so a screen-reader user never hears what
     * they have opened.
     */
    initialFocus?: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * How many sheets are open. Escape must only close the topmost, and the scroll
 * lock must survive until the last one goes — a nested sheet closing should not
 * hand scrolling back to a page that is still covered.
 */
const openSheets: symbol[] = [];

export const Sheet: React.FC<SheetProps> = ({
    open, onClose, title, hideTitle, children,
    dismissible = true, variant = 'dialog', maxWidth = 'max-w-md', footer, initialFocus,
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const openerRef = useRef<Element | null>(null);
    const idRef = useRef(Symbol('sheet'));
    const titleId = useId();

    const isTopmost = useCallback(
        () => openSheets[openSheets.length - 1] === idRef.current,
        [],
    );

    // Register, lock scroll, move focus in, and undo all of it on close.
    useEffect(() => {
        if (!open) return;

        const id = idRef.current;
        openSheets.push(id);
        openerRef.current = document.activeElement;

        const { body } = document;
        const previousOverflow = body.style.overflow;
        const previousPadding = body.style.paddingRight;
        if (openSheets.length === 1) {
            // Reserve the scrollbar's width so the page behind does not shift
            // sideways the moment it is hidden.
            const gap = window.innerWidth - document.documentElement.clientWidth;
            body.style.overflow = 'hidden';
            if (gap > 0) body.style.paddingRight = `${gap}px`;
        }

        // Focus the panel, NOT its first control. The first control in DOM
        // order is the close button, so focusing it would arm "discard this"
        // on the next Enter — and in a destructive sheet that is how you lose
        // work by pressing a key. Focusing the container instead makes screen
        // readers announce the dialog's title, and leaves Tab to move into the
        // content deliberately. tabIndex={-1} lets it hold focus without
        // joining the tab order.
        (initialFocus?.current ?? panelRef.current)?.focus();

        return () => {
            const at = openSheets.indexOf(id);
            if (at !== -1) openSheets.splice(at, 1);

            if (openSheets.length === 0) {
                body.style.overflow = previousOverflow;
                body.style.paddingRight = previousPadding;
            }
            (openerRef.current as HTMLElement | null)?.focus?.();
        };
    }, [open, initialFocus]);

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape' && dismissible && isTopmost()) {
            event.stopPropagation();
            onClose();
            return;
        }

        if (event.key !== 'Tab') return;

        const focusable = Array.from(
            panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
        ).filter(el => el.offsetParent !== null || el === document.activeElement);

        if (focusable.length === 0) {
            // Nothing to move between — keep focus inside rather than letting
            // Tab walk out into the page behind.
            event.preventDefault();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        // Focus starts on the panel itself, which is not in `focusable`. Shift+Tab
        // from there would walk backwards out of the sheet and into the page
        // behind, which is the leak the trap exists to stop.
        if (active === panelRef.current) {
            if (event.shiftKey) {
                event.preventDefault();
                last.focus();
            }
            return;
        }

        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };

    if (!open) return null;

    const docked = variant === 'sheet';

    return (
        <div
            className={`fixed inset-0 z-modal flex justify-center p-4 animate-in fade-in duration-150
                        ${docked ? 'items-end sm:items-center sm:p-4 p-0' : 'items-center'}`}
            style={{ background: 'rgb(var(--scrim) / var(--scrim-alpha))' }}
            onMouseDown={event => {
                // mousedown, not click: a click fires on the backdrop when a
                // drag STARTED inside the panel and ended outside — selecting
                // text in a field and releasing past the edge closed the sheet
                // and threw the input away.
                if (dismissible && event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                className={`glass-surface w-full ${maxWidth} max-h-[90dvh] flex flex-col outline-none
                            shadow-2xl animate-in
                            ${docked
                        ? 'rounded-t-3xl sm:rounded-3xl slide-in-from-bottom-4'
                        : 'rounded-3xl zoom-in'}`}
            >
                <div className="flex items-start justify-between gap-4 p-5 pb-3 shrink-0">
                    <h2
                        id={titleId}
                        className={`font-header font-bold text-lg text-coffee ${hideTitle ? 'sr-only' : ''}`}
                    >
                        {title}
                    </h2>
                    {dismissible && (
                        <button
                            onClick={onClose}
                            aria-label="Close"
                            className="tap-target shrink-0 -mt-1 -mr-1 p-2 rounded-full text-coffee-500
                                       hover:text-coffee hover:bg-cream-300/60 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>

                {footer && (
                    <div className="shrink-0 border-t border-hairline/10 p-5 pt-4">{footer}</div>
                )}
            </div>
        </div>
    );
};
