// ============================================
// SCHEDULED FUNCTION: releaseIdleVehicles
// Hands back cars nobody is actually driving.
// ============================================

/**
 * The backstop for a fleet that leaks.
 *
 * A vehicle becomes `in_use` the moment a driver picks it — before any rider is
 * assigned — and is only freed by a deliberate `driverDoneForToday`,
 * `completeRide` or `releaseAssignment`. So a driver who closes the tab, loses
 * signal, or simply forgets holds that car indefinitely. There was no timeout, no
 * sweep, and no manager control: the only escapes were deleting and recreating the
 * vehicle, or hand-editing the database.
 *
 * Measured in production on 2026-08-14: **all three cars in the fleet** were
 * `in_use` with no active rides and had been for up to nine days, so the driver's
 * car picker was empty and nobody could start a shift at all.
 *
 * The permanent fixes for the *causes* are elsewhere — `adminDeleteUser` now
 * releases what a deleted account held, and Phase 3 gives managers a Release
 * button. This function exists so that a cause nobody predicted still cannot
 * strand the fleet for nine days.
 *
 * THE RULE THAT MATTERS
 * ---------------------
 * **A car with a live ride is never touched.** Releasing it mid-run would make
 * the driver's screen disagree with their passengers, and stranding a driver
 * halfway through a Friday-night run with children aboard is a worse failure than
 * any number of cars stuck overnight. Every branch below is written to fail
 * towards leaving a car held.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { DEFAULT_TIME_ZONE } from '../utils/time';
import { writeAuditLog } from '../utils/audit';
import {
    writeVehicleState, resolveVehicleHolder, VEHICLE_RELEASED, DRIVER_VEHICLE_CLEARED,
} from '../utils/fleet';

/**
 * A car held this long with no live ride is assumed forgotten.
 *
 * Six hours, not minutes. The sabha window itself runs a few hours, and a driver
 * who picks a car early and taps "Find my next riders" late is doing nothing
 * wrong — pulling their car out from under them because they were slow would be
 * this function causing the very problem it exists to fix.
 *
 * Combined with a 03:00 schedule this means a car taken during a normal evening
 * is released the same night, and a car taken minutes before the job runs is left
 * alone until tomorrow.
 */
const IDLE_HOURS = 6;

/** A ride in any of these is live: the car is out and must be left alone. */
const ACTIVE_RIDE_STATUSES = ['assigned', 'driver_en_route', 'arriving', 'in_progress'];

/** Every status that means "this vehicle is claimed". */
const HELD_STATUS = 'in_use';

interface ReleaseDecision {
    release: boolean;
    reason: string;
}

/**
 * Should this vehicle be handed back?
 *
 * Exported for tests: the decision is the whole of the risk here, and it is worth
 * asserting directly rather than through a scheduled wrapper.
 */
export async function decideRelease(
    db: admin.firestore.Firestore,
    vehicleId: string,
    vehicle: any,
    now: Date,
    idleHours: number = IDLE_HOURS,
): Promise<ReleaseDecision> {
    if (vehicle?.status !== HELD_STATUS) {
        return { release: false, reason: `status is ${vehicle?.status}, not ${HELD_STATUS}` };
    }

    const holder = resolveVehicleHolder(vehicle);

    // Held by nobody at all. Nothing can ever release it from the driver side,
    // because there is no driver side. Unconditional.
    if (!holder) {
        return { release: true, reason: 'in_use with no assignedDriverId' };
    }

    const userSnap = await db.collection('users').doc(holder).get();

    // The account is gone. This is the case that orphaned a car for nine days.
    // Unconditional, and deliberately not subject to the idle timer: no amount of
    // waiting will bring the holder back.
    if (!userSnap.exists) {
        return { release: true, reason: `holder ${holder} has no user document` };
    }

    const held = userSnap.data()?.currentVehicleId ?? userSnap.data()?.currentCarId ?? null;

    // The driver thinks they hold a different car — or none. Whatever they are
    // driving, it is not this one, so this one is stranded. Unconditional.
    if (held !== vehicleId) {
        return {
            release: true,
            reason: `holder's currentVehicleId is ${held ?? 'null'}, not this vehicle`,
        };
    }

    // From here the record is self-consistent: a real driver holds this exact car.
    // The only question left is whether they are using it, and that question is
    // answered by their rides — never by a timer alone.
    const live = await db.collection('rides')
        .where('driverId', '==', holder)
        .where('status', 'in', ACTIVE_RIDE_STATUSES)
        .get();

    if (!live.empty) {
        return { release: false, reason: `holder has ${live.size} live ride(s)` };
    }

    // Idle, but possibly only just. `updatedAt` is written by every fleet path —
    // the client picker always has, and writeVehicleState now stamps it too.
    //
    // A MISSING timestamp is treated as infinitely old on purpose. The field is
    // written whenever a car is picked, so its absence means the document predates
    // that and has been sitting untouched; defaulting to "too new to release"
    // would make exactly the oldest, most stuck cars the ones this never fixes.
    const updatedAt = typeof vehicle.updatedAt === 'string' ? Date.parse(vehicle.updatedAt) : NaN;
    const heldForHours = Number.isFinite(updatedAt)
        ? (now.getTime() - updatedAt) / (60 * 60 * 1000)
        : Infinity;

    if (heldForHours < idleHours) {
        return {
            release: false,
            reason: `idle but only held ${heldForHours.toFixed(1)}h of ${idleHours}h`,
        };
    }

    return {
        release: true,
        reason: Number.isFinite(heldForHours)
            ? `no live ride, held ${heldForHours.toFixed(1)}h`
            : 'no live ride, and no updatedAt to date it from',
    };
}

