// ============================================
// HTTP FUNCTION: manualAssignStudent
// Triggered when manager manually assigns student
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Student, Driver, Ride, RideStudent } from '../types';
import { optimizeRoute, calculateRouteStats } from '../utils/routing';
import { notifyStudentDriverAssigned } from '../utils/notifications';
import { getSabhaLocation } from '../utils/settings';

/**
 * HTTP Callable: Manually assign student to a driver's active ride
 * Input: { studentId: string, driverId: string }
 * Output: Updated ride details
 */
export const manualAssignStudent = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { studentId, driverId } = data;

    if (!studentId || !driverId) {
        throw new functions.https.HttpsError('invalid-argument', 'studentId and driverId are required');
    }

    const db = admin.firestore();

    try {
        // Verify the caller is a manager
        const userDoc = await db.collection('users').doc(context.auth.uid).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }

        const user = userDoc.data();
        if (user?.role !== 'manager' && user?.activeRole !== 'manager' && !user?.roles?.includes('manager')) {
            throw new functions.https.HttpsError('permission-denied', 'Only managers can manually assign students');
        }

        // Get student details
        const studentDoc = await db.collection('users').doc(studentId).get();
        if (!studentDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Student not found');
        }
        const student = { id: studentDoc.id, ...studentDoc.data() } as Student;

        // Check student is waiting
        const waitingStatuses = ['waiting_for_pickup', 'waiting_for_dropoff', 'requested', 'assigned'];
        if (!waitingStatuses.includes(student.status)) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Student is not waiting for assignment'
            );
        }

        // Get driver details
        const driverDoc = await db.collection('users').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }
        const driver = { id: driverDoc.id, ...driverDoc.data() } as Driver;

        // Get active ride for driver
        const activeRideSnap = await db.collection('rides')
            .where('driverId', '==', driverId)
            .where('status', 'in', ['assigned', 'driver_en_route', 'arriving', 'in_progress'])
            .get();

        if (activeRideSnap.empty) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Driver does not have an active ride'
            );
        }
        const rideDoc = activeRideSnap.docs[0];
        const ride = { id: rideDoc.id, ...rideDoc.data() } as Ride;

        // Get car/vehicle details for capacity check
        let capacity = (driver as any).capacity || 4;
        if (ride.carId) {
            const vehicleDoc = await db.collection('vehicles').doc(ride.carId).get();
            if (vehicleDoc.exists) {
                capacity = vehicleDoc.data()?.capacity || capacity;
            }
        }

        // Check capacity (capacity - 1 for driver seat)
        const availableSeats = Math.max(1, capacity - 1);
        const existingStudents = ride.students || [];
        if (existingStudents.length >= availableSeats) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `Vehicle is at full capacity (${availableSeats} seats available, driver takes 1)`
            );
        }

        // Add student to ride
        const newStudent: RideStudent = {
            id: student.id,
            name: student.name,
            phone: student.phone || '',
            location: student.location,
            picked: false
        };

        const updatedStudents = [...ride.students, newStudent];

        // Recalculate route with new student
        // Use dynamic Sabha location from settings (not hard-coded)
        const sabhaLocation = await getSabhaLocation();
        const startPoint = ride.rideType === 'home-to-sabha'
            ? (driver.currentLocation || sabhaLocation)
            : sabhaLocation;
        const endPoint = ride.rideType === 'home-to-sabha'
            ? sabhaLocation
            : (driver.homeLocation || sabhaLocation);

        const newRoute = optimizeRoute(startPoint, updatedStudents, endPoint, ride.rideType);
        const { distance, time } = calculateRouteStats(newRoute);

        const batch = db.batch();

        // Update ride
        batch.update(db.collection('rides').doc(ride.id), {
            students: updatedStudents,
            route: newRoute,
            estimatedDistance: distance,
            estimatedTime: time
        });

        // Update student
        batch.update(db.collection('users').doc(studentId), {
            status: 'assigned',
            currentRideId: ride.id
        });

        await batch.commit();

        // Notify student
        try {
            const fcmToken = studentDoc.data()?.fcmToken;
            if (fcmToken) {
                await notifyStudentDriverAssigned(fcmToken, driver.name, ride.carModel, ride.carColor);
            }
        } catch (notifError) {
            console.error('Error sending notification:', notifError);
        }

        return {
            success: true,
            rideId: ride.id,
            studentAdded: {
                id: student.id,
                name: student.name
            },
            updatedStats: {
                totalStudents: updatedStudents.length,
                estimatedDistance: Math.round(distance * 100) / 100,
                estimatedTime: time
            }
        };

    } catch (error) {
        console.error('Error manually assigning student:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to assign student');
    }
});
