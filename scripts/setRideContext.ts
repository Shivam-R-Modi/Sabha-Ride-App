// Run this script to set the ride context for testing
// Usage: npx ts-node scripts/setRideContext.ts

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', 'sabha-ride-app-firebase-adminsdk-fbsvc-24095ed3d5.json');
initializeApp({
    credential: cert(serviceAccountPath)
});

const db = getFirestore();

async function setRideContext() {
    try {
        // Set ride context for testing (home-to-sabha)
        await db.collection('system').doc('rideContext').set({
            rideType: 'home-to-sabha',
            displayText: 'Home → Sabha (Test Mode)',
            timeContext: 'Test mode - rides enabled',
            lastUpdated: new Date().toISOString()
        });

        console.log('✅ Ride context set successfully!');
        console.log('   rideType: home-to-sabha');
        console.log('   You can now test the "Assign Me" button');

    } catch (error) {
        console.error('Error setting ride context:', error);
    }

    process.exit(0);
}

setRideContext();
