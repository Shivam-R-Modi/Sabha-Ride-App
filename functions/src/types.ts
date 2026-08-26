// ============================================
// SABHA RIDE SEVA - CLOUD FUNCTIONS TYPES
// ============================================

import type {
    ArrivalDirection, ArrivalStatus, WhatsappOn, AlertBand,
} from './utils/arrival';

export type UserRole = 'student' | 'driver' | 'manager';
export type AccountStatus = 'pending' | 'approved' | 'rejected';
export type RideType = 'home-to-sabha' | 'sabha-to-home';
export type RideStatus = 'assigned' | 'in_progress' | 'completed' | 'cancelled';
export type VehicleStatus = 'available' | 'in_use' | 'maintenance';

export type StudentStatus =
    | 'waiting_for_pickup'
    | 'waiting_for_dropoff'
    | 'assigned'
    | 'in_ride'
    | 'at_sabha'
    | 'home_safe'
    | 'missed_pickup'
    /** Request reached the end of the ride window with no driver. */
    | 'missed_ride';

export type DriverStatus =
    | 'offline'
    | 'ready_for_assignment'
    | 'assigned'
    | 'active_ride';

export interface GeoLocation {
    lat: number;
    lng: number;
    address?: string;
}

export interface User {
  /**
   * The congregation this record belongs to. Written everywhere, read by nothing
   * yet — filtering comes a release later, behind a verifier. Optional because
   * documents created before the backfill do not carry it, and a rule requiring
   * it would reject a ride request on a Friday evening.
   */
  cityId?: string;
  locationId?: string;
    id: string;
    email: string;
    name: string;
    phone?: string;
    roles: UserRole[];
    activeRole: UserRole;
    avatarUrl?: string;
    createdAt: string;
    lastActive?: string;
    /** One entry per device with push on, keyed by token. See tokensOf(). */
    fcmTokens?: Record<string, { label?: string; updatedAt?: string }>;
    /** @deprecated Pre-map shape. Still read so older documents keep working. */
    fcmToken?: string;
    accountStatus: AccountStatus;
    registeredRole?: UserRole;
    role?: UserRole;
    status?: string;
}

export interface Student {
    id: string;
    userId: string;
    name: string;
    location: GeoLocation;
    phone?: string;
    status: StudentStatus;
    currentRideId: string | null;
    pickupRequested: boolean;
    dropoffRequested: boolean;
}

export interface Driver {
    id: string;
    userId: string;
    name: string;
    phone?: string;
    currentCarId: string | null;
    currentLocation: GeoLocation | null;
    homeLocation: GeoLocation | null;
    status: DriverStatus;
    activeRideId: string | null;
    ridesCompletedToday: number;
    totalStudentsToday: number;
    totalDistanceToday: number;
}

export interface Vehicle {
    id: string;
    name: string;
    color: string;
    licensePlate: string;
    capacity: number;
    status: VehicleStatus;
    currentDriverId: string | null;
}

export interface RideStudent {
    id: string;
    name: string;
    phone?: string;
    studentPhone?: string;
    location: GeoLocation;
    picked: boolean;
    /** The ride document this stop came from. */
    rideRequestId?: string;
    status?: string;
    /**
     * People at this stop. Absent means one — every roster written before seats
     * existed. A stop is one address, so this is what the car must have room for
     * while `students.length` is only the number of pickups.
     */
    seats?: number;
    /**
     * Size of the whole party when this stop is part of a group split across
     * cars. Present only then, so the driver's screen can say "3 of 6 here" and
     * nobody pulls away leaving the rest on the pavement.
     */
    groupSeats?: number;
}

export interface Waypoint {
    lat: number;
    lng: number;
    name: string;
    type: 'start' | 'pickup' | 'dropoff' | 'end';
    studentId?: string;
    visited: boolean;
}

export interface Ride {
  /**
   * The congregation this record belongs to. Written everywhere, read by nothing
   * yet — filtering comes a release later, behind a verifier. Optional because
   * documents created before the backfill do not carry it, and a rule requiring
   * it would reject a ride request on a Friday evening.
   */
  cityId?: string;
  locationId?: string;
    id: string;
    eventDate: string;
    /**
     * The gathering this ride belongs to ("YYYY-MM-DD"), snapshotted at
     * assignment so the ride stays tied to its own sabha.
     */
    eventId?: string | null;
    /**
     * The venue as resolved when this ride was assigned. Snapshotted rather than
     * looked up live: manualAssignStudent rebuilds the route for every passenger
     * when one is added, and a live lookup would re-point people already on board
     * at whatever the current gathering's venue happens to be.
     */
    venue?: GeoLocation | null;
    driverId: string;
    driverName: string;
    carId: string;
    carModel: string;
    carColor: string;
    carLicensePlate: string;
    rideType: RideType;
    status: RideStatus;
    students: RideStudent[];
    route: Waypoint[];
    estimatedDistance: number;
    estimatedTime: number;
    startedAt: string | null;
    completedAt: string | null;
    allWaypointsVisited: boolean;
}

