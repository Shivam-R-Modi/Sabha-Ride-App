"use strict";
// ============================================
// HTTP FUNCTIONS: Fleet Management
// addCarToFleet and removeCarFromFleet
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
exports.removeCarFromFleet = exports.addCarToFleet = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
/**
 * HTTP Callable: Add a new car to the fleet
 * Input: { model: string, color: string, licensePlate: string, capacity: number }
 * Output: { carId: string }
 */
exports.addCarToFleet = functions.https.onCall(async (data, context) => {
    var _a;
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { model, color, licensePlate, capacity } = data;
    // Validate inputs
    if (!model || !color || !licensePlate || !capacity) {
        throw new functions.https.HttpsError('invalid-argument', 'All fields are required');
    }
    if (capacity < 2 || capacity > 10) {
        throw new functions.https.HttpsError('invalid-argument', 'Capacity must be between 2 and 10');
    }
    const db = admin.firestore();
    try {
        // Verify the caller is a manager
        const userDoc = await db.collection('users').doc(context.auth.uid).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }
        const user = userDoc.data();
        if (!((_a = user === null || user === void 0 ? void 0 : user.roles) === null || _a === void 0 ? void 0 : _a.includes('manager'))) {
            throw new functions.https.HttpsError('permission-denied', 'Only managers can add cars');
        }
        // Check if license plate already exists
        const existingCar = await db.collection('cars')
            .where('licensePlate', '==', licensePlate)
            .get();
        if (!existingCar.empty) {
            throw new functions.https.HttpsError('already-exists', 'A car with this license plate already exists');
        }
        // Create new car document
        const carRef = db.collection('cars').doc();
        const car = {
            model,
            color,
            licensePlate,
            capacity,
            status: 'available',
            assignedDriverId: null
        };
        await carRef.set(car);
        return {
            success: true,
            carId: carRef.id,
            car: Object.assign({ id: carRef.id }, car)
        };
    }
    catch (error) {
        console.error('Error adding car:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to add car');
    }
});
/**
 * HTTP Callable: Remove a car from the fleet
 * Input: { carId: string }
 * Output: Success confirmation
 */
exports.removeCarFromFleet = functions.https.onCall(async (data, context) => {
    var _a;
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { carId } = data;
    if (!carId) {
        throw new functions.https.HttpsError('invalid-argument', 'carId is required');
    }
    const db = admin.firestore();
    try {
        // Verify the caller is a manager
        const userDoc = await db.collection('users').doc(context.auth.uid).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }
        const user = userDoc.data();
        if (!((_a = user === null || user === void 0 ? void 0 : user.roles) === null || _a === void 0 ? void 0 : _a.includes('manager'))) {
            throw new functions.https.HttpsError('permission-denied', 'Only managers can remove cars');
        }
        // Get car details
        const carDoc = await db.collection('cars').doc(carId).get();
        if (!carDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Car not found');
        }
        const car = carDoc.data();
        // Check if car is in use
        if ((car === null || car === void 0 ? void 0 : car.status) === 'in_use') {
            throw new functions.https.HttpsError('failed-precondition', 'Cannot remove a car that is currently in use');
        }
        // Delete the car
        await db.collection('cars').doc(carId).delete();
        return {
            success: true,
            carId,
            message: 'Car removed from fleet successfully'
        };
    }
    catch (error) {
        console.error('Error removing car:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to remove car');
    }
});
//# sourceMappingURL=fleetManagement.js.map