/**
 * Firebase Admin SDK Script to Create Manager Account
 * 
 * Prerequisites:
 * 1. npm install firebase-admin
 * 2. Download service account key from Firebase Console → Project Settings → Service Accounts
 * 3. Save as serviceAccountKey.json in project root
 * 4. Run: node scripts/create-manager.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// firebase-admin is a dependency of functions/, not of the root package.
const admin = (() => {
    try {
        return require('firebase-admin');
    } catch (err) {
        if (err.code !== 'MODULE_NOT_FOUND') throw err;
        return require(require.resolve('firebase-admin', {
            paths: [path.join(__dirname, '..', 'functions', 'node_modules')],
        }));
    }
})();

// Find the key by pattern. This required a file literally named
// serviceAccountKey.json; Firebase names a downloaded key
// <project>-firebase-adminsdk-<random>.json, and the random part changes on every
// rotation — so this script failed on a real checkout, which matters now that it
// is the last remaining way to create a manager if the invite flow ever breaks.
function findKeyPath() {
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

admin.initializeApp({ credential: admin.credential.cert(require(findKeyPath())) });

const db = admin.firestore();
const auth = admin.auth();

async function createManager(email, password, name, phone = '', address = '') {
    try {
        console.log(`Creating manager account for ${email}...`);

        // Create auth user
        const userRecord = await auth.createUser({
            email: email,
            password: password,
            displayName: name
        });

        console.log('✅ Auth user created:', userRecord.uid);

        // Create user document in Firestore
        await db.collection('users').doc(userRecord.uid).set({
            id: userRecord.uid,
            name: name,
            email: email,
            phone: phone,
            address: address,
            role: 'manager',
            registeredRole: 'manager',
            // The GRANTED set. This wrote `role` alone, so a manager created here
            // was invisible to every query asking who can drive — which is the
            // whole dispatch pool, since the drivers here are managers.
            roles: ['manager', 'driver', 'student'],
            activeRole: 'manager',
            accountStatus: 'approved',
            cityId: 'boston',
            locationId: 'boston-huntington',
            avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FF6B35&color=fff`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        console.log('✅ Firestore document created');

        // The read claim, so this manager is not stuck on the slower document
        // path. Best-effort: firestore.rules falls back to the document, so a
        // failure costs a lookup per read and nothing else.
        try {
            await auth.setCustomUserClaims(userRecord.uid, {
                mgr: true, sm: false, city: 'boston',
            });
            console.log('✅ Manager claim set');
        } catch (claimErr) {
            console.warn('⚠️  Could not set manager claim:', claimErr.message);
        }
        console.log('\n🎉 Manager account created successfully!');
        console.log('UID:', userRecord.uid);
        console.log('Email:', email);
        console.log('Name:', name);

    } catch (error) {
        console.error('❌ Error creating manager:', error.message);
        if (error.code === 'auth/email-already-exists') {
            console.log('   → Email already exists. Use a different email or delete the existing user first.');
        }
        if (error.code === 'auth/invalid-password') {
            console.log('   → Password must be at least 6 characters.');
        }
    } finally {
        process.exit(0);
    }
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 3) {
    console.log('Usage: node scripts/create-manager.js <email> <password> <name> [phone] [address]');
    console.log('');
    console.log('Example:');
    console.log('  node scripts/create-manager.js admin@example.com securepass123 "Admin Name" "+1234567890" "123 Main St"');
    console.log('');
    console.log('Note: Make sure serviceAccountKey.json exists in project root');
    process.exit(1);
}

const [email, password, name, phone, address] = args;

createManager(email, password, name, phone, address);
