/**
 * Put a `mgr` claim on every approved manager's token.
 *
 * firestore.rules honours the claim for READS ONLY (isManagerForRead), which
 * skips a billed get() of the caller's own user document on every manager read —
 * on a list, once per document delivered. Writes, deletes and the
 * settings/managerCode read still go through isManager(), which reads the
 * document, so revocation stays instant where it matters.
 *
 * The claim is derived from the document, never the other way round. If the two
 * ever disagree the document wins, because that is what every destructive path
 * reads. This script is therefore always safe to re-run: it recomputes from
 * current documents and only writes where the claim differs.
 *
 * `city` is minted now, ahead of any city scoping, so that work needs no second
 * claim migration. `sm` (super-manager) is reserved and always false — there is
 * no console to manage it and no code reads it.
 *
 *   node scripts/mint-manager-claims.cjs           # dry run
 *   node scripts/mint-manager-claims.cjs --apply
 *   node scripts/mint-manager-claims.cjs --apply --revoke-tokens
 *
 * --revoke-tokens additionally forces every affected user's existing sessions to
 * fetch a new token immediately. Use it when REMOVING a claim from someone who
 * should no longer be a manager; without it their stale `mgr: true` survives on
 * their current token for up to an hour.
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
const REVOKE = process.argv.includes('--revoke-tokens');

// Must match FOUNDING_CITY_ID in src/constants/tenancy.ts.
const CITY_ID = 'boston';

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
const auth = admin.auth();

/** Mirrors isApprovedManagerData in functions/src/utils/authz.ts. Recorded, not granted. */
function isApprovedManager(u) {
    if (u.accountStatus !== 'approved') return false;
    return u.role === 'manager'
        || u.registeredRole === 'manager'
        || (Array.isArray(u.roles) && u.roles.includes('manager'));
}

async function run() {
    console.log('Using credentials: ' + path.basename(keyPath));
    console.log(APPLY ? 'APPLYING changes.\n' : 'DRY RUN — nothing will be written. Pass --apply to write.\n');

    const snap = await db.collection('users').get();
    const changes = [];
    let alreadyCorrect = 0;
    let missingAuth = 0;

    for (const doc of snap.docs) {
        const u = doc.data() || {};
        const shouldBeManager = isApprovedManager(u);

        let existing;
        try {
            existing = (await auth.getUser(doc.id)).customClaims || {};
        } catch (err) {
            // A Firestore profile with no Auth account — a half-deleted user, or
            // one seeded by a script. Nothing to mint a claim onto.
            if (err.code === 'auth/user-not-found') {
                missingAuth++;
                console.log(`  SKIP  ${doc.id}  no Firebase Auth account`);
                continue;
            }
            throw err;
        }

        const target = shouldBeManager
            ? { mgr: true, sm: false, city: CITY_ID }
            : {};

        const same = JSON.stringify({ ...existing }) === JSON.stringify(target);
        if (same) { alreadyCorrect++; continue; }

        const verb = shouldBeManager ? 'GRANT ' : 'REVOKE';
        console.log(`  ${verb} ${doc.id}  ${JSON.stringify(existing)} -> ${JSON.stringify(target)}`);
        changes.push({ uid: doc.id, target, revoking: !shouldBeManager });
    }

    console.log(`\n  ${snap.size} users: ${alreadyCorrect} already correct, ${changes.length} to change, ${missingAuth} without an auth account`);

    if (!APPLY || changes.length === 0) {
        if (changes.length > 0) console.log('\nRe-run with --apply to write these.');
        process.exit(0);
    }

    for (const { uid, target, revoking } of changes) {
        await auth.setCustomUserClaims(uid, target);
        // A removed claim lingers on an existing token until it refreshes. For a
        // grant that is harmless; for a revocation it is the whole problem.
        if (revoking || REVOKE) await auth.revokeRefreshTokens(uid);
    }

    console.log(`\n  Updated ${changes.length} user(s).`);
    console.log('  Claims land on a token at its next refresh (up to ~1 hour), or immediately');
    console.log('  after a sign-out/in or a getIdToken(true). Reads keep working via the');
    console.log('  document check in the meantime — that is what the OR in the rules is for.');
    process.exit(0);
}

run().catch(err => { console.error('Failed:', err); process.exit(1); });
