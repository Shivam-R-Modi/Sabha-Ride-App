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
/**
 * HTTP Callable: Complete a ride
 * Input: { rideId: string }
 * Output: Driver's today stats
 */
exports.completeRide = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
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
        const driverDoc = await db.collection('drivers').doc(ride === null || ride === void 0 ? void 0 : ride.driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }
        const driver = driverDoc.data();
        if ((driver === null || driver === void 0 ? void 0 : driver.userId) !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the assigned driver can complete this ride');
        }
        // Check ride status
        if ((ride === null || ride === void 0 ? void 0 : ride.status) !== 'in_progress') {
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
        const newRidesCompleted = ((driver === null || driver === void 0 ? void 0 : driver.ridesCompletedToday) || 0) + 1;
        const newTotalStudents = ((driver === null || driver === void 0 ? void 0 : driver.totalStudentsToday) || 0) + (((_a = ride === null || ride === void 0 ? void 0 : ride.students) === null || _a === void 0 ? void 0 : _a.length) || 0);
        const newTotalDistance = ((driver === null || driver === void 0 ? void 0 : driver.totalDistanceToday) || 0) + ((ride === null || ride === void 0 ? void 0 : ride.estimatedDistance) || 0);
        batch.update(db.collection('drivers').doc(ride === null || ride === void 0 ? void 0 : ride.driverId), {
            status: 'ready_for_assignment',
            activeRideId: null,
            ridesCompletedToday: newRidesCompleted,
            totalStudentsToday: newTotalStudents,
            totalDistanceToday: newTotalDistance
        });
        // Determine student status after ride
        const newStudentStatus = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'home-to-sabha' ? 'at_sabha' : 'home_safe';
        const destination = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'home-to-sabha' ? 'Sabha' : 'Home';
        // Update students status and notify
        for (const student of (ride === null || ride === void 0 ? void 0 : ride.students) || []) {
            batch.update(db.collection('students').doc(student.id), {
                status: newStudentStatus,
                currentRideId: null
            });
            // Send notification to student
            try {
                const studentUserDoc = await db.collection('students').doc(student.id).get();
                const userId = (_b = studentUserDoc.data()) === null || _b === void 0 ? void 0 : _b.userId;
                if (userId) {
                    const userDoc = await db.collection('users').doc(userId).get();
                    const fcmToken = (_c = userDoc.data()) === null || _c === void 0 ? void 0 : _c.fcmToken;
                    if (fcmToken) {
                        await (0, notifications_1.notifyStudentRideCompleted)(fcmToken, destination);
                    }
                }
            }
            catch (notifError) {
                console.error('Error sending notification to student:', student.id, notifError);
            }
        }
        // Update statistics for the event
        const statsRef = db.collection('statistics').doc(eventDate);
        const statsDoc = await statsRef.get();
        if (statsDoc.exists) {
            // Update existing stats
            const stats = statsDoc.data();
            const rideType = ride === null || ride === void 0 ? void 0 : ride.rideType;
            if (rideType === 'home-to-sabha') {
                const currentPickup = (stats === null || stats === void 0 ? void 0 : stats.pickup) || { totalStudents: 0, completedRides: 0, students: [] };
                batch.update(statsRef, {
                    'pickup.totalStudents': currentPickup.totalStudents + (((_d = ride === null || ride === void 0 ? void 0 : ride.students) === null || _d === void 0 ? void 0 : _d.length) || 0),
                    'pickup.completedRides': currentPickup.completedRides + 1,
                    'pickup.students': [
                        ...currentPickup.students,
                        ...(((_e = ride === null || ride === void 0 ? void 0 : ride.students) === null || _e === void 0 ? void 0 : _e.map((s) => ({
                            id: s.id,
                            name: s.name,
                            driverId: ride === null || ride === void 0 ? void 0 : ride.driverId,
                            driverName: ride === null || ride === void 0 ? void 0 : ride.driverName,
                            carModel: ride === null || ride === void 0 ? void 0 : ride.carModel,
                            carLicensePlate: ride === null || ride === void 0 ? void 0 : ride.carLicensePlate
                        }))) || [])
                    ]
                });
            }
            else {
                const currentDropoff = (stats === null || stats === void 0 ? void 0 : stats.dropoff) || { totalStudents: 0, completedRides: 0, students: [] };
                batch.update(statsRef, {
                    'dropoff.totalStudents': currentDropoff.totalStudents + (((_f = ride === null || ride === void 0 ? void 0 : ride.students) === null || _f === void 0 ? void 0 : _f.length) || 0),
                    'dropoff.completedRides': currentDropoff.completedRides + 1,
                    'dropoff.students': [
                        ...currentDropoff.students,
                        ...(((_g = ride === null || ride === void 0 ? void 0 : ride.students) === null || _g === void 0 ? void 0 : _g.map((s) => ({
                            id: s.id,
                            name: s.name,
                            driverId: ride === null || ride === void 0 ? void 0 : ride.driverId,
                            driverName: ride === null || ride === void 0 ? void 0 : ride.driverName,
                            carModel: ride === null || ride === void 0 ? void 0 : ride.carModel,
                            carLicensePlate: ride === null || ride === void 0 ? void 0 : ride.carLicensePlate
                        }))) || [])
                    ]
                });
            }
        }
        else {
            // Create new stats document
            const pickupStats = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'home-to-sabha' ? {
                totalStudents: ((_h = ride === null || ride === void 0 ? void 0 : ride.students) === null || _h === void 0 ? void 0 : _h.length) || 0,
                completedRides: 1,
                totalDrivers: 1,
                students: (_j = ride === null || ride === void 0 ? void 0 : ride.students) === null || _j === void 0 ? void 0 : _j.map((s) => ({
                    id: s.id,
                    name: s.name,
                    driverId: ride === null || ride === void 0 ? void 0 : ride.driverId,
                    driverName: ride === null || ride === void 0 ? void 0 : ride.driverName,
                    carModel: ride === null || ride === void 0 ? void 0 : ride.carModel,
                    carLicensePlate: ride === null || ride === void 0 ? void 0 : ride.carLicensePlate
                }))
            } : { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] };
            const dropoffStats = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'sabha-to-home' ? {
                totalStudents: ((_k = ride === null || ride === void 0 ? void 0 : ride.students) === null || _k === void 0 ? void 0 : _k.length) || 0,
                completedRides: 1,
                totalDrivers: 1,
                students: (_l = ride === null || ride === void 0 ? void 0 : ride.students) === null || _l === void 0 ? void 0 : _l.map((s) => ({
                    id: s.id,
                    name: s.name,
                    driverId: ride === null || ride === void 0 ? void 0 : ride.driverId,
                    driverName: ride === null || ride === void 0 ? void 0 : ride.driverName,
                    carModel: ride === null || ride === void 0 ? void 0 : ride.carModel,
                    carLicensePlate: ride === null || ride === void 0 ? void 0 : ride.carLicensePlate
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