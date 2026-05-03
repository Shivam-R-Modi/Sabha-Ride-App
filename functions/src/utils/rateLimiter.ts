// ============================================
// RATE LIMITER UTILITY
// Simple Firestore-based rate limiting for Cloud Functions
// ============================================

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

interface RateLimitConfig {
    maxRequests: number;      // Max requests allowed in time window
    windowMs: number;         // Time window in milliseconds
    functionName: string;     // Name of the function being rate limited
}

/**
 * Check if user has exceeded rate limit
 * Uses Firestore to track request counts per user
 *
 * @param userId - User ID to check
 * @param config - Rate limit configuration
 * @throws HttpsError if rate limit exceeded
 */
export async function checkRateLimit(
    userId: string,
    config: RateLimitConfig
): Promise<void> {
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
                const storedReset = data?.lastReset || 0;

                // If within the same window, increment count
                if (storedReset > windowStart) {
                    requestCount = (data?.count || 0) + 1;
                    lastReset = storedReset;
                } else {
                    // Window expired, reset
                    requestCount = 1;
                    lastReset = now;
                }
            } else {
                // First request
                requestCount = 1;
                lastReset = now;
            }

            // Check if limit exceeded
            if (requestCount > config.maxRequests) {
                const resetIn = Math.ceil((lastReset + config.windowMs - now) / 1000);
                throw new functions.https.HttpsError(
                    'resource-exhausted',
                    `Rate limit exceeded for ${config.functionName}. Please try again in ${resetIn} seconds.`
                );
            }

            // Update count
            transaction.set(rateLimitRef, {
                count: requestCount,
                lastReset: lastReset,
                updatedAt: now
            });
        });
    } catch (error) {
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
export async function cleanupOldRateLimits(): Promise<void> {
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
