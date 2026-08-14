/**
 * Release vehicles stuck `in_use`, and clear orphan ride requests.
 *
 * WHY THIS EXISTS
 * ---------------
 * A vehicle becomes `in_use` the moment a driver picks it, before any rider is
 * assigned, and a driver KEEPS it between runs — one volunteer uses one car all
 * evening. Only `driverDoneForToday` releases it. So a driver who simply stops
 * without saying so leaves the car held, which is what this repairs.
 *
 * Since Phase 1 there is also a scheduled sweep (releaseIdleVehicles, 03:00) and
 * a manager Release button, so this script is now the blunt instrument rather
 * than the only instrument.
 *
 * Worse, adminDeleteUser deletes `vehicles/{uid}` and `cars/{uid}` — documents
 * keyed by the USER's uid, which no real vehicle uses. So deleting a driver never
 * released the car they held, and left `assignedDriverId` pointing at a uid with
 * no user document. Nothing in the app can ever release that car, because every
 * release path starts from the driver's record.
 *
 * That is how a three-car fleet reached zero available cars.
 *
 * This is the one-off repair. The permanent fixes — the delete path, a scheduled
 * sweep, and a manager Release control — are Phase 1 to 3 of
 * docs/plans/dispatch-seed-and-grow.md.
 *
 * USAGE
 * -----
 *   node scripts/repair-fleet.cjs              # dry run, changes nothing
 *   node scripts/repair-fleet.cjs --apply      # actually write
 *
 * Dry run is the default on purpose: this touches production, and the first thing
 * anyone should see is what it WOULD do.
 */

const fs = require('fs');
const path = require('path');

/** Same resolver as scripts/tenancy.cjs — firebase-admin lives in functions/. */
const admin = (() => {
    try {
        return require('firebase-admin');
    } catch (err) {
        if (err.code !== 'MODULE_NOT_FOUND') throw err;
        try {
            return require(require.resolve('firebase-admin', {
                paths: [path.join(__dirname, '..', 'functions', 'node_modules')],
            }));
        } catch {
            console.error('firebase-admin not found. Run `npm install` inside functions/ first.');
            process.exit(1);
        }
    }
})();

const APPLY = process.argv.includes('--apply');

// The key is gitignored, so it sits in the main checkout and is absent from every
// git worktree. SABHA_ADMIN_KEY lets a worktree point at it rather than copying a
// credential around.
const KEY = process.env.SABHA_ADMIN_KEY
    || path.join(__dirname, '..', 'sabha-ride-app-firebase-adminsdk-fbsvc-dfc82e2f75.json');
if (!fs.existsSync(KEY)) {
    console.error(`Admin SDK key not found at ${KEY}`);
    console.error('Run from the main checkout, or set SABHA_ADMIN_KEY to its path.');
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(KEY)) });
const db = admin.firestore();

/** Mirror of functions/src/utils/fleet.ts — both halves, or the two drift. */
const FLEET_COLLECTIONS = ['vehicles', 'cars'];
const VEHICLE_RELEASED = { status: 'available', assignedDriverId: null, assignedDriverName: null };
const DRIVER_VEHICLE_CLEARED = { currentVehicleId: null, currentCarId: null };

/** Mirror of functions/src/constants/tenancy.ts. */
const CITY_ID = 'boston';
const LOCATION_ID = 'boston-huntington';

/** Statuses that mean a ride is live and its car must NOT be touched. */
const ACTIVE_RIDE_STATUSES = ['assigned', 'driver_en_route', 'arriving', 'in_progress'];

/**
 * A car held this long with no live ride is assumed forgotten.
 *
 * Matches IDLE_HOURS in functions/src/scheduled/releaseIdleVehicles.ts, and it
 * is not optional here. A driver now KEEPS their car between runs — completeRide
 * and releaseAssignment stopped releasing it, because a volunteer uses one car
 * all evening. So "holds it, no live ride" is the NORMAL state between runs, and
 * without this threshold running the script at 8pm on a Friday would strip every
 * driver's car mid-shift — the script reached for to fix a stuck fleet would be
 * the thing that broke a working one.
 *
 * Missing/mismatched holders are still released unconditionally below: no amount
 * of waiting brings a deleted account back.
 */
const IDLE_HOURS = 6;

const label = APPLY ? 'APPLY' : 'DRY RUN';

