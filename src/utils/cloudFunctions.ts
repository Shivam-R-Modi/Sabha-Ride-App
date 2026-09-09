// ============================================
// CLOUD FUNCTIONS CLIENT
// Helper to call Firebase Cloud Functions
// ============================================

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/firebase/config';
import type { PresenceClaim } from './presence';
import type { RecurrenceRule } from './recurrence';
import type { ArrivalAction, ArrivalStatus, WhatsappOn } from './arrival';
import { codeOf, messageOf } from './errorText';
import type { NotificationSettings } from '../constants/notifications';

const functions = getFunctions(app);

// Connect to emulator in development
// To use emulator, uncomment the following lines
// connectFunctionsEmulator(functions, 'localhost', 5001);
// console.log('Using Firebase Functions emulator');

// Helper to call a function with error handling
async function callFunction<T = any>(name: string, data?: any): Promise<T> {
    try {
        const callable = httpsCallable(functions, name);
        const result = await callable(data);
        return result.data as T;
    } catch (error: unknown) {
        console.error(`Error calling ${name}:`, error);

        // Narrowed through the shared helper rather than `error?.message` on an
        // `unknown`, which did not compile and was five of the standing typecheck
        // errors. Behaviour is unchanged, and one part of it is load-bearing: the
        // SERVER'S message is what gets rethrown. studentReadyToLeave relies on
        // that — "your home address is not set" reaches the rider instead of a
        // generic "please try again" they cannot act on.
        const message = messageOf(error);
        const code = codeOf(error);

        if (message) console.error(`${name} error message:`, message);
        if (code) console.error(`${name} error code:`, code);

        throw new Error(message || `Failed to call ${name}`);
    }
}

// ============================================
// DRIVER FUNCTIONS
// ============================================

export interface AssignStudentsResult {
    rideId: string;
    students: Array<{
        id: string;
        name: string;
        location: { lat: number; lng: number };
        picked: boolean;
    }>;
    route: Array<{
        lat: number;
        lng: number;
        name: string;
        type: 'start' | 'pickup' | 'dropoff' | 'end';
        studentId?: string;
        visited: boolean;
    }>;
    estimatedDistance: number;
    estimatedTime: number;
    googleMapsUrl: string;
    car: {
        model: string;
        color: string;
        licensePlate: string;
        capacity: number;
    };
}

// The assignStudentsToDriver wrapper was removed along with the function it
// called. AssignStudentsResult stays — DriverDashboard uses it as the shape it
// maps a globalAssignDriver response into.

// Global assignment (Approach B) — driver-seeded K-means with lock
export interface GlobalAssignResult {
    status: 'success' | 'locked' | 'no_students';
    rideId?: string;
    students?: AssignStudentsResult['students'];
    route?: AssignStudentsResult['route'];
    estimatedDistance?: number;
    estimatedTime?: number;
    googleMapsUrl?: string;
    car?: AssignStudentsResult['car'];
    remainingUnassigned?: number;
    /**
     * WHY ANYONE NEARER WAS PASSED OVER. Counts and seats only, never names — the same
     * privacy rule the rest of this screen follows.
     *
     * It was returned by the server and rendered by nothing, so every refusal collapsed
     * into "Nobody is waiting right now" whatever the cause. `reasonForWaiting` below
     * turns each into a sentence a volunteer can act on.
     */
    waiting?: Array<{ reason: string; groups: number; seats: number }>;
}

/**
 * One waiting bucket, as a sentence.
 *
 * "Nobody is waiting" is true and leads to the wrong conclusion, which is exactly the
 * shape that sent a manager hunting for a dispatch fault on 2026-08-14. A Sarthi at a
 * quiet hall needs to know that people are waiting at the other one; one whose car is
 * too small needs to know a bigger one is the fix.
 *
 * Returns null for a reason worth no words — a stale request from another evening is
 * not this driver's problem and saying so would be noise.
 */
