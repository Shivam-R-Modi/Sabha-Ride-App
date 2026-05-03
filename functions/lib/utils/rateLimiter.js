"use strict";
// ============================================
// RATE LIMITER UTILITY
// Simple Firestore-based rate limiting for Cloud Functions
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
exports.checkRateLimit = checkRateLimit;
exports.cleanupOldRateLimits = cleanupOldRateLimits;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
/**
 * Check if user has exceeded rate limit
 * Uses Firestore to track request counts per user
 *
 * @param userId - User ID to check
 * @param config - Rate limit configuration
 * @throws HttpsError if rate limit exceeded
 */
async function checkRateLimit(userId, config) {
    const db = admin.firestore();
    const now = Date.now();
    const windowStart = now - config.windowMs;
    const rateLimitRef = db.collection('rateLimits')
        .doc(userId)
        .collection('requests')
        .doc(config.functionName);
    try {
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(rateLimitRef);
            let requestCount = 0;
            let lastReset = now;
            if (doc.exists) {
                const data = doc.data();
                const storedReset = (data === null || data === void 0 ? void 0 : data.lastReset) || 0;
                // If within the same window, increment count
                if (storedReset > windowStart) {
                    requestCount = ((data === null || data === void 0 ? void 0 : data.count) || 0) + 1;
                    lastReset = storedReset;
                }
                else {
                    // Window expired, reset
                    requestCount = 1;
                    lastReset = now;
                }
            }
            else {
                // First request
                requestCount = 1;
                lastReset = now;
            }
            // Check if limit exceeded
            if (requestCount > config.maxRequests) {
                const resetIn = Math.ceil((lastReset + config.windowMs - now) / 1000);
                throw new functions.https.HttpsError('resource-exhausted', `Rate limit exceeded for ${config.functionName}. Please try again in ${resetIn} seconds.`);
            }
            // Update count
            transaction.set(rateLimitRef, {
                count: requestCount,
                lastReset: lastReset,
                updatedAt: now
            });
        });
    }
    catch (error) {
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        // Don't block requests if rate limiter fails
        console.error('Rate limiter error (allowing request):', error);
    }
}
/**
 * Clean up old rate limit documents (call this periodically via scheduled function)
 */
async function cleanupOldRateLimits() {
    const db = admin.firestore();
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    const batch = db.batch();
    let deleteCount = 0;
    // Query all rate limit documents
    const usersSnapshot = await db.collection('rateLimits').listDocuments();
    for (const userDoc of usersSnapshot) {
        const requestsSnapshot = await userDoc.collection('requests').get();
        for (const requestDoc of requestsSnapshot.docs) {
            const data = requestDoc.data();
            if (data.updatedAt < cutoff) {
                batch.delete(requestDoc.ref);
                deleteCount++;
            }
        }
    }
    if (deleteCount > 0) {
        await batch.commit();
        console.log(`Cleaned up ${deleteCount} old rate limit records`);
    }
}
//# sourceMappingURL=rateLimiter.js.map