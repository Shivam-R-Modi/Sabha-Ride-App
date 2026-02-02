"use strict";
// ============================================
// HTTP FUNCTION: assignStudentsToDriver
// Triggered when driver clicks "Assign Me"
// Uses VRP Solver (Clarke-Wright Savings) for optimal assignments
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
exports.assignStudentsToDriver = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const vrpSolver_1 = require("../optimization/vrpSolver");
const routing_1 = require("../utils/routing");
const notifications_1 = require("../utils/notifications");
/**
 * HTTP Callable: Assign students to a driver
 * Input: { driverId: string, carId: string }
 * Output: Assignment details
 */
exports.assignStudentsToDriver = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { driverId, carId } = data;
    if (!driverId || !carId) {
        throw new functions.https.HttpsError('invalid-argument', 'driverId and carId are required');
    }
    const db = admin.firestore();
    try {
        // Get current ride context
        const rideContextDoc = await db.collection('system').doc('rideContext').get();
        if (!rideContextDoc.exists) {
            throw new functions.https.HttpsError('failed-precondition', 'Ride context not available');
        }
        const rideContext = rideContextDoc.data();
        if (!(rideContext === null || rideContext === void 0 ? void 0 : rideContext.rideType)) {
            throw new functions.https.HttpsError('failed-precondition', 'No rides available at this time');
        }
        const rideType = rideContext.rideType;
        // Get driver details
        const driverDoc = await db.collection('drivers').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }
        const driver = Object.assign({ id: driverDoc.id }, driverDoc.data());
        // Get car details
        const carDoc = await db.collection('cars').doc(carId).get();
        if (!carDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Car not found');
        }
        const car = Object.assign({ id: carDoc.id }, carDoc.data());
        // Check if car is available
        if (car.status !== 'available') {
            throw new functions.https.HttpsError('failed-precondition', 'Car is not available');
        }
        // Get waiting students based on ride type
        const waitingStatus = rideType === 'home-to-sabha' ? 'waiting_for_pickup' : 'waiting_for_dropoff';
        const studentsSnapshot = await db.collection('students')
            .where('status', '==', waitingStatus)
            .get();
        if (studentsSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', 'No students waiting for assignment');
        }
        const students = studentsSnapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
        // Use VRP Solver for optimal assignment
        // Create a single-driver array for this specific driver
        const singleDriver = Object.assign(Object.assign({}, driver), { currentCarId: carId });
        const vrpResult = (0, vrpSolver_1.solveCVRP)(students, [singleDriver], rideType);
        // Get assignment for this driver
        const assignment = vrpResult.assignments.find(a => a.driverId === driverId);
        if (!assignment || assignment.students.length === 0) {
            throw new functions.https.HttpsError('not-found', 'Could not assign any students');
        }
        // Prepare ride students
        const rideStudents = assignment.students;
        // Build route from VRP assignment (already optimized)
        const sabhaLocation = { lat: 42.3396, lng: -71.0942, address: 'Sabha Venue' };
        const startPoint = rideType === 'home-to-sabha'
            ? (driver.currentLocation || ((_a = rideStudents[0]) === null || _a === void 0 ? void 0 : _a.location) || sabhaLocation)
            : sabhaLocation;
        const endPoint = rideType === 'home-to-sabha'
            ? sabhaLocation
            : (driver.homeLocation || sabhaLocation);
        const route = (0, routing_1.optimizeRoute)(startPoint, rideStudents, endPoint, rideType);
        // Create ride document
        const eventDate = new Date().toISOString().split('T')[0];
        const rideRef = db.collection('rides').doc();
        const ride = {
            eventDate,
            driverId: driver.id,
            driverName: driver.name,
            carId: car.id,
            carModel: car.model,
            carColor: car.color,
            carLicensePlate: car.licensePlate,
            rideType,
            status: 'assigned',
            students: rideStudents,
            route,
            estimatedDistance: assignment.routeDistance,
            estimatedTime: assignment.estimatedTime,
            startedAt: null,
            completedAt: null,
            allWaypointsVisited: false
        };
        // Batch write
        const batch = db.batch();
        // Create ride
        batch.set(rideRef, ride);
        // Update car status
        batch.update(db.collection('cars').doc(carId), {
            status: 'in_use',
            assignedDriverId: driverId
        });
        // Update driver
        batch.update(db.collection('drivers').doc(driverId), {
            status: 'assigned',
            activeRideId: rideRef.id,
            currentCarId: carId
        });
        // Update students
        for (const student of rideStudents) {
            batch.update(db.collection('students').doc(student.id), {
                status: 'assigned',
                currentRideId: rideRef.id
            });
        }
        await batch.commit();
        // Send notifications
        try {
            // Notify driver
            const driverUserDoc = await db.collection('users').doc(driver.userId).get();
            const driverFcmToken = (_b = driverUserDoc.data()) === null || _b === void 0 ? void 0 : _b.fcmToken;
            if (driverFcmToken) {
                await (0, notifications_1.notifyDriverStudentsAssigned)(driverFcmToken, rideStudents.length);
            }
            // Notify students
            for (const student of rideStudents) {
                // Get student document to find userId
                const studentDoc = await db.collection('students').doc(student.id).get();
                const studentData = studentDoc.data();
                if (studentData === null || studentData === void 0 ? void 0 : studentData.userId) {
                    const studentUserDoc = await db.collection('users').doc(studentData.userId).get();
                    const studentFcmToken = (_c = studentUserDoc.data()) === null || _c === void 0 ? void 0 : _c.fcmToken;
                    if (studentFcmToken) {
                        await (0, notifications_1.notifyStudentDriverAssigned)(studentFcmToken, driver.name, car.model, car.color);
                    }
                }
            }
        }
        catch (notifError) {
            console.error('Error sending notifications:', notifError);
            // Don't fail the assignment if notifications fail
        }
        return {
            rideId: rideRef.id,
            students: rideStudents,
            route,
            estimatedDistance: assignment.routeDistance,
            estimatedTime: assignment.estimatedTime,
            googleMapsUrl: assignment.googleMapsUrl,
            car: {
                model: car.model,
                color: car.color,
                licensePlate: car.licensePlate,
                capacity: car.capacity
            }
        };
    }
    catch (error) {
        console.error('Error assigning students:', error);
        throw new functions.https.HttpsError('internal', 'Failed to assign students');
    }
});
//# sourceMappingURL=assignStudentsToDriver.js.map