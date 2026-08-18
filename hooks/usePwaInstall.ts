import { useCallback, useEffect, useReducer } from 'react';
import {
    installAvailability,
    installSteps,
    hasInstallPrompt,
    isInstallDismissed,
    runInstallPrompt,
    setInstallDismissed,
    subscribeToInstallState,
    watchInstallPrompt,
    wasInstalledThisSession,
    type InstallAvailability,
} from '../src/utils/pwaInstall';

/**
 * One source of truth for "can this device install the app, and how".
 *
 * Shared by the banner and the Profile entry so the two cannot disagree — and
 * so the captured Chrome prompt is read from module scope rather than from a
 * listener each component adds for itself, which would race for a
 * single-delivery event.
 */
export interface PwaInstall {
    availability: InstallAvailability;
    /** Whether to offer installing at all. False for 'installed' and 'none'. */
    canInstall: boolean;
    /** Whether the bottom banner should be on screen right now. */
    bannerVisible: boolean;
    /** The hand-written steps, for 'manual'. Empty otherwise. */
    steps: string[];
    /** Replay Chrome's prompt. No-op unless availability is 'prompt'. */
    install: () => Promise<void>;
    /** Hide the banner and remember it, so it asks at most once. */
    dismiss: () => void;
    /** Bring the banner back — what the permanent Profile entry does. */
    reveal: () => void;
}

const navigatorUserAgent = () =>
    typeof navigator === 'undefined' ? '' : navigator.userAgent ?? '';

export function usePwaInstall(): PwaInstall {
    // The captured prompt lives outside React, so re-render on its changes.
    const [, bump] = useReducer((n: number) => n + 1, 0);

    useEffect(() => {
        // Idempotent; index.tsx has normally already done this. Repeated here so
        // a component mounted in isolation — a test, a lazy route — still sees
        // an event that arrives afterwards.
        watchInstallPrompt(typeof window === 'undefined' ? undefined : window);
        return subscribeToInstallState(bump);
    }, []);

    const availability: InstallAvailability = wasInstalledThisSession()
        ? 'installed'
        : installAvailability(typeof window === 'undefined' ? undefined : window, hasInstallPrompt());

    const canInstall = availability === 'prompt' || availability === 'manual';

    const install = useCallback(async () => {
        // The result needs no branch: accepting fires `appinstalled` and
        // declining drops the event, and both paths already re-render through
        // the subscription.
        await runInstallPrompt();
    }, []);

    const dismiss = useCallback(() => { setInstallDismissed(true); }, []);

    // Asking to see it again is the user undoing the "don't ask" they set
    // earlier, so there is only ever one flag to move.
    const reveal = useCallback(() => { setInstallDismissed(false); }, []);

    return {
        availability,
        canInstall,
        bannerVisible: canInstall && !isInstallDismissed(),
        steps: availability === 'manual' ? installSteps(navigatorUserAgent()) : [],
        install,
        dismiss,
        reveal,
    };
}
