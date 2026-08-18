#!/usr/bin/env node
/**
 * Clear the test data, keep the things that are configuration.
 *
 * REPLACES scripts/clear-database.cjs, WHICH WAS UNFIT TO RUN
 * ----------------------------------------------------------
 * That script would have:
 *   - crashed on `require('../serviceAccountKey.json')`, a filename this repo
 *     has never used;
 *   - deleted the FLEET (`COLLECTIONS_TO_CLEAR = ['rides','vehicles']`), which is
 *     configuration, not test data;
 *   - left the `cars` mirror populated while `vehicles` was empty — precisely the
 *     inconsistency behind the old "why is Car3 stuck?" bug;
 *   - deleted ZERO users, because it detected them by a hardcoded list of names
 *     ("Rajesh Kumar", "Priya Desai") from a dataset that no longer exists;
 *   - ignored events, attendance, statistics, invites and Firebase Auth entirely.
 *
 * Net effect: destroy the fleet, break the mirror, keep every test account. It is
 * deleted rather than fixed, because a destructive script that does the wrong
 * thing is worse than no script.
 *
 * WHAT THIS ONE DOES
 * ------------------
 * Deletes  users (all but the manager) + their Auth accounts, rides, events,
 *          weeklyAttendance, statistics, managerInvites
 * Keeps    the manager, vehicles + cars (reset to available in BOTH mirrors),
 *          settings/*, auditLogs, system/*
 *
 * Choices worth stating:
 *
 *   THE MANAGER SURVIVES. Manager invites can only be issued by an existing
 *   manager, so deleting the last one locks the owner out of their own app with
 *   no route back in.
 *
 *   AUDIT ROWS SURVIVE. CLAUDE.md forbids simplifying away an audit row. They
 *   reference accounts that will no longer exist, which is what an audit log is
 *   for — it records what happened, not what still exists.
 *
 *   INVITES DO NOT. An unredeemed managerInvite is a live credential to become a
 *   manager. Four are outstanding from testing. Clearing them is a security fix
 *   that happens to look like tidying.
 *
 *   ORPHANED AUTH ACCOUNTS ARE LEFT ALONE. There are ~58 Auth logins with no
 *   Firestore document, and a few belong to real people. Signing in with one
 *   simply creates a fresh signup awaiting approval, so they are untidy rather
 *   than dangerous. Pass --orphans to include the obviously-test-shaped ones;
 *   real-looking addresses are always reported and never deleted.
 *
 * DRY RUN BY DEFAULT. Prints what it would do and changes nothing.
 *
 *   node scripts/reset-to-clean-slate.cjs --key <path>
 *   node scripts/reset-to-clean-slate.cjs --key <path> --confirm
 *   node scripts/reset-to-clean-slate.cjs --key <path> --confirm --orphans
 *   node scripts/reset-to-clean-slate.cjs --key <path> --confirm --orphans-only
 *
 * `--orphans-only` EXISTS BECAUSE THE REST OF THIS SCRIPT IS A ONE-SHOT.
 *
 * The collections it clears are only test debris on the day of the reset. Run it
 * a second time later and `weeklyAttendance` holds the header the scheduler has
 * published for the NEXT gathering, and `events` holds real exceptions — live
 * data, wiped as collateral because somebody only wanted to tidy up stale Auth
 * logins. That nearly happened on 2026-08-18, one day after the reset.
 *
 * So the Auth cleanup is separable, and a repeat run of the full script should be
 * a deliberate act rather than the convenient way to reach one flag.
 */

const path = require('path');

/** Same resolver as the other scripts here — firebase-admin lives in functions/. */
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

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const ORPHANS_ONLY = args.includes('--orphans-only');
const ORPHANS = ORPHANS_ONLY || args.includes('--orphans');
const keyIdx = args.indexOf('--key');
const keyArg = keyIdx >= 0 ? args[keyIdx + 1] : process.env.SABHA_KEY;

if (!keyArg) {
    console.error('Need --key <service-account.json> (or SABHA_KEY in the environment).');
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyArg))) });
const db = admin.firestore();

/** Wiped completely. Every document in these is a record of a test evening. */
const CLEAR = ['rides', 'events', 'weeklyAttendance', 'statistics', 'managerInvites'];

/**
 * Auth emails that are unambiguously debris.
 *
 * Deliberately a whitelist of SHAPES rather than "anything I don't recognise":
 * the cost of being wrong is deleting a real person's login, so anything not
 * matched here is reported for a human to decide on.
 */
const TEST_EMAIL = /^(?:[sr]\d+|q|a|e|w|asd|asdf|abcd|student\d*|rider\d*|manager\d*|testuser|testmanager|testdriver)@|@example\.com$|@neplis\.com$|@luhupo\.com$|@applamos\.com$|@bejum\.com$|@xyz\.com$|invalidemail/i;

const say = (...a) => console.log(...a);

async function deleteAll(name) {
    const col = db.collection(name);
    let removed = 0;
    for (;;) {
        const snap = await col.limit(300).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        removed += snap.size;
        if (snap.size < 300) break;
    }
    return removed;
}

