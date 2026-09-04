/**
 * Seed the sabha locations, and verify that nothing points at a hall that does not
 * exist.
 *
 *   node scripts/locations.cjs seed             # dry run
 *   node scripts/locations.cjs seed --apply
 *   node scripts/locations.cjs add <id> "<name>" <lat> <lng> "<address>"
 *   node scripts/locations.cjs add <id> ... --apply --active
 *   node scripts/locations.cjs verify           # EXITS NON-ZERO on any problem
 *
 * ## Why adding a hall is a script and not a screen
 *
 * The owner's call: a hall is not something that changes, and riders already know
 * which one they attend. A management screen would be a control touched once a year,
 * on a page a manager visits every week — and the act it performs is the most
 * consequential in the whole feature, because switching a hall on means riders can
 * book it and Sarthis can be sent to it.
 *
 * So it lives here, where it is deliberate, auditable in a shell history, and gated
 * behind a dry run. `--active` is a separate flag from the rest for the same reason:
 * creating a hall and OPENING it are two decisions.
 *
 * ## Why the seed is a script and not a screen
 *
 * The founding hall's document id must be EXACTLY `boston-huntington`, because every
 * `rides` and `users` document already written carries that string in `locationId` and
 * `eventIdFor` gives that one hall the bare-date event key — which is what makes every
 * existing `events`, `weeklyAttendance` and `statistics` record readable without a
 * backfill. A typo in a console field would quietly detach the whole history.
 *
 * ## Why the verifier is the important half
 *
 * Same asymmetry `tenancy.cjs` was written for, one field further on. A ride naming a
 * hall that does not exist is not an error anywhere: `rejectionFor` refuses it, the
 * driver is told nobody is waiting, and the rider simply never gets collected. Nothing
 * throws and nothing logs. This is the only thing that finds it.
 *
 * The check that matters most is the last one — a car whose riders span two halls. That
 * is the single invariant the whole multi-location feature exists to protect, so it
 * belongs in a standing verifier rather than in a one-off migration note.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

// Must match src/constants/tenancy.ts and functions/src/constants/tenancy.ts.
const FOUNDING_LOCATION_ID = 'boston-huntington';
const LOCATION_ID_PATTERN = /^[a-z0-9-]+$/;
const EVENT_ID_SEPARATOR = '__';

const mode = process.argv[2];
const APPLY = process.argv.includes('--apply');

function findKeyPath() {
    const explicit = process.argv.indexOf('--key');
    if (explicit !== -1 && process.argv[explicit + 1]) return process.argv[explicit + 1];
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;

    const dirs = [path.join(__dirname, '..'), process.cwd()];
    try {
        const main = execSync('git worktree list --porcelain', { cwd: __dirname })
            .toString().split('\n').find(l => l.startsWith('worktree '));
        if (main) dirs.push(main.slice('worktree '.length).trim());
    } catch { /* not a worktree */ }

    for (const dir of dirs) {
        let entries = [];
        try { entries = fs.readdirSync(dir); } catch { continue; }
        const match = entries.find(f =>
            f === 'serviceAccountKey.json' || /-firebase-adminsdk-.*\.json$/.test(f));
        if (match) return path.join(dir, match);
    }
    console.error('No Admin SDK key found. Searched:');
    dirs.forEach(d => console.error('  ' + d));
    process.exit(1);
}

const keyPath = findKeyPath();
admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
const db = admin.firestore();

/**
 * Create the founding hall from whatever `settings/main` currently says.
 *
 * The venue is COPIED rather than typed, so the seeded hall is the venue the app has
 * actually been routing to. Never overwrites an existing document — re-running is
 * harmless, and a manager's later edit is not clobbered by a second seed.
 */
