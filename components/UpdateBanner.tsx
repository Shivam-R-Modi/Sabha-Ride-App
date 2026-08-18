import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useNavigation } from '../contexts/NavigationContext';
import { applyUpdate, applyUpdateWhenUnobserved, watchForUpdate, type RegistrationLike } from '../src/utils/swUpdate';

/**
 * "A new version is ready" — the one thing the app could not previously say.
 *
 * See src/utils/swUpdate.ts for the failure this fixes. In short: the service
 * worker used to swap itself in silently while an open page kept running old
 * code, so a fixed bug could stay visibly broken on a driver's phone.
 *
 * NOT DISMISSIBLE, unlike the install prompt next to it. Installing is a nicety
 * a user may decline for ever; running a client that disagrees with the deployed
 * rules and functions is a correctness problem, and an X button here would let
 * someone hide the notice and keep driving on a stale build. It costs one tap to
 * clear, and the tap is the fix.
 */
export const UpdateBanner: React.FC = () => {
    const [ready, setReady] = useState(false);
    const [reloading, setReloading] = useState(false);
    const { isSidebarCollapsed, isFocusMode } = useNavigation();

    useEffect(() => {
        if (!('serviceWorker' in navigator)) return;

        let cleanup: (() => void) | undefined;
        let cancelled = false;

        navigator.serviceWorker.getRegistration().then(reg => {
            // No registration in dev, or before the injected registerSW.js has
            // run. Nothing to watch, and nothing to say.
            if (!reg || cancelled) return;
            cleanup = watchForUpdate(
                reg as unknown as RegistrationLike,
                () => !!navigator.serviceWorker.controller,
                () => setReady(true),
            );
        }).catch(err => {
            // Never let this break the app it is trying to keep current.
            console.warn('[UpdateBanner] Could not inspect the service worker:', err);
        });

        // The fresh worker taking control is the moment the page must reload —
        // reloading straight after postMessage races the swap and can serve the
        // old bundle one more time, which would look exactly like the bug this
        // whole mechanism exists to prevent.
        const onControllerChange = () => window.location.reload();
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

        // Update without waiting to be noticed.
        //
        // The banner is the right answer for a tab somebody is USING. It is the
        // wrong answer for one sitting in the background, which is how a client
        // ends up weeks behind: nobody sees the prompt, so nothing happens. This
        // applies a waiting worker while the tab is hidden, and re-checks the
        // moment it comes back. See applyUpdateWhenUnobserved.
        const stopUnobserved = applyUpdateWhenUnobserved(
            document,
            () => navigator.serviceWorker.getRegistration()
                .then(r => (r ?? null) as unknown as RegistrationLike | null),
        );

        return () => {
            cancelled = true;
            cleanup?.();
            stopUnobserved();
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        };
    }, []);

    if (!ready) return null;

    const handleReload = () => {
        setReloading(true);
        navigator.serviceWorker.getRegistration().then(reg => {
            // If there is nothing to activate, reload anyway rather than leaving a
            // spinner running for ever — a button that does nothing is worse than
            // a redundant reload.
            if (!applyUpdate(reg as unknown as RegistrationLike | null)) window.location.reload();
        }).catch(() => window.location.reload());
    };

    return (
        // Same sidebar-clearing offsets as PWAPrompt — see the note there for why
        // `left-4` alone is wrong at `lg`. Sits above it on the stack, because an
        // out-of-date client matters more than an install suggestion.
        <div
            role="status"
            aria-live="polite"
            className={`fixed bottom-safe-nav right-4 z-sticky animate-in slide-in-from-bottom-10 left-4 ${isFocusMode ? '' : isSidebarCollapsed ? 'lg:left-24' : 'lg:left-64'
                }`}
        >
            {/* Painted from the PANEL ramp, not the text ramp.
                
                It used to be a deliberate inverted pair: the coffee background
                utility with cream text. That is contrast-correct — the coffee
                background reads `--text-strong`, which flips between themes, and
                the cream text flips with it — but it means the panel BECOMES
                near-white in dark mode, so the banner read as a bright slab
                pasted onto a dark app.

                (The utility names are spelled around rather than written out:
                Tailwind scans this file as plain TEXT, comments included, so
                naming one here re-emits it into the bundle.)

                `bg-surface` moves in the same direction as every other card:
                white in light, 46 40 34 in dark. Measured against `text-coffee`
                it is 13.76:1 light and 11.40:1 dark; the muted second line is
                5.15:1 and 5.25:1. All above the AA floor.

                The saffron bar carries the "this is a notice" weight the
                inversion used to. It is a positioned span rather than a border
                because the elevation rule is border OR shadow, never both, and
                `shadow-2xl` is what lifts this off the page. */}
            <div className="relative overflow-hidden bg-surface text-coffee p-4 pl-5 rounded-xl shadow-2xl flex items-center justify-between gap-3">
                <span className="absolute inset-y-0 left-0 w-1.5 bg-saffron" aria-hidden="true" />
                <div>
                    <h4 className="font-bold text-sm">Update available</h4>
                    <p className="text-xs text-coffee-500">
                        Reload to get the latest version. Safe to finish what you are doing first.
                    </p>
                </div>
                <button
                    onClick={handleReload}
                    disabled={reloading}
                    className="bg-saffron text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-md active:scale-95 shrink-0 disabled:opacity-70"
                >
                    <RefreshCw size={14} className={reloading ? 'animate-spin' : undefined} />
                    {reloading ? 'Updating' : 'Reload'}
                </button>
            </div>
        </div>
    );
};