async function auditRow(entry) {
    // Same shape as buildAuditRow in functions/src/utils/audit.ts, including the
    // `timestamp` field name — the console orders by it and Firestore omits
    // documents that lack the orderBy field entirely.
    return {
        timestamp: new Date().toISOString(),
        action: 'doc.update',
        actorUid: 'script:repair-fleet',
        actorName: 'Fleet repair script',
        targetCollection: entry.targetCollection,
        targetDocumentId: entry.targetDocumentId,
        summary: entry.summary,
        details: entry.details || {},
        outcome: 'ok',
        cityId: CITY_ID,
        locationId: LOCATION_ID,
    };
}

/**
 * Why this vehicle should be released, or null to leave it alone.
 *
 * Deliberately conservative: a car carrying passengers is never touched. Stranding
 * a driver mid-run is worse than a car stuck overnight.
 */
async function releaseReason(vehicleId, v) {
    const holder = v.assignedDriverId ?? v.currentDriverId ?? null;
    if (!holder) return 'in_use with no assignedDriverId at all';

    const userSnap = await db.collection('users').doc(holder).get();
    if (!userSnap.exists) return `holder ${holder.slice(0, 8)}… has no user document (deleted account)`;

    const u = userSnap.data();
    const held = u.currentVehicleId ?? u.currentCarId ?? null;
    if (held !== vehicleId) {
        return `holder's currentVehicleId is ${held ? held.slice(0, 8) + '…' : 'null'}, not this vehicle`;
    }

    const live = await db.collection('rides')
        .where('driverId', '==', holder)
        .where('status', 'in', ACTIVE_RIDE_STATUSES)
        .get();
    if (!live.empty) return null; // carrying passengers — leave it

    // Idle, but possibly only between runs. A missing timestamp counts as
    // infinitely old on purpose: updatedAt is written whenever a car is picked,
    // so its absence means the document predates that and has sat untouched.
    const updatedAt = typeof v.updatedAt === 'string' ? Date.parse(v.updatedAt) : NaN;
    const heldHours = Number.isFinite(updatedAt)
        ? (Date.now() - updatedAt) / 3600000
        : Infinity;

    if (heldHours < IDLE_HOURS) {
        return null; // a driver between runs — leave it
    }

    return Number.isFinite(heldHours)
        ? `no live ride, held ${heldHours.toFixed(1)}h`
        : 'no live ride, and no updatedAt to date it from';
}

async function repairVehicles() {
    console.log(`\n=== VEHICLES (${label}) ===`);
    const snap = await db.collection('vehicles').get();
    let released = 0, kept = 0;

    for (const doc of snap.docs) {
        const v = doc.data();
        if (v.status !== 'in_use') {
            console.log(`  ${v.name || doc.id}: ${v.status} — skip`);
            continue;
        }

        const reason = await releaseReason(doc.id, v);
        if (!reason) {
            kept++;
            // Either carrying passengers, or a driver between runs inside the
            // idle window. Both are working states.
            console.log(`  ${v.name || doc.id}: KEEP — in use and not stale`);
            continue;
        }

        released++;
        console.log(`  ${v.name || doc.id}: RELEASE — ${reason}`);

        if (!APPLY) continue;

        const batch = db.batch();
        for (const name of FLEET_COLLECTIONS) {
            batch.set(db.collection(name).doc(doc.id), {
                ...VEHICLE_RELEASED,
                updatedAt: new Date().toISOString(),
            }, { merge: true });
        }
        const holder = v.assignedDriverId ?? v.currentDriverId ?? null;
        if (holder) {
            const userRef = db.collection('users').doc(holder);
            const userSnap = await userRef.get();
            // set+merge would resurrect a deleted user as a stub document.
            if (userSnap.exists) {
                const cleared = { ...DRIVER_VEHICLE_CLEARED };

                // A driver freed by this script has no car, so an activeRideId is
                // a dangling pointer. Only cleared when the ride it names is not
                // actually theirs any more — a manager's soft release returns a
                // ride to the queue and clears its driverId, but nothing cleared
                // the driver's side, so the pointer outlived the assignment.
                //
                // Checked rather than blanked, because a driver mid-run legitimately
                // has one and this script must never be the thing that loses it.
                const activeRideId = userSnap.data()?.activeRideId;
                if (activeRideId) {
                    const rideSnap = await db.collection('rides').doc(activeRideId).get();
                    const stillTheirs = rideSnap.exists && rideSnap.data()?.driverId === holder;
                    if (!stillTheirs) cleared.activeRideId = null;
                }

                batch.update(userRef, cleared);
            }
        }
        batch.set(db.collection('auditLogs').doc(), await auditRow({
            targetCollection: 'vehicles',
            targetDocumentId: doc.id,
            summary: `Fleet repair released ${v.name || doc.id}: ${reason}`,
            details: { vehicleName: v.name ?? null, previousHolder: holder, reason },
        }));
        await batch.commit();
    }

    console.log(`  → ${released} to release, ${kept} left alone (live rides)`);
}

