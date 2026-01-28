
export interface User {
  id: string;
  name: string;
  address: string;
  avatarUrl?: string;
  phone?: string;
  email?: string;
  role?: UserRole;
  coordinates?: { lat: number; lng: number };
  accountStatus?: 'pending' | 'approved' | 'rejected';
  currentVehicleId?: string; // Track which vehicle the user has selected
}

export interface Vehicle {
  id: string;
  name: string; // e.g., "Toyota Sienna"
  color: string;
  plateNumber: string;
  capacity: number;
  status: 'available' | 'maintenance' | 'in-use';
  currentDriverId?: string;
  currentDriverName?: string;
}

export interface Driver extends User {
  // Vehicle details are now derived from the assigned vehicle, 
  // but we keep them optional here if needed for legacy or snapshotting
  carModel?: string;
  carColor?: string;
  plateNumber?: string;
  capacity?: number;
  status: 'available' | 'assigned' | 'active' | 'completed';
}

export type RideStatus = 'requested' | 'assigned' | 'driver_en_route' | 'arriving' | 'completed' | 'cancelled';

export interface Ride {
  id: string;
  studentId?: string;
  studentName?: string; // For manager display
  date: string; // ISO String
  timeSlot: string;
  status: RideStatus;
  pickupAddress: string;
  driver?: Driver;
  peers: User[]; // Other students in the car
  etaMinutes?: number;
  isReadyToLeave: boolean; // For the return trip
  returnDriver?: Driver; // Driver assigned for the return trip
  notes?: string;
}

export type TabView = 'home' | 'rides' | 'profile' | 'history';
export type UserRole = 'student' | 'driver' | 'manager';

// --- Driver Specific Types ---

export type AssignmentType = 'pickup' | 'dropoff';
export type StopStatus = 'pending' | 'completed' | 'skipped';

export interface Passenger extends User {
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

// --- Manager Specific Types ---

export interface StudentRequest extends Omit<User, 'coordinates'> {
  requestTime: string; // ISO string for wait calculation
  requestedTimeSlot: string;
  status: 'pending' | 'grouped' | 'assigned';
  coordinates: { x: number; y: number }; // Percentage for schematic map
}

export interface RideGroup {
  id: string;
  driverId: string;
  driverName: string;
  driverCapacity: number;
  studentIds: string[];
  estimatedDuration: string;
  estimatedDistance: string;
  estimatedDistanceValue?: number; // numeric for calcs
  routeColor: string; // For map visualization
}

// --- Auth Types ---
export type AuthState = 'SPLASH' | 'LOGIN' | 'OTP' | 'ROLE_SELECT' | 'PROFILE_SETUP' | 'PENDING_APPROVAL' | 'APP';