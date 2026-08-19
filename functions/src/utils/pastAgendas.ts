import * as admin from 'firebase-admin';

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
export function agendaIsPast(
    event: { agenda?: unknown },
    eventDate: string,
    todayKey: string,
): boolean {
    if (typeof event.agenda !== 'string' || event.agenda.trim() === '') return false;
    return eventDate < todayKey;
}

/**
 * Delete the `agenda` field from past events. Returns how many were cleared.
 *
 * NEVER THROWS — it shares the 03:00 slot with the notice sweep and the one that
 * expires ride requests, and clearing old text is the least important thing
 * happening at that hour.
 */
export async function clearPastAgendas(
    db: admin.firestore.Firestore,
    todayKey: string,
): Promise<number> {
    try {
        // Bounded by document id, which IS the date, so this reads only past
        // documents rather than the whole collection. No composite index needed.
        const snapshot = await db.collection('events')
            .where(admin.firestore.FieldPath.documentId(), '<', todayKey)
            .get();

        const stale = snapshot.docs
            .filter(doc => agendaIsPast(doc.data() ?? {}, doc.id, todayKey))
            .slice(0, MAX_PER_RUN);

        for (const doc of stale) {
            // The FIELD, not the document. Deleting the document would strand the
            // attendance subcollection hanging off its date.
            await doc.ref.update({ agenda: admin.firestore.FieldValue.delete() });
        }

        return stale.length;
    } catch (error) {
        console.error('[clearPastAgendas] Error:', error);
        return 0;
    }
}
