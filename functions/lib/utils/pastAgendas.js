"use strict";
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
exports.agendaIsPast = agendaIsPast;
exports.clearPastAgendas = clearPastAgendas;
const admin = __importStar(require("firebase-admin"));
/**
 * Clearing the agenda off sabhas that have already happened.
 *
 * The owner's requirement: "that particular week's agenda is set, once that is
 * over the field is deleted". Riders stop SEEING it as soon as the evening rolls
 * over, because `system/rideContext` republishes the next sabha's agenda every
 * minute — this is the durable half, removing the text from the event document
 * so a year of past agendas does not accumulate on records that are never read
 * again.
 *
 * Safe to do, and each reason was checked rather than assumed:
 *
 *  - Nothing reads a past event's agenda. Event queries are bounded
 *    `documentId() >= today` (functions/src/utils/events.ts), so a cleared field
 *    can never be regenerated or read back.
 *  - The attendance CSV does not include it, so history is not altered.
 *  - Only `agenda` is touched. The document itself is the anchor for
 *    `weeklyAttendance/{date}`, and deleting it would strand names, phone numbers
 *    and addresses — the reason `events` is undeletable from the client.
 */
/** Same ceiling as the notice sweep and expireStaleRequests. */
const MAX_PER_RUN = 200;
/**
 * Which past events still carry agenda text.
 *
 * Split out and pure so the date boundary can be tested without a database. The
 * comparison is `YYYY-MM-DD` string ordering, and `todayKey` must already be in
 * the sabha's timezone — an agenda has to survive the whole of its own day, so
 * a UTC key would clear an evening agenda five hours early, during the sabha.
 */
function agendaIsPast(event, eventDate, todayKey) {
    if (typeof event.agenda !== 'string' || event.agenda.trim() === '')
        return false;
    return eventDate < todayKey;
}
/**
 * Delete the `agenda` field from past events. Returns how many were cleared.
 *
 * NEVER THROWS — it shares the 03:00 slot with the notice sweep and the one that
 * expires ride requests, and clearing old text is the least important thing
 * happening at that hour.
 */
async function clearPastAgendas(db, todayKey) {
    try {
        // Bounded by document id, which IS the date, so this reads only past
        // documents rather than the whole collection. No composite index needed.
        const snapshot = await db.collection('events')
            .where(admin.firestore.FieldPath.documentId(), '<', todayKey)
            .get();
        const stale = snapshot.docs
            .filter(doc => { var _a; return agendaIsPast((_a = doc.data()) !== null && _a !== void 0 ? _a : {}, doc.id, todayKey); })
            .slice(0, MAX_PER_RUN);
        for (const doc of stale) {
            // The FIELD, not the document. Deleting the document would strand the
            // attendance subcollection hanging off its date.
            await doc.ref.update({ agenda: admin.firestore.FieldValue.delete() });
        }
        return stale.length;
    }
    catch (error) {
        console.error('[clearPastAgendas] Error:', error);
        return 0;
    }
}
//# sourceMappingURL=pastAgendas.js.map