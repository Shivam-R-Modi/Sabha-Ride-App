"use strict";
// ============================================
// HTTP FUNCTION: driverDoneForToday
// Triggered when driver clicks "No, I'm Done for Today"
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
exports.driverDoneForToday = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
/**
 * HTTP Callable: Driver done for today
 * Releases car and clears driver session
 * Input: { driverId: string }
 * Output: Success confirmation
 */
exports.driverDoneForToday = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { driverId } = data;
    if (!driverId) {
        throw new functions.https.HttpsError('invalid-argument', 'driverId is required');
    }
    const db = admin.firestore();
    try {
        // Get driver details
        const driverDoc = await db.collection('drivers').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }
        const driver = driverDoc.data();
        // Verify the caller is the driver
        if ((driver === null || driver === void 0 ? void 0 : driver.userId) !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the driver can mark themselves done');
        }
        // Check if driver has an active ride
        if (driver === null || driver === void 0 ? void 0 : driver.activeRideId) {
            throw new functions.https.HttpsError('failed-precondition', 'Cannot mark done while in an active ride');
        }
        const carId = driver === null || driver === void 0 ? void 0 : driver.currentCarId;
        const batch = db.batch();
        // Release car if assigned
        if (carId) {
            batch.update(db.collection('cars').doc(carId), {
                status: 'available',
                assignedDriverId: null
            });
        }
        // Update driver status
        batch.update(db.collection('drivers').doc(driverId), {
            status: 'offline',
            currentCarId: null,
            activeRideId: null
        });
        await batch.commit();
        return {
            success: true,
            driverId,
            carReleased: !!carId,
            message: 'You are now offline. Thank you for your service!'
        };
    }
    catch (error) {
        console.error('Error marking driver done:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to mark driver done');
    }
});
//# sourceMappingURL=driverDoneForToday.js.map