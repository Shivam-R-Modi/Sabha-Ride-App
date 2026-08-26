import type { PresenceClaim } from './src/utils/presence';
import type {
    ArrivalDirection, ArrivalStatus, WhatsappOn, AlertBand,
} from './src/utils/arrival';
// ============================================
// SABHA RIDE SEVA - COMPLETE TYPE DEFINITIONS
// ============================================

// --- User Roles & Authentication ---

export type UserRole = 'student' | 'driver' | 'manager';

export type AccountStatus = 'pending' | 'approved' | 'rejected';

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
  /**
   * One entry per device that has push turned on, keyed by the FCM token.
   *
   * A MAP, not the single string this used to be. A single string meant last
   * device wins: turn notifications on with a phone, later open the app on a
   * laptop, and the phone silently stopped receiving with nothing said. A map
   * rather than an array because pruning one dead token is a single field
   * delete instead of a read-modify-write race between two concurrent sends.
   */
  fcmTokens?: Record<string, { label?: string; updatedAt?: string }>;
  /** @deprecated The pre-map shape. Still READ so older documents keep working; nothing writes it. */
  fcmToken?: string;
  /**
   * Marks a manager as running Airport Seva: they get the unclaimed-arrival alerts,
   * the oversight panel, and the coordinator-only actions.
   *
   * What it does NOT do is hide the arrivals board from a manager who lacks it, and
   * no rule could — the hierarchy expands manager downward to driver, so every
   * approved manager is a granted Sarthi and the board is readable by every Sarthi by
   * design. The flag is a workload switch, not a wall. See isAirportCoordinator() in
   * firestore.rules.
   *
   * Granted BY SOMEBODY ELSE. `selfGrantsAirportCoordinator` in firestore.rules
   * refuses turning it on for yourself, and allows turning it off — you may always
   * give up a privilege and never hand yourself one.
   */
  airportCoordinator?: boolean;
  /**
   * They have not landed in the USA yet.
   *
   * ABSENT MEANS ALREADY HERE, and that default is the whole migration: every account
   * that existed before this field keeps exactly the app it had. Same arrangement as
   * `seatsRequested` and `rideType` — and like those, read it through
   * `arrivingMember()` in src/roles.ts rather than `?? false` at a call site.
   *
   * It decides ONE thing: which service the shell shows you. `true` gives you Airport
   * Seva and nothing else — one screen, your own pickup. `false` gives you Sabha Seva.
   *
   * DELIBERATELY NOT IN `touchesPrivilegeFields()`, unlike `airportCoordinator` beside
   * it. It grants nothing — both services are already reachable by any approved
   * account, the arrivals board stays gated on the driver role and `airportProfiles` on
   * the coordinator flag, and neither reads this. Locking it down would mean a newcomer
   * needs a manager awake before they can become a local, which is the bottleneck the
   * whole design exists to avoid. Compare `activeRole`, which IS in that list and is
   * therefore frozen at signup; this one has to survive a new device, so it lives on
   * the document.
   *
   * Set at signup, and cleared two ways: the server clears it when their pickup
   * completes, and they can clear it themselves with "I'm in the USA now" — so a Sarthi
   * forgetting the last tap strands nobody.
   */
  isArriving?: boolean;
  accountStatus: AccountStatus;
  /**
   * A Bhulku's standing request to become a Sarthi, and its outcome.
   *
   * On this document rather than in a collection of its own because a rider may
   * write their own non-privilege fields, so it needs no new rules block and no
   * index — and the manager's queue already has the name and phone beside it.
   *
   * `pending` is the only status a rider may write; firestore.rules pins the
   * shape. A `rejected` one is left here on purpose so the person can see they
   * were turned down instead of watching the request silently vanish and asking
   * again. Cleared to `null` on withdrawal, dismissal, or when it is granted —
   * once the role has changed, the role IS the answer.
   */
  roleUpgrade?: {
    status: 'pending' | 'rejected';
    requestedAt: string;
    decidedAt?: string;
    decidedBy?: string;
    decidedByName?: string;
  } | null;
  // Optional properties for when User is merged with Driver data
  address?: string;
  role?: UserRole;
  registeredRole?: UserRole;
  status?: DriverStatus;
  currentVehicleId?: string;
  currentVehicleName?: string;
  currentVehiclePlate?: string;
}

// --- Location Types ---

export interface GeoLocation {
  lat: number;
  lng: number;
  address?: string;
}

// --- Student Types ---

