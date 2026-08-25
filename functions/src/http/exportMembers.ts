// ============================================
// HTTP FUNCTION: exportMembers
// The member directory as a spreadsheet, in one of three scopes.
// ============================================
//
// AIRPORT, SABHA, OR EVERYONE. Airport is whoever has ever asked to be collected;
// sabha is whoever has ever asked for a lift to a gathering; everyone is the whole
// directory. The three exist because the two services have different populations and
// a coordinator wants one of them rather than the union with a column to filter on.
//
// EVERY SCOPE RETURNS NAMES, PHONE NUMBERS AND HOME ADDRESSES, for a congregation
// that includes minors, and the Airport scope adds exact dates of birth. So this
// function carries the full set of guards `generateEventCSV` learned the hard way:
//
//   `assertApprovedManager`, WITH the accountStatus check. That check was once
//   missing from generateEventCSV, and a manager whose account had been rejected
//   could still export the lot — revocation never reached the one function where it
//   mattered most.
//
//   A rate limit, AFTER the authorisation. Authorisation answers "may you export";
//   it cannot answer "why are you exporting for the four-hundredth time tonight". A
//   borrowed manager session is the realistic threat and an unthrottled export turns
//   it into a bulk dump of the community in seconds.
//
//   An audit row, always. This function writes nothing, and is audited anyway: the
//   row is the only record that somebody took a copy of every family's address.

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager, isAirportCoordinatorData } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { writeAuditLog } from '../utils/audit';
import { PICKUPS_COLLECTION, PROFILES_COLLECTION } from '../utils/arrival';

export type ExportScope = 'airport' | 'sabha' | 'all';

const SCOPES: ExportScope[] = ['airport', 'sabha', 'all'];

/** Not a timeout guard so much as a blast-radius one. */
const MAX_ROWS = 2000;

/**
 * RFC 4180 quoting, and it is not optional here.
 *
 * A home address contains commas by definition, and somebody's name may contain a
 * quote. Without this, one address shifts every column after it and a spreadsheet
 * silently pairs the wrong phone number with the wrong person.
 */
function csv(field: unknown): string {
    const value = field === null || field === undefined ? '' : String(field);
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const row = (cells: unknown[]) => cells.map(csv).join(',');

export const exportMembers = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const manager = await assertApprovedManager(db, uid, 'export the member directory');

    // Bound to a real type before it is used to index anything. `data` is `any`, and
    // narrowing `any` with `!==` leaves it `any` — the shape that failed a deploy once.
    const rawScope: string = String(data?.scope ?? '').trim();
    const scope = SCOPES.find(s => s === rawScope);
    if (!scope) {
        throw new functions.https.HttpsError(
            'invalid-argument', `Scope must be one of: ${SCOPES.join(', ')}`);
    }

    // The Airport scope reads `airportProfiles`, which carries exact dates of birth.
    // That collection is coordinator-only in firestore.rules, and this callable runs
    // on the Admin SDK and bypasses those rules — so the same gate has to be applied
    // HERE by hand or the export would be a way round it.
    if (scope === 'airport' && !isAirportCoordinatorData(manager)) {
        throw new functions.https.HttpsError(
            'permission-denied', 'Only airport coordinators can export airport records.');
    }

    await checkRateLimit(uid, {
        maxRequests: 20, windowMs: 60 * 60 * 1000, functionName: 'exportMembers',
    });

    const rows: string[] = [];
    let truncated = false;

    if (scope === 'airport') {
        rows.push(row([
            'Name', 'Preferred name', 'Date of birth', 'Email', 'Phone', 'Other phone',
            'WhatsApp on', 'University', 'Family contact', 'Family relationship',
            'Family phone', 'Referred by', 'First asked',
        ]));

        const profiles = await db.collection(PROFILES_COLLECTION).limit(MAX_ROWS + 1).get();
        truncated = profiles.size > MAX_ROWS;

        for (const doc of profiles.docs.slice(0, MAX_ROWS)) {
            const p = doc.data();
            rows.push(row([
                p.fullName, p.preferredName, p.dateOfBirth, p.email, p.phone, p.altPhone,
                p.whatsappOn, p.university,
                p.familyContact?.name, p.familyContact?.relationship, p.familyContact?.phone,
                p.referredByName, p.createdAt,
            ]));
        }
    } else {
        // Which uids belong to each service. Read as whole small collections rather
        // than per-user queries: this runs once, by hand, for one congregation.
        const [users, pickups, rides] = await Promise.all([
            db.collection('users').limit(MAX_ROWS + 1).get(),
            db.collection(PICKUPS_COLLECTION).get(),
            db.collection('rides').get(),
        ]);

        const airportUids = new Set(pickups.docs.map(d => String(d.data().requesterUid ?? '')));
        const sabhaUids = new Set(rides.docs.map(d => String(d.data().studentId ?? '')));

        rows.push(row([
            'Name', 'Email', 'Phone', 'Address', 'Role', 'Account status',
            'Uses Sabha Seva', 'Uses Airport Seva',
        ]));

        truncated = users.size > MAX_ROWS;

        for (const doc of users.docs.slice(0, MAX_ROWS)) {
            const u = doc.data();
            const usesSabha = sabhaUids.has(doc.id);
            const usesAirport = airportUids.has(doc.id);

            // 'sabha' means the people who use that service, not "everyone minus
            // airport". Somebody who does both belongs in both lists.
            if (scope === 'sabha' && !usesSabha) continue;

            rows.push(row([
                u.name, u.email, u.phone, u.address, u.role, u.accountStatus,
                usesSabha ? 'yes' : 'no', usesAirport ? 'yes' : 'no',
            ]));
        }
    }

    await writeAuditLog(db, {
        action: 'members.export',
        actorUid: uid,
        actorName: String(manager.name ?? 'A manager'),
        targetCollection: scope === 'airport' ? PROFILES_COLLECTION : 'users',
        targetDocumentId: scope,
        summary: `Exported the ${scope} member list — ${rows.length - 1} rows`,
        details: { scope, rows: rows.length - 1, truncated },
    });

    return {
        success: true,
        scope,
        // `\r\n`, because Excel on Windows treats a bare \n as one long line.
        csv: rows.join('\r\n'),
        rowCount: rows.length - 1,
        // Said out loud rather than silently handing back a short file. A truncated
        // export that looks complete is how somebody concludes half the congregation
        // has left.
        truncated,
    };
});
