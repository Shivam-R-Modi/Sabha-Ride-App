/**
 * Clear "where they were tonight" statuses left over from a finished gathering.
 *
 * WHY THIS EXISTS
 * ---------------
 * `at_sabha` was never cleared by anything. It is written when a home→sabha ride
 * completes and then simply stays. Measured in production on 2026-08-15: five
 * riders still carried it from the night of the 14th.
 *
 * That went from untidy to load-bearing when the drop-off presence check started
 * short-circuiting on `at_sabha`. A flag left over from last week waves a rider
 * straight past this week's check without them having turned up, and a driver is
 * sent to collect somebody sitting at home.
 *
 * The permanent fix is `clearEndOfEveningStatuses` inside
 * functions/src/scheduled/expireStaleRequests.ts, which runs daily at 03:00. This
 * script is the one-off that stops the existing five having to wait for it.
 *
 * IT IS A DELIBERATE MIRROR, NOT A SECOND IMPLEMENTATION. Every rule below is
 * copied from that function, and the two must be changed together:
 *
 *   - only `at_sabha` and `in_ride` are touched. `home_safe` is terminal and
 *     truthful — resetting it would erase the record that the evening finished.
 *   - a rider with a LIVE ride is left alone. A drop-off run can still be going,
 *     and resetting somebody in the car makes the board contradict the driver.
 *   - the status field is REMOVED, not set. Signup writes no status at all, so
 *     absent is already what an idle rider looks like; inventing 'home_safe'
 *     would be a plain lie about somebody having got home.
 *
 * USAGE
 * -----
 *   node scripts/clear-stale-presence.cjs            # dry run, changes nothing
 *   node scripts/clear-stale-presence.cjs --apply    # actually write
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

/** Mirror of END_OF_EVENING_STATUSES in expireStaleRequests.ts. */
const END_OF_EVENING_STATUSES = ['at_sabha', 'in_ride'];

/** Mirror of OPEN_RIDE_STATUSES. A ride in any of these means still travelling. */
const OPEN_RIDE_STATUSES = ['requested', 'assigned', 'driver_en_route', 'arriving', 'in_progress'];

/**
 * Mirror of AUDIT_COLLECTION in functions/src/utils/audit.ts.
 *
 * PLURAL. The first version of this script wrote to `auditLog` and quietly
 * created a second, parallel collection that nothing in the app reads — so the
 * repair looked logged and was not. A one-character difference, and the only
 * reason it was caught is that a hand-written query happened to use the same
 * wrong name and came up almost empty.
 */
const AUDIT_COLLECTION = 'auditLogs';

/** Mirror of functions/src/constants/tenancy.ts, as in scripts/repair-fleet.cjs. */
const CITY_ID = 'boston';
const LOCATION_ID = 'boston-huntington';

(async () => {
    console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===');

    const [lingering, live] = await Promise.all([
        db.collection('users').where('status', 'in', END_OF_EVENING_STATUSES).get(),
        db.collection('rides').where('status', 'in', OPEN_RIDE_STATUSES).get(),
    ]);

    if (lingering.empty) {
        console.log('No riders are carrying an end-of-evening status. Nothing to do.');
        process.exit(0);
    }

    const travelling = new Map();
    for (const doc of live.docs) {
        const r = doc.data();
        if (typeof r?.studentId === 'string') travelling.set(r.studentId, r.status);
    }

    const batch = db.batch();
    let cleared = 0;
    let kept = 0;

    for (const doc of lingering.docs) {
        const rider = doc.data();
        const name = rider?.name || doc.id.slice(0, 8);
        const liveStatus = travelling.get(doc.id);

        if (liveStatus) {
            kept++;
            console.log(`  KEEP    ${name.padEnd(14)} status=${rider.status} `
                + `— has a live ride (${liveStatus})`);
            continue;
        }

        cleared++;
        console.log(`  CLEAR   ${name.padEnd(14)} status=${rider.status} → (removed)`);

        if (APPLY) {
            batch.update(doc.ref, {
                status: admin.firestore.FieldValue.delete(),
                currentRideId: null,
            });
        }
    }

    if (APPLY && cleared > 0) {
        await batch.commit();

        // After the commit, and never allowed to stop the repair: a status that
        // was cleared but unlogged is recoverable, one left stale because the
        // audit write failed is the rot this exists to remove.
        try {
            // Same collection AND same shape as buildAuditRow, cityId and
            // locationId included. A row missing those is invisible to any
            // tenancy-scoped reader, which is the same failure as writing it to
            // the wrong collection — just harder to spot.
            await db.collection(AUDIT_COLLECTION).doc().set({
                timestamp: new Date().toISOString(),
                action: 'doc.update',
                actorUid: 'script:clear-stale-presence',
                actorName: 'Stale presence repair',
                targetCollection: 'users',
                targetDocumentId: lingering.docs[0].id,
                summary: `Cleared ${cleared} end-of-evening status(es), left ${kept} mid-ride`,
                details: { cleared, kept },
                outcome: 'ok',
                cityId: CITY_ID,
                locationId: LOCATION_ID,
            });
        } catch (auditErr) {
            console.error('  (audit row failed, statuses were still cleared)', auditErr.message);
        }
    }

    console.log(`\n${APPLY ? 'Cleared' : 'Would clear'} ${cleared}, left ${kept} mid-ride.`);
    process.exit(0);
})().catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
});
