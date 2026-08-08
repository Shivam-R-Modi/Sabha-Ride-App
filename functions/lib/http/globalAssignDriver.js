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
const coords_1 = require("../utils/coords");
const fleet_1 = require("../utils/fleet");
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
    var _a, _b, _c, _d;
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
    // A driver may only dispatch themselves.
    //
    // `driverId` arrives in the request body, and until now nothing compared it
    // to the caller. Any signed-in account could therefore assign students to
    // any driver, take that driver's car (`writeVehicleState` below), overwrite
    // their `status`, `activeRideId` and `currentVehicleId`, and hold the global
    // assignment lock — all under someone else's name, with the victim's own
    // dashboard showing the result.
    //
    // Strict equality, with no manager override: the one caller
    // (DriverDashboard) already passes `currentUser.uid`, so an override would be
    // untested code sitting in the middle of the dispatch path. Manager-initiated
    // assignment is manualAssignStudent, which authorises separately.
    if (driverId !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'A driver can only request an assignment for themselves.');
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
        if (!rideContextDoc.exists) {
            throw new functions.https.HttpsError('failed-precondition', 'Ride context not available. Please contact a manager.');
        }
        const rideContext = rideContextDoc.data();
        if (!(rideContext === null || rideContext === void 0 ? void 0 : rideContext.rideType)) {
            throw new functions.https.HttpsError('failed-precondition', 'No rides are available at this time.');
        }
        const rideType = rideContext.rideType;
        // The venue for THIS gathering. Taken from the same rideContext document
        // that produced the rideType above, so the two can never disagree — a
        // separate read of events/{id} would leave a window where the route's
        // venue and the window's venue came from different resolutions.
        // Falls back to settings/main, which is what ran before events had venues.
        const SABHA_LOCATION = (0, settings_1.resolveVenue)(rideContext.venue, await (0, settings_1.getSabhaLocation)());
        const eventId = (_b = rideContext.eventId) !== null && _b !== void 0 ? _b : null;
        console.log(`[globalAssign] rideType=${rideType}, venue=${SABHA_LOCATION.address}`);
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
        // The guard used to read carData.currentDriverId. Nothing writes that
        // field — every writer, client and server, sets assignedDriverId — so
        // this compared undefined against a uid and passed every single time.
        // Two drivers could hold the same car.
        const currentHolder = (0, fleet_1.resolveVehicleHolder)(carData);
        if (carData.status === 'in_use' && currentHolder && currentHolder !== driverId) {
            throw new functions.https.HttpsError('failed-precondition', 'Vehicle is assigned to another driver.');
        }
        const availableSeats = Math.max(1, (carData.capacity || 4) - 1);
        // resolveHomeCoords tolerates every shape the codebase writes
        // ({lat,lng} and {latitude,longitude}, under `location` or
        // `homeLocation`) and rejects the 0,0 placeholder that means "address
        // never geocoded". Reading it by hand here — and raw at the endPoint
        // below — was how a driver with only {latitude,longitude} ended up with
        // an undefined `.lat` poisoning the route and every URL built from it.
        const tappingDriverLoc = (0, coords_1.resolveHomeCoords)(driverData);
        if (!tappingDriverLoc) {
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
        //
        // This queried `activeRole == 'driver'`, which matched NOBODY. activeRole
        // is listed in touchesPrivilegeFields() in firestore.rules, so a user
        // cannot write it: the RoleSwitcher only changes React state and the
        // stored value stays frozen at whatever signup wrote. Measured against
        // production, this query returned zero rows every time, so every dispatch
        // ran K=1 and the tapping driver was handed every rider in range instead
        // of the nearest share of them. The clustering below was seeded with one
        // point and did nothing.
        //
        // `roles` is now the GRANTED set — a manager may act as a driver, which in
        // this congregation is how every driver is recorded — so one query serves
        // it with no special case. `accountStatus` is checked because a revoked
        // account must not be handed riders.
        const driversSnap = await db.collection('users')
            .where('roles', 'array-contains', 'driver')
            .where('accountStatus', '==', 'approved')
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
            const loc = (0, coords_1.resolveHomeCoords)(doc.data());
            if (loc) {
                driverPointsMap.set(doc.id, { id: doc.id, lat: loc.lat, lng: loc.lng });
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
            ? tappingDriverLoc
            : SABHA_LOCATION;
        const endPoint = rideType === 'home-to-sabha'
            ? SABHA_LOCATION
            : tappingDriverLoc;
        const route = (0, routing_1.optimizeRoute)(startPoint, rideStudents, endPoint, rideType);
        // Built HERE, before the batch, so it can be persisted with the ride.
        // It used to be built after the commit and returned only in the callable
        // response, so the fresh response had a working URL and the very next
        // Firestore snapshot replaced it with '' — the "Open in Google Maps"
        // button worked once and was dead from then on, silently.
        // Derived from `route`, so a drop-off run ends at the driver's home
        // rather than the venue they are already standing in.
        const googleMapsUrl = (0, routing_1.buildGoogleMapsNavigationUrl)(route);
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
                // The student's ride card reads the nested `driver` object and
                // does `if (!driver) return null` (RideStatus.tsx:35). Writing
                // only driverId meant that once a student was assigned, their
                // card rendered NOTHING — no driver name, no car, no plate.
                // driverId stays because the driver dashboard queries on it;
                // both shapes are needed until the model is unified.
                driver: {
                    id: driverId,
                    name: driverData.name || 'Driver',
                    phone: driverData.phone || '',
                    avatarUrl: driverData.avatarUrl
                        || `https://ui-avatars.com/api/?name=${encodeURIComponent(driverData.name || 'Driver')}&background=FF6B35&color=fff`,
                    carModel: carData.name || 'Vehicle',
                    carColor: carData.color || 'Unknown',
                    plateNumber: carData.licensePlate || '',
                },
                carId,
                carModel: carData.name || 'Vehicle',
                carColor: carData.color || 'Unknown',
                carLicensePlate: carData.licensePlate || '',
                rideType,
                status: 'assigned',
                route,
                googleMapsUrl,
                // Snapshot, not a live lookup. manualAssignStudent rebuilds the
                // route for ALL passengers when one is added; if it resolved the
                // venue live it could silently re-point everyone already on board
                // at a different venue. Also lets completeRide and
                // releaseAssignment stay consistent for free.
                venue: SABHA_LOCATION,
                eventId,
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
        // Mark the car taken in BOTH collections. Writing only `cars` left
        // `vehicles` saying 'available', and useAvailableVehicles queries
        // `vehicles` — so the car a driver had just been assigned stayed in
        // every other driver's picker.
        (0, fleet_1.writeVehicleState)(batch, db, carId, {
            status: 'in_use',
            assignedDriverId: driverId,
            assignedDriverName: driverData.name || 'Driver',
        });
        // Upsert driver profile (set+merge is safe even if doc doesn't exist)
        batch.set(db.collection('users').doc(driverId), {
            status: 'assigned',
            activeRideId: primaryRideId,
            // currentVehicleId is canonical — it is what the client writes and
            // what the dashboard gates "Assign Me" on. This wrote only
            // currentCarId, so the two names described the same car and then
            // drifted apart on release. The legacy name is nulled here so it
            // can never be the stale one a later release path falls back to.
            currentVehicleId: carId,
            currentCarId: null,
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
                const sToken = (_c = sDoc.data()) === null || _c === void 0 ? void 0 : _c.fcmToken;
                if (sToken) {
                    await (0, notifications_1.notifyStudentDriverAssigned)(sToken, driverData.name || 'Driver', carData.name || 'Vehicle', carData.color || '');
                }
            }
        }
        catch (notifErr) {
            console.error('[globalAssign] Notification error (non-fatal):', notifErr);
        }
        // ── Step 11: Build response ─────────────────────────
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
            if (lockStillExists.exists && ((_d = lockStillExists.data()) === null || _d === void 0 ? void 0 : _d.driverId) === driverId) {
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