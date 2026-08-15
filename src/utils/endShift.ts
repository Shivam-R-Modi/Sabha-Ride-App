import type { DriverDoneResult } from './cloudFunctions';

/**
 * Ending a shift, with the pause for "riders are still waiting".
 *
 * The server does not throw when the last driver on shift tries to finish with
 * people still in the queue — it returns `needsConfirmation` and releases
 * nothing, so the driver can be asked and then say yes. Going home is always
 * allowed; going home unaware is the thing being prevented.
 *
 * WHY THIS IS ITS OWN FUNCTION
 * ---------------------------
 * If a caller forgets the `needsConfirmation` branch it will treat that reply as
 * success: show "Shift ended, thank you for driving", refresh the profile, and
 * navigate away — while the driver is still on shift holding a car. A green
 * confirmation for something that did not happen is the exact failure this
 * codebase keeps having, so the logic lives in one tested place rather than
 * being written out at each exit.
 *
 * @returns whether the shift actually ended. False means the driver chose to
 * keep driving, and the caller must not report success.
 */
export async function endShiftWithWarning(
    driverId: string,
    done: (driverId: string, acknowledgeWaiting?: boolean) => Promise<DriverDoneResult>,
    ask: (options: {
        title?: string;
        message: string;
        confirmLabel?: string;
        cancelLabel?: string;
        destructive?: boolean;
    }) => Promise<boolean>,
): Promise<boolean> {
    const result = await done(driverId);
    if (!result?.needsConfirmation) return true;

    const goAnyway = await ask({
        title: 'Riders are still waiting',
        message: result.warning ?? 'Riders are still waiting for a car.',
        confirmLabel: 'Finish anyway',
        cancelLabel: 'Keep driving',
        destructive: true,
    });
    if (!goAnyway) return false;

    await done(driverId, true);
    return true;
}
