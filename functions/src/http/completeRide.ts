// ============================================
// HTTP FUNCTION: completeRide
// Triggered when driver clicks "Complete Ride"
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { notifyStudentRideCompleted, tokensOf } from '../utils/notifications';
import { assertApprovedDriver } from '../utils/authz';
// The fleet helpers were imported here to release the car on every completed
// run. Nothing in this file touches the fleet any more — see the comment on the
// driver update below.
import { eventKeyFromRide } from '../utils/events';
import { getTimeZone } from '../utils/settings';
import { zonedDateKey } from '../utils/time';
import { seatsOf } from '../constants/seats';

/** A ride still owed to a rider. Used to hold their status while a split leg runs. */
const OPEN_RIDE_STATUSES = ['requested', 'assigned', 'driver_en_route', 'arriving', 'in_progress'];

/**
 * HTTP Callable: Complete a ride
 * Input: { rideId: string, absentStudentIds?: string[] }
 * Output: Driver's today stats
 *
 * WHO ACTUALLY TRAVELLED
 * ----------------------
 * A run is several ride documents, and this closes all of them together. Until
 * `absentStudentIds` existed it closed them *identically*, so a Bhulku who never
 * came out of the house was recorded as `completed` and marked `at_sabha` — a
 * plain lie on the manager's board, and the one that then let them request a lift
 * home from a sabha they never reached.
 *
 * The Sarthi confirms the roster at the venue and names anyone who did not
 * travel. Those riders' documents are `cancelled` with a `noShowAt` stamp, they
 * are left out of the seat counts and the attendance figures, they get no "you
 * have arrived" message, and their status says what happened instead of
 * pretending. Empty list — which is every normal night — behaves exactly as
 * before.
 *
 * Deliberately NOT re-dispatch: the roster never changes mid-run. Nobody's seat
 * goes back into the pool while a car is out, because a seat handed to somebody
 * else is a seat the Sarthi is still driving to collect.
 */
