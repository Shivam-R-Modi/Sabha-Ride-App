// ============================================
// SABHA RIDE SEVA - COMPLETE TYPE DEFINITIONS
// ============================================

// --- User Roles & Authentication ---

export type UserRole = 'student' | 'driver' | 'manager';

export type AccountStatus = 'pending' | 'approved' | 'rejected';

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  roles: UserRole[];
  activeRole: UserRole;
  avatarUrl?: string;
  createdAt: string;
  lastActive?: string;
  fcmToken?: string;
  accountStatus: AccountStatus;
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
  | 'missed_pickup';

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
}

// --- Vehicle/Car Types ---

export type CarStatus = 'available' | 'in_use' | 'maintenance';

export interface Car {
  id: string;
  model: string;
  color: string;
  licensePlate: string;
  capacity: number;
  status: CarStatus;
  assignedDriverId: string | null;
}

// --- Ride Types ---

export type RideType = 'home-to-sabha' | 'sabha-to-home';

export type RideStatus = 'assigned' | 'in_progress' | 'completed' | 'cancelled';

export interface RideStudent {
  id: string;
  name: string;
  location: GeoLocation;
  picked: boolean;
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
  id: string;
  eventDate: string;
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

export type TabView = 'home' | 'rides' | 'profile' | 'history';

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

export interface CarFormData {
  model: string;
  color: string;
  licensePlate: string;
  capacity: number;
}

// --- Navigation Types ---

export interface NavigationState {
  currentTab: TabView;
  isSidebarCollapsed: boolean;
}

// --- Legacy Types (for backward compatibility) ---

export interface LegacyUser {
  id: string;
  name: string;
  address: string;
  avatarUrl?: string;
  phone?: string;
  email?: string;
  role?: UserRole;
  registeredRole?: UserRole;
  coordinates?: { lat: number; lng: number };
  accountStatus?: 'pending' | 'approved' | 'rejected';
  currentVehicleId?: string;
}

export interface LegacyVehicle {
  id: string;
  name: string;
  color: string;
  plateNumber: string;
  capacity: number;
  status: 'available' | 'maintenance' | 'in-use';
  currentDriverId?: string;
  currentDriverName?: string;
}

export type LegacyRideStatus = 'requested' | 'assigned' | 'driver_en_route' | 'arriving' | 'completed' | 'cancelled';

export interface LegacyRide {
  id: string;
  studentId?: string;
  studentName?: string;
  date: string;
  timeSlot: string;
  status: LegacyRideStatus;
  pickupAddress: string;
  driver?: LegacyDriver;
  peers: LegacyUser[];
  etaMinutes?: number;
  isReadyToLeave: boolean;
  returnDriver?: LegacyDriver;
  notes?: string;
}

export interface LegacyDriver extends LegacyUser {
  carModel?: string;
  carColor?: string;
  plateNumber?: string;
  capacity?: number;
  status: 'available' | 'assigned' | 'active' | 'completed';
}

export type AssignmentType = 'pickup' | 'dropoff';
export type StopStatus = 'pending' | 'completed' | 'skipped';

export interface Passenger extends LegacyUser {
  stopStatus: StopStatus;
  sequenceOrder: number;
  eta: string;
  notes?: string;
}

export interface DriverAssignment {
  id: string;
  type: AssignmentType;
  date: string;
  status: 'pending' | 'active' | 'completed';
  passengers: Passenger[];
  totalDistance: string;
  totalTime: string;
  venueAddress: string;
}

export interface StudentRequest extends Omit<LegacyUser, 'coordinates'> {
  requestTime: string;
  requestedTimeSlot: string;
  status: 'pending' | 'grouped' | 'assigned';
  coordinates: { x: number; y: number };
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

export type AuthState = 'SPLASH' | 'LOGIN' | 'OTP' | 'ROLE_SELECT' | 'PROFILE_SETUP' | 'PENDING_APPROVAL' | 'APP';