async function seed() {
    const ref = db.collection('locations').doc(FOUNDING_LOCATION_ID);
    const existing = await ref.get();

    if (existing.exists) {
        const d = existing.data() || {};
        console.log(`locations/${FOUNDING_LOCATION_ID} already exists — leaving it alone.`);
        console.log(`  name   ${d.name}`);
        console.log(`  active ${d.active}`);
        console.log(`  venue  ${d.venue && d.venue.address}`);
        return 0;
    }

    const settings = (await db.collection('settings').doc('main').get()).data() || {};
    const venue = settings.sabhaLocation;

    if (!venue || typeof venue.lat !== 'number' || typeof venue.lng !== 'number'
        || (venue.lat === 0 && venue.lng === 0)) {
        console.error('settings/main.sabhaLocation is missing or unusable. Refusing to seed a');
        console.error('hall with no coordinates — it would be the farthest point from every');
        console.error('rider and would seed every carload.');
        return 1;
    }

    const doc = {
        name: 'Sabha',
        venue: {
            lat: venue.lat,
            lng: venue.lng,
            address: typeof venue.address === 'string' ? venue.address : '',
        },
        // The founding hall is live — it is where sabha has always been. Every hall
        // added AFTER this lands inactive and is switched on deliberately.
        active: true,
        order: 0,
        createdAt: new Date().toISOString(),
        createdBy: 'script:locations.cjs',
    };

    console.log(`Will create locations/${FOUNDING_LOCATION_ID}:`);
    console.log(JSON.stringify(doc, null, 2));

    if (!APPLY) {
        console.log('\nDry run. Re-run with --apply to write it.');
        return 0;
    }

    await ref.set(doc);
    console.log('\nCreated.');
    return 0;
}

/**
 * Add a hall.
 *
 * INACTIVE UNLESS `--active` IS PASSED, matching firestore.rules, which refuses to let
 * any client create an active one. Switching a hall on is what lets riders book it and
 * Sarthis be dispatched to it; a half-entered hall going live the moment it is saved
 * would strand whoever booked it.
 *
 * Refuses to overwrite an existing hall. Moving one is `LocationSettings` in the app;
 * this is only for creation, so a re-run cannot silently relocate a live hall.
 */
async function add() {
    const [, , , id, name, lat, lng, address] = process.argv;
    const ACTIVE = process.argv.includes('--active');

    if (!id || !name || !lat || !lng || !address) {
        console.error('Usage: node scripts/locations.cjs add <id> "<name>" <lat> <lng> "<address>" [--active] [--apply]');
        return 1;
    }
    if (!LOCATION_ID_PATTERN.test(id)) {
        console.error(`Bad id "${id}". Lower case, digits and hyphens only — it becomes`);
        console.error('part of an event key, so a slash or a dot would change which');
        console.error('document that key points at.');
        return 1;
    }
    if (id === FOUNDING_LOCATION_ID) {
        console.error(`"${id}" is the founding hall. Use \`seed\` for that one.`);
        return 1;
    }

    const latN = Number(lat);
    const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN) || (latN === 0 && lngN === 0)) {
        console.error('Coordinates must be real numbers and not 0,0 — that pair is the');
        console.error('"address never geocoded" placeholder, and a hall there would be the');
        console.error('farthest point from every rider and would seed every carload.');
        return 1;
    }

    const ref = db.collection('locations').doc(id);
    if ((await ref.get()).exists) {
        console.error(`locations/${id} already exists. Refusing to overwrite it — move a`);
        console.error('hall from the Venue screen in the app instead.');
        return 1;
    }

    const doc = {
        name,
        venue: { lat: latN, lng: lngN, address },
        active: ACTIVE,
        order: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'script:locations.cjs',
    };

    console.log(`Will create locations/${id}:`);
    console.log(JSON.stringify(doc, null, 2));
    if (!ACTIVE) {
        console.log('\nINACTIVE. Riders cannot book it and Sarthis cannot be sent to it');
        console.log('until you re-run with --active, or flip the flag deliberately.');
    } else {
        console.log('\nACTIVE IMMEDIATELY. Riders will be asked which sabha they are going');
        console.log('to, and Sarthis will be asked which one they are driving for.');
    }

    if (!process.argv.includes('--apply')) {
        console.log('\nDry run. Re-run with --apply to write it.');
        return 0;
    }

    await ref.set(doc);
    console.log('\nCreated. Run `verify` to check nothing points at a hall that does not exist.');
    return 0;
}

