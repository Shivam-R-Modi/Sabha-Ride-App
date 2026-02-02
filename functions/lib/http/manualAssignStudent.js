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
        // Verify the caller is a manager
        const userDoc = await db.collection('users').doc(context.auth.uid).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }
        const user = userDoc.data();
        if (!((_a = user === null || user === void 0 ? void 0 : user.roles) === null || _a === void 0 ? void 0 : _a.includes('manager'))) {
            throw new functions.https.HttpsError('permission-denied', 'Only managers can manually assign students');
        }
        // Get student details
        const studentDoc = await db.collection('students').doc(studentId).get();
        if (!studentDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Student not found');
        }
        const student = Object.assign({ id: studentDoc.id }, studentDoc.data());
        // Check student is waiting
        const waitingStatuses = ['waiting_for_pickup', 'waiting_for_dropoff'];
        if (!waitingStatuses.includes(student.status)) {
            throw new functions.https.HttpsError('failed-precondition', 'Student is not waiting for assignment');
        }
        // Get driver details
        const driverDoc = await db.collection('drivers').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }
        const driver = Object.assign({ id: driverDoc.id }, driverDoc.data());
        // Check driver has an active ride
        if (!driver.activeRideId) {
            throw new functions.https.HttpsError('failed-precondition', 'Driver does not have an active ride');
        }
        // Get the ride
        const rideDoc = await db.collection('rides').doc(driver.activeRideId).get();
        if (!rideDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Ride not found');
        }
        const ride = Object.assign({ id: rideDoc.id }, rideDoc.data());
        // Get car details for capacity check
        const carDoc = await db.collection('cars').doc(ride.carId).get();
        if (!carDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Car not found');
        }
        const car = Object.assign({ id: carDoc.id }, carDoc.data());
        // Check capacity
        if (ride.students.length >= car.capacity) {
            throw new functions.https.HttpsError('failed-precondition', `Car is at full capacity (${car.capacity} seats)`);
        }
        // Add student to ride
        const newStudent = {
            id: student.id,
            name: student.name,
            location: student.location,
            picked: false
        };
        const updatedStudents = [...ride.students, newStudent];
        // Recalculate route with new student
        const sabhaLocation = { lat: 28.6139, lng: 77.2090, address: 'Sabha Venue' };
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
        batch.update(db.collection('students').doc(studentId), {
            status: 'assigned',
            currentRideId: ride.id
        });
        await batch.commit();
        // Notify student
        try {
            const studentUserDoc = await db.collection('users').doc(student.userId).get();
            const fcmToken = (_b = studentUserDoc.data()) === null || _b === void 0 ? void 0 : _b.fcmToken;
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