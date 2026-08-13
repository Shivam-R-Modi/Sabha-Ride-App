import React, { useCallback, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Sheet } from './Sheet';

/**
 * In-app replacement for `window.confirm`.
 *
 * Every destructive action in this app was gated on `confirm()`, and a suppressed
 * dialog returns **false** — so the guard took the "user said no" branch and the
 * button did nothing at all. No error, no feedback. Exactly the failure this
 * codebase has been full of, and it is not hypothetical: browsers suppress
 * dialogs in sandboxed frames, embedded webviews, and after a user ticks "prevent
 * this page from creating additional dialogs". This app ships as a PWA, which is
 * one of the contexts where it happens.
 *
 * Usage is a one-line swap for `confirm()`:
 *
 *     const { ask, confirmDialog } = useConfirm();
 *     ...
 *     if (!await ask({ message: 'Delete this?', destructive: true })) return;
 *     ...
 *     return (<>{rest}{confirmDialog}</>);
 *
 * The promise resolves false on dismiss, so the "no" path is unchanged — but now
 * the user has actually been asked.
 *
 * Since Phase 2 the markup is a shared <Sheet>, which is what gives this a focus
 * trap, background scroll lock, Escape-to-cancel and focus restored to whatever
 * opened it. It had none of those when it hand-rolled its own overlay.
 */

export interface ConfirmOptions {
    title?: string;
    message: string;
    /** Defaults to "Confirm", or "Delete" when destructive. */
    confirmLabel?: string;
    cancelLabel?: string;
    /** Red confirm button, warning icon. */
    destructive?: boolean;
}

interface Pending extends ConfirmOptions {
    resolve: (ok: boolean) => void;
}

export function useConfirm() {
    const [pending, setPending] = useState<Pending | null>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);

    const ask = useCallback(
        (options: ConfirmOptions) =>
            new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
        [],
    );

    const settle = (ok: boolean) => {
        setPending((current) => {
            current?.resolve(ok);
            return null;
        });
    };

    const confirmDialog = pending ? (
        <Sheet
            open
            onClose={() => settle(false)}
            title={pending.title ?? 'Are you sure?'}
            maxWidth="max-w-sm"
            // The one legitimate use of initialFocus: this sheet IS a single
            // question, and the safe answer should be under the user's finger.
            // A stray Enter must never delete anything.
            initialFocus={cancelRef}
            footer={
                <div className="flex gap-2">
                    <button
                        ref={cancelRef}
                        onClick={() => settle(false)}
                        className="flex-1 px-4 py-2.5 border-2 border-hairline/20 text-coffee-700
                                   rounded-xl font-semibold text-sm hover:bg-cream-300/60 transition-colors
                                   min-h-11"
                    >
                        {pending.cancelLabel ?? 'Go back'}
                    </button>
                    <button
                        onClick={() => settle(true)}
                        className={`flex-1 px-4 py-2.5 rounded-xl font-semibold text-sm min-h-11
                                    text-[rgb(var(--text-on-accent))] transition-colors ${pending.destructive
                                ? 'bg-[rgb(var(--danger))] hover:opacity-90'
                                : 'bg-[rgb(var(--cta))] hover:opacity-90'}`}
                    >
                        {pending.confirmLabel ?? (pending.destructive ? 'Delete' : 'Confirm')}
                    </button>
                </div>
            }
        >
            <div className="flex items-start gap-3">
                {pending.destructive && (
                    <div className="p-2 bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]
                                    rounded-xl shrink-0">
                        <AlertTriangle size={18} aria-hidden="true" />
                    </div>
                )}
                {/* whitespace-pre-line so callers can use \n for a second paragraph. */}
                <p className="text-sm text-coffee-700 whitespace-pre-line min-w-0">
                    {pending.message}
                </p>
            </div>
        </Sheet>
    ) : null;

    return { ask, confirmDialog };
}
