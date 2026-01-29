/**
 * Firebase Admin SDK Script to Clear All Mock Data from Firestore
 * 
 * WARNING: This will delete ALL documents from the following collections:
 * - users (except your manager account if specified)
 * - rides
 * - vehicles
 * 
 * Prerequisites:
 * 1. npm install firebase-admin
 * 2. Download service account key from Firebase Console → Project Settings → Service Accounts
 * 3. Save as serviceAccountKey.json in project root
 * 4. Run: node scripts/clear-database.cjs --confirm
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require(path.join(__dirname, '../serviceAccountKey.json'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Collections to clear
const COLLECTIONS_TO_CLEAR = ['rides', 'vehicles'];

async function deleteCollection(collectionRef, batchSize = 100) {
    const query = collectionRef.limit(batchSize);

    return new Promise((resolve, reject) => {
        deleteQueryBatch(db, query, resolve).catch(reject);
    });
}

async function deleteQueryBatch(db, query, resolve) {
    const snapshot = await query.get();

    const batchSize = snapshot.size;
    if (batchSize === 0) {
        // When there are no documents left, we are done
        resolve();
        return;
    }

    // Delete documents in a batch
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });

    await batch.commit();

    // Recurse on the next process tick, to avoid
    // exploding the stack.
    process.nextTick(() => {
        deleteQueryBatch(db, query, resolve);
    });
}

async function clearUsersCollection() {
    console.log('Clearing users collection (keeping non-mock users)...');

    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();

    let deletedCount = 0;
    const batch = db.batch();

    snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const id = doc.id;

        // Check if this looks like a mock user
        const isMockUser =
            (id.startsWith('d') && !isNaN(id.substring(1))) ||  // d1, d2, d3...
            (id.startsWith('u') && !isNaN(id.substring(1))) ||  // u1, u2, u3...
            id.startsWith('sr_') ||                             // sr_1, sr_2...
            (data.email && data.email.includes('@example.com')) || // driver_d1@example.com
            (data.name && data.name.includes('Student ')) ||     // Student 1, Student 2
            data.name === 'Rajesh Kumar' ||                      // Known mock names
            data.name === 'Sanjay Shah' ||
            data.name === 'Amit Patel' ||
            data.name === 'Priya Desai' ||
            data.name === 'Vikram Singh' ||
            data.name === 'Rohan Gupta' ||
            data.name === 'Aarav Patel' ||                       // Mock student
            data.name === 'Priya S.' ||
            data.name === 'Dev M.' ||
            data.name === 'Rohan G.' ||
            data.name === 'Kavya P.';

        if (isMockUser) {
            batch.delete(doc.ref);
            deletedCount++;
            console.log(`  → Marked for deletion: ${id} (${data.name || 'no name'})`);
        } else {
            console.log(`  → Keeping: ${id} (${data.name || 'no name'})`);
        }
    });

    if (deletedCount > 0) {
        await batch.commit();
        console.log(`✅ Deleted ${deletedCount} mock users`);
    } else {
        console.log('ℹ️ No mock users found');
    }
}

async function clearCollection(collectionName) {
    console.log(`\nClearing collection: ${collectionName}...`);
    const collectionRef = db.collection(collectionName);
    await deleteCollection(collectionRef);
    console.log(`✅ Collection ${collectionName} cleared`);
}

async function clearDatabase() {
    console.log('========================================');
    console.log('  FIRESTORE DATABASE CLEANUP');
    console.log('========================================\n');

    try {
        // Clear rides collection
        await clearCollection('rides');

        // Clear vehicles collection
        await clearCollection('vehicles');

        // Clear mock users (keeping real users)
        await clearUsersCollection();

        console.log('\n========================================');
        console.log('  DATABASE CLEANUP COMPLETE!');
        console.log('========================================');
        console.log('\nYour Firestore database is now clean.');
        console.log('You can now create real users and data.');

    } catch (error) {
        console.error('\n❌ Error clearing database:', error.message);
        process.exit(1);
    }

    process.exit(0);
}

// Confirm before running
console.log('This script will DELETE all mock data from your Firestore database.');
console.log('Collections affected: rides, vehicles, users (mock users only)\n');
console.log('To proceed, run: node scripts/clear-database.cjs --confirm\n');

if (process.argv.includes('--confirm')) {
    clearDatabase();
} else {
    console.log('⚠️  Add --confirm flag to actually delete data');
    process.exit(0);
}
