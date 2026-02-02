"use strict";
// ============================================
// HTTP FUNCTION: startRide
// Triggered when driver clicks "Accept & Start"
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
exports.startRide = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const notifications_1 = require("../utils/notifications");
/**
 * HTTP Callable: Start a ride
 * Input: { rideId: string }
 * Output: Success confirmation
 */
exports.startRide = functions.https.onCall(async (data, context) => {
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
        const driverDoc = await db.collection('drivers').doc(ride === null || ride === void 0 ? void 0 : ride.driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }
        const driver = driverDoc.data();
        if ((driver === null || driver === void 0 ? void 0 : driver.userId) !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the assigned driver can start this ride');
        }
        // Check ride status
        if ((ride === null || ride === void 0 ? void 0 : ride.status) !== 'assigned') {
            throw new functions.https.HttpsError('failed-precondition', 'Ride is not in assigned status');
        }
        const batch = db.batch();
        const now = new Date().toISOString();
        // Update ride status
        batch.update(db.collection('rides').doc(rideId), {
            status: 'in_progress',
            startedAt: now
        });
        // Update driver status
        batch.update(db.collection('drivers').doc(ride === null || ride === void 0 ? void 0 : ride.driverId), {
            status: 'active_ride'
        });
        // Update students status
        const destination = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'home-to-sabha' ? 'Sabha' : 'Home';
        for (const student of (ride === null || ride === void 0 ? void 0 : ride.students) || []) {
            batch.update(db.collection('students').doc(student.id), {
                status: 'in_ride'
            });
            // Send notification to student
            try {
                const studentUserDoc = await db.collection('students').doc(student.id).get();
                const userId = (_a = studentUserDoc.data()) === null || _a === void 0 ? void 0 : _a.userId;
                if (userId) {
                    const userDoc = await db.collection('users').doc(userId).get();
                    const fcmToken = (_b = userDoc.data()) === null || _b === void 0 ? void 0 : _b.fcmToken;
                    if (fcmToken) {
                        await (0, notifications_1.notifyStudentRideStarting)(fcmToken, destination);
                    }
                }
            }
            catch (notifError) {
                console.error('Error sending notification to student:', student.id, notifError);
            }
        }
        await batch.commit();
        return {
            success: true,
            rideId,
            startedAt: now,
            destination
        };
    }
    catch (error) {
        console.error('Error starting ride:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to start ride');
    }
});
//# sourceMappingURL=startRide.js.map