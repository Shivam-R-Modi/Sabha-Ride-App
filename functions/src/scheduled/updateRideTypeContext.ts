// ============================================
// SCHEDULED FUNCTION: updateRideTypeContext
// Runs every 1 minute to auto-detect ride type
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { RideContext, RideType } from '../types';
import { getZonedParts, DEFAULT_TIME_ZONE } from '../utils/time';

/**
 * Scheduled function that runs every minute
 * Automatically detects if it's pickup time or drop-off time
 */
export const updateRideTypeContext = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async (context) => {
        const db = admin.firestore();

        try {
            // First, check if test mode is active - if so, don't overwrite
            const currentContextDoc = await db.collection('system').doc('rideContext').get();
            if (currentContextDoc.exists) {
                const currentContext = currentContextDoc.data();
                if (currentContext?.testMode === true) {
                    console.log('Test mode is active - skipping automatic update');
                    return null;
                }
            }

            const now = new Date();
            const rideContext = determineRideContext(now);

            // Update the system ride context document
            await db.collection('system').doc('rideContext').set({
                ...rideContext,
                testMode: false, // Ensure testMode is explicitly false in auto mode
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
function determineRideContext(now: Date, timeZone: string = DEFAULT_TIME_ZONE): RideContext {
    // Sabha LOCAL time. Reading now.getDay()/getHours() here gave the UTC
    // server clock, which shifted the whole window 4-5 hours and rolled the
    // day over at 8 PM Boston — closing drop-off rides every Friday night.
    const { dayOfWeek, hour } = getZonedParts(now, timeZone);

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
 * Can be called with testMode: true and forceRideType: 'home-to-sabha' or 'sabha-to-home'
 */
export const manuallyUpdateRideContext = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const now = new Date();

    // Check if test mode is enabled
    if (data?.testMode && data?.forceRideType) {
        const testRideContext = {
            rideType: data.forceRideType as RideType,
            displayText: `${data.forceRideType === 'home-to-sabha' ? 'Home → Sabha' : 'Sabha → Home'} (Test Mode)`,
            timeContext: 'Test mode - rides enabled',
            testMode: true, // This flag prevents scheduled function from overwriting
            lastUpdated: now.toISOString()
        };

        await db.collection('system').doc('rideContext').set(testRideContext);
        return testRideContext;
    }

    // Normal mode - use time-based detection (disables test mode)
    const rideContext = determineRideContext(now);

    await db.collection('system').doc('rideContext').set({
        ...rideContext,
        testMode: false, // Disable test mode, let scheduled function take over
        lastUpdated: now.toISOString()
    });

    return rideContext;
});
