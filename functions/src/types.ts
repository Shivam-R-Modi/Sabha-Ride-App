// ============================================
// SABHA RIDE SEVA - CLOUD FUNCTIONS TYPES
// ============================================

export type UserRole = 'student' | 'driver' | 'manager';
export type AccountStatus = 'pending' | 'approved' | 'rejected';
export type RideType = 'home-to-sabha' | 'sabha-to-home';
export type RideStatus = 'assigned' | 'in_progress' | 'completed' | 'cancelled';
export type CarStatus = 'available' | 'in_use' | 'maintenance';

export type StudentStatus =
    | 'waiting_for_pickup'
    | 'waiting_for_dropoff'
    | 'assigned'
    | 'in_ride'
    | 'at_sabha'
    | 'home_safe'
    | 'missed_pickup';

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

export interface Car {
    id: string;
    model: string;
    color: string;
    licensePlate: string;
    capacity: number;
    status: CarStatus;
    assignedDriverId: string | null;
}

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
