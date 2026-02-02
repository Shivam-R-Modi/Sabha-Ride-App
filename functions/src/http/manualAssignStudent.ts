// ============================================
// HTTP FUNCTION: manualAssignStudent
// Triggered when manager manually assigns student
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Student, Driver, Car, Ride, RideStudent } from '../types';
import { optimizeRoute, calculateRouteStats } from '../utils/routing';
import { notifyStudentDriverAssigned } from '../utils/notifications';

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
        if (!user?.roles?.includes('manager')) {
            throw new functions.https.HttpsError('permission-denied', 'Only managers can manually assign students');
        }

        // Get student details
        const studentDoc = await db.collection('students').doc(studentId).get();
        if (!studentDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Student not found');
        }
        const student = { id: studentDoc.id, ...studentDoc.data() } as Student;

        // Check student is waiting
        const waitingStatuses = ['waiting_for_pickup', 'waiting_for_dropoff'];
        if (!waitingStatuses.includes(student.status)) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Student is not waiting for assignment'
            );
        }

        // Get driver details
        const driverDoc = await db.collection('drivers').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }
        const driver = { id: driverDoc.id, ...driverDoc.data() } as Driver;

        // Check driver has an active ride
        if (!driver.activeRideId) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Driver does not have an active ride'
            );
        }

        // Get the ride
        const rideDoc = await db.collection('rides').doc(driver.activeRideId).get();
        if (!rideDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Ride not found');
        }
        const ride = { id: rideDoc.id, ...rideDoc.data() } as Ride;

        // Get car details for capacity check
        const carDoc = await db.collection('cars').doc(ride.carId).get();
        if (!carDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Car not found');
        }
        const car = { id: carDoc.id, ...carDoc.data() } as Car;

        // Check capacity
        if (ride.students.length >= car.capacity) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `Car is at full capacity (${car.capacity} seats)`
            );
        }

        // Add student to ride
        const newStudent: RideStudent = {
            id: student.id,
            name: student.name,
            location: student.location,
            picked: false
        };

        const updatedStudents = [...ride.students, newStudent];

        // Recalculate route with new student
        const sabhaLocation = { lat: 28.6139, lng: 77.2090, address: 'Sabha Venue' };
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
        batch.update(db.collection('students').doc(studentId), {
            status: 'assigned',
            currentRideId: ride.id
        });

        await batch.commit();

        // Notify student
        try {
            const studentUserDoc = await db.collection('users').doc(student.userId).get();
            const fcmToken = studentUserDoc.data()?.fcmToken;
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