export type StudentStatus =
  | 'waiting_for_pickup'
  | 'waiting_for_dropoff'
  | 'assigned'
  | 'in_ride'
  | 'at_sabha'
  | 'home_safe'
  | 'missed_pickup'
  // Their request reached the end of the ride window without a driver. Neither
  // 'home_safe' (a lie) nor 'waiting_for_dropoff' (also a lie, and it leaves the
  // manager's board showing riders who went home hours ago).
  | 'missed_ride';

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

// --- Driver Types ---

export type DriverStatus =
  | 'offline'
  | 'available'
  | 'ready_for_assignment'
  | 'assigned'
  | 'active_ride';

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
  // Additional properties used in fleet management
  currentVehicleId?: string;
  currentVehicleName?: string;
  currentVehiclePlate?: string;
  carModel?: string;
  carColor?: string;
  plateNumber?: string;
  capacity?: number;
  /**
   * Marks a manager as running Airport Seva: they get the unclaimed-arrival alerts,
   * the oversight panel, and the coordinator-only actions.
   *
   * What it does NOT do is hide the arrivals board from a manager who lacks it, and
   * no rule could — the hierarchy expands manager downward to driver, so every
   * approved manager is a granted Sarthi and the board is readable by every Sarthi by
   * design. The flag is a workload switch, not a wall. See isAirportCoordinator() in
   * firestore.rules.
   *
   * Granted BY SOMEBODY ELSE. `selfGrantsAirportCoordinator` in firestore.rules
   * refuses turning it on for yourself, and allows turning it off — you may always
   * give up a privilege and never hand yourself one.
   */
  airportCoordinator?: boolean;
  /** Same field and the same document as on `User` above. */
  isArriving?: boolean;
  accountStatus?: AccountStatus;
  avatarUrl?: string;
  // Properties from User that may be merged
  email?: string;
  role?: UserRole;
  registeredRole?: UserRole;
  roles?: UserRole[];
  activeRole?: UserRole;
  /**
   * Same field as on `User`, and the same document — a Sarthi and a Bhulku are
   * one record. Declared here too because `useAuth().userProfile` is typed
   * `User | Driver`, so a Sarthi-shaped profile would otherwise make the field
   * unreadable on the one screen both roles share. Always null or absent for
   * somebody who already drives; the card that reads it renders nothing for them.
   */
  roleUpgrade?: User['roleUpgrade'];
  address?: string;
  createdAt?: string;
  lastActive?: string;
  /**
   * One entry per device that has push turned on, keyed by the FCM token.
   *
   * A MAP, not the single string this used to be. A single string meant last
   * device wins: turn notifications on with a phone, later open the app on a
   * laptop, and the phone silently stopped receiving with nothing said. A map
   * rather than an array because pruning one dead token is a single field
   * delete instead of a read-modify-write race between two concurrent sends.
   */
  fcmTokens?: Record<string, { label?: string; updatedAt?: string }>;
  /** @deprecated The pre-map shape. Still READ so older documents keep working; nothing writes it. */
  fcmToken?: string;
}

// --- Vehicle Types ---

export type VehicleStatus = 'available' | 'in_use' | 'maintenance';

