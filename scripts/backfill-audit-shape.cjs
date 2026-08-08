/**
 * Make the invisible audit rows visible. ADDITIVE ONLY.
 *
 * The console lists audit rows with `orderBy('timestamp', 'desc')`, and Firestore
 * excludes documents that lack the orderBy field entirely. `deleteSabhaEvent` wrote
 * `performedAt` instead, so every sabha deletion was absent from the Audit Logs
 * tab — the most destructive action in the app was the one action the screen could
 * never show. At the time of writing that is 5 rows out of 38.
 *
 * This script only ADDS `timestamp` (copied from `performedAt`) and a derived
 * `summary` to those rows. It never edits or removes an existing field:
 * `performedAt`, `state`, `details` and `performedBy` all stay exactly as written.
 * A migration that rewrites audit history is the one migration that undermines the
 * artefact it is migrating, so the old row remains readable as it was recorded, and
 * the new fields are strictly additional.
 *
 * Idempotent: a row that already has `timestamp` is skipped, so re-running is safe.
 * Defaults to a dry run.
 *
 * The append-only rules deny client updates to auditLogs (deliberately), so this
 * has to run through the Admin SDK.
 *
 *   Setup (one-off): Firebase console → Project Settings → Service Accounts →
 *   "Generate new private key", save it as serviceAccountKey.json in the repo root.
 *   It is gitignored. The same key is needed for the tenancy backfill later.
 *
 *   node scripts/backfill-audit-shape.cjs             # dry run, changes nothing
 *   node scripts/backfill-audit-shape.cjs --apply     # writes
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * firebase-admin is a dependency of functions/, not of the root package, so a
 * plain require() from scripts/ fails with MODULE_NOT_FOUND. Resolve it from
 * functions/node_modules rather than asking anyone to install it twice.
 */
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

/**
 * Find an Admin SDK key without being told its exact name.
 *
 * Firebase names a downloaded key `<project>-firebase-adminsdk-<random>.json`, and
 * the random part changes with every key you generate — so hardcoding a filename
 * (as scripts/setRideContext.cjs still does) breaks the moment a key is rotated.
 * Search by pattern instead.
 *
 * Also searches the main worktree: this repo uses git worktrees, and the key
 * lives once in the primary checkout rather than being copied into each one.
 */
function findKeyPath() {
    const explicit = process.argv.indexOf('--key');
    if (explicit !== -1 && process.argv[explicit + 1]) return process.argv[explicit + 1];
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;

    const dirs = [path.join(__dirname, '..'), process.cwd()];
    try {
        // The primary worktree, when this is running from a linked one.
        const main = execSync('git worktree list --porcelain', { cwd: __dirname })
            .toString().split('\n').find(l => l.startsWith('worktree '));
        if (main) dirs.push(main.slice('worktree '.length).trim());
    } catch { /* not a worktree, or no git; the other paths still apply */ }

    for (const dir of dirs) {
        let entries = [];
        try {
            entries = fs.readdirSync(dir);
        } catch { continue; }

        const match = entries.find(f =>
            f === 'serviceAccountKey.json' || /-firebase-adminsdk-.*\.json$/.test(f));
        if (match) return path.join(dir, match);
    }

    console.error('No Admin SDK key found. Searched:');
    dirs.forEach(d => console.error('  ' + d));
    console.error('\nFirebase console → Project Settings → Service Accounts → Generate new private key.');
    console.error('Or pass one explicitly:  --key /path/to/key.json');
    process.exit(1);
}

function loadCredential() {
    const keyPath = findKeyPath();
    console.log('Using credentials: ' + path.basename(keyPath) + '\n');
    return require(keyPath);
}

admin.initializeApp({ credential: admin.credential.cert(loadCredential()) });
const db = admin.firestore();

/** A human line for a row that never had one. */
function summarise(data) {
    const date = data.documentId || 'an unknown date';
    const d = data.details || {};
    const responses = typeof d.responseCount === 'number' ? d.responseCount : null;
    const rides = Array.isArray(d.requestedRideIds) ? d.requestedRideIds.length : null;

    if (responses === null && rides === null) return `Deleted the sabha on ${date}`;
    if (!responses && !rides) return `Deleted the sabha on ${date} — nobody had responded`;
    return `Deleted the sabha on ${date} — ${responses ?? 0} attending, `
        + `${rides ?? 0} ride request(s) cancelled`;
}

async function run() {
    console.log(APPLY ? 'APPLYING changes.\n' : 'DRY RUN — nothing will be written. Pass --apply to write.\n');

    const snap = await db.collection('auditLogs').get();

    let alreadyFine = 0;
    let fixable = 0;
    let unfixable = 0;
    const writes = [];

    snap.forEach(doc => {
        const data = doc.data() || {};

        if (typeof data.timestamp === 'string' && data.timestamp) {
            alreadyFine++;
            return;
        }

        // `performedAt` is the only other time this row could have been written.
        // Without one, inventing a timestamp would put a fabricated time into an
        // audit record — worse than leaving the row where it is.
        if (typeof data.performedAt !== 'string' || !data.performedAt) {
            unfixable++;
            console.log(`  SKIP  ${doc.id} — no timestamp and no performedAt; not inventing one`);
            return;
        }

        fixable++;
        const patch = { timestamp: data.performedAt };
        if (!data.summary) patch.summary = summarise(data);

        console.log(`  FIX   ${doc.id}  ${data.performedAt}  ${patch.summary || '(summary already present)'}`);
        writes.push({ ref: doc.ref, patch });
    });

    console.log(`\n  ${snap.size} rows: ${alreadyFine} already visible, ${fixable} to fix, ${unfixable} skipped`);

    if (!APPLY || writes.length === 0) {
        if (writes.length > 0) console.log('\nRe-run with --apply to write these.');
        process.exit(0);
    }

    // Small collection; one batch is plenty. Firestore caps a batch at 500.
    const batch = db.batch();
    writes.forEach(({ ref, patch }) => batch.set(ref, patch, { merge: true }));
    await batch.commit();

    console.log(`\n  Wrote ${writes.length} row(s). Re-run to confirm it reports 0 to fix.`);
    process.exit(0);
}

run().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
});
