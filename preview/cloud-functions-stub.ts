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

/**
 * The carload grouping, canned.
 *
 * Deliberately the AWKWARD case rather than a tidy one, because a tidy grouping tells
 * you nothing about the layout: two cars, a family split across them, a rider nobody
 * can carry, and one still waiting. Every badge on the board appears at least once, so
 * looking at this page is what catches a wrapping or contrast problem in the states
 * that only turn up on a busy Friday.
 */
export const previewCarloads = async (locationId?: string | null) => ({
    status: 'ok' as const,
    rideType: 'home-to-sabha' as const,
    // ECHOED BACK, because the board compares it against the picker to know whether it
    // is still showing the hall you switched away from. Hardcoded, that check is either
    // permanently on or permanently off and the harness cannot show either honestly.
    locationId: locationId ?? 'boston-huntington',
    fenceMiles: 15,
    maxFleetSeats: 6,
    /**
     * ONE SARTHI'S CAR AND ONE NOBODY HAS TAKEN, so both halves of the fence story are
     * on screen: a fenced group named after the Sarthi, and an unfenced one that has to
     * admit the limit was not applied to it. `drv-1` matches a driver in the firestore
     * stub, so the card shows a name rather than a uid.
     */
    cars: [
        { id: 'drv-1', seats: 6, fenced: true },
        { id: 'veh_1', seats: 3, fenced: false },
    ],
    /** A Sarthi holding a car who cannot be dispatched. The row nobody would see. */
    unusable: [{ id: 'drv-2', reason: 'no-home-address' as const }],
    groups: [
        {
            seats: 6,
            carId: 'drv-1',
            fenced: true,
            anchorId: 'req-4',
            riders: [
                { id: 'req-4', seats: 1, totalSeats: 1, split: false },
                { id: 'req-5', seats: 2, totalSeats: 2, split: false },
                { id: 'req-2', seats: 3, totalSeats: 8, split: true },
            ],
        },
        {
            seats: 3,
            carId: 'veh_1',
            fenced: false,
            anchorId: 'req-1',
            riders: [
                { id: 'req-1', seats: 1, totalSeats: 1, split: false },
                { id: 'req-6', seats: 2, totalSeats: 2, split: false },
            ],
        },
    ],
    leftover: [
        { id: 'req-2', seats: 5, reason: 'no-car-left' as const },
        { id: 'req-3', seats: 7, reason: 'too-large-to-keep-together' as const },
        { id: 'req-7', seats: 4, reason: 'waiting-for-bigger-vehicle' as const },
        // The Woburn case, which is the whole reason the fence is applied here.
        { id: 'req-10', seats: 1, reason: 'outside-every-fence' as const },
    ],
});

/**
 * Opening and closing a hall, canned.
 *
 * Returns a CLOSE that would strand people, because that is the dialog worth looking at
 * — the one where the count has to be right and the wording has to say what silence a
 * rider would get.
 */
export const previewLocationActive = async (locationId: string, active: boolean) => ({
    locationId, active,
    name: locationId === 'somerville' ? 'Elm Street' : 'Sabha',
    requestedRideCount: active ? 0 : 3,
    requestedSeatCount: active ? 0 : 7,
    openAfter: active ? 3 : 1,
});

export const setLocationActive = async (locationId: string, active: boolean) => ({
    locationId, active, name: 'Elm Street',
    requestedRideCount: 0, requestedSeatCount: 0, openAfter: 1, changed: true,
});
