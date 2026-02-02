// ============================================
// SCHEDULED FUNCTION: updateRideTypeContext
// Runs every 1 minute to auto-detect ride type
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { RideContext, RideType } from '../types';

/**
 * Scheduled function that runs every minute
 * Automatically detects if it's pickup time or drop-off time
 */
export const updateRideTypeContext = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async (context) => {
        const db = admin.firestore();

        try {
            const now = new Date();
            const rideContext = determineRideContext(now);

            // Update the system ride context document
            await db.collection('system').doc('rideContext').set({
                ...rideContext,
                lastUpdated: now.toISOString()
            });

            console.log('Ride context updated:', rideContext);
            return null;
        } catch (error) {
            console.error('Error updating ride context:', error);
            return null;
        }
    });

/**
 * Determine the current ride context based on day and time
 * Rules:
 * - If NOT Friday → No rides available
 * - If Friday AND before 7 PM (hour < 19) → Pickup rides (Home → Sabha)
 * - If Friday AND after 10 PM (hour >= 22) → Drop-off rides (Sabha → Home)
 * - If Friday AND between 7 PM - 10 PM → During Sabha (no rides)
 */
function determineRideContext(now: Date): RideContext {
    const dayOfWeek = now.getDay(); // 0 = Sunday, 5 = Friday
    const hour = now.getHours();

    // Check if it's Friday
    const isFriday = dayOfWeek === 5;

    if (!isFriday) {
        return {
            rideType: null,
            displayText: 'No rides available',
            timeContext: 'Rides only available on Fridays',
            lastUpdated: now.toISOString()
        };
    }

    // Friday before 7 PM - Pickup time
    if (hour < 19) {
        return {
            rideType: 'home-to-sabha' as RideType,
            displayText: 'Home → Sabha (Auto-detected)',
            timeContext: 'Before Sabha starts',
            lastUpdated: now.toISOString()
        };
    }

    // Friday between 7 PM - 10 PM - During Sabha
    if (hour >= 19 && hour < 22) {
        return {
            rideType: null,
            displayText: 'Sabha in Progress',
            timeContext: 'Drop-off rides available after 10 PM',
            lastUpdated: now.toISOString()
        };
    }

    // Friday after 10 PM - Drop-off time
    return {
        rideType: 'sabha-to-home' as RideType,
        displayText: 'Sabha → Home (Auto-detected)',
        timeContext: 'After Sabha ends',
        lastUpdated: now.toISOString()
    };
}

/**
 * HTTP function to manually trigger ride context update (for testing)
 */
export const manuallyUpdateRideContext = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const now = new Date();
    const rideContext = determineRideContext(now);

    await db.collection('system').doc('rideContext').set({
        ...rideContext,
        lastUpdated: now.toISOString()
    });

    return rideContext;
});