export function reasonForWaiting(
    row: { reason: string; groups: number; seats: number },
): string | null {
    const people = row.groups === 1 ? '1 group' : `${row.groups} groups`;
    switch (row.reason) {
        case 'other-location':
            return `${people} are waiting for the other sabha.`;
        case 'no-location':
            return `${people} did not say which sabha — a manager needs to check.`;
        /**
         * Beyond the distance limit FROM THIS SARTHI'S HOME, so this tap may not be
         * given them — not "nobody can reach them", which only the manager's board can
         * say (it considers every car and calls that `outside-every-fence`).
         *
         * So the sentence must do two things and avoid a third: say waiting will not
         * help THEM, point at the person who can see whether anyone else may go, and NOT
         * imply the rider is unreachable. A Sarthi who concluded "nobody can collect
         * them" and went home would be right about themselves and wrong about the
         * evening.
         *
         * No mileage in the wording on purpose. The bound is a policy number the owner
         * changes — it went 15 → 8 on 2026-09-08 — and the row shape carries only
         * `{reason, groups, seats}`. Naming a figure here would be the third copy of it,
         * after the constant and the board, and the one nobody would remember to update.
         */
        case 'outside-fence':
            return `${people} live further out than you are asked to drive. `
                + `Waiting will not bring them nearer — a manager can see whether `
                + `another Sarthi may go.`;
        case 'waiting-for-bigger-vehicle':
            return `${people} need a bigger car than yours (${row.seats} seats).`;
        case 'too-large-to-keep-together':
            return `${people} asked to stay together and no car is big enough.`;
        case 'no-seats-left':
            return null;
        default:
            return null;
    }
}

/**
 * `locationId` names which sabha this RUN is for.
 *
 * A Sarthi is not tied to a hall — they pick per run, so they can finish a load to one
 * and take the next to the other. Omitted when only one hall is open, which is every
 * evening until a manager opens a second; the server refuses rather than guessing once
 * there is a real choice.
 */
export async function globalAssignDriver(
    driverId: string, carId: string, locationId?: string | null,
): Promise<GlobalAssignResult> {
    return callFunction<GlobalAssignResult>('globalAssignDriver', {
        driverId, carId, ...(locationId ? { locationId } : {}),
    });
}

export interface StartRideResult {
    success: boolean;
    rideId: string;
    startedAt: string;
    destination: string;
}

export async function startRide(rideId: string): Promise<StartRideResult> {
    return callFunction<StartRideResult>('startRide', { rideId });
}

export interface CompleteRideResult {
    success: boolean;
    rideId: string;
    completedAt: string;
    driverStats: {
        ridesCompletedToday: number;
        totalStudentsToday: number;
        totalDistanceToday: number;
    };
}

/**
 * Tell this stop's rider the Sarthi is outside.
 *
 * Idempotent server-side on `arrivedAt`, so a second tap is free and reports
 * `alreadyArrived` rather than announcing again.
 */
/** Publish a notice-board post. Optionally pushes, via the same broadcast floor. */
export async function publishNotice(input: {
    title: string;
    body: string;
    imagePath?: string | null;
    imageUrl?: string | null;
    showUntil?: string | null;
    eventId?: string | null;
    push?: boolean;
}): Promise<{ success: boolean; noticeId: string }> {
    return callFunction<{ success: boolean; noticeId: string }>('publishNotice', input);
}

/** Take a notice down. Deletes its image too — a client cannot do both. */
export async function deleteNotice(noticeId: string): Promise<{ success: boolean }> {
    return callFunction<{ success: boolean }>('deleteNotice', { noticeId });
}

/**
 * One message to every phone. Server-side this is rate limited per manager AND
 * by a congregation-wide floor, and every send writes an audit row.
 */
export async function managerBroadcast(body: string): Promise<{ success: boolean }> {
    return callFunction<{ success: boolean }>('managerBroadcast', { body });
}

/**
 * Save the whole notification configuration.
 *
 * A WHOLE CONFIGURATION, not a patch. The panel holds every value on screen anyway,
 * and a patch would need merge semantics for the nested `enabled` map — which is
 * exactly how a document ends up in a half-state where one field was written and
 * another silently was not.
 */
