// ============================================
// CLOUD FUNCTIONS CLIENT
// Helper to call Firebase Cloud Functions
// ============================================

import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { app } from '@/firebase/config';

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
    } catch (error: any) {
        console.error(`Error calling ${name}:`, error);
        throw new Error(error.message || `Failed to call ${name}`);
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

export async function assignStudentsToDriver(driverId: string, carId: string): Promise<AssignStudentsResult> {
    return callFunction<AssignStudentsResult>('assignStudentsToDriver', { driverId, carId });
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

export async function completeRide(rideId: string): Promise<CompleteRideResult> {
    return callFunction<CompleteRideResult>('completeRide', { rideId });
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
}

export async function driverDoneForToday(driverId: string): Promise<DriverDoneResult> {
    return callFunction<DriverDoneResult>('driverDoneForToday', { driverId });
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

export async function studentReadyToLeave(studentId: string): Promise<ReadyToLeaveResult> {
    return callFunction<ReadyToLeaveResult>('studentReadyToLeave', { studentId });
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

export interface AddCarResult {
    success: boolean;
    carId: string;
    car: {
        id: string;
        model: string;
        color: string;
        licensePlate: string;
        capacity: number;
        status: string;
        assignedDriverId: string | null;
    };
}

export async function addCarToFleet(
    model: string,
    color: string,
    licensePlate: string,
    capacity: number
): Promise<AddCarResult> {
    return callFunction<AddCarResult>('addCarToFleet', { model, color, licensePlate, capacity });
}

export interface RemoveCarResult {
    success: boolean;
    carId: string;
    message: string;
}

export async function removeCarFromFleet(carId: string): Promise<RemoveCarResult> {
    return callFunction<RemoveCarResult>('removeCarFromFleet', { carId });
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
// SYSTEM FUNCTIONS
// ============================================

export interface RideContextResult {
    rideType: 'home-to-sabha' | 'sabha-to-home' | null;
    displayText: string;
    timeContext: string;
    lastUpdated: string;
}

export async function manuallyUpdateRideContext(): Promise<RideContextResult> {
    return callFunction<RideContextResult>('manuallyUpdateRideContext');
}

// ============================================
// CSV DOWNLOAD HELPER
// ============================================

export function downloadCSV(csvContent: string, filename: string): void {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
