// ============================================
// HTTP FUNCTION: completeRide
// Triggered when driver clicks "Complete Ride"
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { notifyStudentRideCompleted } from '../utils/notifications';
import {
    writeVehicleState, resolveDriverVehicleId, VEHICLE_RELEASED, DRIVER_VEHICLE_CLEARED,
} from '../utils/fleet';

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
    const driverUid = context.auth.uid;

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
        const targetDriverId = ride?.driverId || ride?.driver?.id;
        if (targetDriverId !== driverUid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the assigned driver can complete this ride');
        }

        // Check ride status - allow assigned, in_progress, driver_en_route, arriving
        const validStatuses = ['assigned', 'in_progress', 'driver_en_route', 'arriving'];
        if (!validStatuses.includes(ride?.status)) {
            throw new functions.https.HttpsError('failed-precondition', `Ride status '${ride?.status}' cannot be completed`);
        }

        const batch = db.batch();
        const now = new Date().toISOString();
        const eventDate = new Date().toISOString().split('T')[0];

        // Find ALL active rides for this driver to complete all documents in multi-student grouped rides
        const activeRidesSnap = await db.collection('rides')
            .where('driverId', '==', driverUid)
            .where('status', 'in', ['assigned', 'in_progress', 'driver_en_route', 'arriving'])
            .get();

        const allStudentsMap = new Map<string, any>();

        for (const doc of activeRidesSnap.docs) {
            batch.update(doc.ref, {
                status: 'completed',
                completedAt: now
            });

            const data = doc.data();
            if (data.studentId) {
                allStudentsMap.set(data.studentId, {
                    id: data.studentId,
                    name: data.studentName || 'Student'
                });
            }
            if (Array.isArray(data.students)) {
                for (const s of data.students) {
                    allStudentsMap.set(s.id, {
                        id: s.id,
                        name: s.name || 'Student'
                    });
                }
            }
        }

        const allStudents = Array.from(allStudentsMap.values());

        // Update driver stats and release vehicle
        const driverDoc = await db.collection('users').doc(driverUid).get();
        const driver = driverDoc.data();
        const newRidesCompleted = (driver?.ridesCompletedToday || 0) + 1;
        const newTotalStudents = (driver?.totalStudentsToday || 0) + (allStudents.length || ride?.students?.length || 1);
        const newTotalDistance = (driver?.totalDistanceToday || 0) + (ride?.estimatedDistance || 0);

        // Released in BOTH collections. Clearing only `vehicles` left
        // `cars/{id}` saying in_use with the previous driver still on it, and
        // globalAssignDriver reads `cars` — so a completed ride left its
        // vehicle looking permanently taken to the assigner.
        const vehicleId = resolveDriverVehicleId(driver) || ride?.carId;
        if (vehicleId) {
            writeVehicleState(batch, db, vehicleId, VEHICLE_RELEASED);
        }

        batch.update(db.collection('users').doc(driverUid), {
            status: 'available',
            activeRideId: null,
            ...DRIVER_VEHICLE_CLEARED,
            ridesCompletedToday: newRidesCompleted,
            totalStudentsToday: newTotalStudents,
            totalDistanceToday: newTotalDistance
        });

        // Determine student status after ride
        const newStudentStatus = ride?.rideType === 'home-to-sabha' ? 'at_sabha' : 'home_safe';
        const destination = ride?.rideType === 'home-to-sabha' ? 'Sabha' : 'Home';

        // Update students status and notify
        for (const student of allStudents) {
            batch.update(db.collection('users').doc(student.id), {
                status: newStudentStatus,
                currentRideId: null
            });

            // Send notification to student
            try {
                const studentDoc = await db.collection('users').doc(student.id).get();
                const fcmToken = studentDoc.data()?.fcmToken;
                if (fcmToken) {
                    await notifyStudentRideCompleted(fcmToken, destination);
                }
            } catch (notifError) {
                console.error('Error sending notification to student:', student.id, notifError);
            }
        }

        // Safe student list construction for statistics
        const rawStudents = (Array.isArray(ride?.students) && ride.students.length > 0)
            ? ride.students
            : (allStudents.length > 0 ? allStudents : (ride?.studentId ? [{ id: ride.studentId, name: ride.studentName || 'Student' }] : []));

        const rideStudents: Array<Record<string, any>> = rawStudents.map((s: any) => ({
            id: s.id || '',
            name: s.name || 'Student',
            driverId: driverUid,
            driverName: ride?.driverName || ride?.driver?.name || 'Driver',
            carModel: ride?.carModel || '',
            carLicensePlate: ride?.carLicensePlate || ''
        }));

        // Update statistics for the event using set + merge to prevent nested dot notation errors
        const statsRef = db.collection('statistics').doc(eventDate);
        const statsDoc = await statsRef.get();
        const isPickup = ride?.rideType === 'home-to-sabha';
        const statsKey = isPickup ? 'pickup' : 'dropoff';

        const stats = statsDoc.exists ? (statsDoc.data() || {}) : {};
        const currentBlock = stats[statsKey] || { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] };

        const existingStudentIds = new Set((currentBlock.students || []).map((s: any) => s.id));
        const newStudents = rideStudents.filter(s => !existingStudentIds.has(s.id));
        const deduplicatedStudents = [...(currentBlock.students || []), ...newStudents];

        const updatedBlock = {
            totalStudents: deduplicatedStudents.length,
            completedRides: (currentBlock.completedRides || 0) + 1,
            totalDrivers: Math.max(1, (currentBlock.totalDrivers || 0) + 1),
            students: deduplicatedStudents
        };

        batch.set(statsRef, {
            eventDate,
            [statsKey]: updatedBlock,
            ...(statsDoc.exists ? {} : {
                [isPickup ? 'dropoff' : 'pickup']: { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] },
                attendance: { both: 0, pickupOnly: 0, dropoffOnly: 0 }
            })
        }, { merge: true });

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