/**
 * Ride requests for a gathering that has already happened.
 *
 * These are not harmless. globalAssignDriver's isValidPendingRide checks
 * coordinates and studentId only — it does NOT check which sabha a request
 * belongs to — so a stale `requested` ride WOULD be dispatched tonight, sending
 * a driver to collect someone for a sabha five days ago. The permanent fix is an
 * eventId filter (Phase 1).
 */
async function repairOrphanRequests() {
    console.log(`\n=== ORPHAN RIDE REQUESTS (${label}) ===`);

    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    const snap = await db.collection('rides').where('status', '==', 'requested').get();
    let stale = 0;

    for (const doc of snap.docs) {
        const r = doc.data();
        const key = r.eventId || r.eventDate || r.date || null;
        if (!key || key >= today) {
            console.log(`  ${doc.id.slice(0, 8)}…: event ${key || 'unknown'} — keep`);
            continue;
        }

        stale++;
        console.log(`  ${doc.id.slice(0, 8)}…: event ${key} is past — DELETE (${r.studentName || r.studentId})`);

        if (!APPLY) continue;

        const batch = db.batch();
        batch.set(db.collection('auditLogs').doc(), await auditRow({
            targetCollection: 'rides',
            targetDocumentId: doc.id,
            summary: `Fleet repair deleted a stale request for ${key} (${r.studentName || r.studentId})`,
            // The whole document, so the deletion is reversible from the log.
            details: { eventKey: key, ride: r },
        }));
        batch.delete(doc.ref);
        await batch.commit();
    }

    console.log(`  → ${stale} stale request(s)`);
}

/**
 * Drivers pointing at a ride that is no longer theirs.
 *
 * A manager's soft release (`returnStudentToPool`) returns a ride to the queue
 * and clears its `driverId`, but nothing cleared the DRIVER's `activeRideId`. So
 * the driver kept a pointer to a ride sitting back in the pool with no driver —
 * seen in production on 2026-08-14, where Tonny Stark still named ride igFK1kHP
 * after it had been released.
 *
 * Runs independently of the vehicle pass, because the two orphans do not always
 * occur together: a soft release deliberately leaves the car held, so the vehicle
 * pass will not even look at that driver.
 */
async function repairDanglingActiveRides() {
    console.log(`\n=== DANGLING activeRideId (${label}) ===`);
    const users = await db.collection('users').get();
    let fixed = 0;

    for (const doc of users.docs) {
        const u = doc.data();
        if (!u.activeRideId) continue;

        const rideSnap = await db.collection('rides').doc(u.activeRideId).get();
        // Theirs only if the ride still exists AND still names them. A ride that
        // was reassigned to someone else is just as dangling as a deleted one.
        if (rideSnap.exists && rideSnap.data()?.driverId === doc.id) {
            console.log(`  ${u.name || doc.id}: keep — still driving ${u.activeRideId.slice(0, 8)}…`);
            continue;
        }

        fixed++;
        const why = rideSnap.exists
            ? `ride ${u.activeRideId.slice(0, 8)}… is now driverId=${rideSnap.data()?.driverId ?? 'null'}`
            : `ride ${u.activeRideId.slice(0, 8)}… no longer exists`;
        console.log(`  ${u.name || doc.id}: CLEAR — ${why}`);

        if (!APPLY) continue;

        const batch = db.batch();
        batch.update(doc.ref, { activeRideId: null });
        batch.set(db.collection('auditLogs').doc(), await auditRow({
            targetCollection: 'users',
            targetDocumentId: doc.id,
            summary: `Fleet repair cleared a dangling activeRideId on ${u.name || doc.id}: ${why}`,
            details: { previousActiveRideId: u.activeRideId, reason: why },
        }));
        await batch.commit();
    }

    console.log(`  → ${fixed} dangling pointer(s)`);
}

(async () => {
    console.log(APPLY
        ? '*** APPLYING CHANGES TO PRODUCTION ***'
        : 'Dry run — nothing will be written. Re-run with --apply to commit.');

    await repairVehicles();
    await repairOrphanRequests();
    await repairDanglingActiveRides();

    console.log(APPLY ? '\nDone.' : '\nDry run complete. Nothing changed.');
    process.exit(0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