export async function updateNotificationSettings(
    settings: NotificationSettings,
): Promise<{ success: boolean; settings: NotificationSettings }> {
    return callFunction('updateNotificationSettings', settings);
}

export async function sarthiArrived(rideId: string): Promise<{ success: boolean; alreadyArrived: boolean }> {
    return callFunction<{ success: boolean; alreadyArrived: boolean }>('sarthiArrived', { rideId });
}

/**
 * Close the run, and say who actually travelled.
 *
 * `absentStudentIds` names anyone who did not get in the car. Their ride is
 * cancelled rather than completed and they are not recorded as having arrived —
 * which matters most on the way home, where the alternative is telling a parent
 * their child is `home_safe`. Omitted or empty is the normal night.
 */
/**
 * Ask one rider again, while the Sarthi waits outside.
 *
 * Fixed text, chosen server-side — nothing said here reaches a phone. The
 * cooldown is per rider, and `delivered: 0` means the message reached no device
 * at all, which is when the Sarthi should use the phone button instead.
 */
export async function nudgeRider(
    rideId: string,
    studentId: string,
): Promise<{ success: boolean; delivered: number }> {
    return callFunction<{ success: boolean; delivered: number }>('nudgeRider', { rideId, studentId });
}

export async function completeRide(
    rideId: string,
    absentStudentIds: string[] = [],
): Promise<CompleteRideResult> {
    return callFunction<CompleteRideResult>('completeRide', { rideId, absentStudentIds });
}

export interface ReleaseAssignmentResult {
    success: boolean;
    rideId: string;
    studentsReleased: number;
    message: string;
}

export async function releaseAssignment(rideId: string): Promise<ReleaseAssignmentResult> {
    return callFunction<ReleaseAssignmentResult>('releaseAssignment', { rideId });
}

export interface DriverDoneResult {
    success: boolean;
    driverId: string;
    carReleased: boolean;
    message: string;
    /**
     * True when riders are still waiting and this driver is the last one holding
     * a car. Nothing was released — ask, then call again with acknowledgeWaiting.
     */
    needsConfirmation?: boolean;
    waitingCount?: number;
    warning?: string;
}

/**
 * @param acknowledgeWaiting the driver has seen the "riders are still waiting"
 * warning and is finishing anyway. Always their call to make.
 */
export async function driverDoneForToday(
    driverId: string,
    acknowledgeWaiting = false,
): Promise<DriverDoneResult> {
    return callFunction<DriverDoneResult>('driverDoneForToday', { driverId, acknowledgeWaiting });
}

/** One date holding bookings that the new rule would remove. */
export interface StrandedDate {
    date: string;
    /** Where these bookings move to, or null when the rule schedules nothing. */
    target: string | null;
    responseCount: number;
    requestedRideCount: number;
    names: string[];
}

export interface UpdateRecurrenceResult {
    /** The stored rule, as the server understood it. */
    rule: RecurrenceRule;
    /**
     * Dates that hold bookings the new rule removes.
     *
     * On a `dryRun` this is the question; on a real save it is what was moved.
     * Empty is the ordinary case.
     */
    stranded: StrandedDate[];
}

/**
 * A manager sets the recurring sabha pattern.
 *
 * No `weeksAhead`, and nothing is created: the rule IS the schedule now, and
 * `findCurrentEvent` computes occurrences from it. Both fields the generator used
 * — `weeksAhead` and `generatedThrough` — are actively deleted server-side, so a
 * stale value cannot bring the old behaviour back.
 *
 * A single date is changed by writing an exception for that date, not by
 * re-generating a window. See src/utils/recurrence.ts.
 */
