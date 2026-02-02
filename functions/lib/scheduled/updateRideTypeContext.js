"use strict";
// ============================================
// SCHEDULED FUNCTION: updateRideTypeContext
// Runs every 1 minute to auto-detect ride type
// ============================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.manuallyUpdateRideContext = exports.updateRideTypeContext = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
/**
 * Scheduled function that runs every minute
 * Automatically detects if it's pickup time or drop-off time
 */
exports.updateRideTypeContext = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async (context) => {
    const db = admin.firestore();
    try {
        const now = new Date();
        const rideContext = determineRideContext(now);
        // Update the system ride context document
        await db.collection('system').doc('rideContext').set(Object.assign(Object.assign({}, rideContext), { lastUpdated: now.toISOString() }));
        console.log('Ride context updated:', rideContext);
        return null;
    }
    catch (error) {
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
function determineRideContext(now) {
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
            rideType: 'home-to-sabha',
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
        rideType: 'sabha-to-home',
        displayText: 'Sabha → Home (Auto-detected)',
        timeContext: 'After Sabha ends',
        lastUpdated: now.toISOString()
    };
}
/**
 * HTTP function to manually trigger ride context update (for testing)
 */
exports.manuallyUpdateRideContext = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const db = admin.firestore();
    const now = new Date();
    const rideContext = determineRideContext(now);
    await db.collection('system').doc('rideContext').set(Object.assign(Object.assign({}, rideContext), { lastUpdated: now.toISOString() }));
    return rideContext;
});
//# sourceMappingURL=updateRideTypeContext.js.map