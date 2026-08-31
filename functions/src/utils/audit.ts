/**
 * One shape for every audit row.
 *
 * There were two, and the split was not cosmetic. The console reads
 * `orderBy('timestamp', 'desc')`, and Firestore **excludes documents that lack the
 * orderBy field entirely** — so `deleteSabhaEvent`, which wrote `performedAt`,
 * never appeared in the Audit Logs tab. The single most destructive action in the
 * app was the one action the audit screen structurally could not show. A screen
 * that looks like an audit trail and silently omits rows is worse than no screen.
 *
 * `timestamp` is kept as the canonical field name rather than renamed to something
 * tidier, because it is what the query orders by, what DatabaseConsole renders and
 * what the future auditLogs(cityId, timestamp) index needs. Renaming would cost a
 * query, an index and a UI change and buy nothing.
 *
 * `summary` (a human line) sits beside `details` (a machine-readable object) so the
 * schema can carry structure without the renderer having to understand it.
 */

import * as admin from 'firebase-admin';
import { FOUNDING_CITY_ID, FOUNDING_LOCATION_ID } from '../constants/tenancy';

export const AUDIT_COLLECTION = 'auditLogs';

/**
 * Dotted `subject.verb`, so rows group by what was acted on.
 *
 * The old client writer used 'CREATE' | 'UPDATE' | 'DELETE' — which said what kind
 * of write happened but not what it meant. `event.delete` and `doc.delete` were
 * indistinguishable, and only one of them cancels people's rides.
 */
export type AuditAction =
    | 'doc.create'
    | 'doc.update'
    | 'doc.delete'
    | 'user.delete'
    | 'event.delete'
    | 'manager.promote'
    // A Bhulku became a Sarthi or the other way round, in place, on the one user
    // document. Its own action rather than a bare 'doc.update' because the row is
    // the ONLY record that a person's access changed — the four role fields it
    // writes carry no history of their own, and this app holds children's names,
    // phone numbers and home addresses.
    | 'role.change'
    | 'broadcast.send'
    | 'notice.publish'
    | 'notice.delete'
    // ---- Airport Seva ----
    //
    // Their own actions rather than bare 'doc.*' rows for the reason given above:
    // 'airport.claim' and 'airport.cancel' both write one document, and only one of
    // them leaves somebody standing in an arrivals hall. These rows are also the
    // only record that a Sarthi ever held a traveller's date of birth and home
    // address, which is more than a ride roster carries.
    | 'airport.request'
    | 'airport.claim'
    | 'airport.release'
    | 'airport.update'
    | 'airport.cancel'
    // A manager was made, or unmade, an airport coordinator. The direction is in
    // `details.granted`. One action rather than two because the row is read as
    // prose and "granted: false" is not ambiguous.
    | 'airport.coordinator'
    // Somebody downloaded the member directory. Every scope of it returns names,
    // phone numbers and home addresses, so the export is audited even though it
    // writes nothing — a revoked manager quietly exporting every family is a defect
    // this repo has already had once.
    | 'members.export'
    // A manager changed which notifications the app sends, or a scheduled reminder went
    // out. Their own actions rather than 'doc.update' for the reason the whole union
    // exists: `settings.notifications` is the row that explains why a notification
    // people expected never arrived, and `reminder.send` is the row that explains why
    // a whole congregation's phones buzzed at 10am.
    | 'settings.notifications'
    | 'reminder.send';

export type AuditOutcome = 'pending' | 'ok' | 'failed';

export interface AuditEntry {
    action: AuditAction;
    actorUid: string;
    actorName: string;
    targetCollection: string;
    targetDocumentId: string;
    /** The line a human reads in the console. */
    summary: string;
    details?: Record<string, unknown>;
    outcome?: AuditOutcome;
}

export function buildAuditRow(entry: AuditEntry, now = new Date()) {
    return {
        timestamp: now.toISOString(),
        action: entry.action,
        actorUid: entry.actorUid,
        actorName: entry.actorName || 'Manager',
        targetCollection: entry.targetCollection,
        targetDocumentId: entry.targetDocumentId,
        summary: entry.summary,
        details: entry.details ?? {},
        outcome: entry.outcome ?? 'ok',
        cityId: FOUNDING_CITY_ID,
        locationId: FOUNDING_LOCATION_ID,
    };
}

/**
 * Write an audit row. Never throws.
 *
 * Losing the log must not fail the action that was being logged — a delete that
 * half-happened because its own audit row was rejected would be worse than an
 * unlogged delete. The trade-off is recorded here rather than left implicit,
 * because it is also the reason a client-written log can only ever be advisory:
 * a manager who wants no record simply does not call this. Server-side triggers
 * are the real answer and are out of scope for now; the most destructive paths
 * (adminDeleteUser, deleteSabhaEvent) already log from the server.
 */
export async function writeAuditLog(
    db: admin.firestore.Firestore,
    entry: AuditEntry,
): Promise<admin.firestore.DocumentReference | null> {
    try {
        const ref = db.collection(AUDIT_COLLECTION).doc();
        await ref.set(buildAuditRow(entry));
        return ref;
    } catch (err) {
        console.error('[audit] Could not record audit row:', err);
        return null;
    }
}