export async function updateSabhaRecurrence(
    input: Pick<RecurrenceRule, 'enabled' | 'daysOfWeek' | 'startTime' | 'endTime'>
        & {
            /** Ask what this would strand, without saving anything. */
            dryRun?: boolean;
            /** Required by the server once anything would be stranded. */
            acknowledge?: boolean;
        },
): Promise<UpdateRecurrenceResult> {
    return callFunction<UpdateRecurrenceResult>('updateSabhaRecurrence', input);
}

export interface ManagerReleaseVehicleResult {
    success: boolean;
    vehicleId: string;
    previousHolder: string | null;
}

/**
 * A manager hands a stuck car back to the fleet.
 *
 * Server-side rather than a client write, because freeing a car also clears
 * `currentVehicleId` on ANOTHER user's document and the writes must land together
 * or not at all. The callable refuses while that driver has a live ride.
 */
export async function managerReleaseVehicle(vehicleId: string): Promise<ManagerReleaseVehicleResult> {
    return callFunction<ManagerReleaseVehicleResult>('managerReleaseVehicle', { vehicleId });
}

export interface SetUserRoleResult {
    success: boolean;
    /** False when the document already said exactly this. Not an error. */
    changed: boolean;
    reason?: 'already';
    role: 'driver' | 'student';
    name: string;
    releasedRideIds?: string[];
    releasedRiderIds?: string[];
    releasedVehicleIds?: string[];
}

/**
 * A manager moves one person between Bhulku and Sarthi, in place.
 *
 * Server-side because a role lives in FOUR fields on the user document and
 * different readers read different ones — `roles[]` is what the driver picker
 * queries, `registeredRole` what the approval queues query. Writing some of them
 * produces one person with two disagreeing identities, which is exactly what the
 * raw field editor in Records could always do. firestore.rules now refuses role
 * fields from a browser outright, so this is the only path.
 *
 * Refuses manager targets: removing the manager role also needs the `mgr` custom
 * claim cleared, which is not done here.
 *
 * A demotion also hands back any car and returns any still-`assigned` carload to
 * the pool, and REFUSES once a run is underway — so the thrown message is worth
 * showing verbatim, which callFunction already does.
 */
export async function managerSetUserRole(
    targetUserId: string,
    role: 'driver' | 'student',
): Promise<SetUserRoleResult> {
    return callFunction<SetUserRoleResult>('managerSetUserRole', { targetUserId, role });
}

// ============================================
// STUDENT FUNCTIONS
// ============================================

export interface ReadyToLeaveResult {
    success: boolean;
    studentId: string;
    message: string;
    status: string;
}

/**
 * @param presence how the rider's presence at the sabha was established. Recorded
 * on the ride and shown to managers — never enforced, because the manual route is
 * always available and a rider must never be stranded by a bad GPS fix.
 * Coordinates are deliberately not sent; only the method and a rounded distance.
 */
export async function studentReadyToLeave(
    studentId: string,
    presence?: PresenceClaim,
    /**
     * Which hall they are standing at, when the app has no record of it.
     *
     * Only used server-side where `atLocationId` is absent — anybody who was DRIVEN
     * here had it written when their ride completed, and that record wins over a
     * claim. This is for the walk-ins, the drive-themselves and the got-a-lift crowd,
     * who otherwise met a refusal with no way to answer it.
     */
    locationId?: string | null,
): Promise<ReadyToLeaveResult> {
    return callFunction<ReadyToLeaveResult>('studentReadyToLeave', {
        studentId, presence, ...(locationId ? { locationId } : {}),
    });
}

// ============================================
// MANAGER FUNCTIONS
// ============================================

export interface ManualAssignResult {
    success: boolean;
    rideId: string;
    studentAdded: {
        id: string;
        name: string;
    };
    updatedStats: {
        totalStudents: number;
        estimatedDistance: number;
        estimatedTime: number;
    };
}

export async function manualAssignStudent(studentId: string, driverId: string): Promise<ManualAssignResult> {
    return callFunction<ManualAssignResult>('manualAssignStudent', { studentId, driverId });
}