export const completeRide = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const driverUid = context.auth.uid;

    const { rideId, absentStudentIds } = data;

    if (!rideId) {
        throw new functions.https.HttpsError('invalid-argument', 'rideId is required');
    }

    // Loud, not lenient. A malformed list here would silently mean "everybody
    // travelled" — the exact wrong default, since it writes `at_sabha` for
    // children who are still at home.
    if (absentStudentIds !== undefined && !Array.isArray(absentStudentIds)) {
        throw new functions.https.HttpsError('invalid-argument', 'absentStudentIds must be an array of rider ids');
    }
    const absent = new Set<string>(
        (absentStudentIds ?? []).filter((id: unknown): id is string => typeof id === 'string' && id !== '')
    );

    const db = admin.firestore();

    // OWNERSHIP IS NOT AUTHORISATION.
    //
    // This checked only that the caller was the Sarthi named on the ride, so a
    // REVOKED account whose name still sat on a document could complete rides —
    // which writes statistics, releases the vehicle, moves driver counters and sets
    // every passenger's status. Revoking did not reach any of it. `sarthiArrived`
    // already noted the gap: "Stricter than startRide/completeRide, which check
    // ownership only."
    //
    // Before the ride read, so nothing is fetched for a caller with no business here.
    await assertApprovedDriver(db, driverUid, 'complete a ride');

    try {
        // Get ride details
        const rideDoc = await db.collection('rides').doc(rideId).get();
        if (!rideDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Ride not found');
        }

        const ride = rideDoc.data();

        // Verify the caller is the driver assigned to this ride
        const targetDriverId = ride?.driverId || ride?.driver?.id;
        if (targetDriverId !== driverUid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the assigned Sarthi can complete this ride');
        }

        // Check ride status - allow assigned, in_progress, driver_en_route, arriving
        const validStatuses = ['assigned', 'in_progress', 'driver_en_route', 'arriving'];
        if (!validStatuses.includes(ride?.status)) {
            throw new functions.https.HttpsError('failed-precondition', `Ride status '${ride?.status}' cannot be completed`);
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
        const eventDate = eventKeyFromRide(ride)
            ?? zonedDateKey(new Date(), await getTimeZone());

        // Find ALL active rides for this driver to complete all documents in multi-student grouped rides
        const activeRidesSnap = await db.collection('rides')
            .where('driverId', '==', driverUid)
            .where('status', 'in', ['assigned', 'in_progress', 'driver_en_route', 'arriving'])
            .get();

        const allStudentsMap = new Map<string, any>();
        /** Named as absent AND actually on one of these rides. */
        const absentStudentsMap = new Map<string, any>();
        /** The rides this call is closing, so a rider's OTHER open rides stand out. */
        const completingRideIds = new Set(activeRidesSnap.docs.map(d => d.id));

        for (const doc of activeRidesSnap.docs) {
            const data = doc.data();

            /** Every rider named on this document, however they are recorded. */
            const riders: Array<{ id: string; name: string; seats: number }> = [];
            if (data.studentId) {
                riders.push({
                    id: data.studentId,
                    name: data.studentName || 'Student',
                    // People carried, not documents closed. Absent means one.
                    seats: seatsOf(data),
                });
            }
            if (Array.isArray(data.students)) {
                for (const s of data.students) {
                    riders.push({
                        id: s.id,
                        name: s.name || 'Student',
                        seats: seatsOf({ seatsRequested: s.seats }),
                    });
                }
            }

            for (const rider of riders) {
                (absent.has(rider.id) ? absentStudentsMap : allStudentsMap).set(rider.id, rider);
            }

            // A document is only a no-show if NOBODY on it travelled. A car that
            // collected two of a family of three still completed that ride.
            const nobodyTravelled = riders.length > 0 && riders.every(r => absent.has(r.id));
            batch.update(doc.ref, nobodyTravelled
                ? { status: 'cancelled', noShowAt: now }
                : { status: 'completed', completedAt: now });
        }

        const allStudents = Array.from(allStudentsMap.values());
        const absentStudents = Array.from(absentStudentsMap.values());

        // Update driver stats and release vehicle
        const driverDoc = await db.collection('users').doc(driverUid).get();
        const driver = driverDoc.data();
        const newRidesCompleted = (driver?.ridesCompletedToday || 0) + 1;
        // Seats carried, not rows closed. A driver who took a family of four had
        // this read 1, so their day's tally — and the manager's — undercounted
        // every group they moved.
        const seatsCarried = allStudents.reduce((n, s) => n + (s.seats || 1), 0);
        // The `ride.students.length || 1` tail is the fallback for a ride with no
        // usable roster, and it must not fire when the Sarthi HAS given us one:
        // a run where nobody came out counts nobody, rather than falling back to
        // the roster it was told to disregard.
        const newTotalStudents = (driver?.totalStudentsToday || 0)
            + (seatsCarried || (absent.size > 0 ? 0 : (ride?.students?.length || 1)));
        const newTotalDistance = (driver?.totalDistanceToday || 0) + (ride?.estimatedDistance || 0);

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
        const newStudentStatus = ride?.rideType === 'home-to-sabha' ? 'at_sabha' : 'home_safe';

        /**
         * Where a no-show actually is.
         *
         * On the way to sabha they never left home — `missed_pickup`, a status
         * this app has declared and labelled since the beginning and never once
         * written. On the way back they are still standing at the venue, so
         * `at_sabha` is the literal truth and leaves them able to ask for another
         * lift home, which is exactly what somebody who missed their car needs.
         *
         * Neither is `home_safe`. That is the whole point.
         */
        const noShowStatus = ride?.rideType === 'home-to-sabha' ? 'missed_pickup' : 'at_sabha';

        /**
         * WHICH HALL THE RIDER IS STANDING IN, recorded beside `at_sabha`.
         *
         * `at_sabha` has always been a bare string. With one venue that was enough;
         * with two it answers "they are at a sabha" and cannot say which — and the
         * return leg is the one place that has to know, because a drop-off request
         * carries the rider's HOME coordinates and nothing about where they are being
         * collected FROM. Without this, a Sarthi leaving Hall A could be handed riders
         * standing at Hall B and no field on the request would catch it.
         *
         * Written on BOTH branches. A rider who missed their car home is correctly left
         * `at_sabha` — they are still standing there — and losing their hall would
         * strand exactly the person who most needs another lift.
         *
         * `null` rather than omitted when the ride does not say, so the field is
         * cleared rather than left holding last week's hall. Cleared for real by
         * `clearEndOfEveningStatuses`, alongside the status it belongs to.
         */
        const atLocationId = typeof ride?.locationId === 'string' ? ride.locationId : null;

        /**
         * Has this rider got another leg still running?
         *
         * A group too large for one car is split across cars, so a rider can
         * still have a leg outstanding when this one finishes. Writing a final
         * status then would be a lie on the manager's screen — and clearing
         * currentRideId would cut their remaining half loose.
         *
         * Single-field query filtered in memory, matching studentReadyToLeave:
         * adding `status` would need a rides(studentId, status) composite.
         */
        const stillTravellingElsewhere = async (studentId: string): Promise<boolean> => {
            const theirRides = await db.collection('rides')
                .where('studentId', '==', studentId)
                .get();
            return theirRides.docs.some(d =>
                !completingRideIds.has(d.id) && OPEN_RIDE_STATUSES.includes(d.data()?.status));
        };

        // Riders the Sarthi says did not travel. Status corrected, ride already
        // cancelled above, and pointedly NO "you have arrived" message.
        for (const student of absentStudents) {
            if (await stillTravellingElsewhere(student.id)) {
                console.log(`[completeRide] ${student.id} did not travel on this leg but has another open — status held`);
                continue;
            }
            console.log(`[completeRide] ${student.id} recorded as a no-show`);
            batch.update(db.collection('users').doc(student.id), {
                status: noShowStatus,
                // Only meaningful when the status says they are at a sabha. Cleared
                // otherwise so a missed pickup does not leave a hall behind.
                atLocationId: noShowStatus === 'at_sabha' ? atLocationId : null,
                currentRideId: null
            });
        }

        // Update students status and notify
        for (const student of allStudents) {
            if (await stillTravellingElsewhere(student.id)) {
                console.log(`[completeRide] ${student.id} has another leg open — status held`);
                continue;
            }

            batch.update(db.collection('users').doc(student.id), {
                status: newStudentStatus,
                atLocationId: newStudentStatus === 'at_sabha' ? atLocationId : null,
                currentRideId: null
            });

            // Send notification to student
            try {
                const studentDoc = await db.collection('users').doc(student.id).get();
                await notifyStudentRideCompleted(tokensOf(student.id, studentDoc.data()));
            } catch (notifError) {
                console.error('Error sending notification to student:', student.id, notifError);
            }
        }

        // Safe student list construction for statistics
        // Filtered, not raw: an attendance row for somebody who never got in the
        // car is the same lie one layer down, and generateEventCSV reads it.
        const rosterStudents = (Array.isArray(ride?.students) && ride.students.length > 0)
            ? ride.students.filter((s: any) => !absent.has(s?.id))
            : (allStudents.length > 0
                ? allStudents
                : (ride?.studentId && !absent.has(ride.studentId)
                    ? [{ id: ride.studentId, name: ride.studentName || 'Student' }]
                    : []));

        const rideStudents: Array<Record<string, any>> = rosterStudents.map((s: any) => ({
            id: s.id || '',
            name: s.name || 'Student',
            // Carried onto the attendance row so the sabha's headcount is people,
            // not accounts. One rider bringing three is one row and three seats.
            seats: s.seats ?? seatsOf({ seatsRequested: s.seatsRequested }),
            driverId: driverUid,
            driverName: ride?.driverName || ride?.driver?.name || 'Driver',
            carModel: ride?.carModel || '',
            carLicensePlate: ride?.carLicensePlate || ''
        }));

        // Update statistics for the event using set + merge to prevent nested dot notation errors
        const statsRef = db.collection('statistics').doc(eventDate);
        const statsDoc = await statsRef.get();
        const isPickup = ride?.rideType === 'home-to-sabha';
        const statsKey = isPickup ? 'pickup' : 'dropoff';

        const stats = statsDoc.exists ? (statsDoc.data() || {}) : {};
        const currentBlock = stats[statsKey] || { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] };

        const existingStudentIds = new Set((currentBlock.students || []).map((s: any) => s.id));
        const newStudents = rideStudents.filter(s => !existingStudentIds.has(s.id));
        const deduplicatedStudents = [...(currentBlock.students || []), ...newStudents];

        const updatedBlock = {
            // Sum of seats, not a row count. The rows are still de-duplicated by
            // rider above, so a rider who travelled in two cars appears once and
            // contributes each leg's seats — never counted twice as a person.
            totalStudents: deduplicatedStudents.reduce(
                (n: number, s: any) => n + (Number(s.seats) || 1), 0),
            completedRides: (currentBlock.completedRides || 0) + 1,
            totalDrivers: Math.max(1, (currentBlock.totalDrivers || 0) + 1),
            students: deduplicatedStudents
        };

        batch.set(statsRef, {
            eventDate,
            [statsKey]: updatedBlock,
            ...(statsDoc.exists ? {} : {
                [isPickup ? 'dropoff' : 'pickup']: { totalStudents: 0, completedRides: 0, totalDrivers: 0, students: [] },
                attendance: { both: 0, pickupOnly: 0, dropoffOnly: 0 }
            })
        }, { merge: true });

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

    } catch (error) {
        console.error('Error completing ride:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to complete ride');
    }
});
