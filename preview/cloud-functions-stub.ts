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
