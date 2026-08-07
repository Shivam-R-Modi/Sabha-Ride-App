"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUDIT_COLLECTION = void 0;
exports.buildAuditRow = buildAuditRow;
exports.writeAuditLog = writeAuditLog;
const tenancy_1 = require("../constants/tenancy");
exports.AUDIT_COLLECTION = 'auditLogs';
function buildAuditRow(entry, now = new Date()) {
    var _a, _b;
    return {
        timestamp: now.toISOString(),
        action: entry.action,
        actorUid: entry.actorUid,
        actorName: entry.actorName || 'Manager',
        targetCollection: entry.targetCollection,
        targetDocumentId: entry.targetDocumentId,
        summary: entry.summary,
        details: (_a = entry.details) !== null && _a !== void 0 ? _a : {},
        outcome: (_b = entry.outcome) !== null && _b !== void 0 ? _b : 'ok',
        cityId: tenancy_1.FOUNDING_CITY_ID,
        locationId: tenancy_1.FOUNDING_LOCATION_ID,
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
async function writeAuditLog(db, entry) {
    try {
        const ref = db.collection(exports.AUDIT_COLLECTION).doc();
        await ref.set(buildAuditRow(entry));
        return ref;
    }
    catch (err) {
        console.error('[audit] Could not record audit row:', err);
        return null;
    }
}
//# sourceMappingURL=audit.js.map