"use strict";
// ============================================
// HTTP FUNCTION: globalAssignDriver  (Approach B)
// Re-clusters ALL unassigned students every time a driver
// taps "Assign Me". A Firestore-based lock prevents races.
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
exports.globalAssignDriver = void 0;
exports.isValidPendingRide = isValidPendingRide;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const carload_1 = require("../utils/carload");
const seats_1 = require("../utils/seats");
const seats_2 = require("../constants/seats");
const tenancy_1 = require("../constants/tenancy");
const routing_1 = require("../utils/routing");
const coords_1 = require("../utils/coords");
const fleet_1 = require("../utils/fleet");
const events_1 = require("../utils/events");
const authz_1 = require("../utils/authz");
const notifications_1 = require("../utils/notifications");
const settings_1 = require("../utils/settings");
const rateLimiter_1 = require("../utils/rateLimiter");
// ── constants ──────────────────────────────────────────────
const LOCK_DOC = 'system/assignmentLock';
const LOCK_TTL_MS = 10000; // 10 seconds
const GEO_FENCE_MILES = 15; // ignore students > 15 mi away
// ── helpers ────────────────────────────────────────────────
/** Haversine distance in miles */
function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
    const R = 3959;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
/**
 * Is this pending ride dispatchable for the gathering we are dispatching?
 *
 * The GPS checks were the whole of this function, and that was a real hole: a
 * `requested` ride is only ever filtered by `status`, so a request left over from
 * a PREVIOUS sabha stayed in the pool for ever and would be handed to the next
 * driver who tapped. Three of them were live in production on 2026-08-14, five
 * days after their gathering, and a tap would have routed a driver to collect
 * people for a sabha that had already happened.
 *
 * `expectedEventKey` is the gathering from `system/rideContext` — the same
 * document that decided the ride window, so the two cannot disagree.
 *
 * A ride with NO event key at all is rejected. That is the deliberate choice:
 * every client that creates a request stamps `date` and `eventDate`
 * (hooks/useRides.ts), and studentReadyToLeave stamps `eventDate` server-side, so
 * an unkeyed request is either pre-dating that or hand-written in the console.
 * Refusing it means such a ride is never dispatched; accepting it means it is
 * dispatched to every gathering for ever. The first failure is visible to a
 * manager in the Waiting queue, the second sends a car to the wrong place.
 *
 * `expectedRideType` closes the same hole in the other dimension. The pool was
 * filtered by status and event but never by DIRECTION, and the two kinds of
 * request do not look alike:
 *
 *   pickup    hooks/useRides.ts writes no `rideType` field at all
 *   drop-off  studentReadyToLeave stamps `rideType: 'sabha-to-home'`
 *
 * So once the window flipped, every unserved pickup request was swept into the
 * drop-off run. Reproduced in production on 2026-08-14: Rebo Fe asked to be
 * COLLECTED from home, and was assigned a driver routed from the venue to her
 * house — a sabha she had never reached. Unserved pickups always outlive the
 * pickup window, so this fired every week.
 *
 * An ABSENT rideType means `home-to-sabha`, and that default is load-bearing:
 * every pickup request ever written lacks the field, so treating absent as
 * "no match" would refuse every genuine request instead. Same reasoning as
 * `seatsOf` in constants/seats.ts — absent means the original behaviour, so
 * nothing needs backfilling and there is no window where a half-stamped
 * collection reports the wrong thing.
 */
