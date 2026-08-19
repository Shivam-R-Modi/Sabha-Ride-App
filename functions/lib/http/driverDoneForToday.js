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
exports.decideDoneWarning = decideDoneWarning;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const fleet_1 = require("../utils/fleet");
// The dispatch pool's own filter. Shared deliberately — see surveyTheQueue.
const globalAssignDriver_1 = require("./globalAssignDriver");
/**
 * Should this driver be warned before they finish?
 *
 * Warn, never block. A volunteer is always allowed to go home — the failure this
 * guards against is not "a driver left", it is "a driver left without knowing
 * anyone was still waiting". Measured on 2026-08-14: both drivers tapped done
 * within four minutes of each other while two riders sat at the temple with
 * open requests, and nothing on any screen said so.
 *
 * Only fires when BOTH are true: somebody is waiting, and nobody else can serve
 * them. A queue with other drivers still on shift is the ordinary case and must
 * stay silent, or the prompt becomes noise and gets tapped through unread.
 *
 * Pure, and exported, because this condition is the whole of the behaviour.
 */
function decideDoneWarning(waitingCount, otherDriversOnShift) {
    if (waitingCount <= 0)
        return null;
    if (otherDriversOnShift > 0)
        return null;
    const people = waitingCount === 1 ? '1 rider is' : `${waitingCount} riders are`;
    return `${people} still waiting, and you are the last driver on shift.\n\n`
        + 'If you finish now, nobody can pick them up tonight.';
}
/**
 * Count what the warning needs: unserved requests, and anyone else who could
 * serve them.
 *
 * "On shift" is defined as holding a car, because holding a car is exactly what
 * lets a driver be assigned riders — globalAssignDriver refuses without one. So
 * the fleet is the register of who is available, and it is three documents.
 *
 * WHY THIS SHARES isValidPendingRide RATHER THAN FILTERING ITS OWN WAY
 * -------------------------------------------------------------------
 * A "rider is still waiting" warning is only true if that rider CAN be picked
 * up. The one thing that decides that is the dispatch pool, so the two have to
 * be the same question — and when this counted for itself, they drifted.
 *
 * This used to match on the event key alone. `isValidPendingRide` also filters
 * by DIRECTION, and a pickup request writes no `rideType` field while a drop-off
 * stamps `sabha-to-home`. So during a drop-off run, a leftover pickup request
 * from earlier the same evening counted here and was correctly excluded there.
 *
 * Observed on 2026-08-17: "End my shift" warned *1 rider is still waiting*, and
 * "Find my next riders" answered *no one is left* — same driver, same second, two
 * contradictory screens, and no way to tell which was lying. Staying on shift
 * could not have helped, because the request was not dispatchable to anybody.
 *
 * Sharing the function also inherits its coordinate and studentId checks, which
 * is the same argument: a request with no usable pickup point cannot be served
 * by staying, so warning about it only teaches the driver to tap through.
 *
 * An absent `rideType` on the CONTEXT means no window is open, and
 * globalAssignDriver refuses outright in that state — so nothing is dispatchable
 * and there is nothing to warn about.
 */
async function surveyTheQueue(db, driverId) {
    var _a;
    const ctx = (await db.collection('system').doc('rideContext').get()).data();
    const eventId = (_a = ctx === null || ctx === void 0 ? void 0 : ctx.eventId) !== null && _a !== void 0 ? _a : null;
    const rideType = ctx === null || ctx === void 0 ? void 0 : ctx.rideType;
    const [requested, held] = await Promise.all([
        db.collection('rides').where('status', '==', 'requested').get(),
        db.collection('vehicles').where('status', '==', 'in_use').get(),
    ]);
    const waitingCount = !eventId || !rideType
        ? 0
        : requested.docs.filter(d => (0, globalAssignDriver_1.isValidPendingRide)(d.data(), eventId, rideType)).length;
    const otherDriversOnShift = new Set(held.docs
        .map(d => { var _a; return (_a = d.data()) === null || _a === void 0 ? void 0 : _a.assignedDriverId; })
        .filter((uid) => typeof uid === 'string' && uid !== driverId)).size;
    return { waitingCount, otherDriversOnShift };
}
/**
 * HTTP Callable: Driver done for today
 * Releases car and clears driver session
 * Input: { driverId: string, acknowledgeWaiting?: boolean }
 * Output: Success confirmation, or a confirmation request that released nothing
 */
exports.driverDoneForToday = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { driverId, acknowledgeWaiting } = data;
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
            throw new functions.https.HttpsError('permission-denied', 'Only the Sarthi can mark themselves done');
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
        // Nobody of THEIRS is left. Now: is anybody else's rider left, and is
        // this driver the only one who could still take them?
        //
        // Deliberately after the hard guard and before any write, and deliberately
        // a return rather than a throw — the caller has to be able to say "yes,
        // I'm going anyway" and have that respected on the second call.
        if (!acknowledgeWaiting) {
            const { waitingCount, otherDriversOnShift } = await surveyTheQueue(db, driverId);
            const warning = decideDoneWarning(waitingCount, otherDriversOnShift);
            if (warning) {
                return {
                    success: false,
                    needsConfirmation: true,
                    driverId,
                    carReleased: false,
                    waitingCount,
                    warning,
                    message: warning,
                };
            }
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
            needsConfirmation: false,
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
        throw new functions.https.HttpsError('internal', 'Failed to mark Sarthi done');
    }
});
//# sourceMappingURL=driverDoneForToday.js.map