export interface GenerateCSVResult {
    success: boolean;
    eventDate: string;
    csvContent: string;
    summary: {
        totalStudents: number;
        pickupOnly: number;
        dropoffOnly: number;
        both: number;
    };
}

export async function generateEventCSV(eventDate: string): Promise<GenerateCSVResult> {
    return callFunction<GenerateCSVResult>('generateEventCSV', { eventDate });
}

// ============================================
// MANAGER AUTH FUNCTIONS
// ============================================

// verifyManagerCode lived here — one shared code, no expiry, no single use, and
// readable in plaintext by any approved manager. Replaced by the invite pair
// below; the callable itself is deleted.

export interface CreateInviteResult {
    /** The plaintext. Returned once and never retrievable again. */
    code: string;
    ref: string;
    expiresAt: string;
}

/**
 * Mint a single-use manager invite. Approved managers only.
 *
 * The returned code exists nowhere else — Firestore holds only a salted hash — so
 * a caller that loses it must mint another. That is the point: the old
 * settings/managerCode could be read back out of the database by any manager.
 */
export async function createManagerInvite(label?: string): Promise<CreateInviteResult> {
    return callFunction<CreateInviteResult>('createManagerInvite', { label });
}

export interface RedeemInviteResult {
    redeemed: boolean;
    /** 'not-found' | 'already-used' | 'revoked' | 'expired' | 'wrong-code' */
    reason?: string;
    /** Ready to show the user. Each refusal says something different on purpose. */
    message?: string;
}

/**
 * Redeem an invite and become an approved manager.
 *
 * Resolves rather than throwing on a bad code, so the caller can show an inline
 * retry instead of an error screen — a mistyped code is the expected case.
 */
export async function redeemManagerInvite(code: string): Promise<RedeemInviteResult> {
    return callFunction<RedeemInviteResult>('redeemManagerInvite', { code });
}

// ============================================
// SYSTEM FUNCTIONS
// ============================================

export interface RideContextResult {
    rideType: 'home-to-sabha' | 'sabha-to-home' | null;
    displayText: string;
    timeContext: string;
    lastUpdated: string;
}

/**
 * Manager control over the ride window.
 *
 * `rideType` opens that window immediately, overriding the schedule until the
 * end of the day in Sabha local time. `reset` hands control back to the
 * schedule straight away.
 *
 * The old shape was `{ testMode, forceRideType }`, and testMode blocked the
 * scheduler indefinitely — a manager who forgot to clear it froze the ride
 * window for everyone until someone edited Firestore by hand.
 */
export interface ManuallyUpdateRideContextParams {
    rideType?: 'home-to-sabha' | 'sabha-to-home';
    reset?: boolean;
}

export async function manuallyUpdateRideContext(params?: ManuallyUpdateRideContextParams): Promise<RideContextResult> {
    return callFunction<RideContextResult>('manuallyUpdateRideContext', params);
}

/**
 * Opening or closing a sabha hall.
 *
 * A CALLABLE BECAUSE THE FIELD IS NOT CLIENT-WRITABLE. firestore.rules denies `active`
 * in both directions, so a manager may create a hall and correct its address from the
 * app but cannot switch one on. That split is deliberate: an address typed wrong is
 * visible and fixable, whereas opening a hall changes what every rider is asked and
 * where every Sarthi can be sent — and closing one leaves everybody already booked for
 * it undispatchable, with no error anywhere.
 *
 * `dryRun` first, always: the dialog needs to say how many riders would be stranded
 * before a manager confirms.
 */
export interface LocationActivePreview {
    locationId: string;
    name: string;
    /** What it would become. */
    active: boolean;
    /** Riders booked for this hall who are still waiting for a car. */
    requestedRideCount: number;
    /** People those requests are for — seven requests can be fourteen riders. */
    requestedSeatCount: number;
    /** How many halls would be open afterwards. Zero is refused. */
    openAfter: number;
}

export async function previewLocationActive(
    locationId: string,
    active: boolean,
): Promise<LocationActivePreview> {
    return callFunction<LocationActivePreview>('setLocationActive', {
        locationId, active, dryRun: true,
    });
}

