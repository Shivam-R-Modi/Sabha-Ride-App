// ============================================
// HTTP FUNCTION: generateEventCSV
// Generates CSV export for manager with all ride requests
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

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
        // Verify the caller is a manager
        const userDoc = await db.collection('users').doc(context.auth.uid).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }

        const user = userDoc.data();
        // Check for both 'roles' array and 'role' string
        const isManager = (user?.roles?.includes?.('manager')) || user?.role === 'manager';
        if (!isManager) {
            throw new functions.https.HttpsError('permission-denied', 'Only managers can export data');
        }

        const rows: string[] = [];

        // Header
        rows.push('Student Name,Phone,Pickup Address,Status,Request Date');

        // Get all ride requests - query without filters first to avoid index issues
        const allRides = await db.collection('rides').get();

        const pendingRequests: any[] = [];
        const completedPickups = new Map();
        const completedDropoffs = new Map();

        for (const doc of allRides.docs) {
            const ride = doc.data();

            // Check if this is a pending request
            if (ride.status === 'requested') {
                pendingRequests.push({
                    id: doc.id,
                    ...ride
                });
            }
        }

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
            }
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
