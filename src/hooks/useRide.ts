/**
 * Ride Hook
 * Provides easy access to ride state and methods for all user roles
 */

import { useEffect, useCallback } from 'react';
import { useRideStore } from '../store/rideStore';
import type {
    StudentStatus,
    DriverStatus,
    AssignmentResult,
    Car,
    Waypoint
} from '../types';

// Student Hook
export function useStudent(studentId: string | null) {
    const {
        rideContext,
        studentData,
        studentRide,
        isLoading,
        error,
        initializeStudentListeners,
        requestPickup,
        readyToLeave,
        updateStudentLocation,
        clearError,
    } = useRideStore();

    useEffect(() => {
        if (!studentId) return;
        const cleanup = initializeStudentListeners(studentId);
        return cleanup;
    }, [studentId, initializeStudentListeners]);

    return {
        // State
        rideContext,
        studentData,
        studentRide,
        isLoading,
        error,

        // Actions
        requestPickup,
        readyToLeave,
        updateStudentLocation,
        clearError,
    };
}

// Driver Hook
export function useDriver(driverId: string | null) {
    const {
        rideContext,
        driverData,
        driverRide,
        availableCars,
        isLoading,
        error,
        initializeDriverListeners,
        selectCar,
        releaseCar,
        assignMe,
        acceptRide,
        completeRide,
        doneForToday,
        updateDriverLocation,
        markWaypointVisited,
        clearError,
    } = useRideStore();

    useEffect(() => {
        if (!driverId) return;
        const cleanup = initializeDriverListeners(driverId);
        return cleanup;
    }, [driverId, initializeDriverListeners]);

    // Check if driver can accept assignments
    const canAcceptAssignments = useCallback(() => {
        return driverData?.status === 'ready_for_assignment' && driverData?.currentCarId;
    }, [driverData]);

    // Check if driver has active ride
    const hasActiveRide = useCallback(() => {
        return driverData?.status === 'active_ride' && driverRide;
    }, [driverData, driverRide]);

    return {
        // State
        rideContext,
        driverData,
        driverRide,
        availableCars,
        isLoading,
        error,

        // Computed
        canAcceptAssignments,
        hasActiveRide,

        // Actions
        selectCar,
        releaseCar,
        assignMe,
        acceptRide,
        completeRide,
        doneForToday,
        updateDriverLocation,
        markWaypointVisited,
        clearError,
    };
}

// Manager Hook
export function useManager() {
    const {
        rideContext,
        allRides,
        allStudents,
        allDrivers,
        statistics,
        isLoading,
        error,
        initializeManagerListeners,
        manualAssignStudent,
        addCar,
        removeCar,
        approveUser,
        rejectUser,
        exportStatistics,
        clearError,
    } = useRideStore();

    useEffect(() => {
        const cleanup = initializeManagerListeners();
        return cleanup;
    }, [initializeManagerListeners]);

    // Get unassigned students
    const unassignedStudents = allStudents.filter(
        s => s.status === 'waiting_for_pickup' || s.status === 'waiting_for_dropoff'
    );

    // Get active rides
    const activeRides = allRides.filter(
        r => r.status === 'assigned' || r.status === 'in_progress'
    );

    // Get available drivers
    const availableDrivers = allDrivers.filter(
        d => d.status === 'ready_for_assignment' && d.currentCarId
    );

    return {
        // State
        rideContext,
        allRides,
        allStudents,
        allDrivers,
        statistics,
        isLoading,
        error,

        // Computed
        unassignedStudents,
        activeRides,
        availableDrivers,

        // Actions
        manualAssignStudent,
        addCar,
        removeCar,
        approveUser,
        rejectUser,
        exportStatistics,
        clearError,
    };
}

// Combined Hook for Role-based Access
export function useRide(userId: string | null, activeRole: string | null) {
    const student = useStudent(activeRole === 'student' ? userId : null);
    const driver = useDriver(activeRole === 'driver' ? userId : null);
    const manager = useManager();

    return {
        student,
        driver,
        manager,
    };
}