export async function setLocationActive(
    locationId: string,
    active: boolean,
    /**
     * Confirms that riders booked for this hall will stop being dispatchable.
     *
     * Only consulted when closing one with people waiting; the server refuses without
     * it rather than trusting the dialog to have asked.
     */
    acknowledge = false,
): Promise<LocationActivePreview & { changed: boolean }> {
    return callFunction<LocationActivePreview & { changed: boolean }>(
        'setLocationActive', { locationId, active, acknowledge });
}

/**
 * The waiting queue split into the cars dispatch would form.
 *
 * WHY THE SERVER ANSWERS THIS. The grouping has to be the same grouping
 * `globalAssignDriver` produces, or a manager plans around it, moves somebody by hand,
 * and the next tap does something else. The seed-and-grow geometry and the seat
 * arithmetic stay in one place, on the server, and this asks for the result.
 *
 * WHAT IT CANNOT KNOW. The cars are real Sarthi/vehicle pairs, and the geo-fence is
 * applied from each Sarthi's own home — the same bound and the same distance function
 * dispatch enforces. So the only thing left unknown is the ORDER they tap in, and the
 * split genuinely depends on it. Every group therefore names whose car it is and the
 * screen says it re-forms on each tap.
 *
 * A car nobody has taken yet has no Sarthi and so no home to measure from: `fenced` is
 * false on it and the screen has to say the limit was not checked.
 */
export interface CarloadGroup {
    /** Free passenger seats assumed for this car. Rendered, not hidden. */
    seats: number;
    /** Whose car — a Sarthi's uid, or a vehicle id when nobody has taken it. */
    carId: string;
    /** Was the 15-mile limit applied? False for a car with no Sarthi yet. */
    fenced: boolean;
    /**
     * The rider the car was built around, or null when the anchor could not fit in it.
     *
     * Null rather than a name that is not in the list: "anchored on Ramesh" above three
     * other people reads as a bug and a manager would chase it.
     */
    anchorId: string | null;
    riders: Array<{
        id: string;
        /** Seats this car takes. Fewer than `totalSeats` when `split`. */
        seats: number;
        totalSeats: number;
        split: boolean;
    }>;
}

export type CarloadLeftoverReason =
    /** Every simulated car was full by the time the walk reached them. */
    | 'no-car-left'
    /** Too big for the cars free tonight, but a vehicle in the fleet could take them. */
    | 'waiting-for-bigger-vehicle'
    /** No vehicle seats this many AND the rider refused to be split. Needs a manager. */
    | 'too-large-to-keep-together'
    /**
     * Too far from EVERY Sarthi on shift for dispatch to send any of them.
     *
     * The one reason that is not about seats. No volunteer is ALLOWED to collect them,
     * so waiting for a car to free up will never help — it needs a manager to arrange
     * something other than a normal pickup. Reported separately for exactly that reason.
     */
    | 'outside-every-fence';

export interface CarloadPreviewResult {
    /**
     * `window-closed` is an ANSWER, not an error.
     *
     * A manager looking at the queue between sabhas has done nothing wrong, so the
     * server reports it rather than throwing — an error on a screen nobody acted on
     * reads as a fault in the app.
     */
    status: 'ok' | 'window-closed';
    rideType?: 'home-to-sabha' | 'sabha-to-home';
    locationId?: string;
    groups: CarloadGroup[];
    /** A REASON per rider, never a bare count. Three of the four need a manager. */
    leftover: Array<{ id: string; seats: number; reason: CarloadLeftoverReason }>;
    /**
     * The cars it simulated, largest first, Sarthis before unclaimed vehicles.
     *
     * No coordinates: the Sarthi's home is what the fence is measured FROM and it stays
     * on the server. The board only needs to know a limit was applied.
     */
    cars: Array<{ id: string; seats: number; fenced: boolean }>;
    /**
     * Cars that exist but can collect nobody, and why.
     *
     * A Sarthi with no home address is refused by dispatch outright, and one revoked
     * mid-evening while still holding a car takes nobody. Both would otherwise be a car
     * silently absent from the board — and both are things a manager fixes in one call.
     */
    unusable: Array<{ id: string; reason: 'no-home-address' | 'driver-not-approved' }>;
    /** The bound applied, so the screen names the number instead of hardcoding it. */
    fenceMiles?: number;
    /** Largest passenger capacity in the WHOLE fleet, free or not. */
    maxFleetSeats?: number;
}

