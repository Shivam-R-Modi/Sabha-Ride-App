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
        if (ride?.driverId !== context.auth.uid) {
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
        const driverDoc = await db.collection('users').doc(ride?.driverId).get();
        const driver = driverDoc.data();
        const newRidesCompleted = (driver?.ridesCompletedToday || 0) + 1;
        const newTotalStudents = (driver?.totalStudentsToday || 0) + (ride?.students?.length || 0);
        const newTotalDistance = (driver?.totalDistanceToday || 0) + (ride?.estimatedDistance || 0);

        batch.update(db.collection('users').doc(ride?.driverId), {
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

        // Build safe student entries for statistics (no undefined values allowed in Firestore)
        const rideStudents: Array<Record<string, any>> = (ride?.students || []).map((s: any) => ({
            id: s.id || '',
            name: s.name || '',
            driverId: ride?.driverId || '',
            driverName: ride?.driverName || '',
            carModel: ride?.carModel || '',
            carLicensePlate: ride?.carLicensePlate || ''
        }));

        const emptyStatsBlock = { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] as any[] };

        // Update statistics for the event
        const statsRef = db.collection('statistics').doc(eventDate);
        const statsDoc = await statsRef.get();
        const isPickup = ride?.rideType === 'home-to-sabha';

        if (statsDoc.exists) {
            // Update existing stats
            const stats = statsDoc.data() || {};
            const statsKey = isPickup ? 'pickup' : 'dropoff';
            const current = stats[statsKey] || { totalStudents: 0, completedRides: 0, students: [] };

            batch.update(statsRef, {
                [`${statsKey}.totalStudents`]: (current.totalStudents || 0) + rideStudents.length,
                [`${statsKey}.completedRides`]: (current.completedRides || 0) + 1,
                [`${statsKey}.students`]: [...(current.students || []), ...rideStudents]
            });
        } else {
            // Create new stats document
            const activeBlock = {
                totalStudents: rideStudents.length,
                completedRides: 1,
                totalDrivers: 1,
                students: rideStudents
            };

            batch.set(statsRef, {
                eventDate,
                pickup: isPickup ? activeBlock : { ...emptyStatsBlock },
                dropoff: isPickup ? { ...emptyStatsBlock } : activeBlock,
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
