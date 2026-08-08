/**
 * Stamp `cityId` / `locationId` onto existing users and rides, and verify that
 * nothing is left unstamped.
 *
 *   node scripts/tenancy.cjs verify          # counts unstamped, EXITS NON-ZERO if any
 *   node scripts/tenancy.cjs backfill        # dry run
 *   node scripts/tenancy.cjs backfill --apply
 *
 * ## Why the verifier is the important half
 *
 * The filtering these fields exist for does not ship in this release, and the
 * reason is an asymmetry worth stating plainly:
 *
 *   - A query with `where('cityId','==',…)` and NO INDEX fails loudly, with
 *     FAILED_PRECONDITION. Loud is survivable. (The indexes are already deployed,
 *     so this cannot happen anyway.)
 *   - The same query against an UNSTAMPED DOCUMENT does not fail at all. It
 *     correctly returns nothing. No error, no handler, no console line — and the
 *     hooks swallow snapshot errors into an empty list regardless.
 *
 * So an incomplete backfill is undetectable from the app: it looks exactly like
 * "no rides tonight". `verify` is the only thing standing between that and a
 * Friday evening, and it is meant to be run as the gate before any filter lands.
 *
 * Never removes or overwrites a value that is already there.
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
const CITY_ID = 'boston';
const LOCATION_ID = 'boston-huntington';

const COLLECTIONS = ['users', 'rides'];

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

const isStamped = (d) => typeof d.cityId === 'string' && d.cityId
                      && typeof d.locationId === 'string' && d.locationId;

async function verify() {
    console.log('Verifying tenancy stamps.\n');
    let totalUnstamped = 0;

    for (const name of COLLECTIONS) {
        const snap = await db.collection(name).get();
        const unstamped = snap.docs.filter(d => !isStamped(d.data() || {}));
        totalUnstamped += unstamped.length;

        console.log(`  ${name.padEnd(8)} ${String(snap.size).padStart(5)} documents, ` +
                    `${unstamped.length} unstamped`);
        // Naming them is the point: "3 unstamped" with no ids is not actionable.
        unstamped.slice(0, 10).forEach(d => console.log(`      ${d.id}`));
        if (unstamped.length > 10) console.log(`      … and ${unstamped.length - 10} more`);
    }

    if (totalUnstamped > 0) {
        console.error(`\nFAIL: ${totalUnstamped} unstamped document(s).`);
        console.error('Do NOT add a cityId filter to any query while this is non-zero — the query');
        console.error('will silently return nothing for these records rather than erroring.');
        process.exit(1);
    }

    console.log('\nOK: every document carries cityId and locationId.');
    process.exit(0);
}

async function backfill() {
    console.log('Using credentials: ' + path.basename(keyPath));
    console.log(APPLY ? 'APPLYING changes.\n' : 'DRY RUN — nothing will be written. Pass --apply to write.\n');

    let totalWrites = 0;

    for (const name of COLLECTIONS) {
        const snap = await db.collection(name).get();
        const writes = [];

        snap.forEach(doc => {
            const d = doc.data() || {};
            if (isStamped(d)) return;

            // Only fill what is missing. A record already naming a different city
            // is not this migration's to reassign.
            const patch = {};
            if (!d.cityId) patch.cityId = CITY_ID;
            if (!d.locationId) patch.locationId = LOCATION_ID;
            writes.push({ ref: doc.ref, patch, id: doc.id });
        });

        console.log(`  ${name}: ${snap.size} documents, ${writes.length} to stamp`);
        writes.slice(0, 20).forEach(w =>
            console.log(`      ${w.id}  += ${JSON.stringify(w.patch)}`));
        if (writes.length > 20) console.log(`      … and ${writes.length - 20} more`);

        if (APPLY) {
            for (let i = 0; i < writes.length; i += 400) {
                const batch = db.batch();
                writes.slice(i, i + 400).forEach(({ ref, patch }) => batch.update(ref, patch));
                await batch.commit();
            }
        }
        totalWrites += writes.length;
    }

    if (!APPLY) {
        console.log(`\n${totalWrites} document(s) would be stamped. Re-run with --apply.`);
    } else {
        console.log(`\nStamped ${totalWrites} document(s). Now run: node scripts/tenancy.cjs verify`);
    }
    process.exit(0);
}

if (mode === 'verify') verify().catch(e => { console.error('Failed:', e); process.exit(1); });
else if (mode === 'backfill') backfill().catch(e => { console.error('Failed:', e); process.exit(1); });
else {
    console.error('Usage:');
    console.error('  node scripts/tenancy.cjs verify');
    console.error('  node scripts/tenancy.cjs backfill [--apply]');
    process.exit(2);
}