export async function previewCarloads(
    /** One hall. Defaults to the founding hall, which is the only one with one open. */
    locationId?: string | null,
): Promise<CarloadPreviewResult> {
    return callFunction<CarloadPreviewResult>('previewCarloads', { locationId: locationId ?? null });
}

/**
 * What deleting a sabha would affect. Shown to the manager before they confirm.
 */
export interface DeleteSabhaEventPreview {
    date: string;
    /** The hall this would cancel, or null for the whole evening. */
    locationId: string | null;
    /**
     * The hall's name, echoed back by the server.
     *
     * The dialog names the scope from THIS rather than from what the caller believes
     * it sent, so a confirmation cannot say "the sabha at Elm Street" over a request
     * the server read as the whole evening.
     */
    locationName: string | null;
    responseCount: number;
    requestedRideCount: number;
    isCurrentEvent: boolean;
}

/**
 * Removing a gathering cannot be a client-side delete, and firestore.rules denies
 * it to everyone including managers.
 *
 * Firestore leaves `weeklyAttendance/{date}/responses/*` behind when the parent
 * goes, outstanding ride requests have to be cancelled or the next sabha inherits
 * them, and `system/rideContext` has to be rewritten so it never names a deleted
 * document. Only the Admin SDK can do all of that, in one commit.
 */
export async function previewDeleteSabhaEvent(
    date: string,
    /** One hall, or null for the whole evening. */
    locationId: string | null = null,
): Promise<DeleteSabhaEventPreview> {
    return callFunction<DeleteSabhaEventPreview>('deleteSabhaEvent', {
        date, locationId, dryRun: true,
    });
}

export async function deleteSabhaEvent(
    date: string,
    acknowledge: boolean,
    /**
     * One hall, or null for the whole evening.
     *
     * DEFAULTS TO THE WHOLE EVENING, which is what this function always did — a caller
     * that has not been taught about halls keeps its old behaviour rather than
     * cancelling an arbitrary one.
     */
    locationId: string | null = null,
): Promise<DeleteSabhaEventPreview & { deleted: boolean }> {
    return callFunction<DeleteSabhaEventPreview & { deleted: boolean }>(
        'deleteSabhaEvent', { date, acknowledge, locationId });
}

// ============================================
// GEOCODING FUNCTIONS
// ============================================

// `geocodeAddress` and `geocodeAddressViaCloud` were here — two wrappers around
// one callable that returned 500 for every call it ever received, because the key
// in functions/.env is referer-restricted and a server sends no referer. Geocoding
// happens in the browser now, with the key that already works:
// `geocodeAddressInBrowser` in hooks/useGooglePlaces.ts.

export async function adminDeleteUserViaCloud(targetUserId: string | string[]): Promise<{ success: boolean; deletedCount: number }> {
    if (Array.isArray(targetUserId)) {
        return callFunction<{ success: boolean; deletedCount: number }>('adminDeleteUser', { targetUserIds: targetUserId });
    }
    return callFunction<{ success: boolean; deletedCount: number }>('adminDeleteUser', { targetUserId });
}

// ============================================
// CSV DOWNLOAD HELPER
// ============================================