async function verify() {
    console.log('Verifying sabha locations.\n');
    let problems = 0;
    const fail = (line) => { problems++; console.log(`  PROBLEM  ${line}`); };

    // ── the halls themselves ──────────────────────────────────────────────────
    const halls = await db.collection('locations').get();
    const known = new Set();
    const active = new Set();

    for (const doc of halls.docs) {
        const d = doc.data() || {};
        known.add(doc.id);
        if (d.active === true) active.add(doc.id);

        if (!LOCATION_ID_PATTERN.test(doc.id)) {
            fail(`locations/${doc.id} — id must match ${LOCATION_ID_PATTERN}; it becomes part of an event key`);
        }
        if (!d.name) fail(`locations/${doc.id} — no name`);
        if (!d.venue || typeof d.venue.lat !== 'number' || typeof d.venue.lng !== 'number') {
            fail(`locations/${doc.id} — no usable coordinates`);
        } else if (d.venue.lat === 0 && d.venue.lng === 0) {
            fail(`locations/${doc.id} — venue is 0,0, the "never geocoded" placeholder`);
        }
    }

    console.log(`  locations  ${halls.size} documents, ${active.size} active`);
    if (!known.has(FOUNDING_LOCATION_ID)) {
        fail(`locations/${FOUNDING_LOCATION_ID} is MISSING — every existing ride points at it`);
    }
    if (active.size === 0) fail('no hall is active — the congregation has nowhere to meet');

    // ── rides ─────────────────────────────────────────────────────────────────
    const rides = await db.collection('rides').get();
    let unstamped = 0;
    let unknownHall = 0;

    for (const doc of rides.docs) {
        const d = doc.data() || {};
        if (typeof d.locationId !== 'string' || !d.locationId) {
            unstamped++;
            if (unstamped <= 10) console.log(`      unstamped: rides/${doc.id}`);
            continue;
        }
        if (!known.has(d.locationId)) {
            unknownHall++;
            fail(`rides/${doc.id} names hall "${d.locationId}", which does not exist`);
        }
    }
    console.log(`  rides      ${rides.size} documents, ${unstamped} with no hall, ${unknownHall} naming an unknown one`);
    if (unstamped > 0) {
        console.log('      NOTE: unstamped rides are dispatchable only while ONE hall is active.');
        console.log('      They are refused as soon as a second one opens.');
        if (active.size > 1) fail(`${unstamped} rides name no hall while ${active.size} are active — they will never be dispatched`);
    }

    /**
     * ── THE INVARIANT THE WHOLE FEATURE EXISTS TO PROTECT ────────────────────
     *
     * A car whose riders are bound for two different halls. `rejectionFor` should make
     * this unreachable, and `manualAssignStudent` is the path that could still produce
     * it — a manager adding a rider to a car with no hall check. Checked here because
     * the consequence is a Sarthi driving to one building with somebody who needed the
     * other, and nothing in the app would say so.
     */
    const byDriver = new Map();
    for (const doc of rides.docs) {
        const d = doc.data() || {};
        if (!d.driverId || !d.locationId) continue;
        if (!['assigned', 'driver_en_route', 'arriving', 'in_progress', 'completed'].includes(d.status)) continue;
        const key = `${d.driverId}|${d.eventDate || d.date || d.eventId || '?'}`;
        if (!byDriver.has(key)) byDriver.set(key, new Set());
        byDriver.get(key).add(d.locationId);
    }
    for (const [key, halls_] of byDriver) {
        if (halls_.size > 1) {
            fail(`MIXED CAR: ${key} spans halls ${[...halls_].join(', ')}`);
        }
    }
    console.log(`  cars       ${byDriver.size} driver-evenings checked for mixed halls`);

    // ── events ────────────────────────────────────────────────────────────────
    const events = await db.collection('events').get();
    let badKey = 0;
    for (const doc of events.docs) {
        const at = doc.id.indexOf(EVENT_ID_SEPARATOR);
        if (at === -1) continue;                    // bare date: the founding hall
        const hall = doc.id.slice(at + EVENT_ID_SEPARATOR.length);
        if (!known.has(hall)) {
            badKey++;
            fail(`events/${doc.id} names hall "${hall}", which does not exist`);
        }
    }
    console.log(`  events     ${events.size} documents, ${badKey} naming an unknown hall`);

    console.log(problems === 0
        ? '\nOK — nothing points at a hall that does not exist.'
        : `\n${problems} problem(s). See above.`);
    return problems === 0 ? 0 : 1;
}

(async () => {
    if (mode === 'seed') process.exit(await seed());
    if (mode === 'add') process.exit(await add());
    if (mode === 'verify') process.exit(await verify());
    console.error('Usage: node scripts/locations.cjs seed [--apply]');
    console.error('       node scripts/locations.cjs add <id> "<name>" <lat> <lng> "<address>" [--active] [--apply]');
    console.error('       node scripts/locations.cjs verify');
    process.exit(1);
})().catch(err => {
    console.error(err);
    process.exit(1);
});
