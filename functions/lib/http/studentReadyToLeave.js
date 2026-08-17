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
exports.normalisePresence = normalisePresence;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
// getZonedParts is gone from here deliberately: this function no longer decides
// for itself whether the window is open.
const time_1 = require("../utils/time");
const coords_1 = require("../utils/coords");
const tenancy_1 = require("../constants/tenancy");
const seats_1 = require("../constants/seats");
const METHODS = ['pickup', 'auto', 'manual', 'unknown'];
/**
 * Clean the client's presence claim into something worth storing.
 *
 * Exported and pure. The rule that matters: this NEVER rejects. Every branch
 * yields a record, because the only thing a rejection here could achieve is
 * stranding a rider whose phone or cached bundle disagreed with the server.
 *
 * A claim of `pickup` is the one thing the server can check for itself, so it
 * does: a client claiming to have arrived by ride when the user record does not
 * say `at_sabha` is downgraded to `manual`. Not to punish it — the rider still
 * gets their lift — but so the manager's board reflects what actually happened.
 *
 * Coordinates are deliberately not accepted. Only a rounded distance is, so no
 * precise location for a child ever reaches the database.
 */
function normalisePresence(raw, storedStatus) {
    const claim = (raw && typeof raw === 'object' ? raw : {});
    const asked = typeof claim.method === 'string' && METHODS.includes(claim.method)
        ? claim.method
        : 'unknown';
    // The only claim the server can verify. Downgrade rather than refuse.
    const method = asked === 'pickup' && storedStatus !== 'at_sabha'
        ? 'manual'
        : asked;
    const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
    const record = { method };
    const distance = num(claim.distanceMeters);
    const accuracy = num(claim.accuracyMeters);
    if (distance !== undefined)
        record.distanceMeters = distance;
    if (accuracy !== undefined)
        record.accuracyMeters = accuracy;
    return record;
}
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
        // HOW THEY GOT HERE IS RECORDED, NOT ENFORCED.
        //
        // This used to be `if (student?.status !== 'at_sabha') throw`. Since
        // `at_sabha` is written in exactly one place — when a home→sabha ride
        // completes — the real rule was "you may request a ride home only if this
        // app drove you here". Every rider who walked, drove themselves, or got a
        // lift from a friend was permanently locked out, and the client showed
        // them the button anyway, surfacing the refusal as "Please try again" —
        // advice that could never work.
        //
        // The client now establishes presence instead: `at_sabha` short-circuits
        // it, otherwise a GPS fix inside 100m confirms it, and failing both the
        // rider is simply asked. That last path means none of this is enforceable,
        // and it is not meant to be — a rider stranded at the temple with no way
        // to ask for a lift is worse than a driver making one wasted stop.
        //
        // So the claim is recorded on the ride and shown to managers, which makes
        // an implausible one visible without anybody having been blocked. A
        // MISSING claim is an older cached bundle, not an attack: it is stamped
        // 'unknown' rather than refused, because nobody should be stranded by
        // their own service worker.
        const presence = normalisePresence(data === null || data === void 0 ? void 0 : data.presence, student === null || student === void 0 ? void 0 : student.status);
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
            // Refresh the claim even on a reused ride. A rider who was asked and
            // then re-taps once GPS has settled should show the better evidence,
            // not the first guess.
            await existing.ref.update({ presence });
            console.log(`[studentReadyToLeave] Reusing existing return ride ${rideId} for ${studentId} (${presence.method})`);
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
                dropoffRequested: true,
                // Never coordinates — only how presence was established and, if
                // GPS had an opinion, how far off it thought they were.
                presence,
            });
            console.log(`[studentReadyToLeave] Created return ride ${rideId} for ${studentId} (${presence.method})`);
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