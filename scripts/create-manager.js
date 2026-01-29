/**
 * Firebase Admin SDK Script to Create Manager Account
 * 
 * Prerequisites:
 * 1. npm install firebase-admin
 * 2. Download service account key from Firebase Console → Project Settings → Service Accounts
 * 3. Save as serviceAccountKey.json in project root
 * 4. Run: node scripts/create-manager.js
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require(path.join(__dirname, '../serviceAccountKey.json'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

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
            accountStatus: 'approved',
            avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FF6B35&color=fff`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        console.log('✅ Firestore document created');
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
