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
const fleet_1 = require("../utils/fleet");
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
        const driverDoc = await db.collection('users').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }
        const driver = driverDoc.data();
        // Verify the caller is the driver
        if (driverId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the driver can mark themselves done');
        }
        // Check if driver has an active ride
        if (driver === null || driver === void 0 ? void 0 : driver.activeRideId) {
            throw new functions.https.HttpsError('failed-precondition', 'Cannot mark done while in an active ride');
        }
        // …and check the RIDES, not just the pointer.
        //
        // `activeRideId` names one ride. A driver assigned a carload holds several
        // ride documents — one per rider — and on a split it is more than one per
        // family. It is also only a pointer: `returnStudentToPool` cleared the
        // ride's driverId and left it dangling, so it has been both wrong and
        // stale in production on the same day.
        //
        // "Done for today" means everyone is home and so am I. Letting it through
        // while riders are still assigned would release the car and set the driver
        // offline with people still expecting to be collected — and nothing
        // anywhere would say so. This is the one action where failing closed
        // costs a driver a tap and failing open strands a child.
        const stillAssigned = await db.collection('rides')
            .where('driverId', '==', driverId)
            .where('status', 'in', ['assigned', 'driver_en_route', 'arriving', 'in_progress'])
            .get();
        if (!stillAssigned.empty) {
            const names = stillAssigned.docs
                .map(d => { var _a; return (_a = d.data()) === null || _a === void 0 ? void 0 : _a.studentName; })
                .filter(Boolean)
                .join(', ');
            throw new functions.https.HttpsError('failed-precondition', `You still have ${stillAssigned.size} rider(s) assigned`
                + `${names ? ` — ${names}` : ''}. Complete or release them first.`);
        }
        // Only reached once nobody is left. `currentCarId` is the older name for
        // the same thing and can only resolve documents written before both were
        // cleared together.
        const vehicleId = (0, fleet_1.resolveDriverVehicleId)(driver);
        const batch = db.batch();
        // Release vehicle if assigned (both halves of the mirror)
        if (vehicleId) {
            (0, fleet_1.writeVehicleState)(batch, db, vehicleId, fleet_1.VEHICLE_RELEASED);
        }
        // Update driver status and reset daily session counters
        batch.update(db.collection('users').doc(driverId), Object.assign(Object.assign({ status: 'offline' }, fleet_1.DRIVER_VEHICLE_CLEARED), { currentVehicleName: null, currentVehiclePlate: null, carModel: null, carColor: null, plateNumber: null, activeRideId: null, ridesCompletedToday: 0, totalStudentsToday: 0, totalDistanceToday: 0 }));
        await batch.commit();
        return {
            success: true,
            driverId,
            carReleased: !!vehicleId,
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