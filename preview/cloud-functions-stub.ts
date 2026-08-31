// Stand-in for src/utils/cloudFunctions in the visual harness.
export const studentReadyToLeave = async () => undefined;
export const globalAssignDriver = async () => ({}) as never;
export const driverDoneForToday = async () => undefined;
export const completeRide = async () => ({}) as never;
export const redeemManagerInvite = async () => ({}) as never;

/** Manager invites now render on the People page, so the harness needs this. */
export interface CreateInviteResult { code: string; expiresAt: string; }
export const createManagerInvite = async (_label?: string): Promise<CreateInviteResult> => ({
    code: 'PREV-IEW0-CODE',
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
});

/**
 * The role change. Resolves as if it worked, so the harness can show the confirm
 * prompt and the success toast — the REFUSALS (mid-run, manager target) are
 * proved by functions/src/http/managerSetUserRole.test.ts, not by looking.
 */
export const managerSetUserRole = async (
    _targetUserId: string, role: 'driver' | 'student',
) => ({ success: true, changed: true, role, name: 'Preview' });

// The sabha calendar's own callables.
export const updateSabhaRecurrence = async (rule: unknown) => ({ rule });
export const previewDeleteSabhaEvent = async () => ({ responseCount: 3, requestedRideCount: 1 });
export const deleteSabhaEvent = async () => ({ success: true });

// ---- Airport Seva ----------------------------------------------------------
//
// Added 2026-08-25. The records preview renders MemberExportCard and the airport
// preview renders the card and the request form, so every callable those reach has
// to exist here or the whole page fails to build — which is how this stub earns its
// keep: it is a second consumer of `src/utils/cloudFunctions`, and it caught the
// missing exports immediately.
//
// All three resolve as if they worked. The REFUSALS — a second Sarthi losing the
// claim race, a plain manager refused the airport export — are proved by
// functions/src/http/*.test.ts, not by looking at a screen.

export const requestAirportPickup = async () => ({
    success: true, pickupId: 'preview_pickup', arrivalAt: new Date().toISOString(),
});

export const updateAirportPickup = async () => ({ success: true, status: 'claimed' as const });

export const exportMembers = async (scope: 'airport' | 'sabha' | 'all') => ({
    success: true,
    scope,
    csv: 'Name,Email\r\nPreview Person,preview@example.com',
    rowCount: 1,
    truncated: false,
});

/** A real download in the harness would drop a file in Downloads on every click. */
export const downloadCSV = (_csv: string, filename: string) => {
    console.log(`[preview] would download ${filename}`);
};

/**
 * The notification panel's save.
 *
 * Echoes back rather than writing, like every other stub here — the harness has no
 * server. The panel's own snapshot listener is what would normally repaint it, and the
 * firestore stub replays a fixed document, so a toggle flicks back after the save.
 * That is correct for the harness: what is being looked at here is the LAYOUT and the
 * colours, and the behaviour is covered by tests/components/NotificationSettings.test.tsx.
 */
export const updateNotificationSettings = async (settings: unknown) => ({
    success: true, settings,
});
