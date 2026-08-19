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
// The fleet helpers were imported here to release the car on every completed
// run. Nothing in this file touches the fleet any more — see the comment on the
// driver update below.
const events_1 = require("../utils/events");
const settings_1 = require("../utils/settings");
const time_1 = require("../utils/time");
const seats_1 = require("../constants/seats");
/** A ride still owed to a rider. Used to hold their status while a split leg runs. */
const OPEN_RIDE_STATUSES = ['requested', 'assigned', 'driver_en_route', 'arriving', 'in_progress'];
/**
 * HTTP Callable: Complete a ride
 * Input: { rideId: string }
 * Output: Driver's today stats
 */
exports.completeRide = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const driverUid = context.auth.uid;
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
        const targetDriverId = (ride === null || ride === void 0 ? void 0 : ride.driverId) || ((_a = ride === null || ride === void 0 ? void 0 : ride.driver) === null || _a === void 0 ? void 0 : _a.id);
        if (targetDriverId !== driverUid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the assigned Sarthi can complete this ride');
        }
        // Check ride status - allow assigned, in_progress, driver_en_route, arriving
        const validStatuses = ['assigned', 'in_progress', 'driver_en_route', 'arriving'];
        if (!validStatuses.includes(ride === null || ride === void 0 ? void 0 : ride.status)) {
            throw new functions.https.HttpsError('failed-precondition', `Ride status '${ride === null || ride === void 0 ? void 0 : ride.status}' cannot be completed`);
        }
        const batch = db.batch();
        const now = new Date().toISOString();
        // Which gathering these numbers belong to.
        //
        // This was `new Date().toISOString().split('T')[0]` — the UTC calendar
        // date. A drop-off run finishing at 22:30 in Boston is already the next
        // day in UTC, so the sabha's own drop-off figures were filed under
        // tomorrow while its pickup figures sat under today, and generateEventCSV
        // (which looks up `statistics/{the sabha's date}`) found neither complete.
        // The ride knows which sabha it served; ask it.
        const eventDate = (_b = (0, events_1.eventKeyFromRide)(ride)) !== null && _b !== void 0 ? _b : (0, time_1.zonedDateKey)(new Date(), await (0, settings_1.getTimeZone)());
        // Find ALL active rides for this driver to complete all documents in multi-student grouped rides
        const activeRidesSnap = await db.collection('rides')
            .where('driverId', '==', driverUid)
            .where('status', 'in', ['assigned', 'in_progress', 'driver_en_route', 'arriving'])
            .get();
        const allStudentsMap = new Map();
        /** The rides this call is closing, so a rider's OTHER open rides stand out. */
        const completingRideIds = new Set(activeRidesSnap.docs.map(d => d.id));
        for (const doc of activeRidesSnap.docs) {
            batch.update(doc.ref, {
                status: 'completed',
                completedAt: now
            });
            const data = doc.data();
            if (data.studentId) {
                allStudentsMap.set(data.studentId, {
                    id: data.studentId,
                    name: data.studentName || 'Student',
                    // People carried, not documents closed. Absent means one.
                    seats: (0, seats_1.seatsOf)(data),
                });
            }
            if (Array.isArray(data.students)) {
                for (const s of data.students) {
                    allStudentsMap.set(s.id, {
                        id: s.id,
                        name: s.name || 'Student',
                        seats: (0, seats_1.seatsOf)({ seatsRequested: s.seats }),
                    });
                }
            }
        }
        const allStudents = Array.from(allStudentsMap.values());
        // Update driver stats and release vehicle
        const driverDoc = await db.collection('users').doc(driverUid).get();
        const driver = driverDoc.data();
        const newRidesCompleted = ((driver === null || driver === void 0 ? void 0 : driver.ridesCompletedToday) || 0) + 1;
        // Seats carried, not rows closed. A driver who took a family of four had
        // this read 1, so their day's tally — and the manager's — undercounted
        // every group they moved.
        const seatsCarried = allStudents.reduce((n, s) => n + (s.seats || 1), 0);
        const newTotalStudents = ((driver === null || driver === void 0 ? void 0 : driver.totalStudentsToday) || 0)
            + (seatsCarried || ((_c = ride === null || ride === void 0 ? void 0 : ride.students) === null || _c === void 0 ? void 0 : _c.length) || 1);
        const newTotalDistance = ((driver === null || driver === void 0 ? void 0 : driver.totalDistanceToday) || 0) + ((ride === null || ride === void 0 ? void 0 : ride.estimatedDistance) || 0);
        // THE DRIVER KEEPS THEIR CAR.
        //
        // This used to release the vehicle and clear `currentVehicleId` on every
        // completed run, which modelled a run as the end of the driver's
        // relationship with the car. A volunteer keeps the same car all evening
        // and does several runs in it, so that model was wrong, and it produced
        // two failures:
        //
        //  - "Assign next" on the completion screen guards on
        //    `userProfile.currentVehicleId`. AuthContext subscribes to the user
        //    document, so the snapshot nulled that field within ~50-200ms while
        //    handleAssignNext waited a hardcoded 100ms. Whichever won the race
        //    decided whether the driver got riders or "Pick a car before finding
        //    riders". Intermittent, and unexplainable from the screen.
        //
        //  - Worse and quieter: the car went back to `available` with no holder,
        //    so ANOTHER driver could take it between runs. The first driver then
        //    got "Vehicle is assigned to another driver" for a car they had been
        //    using all evening.
        //
        // Only `driverDoneForToday` releases now — the explicit "everyone is home
        // and so am I" action. A driver who simply closes the app is caught by
        // releaseIdleVehicles at 03:00, and a manager can force it sooner with
        // managerReleaseVehicle. Both of those exist precisely so this does not
        // have to guess.
        //
        // `activeRideId` still clears: that ride IS over. `status` stays
        // 'available', which is what lets the shift card keep showing them on
        // shift, ready for the next tap.
        batch.update(db.collection('users').doc(driverUid), {
            status: 'available',
            activeRideId: null,
            ridesCompletedToday: newRidesCompleted,
            totalStudentsToday: newTotalStudents,
            totalDistanceToday: newTotalDistance
        });
        // Determine student status after ride
        const newStudentStatus = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'home-to-sabha' ? 'at_sabha' : 'home_safe';
        // Update students status and notify
        for (const student of allStudents) {
            // A group too large for one car is split across cars, so a rider can
            // still have a leg outstanding when this one finishes. Marking them
            // 'home_safe' then would be a plain lie on the manager's screen — and
            // it would clear currentRideId, cutting their remaining half loose.
            //
            // Single-field query filtered in memory, matching studentReadyToLeave:
            // adding `status` would need a rides(studentId, status) composite.
            const theirRides = await db.collection('rides')
                .where('studentId', '==', student.id)
                .get();
            const stillTravelling = theirRides.docs.some(d => { var _a; return !completingRideIds.has(d.id) && OPEN_RIDE_STATUSES.includes((_a = d.data()) === null || _a === void 0 ? void 0 : _a.status); });
            if (stillTravelling) {
                console.log(`[completeRide] ${student.id} has another leg open — status held`);
                continue;
            }
            batch.update(db.collection('users').doc(student.id), {
                status: newStudentStatus,
                currentRideId: null
            });
            // Send notification to student
            try {
                const studentDoc = await db.collection('users').doc(student.id).get();
                await (0, notifications_1.notifyStudentRideCompleted)((0, notifications_1.tokensOf)(student.id, studentDoc.data()));
            }
            catch (notifError) {
                console.error('Error sending notification to student:', student.id, notifError);
            }
        }
        // Safe student list construction for statistics
        const rawStudents = (Array.isArray(ride === null || ride === void 0 ? void 0 : ride.students) && ride.students.length > 0)
            ? ride.students
            : (allStudents.length > 0 ? allStudents : ((ride === null || ride === void 0 ? void 0 : ride.studentId) ? [{ id: ride.studentId, name: ride.studentName || 'Student' }] : []));
        const rideStudents = rawStudents.map((s) => {
            var _a, _b;
            return ({
                id: s.id || '',
                name: s.name || 'Student',
                // Carried onto the attendance row so the sabha's headcount is people,
                // not accounts. One rider bringing three is one row and three seats.
                seats: (_a = s.seats) !== null && _a !== void 0 ? _a : (0, seats_1.seatsOf)({ seatsRequested: s.seatsRequested }),
                driverId: driverUid,
                driverName: (ride === null || ride === void 0 ? void 0 : ride.driverName) || ((_b = ride === null || ride === void 0 ? void 0 : ride.driver) === null || _b === void 0 ? void 0 : _b.name) || 'Driver',
                carModel: (ride === null || ride === void 0 ? void 0 : ride.carModel) || '',
                carLicensePlate: (ride === null || ride === void 0 ? void 0 : ride.carLicensePlate) || ''
            });
        });
        // Update statistics for the event using set + merge to prevent nested dot notation errors
        const statsRef = db.collection('statistics').doc(eventDate);
        const statsDoc = await statsRef.get();
        const isPickup = (ride === null || ride === void 0 ? void 0 : ride.rideType) === 'home-to-sabha';
        const statsKey = isPickup ? 'pickup' : 'dropoff';
        const stats = statsDoc.exists ? (statsDoc.data() || {}) : {};
        const currentBlock = stats[statsKey] || { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] };
        const existingStudentIds = new Set((currentBlock.students || []).map((s) => s.id));
        const newStudents = rideStudents.filter(s => !existingStudentIds.has(s.id));
        const deduplicatedStudents = [...(currentBlock.students || []), ...newStudents];
        const updatedBlock = {
            // Sum of seats, not a row count. The rows are still de-duplicated by
            // rider above, so a rider who travelled in two cars appears once and
            // contributes each leg's seats — never counted twice as a person.
            totalStudents: deduplicatedStudents.reduce((n, s) => n + (Number(s.seats) || 1), 0),
            completedRides: (currentBlock.completedRides || 0) + 1,
            totalDrivers: Math.max(1, (currentBlock.totalDrivers || 0) + 1),
            students: deduplicatedStudents
        };
        batch.set(statsRef, Object.assign({ eventDate, [statsKey]: updatedBlock }, (statsDoc.exists ? {} : {
            [isPickup ? 'dropoff' : 'pickup']: { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] },
            attendance: { both: 0, pickupOnly: 0, dropoffOnly: 0 }
        })), { merge: true });
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