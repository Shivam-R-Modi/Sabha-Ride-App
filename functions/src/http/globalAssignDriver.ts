// ============================================
// HTTP FUNCTION: globalAssignDriver  (Approach B)
// Re-clusters ALL unassigned students every time a driver
// taps "Assign Me". A Firestore-based lock prevents races.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { RideType, RideStudent } from '../types';
import { kMeansWithDriverSeeds, LightPoint } from '../utils/clustering';
import { fillBySeats, remaindersFirst, maxPassengerSeats } from '../utils/seats';
import { seatsOf } from '../constants/seats';
import { FOUNDING_CITY_ID, FOUNDING_LOCATION_ID } from '../constants/tenancy';
import { optimizeRoute, buildGoogleMapsNavigationUrl } from '../utils/routing';
import { resolveHomeCoords } from '../utils/coords';
import { writeVehicleState, resolveVehicleHolder } from '../utils/fleet';
import { notifyStudentDriverAssigned, notifyDriverStudentsAssigned } from '../utils/notifications';
import { getSabhaLocation, resolveVenue } from '../utils/settings';
import { checkRateLimit } from '../utils/rateLimiter';

// ── constants ──────────────────────────────────────────────
const LOCK_DOC = 'system/assignmentLock';
const LOCK_TTL_MS = 10_000;          // 10 seconds
const GEO_FENCE_MILES = 15;          // ignore students > 15 mi away

// ── helpers ────────────────────────────────────────────────

