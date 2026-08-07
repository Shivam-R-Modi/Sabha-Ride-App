import React, { useCallback, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

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
        <div
            className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-150"
            role="dialog"
            aria-modal="true"
            onClick={() => settle(false)}
        >
            <div
                className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-5">
                    <div className="flex items-start gap-3">
                        {pending.destructive && (
                            <div className="p-2 bg-red-50 text-red-600 rounded-xl shrink-0">
                                <AlertTriangle size={18} />
                            </div>
                        )}
                        <div className="min-w-0">
                            <h3 className="font-header font-bold text-coffee text-lg">
                                {pending.title ?? 'Are you sure?'}
                            </h3>
                            {/* whitespace-pre-line so callers can use \n for a second paragraph. */}
                            <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">
                                {pending.message}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 px-5 pb-5">
                    <button
                        onClick={() => settle(false)}
                        autoFocus
                        className="flex-1 px-4 py-2.5 border-2 border-gray-200 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-colors"
                    >
                        {pending.cancelLabel ?? 'Go back'}
                    </button>
                    <button
                        onClick={() => settle(true)}
                        className={`flex-1 px-4 py-2.5 rounded-xl font-semibold text-sm text-white transition-colors ${pending.destructive
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-saffron hover:bg-saffron/90'}`}
                    >
                        {pending.confirmLabel ?? (pending.destructive ? 'Delete' : 'Confirm')}
                    </button>
                </div>
            </div>
        </div>
    ) : null;

    return { ask, confirmDialog };
}
