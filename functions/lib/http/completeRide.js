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
    var _a, _b;
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
        if ((ride === null || ride === void 0 ? void 0 : ride.driverId) !== context.auth.uid) {
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
        const driverDoc = await db.collection('users').doc(ride === null || ride === void 0 ? void 0 : ride.driverId).get();
        const driver = driverDoc.data();
        const newRidesCompleted = ((driver === null || driver === void 0 ? void 0 : driver.ridesCompletedToday) || 0) + 1;
        const newTotalStudents = ((driver === null || driver === void 0 ? void 0 : driver.totalStudentsToday) || 0) + (((_a = ride === null || ride === void 0 ? void 0 : ride.students) === null || _a === void 0 ? void 0 : _a.length) || 0);
        const newTotalDistance = ((driver === null || driver === void 0 ? void 0 : driver.totalDistanceToday) || 0) + ((ride === null || ride === void 0 ? void 0 : ride.estimatedDistance) || 0);
        batch.update(db.collection('users').doc(ride === null || ride === void 0 ? void 0 : ride.driverId), {
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
            batch.update(db.collection('users').doc(student.id), {
                status: newStudentStatus,
                currentRideId: null
            });
            // Send notification to student
            try {
                const studentDoc = await db.collection('users').doc(student.id).get();
                const fcmToken = (_b = studentDoc.data()) === null || _b === void 0 ? void 0 : _b.fcmToken;
                if (fcmToken) {
                    await (0, notifications_1.notifyStudentRideCompleted)(fcmToken, destination);
                }
            }
            catch (notifError) {
                console.error('Error sending notification to student:', student.id, notifError);
            }
        }
        // Build safe student entries for statistics (no undefined values allowed in Firestore)
        const rideStudents = ((ride === null || ride === void 0 ? void 0 : ride.students) || []).map((s) => ({
            id: s.id || '',
            name: s.name || '',
            driverId: (ride === null || ride === void 0 ? void 0 : ride.driverId) || '',
            driverName: (ride === null || ride === void 0 ? void 0 : ride.driverName) || '',
            carModel: (ride === null || ride === void 0 ? void 0 : ride.carModel) || '',
            carLicensePlate: (ride === null || ride === void 0 ? void 0 : ride.carLicensePlate) || ''
        }));
        const emptyStatsBlock = { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] };
        // Update statistics for the event
        const statsRef = db.collection('statistics').doc(eventDate);
        const statsDoc = await statsRef.get();
        const isPickup = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'home-to-sabha';
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
        }
        else {
            // Create new stats document
            const activeBlock = {
                totalStudents: rideStudents.length,
                completedRides: 1,
                totalDrivers: 1,
                students: rideStudents
            };
            batch.set(statsRef, {
                eventDate,
                pickup: isPickup ? activeBlock : Object.assign({}, emptyStatsBlock),
                dropoff: isPickup ? Object.assign({}, emptyStatsBlock) : activeBlock,
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