/**
 * Sets the manager access code in Firestore settings.
 *
 * Prerequisites:
 * 1. npm install firebase-admin (if not already)
 * 2. serviceAccountKey.json in project root
 * 3. Run: node scripts/set-manager-code.js
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require(path.join(__dirname, '../serviceAccountKey.json'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function setManagerCode(code) {
    try {
        await db.collection('settings').doc('managerCode').set({
            code: code,
            updatedAt: new Date().toISOString()
        });
        console.log(`✅ Manager access code set to: "${code}"`);
        console.log('   Stored in: settings/managerCode');
    } catch (error) {
        console.error('❌ Error setting manager code:', error.message);
    } finally {
        process.exit(0);
    }
}

const code = process.argv[2] || 'sabha2024';
console.log(`Setting manager access code to: "${code}"...`);
setManagerCode(code);
