// ============================================
// HTTP FUNCTION: generateEventCSV
// Generates CSV export for manager with all ride requests
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { locationsOrFoundingFallback } from '../utils/settings';
import { eventKeyFromRide } from '../utils/events';
import { locationOfRide, eventIdFor } from '../utils/locations';

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

    const { eventDate, locationId } = data || {};

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

        /**
         * WHICH SABHA LOCATION, and refused rather than ignored if it is not a real one.
         *
         * Absent means EVERY hall, which is what this has always done and is a
         * legitimate thing for a manager to want. Named, it must name a hall that
         * exists and is open — a typo would otherwise produce an empty export that
         * looks like "nobody is waiting", which for a PII export is the wrong kind of
         * quiet.
         */
        const openHalls = await locationsOrFoundingFallback(db);
        const scopeHall = typeof locationId === 'string' && locationId
            ? openHalls.find(h => h.id === locationId)
            : null;
        if (typeof locationId === 'string' && locationId && !scopeHall) {
            throw new functions.https.HttpsError(
                'invalid-argument', 'That sabha location is not running.',
            );
        }

        const rows: string[] = [];

        /**
         * The scope is IN THE FILE, not only in the filename.
         *
         * A spreadsheet of children's names, phone numbers and home addresses that does
         * not say which evening and which hall it covers is a document nobody can
         * safely file or delete later. Two halls make that worse: two exports from the
         * same evening are otherwise indistinguishable.
         */
        rows.push(`# Sabha ${targetDate} — ${scopeHall ? scopeHall.name : 'all locations'}`);
        rows.push('Bhulku Name,Phone,Pickup Address,Status,Request Date');

        // Maximum rows to prevent timeout (can be increased if needed)
        const MAX_ROWS = 500;
        let hitLimit = false;

        /**
         * ONE `where`, and the scoping is done in memory. Adding `eventDate` or
         * `locationId` beside `status` would need a composite index this project does
         * not have, and — worse — an equality filter on a field some documents lack
         * returns SILENTLY EMPTY. An empty PII export reads as "nobody is waiting".
         */
        const pendingQuery = db.collection('rides')
            .where('status', '==', 'requested')
            .limit(MAX_ROWS);

        const pendingSnapshot = await pendingQuery.get();

        /**
         * DISPATCH REFUSES THE AMBIGUOUS; AN EXPORT SHOWS IT AND SAYS SO.
         *
         * That distinction is the whole shape of this filter and it is deliberate. In
         * `rejectionFor`, a request that names no gathering or no hall is refused,
         * because including it would send a car somewhere. Here, dropping it would make
         * a person disappear from the one document a manager uses to check who is
         * waiting — so an unkeyed or unlocated request is INCLUDED, with the gap named
         * in its Status cell.
         *
         * The alternative — silently narrowing a PII export — is how somebody gets
         * left off a list and nobody finds out.
         */
        const pendingRequests: any[] = [];
        for (const doc of pendingSnapshot.docs) {
            const d: any = { id: doc.id, ...doc.data() };
            const key = eventKeyFromRide(d);
            const hall = locationOfRide(d);

            if (key !== null && key !== targetDate) continue;
            if (scopeHall && hall !== null && hall !== scopeHall.id) continue;

            const gaps: string[] = [];
            if (key === null) gaps.push('no sabha date');
            if (hall === null) gaps.push('no location');
            d.__scopeNote = gaps.length ? ` (${gaps.join(', ')})` : '';
            pendingRequests.push(d);
        }

        if (pendingSnapshot.size >= MAX_ROWS) {
            hitLimit = true;
        }

        const completedPickups = new Map();
        const completedDropoffs = new Map();

        /**
         * Completed rides, from the statistics document of EACH HALL IN SCOPE.
         *
         * Statistics are keyed like a gathering — the founding hall on the bare date,
         * every other hall suffixed — so a single read of `statistics/{date}` would
         * silently return only the founding hall's completed rides. On a two-hall
         * evening that is a manager's report quietly missing half the riders who
         * travelled, which is the wrong direction for a document used to check that
         * everybody got home.
         *
         * One document read per hall in scope: one when a hall is named, two or three
         * when it is not.
         */
        const statsScope = scopeHall ? [scopeHall] : openHalls;
        for (const hall of statsScope) {
            const statsId = eventIdFor(targetDate, hall.id) ?? targetDate;
            const statsDoc = await db.collection('statistics').doc(statsId).get();
            if (!statsDoc.exists) continue;
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
                    `Pending Request${request.__scopeNote ?? ''}`,
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
