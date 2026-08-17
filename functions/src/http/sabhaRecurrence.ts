// ============================================
// The manager's recurring sabha schedule: read and write the rule.
// ============================================

/**
 * One record, no horizon.
 *
 * `topUpCalendar` used to live here and wrote one `events/{date}` document per
 * occurrence out to a chosen horizon. It is gone. The rule in
 * `settings/sabhaRecurrence` IS the schedule now, and `findCurrentEvent` computes
 * from it — see the long note at the top of utils/recurrence.ts for why that is
 * both simpler and one whole bug class smaller.
 *
 * So this file has one job: validate and store the rule. Nothing is generated,
 * which is why nothing here needs a watermark, an `occupied` set, or a batch.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { writeAuditLog } from '../utils/audit';
import { RecurrenceRule, normaliseRecurrence } from '../utils/recurrence';

export const RECURRENCE_DOC = 'settings/sabhaRecurrence';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Read the rule, already validated.
 *
 * A rule that cannot be understood returns null and schedules nothing — see the
 * note on `normaliseRecurrence` for why guessing is worse than stopping.
 */
export async function readRecurrence(
    db: admin.firestore.Firestore,
): Promise<RecurrenceRule | null> {
    const snap = await db.doc(RECURRENCE_DOC).get();
    return snap.exists ? normaliseRecurrence(snap.data()) : null;
}

/** How the schedule reads on a manager's screen and in an audit row. */
export function describeRule(rule: RecurrenceRule): string {
    if (!rule.enabled) return 'Recurring sabha turned off';
    const days = rule.daysOfWeek.map(d => DAY_NAMES[d]).join(', ');
    return `Every ${days}, ${rule.startTime}–${rule.endTime}`;
}

/**
 * HTTP Callable: a manager sets the recurring pattern.
 *
 * Input: { enabled, daysOfWeek, startTime, endTime }
 * Output: { rule }
 *
 * No `weeksAhead`. There is no horizon any more: the rule repeats until a manager
 * changes it, and a single date is changed by writing an exception for that date
 * rather than by re-generating a window.
 */
export const updateSabhaRecurrence = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();

    // Changing when a whole congregation gathers. Manager only.
    await assertApprovedManager(db, context.auth.uid, 'change the sabha schedule');

    // Validated through the same function the scheduler uses, so a rule the
    // scheduler would refuse cannot be saved — otherwise the manager sees a saved
    // setting that silently schedules nothing.
    const rule = normaliseRecurrence({
        enabled: data?.enabled === true,
        daysOfWeek: data?.daysOfWeek,
        startTime: data?.startTime,
        endTime: data?.endTime,
        venue: data?.venue ?? null,
        agenda: data?.agenda ?? '',
    });

    if (!rule) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Pick at least one day, and an end time later than the start time.',
        );
    }

    const now = new Date();

    await db.doc(RECURRENCE_DOC).set({
        enabled: rule.enabled,
        daysOfWeek: rule.daysOfWeek,
        startTime: rule.startTime,
        endTime: rule.endTime,
        venue: rule.venue,
        agenda: rule.agenda,
        updatedAt: now.toISOString(),
        updatedBy: context.auth.uid,
        // Deleted along with the generator. Removed rather than left behind, so a
        // stale value cannot be read back by anything that has not been updated.
        weeksAhead: admin.firestore.FieldValue.delete(),
        generatedThrough: admin.firestore.FieldValue.delete(),
    }, { merge: true });

    await writeAuditLog(db, {
        action: 'doc.update',
        actorUid: context.auth.uid,
        actorName: 'Manager',
        targetCollection: 'settings',
        targetDocumentId: 'sabhaRecurrence',
        summary: describeRule(rule),
        details: { ...rule },
    });

    return { rule };
});