(async () => {
    // ── who is the manager we must not delete? ───────────────────
    const users = await db.collection('users').get();
    const managers = users.docs.filter(d => {
        const u = d.data();
        return (u.roles || []).includes('manager') || u.role === 'manager' || u.registeredRole === 'manager';
    });

    if (managers.length !== 1) {
        // Refuse rather than guess. Picking the wrong one, or none, is a lockout.
        console.error(`Expected exactly one manager, found ${managers.length}. Refusing to run.`);
        managers.forEach(m => console.error(`  ${m.id} ${m.data().email}`));
        process.exit(1);
    }
    const keepUid = managers[0].id;
    say(`${CONFIRM ? 'RUNNING' : 'DRY RUN'}${ORPHANS_ONLY ? ' (orphaned Auth logins ONLY)' : ''}`
        + ` — keeping manager ${managers[0].data().name} <${managers[0].data().email}>\n`);

    // ── users + their Auth accounts ──────────────────────────────
    const doomed = ORPHANS_ONLY ? [] : users.docs.filter(d => d.id !== keepUid);
    say(`users to delete: ${doomed.length}${ORPHANS_ONLY ? '  (--orphans-only: user documents untouched)' : ''}`);
    doomed.forEach(d => say(`   ${d.id}  ${d.data().name}  ${d.data().email}`));

    // ── orphaned Auth ────────────────────────────────────────────
    const authList = await admin.auth().listUsers(1000);
    const fsIds = new Set(users.docs.map(d => d.id));
    const orphans = authList.users.filter(u => !fsIds.has(u.uid));
    const orphanTest = orphans.filter(u => TEST_EMAIL.test(u.email || ''));
    const orphanReal = orphans.filter(u => !TEST_EMAIL.test(u.email || ''));

    say(`\norphaned Auth logins: ${orphans.length}  (${orphanTest.length} test-shaped, ${orphanReal.length} not)`);
    say(orphanTest.length
        ? `   test-shaped will ${ORPHANS ? 'BE DELETED' : 'be LEFT (pass --orphans to include)'}`
        : '   none test-shaped');
    if (orphanReal.length) {
        say('   NEVER deleted by this script — decide these by hand:');
        orphanReal.forEach(u => say(`     ${u.email}`));
    }

    // ── collections ──────────────────────────────────────────────
    if (ORPHANS_ONLY) {
        say('\nNo collection is touched in --orphans-only mode. This matters: by the day'
          + '\nafter a reset, weeklyAttendance and events hold LIVE data for the next'
          + '\ngathering, not test debris.');
    } else {
        say('\ncollections to clear:');
        for (const name of CLEAR) {
            const n = (await db.collection(name).count().get()).data().count;
            say(`   ${name.padEnd(18)} ${n}`);
        }

        const kept = ['vehicles', 'cars', 'settings', 'auditLogs', 'system'];
        say('\nkept as configuration or history:');
        for (const name of kept) {
            const n = (await db.collection(name).count().get()).data().count;
            say(`   ${name.padEnd(18)} ${n}`);
        }
    }

    if (!CONFIRM) {
        say('\nNothing was changed. Re-run with --confirm to apply.');
        process.exit(0);
    }

    // ── apply ────────────────────────────────────────────────────
    say('\napplying…');

    if (!ORPHANS_ONLY) {
        for (const name of CLEAR) {
            const n = await deleteAll(name);
            say(`   cleared ${name}: ${n}`);
        }
    }

    let userDocs = 0;
    for (let i = 0; i < doomed.length; i += 300) {
        const batch = db.batch();
        doomed.slice(i, i + 300).forEach(d => { batch.delete(d.ref); userDocs++; });
        await batch.commit();
    }
    say(`   deleted user documents: ${userDocs}`);

    const toDeleteAuth = [...doomed.map(d => d.id), ...(ORPHANS ? orphanTest.map(u => u.uid) : [])];
    let authDeleted = 0;
    for (const uid of toDeleteAuth) {
        try { await admin.auth().deleteUser(uid); authDeleted++; }
        catch (e) { say(`   ! could not delete Auth ${uid}: ${e.code || e.message}`); }
    }
    say(`   deleted Auth accounts: ${authDeleted}`);

    // ── the fleet: keep the cars, forget who held them ───────────
    // BOTH halves, always. Writing one and not the other is the bug this project
    // has spent the most time on.
    let fleetReset = 0;
    for (const name of ORPHANS_ONLY ? [] : ['vehicles', 'cars']) {
        const snap = await db.collection(name).get();
        const batch = db.batch();
        snap.docs.forEach(d => {
            batch.update(d.ref, {
                status: 'available',
                assignedDriverId: admin.firestore.FieldValue.delete(),
                assignedDriverName: admin.firestore.FieldValue.delete(),
            });
            fleetReset++;
        });
        if (!snap.empty) await batch.commit();
    }
    say(`   reset fleet documents (both mirrors): ${fleetReset}`);

    say('\nDone. The manager, the fleet, the venue, the recurrence rule and the audit log remain.');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