/**
 * Release one vehicle and record why.
 *
 * The driver's record is only touched when it exists AND still points at this
 * car — `set` with merge would otherwise resurrect a deleted account as a stub
 * document, and clearing `currentVehicleId` on a driver who has since taken a
 * different car would strand that one instead. Fixing one stuck car by creating
 * another is not a fix.
 */
async function release(
    db: admin.firestore.Firestore,
    vehicleId: string,
    vehicle: any,
    reason: string,
): Promise<void> {
    const batch = db.batch();
    writeVehicleState(batch, db, vehicleId, VEHICLE_RELEASED);

    const holder = resolveVehicleHolder(vehicle);
    if (holder) {
        const userRef = db.collection('users').doc(holder);
        const userSnap = await userRef.get();
        const held = userSnap.data()?.currentVehicleId ?? userSnap.data()?.currentCarId ?? null;
        if (userSnap.exists && held === vehicleId) {
            batch.update(userRef, DRIVER_VEHICLE_CLEARED);
        }
    }

    await batch.commit();

    // After the commit. A car that was freed but unlogged is recoverable; a car
    // left held because its own audit row failed is the bug this function exists
    // to remove. writeAuditLog never throws for the same reason.
    await writeAuditLog(db, {
        action: 'doc.update',
        actorUid: 'system:releaseIdleVehicles',
        actorName: 'Idle vehicle sweep',
        targetCollection: 'vehicles',
        targetDocumentId: vehicleId,
        summary: `Released ${vehicle?.name || vehicleId}: ${reason}`,
        details: { reason, previousHolder: holder, vehicleName: vehicle?.name ?? null },
    });
}

/**
 * Daily at 03:00 in the congregation's zone.
 *
 * After midnight, which is when `closesAt` retires the gathering's ride window,
 * so a car taken for a normal evening has stopped being needed by the time this
 * runs. Daily rather than hourly because the urgent case now has a manager
 * Release button, and a sweep that runs while people are still driving is a sweep
 * with more chances to get it wrong.
 */
export const releaseIdleVehicles = functions.pubsub
    .schedule('every day 03:00')
    .timeZone(DEFAULT_TIME_ZONE)
    .onRun(async () => {
        const db = admin.firestore();
        const now = new Date();

        try {
            const snap = await db.collection('vehicles').where('status', '==', HELD_STATUS).get();

            if (snap.empty) {
                console.log('[releaseIdleVehicles] No held vehicles — nothing to do');
                return null;
            }

            let released = 0;
            let kept = 0;

            for (const doc of snap.docs) {
                const vehicle = doc.data();
                // One car's failure must not abandon the rest of the sweep: the
                // whole point is that a fleet is never left stranded, and stopping
                // at the first error is how one bad document holds the others.
                try {
                    const decision = await decideRelease(db, doc.id, vehicle, now);

                    if (!decision.release) {
                        kept++;
                        console.log(`[releaseIdleVehicles] KEEP ${vehicle.name || doc.id}: ${decision.reason}`);
                        continue;
                    }

                    await release(db, doc.id, vehicle, decision.reason);
                    released++;
                    console.log(`[releaseIdleVehicles] RELEASED ${vehicle.name || doc.id}: ${decision.reason}`);
                } catch (err) {
                    console.error(`[releaseIdleVehicles] Could not process ${doc.id}:`, err);
                }
            }

            console.log(`[releaseIdleVehicles] Released ${released}, left ${kept} in use`);
            return null;
        } catch (error) {
            console.error('[releaseIdleVehicles] Sweep failed:', error);
            return null;
        }
    });
