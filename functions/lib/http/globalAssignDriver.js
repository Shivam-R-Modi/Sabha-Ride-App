"use strict";
// ============================================
// HTTP FUNCTION: globalAssignDriver  (Approach B)
// Re-clusters ALL unassigned students every time a driver
// taps "Assign Me". A Firestore-based lock prevents races.
// ============================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalAssignDriver = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const clustering_1 = require("../utils/clustering");
const routing_1 = require("../utils/routing");
const notifications_1 = require("../utils/notifications");
const settings_1 = require("../utils/settings");
const rateLimiter_1 = require("../utils/rateLimiter");
// ── constants ──────────────────────────────────────────────
const LOCK_DOC = 'system/assignmentLock';
const LOCK_TTL_MS = 10000; // 10 seconds
const GEO_FENCE_MILES = 15; // ignore students > 15 mi away
// ── helpers ────────────────────────────────────────────────
/** Haversine distance in miles */
function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
    const R = 3959;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
/** Check if a pending ride has valid GPS */
function isValidPendingRide(docData) {
    var _a, _b;
    const lat = (_a = docData.pickupLat) !== null && _a !== void 0 ? _a : 0;
    const lng = (_b = docData.pickupLng) !== null && _b !== void 0 ? _b : 0;
    if (typeof lat !== 'number' || typeof lng !== 'number')
        return false;
    if (isNaN(lat) || isNaN(lng))
        return false;
    if (lat === 0 && lng === 0)
        return false;
    if (!docData.studentId)
        return false;
    return true;
}
// ── main function ──────────────────────────────────────────
exports.globalAssignDriver = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    // Auth check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    // Rate limiting: 10 requests per minute
    await (0, rateLimiter_1.checkRateLimit)(context.auth.uid, {
        maxRequests: 10,
        windowMs: 60 * 1000, // 1 minute
        functionName: 'globalAssignDriver'
    });
    const { driverId, carId } = data;
    console.log(`[globalAssign] START driver=${driverId}, car=${carId}`);
    if (!driverId || !carId) {
        throw new functions.https.HttpsError('invalid-argument', 'driverId and carId are required');
    }
    const db = admin.firestore();
    // ── Step 1: Acquire lock ────────────────────────────────
    // Define lockRef at function scope so it's accessible in error handler
    const lockRef = db.doc(LOCK_DOC);
    try {
        const lockSnap = await lockRef.get();
        if (lockSnap.exists) {
            const lockData = lockSnap.data();
            const lockAge = Date.now() - ((_a = lockData === null || lockData === void 0 ? void 0 : lockData.timestamp) !== null && _a !== void 0 ? _a : 0);
            if (lockAge < LOCK_TTL_MS) {
                console.log(`[globalAssign] LOCKED by ${lockData === null || lockData === void 0 ? void 0 : lockData.driverId}, age=${lockAge}ms`);
                return { status: 'locked' };
            }
            console.log(`[globalAssign] Stale lock (${lockAge}ms) — overwriting`);
        }
        // Write lock
        await lockRef.set({ driverId, timestamp: Date.now() });
        console.log('[globalAssign] Lock acquired');
        // ── Step 2: Ride context ────────────────────────────
        const rideContextDoc = await db.collection('system').doc('rideContext').get();
        const SABHA_LOCATION = await (0, settings_1.getSabhaLocation)();
        if (!rideContextDoc.exists) {
            throw new functions.https.HttpsError('failed-precondition', 'Ride context not available. Please contact a manager.');
        }
        const rideContext = rideContextDoc.data();
        if (!(rideContext === null || rideContext === void 0 ? void 0 : rideContext.rideType)) {
            throw new functions.https.HttpsError('failed-precondition', 'No rides are available at this time.');
        }
        const rideType = rideContext.rideType;
        console.log(`[globalAssign] rideType=${rideType}`);
        // ── Step 3: Tapping driver + car ────────────────────
        const driverDoc = await db.collection('users').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver profile not found.');
        }
        const driverData = driverDoc.data();
        const carDoc = await db.collection('cars').doc(carId).get();
        if (!carDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Vehicle not found.');
        }
        const carData = carDoc.data();
        if (carData.status !== 'available' && carData.status !== 'in_use') {
            throw new functions.https.HttpsError('failed-precondition', `Vehicle is ${carData.status}.`);
        }
        if (carData.status === 'in_use' && carData.currentDriverId && carData.currentDriverId !== driverId) {
            throw new functions.https.HttpsError('failed-precondition', 'Vehicle is assigned to another driver.');
        }
        const availableSeats = Math.max(1, (carData.capacity || 4) - 1);
        // Normalize location: support both {lat, lng} and {latitude, longitude} key formats
        const rawDriverLoc = driverData.location || driverData.homeLocation;
        const tappingDriverLoc = rawDriverLoc ? {
            lat: typeof rawDriverLoc.lat === 'number' ? rawDriverLoc.lat : rawDriverLoc.latitude,
            lng: typeof rawDriverLoc.lng === 'number' ? rawDriverLoc.lng : rawDriverLoc.longitude,
        } : null;
        if (!tappingDriverLoc || typeof tappingDriverLoc.lat !== 'number') {
            throw new functions.https.HttpsError('failed-precondition', 'Your location is not set. Please update your profile.');
        }
        console.log(`[globalAssign] seats=${availableSeats}, driverLoc=${tappingDriverLoc.lat},${tappingDriverLoc.lng}`);
        // ── Step 4: All unassigned ride requests ─────────────
        const ridesSnap = await db.collection('rides')
            .where('status', '==', 'requested')
            .get();
        if (ridesSnap.empty) {
            return { status: 'no_students' };
        }
        const studentMap = new Map();
        for (const doc of ridesSnap.docs) {
            const d = doc.data();
            if (!isValidPendingRide(d))
                continue;
            // Deduplicate by studentId to prevent duplicate entries if a student has multiple pending requests
            if (!studentMap.has(d.studentId)) {
                studentMap.set(d.studentId, {
                    id: d.studentId,
                    rideRequestId: doc.id,
                    name: d.studentName || 'Student',
                    phone: d.studentPhone || '',
                    lat: d.pickupLat,
                    lng: d.pickupLng,
                    address: d.pickupAddress || 'Unknown'
                });
            }
        }
        const allStudentPoints = Array.from(studentMap.values());
        if (allStudentPoints.length === 0) {
            return { status: 'no_students' };
        }
        console.log(`[globalAssign] ${allStudentPoints.length} unassigned students`);
        // ── Step 5: All remaining available drivers ──────────
        const driversSnap = await db.collection('users')
            .where('activeRole', '==', 'driver')
            .where('status', '==', 'available')
            .get();
        // Build driver points (always include tapping driver)
        const driverPointsMap = new Map();
        // Add the tapping driver first
        driverPointsMap.set(driverId, {
            id: driverId,
            lat: tappingDriverLoc.lat,
            lng: tappingDriverLoc.lng
        });
        // Add other available drivers
        for (const doc of driversSnap.docs) {
            if (doc.id === driverId)
                continue; // already added
            const dd = doc.data();
            const rawLoc = dd.location || dd.homeLocation;
            // Normalize: support both {lat, lng} and {latitude, longitude}
            const locLat = rawLoc ? (typeof rawLoc.lat === 'number' ? rawLoc.lat : rawLoc.latitude) : undefined;
            const locLng = rawLoc ? (typeof rawLoc.lng === 'number' ? rawLoc.lng : rawLoc.longitude) : undefined;
            if (typeof locLat === 'number' && typeof locLng === 'number') {
                driverPointsMap.set(doc.id, {
                    id: doc.id,
                    lat: locLat,
                    lng: locLng
                });
            }
        }
        const driverPoints = Array.from(driverPointsMap.values());
        console.log(`[globalAssign] K=${driverPoints.length} drivers for clustering`);
        // ── Step 6: Run K-means ─────────────────────────────
        const clusters = (0, clustering_1.kMeansWithDriverSeeds)(allStudentPoints, driverPoints);
        // Find the tapping driver's cluster
        let myCluster = clusters.find(c => c.driverId === driverId);
        // Fallback: if tapping driver's cluster is empty (all students
        // were closer to other drivers), fall back to greedy — sort all
        // unassigned students by distance to this driver.
        if (!myCluster || myCluster.students.length === 0) {
            console.log('[globalAssign] Empty cluster for tapping driver — greedy fallback');
            myCluster = {
                driverId,
                centroid: { lat: tappingDriverLoc.lat, lng: tappingDriverLoc.lng },
                students: [...allStudentPoints] // consider all
            };
        }
        console.log(`[globalAssign] Cluster has ${myCluster.students.length} students`);
        // ── Step 7: Sort by distance + apply geo-fence ──────
        const studentPointMap = new Map(allStudentPoints.map(sp => [sp.id, sp]));
        const sortedStudents = myCluster.students
            .map(s => {
            const studentFull = studentPointMap.get(s.id);
            const dist = haversineDistanceMiles(tappingDriverLoc.lat, tappingDriverLoc.lng, s.lat, s.lng);
            return Object.assign(Object.assign({}, studentFull), { distMi: dist });
        })
            .filter(s => s.distMi <= GEO_FENCE_MILES)
            .sort((a, b) => a.distMi - b.distMi);
        // Take up to available seats
        const assignedStudents = sortedStudents.slice(0, availableSeats);
        if (assignedStudents.length === 0) {
            return { status: 'no_students' };
        }
        console.log(`[globalAssign] Assigning ${assignedStudents.length} students`);
        // ── Step 8: Build RideStudents + route ──────────────
        const rideStudents = assignedStudents.map(s => ({
            id: s.id,
            rideRequestId: s.rideRequestId,
            name: s.name,
            phone: s.phone,
            location: { lat: s.lat, lng: s.lng, address: s.address },
            status: 'assigned',
            picked: false
        }));
        const startPoint = rideType === 'home-to-sabha'
            ? (tappingDriverLoc || SABHA_LOCATION)
            : SABHA_LOCATION;
        const endPoint = rideType === 'home-to-sabha'
            ? SABHA_LOCATION
            : (driverData.homeLocation || SABHA_LOCATION);
        const route = (0, routing_1.optimizeRoute)(startPoint, rideStudents, endPoint, rideType);
        const estimatedDistance = rideStudents.length * 2; // ~2 mi per student
        const estimatedTime = rideStudents.length * 5; // ~5 min per student
        // ── Step 9: Atomic batch write ──────────────────────
        const batch = db.batch();
        const primaryRideId = assignedStudents[0].rideRequestId;
        const assignedStudentProfiles = assignedStudents.map(s => ({
            id: s.id,
            name: s.name,
            avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=FF6B35&color=fff`
        }));
        for (const s of assignedStudents) {
            const rideRef = db.collection('rides').doc(s.rideRequestId);
            const otherPeers = assignedStudentProfiles.filter(p => p.id !== s.id);
            batch.update(rideRef, {
                driverId,
                driverName: driverData.name || 'Driver',
                carId,
                carModel: carData.name || 'Vehicle',
                carColor: carData.color || 'Unknown',
                carLicensePlate: carData.licensePlate || '',
                rideType,
                status: 'assigned',
                route,
                peers: otherPeers,
                // The full roster. startRide, releaseAssignment and
                // manualAssignStudent all iterate `ride.students`; until this
                // was written they silently operated on an empty array, so
                // students were never marked in_ride, never returned to the
                // pool on release, and manual assignment threw on the spread.
                students: rideStudents,
                assignedStudentIds: assignedStudents.map(st => st.id),
                estimatedDistance,
                estimatedTime,
                assignedAt: new Date().toISOString()
            });
            // Upsert student user profile (set+merge is safe even if doc doesn't exist)
            const studentRef = db.collection('users').doc(s.id);
            batch.set(studentRef, {
                status: 'assigned',
                currentRideId: s.rideRequestId
            }, { merge: true });
        }
        // Update car
        batch.update(db.collection('cars').doc(carId), {
            status: 'in_use',
            assignedDriverId: driverId
        });
        // Upsert driver profile (set+merge is safe even if doc doesn't exist)
        batch.set(db.collection('users').doc(driverId), {
            status: 'assigned',
            activeRideId: primaryRideId,
            currentCarId: carId,
            assignedStudentIds: assignedStudents.map(s => s.id)
        }, { merge: true });
        // Delete the lock in the same batch
        batch.delete(lockRef);
        await batch.commit();
        console.log('[globalAssign] Batch committed + lock released');
        // ── Step 10: Notifications (non-blocking) ───────────
        try {
            const driverFcmToken = driverData.fcmToken;
            if (driverFcmToken) {
                await (0, notifications_1.notifyDriverStudentsAssigned)(driverFcmToken, rideStudents.length);
            }
            for (const s of assignedStudents) {
                const sDoc = await db.collection('users').doc(s.id).get();
                const sToken = (_b = sDoc.data()) === null || _b === void 0 ? void 0 : _b.fcmToken;
                if (sToken) {
                    await (0, notifications_1.notifyStudentDriverAssigned)(sToken, driverData.name || 'Driver', carData.name || 'Vehicle', carData.color || '');
                }
            }
        }
        catch (notifErr) {
            console.error('[globalAssign] Notification error (non-fatal):', notifErr);
        }
        // ── Step 11: Build response ─────────────────────────
        // Build full multi-stop Maps URL:
        // origin = driver location, waypoints = students in route order, destination = Sabha
        const pickupWaypoints = route
            .filter(wp => wp.type === 'pickup' || wp.type === 'dropoff')
            .map(wp => `${wp.lat},${wp.lng}`)
            .join('|');
        const waypointsParam = pickupWaypoints
            ? `&waypoints=${encodeURIComponent(pickupWaypoints)}`
            : '';
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1` +
            `&origin=${tappingDriverLoc.lat},${tappingDriverLoc.lng}` +
            `&destination=${SABHA_LOCATION.lat},${SABHA_LOCATION.lng}` +
            `${waypointsParam}` +
            `&travelmode=driving`;
        const remainingUnassigned = allStudentPoints.length - assignedStudents.length;
        console.log(`[globalAssign] SUCCESS: ${assignedStudents.length} assigned, ${remainingUnassigned} remaining`);
        return {
            status: 'success',
            rideId: primaryRideId,
            students: rideStudents,
            route,
            estimatedDistance,
            estimatedTime,
            googleMapsUrl,
            car: {
                model: carData.name || 'Vehicle',
                color: carData.color || 'Unknown',
                licensePlate: carData.licensePlate || '',
                capacity: carData.capacity || 4
            },
            remainingUnassigned
        };
    }
    catch (error) {
        console.error('[globalAssign] ERROR:', error);
        // Always attempt to clean up the lock (lockRef is now in scope)
        try {
            await lockRef.delete();
            console.log('[globalAssign] Lock cleaned up after error');
        }
        catch (cleanupErr) {
            console.error('[globalAssign] Failed to clean lock:', cleanupErr);
        }
        if (error instanceof functions.https.HttpsError)
            throw error;
        if ((error === null || error === void 0 ? void 0 : error.code) === 'permission-denied') {
            throw new functions.https.HttpsError('permission-denied', 'Permission denied.');
        }
        throw new functions.https.HttpsError('internal', (error === null || error === void 0 ? void 0 : error.message) || 'Unexpected error during global assignment.');
    }
    finally {
        // Additional safety: ensure lock is always cleaned up
        // This runs after catch block, providing extra guarantee
        try {
            const lockStillExists = await lockRef.get();
            if (lockStillExists.exists && ((_c = lockStillExists.data()) === null || _c === void 0 ? void 0 : _c.driverId) === driverId) {
                await lockRef.delete();
                console.log('[globalAssign] Lock cleaned up in finally block');
            }
        }
        catch (finalCleanupErr) {
            console.error('[globalAssign] Failed to clean lock in finally:', finalCleanupErr);
        }
    }
});
//# sourceMappingURL=globalAssignDriver.js.map