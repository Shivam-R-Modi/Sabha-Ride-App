/**
 * Write the role hierarchy into `roles[]`. ADDITIVE ONLY.
 *
 * The app has always assumed a manager may act as a driver or a student — the
 * role switcher offers exactly that — but the assumption lived only in a hardcoded
 * switch in the UI. The stored `roles` array said `['manager']`, so every query
 * asking "who can drive?" missed every manager, and in this deployment the
 * managers ARE the drivers.
 *
 * The measured consequence, before this ran: `globalAssignDriver` seeds its
 * clustering from a driver query that matched **nobody**, so every dispatch ran
 * K=1 and one driver was handed every rider instead of the nearest share. The
 * manager dashboard's "assign to any driver" list was empty for the same reason.
 *
 * After this, `roles` is the GRANTED set — everything the person may act as —
 * and one query serves every caller with no special cases:
 *
 *     manager  ->  ['manager', 'driver', 'student']
 *     driver   ->  ['driver', 'student']
 *     student  ->  ['student']
 *
 * Expansion runs DOWNWARD only. Nothing here can turn a driver into a manager:
 * a role is only ever added from a role the document already records, and
 * 'manager' is only ever produced by an existing 'manager'.
 *
 * Never removes a role, so re-running is safe and a hand-edited extra role
 * survives. Idempotent. Dry run by default.
 *
 *   node scripts/backfill-granted-roles.cjs            # dry run
 *   node scripts/backfill-granted-roles.cjs --apply
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
    console.error('Or pass one explicitly:  --key /path/to/key.json');
    process.exit(1);
}

const keyPath = findKeyPath();
admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
const db = admin.firestore();

// Must match IMPLIES in src/roles.ts and functions/src/utils/roles.ts.
const IMPLIES = {
    manager: ['manager', 'driver', 'student'],
    driver: ['driver', 'student'],
    student: ['student'],
};
const ORDER = ['manager', 'driver', 'student'];

function recordedRoles(u) {
    const found = new Set();
    [u.role, u.registeredRole].forEach(r => { if (IMPLIES[r]) found.add(r); });
    if (Array.isArray(u.roles)) u.roles.forEach(r => { if (IMPLIES[r]) found.add(r); });
    return ORDER.filter(r => found.has(r));
}

function grantedRoles(u) {
    const granted = new Set();
    recordedRoles(u).forEach(r => IMPLIES[r].forEach(g => granted.add(g)));
    return ORDER.filter(r => granted.has(r));
}

async function run() {
    console.log('Using credentials: ' + path.basename(keyPath));
    console.log(APPLY ? 'APPLYING changes.\n' : 'DRY RUN — nothing will be written. Pass --apply to write.\n');

    const snap = await db.collection('users').get();
    const writes = [];
    let unchanged = 0;
    let noRole = 0;

    snap.forEach(doc => {
        const u = doc.data() || {};
        const current = Array.isArray(u.roles) ? u.roles.filter(r => IMPLIES[r]) : [];
        const target = grantedRoles(u);

        if (target.length === 0) {
            noRole++;
            console.log(`  SKIP  ${doc.id}  records no recognisable role`);
            return;
        }

        // Union, never a replacement: an unrecognised or hand-added entry stays.
        const merged = ORDER.filter(r => target.includes(r) || current.includes(r));
        const extras = (Array.isArray(u.roles) ? u.roles : []).filter(r => !IMPLIES[r]);
        const final = [...merged, ...extras];

        const same = final.length === (u.roles || []).length
            && final.every((r, i) => (u.roles || [])[i] === r);
        if (same) { unchanged++; return; }

        console.log(`  SET   ${doc.id}  [${(u.roles || []).join(', ')}] -> [${final.join(', ')}]`);
        writes.push({ ref: doc.ref, roles: final });
    });

    console.log(`\n  ${snap.size} users: ${unchanged} already correct, ${writes.length} to update, ${noRole} skipped`);

    if (!APPLY || writes.length === 0) {
        if (writes.length > 0) console.log('\nRe-run with --apply to write these.');
        process.exit(0);
    }

    // Chunked at 400; Firestore caps a batch at 500.
    for (let i = 0; i < writes.length; i += 400) {
        const batch = db.batch();
        writes.slice(i, i + 400).forEach(({ ref, roles }) => batch.update(ref, { roles }));
        await batch.commit();
    }

    console.log(`\n  Updated ${writes.length} user(s). Re-run to confirm it reports 0 to update.`);
    process.exit(0);
}

run().catch(err => { console.error('Failed:', err); process.exit(1); });
