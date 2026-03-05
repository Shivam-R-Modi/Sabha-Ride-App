// ============================================
// HTTP FUNCTION: assignStudentsToDriver
// Triggered when driver clicks "Assign Me"
// Uses greedy nearest-neighbor clustering for single driver
// Improved error handling and data validation
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Driver, Vehicle, RideType, RideStudent } from '../types';
import { optimizeRoute } from '../utils/routing';
import { notifyStudentDriverAssigned, notifyDriverStudentsAssigned } from '../utils/notifications';
import { getSabhaLocation } from '../utils/settings';

/**
 * Calculate Haversine distance between two points (in miles)
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Validate that a ride has valid location data
 */
function isValidRide(ride: { lat: number; lng: number; id: string }): boolean {
    // Check that lat/lng are valid numbers and not 0,0 (null island)
    if (typeof ride.lat !== 'number' || typeof ride.lng !== 'number') return false;
    if (isNaN(ride.lat) || isNaN(ride.lng)) return false;
    if (ride.lat === 0 && ride.lng === 0) return false;
    if (!ride.id) return false;
    return true;
}

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
    console.log(`[assignStudentsToDriver] Starting assignment for driver=${driverId}, car=${carId}`);

    if (!driverId || !carId) {
        throw new functions.https.HttpsError('invalid-argument', 'driverId and carId are required');
    }

    const db = admin.firestore();

    try {
        // Step 1: Get current ride context
        console.log('[assignStudentsToDriver] Fetching ride context...');
        const rideContextDoc = await db.collection('system').doc('rideContext').get();

        // Fetch the dynamic Sabha location
        const SABHA_LOCATION = await getSabhaLocation();
        if (!rideContextDoc.exists) {
            throw new functions.https.HttpsError('failed-precondition', 'Ride context not available. Please contact a manager.');
        }

        const rideContext = rideContextDoc.data();
        if (!rideContext?.rideType) {
            throw new functions.https.HttpsError('failed-precondition', 'No rides are available at this time. Please wait for the ride window to open.');
        }

        const rideType = rideContext.rideType as RideType;
        console.log(`[assignStudentsToDriver] Ride type: ${rideType}`);

        // Step 2: Get driver details from users collection
        console.log('[assignStudentsToDriver] Fetching driver details...');
        const driverDoc = await db.collection('users').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver profile not found. Please log out and log back in.');
        }
        const driverData = driverDoc.data();
        const driver = {
            id: driverDoc.id,
            name: driverData?.name || 'Driver',
            userId: driverId,
            currentLocation: driverData?.location,
            homeLocation: driverData?.homeLocation,
        } as Driver;

        // Step 3: Get car details
        console.log('[assignStudentsToDriver] Fetching car details...');
        const carDoc = await db.collection('cars').doc(carId).get();
        if (!carDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Selected vehicle not found. Please select a different vehicle.');
        }
        const vehicle = { id: carDoc.id, ...carDoc.data() } as Vehicle;

        // Validate car availability
        if (vehicle.status !== 'available' && vehicle.status !== 'in_use') {
            throw new functions.https.HttpsError('failed-precondition', `Vehicle is currently ${vehicle.status}. Please select an available vehicle.`);
        }
        if (vehicle.status === 'in_use' && vehicle.currentDriverId && vehicle.currentDriverId !== driverId) {
            throw new functions.https.HttpsError('failed-precondition', 'This vehicle is assigned to another driver. Please select a different vehicle.');
        }

        // Calculate available seats (capacity - 1 for driver)
        const availableSeats = Math.max(1, (vehicle.capacity || 4) - 1);
        console.log(`[assignStudentsToDriver] Available seats: ${availableSeats}`);

        // Step 4: Get ALL waiting ride requests from rides collection
        console.log('[assignStudentsToDriver] Fetching pending rides...');
        const ridesSnapshot = await db.collection('rides')
            .where('status', '==', 'requested')
            .get();

        if (ridesSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', 'No students are currently waiting for a ride. Please check back later.');
        }

        console.log(`[assignStudentsToDriver] Found ${ridesSnapshot.docs.length} pending rides`);

        // Step 5: Map ride request docs and validate data
        const allPendingRides: Array<{
            id: string;
            rideRequestId: string;
            name: string;
            lat: number;
            lng: number;
            address: string;
        }> = [];

        const invalidRides: string[] = [];

        for (const doc of ridesSnapshot.docs) {
            const docData = doc.data();
            const ride = {
                id: docData.studentId || '',
                rideRequestId: doc.id,
                name: docData.studentName || 'Student',
                lat: docData.pickupLat ?? 0,
                lng: docData.pickupLng ?? 0,
                address: docData.pickupAddress || 'Unknown'
            };

            if (isValidRide(ride)) {
                allPendingRides.push(ride);
            } else {
                invalidRides.push(doc.id);
                console.warn(`[assignStudentsToDriver] Skipping invalid ride ${doc.id}: missing studentId or location`);
            }
        }

        if (allPendingRides.length === 0) {
            throw new functions.https.HttpsError('not-found', 'No students with valid pickup locations found. Students must set their pickup address first.');
        }

        console.log(`[assignStudentsToDriver] Valid rides: ${allPendingRides.length}, Invalid: ${invalidRides.length}`);

        // Step 6: Cluster students using greedy nearest-neighbor
        console.log('[assignStudentsToDriver] Starting clustering...');
        const clusteredRides: typeof allPendingRides = [];
        const remainingRides = [...allPendingRides];

        // Seed: pick the first ride as starting point
        if (remainingRides.length > 0) {
            const seed = remainingRides.shift()!;
            clusteredRides.push(seed);
        }

        // Greedily add nearest neighbor until we hit capacity
        while (clusteredRides.length < availableSeats && remainingRides.length > 0) {
            const lastAdded = clusteredRides[clusteredRides.length - 1];
            let nearestIndex = 0;
            let nearestDist = Infinity;

            for (let i = 0; i < remainingRides.length; i++) {
                const dist = haversineDistance(lastAdded.lat, lastAdded.lng, remainingRides[i].lat, remainingRides[i].lng);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestIndex = i;
                }
            }

            clusteredRides.push(remainingRides.splice(nearestIndex, 1)[0]);
        }

        console.log(`[assignStudentsToDriver] Clustered ${clusteredRides.length} students for this driver`);

        // Step 7: Convert clustered rides to RideStudent format
        const rideStudents: RideStudent[] = clusteredRides.map(r => ({
            id: r.id,
            rideRequestId: r.rideRequestId,
            name: r.name,
            location: { lat: r.lat, lng: r.lng, address: r.address },
            status: 'assigned' as const,
            picked: false
        }));

        if (rideStudents.length === 0) {
            throw new functions.https.HttpsError('not-found', 'No students available for assignment after filtering.');
        }

        // Step 8: Build optimized route
        console.log('[assignStudentsToDriver] Building optimized route...');
        const startPoint = rideType === 'home-to-sabha'
            ? (driver.currentLocation || rideStudents[0]?.location || SABHA_LOCATION)
            : SABHA_LOCATION;

        const endPoint = rideType === 'home-to-sabha'
            ? SABHA_LOCATION
            : (driver.homeLocation || SABHA_LOCATION);

        const route = optimizeRoute(startPoint, rideStudents, endPoint, rideType);

        // Calculate estimated distance and time
        const estimatedDistance = rideStudents.length * 2; // ~2 miles per student
        const estimatedTime = rideStudents.length * 5; // ~5 mins per student

        // Step 9: Batch write all updates
        console.log('[assignStudentsToDriver] Preparing batch write...');
        const batch = db.batch();
        const primaryRideId = (rideStudents[0] as any).rideRequestId;

        // Update each ride request with driver assignment
        for (const student of rideStudents) {
            const rideRequestId = (student as any).rideRequestId;
            if (!rideRequestId) {
                console.error(`[assignStudentsToDriver] Missing rideRequestId for student ${student.id}`);
                continue;
            }

            const rideRequestRef = db.collection('rides').doc(rideRequestId);
            batch.update(rideRequestRef, {
                driverId: driver.id,
                driverName: driver.name,
                carId: vehicle.id,
                carModel: vehicle.name || 'Vehicle',
                carColor: vehicle.color || 'Unknown',
                carLicensePlate: vehicle.licensePlate || '',
                rideType,
                status: 'assigned',
                route,
                estimatedDistance,
                estimatedTime,
                assignedAt: new Date().toISOString()
            });

            // Update student's user profile (only if document exists)
            const studentRef = db.collection('users').doc(student.id);
            batch.update(studentRef, {
                status: 'assigned',
                currentRideId: rideRequestId
            });
        }

        // Update car status
        batch.update(db.collection('cars').doc(carId), {
            status: 'in_use',
            assignedDriverId: driverId
        });

        // Update driver profile
        batch.update(db.collection('users').doc(driverId), {
            status: 'assigned',
            activeRideId: primaryRideId,
            currentCarId: carId,
            assignedStudentIds: rideStudents.map(s => s.id)
        });

        // Commit all writes
        console.log('[assignStudentsToDriver] Committing batch...');
        await batch.commit();
        console.log('[assignStudentsToDriver] Batch committed successfully');

        // Step 10: Send notifications (don't fail if notifications fail)
        try {
            const driverFcmToken = driverData?.fcmToken;
            if (driverFcmToken) {
                await notifyDriverStudentsAssigned(driverFcmToken, rideStudents.length);
            }

            for (const student of rideStudents) {
                const studentDoc = await db.collection('users').doc(student.id).get();
                const studentFcmToken = studentDoc.data()?.fcmToken;
                if (studentFcmToken) {
                    await notifyStudentDriverAssigned(
                        studentFcmToken,
                        driver.name,
                        vehicle.name || 'Vehicle',
                        vehicle.color || ''
                    );
                }
            }
        } catch (notifError) {
            console.error('[assignStudentsToDriver] Error sending notifications:', notifError);
            // Don't throw - notifications are not critical
        }

        // Build Google Maps URL
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${SABHA_LOCATION.lat},${SABHA_LOCATION.lng}`;

        console.log(`[assignStudentsToDriver] SUCCESS: Assigned ${rideStudents.length} students to driver ${driver.name}`);

        return {
            rideId: primaryRideId,
            students: rideStudents,
            route,
            estimatedDistance,
            estimatedTime,
            googleMapsUrl,
            car: {
                model: vehicle.name || 'Vehicle',
                color: vehicle.color || 'Unknown',
                licensePlate: vehicle.licensePlate || '',
                capacity: vehicle.capacity || 4
            }
        };

    } catch (error: any) {
        console.error('[assignStudentsToDriver] ERROR:', error);
        console.error('[assignStudentsToDriver] Error code:', error?.code);
        console.error('[assignStudentsToDriver] Error message:', error?.message);
        console.error('[assignStudentsToDriver] Error stack:', error?.stack);

        // If it's already an HttpsError, re-throw it to preserve the message
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }

        // For Firestore errors, provide more specific messages
        if (error?.code === 'permission-denied') {
            throw new functions.https.HttpsError('permission-denied', 'You do not have permission to perform this action.');
        }
        if (error?.code === 'not-found' || error?.message?.includes('NOT_FOUND')) {
            throw new functions.https.HttpsError('not-found', 'A required document was not found. Please refresh and try again.');
        }

        // Generic error with original message
        throw new functions.https.HttpsError(
            'internal',
            error?.message || 'An unexpected error occurred while assigning students. Please try again.'
        );
    }
});
