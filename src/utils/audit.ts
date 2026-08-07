/**
 * Client mirror of functions/src/utils/audit.ts. Keep the shape identical — the
 * console reads both writers' rows through one query.
 *
 * `timestamp` is the canonical ordering field. A row written without it is
 * excluded from `orderBy('timestamp')` and therefore invisible in the Audit Logs
 * tab, which is exactly how sabha deletions went unrecorded on screen while
 * appearing to be logged.
 *
 * Client-written rows are advisory: a manager who wants no record simply does not
 * call this. That is a real limitation, not an oversight — the fix is a Firestore
 * trigger, and the destructive paths that matter most (user deletion, sabha
 * deletion) already log from the server where it cannot be skipped.
 */

import { addDoc, collection } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { FOUNDING_CITY_ID, FOUNDING_LOCATION_ID } from '../constants/tenancy';

export const AUDIT_COLLECTION = 'auditLogs';

export type AuditAction =
    | 'doc.create'
    | 'doc.update'
    | 'doc.delete'
    | 'user.delete'
    | 'event.delete'
    | 'manager.promote';

export interface AuditEntry {
    action: AuditAction;
    actorUid: string;
    actorName: string;
    targetCollection: string;
    targetDocumentId: string;
    summary: string;
    details?: Record<string, unknown>;
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
        outcome: 'ok' as const,
        cityId: FOUNDING_CITY_ID,
        locationId: FOUNDING_LOCATION_ID,
    };
}

/**
 * Write an audit row. Never throws — losing the log must not fail the edit it
 * describes.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
    try {
        await addDoc(collection(db, AUDIT_COLLECTION), buildAuditRow(entry));
    } catch (err) {
        console.error('[audit] Could not record audit row:', err);
    }
}

export interface DisplayAuditRow {
    action: string;
    actorName: string;
    target: string;
    summary: string;
    timestamp: string | null;
    /** Red for destructive, green for created, blue otherwise. */
    tone: 'destructive' | 'create' | 'neutral';
}

/**
 * Read a row of either shape for display.
 *
 * Three historical shapes exist in production and none can be rewritten — editing
 * audit history is the one migration that would undermine the record it migrates.
 * So the reader is defensive instead:
 *
 *  - the current shape: `actorName`, `targetCollection`, `action: 'doc.update'`
 *  - the old console shape: `managerName`, `collection`, `action: 'UPDATE'`
 *  - the old deleteSabhaEvent shape: `performedBy`, `collectionName`,
 *    `performedAt`, `details` as an object, and no `timestamp` at all
 *
 * The third is why the console query (`orderBy('timestamp')`) silently dropped
 * every sabha deletion. A backfill adds `timestamp` to those rows; this handles
 * any the backfill has not reached, and any written before it ran.
 */
export function normaliseAuditRow(raw: Record<string, any>): DisplayAuditRow {
    const action = String(raw.action ?? 'unknown');
    const timestamp = raw.timestamp ?? raw.performedAt ?? null;

    const summary = raw.summary
        ?? (typeof raw.details === 'string' ? raw.details : '')
        // The old deleteSabhaEvent rows carry only a details object.
        ?? '';

    const lower = action.toLowerCase();
    const tone: DisplayAuditRow['tone'] = lower.includes('delete')
        ? 'destructive'
        : lower.includes('create')
            ? 'create'
            : 'neutral';

    return {
        action,
        actorName: raw.actorName ?? raw.managerName ?? raw.performedBy ?? 'Unknown',
        target: `${raw.targetCollection ?? raw.collection ?? raw.collectionName ?? '?'} / ${
            String(raw.targetDocumentId ?? raw.documentId ?? '?').slice(0, 12)}`,
        summary: summary || (raw.details && typeof raw.details === 'object'
            ? JSON.stringify(raw.details).slice(0, 90)
            : ''),
        timestamp,
        tone,
    };
}
