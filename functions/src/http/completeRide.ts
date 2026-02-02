// ============================================
// HTTP FUNCTION: completeRide
// Triggered when driver clicks "Complete Ride"
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { notifyStudentRideCompleted } from '../utils/notifications';

/**
 * HTTP Callable: Complete a ride
 * Input: { rideId: string }
 * Output: Driver's today stats
 */
export const completeRide = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { rideId } = data;

    if (!rideId) {
        throw new functions.https.HttpsError('invalid-argument', 'rideId is required');
    }

    const db = admin.firestore();

    try {
        // Get ride details
        const rideDoc = await db.collection('rides').doc(rideId).get();
        if (!rideDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Ride not found');
        }

        const ride = rideDoc.data();

        // Verify the caller is the driver assigned to this ride
        const driverDoc = await db.collection('drivers').doc(ride?.driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }

        const driver = driverDoc.data();
        if (driver?.userId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the assigned driver can complete this ride');
        }

        // Check ride status
        if (ride?.status !== 'in_progress') {
            throw new functions.https.HttpsError('failed-precondition', 'Ride is not in progress');
        }

        const batch = db.batch();
        const now = new Date().toISOString();
        const eventDate = new Date().toISOString().split('T')[0];

        // Update ride status
        batch.update(db.collection('rides').doc(rideId), {
            status: 'completed',
            completedAt: now
        });

        // Update driver stats
        const newRidesCompleted = (driver?.ridesCompletedToday || 0) + 1;
        const newTotalStudents = (driver?.totalStudentsToday || 0) + (ride?.students?.length || 0);
        const newTotalDistance = (driver?.totalDistanceToday || 0) + (ride?.estimatedDistance || 0);

        batch.update(db.collection('drivers').doc(ride?.driverId), {
            status: 'ready_for_assignment',
            activeRideId: null,
            ridesCompletedToday: newRidesCompleted,
            totalStudentsToday: newTotalStudents,
            totalDistanceToday: newTotalDistance
        });

        // Determine student status after ride
        const newStudentStatus = ride?.rideType === 'home-to-sabha' ? 'at_sabha' : 'home_safe';
        const destination = ride?.rideType === 'home-to-sabha' ? 'Sabha' : 'Home';

        // Update students status and notify
        for (const student of ride?.students || []) {
            batch.update(db.collection('students').doc(student.id), {
                status: newStudentStatus,
                currentRideId: null
            });

            // Send notification to student
            try {
                const studentUserDoc = await db.collection('students').doc(student.id).get();
                const userId = studentUserDoc.data()?.userId;
                if (userId) {
                    const userDoc = await db.collection('users').doc(userId).get();
                    const fcmToken = userDoc.data()?.fcmToken;
                    if (fcmToken) {
                        await notifyStudentRideCompleted(fcmToken, destination);
                    }
                }
            } catch (notifError) {
                console.error('Error sending notification to student:', student.id, notifError);
            }
        }

        // Update statistics for the event
        const statsRef = db.collection('statistics').doc(eventDate);
        const statsDoc = await statsRef.get();

        if (statsDoc.exists) {
            // Update existing stats
            const stats = statsDoc.data();
            const rideType = ride?.rideType;

            if (rideType === 'home-to-sabha') {
                const currentPickup = stats?.pickup || { totalStudents: 0, completedRides: 0, students: [] };
                batch.update(statsRef, {
                    'pickup.totalStudents': currentPickup.totalStudents + (ride?.students?.length || 0),
                    'pickup.completedRides': currentPickup.completedRides + 1,
                    'pickup.students': [
                        ...currentPickup.students,
                        ...(ride?.students?.map((s: any) => ({
                            id: s.id,
                            name: s.name,
                            driverId: ride?.driverId,
                            driverName: ride?.driverName,
                            carModel: ride?.carModel,
                            carLicensePlate: ride?.carLicensePlate
                        })) || [])
                    ]
                });
            } else {
                const currentDropoff = stats?.dropoff || { totalStudents: 0, completedRides: 0, students: [] };
                batch.update(statsRef, {
                    'dropoff.totalStudents': currentDropoff.totalStudents + (ride?.students?.length || 0),
                    'dropoff.completedRides': currentDropoff.completedRides + 1,
                    'dropoff.students': [
                        ...currentDropoff.students,
                        ...(ride?.students?.map((s: any) => ({
                            id: s.id,
                            name: s.name,
                            driverId: ride?.driverId,
                            driverName: ride?.driverName,
                            carModel: ride?.carModel,
                            carLicensePlate: ride?.carLicensePlate
                        })) || [])
                    ]
                });
            }
        } else {
            // Create new stats document
            const pickupStats = ride?.rideType === 'home-to-sabha' ? {
                totalStudents: ride?.students?.length || 0,
                completedRides: 1,
                totalDrivers: 1,
                students: ride?.students?.map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    driverId: ride?.driverId,
                    driverName: ride?.driverName,
                    carModel: ride?.carModel,
                    carLicensePlate: ride?.carLicensePlate
                }))
            } : { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] };

            const dropoffStats = ride?.rideType === 'sabha-to-home' ? {
                totalStudents: ride?.students?.length || 0,
                completedRides: 1,
                totalDrivers: 1,
                students: ride?.students?.map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    driverId: ride?.driverId,
                    driverName: ride?.driverName,
                    carModel: ride?.carModel,
                    carLicensePlate: ride?.carLicensePlate
                }))
            } : { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] };

            batch.set(statsRef, {
                eventDate,
                pickup: pickupStats,
                dropoff: dropoffStats,
                attendance: {
                    both: 0,
                    pickupOnly: 0,
                    dropoffOnly: 0
                }
            });
        }

        await batch.commit();

        return {
            success: true,
            rideId,
            completedAt: now,
            driverStats: {
                ridesCompletedToday: newRidesCompleted,
                totalStudentsToday: newTotalStudents,
                totalDistanceToday: Math.round(newTotalDistance * 100) / 100
            }
        };

    } catch (error) {
        console.error('Error completing ride:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to complete ride');
    }
});
