"use strict";
// ============================================
// HTTP FUNCTION: releaseAssignment
// Triggered when driver clicks "Release Assignment" in AssignmentPreview
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
exports.releaseAssignment = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
/**
 * HTTP Callable: Release a ride assignment
 * Input: { rideId: string }
 * Output: Success confirmation
 */
exports.releaseAssignment = functions.https.onCall(async (data, context) => {
    var _a;
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
            throw new functions.https.HttpsError('permission-denied', 'Only the assigned driver can release this assignment');
        }
        // Check ride status - can only release if status is 'assigned'
        if ((ride === null || ride === void 0 ? void 0 : ride.status) !== 'assigned') {
            throw new functions.https.HttpsError('failed-precondition', 'Ride can only be released when in assigned status');
        }
        const batch = db.batch();
        // Determine new student status based on ride type
        const newStudentStatus = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'home-to-sabha' ? 'waiting_for_pickup' : 'waiting_for_dropoff';
        // Return all assigned students to the unassigned pool
        for (const student of (ride === null || ride === void 0 ? void 0 : ride.students) || []) {
            batch.update(db.collection('users').doc(student.id), {
                status: newStudentStatus,
                currentRideId: null
            });
        }
        // Update driver status to ready_for_assignment and clear activeRideId
        batch.update(db.collection('users').doc(ride === null || ride === void 0 ? void 0 : ride.driverId), {
            status: 'ready_for_assignment',
            activeRideId: null
        });
        // Update car status back to available
        const carId = ride === null || ride === void 0 ? void 0 : ride.carId;
        if (carId) {
            batch.update(db.collection('cars').doc(carId), {
                status: 'available',
                assignedDriverId: null
            });
        }
        // Delete the ride document
        batch.delete(db.collection('rides').doc(rideId));
        await batch.commit();
        return {
            success: true,
            rideId,
            message: 'Assignment released successfully. Students returned to unassigned pool.',
            studentsReturned: ((_a = ride === null || ride === void 0 ? void 0 : ride.students) === null || _a === void 0 ? void 0 : _a.length) || 0,
            newStudentStatus
        };
    }
    catch (error) {
        console.error('Error releasing assignment:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to release assignment');
    }
});
//# sourceMappingURL=releaseAssignment.js.map