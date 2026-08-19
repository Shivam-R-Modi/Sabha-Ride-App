import { useCallback, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
    pushAvailability,
    readDeviceToken,
    tokenKey,
    type PushAvailability,
} from '../src/utils/push';
import { enablePush, disablePush, hasVapidKey } from '../src/utils/pushClient';

/**
 * One source of truth for the notification controls, mirroring
 * `hooks/usePwaInstall.ts`.
 *
 * "On" means THIS device has a token that the user's document still lists —
 * not merely that permission was granted. A granted permission with no stored
 * token is a registration that failed, and reporting that as "on" would be the
 * dead-control failure this repo keeps removing.
 */
export interface Push {
    availability: PushAvailability;
    busy: boolean;
    /** Set when the last attempt failed, for the caller to show. */
    error: string | null;
    enable: () => Promise<void>;
    disable: () => Promise<void>;
}

export function usePush(): Push {
    const { currentUser, userProfile, refreshProfile } = useAuth();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // The document lists every device. This one is "on" only if the token it
    // remembers is still in that list — so a token pruned server-side as dead
    // correctly flips the control back to off.
    const deviceToken = readDeviceToken();
    const tokens = (userProfile as { fcmTokens?: Record<string, unknown> } | null)?.fcmTokens ?? {};
    const thisDeviceIsOn = deviceToken !== null && tokenKey(deviceToken) in tokens;

    const availability = hasVapidKey()
        ? pushAvailability(typeof window === 'undefined' ? undefined : (window as never), thisDeviceIsOn)
        : 'unsupported';

    const enable = useCallback(async () => {
        if (!currentUser) return;
        setBusy(true);
        setError(null);
        const result = await enablePush(currentUser.uid);
        if (!result.ok) {
            setError(result.reason === 'denied'
                ? 'Notifications were not allowed.'
                : 'Could not turn notifications on.');
        }
        await refreshProfile();
        setBusy(false);
    }, [currentUser, refreshProfile]);

    const disable = useCallback(async () => {
        if (!currentUser || !deviceToken) return;
        setBusy(true);
        await disablePush(currentUser.uid, deviceToken);
        await refreshProfile();
        setBusy(false);
    }, [currentUser, deviceToken, refreshProfile]);

    return { availability, busy, error, enable, disable };
}
