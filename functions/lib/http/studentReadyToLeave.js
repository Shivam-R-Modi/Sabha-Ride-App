"use strict";
// ============================================
// HTTP FUNCTION: studentReadyToLeave
// Triggered when student clicks "Ready to Leave"
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
exports.studentReadyToLeave = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
// getZonedParts is gone from here deliberately: this function no longer decides
// for itself whether the window is open.
const time_1 = require("../utils/time");
const coords_1 = require("../utils/coords");
const tenancy_1 = require("../constants/tenancy");
const seats_1 = require("../constants/seats");
/**
 * HTTP Callable: Student ready to leave Sabha
 * Updates student status for drop-off assignment
 * Input: { studentId: string }
 * Output: Success confirmation
 */
exports.studentReadyToLeave = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { studentId } = data;
    if (!studentId) {
        throw new functions.https.HttpsError('invalid-argument', 'studentId is required');
    }
    const db = admin.firestore();
    try {
        // Get student details
        const studentDoc = await db.collection('users').doc(studentId).get();
        if (!studentDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Student not found');
        }
        const student = studentDoc.data();
        // Verify the caller is the student
        if (studentId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the student can mark themselves ready');
        }
        // Check if student is at Sabha (must have completed pickup)
        if ((student === null || student === void 0 ? void 0 : student.status) !== 'at_sabha') {
            throw new functions.https.HttpsError('failed-precondition', 'You must be at Sabha to request drop-off');
        }
        // Is the drop-off window open?
        //
        // This used to be `if (dayOfWeek !== 5 || hour < 22) throw` — Friday after
        // 10 PM, hardcoded. Once a manager could move a sabha, that made the
        // window settings a lie: a Tuesday 6–8 PM gathering had a drop-off window
        // the app advertised and the server refused. Every rider pressing the
        // button got "only available after 10 PM on Friday".
        //
        // The scheduler already publishes exactly one answer to "which rides are
        // open right now", derived from the gathering's own times and honouring a
        // manager's manual override. Read that instead of recomputing, so the
        // button and the callable can never disagree.
        const now = new Date();
        const rideContextDoc = await db.collection('system').doc('rideContext').get();
        const rideContext = rideContextDoc.data();
        if ((rideContext === null || rideContext === void 0 ? void 0 : rideContext.rideType) !== 'sabha-to-home') {
            throw new functions.https.HttpsError('failed-precondition', (rideContext === null || rideContext === void 0 ? void 0 : rideContext.timeContext)
                ? `Drop-off rides are not open yet. ${rideContext.timeContext}`
                : 'Drop-off rides are not open yet.');
        }
        // The gathering this return leg belongs to. Was `zonedDateKey(now)` —
        // today's date — which is wrong whenever the sabha is not today, and sits
        // on a knife edge at midnight while drop-off runs are still going.
        const eventDate = rideContext.eventId || (0, time_1.zonedDateKey)(now, time_1.DEFAULT_TIME_ZONE);
        // ── Create the return-leg ride request ──────────────────────
        //
        // Marking the user `waiting_for_dropoff` is not enough on its own:
        // globalAssignDriver only ever queries `rides where status ==
        // 'requested'`, so a student who pressed this button never entered the
        // assignment pool and no driver could be assigned to take them home.
        //
        // The assigner clusters and geo-fences on pickupLat/pickupLng and uses
        // rideType only to flip the route endpoints — for 'sabha-to-home' the
        // route is already SABHA_LOCATION -> students -> driver's home. So the
        // return ride carries the student's HOME coordinates as pickupLat/Lng:
        // clustering then groups by home, the geo-fence measures driver-to-home,
        // and the existing routing needs no change.
        const home = (0, coords_1.resolveHomeCoords)(student);
        if (!home) {
            throw new functions.https.HttpsError('failed-precondition', 'Your home address is not set. Please update your address in Profile before requesting drop-off.');
        }
        // Idempotent: a double tap must not create a second ride. Reuse any
        // return ride this student already has open.
        //
        // Deliberately a single-field query, then filtered in memory. Adding
        // rideType and status to the query would need a composite index on
        // rides(studentId, rideType, status), which does not exist — the query
        // would throw FAILED_PRECONDITION at runtime. A student has a handful of
        // ride documents, so filtering client-side here is cheap and needs no
        // index deploy.
        const OPEN_STATUSES = ['requested', 'assigned', 'in_progress'];
        const mySnap = await db.collection('rides')
            .where('studentId', '==', studentId)
            .get();
        const existing = mySnap.docs.find(d => {
            const r = d.data();
            return r.rideType === 'sabha-to-home' && OPEN_STATUSES.includes(r.status);
        });
        // How many people are going home.
        //
        // Without this the return leg defaults to one seat, so a family of six who
        // were brought here in two cars would be offered a single place home — and
        // nothing would report it, because one seat is a perfectly valid request.
        //
        // Taken from the outbound legs rather than a profile field: it is the
        // number that actually travelled. Legs of a split group are summed, since
        // each carried part of the party. Falls back to 1, which is what every
        // ride predating seats means.
        const outboundSeats = mySnap.docs
            .map(d => d.data())
            .filter(r => r.rideType === 'home-to-sabha' && r.eventDate === eventDate)
            .reduce((n, r) => n + (0, seats_1.seatsOf)(r), 0);
        const seatsRequested = outboundSeats > 0 ? Math.min(outboundSeats, seats_1.MAX_SEATS) : seats_1.DEFAULT_SEATS;
        let rideId;
        if (existing) {
            rideId = existing.id;
            console.log(`[studentReadyToLeave] Reusing existing return ride ${rideId} for ${studentId}`);
        }
        else {
            const rideRef = db.collection('rides').doc();
            rideId = rideRef.id;
            const nowIso = new Date().toISOString();
            await rideRef.set({
                studentId,
                studentName: (student === null || student === void 0 ? void 0 : student.name) || 'Student',
                studentPhone: (student === null || student === void 0 ? void 0 : student.phone) || '',
                date: eventDate,
                eventDate,
                timeSlot: 'After Sabha',
                pickupAddress: (student === null || student === void 0 ? void 0 : student.address) || '',
                pickupLat: home.lat,
                pickupLng: home.lng,
                notes: '',
                status: 'requested',
                rideType: 'sabha-to-home',
                seatsRequested,
                // The return leg is the SECOND place a ride is created, and easy
                // to miss: the rider never sees this form.
                cityId: tenancy_1.FOUNDING_CITY_ID,
                locationId: tenancy_1.FOUNDING_LOCATION_ID,
                createdAt: nowIso,
                peers: [],
                isReadyToLeave: true,
                // StudentDashboard renders its "In Drop-off Queue" confirmation
                // from activeRide.dropoffRequested. Without this the student
                // taps the button, the ride is created, and the UI still shows
                // an un-pressed button — no feedback that it worked.
                dropoffRequested: true
            });
            console.log(`[studentReadyToLeave] Created return ride ${rideId} for ${studentId}`);
        }
        // Update student status
        await db.collection('users').doc(studentId).update({
            status: 'waiting_for_dropoff',
            dropoffRequested: true,
            currentRideId: rideId
        });
        return {
            success: true,
            studentId,
            rideId,
            message: 'You are now in the queue for drop-off',
            status: 'waiting_for_dropoff'
        };
    }
    catch (error) {
        console.error('Error marking student ready:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to mark student ready');
    }
});
//# sourceMappingURL=studentReadyToLeave.js.map