export interface RideContext {
    rideType: RideType | null;
    displayText: string;
    timeContext: string;
    lastUpdated: string;
}

export interface AssignmentResult {
    rideId: string;
    students: RideStudent[];
    route: Waypoint[];
    estimatedDistance: number;
    estimatedTime: number;
}

export interface EventStatistics {
    eventDate: string;
    pickup: {
        totalStudents: number;
        completedRides: number;
        totalDrivers: number;
        students: Array<{
            id: string;
            name: string;
            driverId?: string;
            driverName?: string;
            carModel?: string;
            carLicensePlate?: string;
        }>;
    };
    dropoff: {
        totalStudents: number;
        completedRides: number;
        totalDrivers: number;
        students: Array<{
            id: string;
            name: string;
            driverId?: string;
            driverName?: string;
            carModel?: string;
            carLicensePlate?: string;
        }>;
    };
    attendance: {
        both: number;
        pickupOnly: number;
        dropoffOnly: number;
    };
}

// ============================================
// AIRPORT SEVA
// ============================================
//
// A second service behind the same login: someone landing in the USA asks to be
// collected, and a Sarthi picks the trip off a calendar. Deliberately NOT part of
// the `rides` collection — that model is built around a sabha event, a ride window
// published in `system/rideContext`, and a clustering solver that packs several
// riders into one car. An airport run has none of those: it is scheduled weeks out,
// it is one party, and the Sarthi chooses it rather than the server choosing them.
//
// The transition table, urgency thresholds, airport zones and field caps live in
// src/utils/arrival.ts and functions/src/utils/arrival.ts, mirrored and pinned.

export interface ArrivalFamilyContact {
    name: string;
    relationship: string;
    /** E.164, produced by validatePhoneNumber in src/utils/phoneUtils.ts. */
    phone: string;
    hasWhatsapp: boolean;
    preferredLanguage?: string;
}

/**
 * The traveller's details AS THEY WERE when the request was filed, copied onto the
 * trip.
 *
 * Denormalised for the same reason `Ride.studentPhone` is: the Sarthi's card needs
 * a name and a number, and a second read to get them is a read that can fail. It
 * also means a Sarthi never needs permission on `airportProfiles`, which is where
 * the date of birth and the family contact live for everybody, past trips included.
 *
 * A later correction to a phone number does not rewrite past trips. That is correct
 * for a historical record; the callable re-snapshots on every new request.
 */
export interface ArrivalPassenger {
    name: string;
    /** 'YYYY-MM-DD'. See the D2 note on AirportProfile. */
    dateOfBirth: string;
    phone: string;
    altPhone?: string;
    whatsappOn: WhatsappOn;
    email: string;
    /** Null when the traveller gave no family contact — the WhatsApp button then renders nothing. */
    familyContact: ArrivalFamilyContact | null;
}

/**
 * The durable person record, keyed by uid so there is one per traveller.
 *
 * This is the "database that gets used for other purposes": it outlives the trip
 * and is the source for the Airport scope of the member export. Written only by
 * Cloud Functions.
 *
 * READ BY THE OWNER AND BY MANAGERS ONLY — never by a Sarthi. Everything a Sarthi
 * needs is on `ArrivalPassenger` above.
 *
 * `dateOfBirth` REVERSES compliance decision D2 ("age bands only; no DOB field
 * exists anywhere", docs/compliance/technical-enforcement.md). That was an owner
 * decision on 2026-08-25, taken so a Sarthi can confirm identity at an arrivals
 * gate, and it is recorded in the register rather than left to contradict it. The
 * field is the reason this collection is closed to Sarthis.
 */
export interface AirportProfile {
    cityId?: string;
    locationId?: string;
    /** Same as the document id. */
    uid: string;
    fullName: string;
    /** What they would rather be called, when it differs from the passport name. */
    preferredName?: string;
    dateOfBirth: string;
    email: string;
    phone: string;
    altPhone?: string;
    whatsappOn: WhatsappOn;
    university?: string;
    familyContact: ArrivalFamilyContact | null;
    createdAt: string;
    updatedAt: string;
    /**
     * D7. Computed at write time so a purge job can honour it without re-deriving
     * the rule. NOTHING PURGES YET — no scheduled job reads this field. It is
     * written ahead of the job for the same reason cityId is: stamping first and
     * filtering later fails loudly, while backfilling later fails silently.
     */
    retainUntil: string;
}