export function downloadCSV(csvContent: string, filename: string): void {
    // BOM first. Without it Excel reads a UTF-8 file as Latin-1 and mangles every
    // non-ASCII name — and for this congregation that is most of them. The file
    // still opens and the columns still line up, so the damage survives being
    // checked. Added 2026-08-21 alongside the feedback export, which is where the
    // defect was noticed; it had been shipping in both existing exports.
    const blob = new Blob([`﻿${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ============================================
// AIRPORT SEVA
// ============================================

/**
 * What the request form sends.
 *
 * Deliberately NOT `Partial<AirportPickup>`. The document carries fields the server
 * owns — `arrivalAt`, `status`, `retainUntil`, the passenger snapshot — and typing
 * the payload as the document invites a form to send one and a reader to believe it
 * was honoured. Everything here is something a traveller actually types.
 *
 * `arrivalDate` and `arrivalTime` are read on a clock AT THE AIRPORT. The absolute
 * instant is derived server-side, because no client in this app computes an hour.
 */
export interface AirportPickupRequest {
    arrivalDate: string;        // 'YYYY-MM-DD'
    arrivalTime: string;        // 'HH:MM' 24-hour
    airportCode: string;
    airline?: string;
    flightNumber?: string;
    terminal?: string;
    isInternational: boolean;

    partySize: number;
    largeBags: number;
    cabinBags: number;
    /** Optional together — see AirportPickup in types.ts for why. */
    dropoffAddress?: string;
    dropoffLat?: number;
    dropoffLng?: number;
    hasUsWorkingPhone: boolean;
    meetingPointNote?: string;
    needsStopOnTheWay?: string;
    notes?: string;

    fullName: string;
    preferredName?: string;
    dateOfBirth: string;        // 'YYYY-MM-DD'
    email: string;
    phone: string;
    altPhone?: string;
    whatsappOn: WhatsappOn;
    university?: string;
    familyContact?: {
        name: string;
        relationship: string;
        phone: string;
        hasWhatsapp: boolean;
        preferredLanguage?: string;
    };
}

export async function requestAirportPickup(
    input: AirportPickupRequest,
): Promise<{ success: boolean; pickupId: string; arrivalAt: string }> {
    return callFunction<{ success: boolean; pickupId: string; arrivalAt: string }>(
        'requestAirportPickup', input);
}

/**
 * Every transition. One callable, because they all read one document, check the
 * shared transition table and write it back inside a transaction.
 *
 * `action` is typed against the same union the server validates against — imported
 * from src/utils/arrival.ts, which is pinned to its server mirror by
 * tests/quality/arrival-table-parity.test.ts. A client that offered an action the
 * server refuses would be a dead button.
 */
export interface AirportPickupUpdate {
    pickupId: string;
    action: ArrivalAction;
    /** Why a trip was released or cancelled. Optional. */
    reason?: string;
}

/**
 * `editRequest` carries THE WHOLE REQUEST, not a patch.
 *
 * The server runs the same three parsers the create path runs — anything less would
 * be a second, laxer way into a collection no client may write directly — so the
 * payload has to be complete. Typed as the create request plus the id, which is
 * exactly what that means, and keeps the two from drifting apart.
 */
export type AirportPickupEdit = AirportPickupRequest & {
    pickupId: string;
    action: 'editRequest';
};

export async function updateAirportPickup(
    input: AirportPickupUpdate | AirportPickupEdit,
): Promise<{ success: boolean; status: ArrivalStatus }> {
    return callFunction<{ success: boolean; status: ArrivalStatus }>('updateAirportPickup', input);
}

/**
 * The member directory as CSV, in one of three scopes.
 *
 * Spans both services, which is why it sits with the manager's other exports rather
 * than inside Airport Seva. `airport` additionally requires the coordinator flag —
 * that scope reads the collection holding exact dates of birth.
 *
 * `truncated` comes back rather than being swallowed. A short file that looks
 * complete is how somebody concludes half the congregation has left.
 */
export interface MemberExport {
    success: boolean;
    scope: 'airport' | 'sabha' | 'all';
    csv: string;
    rowCount: number;
    truncated: boolean;
}

export async function exportMembers(scope: 'airport' | 'sabha' | 'all'): Promise<MemberExport> {
    return callFunction<MemberExport>('exportMembers', { scope });
}
