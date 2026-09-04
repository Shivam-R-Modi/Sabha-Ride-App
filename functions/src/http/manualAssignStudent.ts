// ============================================
// HTTP FUNCTION: manualAssignStudent
// Triggered when manager manually assigns student
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Student, Driver, Ride, RideStudent, RideType } from '../types';
import { optimizeRoute, calculateRouteStats } from '../utils/routing';
import { notifyStudentDriverAssigned, tokensOf } from '../utils/notifications';
import { getSabhaLocation, resolveVenue, getLocation } from '../utils/settings';
import { rejectionFor } from '../utils/ridePool';
import { eventKeyFromRide } from '../utils/events';
import { assertApprovedManager } from '../utils/authz';
import { seatsOf } from '../constants/seats';

/**
 * HTTP Callable: Manually assign student to a driver's active ride
 * Input: { studentId: string, driverId: string }
 * Output: Updated ride details
 */
export const manualAssignStudent = functions.https.onCall(async (data, context) => {
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
        await assertApprovedManager(db, context.auth.uid, 'manually assign students');

        // Get student details
        const studentDoc = await db.collection('users').doc(studentId).get();
        if (!studentDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Student not found');
        }
        const student = { id: studentDoc.id, ...studentDoc.data() } as Student;

        // Check student is waiting
        const waitingStatuses = ['waiting_for_pickup', 'waiting_for_dropoff', 'requested', 'assigned'];
        if (!waitingStatuses.includes(student.status)) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Bhulku is not waiting for assignment'
            );
        }

        // Get driver details
        const driverDoc = await db.collection('users').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Sarthi not found');
        }
        const driver = { id: driverDoc.id, ...driverDoc.data() } as Driver;

        // Get active ride for driver
        const activeRideSnap = await db.collection('rides')
            .where('driverId', '==', driverId)
            .where('status', 'in', ['assigned', 'driver_en_route', 'arriving', 'in_progress'])
            .get();

        if (activeRideSnap.empty) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Sarthi does not have an active ride'
            );
        }
        /**
         * ONE CARLOAD, ONE HALL — checked rather than assumed.
         *
         * `docs[0]` was taken arbitrarily, and that was harmless while every active
         * ride a Sarthi holds belongs to the same carload: `globalAssignDriver` writes
         * one document per rider and they all share the car, the route and the venue.
         *
         * With two halls that assumption is worth verifying rather than trusting,
         * because if it ever fails the consequence is a rider added to a run going to
         * the wrong building. A Sarthi holding active rides for two halls is already a
         * broken state; saying so is more use than silently picking one.
         */
        const activeHalls = new Set(
            activeRideSnap.docs
                .map(d => d.data()?.locationId)
                .filter((id): id is string => typeof id === 'string'),
        );
        if (activeHalls.size > 1) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'That Sarthi is holding runs for more than one sabha location. '
                + 'Please complete or release one before adding anybody.',
            );
        }

        const rideDoc = activeRideSnap.docs[0];
        const ride = { id: rideDoc.id, ...rideDoc.data() } as Ride;

        // Get car/vehicle details for capacity check
        let capacity = (driver as any).capacity || 4;
        if (ride.carId) {
            const vehicleDoc = await db.collection('vehicles').doc(ride.carId).get();
            if (vehicleDoc.exists) {
                capacity = vehicleDoc.data()?.capacity || capacity;
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

        /**
         * THE RIDER'S REQUEST FOR *THIS* RUN, not just any request they happen to hold.
         *
         * This used to be `.find(r => r.status === 'requested')` — no gathering, no
         * direction, no hall. So a leftover request from a previous sabha, or a pickup
         * request while a drop-off run was being built, or (once there are two halls)
         * a request for the OTHER hall would all satisfy it, and the rider would be
         * added to this car anyway with that request's seat count.
         *
         * Today the visible cost is a wrong seat count. With two halls a manager
         * tapping a button that already exists puts a Hall B rider into a Hall A car —
         * no race, no bad actor, and the one invariant the whole multi-hall design
         * exists to protect. It is the only path that breaks it through ordinary use.
         *
         * `rejectionFor` is the same predicate dispatch uses, so the manual path and
         * the automatic one cannot disagree about who belongs in a car.
         */
        const expectation = {
            eventKey: eventKeyFromRide(ride),
            rideType: (ride.rideType ?? 'home-to-sabha') as RideType,
            locationId: typeof ride.locationId === 'string' ? ride.locationId : null,
            // The car already exists and names its hall, so an unstamped request can be
            // taken at its word here regardless of how many halls are open — it is
            // being added to a specific run, not matched against an ambiguous pool.
            singleActiveLocation: true,
        };
        const waitingRequest = myRidesSnap.docs
            .map(d => d.data())
            .find(r => r.status === 'requested' && rejectionFor(r, expectation) === null);

        if (!waitingRequest) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'That Bhulku has no waiting request for this run. They may have asked '
                + 'for a different sabha, a different direction, or another evening.',
            );
        }
        const seatsNeeded = seatsOf(waitingRequest);

        // Check capacity (capacity - 1 for driver seat).
        //
        // This counted ENTRIES — `existingStudents.length >= availableSeats` —
        // so a car already carrying a family of three looked like it held one
        // passenger, and a manager could keep adding riders to a full vehicle.
        const availableSeats = Math.max(1, capacity - 1);
        const existingStudents = ride.students || [];
        const seatsTaken = existingStudents.reduce((n, s) => n + seatsOf({ seatsRequested: s.seats }), 0);
        const seatsFree = availableSeats - seatsTaken;

        if (seatsNeeded > seatsFree) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                seatsFree <= 0
                    ? `Vehicle is full (${availableSeats} seats, driver takes 1).`
                    : `Not enough room: this rider needs ${seatsNeeded} seat${seatsNeeded === 1 ? '' : 's'} and ${seatsFree} ${seatsFree === 1 ? 'is' : 'are'} free.`
            );
        }

        // Add student to ride
        const newStudent: RideStudent = {
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
        /**
         * The ride's own snapshot first, then ITS HALL, then settings/main.
         *
         * The snapshot is still preferred for the reason above. The fallback is now the
         * ride's own hall rather than the global default: a ride with no snapshot —
         * written before venues existed, or hand-made in the Raw records console —
         * would otherwise be routed to whichever venue `settings/main` currently
         * names, which is the wrong building as soon as the ride belongs to another
         * hall.
         */
        const hall = typeof ride.locationId === 'string'
            ? await getLocation(ride.locationId, db)
            : null;
        const sabhaLocation = resolveVenue(
            ride.venue,
            resolveVenue(hall?.venue, await getSabhaLocation()),
        );
        const startPoint = ride.rideType === 'home-to-sabha'
            ? (driver.currentLocation || sabhaLocation)
            : sabhaLocation;
        const endPoint = ride.rideType === 'home-to-sabha'
            ? sabhaLocation
            : (driver.homeLocation || sabhaLocation);

        const newRoute = optimizeRoute(startPoint, updatedStudents, endPoint, ride.rideType);
        const { distance, time } = calculateRouteStats(newRoute);

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
            await notifyStudentDriverAssigned(tokensOf(studentDoc.id, studentDoc.data()));
        } catch (notifError) {
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

    } catch (error) {
        console.error('Error manually assigning student:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to assign Bhulku');
    }
});
