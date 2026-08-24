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