// Vehicle type (used in fleet management)
export interface Vehicle {
  id: string;
  name: string;
  color: string;
  licensePlate: string;
  capacity: number;
  status: VehicleStatus;
  currentDriverId?: string;
  currentDriverName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Vehicle form data type
export interface VehicleFormData {
  name: string;
  color: string;
  licensePlate: string;
  capacity: number;
}

// --- Ride Types ---

export type RideType = 'home-to-sabha' | 'sabha-to-home';

export type RideStatus = 'requested' | 'assigned' | 'driver_en_route' | 'arriving' | 'in_progress' | 'completed' | 'cancelled';

export interface RideStudent {
  id: string;
  name: string;
  /** Profile picture, when the rider has one. Rendered by components/RideStatus.tsx. */
  avatarUrl?: string;
  phone?: string;
  studentPhone?: string;
  location: GeoLocation;
  picked: boolean;
  rideRequestId?: string;
  status?: string;
  /** People at this stop. Absent means one — every roster written before seats existed. */
  seats?: number;
  /** Size of the whole party when this stop is one part of a group split across cars. */
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
  /**
   * People this request is for. **Absent means one** — that default is the whole
   * migration for the seats change: every ride written before it, and every ride
   * from a client that has not updated, keeps behaving exactly as it did. Read it
   * through `seatsOf()` in src/constants/seats.ts rather than defaulting by hand.
   */
  seatsRequested?: number;
  /** Rider asked not to be split across cars. Absent means splitting is allowed. */
  allowSplit?: boolean;
  /**
   * Set on both halves when a group too large for any vehicle is split across
   * cars. Present on a ride means "this is part of a bigger party".
   */
  groupId?: string | null;
  groupSeatsTotal?: number | null;
  /** On a remainder: the assigned ride it was split out of. */
  splitFromRideId?: string;
  id: string;
  eventDate?: string;
  date?: string;
  driverId?: string;
  driverName?: string;
  carId?: string;
  carModel?: string;
  carColor?: string;
  carLicensePlate?: string;
  rideType?: RideType;
  status: RideStatus;
  students?: RideStudent[];
  route?: Waypoint[];
  estimatedDistance?: number;
  estimatedTime?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  allWaypointsVisited?: boolean;
  // Additional properties from legacy/firestore structure
  studentId?: string;
  studentName?: string;
  /**
   * The rider's phone, denormalised onto the ride so a driver or manager can call
   * without a second read. Written by hooks/useRides.ts and by
   * studentReadyToLeave, and read by ManagerDashboard's call button — it was
   * simply missing from this interface, which is why that button needed a cast.
   */
  studentPhone?: string;
  timeSlot?: string;
  pickupAddress?: string;
  driver?: Driver;
  returnDriver?: Driver;
  peers?: RideStudent[];
  etaMinutes?: number;
  isReadyToLeave?: boolean;
  dropoffRequested?: boolean;
  notes?: string;
  createdAt?: string;
}

// --- System Types ---

export interface RideContext {
  rideType: RideType | null;
  displayText: string;
  timeContext: string;
  lastUpdated: string;
}

// --- Statistics Types ---

export interface StudentAttendance {
  id: string;
  name: string;
  driverId?: string;
  driverName?: string;
  carModel?: string;
  carLicensePlate?: string;
}

export interface EventStatistics {
  eventDate: string;
  pickup: {
    totalStudents: number;
    completedRides: number;
    totalDrivers: number;
    students: StudentAttendance[];
  };
  dropoff: {
    totalStudents: number;
    completedRides: number;
    totalDrivers: number;
    students: StudentAttendance[];
  };
  attendance: {
    both: number;
    pickupOnly: number;
    dropoffOnly: number;
  };
}

// --- Assignment Types ---

export interface AssignmentResult {
  success: boolean;
  rideId?: string;
  message?: string;
  assignment?: {
    rideNumber: string;
    rideType: RideType;
    studentCount: number;
    capacity: number;
    estimatedDistance: number;
    estimatedTime: number;
    route: Waypoint[];
  };
}

// --- UI Component Types ---

/**
 * A destination in the shell's nav. Not every role uses every value —
 * `getNavItems` in components/Layout.tsx decides which apply.
 *
 * 'people' and 'setup' are the manager's. They were previously reached through
 * four unlabelled icon buttons in a toolbar, one of which used a map-pin to
 * mean "settings".
 */
/**
 * Every destination the shell can show.
 *
 * `fleet` and `records` were sections inside Setup's accordion until 2026-08-18.
 * They are top-level now: fleet because it is used most weeks, records because
 * burying a destructive tool in an accordion did not make it safer, only harder
 * to find. Setup keeps the three that genuinely configure a sabha.
 */
export type TabView =
    | 'home' | 'rides' | 'profile' | 'history' | 'people' | 'setup' | 'fleet' | 'notices' | 'records'
    // The arrivals board. AN AIRPORT TAB, and only that — for Sarthis and managers
    // alike, both of whom reach it by switching service.
    //
    // It took three passes to land there and the wrong answers are on
    // `src/constants/service.ts`, because both looked reasonable. The short version:
    // it was a sabha tab, then a sabha tab for Sarthis and an airport tab for
    // managers, and the thing that let it have ONE home was giving Sarthis a service
    // switch — `canSwitchService` now reads the driver capability, which is the same
    // capability firestore.rules gates the board on.
    //
    // Pinned against `getNavItems` by tests/quality/nav-tab-parity.test.ts.
    | 'arrivals'
    // The traveller's own pickup, and the only tab a TRAVELLER has in Airport Seva
    // besides their profile. That service is the whole app for somebody who has not
    // arrived yet, and nobody who has already landed ever sees this screen — see
    // 'arrivals' above.
    //
    // In the same union as the sabha tabs rather than a parallel one, because the nav
    // bar, `currentTab` and `setCurrentTab` are all shared. What keeps that safe is
    // that a switch of service resets `currentTab` — so a sabha `switch (currentTab)`
    // can never be handed this value, and the mobile dock always has an item that
    // matches rather than showing nothing selected.
    | 'airport-request';
    // `'airport-oversight'` was here and is gone. It was DEAD AS SHIPPED: an oversight
    // tab was planned, reassign moved onto the arrival card instead — where the trip
    // you want to move is the one you are looking at — and the union member was left
    // behind. Nothing ever set it and nothing ever rendered it, which is the
    // unreachable-state smell this codebase keeps removing.

/**
 * Which of the two services the app is showing.
 *
 * Airport Seva is not a feature inside the ride app; it is a second service behind
 * the same login. Account, identity and roles are shared, and nothing after that is.
 * `null` means nobody has chosen yet, which renders the launcher.
 */
export type Service = 'sabha' | 'airport';

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

// --- API Response Types ---

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// --- Form Types ---

export interface ProfileFormData {
  name: string;
  phone: string;
  address: string;
}

// CarFormData removed — use VehicleFormData instead

// --- Navigation Types ---

export interface NavigationState {
  currentTab: TabView;
  isSidebarCollapsed: boolean;
}

export interface StudentRequest {
  id: string;
  name: string;
  address: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
  role?: UserRole;
  registeredRole?: UserRole;
  accountStatus?: AccountStatus;
  currentVehicleId?: string;
  requestTime: string;
  requestedTimeSlot: string;
  status: 'pending' | 'grouped' | 'assigned';
  /** People this request is for. Always resolved through seatsOf, so never absent here. */
  seats?: number;
  /** Rider asked to travel in one car even if that means waiting longer. */
  keepTogether?: boolean;
  /** Set on both halves once a party too large for any car has been split. */
  groupSeatsTotal?: number;
  /** This row is the leftover of an already part-served group. */
  isRemainder?: boolean;
  /**
   * How the rider established they were at the sabha, on a return request.
   * Advisory only — nobody is blocked — so surfacing it is what makes an
   * implausible claim visible instead of silent. Never carries coordinates.
   */
  presence?: PresenceClaim;
  // pickupLat/pickupLng were here for the dashboard map. Nothing renders a
  // request's coordinates now that it is gone. The same field names stay live on
  // the ride document, which is what the driver's route is built from.
}

export interface RideGroup {
  id: string;
  driverId: string;
  driverName: string;
  driverCapacity: number;
  studentIds: string[];
  estimatedDuration: string;
  estimatedDistance: string;
  estimatedDistanceValue?: number;
  routeColor: string;
}


// --- Weekly Attendance Types ---

export interface WeeklyAttendanceRecord {
  response: 'yes' | 'no';
  respondedAt: string;
  studentName: string;
  studentPhone: string;
  studentAddress: string;
  studentId: string;
  /**
   * The gathering this response is for. Also the parent document id, but stored
   * on the record too so an exported row says which sabha it belongs to without
   * needing its path.
   */
  eventId?: string;
}

// --- Audit Logging Types ---

export interface AuditLog {
  id: string;
  timestamp: string;
  managerId: string;
  managerName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  collection: string;
  documentId: string;
  details: string;
}


/**
 * A notice-board post.
 *
 * `body` is PLAIN TEXT and is rendered as plain text with line breaks preserved.
 * It is never parsed as markdown or HTML — nothing in this app renders authored
 * content as markup, and a manager-typed flyer on every family's dashboard is
 * not the place to start.
 *
 * Both `imagePath` and `imageUrl` are stored. The URL renders it; the PATH is
 * the only thing that can delete it, and a notice that expires has to take its
 * image with it or Storage fills up.
 */
export interface Notice {
  id: string;
  /**
   * The heading on the collapsed row. OPTIONAL here and REQUIRED by the composer:
   * every notice written since 2026-08-24 has one, and the two already on the
   * board when the field landed fall back to their body's first line. See
   * `noticeHeading` in src/utils/notice.ts.
   */
  title?: string;
  body: string;
  /** Storage path, e.g. `notices/{id}/flyer.jpg`. Absent when there is no image. */
  imagePath?: string;
  /** Download URL for rendering. Absent when there is no image. */
  imageUrl?: string;
  /** ISO date (YYYY-MM-DD). After this day the nightly sweep deletes the notice. */
  showUntil?: string | null;
  /** Optional sabha this notice is about; it is deleted once that sabha passes. */
  eventId?: string | null;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
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