function isValidPendingRide(docData, expectedEventKey, expectedRideType) {
    var _a, _b, _c;
    const lat = (_a = docData.pickupLat) !== null && _a !== void 0 ? _a : 0;
    const lng = (_b = docData.pickupLng) !== null && _b !== void 0 ? _b : 0;
    if (typeof lat !== 'number' || typeof lng !== 'number')
        return false;
    if (isNaN(lat) || isNaN(lng))
        return false;
    if (lat === 0 && lng === 0)
        return false;
    if (!docData.studentId)
        return false;
    // Reuses eventKeyFromRide so `eventId` and `eventDate` are read in the same
    // priority order, and validated against the same YYYY-MM-DD shape, as
    // everywhere else that has to work out which gathering a ride belongs to.
    if (expectedEventKey && (0, events_1.eventKeyFromRide)(docData) !== expectedEventKey)
        return false;
    // Anything that is not one of the two known directions is rejected rather
    // than defaulted — a hand-edited 'sabha-to-Home' should strand one request
    // visibly, not quietly join whichever run is open.
    const direction = (_c = docData.rideType) !== null && _c !== void 0 ? _c : 'home-to-sabha';
    if (direction !== expectedRideType)
        return false;
    return true;
}
// ── main function ──────────────────────────────────────────
exports.globalAssignDriver = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    // Auth check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    // Rate limiting: 10 requests per minute
    await (0, rateLimiter_1.checkRateLimit)(context.auth.uid, {
        maxRequests: 10,
        windowMs: 60 * 1000, // 1 minute
        functionName: 'globalAssignDriver'
    });
    const { driverId, carId } = data;
    console.log(`[globalAssign] START driver=${driverId}, car=${carId}`);
    if (!driverId || !carId) {
        throw new functions.https.HttpsError('invalid-argument', 'driverId and carId are required');
    }
    // A driver may only dispatch themselves.
    //
    // `driverId` arrives in the request body, and until now nothing compared it
    // to the caller. Any signed-in account could therefore assign students to
    // any driver, take that driver's car (`writeVehicleState` below), overwrite
    // their `status`, `activeRideId` and `currentVehicleId`, and hold the global
    // assignment lock — all under someone else's name, with the victim's own
    // dashboard showing the result.
    //
    // Strict equality, with no manager override: the one caller
    // (DriverDashboard) already passes `currentUser.uid`, so an override would be
    // untested code sitting in the middle of the dispatch path. Manager-initiated
    // assignment is manualAssignStudent, which authorises separately.
    if (driverId !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'A Sarthi can only request an assignment for themselves.');
    }
    const db = admin.firestore();
    // ── Step 1: Acquire lock ────────────────────────────────
    // Define lockRef at function scope so it's accessible in error handler
    const lockRef = db.doc(LOCK_DOC);
    try {
        const lockSnap = await lockRef.get();
        if (lockSnap.exists) {
            const lockData = lockSnap.data();
            const lockAge = Date.now() - ((_a = lockData === null || lockData === void 0 ? void 0 : lockData.timestamp) !== null && _a !== void 0 ? _a : 0);
            if (lockAge < LOCK_TTL_MS) {
                console.log(`[globalAssign] LOCKED by ${lockData === null || lockData === void 0 ? void 0 : lockData.driverId}, age=${lockAge}ms`);
                return { status: 'locked' };
            }
            console.log(`[globalAssign] Stale lock (${lockAge}ms) — overwriting`);
        }
        // Write lock
        await lockRef.set({ driverId, timestamp: Date.now() });
        console.log('[globalAssign] Lock acquired');
        // ── Step 2: Ride context ────────────────────────────
        const rideContextDoc = await db.collection('system').doc('rideContext').get();
        if (!rideContextDoc.exists) {
            throw new functions.https.HttpsError('failed-precondition', 'Ride context not available. Please contact a manager.');
        }
        const rideContext = rideContextDoc.data();
        if (!(rideContext === null || rideContext === void 0 ? void 0 : rideContext.rideType)) {
            throw new functions.https.HttpsError('failed-precondition', 'No rides are available at this time.');
        }
        const rideType = rideContext.rideType;
        // The venue for THIS gathering. Taken from the same rideContext document
        // that produced the rideType above, so the two can never disagree — a
        // separate read of events/{id} would leave a window where the route's
        // venue and the window's venue came from different resolutions.
        // Falls back to settings/main, which is what ran before events had venues.
        const SABHA_LOCATION = (0, settings_1.resolveVenue)(rideContext.venue, await (0, settings_1.getSabhaLocation)());
        const eventId = (_b = rideContext.eventId) !== null && _b !== void 0 ? _b : null;
        console.log(`[globalAssign] rideType=${rideType}, venue=${SABHA_LOCATION.address}`);
        // ── Step 3: Tapping driver + car ────────────────────
        const driverDoc = await db.collection('users').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Sarthi profile not found.');
        }
        const driverData = driverDoc.data();
        // Approved, and actually a driver.
        //
        // This function checked that a caller was dispatching THEMSELVES and
        // nothing else — no account status, no role. The single mention of
        // `accountStatus` was inside the query that built K-means seeds, which
        // authorises nobody, and the test named "a revoked driver gets no riders"
        // asserted that clause existed rather than that a revoked caller was
        // refused. So a revoked account still signed in and still holding a car
        // could tap Assign Me and be handed the names, phone numbers and home
        // addresses of children — the exact thing revoking exists to stop.
        //
        // Kept here, after the existence check, so a missing profile still reports
        // "profile not found" rather than "permission denied".
        await (0, authz_1.assertApprovedDriver)(db, driverId, 'be assigned riders');
        const carDoc = await db.collection('cars').doc(carId).get();
        if (!carDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Vehicle not found.');
        }
        const carData = carDoc.data();
        if (carData.status !== 'available' && carData.status !== 'in_use') {
            throw new functions.https.HttpsError('failed-precondition', `Vehicle is ${carData.status}.`);
        }
        // The guard used to read carData.currentDriverId. Nothing writes that
        // field — every writer, client and server, sets assignedDriverId — so
        // this compared undefined against a uid and passed every single time.
        // Two drivers could hold the same car.
        const currentHolder = (0, fleet_1.resolveVehicleHolder)(carData);
        if (carData.status === 'in_use' && currentHolder && currentHolder !== driverId) {
            throw new functions.https.HttpsError('failed-precondition', 'Vehicle is assigned to another Sarthi.');
        }
        const availableSeats = Math.max(1, (carData.capacity || 4) - 1);
        // The largest vehicle the fleet HAS, which decides whether a group too big
        // for this car should wait for a bigger one or be split across several.
        // Read live rather than cached: a stale value silently splits families who
        // could have travelled together, or strands ones who cannot.
        const fleetSnap = await db.collection('vehicles').get();
        const maxFleetSeats = (0, seats_1.maxPassengerSeats)(fleetSnap.docs.map(d => { var _a; return (_a = d.data()) === null || _a === void 0 ? void 0 : _a.capacity; }));
        // resolveHomeCoords tolerates every shape the codebase writes
        // ({lat,lng} and {latitude,longitude}, under `location` or
        // `homeLocation`) and rejects the 0,0 placeholder that means "address
        // never geocoded". Reading it by hand here — and raw at the endPoint
        // below — was how a driver with only {latitude,longitude} ended up with
        // an undefined `.lat` poisoning the route and every URL built from it.
        const tappingDriverLoc = (0, coords_1.resolveHomeCoords)(driverData);
        if (!tappingDriverLoc) {
            throw new functions.https.HttpsError('failed-precondition', 'Your location is not set. Please update your profile.');
        }
        console.log(`[globalAssign] seats=${availableSeats}, driverLoc=${tappingDriverLoc.lat},${tappingDriverLoc.lng}`);
        // ── Step 4: All unassigned ride requests ─────────────
        const ridesSnap = await db.collection('rides')
            .where('status', '==', 'requested')
            .get();
        if (ridesSnap.empty) {
            return { status: 'no_students' };
        }
        // Keyed by RIDE DOCUMENT, not by rider.
        //
        // This used to deduplicate by studentId, keeping the first request per
        // person. That was right when one rider could only ever have one waiting
        // request. It is wrong now: splitting a group across cars leaves the same
        // rider holding the assigned share AND a waiting remainder, and releasing
        // an assignment puts a second waiting request back in the pool. Under the
        // old key the remainder was dropped from the pool without a trace — the
        // family's other three seats simply stopped existing.
        //
        // Over-serving a rider who somehow files two requests is visible: a driver
        // arrives with spare seats. Under-serving is silent. Prefer the visible one.
        const requestMap = new Map();
        for (const doc of ridesSnap.docs) {
            const d = doc.data();
            // Both come from the same system/rideContext read, so the gathering
            // and the direction can never disagree with the window being served:
            // a leftover request from a previous sabha, or one asking for the
            // opposite direction, cannot enter this pool.
            if (!isValidPendingRide(d, eventId, rideType))
                continue;
            requestMap.set(doc.id, {
                id: doc.id,
                rideRequestId: doc.id,
                studentId: d.studentId,
                name: d.studentName || 'Student',
                phone: d.studentPhone || '',
                lat: d.pickupLat,
                lng: d.pickupLng,
                address: d.pickupAddress || 'Unknown',
                seats: (0, seats_2.seatsOf)(d),
                allowSplit: d.allowSplit !== false,
                isRemainder: !!d.groupId,
                groupId: (_c = d.groupId) !== null && _c !== void 0 ? _c : null,
                groupSeatsTotal: (_d = d.groupSeatsTotal) !== null && _d !== void 0 ? _d : null,
                // Carried so a split remainder is filed against the same gathering
                // as the request it came from, rather than being re-derived.
                date: (_f = (_e = d.date) !== null && _e !== void 0 ? _e : d.eventDate) !== null && _f !== void 0 ? _f : '',
                timeSlot: (_g = d.timeSlot) !== null && _g !== void 0 ? _g : '',
                createdAt: typeof d.createdAt === 'string' ? d.createdAt : undefined,
            });
        }
        const allStudentPoints = Array.from(requestMap.values());
        if (allStudentPoints.length === 0) {
            return { status: 'no_students' };
        }
        console.log(`[globalAssign] ${allStudentPoints.length} unassigned students`);
        // ── Step 5: Choose this carload, seed and grow ──────
        //
        // This replaced a K-means pass seeded on every available driver's HOME.
        // That design needs drivers to be spread out, so that "the cluster
        // nearest me" is a meaningful share of the riders. Every driver in this
        // congregation lives within about two miles of the venue, so all K seeds
        // were effectively one point and which driver got which cluster was
        // decided by a near-tie at initialisation.
        //
        // It also cost a whole collection scan of `users` on every tap purely to
        // build those seeds. Seed-and-grow needs no driver query at all.
        //
        // The geo-fence stays: it is a limit on how far one volunteer is sent,
        // and is measured from the DRIVER because that is whose journey it bounds.
        const withinFence = allStudentPoints.filter(s => haversineDistanceMiles(tappingDriverLoc.lat, tappingDriverLoc.lng, s.lat, s.lng)
            <= GEO_FENCE_MILES);
        // Anchored on the rider farthest from the venue — remainders and
        // long-waiters first — then grown outward from that anchor by proximity.
        // See utils/carload.ts for why the farthest rider is the right anchor.
        const sortedStudents = (0, carload_1.orderForCarload)(withinFence, SABHA_LOCATION);
        console.log(`[globalAssign] ${withinFence.length} within fence, `
            + `seed=${(_j = (_h = sortedStudents[0]) === null || _h === void 0 ? void 0 : _h.name) !== null && _j !== void 0 ? _j : 'none'}`);
        // ── Step 7b: Fill by SEATS, not by head count ───────
        //
        // This was `sortedStudents.slice(0, availableSeats)` — one request, one
        // seat. A family of four was booked a single place and the driver turned
        // up with room for one.
        //
        // remaindersFirst puts the leftover of an already-split group ahead of
        // untouched requests. Without it, starting to serve a family drops their
        // remainder back into distance competition, so beginning to help them can
        // make them wait longer than a group nobody ever touched.
        const offerOrder = (0, seats_1.remaindersFirst)(sortedStudents);
        const { taken, skipped } = (0, seats_1.fillBySeats)(offerOrder.map(s => ({
            id: s.rideRequestId,
            seats: s.seats,
            allowSplit: s.allowSplit,
            isRemainder: s.isRemainder,
        })), availableSeats, maxFleetSeats);
        const offerMap = new Map(offerOrder.map(s => [s.rideRequestId, s]));
        const assignedStudents = taken.map(t => (Object.assign(Object.assign({}, offerMap.get(t.id)), { seatsTaken: t.seats, groupTotalSeats: t.totalSeats, wasSplit: t.split })));
        // Aggregated by reason, with no names or ids: a driver needs to know THAT
        // a larger group is waiting, not who they are. The per-rider detail
        // belongs on the manager's queue, which reads the ride documents directly.
        const waiting = Object.values(skipped.reduce((acc, s) => {
            var _a;
            const row = (_a = acc[s.reason]) !== null && _a !== void 0 ? _a : (acc[s.reason] = { reason: s.reason, groups: 0, seats: 0 });
            row.groups += 1;
            row.seats += s.seats;
            return acc;
        }, {}));
        if (assignedStudents.length === 0) {
            // Not always "nobody is waiting" any more: it can mean everyone waiting
            // needs a bigger vehicle than this one. Saying which is the difference
            // between a driver going home and a manager registering a larger car.
            return { status: 'no_students', waiting };
        }
        console.log(`[globalAssign] Assigning ${assignedStudents.length} requests, ` +
            `${taken.reduce((n, t) => n + t.seats, 0)} seats of ${availableSeats}`);
        // ── Step 8: Build RideStudents + route ──────────────
        const rideStudents = assignedStudents.map(s => {
            var _a;
            return (Object.assign(Object.assign({ 
                // The RIDER's uid. `s.id` is the ride document now that the pool is
                // keyed by request rather than by person — writing it here would send
                // every users/{uid} update to a document named after a ride.
                id: s.studentId, rideRequestId: s.rideRequestId, name: s.name, phone: s.phone, location: { lat: s.lat, lng: s.lng, address: s.address }, 
                // How many people this stop is for. The driver's screen shows it so
                // they do not pull away from an address with three of the party still
                // on the pavement.
                seats: s.seatsTaken }, (s.wasSplit || s.groupSeatsTotal
                ? { groupSeats: (_a = s.groupSeatsTotal) !== null && _a !== void 0 ? _a : s.groupTotalSeats }
                : {})), { status: 'assigned', picked: false }));
        });
        const startPoint = rideType === 'home-to-sabha'
            ? tappingDriverLoc
            : SABHA_LOCATION;
        const endPoint = rideType === 'home-to-sabha'
            ? SABHA_LOCATION
            : tappingDriverLoc;
        const route = (0, routing_1.optimizeRoute)(startPoint, rideStudents, endPoint, rideType);
        // Built HERE, before the batch, so it can be persisted with the ride.
        // It used to be built after the commit and returned only in the callable
        // response, so the fresh response had a working URL and the very next
        // Firestore snapshot replaced it with '' — the "Open in Google Maps"
        // button worked once and was dead from then on, silently.
        // Derived from `route`, so a drop-off run ends at the driver's home
        // rather than the venue they are already standing in.
        const googleMapsUrl = (0, routing_1.buildGoogleMapsNavigationUrl)(route);
        const estimatedDistance = rideStudents.length * 2; // ~2 mi per student
        const estimatedTime = rideStudents.length * 5; // ~5 min per student
        // ── Step 9: Atomic batch write ──────────────────────
        const batch = db.batch();
        const primaryRideId = assignedStudents[0].rideRequestId;
        const assignedStudentProfiles = assignedStudents.map(s => ({
            id: s.studentId,
            name: s.name,
            avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=FF6B35&color=fff`
        }));
        for (const s of assignedStudents) {
            const rideRef = db.collection('rides').doc(s.rideRequestId);
            const otherPeers = assignedStudentProfiles.filter(p => p.id !== s.studentId);
            batch.update(rideRef, {
                driverId,
                driverName: driverData.name || 'Driver',
                // The student's ride card reads the nested `driver` object and
                // does `if (!driver) return null` (RideStatus.tsx:35). Writing
                // only driverId meant that once a student was assigned, their
                // card rendered NOTHING — no driver name, no car, no plate.
                // driverId stays because the driver dashboard queries on it;
                // both shapes are needed until the model is unified.
                driver: {
                    id: driverId,
                    name: driverData.name || 'Driver',
                    phone: driverData.phone || '',
                    avatarUrl: driverData.avatarUrl
                        || `https://ui-avatars.com/api/?name=${encodeURIComponent(driverData.name || 'Driver')}&background=FF6B35&color=fff`,
                    carModel: carData.name || 'Vehicle',
                    carColor: carData.color || 'Unknown',
                    plateNumber: carData.licensePlate || '',
                },
                carId,
                carModel: carData.name || 'Vehicle',
                carColor: carData.color || 'Unknown',
                carLicensePlate: carData.licensePlate || '',
                rideType,
                status: 'assigned',
                route,
                googleMapsUrl,
                // Snapshot, not a live lookup. manualAssignStudent rebuilds the
                // route for ALL passengers when one is added; if it resolved the
                // venue live it could silently re-point everyone already on board
                // at a different venue. Also lets completeRide and
                // releaseAssignment stay consistent for free.
                venue: SABHA_LOCATION,
                eventId,
                peers: otherPeers,
                // The full roster. startRide, releaseAssignment and
                // manualAssignStudent all iterate `ride.students`; until this
                // was written they silently operated on an empty array, so
                // students were never marked in_ride, never returned to the
                // pool on release, and manual assignment threw on the spread.
                students: rideStudents,
                assignedStudentIds: assignedStudents.map(st => st.studentId),
                // What this car is actually carrying for this request. On a split
                // it is LESS than the rider asked for, and the sibling document
                // below holds the rest.
                seatsRequested: s.seatsTaken,
                groupId: s.wasSplit ? ((_k = s.groupId) !== null && _k !== void 0 ? _k : s.rideRequestId) : ((_l = s.groupId) !== null && _l !== void 0 ? _l : null),
                groupSeatsTotal: s.wasSplit
                    ? ((_m = s.groupSeatsTotal) !== null && _m !== void 0 ? _m : s.groupTotalSeats)
                    : ((_o = s.groupSeatsTotal) !== null && _o !== void 0 ? _o : null),
                estimatedDistance,
                estimatedTime,
                assignedAt: new Date().toISOString()
            });
            // ── The remainder of a split group ──────────────
            //
            // No single tap can commit a second driver, so a group too big for any
            // vehicle is served SEQUENTIALLY: this car takes what fits and the rest
            // goes straight back into the waiting pool as an ordinary request, for
            // whichever driver taps next. Written inside the same batch as the
            // assignment, so there is no instant where the seats have been taken
            // from the rider but not yet offered to anyone else.
            if (s.wasSplit) {
                // Against THIS request's size, not the party's original total.
                // A group of 8 against 3-seat cars splits more than once: the
                // second car is dividing a 5-seat remainder, and measuring that
                // against the original 8 would book 8-3=5 more seats instead of
                // 5-3=2 — inventing three people who do not exist and sending a
                // car for them, every round, for ever.
                const remainderSeats = s.groupTotalSeats - s.seatsTaken;
                if (remainderSeats > 0) {
                    const remainderRef = db.collection('rides').doc();
                    batch.set(remainderRef, {
                        studentId: s.studentId,
                        studentName: s.name,
                        studentPhone: s.phone,
                        date: s.date || eventId,
                        eventDate: s.date || eventId,
                        timeSlot: s.timeSlot,
                        pickupAddress: s.address,
                        pickupLat: s.lat,
                        pickupLng: s.lng,
                        notes: '',
                        status: 'requested',
                        rideType,
                        seatsRequested: remainderSeats,
                        allowSplit: s.allowSplit,
                        // Ties the pieces together so the rider's screen can say
                        // "3 of your 6 seats are with Ravi", the driver knows the
                        // stop is part of a larger party, and completion waits for
                        // the whole group rather than declaring the family home
                        // while half of them are still waiting.
                        groupId: (_p = s.groupId) !== null && _p !== void 0 ? _p : s.rideRequestId,
                        groupSeatsTotal: (_q = s.groupSeatsTotal) !== null && _q !== void 0 ? _q : s.groupTotalSeats,
                        splitFromRideId: s.rideRequestId,
                        cityId: tenancy_1.FOUNDING_CITY_ID,
                        locationId: tenancy_1.FOUNDING_LOCATION_ID,
                        createdAt: new Date().toISOString(),
                        peers: [],
                        isReadyToLeave: false,
                    });
                }
            }
            // Upsert student user profile (set+merge is safe even if doc doesn't exist)
            const studentRef = db.collection('users').doc(s.studentId);
            batch.set(studentRef, {
                status: 'assigned',
                currentRideId: s.rideRequestId
            }, { merge: true });
        }
        // Mark the car taken in BOTH collections. Writing only `cars` left
        // `vehicles` saying 'available', and useAvailableVehicles queries
        // `vehicles` — so the car a driver had just been assigned stayed in
        // every other driver's picker.
        (0, fleet_1.writeVehicleState)(batch, db, carId, {
            status: 'in_use',
            assignedDriverId: driverId,
            assignedDriverName: driverData.name || 'Driver',
        });
        // Upsert driver profile (set+merge is safe even if doc doesn't exist)
        batch.set(db.collection('users').doc(driverId), {
            status: 'assigned',
            activeRideId: primaryRideId,
            // currentVehicleId is canonical — it is what the client writes and
            // what the dashboard gates "Assign Me" on. This wrote only
            // currentCarId, so the two names described the same car and then
            // drifted apart on release. The legacy name is nulled here so it
            // can never be the stale one a later release path falls back to.
            currentVehicleId: carId,
            currentCarId: null,
            assignedStudentIds: assignedStudents.map(s => s.studentId)
        }, { merge: true });
        // Delete the lock in the same batch
        batch.delete(lockRef);
        await batch.commit();
        console.log('[globalAssign] Batch committed + lock released');
        // ── Step 10: Notifications (non-blocking) ───────────
        try {
            await (0, notifications_1.notifyDriverStudentsAssigned)((0, notifications_1.tokensOf)(driverId, driverData), rideStudents.length);
            // By rider, not by request: a rider holding two of this car's stops
            // should get one message, not two.
            for (const studentId of new Set(assignedStudents.map(s => s.studentId))) {
                const sDoc = await db.collection('users').doc(studentId).get();
                await (0, notifications_1.notifyStudentDriverAssigned)((0, notifications_1.tokensOf)(studentId, sDoc.data()));
            }
        }
        catch (notifErr) {
            console.error('[globalAssign] Notification error (non-fatal):', notifErr);
        }
        // ── Step 11: Build response ─────────────────────────
        const remainingUnassigned = allStudentPoints.length - assignedStudents.length;
        console.log(`[globalAssign] SUCCESS: ${assignedStudents.length} assigned, ${remainingUnassigned} remaining`);
        return {
            status: 'success',
            rideId: primaryRideId,
            students: rideStudents,
            route,
            estimatedDistance,
            estimatedTime,
            googleMapsUrl,
            car: {
                model: carData.name || 'Vehicle',
                color: carData.color || 'Unknown',
                licensePlate: carData.licensePlate || '',
                capacity: carData.capacity || 4
            },
            seatsTaken: assignedStudents.reduce((n, s) => n + s.seatsTaken, 0),
            availableSeats,
            // Why anyone nearer was passed over. Aggregated, no names.
            waiting,
            remainingUnassigned
        };
    }
    catch (error) {
        console.error('[globalAssign] ERROR:', error);
        // Always attempt to clean up the lock (lockRef is now in scope)
        try {
            await lockRef.delete();
            console.log('[globalAssign] Lock cleaned up after error');
        }
        catch (cleanupErr) {
            console.error('[globalAssign] Failed to clean lock:', cleanupErr);
        }
        if (error instanceof functions.https.HttpsError)
            throw error;
        if ((error === null || error === void 0 ? void 0 : error.code) === 'permission-denied') {
            throw new functions.https.HttpsError('permission-denied', 'Permission denied.');
        }
        throw new functions.https.HttpsError('internal', (error === null || error === void 0 ? void 0 : error.message) || 'Unexpected error during global assignment.');
    }
    finally {
        // Additional safety: ensure lock is always cleaned up
        // This runs after catch block, providing extra guarantee
        try {
            const lockStillExists = await lockRef.get();
            if (lockStillExists.exists && ((_r = lockStillExists.data()) === null || _r === void 0 ? void 0 : _r.driverId) === driverId) {
                await lockRef.delete();
                console.log('[globalAssign] Lock cleaned up in finally block');
            }
        }
        catch (finalCleanupErr) {
            console.error('[globalAssign] Failed to clean lock in finally:', finalCleanupErr);
        }
    }
});
//# sourceMappingURL=globalAssignDriver.js.map