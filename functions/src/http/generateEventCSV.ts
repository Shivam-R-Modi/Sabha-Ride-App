// ============================================
// HTTP FUNCTION: generateEventCSV
// Generates CSV export for manager
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

    const { eventDate } = data;

    if (!eventDate) {
        throw new functions.https.HttpsError('invalid-argument', 'eventDate is required (YYYY-MM-DD format)');
    }

    const db = admin.firestore();

    try {
        // Verify the caller is a manager
        const userDoc = await db.collection('users').doc(context.auth.uid).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }

        const user = userDoc.data();
        if (!user?.roles?.includes('manager')) {
            throw new functions.https.HttpsError('permission-denied', 'Only managers can export data');
        }

        // Get statistics for the event
        const statsDoc = await db.collection('statistics').doc(eventDate).get();

        if (!statsDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'No data found for this date');
        }

        const stats = statsDoc.data();

        // Build CSV content
        const rows: string[] = [];

        // Header
        rows.push('Event Date,Event Type,Student Name,Pickup Driver,Pickup Car,Drop-off Driver,Drop-off Car');

        // Collect all student IDs from pickup and dropoff
        const pickupStudents = new Map();
        const dropoffStudents = new Map();

        (stats?.pickup?.students || []).forEach((s: any) => {
            pickupStudents.set(s.id, {
                name: s.name,
                driverName: s.driverName || '',
                carModel: s.carModel || ''
            });
        });

        (stats?.dropoff?.students || []).forEach((s: any) => {
            dropoffStudents.set(s.id, {
                name: s.name,
                driverName: s.driverName || '',
                carModel: s.carModel || ''
            });
        });

        // Get all unique student IDs
        const allStudentIds = new Set([...pickupStudents.keys(), ...dropoffStudents.keys()]);

        // Generate rows
        for (const studentId of allStudentIds) {
            const pickup = pickupStudents.get(studentId);
            const dropoff = dropoffStudents.get(studentId);

            let eventType: string;
            if (pickup && dropoff) {
                eventType = 'Both';
            } else if (pickup) {
                eventType = 'Pickup Only';
            } else {
                eventType = 'Drop-off Only';
            }

            const studentName = pickup?.name || dropoff?.name || 'Unknown';

            rows.push([
                eventDate,
                eventType,
                escapeCsvField(studentName),
                escapeCsvField(pickup?.driverName || ''),
                escapeCsvField(pickup?.carModel || ''),
                escapeCsvField(dropoff?.driverName || ''),
                escapeCsvField(dropoff?.carModel || '')
            ].join(','));
        }

        const csvContent = rows.join('\n');

        return {
            success: true,
            eventDate,
            csvContent,
            summary: {
                totalStudents: allStudentIds.size,
                pickupOnly: stats?.pickup?.totalStudents || 0,
                dropoffOnly: stats?.dropoff?.totalStudents || 0,
                both: (stats?.pickup?.totalStudents || 0) + (stats?.dropoff?.totalStudents || 0) - allStudentIds.size
            }
        };

    } catch (error) {
        console.error('Error generating CSV:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to generate CSV');
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
