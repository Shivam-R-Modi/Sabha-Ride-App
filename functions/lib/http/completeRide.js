"use strict";
// ============================================
// HTTP FUNCTION: completeRide
// Triggered when driver clicks "Complete Ride"
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
exports.completeRide = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const notifications_1 = require("../utils/notifications");
const fleet_1 = require("../utils/fleet");
const events_1 = require("../utils/events");
const settings_1 = require("../utils/settings");
const time_1 = require("../utils/time");
/**
 * HTTP Callable: Complete a ride
 * Input: { rideId: string }
 * Output: Driver's today stats
 */
exports.completeRide = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
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
        const targetDriverId = (ride === null || ride === void 0 ? void 0 : ride.driverId) || ((_a = ride === null || ride === void 0 ? void 0 : ride.driver) === null || _a === void 0 ? void 0 : _a.id);
        if (targetDriverId !== driverUid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the assigned driver can complete this ride');
        }
        // Check ride status - allow assigned, in_progress, driver_en_route, arriving
        const validStatuses = ['assigned', 'in_progress', 'driver_en_route', 'arriving'];
        if (!validStatuses.includes(ride === null || ride === void 0 ? void 0 : ride.status)) {
            throw new functions.https.HttpsError('failed-precondition', `Ride status '${ride === null || ride === void 0 ? void 0 : ride.status}' cannot be completed`);
        }
        const batch = db.batch();
        const now = new Date().toISOString();
        // Which gathering these numbers belong to.
        //
        // This was `new Date().toISOString().split('T')[0]` — the UTC calendar
        // date. A drop-off run finishing at 22:30 in Boston is already the next
        // day in UTC, so the sabha's own drop-off figures were filed under
        // tomorrow while its pickup figures sat under today, and generateEventCSV
        // (which looks up `statistics/{the sabha's date}`) found neither complete.
        // The ride knows which sabha it served; ask it.
        const eventDate = (_b = (0, events_1.eventKeyFromRide)(ride)) !== null && _b !== void 0 ? _b : (0, time_1.zonedDateKey)(new Date(), await (0, settings_1.getTimeZone)());
        // Find ALL active rides for this driver to complete all documents in multi-student grouped rides
        const activeRidesSnap = await db.collection('rides')
            .where('driverId', '==', driverUid)
            .where('status', 'in', ['assigned', 'in_progress', 'driver_en_route', 'arriving'])
            .get();
        const allStudentsMap = new Map();
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
        const newRidesCompleted = ((driver === null || driver === void 0 ? void 0 : driver.ridesCompletedToday) || 0) + 1;
        const newTotalStudents = ((driver === null || driver === void 0 ? void 0 : driver.totalStudentsToday) || 0) + (allStudents.length || ((_c = ride === null || ride === void 0 ? void 0 : ride.students) === null || _c === void 0 ? void 0 : _c.length) || 1);
        const newTotalDistance = ((driver === null || driver === void 0 ? void 0 : driver.totalDistanceToday) || 0) + ((ride === null || ride === void 0 ? void 0 : ride.estimatedDistance) || 0);
        // Released in BOTH collections. Clearing only `vehicles` left
        // `cars/{id}` saying in_use with the previous driver still on it, and
        // globalAssignDriver reads `cars` — so a completed ride left its
        // vehicle looking permanently taken to the assigner.
        const vehicleId = (0, fleet_1.resolveDriverVehicleId)(driver) || (ride === null || ride === void 0 ? void 0 : ride.carId);
        if (vehicleId) {
            (0, fleet_1.writeVehicleState)(batch, db, vehicleId, fleet_1.VEHICLE_RELEASED);
        }
        batch.update(db.collection('users').doc(driverUid), Object.assign(Object.assign({ status: 'available', activeRideId: null }, fleet_1.DRIVER_VEHICLE_CLEARED), { ridesCompletedToday: newRidesCompleted, totalStudentsToday: newTotalStudents, totalDistanceToday: newTotalDistance }));
        // Determine student status after ride
        const newStudentStatus = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'home-to-sabha' ? 'at_sabha' : 'home_safe';
        const destination = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'home-to-sabha' ? 'Sabha' : 'Home';
        // Update students status and notify
        for (const student of allStudents) {
            batch.update(db.collection('users').doc(student.id), {
                status: newStudentStatus,
                currentRideId: null
            });
            // Send notification to student
            try {
                const studentDoc = await db.collection('users').doc(student.id).get();
                const fcmToken = (_d = studentDoc.data()) === null || _d === void 0 ? void 0 : _d.fcmToken;
                if (fcmToken) {
                    await (0, notifications_1.notifyStudentRideCompleted)(fcmToken, destination);
                }
            }
            catch (notifError) {
                console.error('Error sending notification to student:', student.id, notifError);
            }
        }
        // Safe student list construction for statistics
        const rawStudents = (Array.isArray(ride === null || ride === void 0 ? void 0 : ride.students) && ride.students.length > 0)
            ? ride.students
            : (allStudents.length > 0 ? allStudents : ((ride === null || ride === void 0 ? void 0 : ride.studentId) ? [{ id: ride.studentId, name: ride.studentName || 'Student' }] : []));
        const rideStudents = rawStudents.map((s) => {
            var _a;
            return ({
                id: s.id || '',
                name: s.name || 'Student',
                driverId: driverUid,
                driverName: (ride === null || ride === void 0 ? void 0 : ride.driverName) || ((_a = ride === null || ride === void 0 ? void 0 : ride.driver) === null || _a === void 0 ? void 0 : _a.name) || 'Driver',
                carModel: (ride === null || ride === void 0 ? void 0 : ride.carModel) || '',
                carLicensePlate: (ride === null || ride === void 0 ? void 0 : ride.carLicensePlate) || ''
            });
        });
        // Update statistics for the event using set + merge to prevent nested dot notation errors
        const statsRef = db.collection('statistics').doc(eventDate);
        const statsDoc = await statsRef.get();
        const isPickup = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'home-to-sabha';
        const statsKey = isPickup ? 'pickup' : 'dropoff';
        const stats = statsDoc.exists ? (statsDoc.data() || {}) : {};
        const currentBlock = stats[statsKey] || { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] };
        const existingStudentIds = new Set((currentBlock.students || []).map((s) => s.id));
        const newStudents = rideStudents.filter(s => !existingStudentIds.has(s.id));
        const deduplicatedStudents = [...(currentBlock.students || []), ...newStudents];
        const updatedBlock = {
            totalStudents: deduplicatedStudents.length,
            completedRides: (currentBlock.completedRides || 0) + 1,
            totalDrivers: Math.max(1, (currentBlock.totalDrivers || 0) + 1),
            students: deduplicatedStudents
        };
        batch.set(statsRef, Object.assign({ eventDate, [statsKey]: updatedBlock }, (statsDoc.exists ? {} : {
            [isPickup ? 'dropoff' : 'pickup']: { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] },
            attendance: { both: 0, pickupOnly: 0, dropoffOnly: 0 }
        })), { merge: true });
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
    }
    catch (error) {
        console.error('Error completing ride:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to complete ride');
    }
});
//# sourceMappingURL=completeRide.js.map