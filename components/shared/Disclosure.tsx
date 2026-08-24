import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * One collapsible row: a header you press, and a panel that appears under it.
 *
 * Deliberately NOT stateful. `open` and `onToggle` are props so the CALLER owns
 * which row is open, and one-at-a-time falls out of holding a single `openId`
 * instead of a boolean per row. Both callers want that:
 *
 *   ManagerSetup — "these are long forms; two open at once means scrolling past
 *   one to reach the other, which is the pile this replaces."
 *   NoticeBoard  — the owner's call, same reasoning: a stack of opened notices is
 *   the wall of text that collapsing them was meant to end.
 *
 * LIFTED, NOT WRITTEN. This was `Section` inside ManagerSetup.tsx, where it had
 * worked since 2026-08-18. Moving it here rather than writing a second accordion
 * is the point; a second one would drift, and the two would disagree about what a
 * collapsed row looks like. Three things changed in the move:
 *
 *   - `icon` and `summary` became optional. A settings row earns a 44px icon
 *     tile; a notice row is a line of text and a chevron.
 *   - `trailing` was added, for the notice board's "New" badge.
 *   - `aria-controls` and a panel `id` were added. The original had neither, so a
 *     screen reader was told a button expands something but never which region.
 *     `useId` because two boards can be mounted at once.
 *
 * The panel is mounted only when open, not hidden with a class. That keeps a
 * collapsed notice's body out of the accessibility tree and out of Ctrl-F, which
 * is what "collapsed" should mean.
 */
export interface DisclosureProps {
    /** Shown in a tile on the left. Settings rows have one; notice rows do not. */
    icon?: React.ReactNode;
    title: string;
    /** A second, quieter line under the title. */
    summary?: string;
    /** Sits between the title and the chevron — a badge, a count. */
    trailing?: React.ReactNode;
    open: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}

export const Disclosure: React.FC<DisclosureProps> = ({
    icon, title, summary, trailing, open, onToggle, children,
}) => {
    const panelId = `disclosure-panel-${useId()}`;

    return (
        <section className="clay-card p-0 overflow-hidden">
            <button
                onClick={onToggle}
                aria-expanded={open}
                aria-controls={panelId}
                className="w-full flex items-center gap-4 p-4 text-left min-h-11 hover:bg-cream-300/40
                           transition-colors"
            >
                {icon && (
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0
                                    bg-cream-300 text-saffron">
                        {icon}
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <h2 className="font-header font-bold text-coffee leading-tight">{title}</h2>
                    {summary && <p className="text-xs text-coffee-500 mt-0.5">{summary}</p>}
                </div>
                {trailing}
                <ChevronDown
                    size={20}
                    aria-hidden="true"
                    className={`text-coffee-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                />
            </button>

            {open && (
                <div id={panelId} className="border-t border-hairline/10 p-4 animate-in fade-in">
                    {children}
                </div>
            )}
        </section>
    );
};
