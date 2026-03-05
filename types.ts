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
  timeSlot?: string;
  pickupAddress?: string;
  driver?: Driver;
  returnDriver?: Driver;
  peers?: any[];
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

// CarFormData removed — use VehicleFormData instead

// --- Navigation Types ---

export interface NavigationState {
  currentTab: TabView;
  isSidebarCollapsed: boolean;
}

// --- Assignment Types ---

export type AssignmentType = 'pickup' | 'dropoff';

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

export interface DriverAssignment {
  id: string;
  type: AssignmentType;
  date: string;
  status: 'pending' | 'active' | 'completed';
  passengers: Array<{
    id: string;
    name: string;
    address: string;
    phone?: string;
    stopStatus: 'pending' | 'completed' | 'skipped';
    sequenceOrder: number;
    eta: string;
    notes?: string;
  }>;
  totalDistance: string;
  totalTime: string;
  venueAddress: string;
}

// --- Weekly Attendance Types ---

export interface WeeklyAttendanceRecord {
  response: 'yes' | 'no';
  respondedAt: string;
  studentName: string;
  studentPhone: string;
  studentAddress: string;
  studentId: string;
}