/** Haversine distance in miles */
function haversineDistanceMiles(
    lat1: number, lng1: number,
    lat2: number, lng2: number
): number {
    const R = 3959;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/** Check if a pending ride has valid GPS */
function isValidPendingRide(docData: any): boolean {
    const lat = docData.pickupLat ?? 0;
    const lng = docData.pickupLng ?? 0;
    if (typeof lat !== 'number' || typeof lng !== 'number') return false;
    if (isNaN(lat) || isNaN(lng)) return false;
    if (lat === 0 && lng === 0) return false;
    if (!docData.studentId) return false;
    return true;
}

// ── main function ──────────────────────────────────────────

export const globalAssignDriver = functions.https.onCall(async (data, context) => {
    // Auth check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Rate limiting: 10 requests per minute
    await checkRateLimit(context.auth.uid, {
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
        throw new functions.https.HttpsError(
            'permission-denied',
            'A driver can only request an assignment for themselves.',
        );
    }

    const db = admin.firestore();

    // ── Step 1: Acquire lock ────────────────────────────────
    // Define lockRef at function scope so it's accessible in error handler
    const lockRef = db.doc(LOCK_DOC);

    try {
        const lockSnap = await lockRef.get();

        if (lockSnap.exists) {
            const lockData = lockSnap.data();
            const lockAge = Date.now() - (lockData?.timestamp ?? 0);
            if (lockAge < LOCK_TTL_MS) {
                console.log(`[globalAssign] LOCKED by ${lockData?.driverId}, age=${lockAge}ms`);
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
        if (!rideContext?.rideType) {
            throw new functions.https.HttpsError('failed-precondition', 'No rides are available at this time.');
        }
        const rideType = rideContext.rideType as RideType;

        // The venue for THIS gathering. Taken from the same rideContext document
        // that produced the rideType above, so the two can never disagree — a
        // separate read of events/{id} would leave a window where the route's
        // venue and the window's venue came from different resolutions.
        // Falls back to settings/main, which is what ran before events had venues.
        const SABHA_LOCATION = resolveVenue(rideContext.venue, await getSabhaLocation());
        const eventId: string | null = rideContext.eventId ?? null;

        console.log(`[globalAssign] rideType=${rideType}, venue=${SABHA_LOCATION.address}`);

        // ── Step 3: Tapping driver + car ────────────────────
        const driverDoc = await db.collection('users').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver profile not found.');
        }
        const driverData = driverDoc.data()!;

        const carDoc = await db.collection('cars').doc(carId).get();
        if (!carDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Vehicle not found.');
        }
        const carData = carDoc.data()!;

        if (carData.status !== 'available' && carData.status !== 'in_use') {
            throw new functions.https.HttpsError('failed-precondition', `Vehicle is ${carData.status}.`);
        }
        // The guard used to read carData.currentDriverId. Nothing writes that
        // field — every writer, client and server, sets assignedDriverId — so
        // this compared undefined against a uid and passed every single time.
        // Two drivers could hold the same car.
        const currentHolder = resolveVehicleHolder(carData);
        if (carData.status === 'in_use' && currentHolder && currentHolder !== driverId) {
            throw new functions.https.HttpsError('failed-precondition', 'Vehicle is assigned to another driver.');
        }

        const availableSeats = Math.max(1, (carData.capacity || 4) - 1);

        // The largest vehicle the fleet HAS, which decides whether a group too big
        // for this car should wait for a bigger one or be split across several.
        // Read live rather than cached: a stale value silently splits families who
        // could have travelled together, or strands ones who cannot.
        const fleetSnap = await db.collection('vehicles').get();
        const maxFleetSeats = maxPassengerSeats(fleetSnap.docs.map(d => d.data()?.capacity));
        // resolveHomeCoords tolerates every shape the codebase writes
        // ({lat,lng} and {latitude,longitude}, under `location` or
        // `homeLocation`) and rejects the 0,0 placeholder that means "address
        // never geocoded". Reading it by hand here — and raw at the endPoint
        // below — was how a driver with only {latitude,longitude} ended up with
        // an undefined `.lat` poisoning the route and every URL built from it.
        const tappingDriverLoc = resolveHomeCoords(driverData);
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
        const requestMap = new Map<string, LightPoint & {
            rideRequestId: string;
            studentId: string;
            name: string;
            phone: string;
            address: string;
            seats: number;
            allowSplit: boolean;
            isRemainder: boolean;
            groupId: string | null;
            groupSeatsTotal: number | null;
            date: string;
            timeSlot: string;
        }>();

        for (const doc of ridesSnap.docs) {
            const d = doc.data();
            if (!isValidPendingRide(d)) continue;
            requestMap.set(doc.id, {
                id: doc.id,
                rideRequestId: doc.id,
                studentId: d.studentId,
                name: d.studentName || 'Student',
                phone: d.studentPhone || '',
                lat: d.pickupLat,
                lng: d.pickupLng,
                address: d.pickupAddress || 'Unknown',
                seats: seatsOf(d),
                allowSplit: d.allowSplit !== false,
                isRemainder: !!d.groupId,
                groupId: d.groupId ?? null,
                groupSeatsTotal: d.groupSeatsTotal ?? null,
                // Carried so a split remainder is filed against the same gathering
                // as the request it came from, rather than being re-derived.
                date: d.date ?? d.eventDate ?? '',
                timeSlot: d.timeSlot ?? '',
            });
        }

        const allStudentPoints = Array.from(requestMap.values());

        if (allStudentPoints.length === 0) {
            return { status: 'no_students' };
        }

        console.log(`[globalAssign] ${allStudentPoints.length} unassigned students`);

        // ── Step 5: All remaining available drivers ──────────
        //
        // This queried `activeRole == 'driver'`, which matched NOBODY. activeRole
        // is listed in touchesPrivilegeFields() in firestore.rules, so a user
        // cannot write it: the RoleSwitcher only changes React state and the
        // stored value stays frozen at whatever signup wrote. Measured against
        // production, this query returned zero rows every time, so every dispatch
        // ran K=1 and the tapping driver was handed every rider in range instead
        // of the nearest share of them. The clustering below was seeded with one
        // point and did nothing.
        //
        // `roles` is now the GRANTED set — a manager may act as a driver, which in
        // this congregation is how every driver is recorded — so one query serves
        // it with no special case. `accountStatus` is checked because a revoked
        // account must not be handed riders.
        const driversSnap = await db.collection('users')
            .where('roles', 'array-contains', 'driver')
            .where('accountStatus', '==', 'approved')
            .where('status', '==', 'available')
            .get();

        // Build driver points (always include tapping driver)
        const driverPointsMap = new Map<string, LightPoint>();

        // Add the tapping driver first
        driverPointsMap.set(driverId, {
            id: driverId,
            lat: tappingDriverLoc.lat,
            lng: tappingDriverLoc.lng
        });

        // Add other available drivers
        for (const doc of driversSnap.docs) {
            if (doc.id === driverId) continue; // already added
            const loc = resolveHomeCoords(doc.data());
            if (loc) {
                driverPointsMap.set(doc.id, { id: doc.id, lat: loc.lat, lng: loc.lng });
            }
        }

        const driverPoints = Array.from(driverPointsMap.values());
        console.log(`[globalAssign] K=${driverPoints.length} drivers for clustering`);

        // ── Step 6: Run K-means ─────────────────────────────
        const clusters = kMeansWithDriverSeeds(allStudentPoints, driverPoints);

        // Find the tapping driver's cluster
        let myCluster = clusters.find(c => c.driverId === driverId);

        // Fallback: if tapping driver's cluster is empty (all students
        // were closer to other drivers), fall back to greedy — sort all
        // unassigned students by distance to this driver.
        if (!myCluster || myCluster.students.length === 0) {
            console.log('[globalAssign] Empty cluster for tapping driver — greedy fallback');
            myCluster = {
                driverId,
                centroid: { lat: tappingDriverLoc.lat, lng: tappingDriverLoc.lng },
                students: [...allStudentPoints] // consider all
            };
        }

        console.log(`[globalAssign] Cluster has ${myCluster.students.length} students`);

        // ── Step 7: Sort by distance + apply geo-fence ──────
        const studentPointMap = new Map(allStudentPoints.map(sp => [sp.id, sp]));
        const sortedStudents = myCluster.students
            .map(s => {
                const studentFull = studentPointMap.get(s.id)!;
                const dist = haversineDistanceMiles(
                    tappingDriverLoc.lat, tappingDriverLoc.lng,
                    s.lat, s.lng
                );
                return { ...studentFull, distMi: dist };
            })
            .filter(s => s.distMi <= GEO_FENCE_MILES)
            .sort((a, b) => a.distMi - b.distMi);

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
        const offerOrder = remaindersFirst(sortedStudents);
        const { taken, skipped } = fillBySeats(
            offerOrder.map(s => ({
                id: s.rideRequestId,
                seats: s.seats,
                allowSplit: s.allowSplit,
                isRemainder: s.isRemainder,
            })),
            availableSeats,
            maxFleetSeats,
        );

        const offerMap = new Map(offerOrder.map(s => [s.rideRequestId, s]));
        const assignedStudents = taken.map(t => ({
            ...offerMap.get(t.id)!,
            seatsTaken: t.seats,
            groupTotalSeats: t.totalSeats,
            wasSplit: t.split,
        }));

        // Aggregated by reason, with no names or ids: a driver needs to know THAT
        // a larger group is waiting, not who they are. The per-rider detail
        // belongs on the manager's queue, which reads the ride documents directly.
        const waiting = Object.values(
            skipped.reduce((acc: Record<string, { reason: string; groups: number; seats: number }>, s) => {
                const row = acc[s.reason] ?? (acc[s.reason] = { reason: s.reason, groups: 0, seats: 0 });
                row.groups += 1;
                row.seats += s.seats;
                return acc;
            }, {}),
        );

        if (assignedStudents.length === 0) {
            // Not always "nobody is waiting" any more: it can mean everyone waiting
            // needs a bigger vehicle than this one. Saying which is the difference
            // between a driver going home and a manager registering a larger car.
            return { status: 'no_students', waiting };
        }

        console.log(`[globalAssign] Assigning ${assignedStudents.length} requests, ` +
                    `${taken.reduce((n, t) => n + t.seats, 0)} seats of ${availableSeats}`);

        // ── Step 8: Build RideStudents + route ──────────────
        const rideStudents: RideStudent[] = assignedStudents.map(s => ({
            // The RIDER's uid. `s.id` is the ride document now that the pool is
            // keyed by request rather than by person — writing it here would send
            // every users/{uid} update to a document named after a ride.
            id: s.studentId,
            rideRequestId: s.rideRequestId,
            name: s.name,
            phone: s.phone,
            location: { lat: s.lat, lng: s.lng, address: s.address },
            // How many people this stop is for. The driver's screen shows it so
            // they do not pull away from an address with three of the party still
            // on the pavement.
            seats: s.seatsTaken,
            // Spread rather than `groupSeats: … : undefined`. The Admin SDK is
            // not configured with ignoreUndefinedProperties, so an undefined
            // value anywhere in this array makes the whole batch throw — which
            // would have broken every assignment, split or not, while the fake
            // Firestore in the tests accepted it happily.
            ...(s.wasSplit || s.groupSeatsTotal
                ? { groupSeats: s.groupSeatsTotal ?? s.groupTotalSeats }
                : {}),
            status: 'assigned' as const,
            picked: false
        }));

        const startPoint = rideType === 'home-to-sabha'
            ? tappingDriverLoc
            : SABHA_LOCATION;
        const endPoint = rideType === 'home-to-sabha'
            ? SABHA_LOCATION
            : tappingDriverLoc;

        const route = optimizeRoute(startPoint, rideStudents, endPoint, rideType);

        // Built HERE, before the batch, so it can be persisted with the ride.
        // It used to be built after the commit and returned only in the callable
        // response, so the fresh response had a working URL and the very next
        // Firestore snapshot replaced it with '' — the "Open in Google Maps"
        // button worked once and was dead from then on, silently.
        // Derived from `route`, so a drop-off run ends at the driver's home
        // rather than the venue they are already standing in.
        const googleMapsUrl = buildGoogleMapsNavigationUrl(route);

        const estimatedDistance = rideStudents.length * 2; // ~2 mi per student
        const estimatedTime = rideStudents.length * 5;     // ~5 min per student

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
                groupId: s.wasSplit ? (s.groupId ?? s.rideRequestId) : (s.groupId ?? null),
                groupSeatsTotal: s.wasSplit
                    ? (s.groupSeatsTotal ?? s.groupTotalSeats)
                    : (s.groupSeatsTotal ?? null),
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
                        groupId: s.groupId ?? s.rideRequestId,
                        groupSeatsTotal: s.groupSeatsTotal ?? s.groupTotalSeats,
                        splitFromRideId: s.rideRequestId,
                        cityId: FOUNDING_CITY_ID,
                        locationId: FOUNDING_LOCATION_ID,
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
        writeVehicleState(batch, db, carId, {
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
            const driverFcmToken = driverData.fcmToken;
            if (driverFcmToken) {
                await notifyDriverStudentsAssigned(driverFcmToken, rideStudents.length);
            }
            // By rider, not by request: a rider holding two of this car's stops
            // should get one message, not two.
            for (const studentId of new Set(assignedStudents.map(s => s.studentId))) {
                const sDoc = await db.collection('users').doc(studentId).get();
                const sToken = sDoc.data()?.fcmToken;
                if (sToken) {
                    await notifyStudentDriverAssigned(
                        sToken,
                        driverData.name || 'Driver',
                        carData.name || 'Vehicle',
                        carData.color || ''
                    );
                }
            }
        } catch (notifErr) {
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

    } catch (error: unknown) {
        console.error('[globalAssign] ERROR:', error);

        // Always attempt to clean up the lock (lockRef is now in scope)
        try {
            await lockRef.delete();
            console.log('[globalAssign] Lock cleaned up after error');
        } catch (cleanupErr) {
            console.error('[globalAssign] Failed to clean lock:', cleanupErr);
        }

        if (error instanceof functions.https.HttpsError) throw error;

        if ((error as any)?.code === 'permission-denied') {
            throw new functions.https.HttpsError('permission-denied', 'Permission denied.');
        }

        throw new functions.https.HttpsError(
            'internal',
            (error as any)?.message || 'Unexpected error during global assignment.'
        );
    } finally {
        // Additional safety: ensure lock is always cleaned up
        // This runs after catch block, providing extra guarantee
        try {
            const lockStillExists = await lockRef.get();
            if (lockStillExists.exists && lockStillExists.data()?.driverId === driverId) {
                await lockRef.delete();
                console.log('[globalAssign] Lock cleaned up in finally block');
            }
        } catch (finalCleanupErr) {
            console.error('[globalAssign] Failed to clean lock in finally:', finalCleanupErr);
        }
    }
});
