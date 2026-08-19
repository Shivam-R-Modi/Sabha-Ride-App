// ============================================
// HTTP FUNCTION: generateEventCSV
// Generates CSV export for manager with all ride requests
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';

/**
 * HTTP Callable: Generate CSV export for an event
 * Input: { eventDate: string } (YYYY-MM-DD format)
 * Output: { csvContent: string }
 */
export const generateEventCSV = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { eventDate } = data || {};

    // Use today's date if no date provided
    const targetDate = eventDate || new Date().toISOString().split('T')[0];

    const db = admin.firestore();

    try {
        // This check skipped `accountStatus`, and the rows below are every
        // rider's name, phone number and home address. A manager whose account
        // had been rejected could still export the lot — revocation never reached
        // the one function where it mattered most.
        await assertApprovedManager(db, context.auth.uid, 'export data');

        // THROTTLED, not merely authorised.
        //
        // The rows below are every rider's name, phone number and home address —
        // the most sensitive thing this app can emit, and for a congregation that
        // includes minors. `assertApprovedManager` answers "may you export?"; it
        // cannot answer "why are you exporting for the 400th time tonight?"
        //
        // A compromised or borrowed manager session is the realistic threat, and
        // an unthrottled export turns it into a bulk dump of the whole community
        // in seconds. 20/hour is far above any real use — a manager exports once
        // per gathering, maybe a handful of times while fixing a spreadsheet —
        // and far below what exfiltration needs.
        //
        // Deliberately AFTER the manager check, so a stranger probing this
        // endpoint is refused for the right reason and never consumes a
        // legitimate manager's budget.
        await checkRateLimit(context.auth.uid, {
            maxRequests: 20,
            windowMs: 60 * 60 * 1000,
            functionName: 'generateEventCSV',
        });

        const rows: string[] = [];

        // Header
        rows.push('Bhulku Name,Phone,Pickup Address,Status,Request Date');

        // Maximum rows to prevent timeout (can be increased if needed)
        const MAX_ROWS = 500;
        let hitLimit = false;

        // Get pending ride requests with limit to prevent timeout
        const pendingQuery = db.collection('rides')
            .where('status', '==', 'requested')
            .limit(MAX_ROWS);

        const pendingSnapshot = await pendingQuery.get();
        const pendingRequests: any[] = pendingSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        if (pendingSnapshot.size >= MAX_ROWS) {
            hitLimit = true;
        }

        const completedPickups = new Map();
        const completedDropoffs = new Map();

        // Get statistics for completed rides
        const statsDoc = await db.collection('statistics').doc(targetDate).get();
        if (statsDoc.exists && statsDoc.data()) {
            const stats = statsDoc.data();

            (stats?.pickup?.students || []).forEach((s: any) => {
                completedPickups.set(s.id, s);
            });

            (stats?.dropoff?.students || []).forEach((s: any) => {
                completedDropoffs.set(s.id, s);
            });
        }

        // Add pending requests to CSV
        if (pendingRequests.length > 0) {
            for (const request of pendingRequests) {
                rows.push([
                    escapeCsvField(request.studentName || 'Unknown'),
                    escapeCsvField(request.studentPhone || request.phone || ''),
                    escapeCsvField(request.pickupAddress || ''),
                    'Pending Request',
                    escapeCsvField(request.createdAt ? new Date(request.createdAt).toLocaleDateString() : targetDate)
                ].join(','));
            }
        }

        // Add completed rides from statistics
        const allStudentIds = new Set([...completedPickups.keys(), ...completedDropoffs.keys()]);
        for (const studentId of allStudentIds) {
            const pickup = completedPickups.get(studentId);
            const dropoff = completedDropoffs.get(studentId);

            let eventType = 'Both';
            if (pickup && !dropoff) eventType = 'Pickup Only';
            else if (!pickup && dropoff) eventType = 'Drop-off Only';

            rows.push([
                escapeCsvField(pickup?.name || dropoff?.name || 'Unknown'),
                escapeCsvField(pickup?.phone || ''),
                escapeCsvField(pickup?.address || dropoff?.address || ''),
                eventType,
                targetDate
            ].join(','));
        }

        const csvContent = rows.join('\n');

        return {
            success: true,
            eventDate: targetDate,
            csvContent,
            summary: {
                totalStudents: rows.length - 1, // Subtract header row
                pendingRequests: pendingRequests.length,
                completedRides: allStudentIds.size
            },
            warning: hitLimit ? `Results limited to ${MAX_ROWS} pending requests. Some data may be excluded.` : undefined
        };

    } catch (error) {
        console.error('Error generating CSV:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to generate CSV: ' + (error as Error).message);
    }
});

/**
 * Escape a field for CSV format
 * Wraps in quotes if contains comma, newline, or quote
 */
function escapeCsvField(field: string): string {
    if (!field) return '';

    // If field contains comma, newline, or quote, wrap in quotes
    if (field.includes(',') || field.includes('\n') || field.includes('"')) {
        // Double up any quotes
        const escaped = field.replace(/"/g, '""');
        return `"${escaped}"`;
    }

    return field;
}
