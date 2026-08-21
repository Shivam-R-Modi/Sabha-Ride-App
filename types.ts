import type { PresenceClaim } from './src/utils/presence';
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
   * The order this person has dragged their sidebar tabs into, per role.
   *
   * A preference about SEQUENCE only — never the set of tabs to show. A role
   * whose entry is missing, stale or malformed gets the default order, and a
   * destination absent from the stored list still appears. See
   * `applyOrder` in src/utils/navOrder.ts for why that matters: the list is
   * partly decided by data written months ago, and the failure worth designing
   * against is a tab that quietly never renders.
   *
   * Bounded in firestore.rules, because this document is read on every page load
   * and by every manager listing people.
   */
  navOrder?: Partial<Record<UserRole, TabView[]>>;
  accountStatus: AccountStatus;
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
  accountStatus?: AccountStatus;
  avatarUrl?: string;
  // Properties from User that may be merged
  email?: string;
  role?: UserRole;
  registeredRole?: UserRole;
  roles?: UserRole[];
  activeRole?: UserRole;
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
    | 'home' | 'rides' | 'profile' | 'history' | 'people' | 'setup' | 'fleet' | 'notices' | 'records';

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
