/**
 * Initialization Script: Set Manager Access Code in Firestore
 *
 * This script creates the settings/managerCode document in Firestore
 * to replace the hard-coded MANAGER_ACCESS_CODE constant.
 *
 * Usage:
 *   node scripts/init-manager-code.js [new-code]
 *
 * Example:
 *   node scripts/init-manager-code.js SABHA2024
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin (use service account or local emulator)
if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log('Using Firestore Emulator...');
    admin.initializeApp({ projectId: 'demo-project' });
} else {
    // Production: requires service account JSON
    const serviceAccount = require(path.join(__dirname, '..', 'service-account.json'));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function setManagerCode(code) {
    try {
        console.log(`Setting manager access code: ${code}`);

        await db.collection('settings').doc('managerCode').set({
            code: code,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: 'initialization-script',
            description: 'Manager access code for auto-approving manager accounts'
        });

        console.log('✅ Manager code successfully set in Firestore: settings/managerCode');
        console.log('Managers can now use this code during registration');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error setting manager code:', error);
        process.exit(1);
    }
}

// Get code from command line argument or use default
const code = process.argv[2] || 'SABHA2024';

if (code.length < 6) {
    console.error('❌ Error: Manager code must be at least 6 characters');
    process.exit(1);
}

setManagerCode(code);