/**
 * One airport trip. Written only by Cloud Functions; every client is denied.
 *
 * THE ARRIVAL TIME IS LOCAL TO THE AIRPORT. `arrivalDate` and `arrivalTime` are
 * what the traveller read off their ticket and are the only thing ever displayed;
 * `arrivalAt` is the absolute instant the server derived from them, and is the only
 * thing anything sorts, filters or compares on. No client computes it — that is the
 * rule which stopped drop-off rides breaking every Friday, see functions/src/utils/time.ts.
 */
export interface AirportPickup {
    cityId?: string;
    locationId?: string;
    id: string;
    requesterUid: string;
    requesterName: string;
    direction: ArrivalDirection;

    /** 'YYYY-MM-DD', as read on a clock at the airport. */
    arrivalDate: string;
    /** 'HH:MM' 24-hour, as read on a clock at the airport. */
    arrivalTime: string;
    /** ISO instant, computed server-side from the two above plus the airport's zone. */
    arrivalAt: string;
    /** Three letters, uppercase. See AIRPORTS in the arrival table. */
    airportCode: string;
    airline?: string;
    flightNumber?: string;
    terminal?: string;
    /**
     * An international arrival means immigration and baggage before they appear.
     * Drives the "allow 60-90 minutes" line on the card, so a Sarthi is not stood
     * at the barrier for an hour wondering.
     */
    isInternational: boolean;

    partySize: number;
    largeBags: number;
    cabinBags: number;
    /**
     * WHERE THEY ARE GOING, AND IT MAY NOT BE KNOWN YET.
     *
     * All three are optional together. Somebody filing a month before they fly often
     * has no address to give, and requiring one meant they could not ask for a pickup
     * at all. The card says so out loud rather than rendering a blank line.
     *
     * The coordinates are present only when the address came from the autocomplete.
     * Free text with no pair is legitimate — a Sarthi can read it — but it is not
     * copied onto the traveller's profile when the trip completes, because
     * `resolveHomeCoords` needs a real location and 0,0 is its rejection value.
     */
    dropoffAddress?: string;
    dropoffLat?: number;
    dropoffLng?: number;
    /**
     * Whether they will have a working phone when they land. Most people arrive on a
     * dead SIM, which is exactly when a meeting point agreed in advance matters.
     */
    hasUsWorkingPhone: boolean;
    meetingPointNote?: string;
    /** A stop on the way — a SIM card, groceries. What new arrivals actually ask for. */
    needsStopOnTheWay?: string;
    notes?: string;

    passenger: ArrivalPassenger;

    status: ArrivalStatus;
    claimedByUid?: string | null;
    claimedByName?: string | null;
    claimedAt?: string | null;
    metAt?: string | null;
    completedAt?: string | null;
    /**
     * When the Sarthi opened the WhatsApp message to the family. Stamped on tap, so
     * the board can tell "told them" from "meant to". Without it there is no way to
     * see that the one reassurance the family was promised never went.
     */
    familyNotifiedAt?: string | null;
    noShowAt?: string | null;
    /** Why a Sarthi handed a trip back. Optional; a release with no reason is allowed. */
    releaseReason?: string | null;
    cancelledAt?: string | null;
    cancelledBy?: string | null;
    cancellationReason?: string | null;
    /**
     * WHEN SOMETHING THAT MATTERS TO THE DRIVE CHANGED, and which fields.
     *
     * Was `arrivalTimeChangedAt`, which only ever covered the flight time — so a
     * traveller who moved to a different terminal, doubled their luggage or lost their
     * working phone changed nothing the Sarthi's card would mention. The fields
     * compared are `NOTIFIABLE_FIELDS` in utils/arrival.ts, shared with the client so
     * the card names them exactly as the server decided them.
     *
     * Cleared when the Sarthi taps "I've found them": the warning has done its job,
     * and one that follows a trip to the end decays into wallpaper.
     */
    changedAt?: string | null;
    changedFields?: string[] | null;
    /**
     * Which unclaimed-alert bands have already fired. Idempotency, the same shape as
     * `arrivedAt` on a ride: time only decreases, so a band once passed can never
     * come round again and this is a sufficient record.
     */
    alertsSent?: Partial<Record<AlertBand, string>>;
    /** D7, as on AirportProfile. Nothing purges yet. */
    retainUntil: string;
    createdAt: string;
    updatedAt: string;
}
