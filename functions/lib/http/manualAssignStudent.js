"use strict";
// ============================================
// HTTP FUNCTION: manualAssignStudent
// Triggered when manager manually assigns student
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
exports.manualAssignStudent = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const routing_1 = require("../utils/routing");
const notifications_1 = require("../utils/notifications");
const settings_1 = require("../utils/settings");
const authz_1 = require("../utils/authz");
const seats_1 = require("../constants/seats");
/**
 * HTTP Callable: Manually assign student to a driver's active ride
 * Input: { studentId: string, driverId: string }
 * Output: Updated ride details
 */
exports.manualAssignStudent = functions.https.onCall(async (data, context) => {
    var _a, _b;
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { studentId, driverId } = data;
    if (!studentId || !driverId) {
        throw new functions.https.HttpsError('invalid-argument', 'studentId and driverId are required');
    }
    const db = admin.firestore();
    try {
        // This check used to accept `activeRole == 'manager'` and skip
        // `accountStatus` entirely, so it was strictly weaker than the rules it
        // was meant to mirror: a manager whose account had been rejected kept the
        // ability to assign riders to drivers.
        await (0, authz_1.assertApprovedManager)(db, context.auth.uid, 'manually assign students');
        // Get student details
        const studentDoc = await db.collection('users').doc(studentId).get();
        if (!studentDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Student not found');
        }
        const student = Object.assign({ id: studentDoc.id }, studentDoc.data());
        // Check student is waiting
        const waitingStatuses = ['waiting_for_pickup', 'waiting_for_dropoff', 'requested', 'assigned'];
        if (!waitingStatuses.includes(student.status)) {
            throw new functions.https.HttpsError('failed-precondition', 'Student is not waiting for assignment');
        }
        // Get driver details
        const driverDoc = await db.collection('users').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }
        const driver = Object.assign({ id: driverDoc.id }, driverDoc.data());
        // Get active ride for driver
        const activeRideSnap = await db.collection('rides')
            .where('driverId', '==', driverId)
            .where('status', 'in', ['assigned', 'driver_en_route', 'arriving', 'in_progress'])
            .get();
        if (activeRideSnap.empty) {
            throw new functions.https.HttpsError('failed-precondition', 'Driver does not have an active ride');
        }
        const rideDoc = activeRideSnap.docs[0];
        const ride = Object.assign({ id: rideDoc.id }, rideDoc.data());
        // Get car/vehicle details for capacity check
        let capacity = driver.capacity || 4;
        if (ride.carId) {
            const vehicleDoc = await db.collection('vehicles').doc(ride.carId).get();
            if (vehicleDoc.exists) {
                capacity = ((_a = vehicleDoc.data()) === null || _a === void 0 ? void 0 : _a.capacity) || capacity;
            }
        }
        // How many people is this rider bringing?
        //
        // Deliberately a single-field query filtered in memory, matching
        // studentReadyToLeave: adding `status` to the query would need a
        // rides(studentId, status) composite and this is a handful of documents.
        const myRidesSnap = await db.collection('rides')
            .where('studentId', '==', studentId)
            .get();
        const waitingRequest = myRidesSnap.docs
            .map(d => d.data())
            .find(r => r.status === 'requested');
        const seatsNeeded = (0, seats_1.seatsOf)(waitingRequest);
        // Check capacity (capacity - 1 for driver seat).
        //
        // This counted ENTRIES — `existingStudents.length >= availableSeats` —
        // so a car already carrying a family of three looked like it held one
        // passenger, and a manager could keep adding riders to a full vehicle.
        const availableSeats = Math.max(1, capacity - 1);
        const existingStudents = ride.students || [];
        const seatsTaken = existingStudents.reduce((n, s) => n + (0, seats_1.seatsOf)({ seatsRequested: s.seats }), 0);
        const seatsFree = availableSeats - seatsTaken;
        if (seatsNeeded > seatsFree) {
            throw new functions.https.HttpsError('failed-precondition', seatsFree <= 0
                ? `Vehicle is full (${availableSeats} seats, driver takes 1).`
                : `Not enough room: this rider needs ${seatsNeeded} seat${seatsNeeded === 1 ? '' : 's'} and ${seatsFree} ${seatsFree === 1 ? 'is' : 'are'} free.`);
        }
        // Add student to ride
        const newStudent = {
            id: student.id,
            name: student.name,
            phone: student.phone || '',
            location: student.location,
            seats: seatsNeeded,
            picked: false
        };
        const updatedStudents = [...ride.students, newStudent];
        // Recalculate route with new student
        // Prefer the venue snapshotted on the ride at assignment time. Resolving
        // it live would re-point every passenger already on this run at whatever
        // the current gathering's venue is, which is wrong when the ride belongs
        // to an earlier gathering.
        const sabhaLocation = (0, settings_1.resolveVenue)(ride.venue, await (0, settings_1.getSabhaLocation)());
        const startPoint = ride.rideType === 'home-to-sabha'
            ? (driver.currentLocation || sabhaLocation)
            : sabhaLocation;
        const endPoint = ride.rideType === 'home-to-sabha'
            ? sabhaLocation
            : (driver.homeLocation || sabhaLocation);
        const newRoute = (0, routing_1.optimizeRoute)(startPoint, updatedStudents, endPoint, ride.rideType);
        const { distance, time } = (0, routing_1.calculateRouteStats)(newRoute);
        const batch = db.batch();
        // Update ride
        batch.update(db.collection('rides').doc(ride.id), {
            students: updatedStudents,
            route: newRoute,
            estimatedDistance: distance,
            estimatedTime: time
        });
        // Update student
        batch.update(db.collection('users').doc(studentId), {
            status: 'assigned',
            currentRideId: ride.id
        });
        await batch.commit();
        // Notify student
        try {
            const fcmToken = (_b = studentDoc.data()) === null || _b === void 0 ? void 0 : _b.fcmToken;
            if (fcmToken) {
                await (0, notifications_1.notifyStudentDriverAssigned)(fcmToken, driver.name, ride.carModel, ride.carColor);
            }
        }
        catch (notifError) {
            console.error('Error sending notification:', notifError);
        }
        return {
            success: true,
            rideId: ride.id,
            studentAdded: {
                id: student.id,
                name: student.name
            },
            updatedStats: {
                totalStudents: updatedStudents.length,
                estimatedDistance: Math.round(distance * 100) / 100,
                estimatedTime: time
            }
        };
    }
    catch (error) {
        console.error('Error manually assigning student:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to assign student');
    }
});
//# sourceMappingURL=manualAssignStudent.js.map