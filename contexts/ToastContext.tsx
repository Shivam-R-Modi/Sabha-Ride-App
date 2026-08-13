import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

/**
 * In-app replacement for `window.alert`.
 *
 * The repo already banned `window.confirm`, because a suppressed dialog returns
 * false and every destructive button silently took the "user said no" branch.
 * `alert` was never swept and 27 calls remained. Its failure is different but
 * from the same family: a suppressed alert does not make the button inert — the
 * write already happened — it makes the FAILURE INVISIBLE. `alert('Failed to
 * unassign student')` in a context where dialogs are suppressed means the
 * manager taps unassign, it fails, and the screen says nothing at all.
 *
 * Browsers suppress dialogs in sandboxed frames, in embedded webviews, and once
 * the user ticks "prevent this page from creating additional dialogs". This app
 * ships as a PWA, which is one of those contexts.
 *
 * Two behaviours worth keeping when editing this:
 *
 *   - ERRORS DO NOT AUTO-DISMISS. A success message that fades is fine; a
 *     failure that fades is a failure nobody saw. Errors stay until dismissed.
 *
 *   - The container is `aria-live`, so a message is announced without stealing
 *     focus. `alert()` stole focus and blocked the whole page; that is worse for
 *     a screen-reader user, not better.
 */

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
    id: number;
    tone: ToastTone;
    message: string;
}

interface ToastContextValue {
    /** Something worked. Auto-dismisses. */
    success: (message: string) => void;
    /** Something failed. Stays until dismissed. */
    error: (message: string) => void;
    /** Neutral note. Auto-dismisses. */
    info: (message: string) => void;
    dismiss: (id: number) => void;
    /** Everything currently on screen. Exposed for tests. */
    toasts: Toast[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Long enough to read a sentence, short enough not to linger. */
const AUTO_DISMISS_MS = 5000;

const TONE = {
    success: {
        Icon: CheckCircle2,
        surface: 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]',
        iconColor: 'text-[rgb(var(--success-text))]',
    },
    error: {
        Icon: AlertTriangle,
        surface: 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]',
        iconColor: 'text-[rgb(var(--danger-text))]',
    },
    info: {
        Icon: Info,
        surface: 'bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]',
        iconColor: 'text-[rgb(var(--info-text))]',
    },
} as const;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const nextId = useRef(1);
    const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

    const dismiss = useCallback((id: number) => {
        const timer = timers.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timers.current.delete(id);
        }
        setToasts(current => current.filter(t => t.id !== id));
    }, []);

    const push = useCallback((tone: ToastTone, message: string) => {
        const id = nextId.current++;
        setToasts(current => [...current, { id, tone, message }]);

        if (tone !== 'error') {
            timers.current.set(id, setTimeout(() => dismiss(id), AUTO_DISMISS_MS));
        }
    }, [dismiss]);

    // Any toast still pending when the tree unmounts would otherwise fire
    // setState on a dead component.
    useEffect(() => () => {
        timers.current.forEach(clearTimeout);
        timers.current.clear();
    }, []);

    const value = useMemo<ToastContextValue>(() => ({
        success: (m: string) => push('success', m),
        error: (m: string) => push('error', m),
        info: (m: string) => push('info', m),
        dismiss,
        toasts,
    }), [push, dismiss, toasts]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ToastViewport toasts={toasts} onDismiss={dismiss} />
        </ToastContext.Provider>
    );
};

const ToastViewport: React.FC<{ toasts: Toast[]; onDismiss: (id: number) => void }> = ({
    toasts, onDismiss,
}) => (
    <div
        // Two regions, because politeness is not one setting. Errors interrupt;
        // confirmations wait their turn. A single region would have to pick one,
        // and either choice is wrong half the time.
        className="fixed inset-x-0 z-toast pointer-events-none flex flex-col items-center gap-2
                   px-4 bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+12px)]
                   lg:bottom-6 lg:items-end lg:px-6"
    >
        <div role="alert" aria-live="assertive" className="contents">
            {toasts.filter(t => t.tone === 'error').map(t => (
                <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />
            ))}
        </div>
        <div role="status" aria-live="polite" className="contents">
            {toasts.filter(t => t.tone !== 'error').map(t => (
                <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />
            ))}
        </div>
    </div>
);

const ToastRow: React.FC<{ toast: Toast; onDismiss: (id: number) => void }> = ({
    toast, onDismiss,
}) => {
    const { Icon, surface, iconColor } = TONE[toast.tone];
    return (
        <div
            className={`pointer-events-auto w-full max-w-md flex items-start gap-3 rounded-2xl
                        px-4 py-3 shadow-lg border border-hairline/10 animate-in slide-in-from-bottom-4
                        ${surface}`}
        >
            <Icon size={18} className={`shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true" />
            <p className="flex-1 text-sm font-medium leading-snug">{toast.message}</p>
            <button
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss"
                className="tap-target shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            >
                <X size={16} />
            </button>
        </div>
    );
};

export function useToast(): ToastContextValue {
    const context = useContext(ToastContext);
    if (!context) {
        // Loud rather than quiet. Falling back to a no-op here would recreate
        // the exact bug this file exists to remove: a failure with nothing on
        // screen to show for it.
        throw new Error('useToast must be used inside a <ToastProvider>');
    }
    return context;
}
