// ============================================
// HTTP FUNCTION: assignStudentsToDriver
// Triggered when driver clicks "Assign Me"
// Uses VRP Solver (Clarke-Wright Savings) for optimal assignments
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Student, Driver, Car, Ride, RideType, RideStudent } from '../types';
import { solveCVRP } from '../optimization/vrpSolver';
import { optimizeRoute } from '../utils/routing';
import { notifyStudentDriverAssigned, notifyDriverStudentsAssigned } from '../utils/notifications';

/**
 * HTTP Callable: Assign students to a driver
 * Input: { driverId: string, carId: string }
 * Output: Assignment details
 */
export const assignStudentsToDriver = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { driverId, carId } = data;

    if (!driverId || !carId) {
        throw new functions.https.HttpsError('invalid-argument', 'driverId and carId are required');
    }

    const db = admin.firestore();

    try {
        // Get current ride context
        const rideContextDoc = await db.collection('system').doc('rideContext').get();
        if (!rideContextDoc.exists) {
            throw new functions.https.HttpsError('failed-precondition', 'Ride context not available');
        }

        const rideContext = rideContextDoc.data();
        if (!rideContext?.rideType) {
            throw new functions.https.HttpsError('failed-precondition', 'No rides available at this time');
        }

        const rideType = rideContext.rideType as RideType;

        // Get driver details
        const driverDoc = await db.collection('drivers').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }
        const driver = { id: driverDoc.id, ...driverDoc.data() } as Driver;

        // Get car details
        const carDoc = await db.collection('cars').doc(carId).get();
        if (!carDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Car not found');
        }
        const car = { id: carDoc.id, ...carDoc.data() } as Car;

        // Check if car is available
        if (car.status !== 'available') {
            throw new functions.https.HttpsError('failed-precondition', 'Car is not available');
        }

        // Get waiting students based on ride type
        const waitingStatus = rideType === 'home-to-sabha' ? 'waiting_for_pickup' : 'waiting_for_dropoff';
        const studentsSnapshot = await db.collection('students')
            .where('status', '==', waitingStatus)
            .get();

        if (studentsSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', 'No students waiting for assignment');
        }

        const students = studentsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as Student[];

        // Use VRP Solver for optimal assignment
        // Create a single-driver array for this specific driver
        const singleDriver: Driver = {
            ...driver,
            currentCarId: carId
        };

        const vrpResult = solveCVRP(students, [singleDriver], rideType);

        // Get assignment for this driver
        const assignment = vrpResult.assignments.find(a => a.driverId === driverId);

        if (!assignment || assignment.students.length === 0) {
            throw new functions.https.HttpsError('not-found', 'Could not assign any students');
        }

        // Prepare ride students
        const rideStudents: RideStudent[] = assignment.students;

        // Build route from VRP assignment (already optimized)
        const sabhaLocation = { lat: 42.3396, lng: -71.0942, address: 'Sabha Venue' };

        const startPoint = rideType === 'home-to-sabha'
            ? (driver.currentLocation || rideStudents[0]?.location || sabhaLocation)
            : sabhaLocation;

        const endPoint = rideType === 'home-to-sabha'
            ? sabhaLocation
            : (driver.homeLocation || sabhaLocation);

        const route = optimizeRoute(startPoint, rideStudents, endPoint, rideType);

        // Create ride document
        const eventDate = new Date().toISOString().split('T')[0];
        const rideRef = db.collection('rides').doc();

        const ride: Omit<Ride, 'id'> = {
            eventDate,
            driverId: driver.id,
            driverName: driver.name,
            carId: car.id,
            carModel: car.model,
            carColor: car.color,
            carLicensePlate: car.licensePlate,
            rideType,
            status: 'assigned',
            students: rideStudents,
            route,
            estimatedDistance: assignment.routeDistance,
            estimatedTime: assignment.estimatedTime,
            startedAt: null,
            completedAt: null,
            allWaypointsVisited: false
        };

        // Batch write
        const batch = db.batch();

        // Create ride
        batch.set(rideRef, ride);

        // Update car status
        batch.update(db.collection('cars').doc(carId), {
            status: 'in_use',
            assignedDriverId: driverId
        });

        // Update driver
        batch.update(db.collection('drivers').doc(driverId), {
            status: 'assigned',
            activeRideId: rideRef.id,
            currentCarId: carId
        });

        // Update students
        for (const student of rideStudents) {
            batch.update(db.collection('students').doc(student.id), {
                status: 'assigned',
                currentRideId: rideRef.id
            });
        }

        await batch.commit();

        // Send notifications
        try {
            // Notify driver
            const driverUserDoc = await db.collection('users').doc(driver.userId).get();
            const driverFcmToken = driverUserDoc.data()?.fcmToken;
            if (driverFcmToken) {
                await notifyDriverStudentsAssigned(driverFcmToken, rideStudents.length);
            }

            // Notify students
            for (const student of rideStudents) {
                // Get student document to find userId
                const studentDoc = await db.collection('students').doc(student.id).get();
                const studentData = studentDoc.data();
                if (studentData?.userId) {
                    const studentUserDoc = await db.collection('users').doc(studentData.userId).get();
                    const studentFcmToken = studentUserDoc.data()?.fcmToken;
                    if (studentFcmToken) {
                        await notifyStudentDriverAssigned(
                            studentFcmToken,
                            driver.name,
                            car.model,
                            car.color
                        );
                    }
                }
            }
        } catch (notifError) {
            console.error('Error sending notifications:', notifError);
            // Don't fail the assignment if notifications fail
        }

        return {
            rideId: rideRef.id,
            students: rideStudents,
            route,
            estimatedDistance: assignment.routeDistance,
            estimatedTime: assignment.estimatedTime,
            googleMapsUrl: assignment.googleMapsUrl,
            car: {
                model: car.model,
                color: car.color,
                licensePlate: car.licensePlate,
                capacity: car.capacity
            }
        };

    } catch (error) {
        console.error('Error assigning students:', error);
        throw new functions.https.HttpsError('internal', 'Failed to assign students');
    }
});
