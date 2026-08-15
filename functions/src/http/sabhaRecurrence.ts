// ============================================
// The manager's recurring sabha schedule: read, write, and top up.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { writeAuditLog } from '../utils/audit';
import { getTimeZone } from '../utils/settings';
import { EVENTS_COLLECTION } from '../utils/events';
import { zonedDateKey, addDaysToDateKey } from '../utils/time';
import {
    RecurrenceConfig, normaliseRecurrence, datesToGenerate, advanceWatermark,
    MIN_WEEKS_AHEAD, MAX_WEEKS_AHEAD, DEFAULT_WEEKS_AHEAD,
} from '../utils/recurrence';

export const RECURRENCE_DOC = 'settings/sabhaRecurrence';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Read the pattern, already validated.
 *
 * A config that cannot be understood returns null and generates nothing — see the
 * note on `normaliseRecurrence` for why guessing is worse than stopping.
 */
export async function readRecurrence(
    db: admin.firestore.Firestore,
): Promise<RecurrenceConfig | null> {
    const snap = await db.doc(RECURRENCE_DOC).get();
    return snap.exists ? normaliseRecurrence(snap.data()) : null;
}

/**
 * Create whatever the pattern says is missing, and move the watermark.
 *
 * Shared by the daily job and the manager's "Fill the calendar now" button, so the
 * button cannot drift from what the cron actually does — the usual way a manual
 * trigger ends up testing a different code path from the real one.
 *
 * Reads the existing documents across the whole horizon *including cancelled
 * ones*, because a cancelled gathering keeps its document and regenerating over
 * it would both un-cancel it and reject the batch on ALREADY_EXISTS.
 */
export async function topUpCalendar(
    db: admin.firestore.Firestore,
    config: RecurrenceConfig,
    now: Date,
    timeZone: string,
): Promise<string[]> {
    if (!config.enabled) return [];

    const today = zonedDateKey(now, timeZone);
    const horizon = addDaysToDateKey(today, config.weeksAhead * 7);

    const scan = await db.collection(EVENTS_COLLECTION)
        .where(admin.firestore.FieldPath.documentId(), '>=', today)
        .where(admin.firestore.FieldPath.documentId(), '<=', horizon)
        .get();
    const occupied = new Set(scan.docs.map(d => d.id));

    const dates = datesToGenerate(config, now, timeZone, occupied);
    const mark = advanceWatermark(config, now, timeZone);

    // The watermark moves whether or not anything was created. If it only moved
    // on a successful create, a horizon already filled by hand would leave the
    // mark short and those dates would be offered again for ever.
    const batch = db.batch();
    for (const date of dates) {
        batch.create(db.collection(EVENTS_COLLECTION).doc(date), {
            date,
            startTime: config.startTime,
            endTime: config.endTime,
            venue: null,
            status: 'scheduled',
            agenda: '',
            autoCreated: true,
            fromRecurrence: true,
            createdAt: now.toISOString(),
        });
    }
    batch.set(db.doc(RECURRENCE_DOC), { generatedThrough: mark }, { merge: true });

    await batch.commit();
    return dates;
}

/**
 * HTTP Callable: a manager sets the recurring pattern.
 *
 * Input: { enabled, daysOfWeek, startTime, endTime, weeksAhead }
 * Output: { config, created: string[] }
 *
 * Saving fills the calendar immediately rather than waiting for 03:00, so the
 * manager sees the dates appear and can tell the setting worked. A control whose
 * effect is invisible until tomorrow is one nobody trusts.
 */
export const updateSabhaRecurrence = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();

    // Changing when a whole congregation gathers, and creating documents that
    // drive every ride window. Manager only.
    await assertApprovedManager(db, context.auth.uid, 'change the sabha schedule');

    const enabled = data?.enabled === true;

    // Validate through the same function the scheduled job uses. A pattern the
    // job would refuse must not be saveable — otherwise the manager sees a saved
    // setting that silently never generates anything.
    const candidate = normaliseRecurrence({
        enabled,
        daysOfWeek: data?.daysOfWeek,
        startTime: data?.startTime,
        endTime: data?.endTime,
        weeksAhead: data?.weeksAhead ?? DEFAULT_WEEKS_AHEAD,
        // Preserved below from the stored document; never accepted from a client,
        // or a manager could roll it back and resurrect dates they had deleted.
        generatedThrough: null,
    });

    if (!candidate) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Pick at least one day, and an end time later than the start time.',
        );
    }
    if (typeof data?.weeksAhead === 'number'
        && (data.weeksAhead < MIN_WEEKS_AHEAD || data.weeksAhead > MAX_WEEKS_AHEAD)) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            `Fill the calendar between ${MIN_WEEKS_AHEAD} and ${MAX_WEEKS_AHEAD} weeks ahead.`,
        );
    }

    // The watermark is server-owned. Carry the existing one across untouched: it
    // is the only thing keeping a deleted date deleted.
    const existing = await db.doc(RECURRENCE_DOC).get();
    const previousMark = existing.data()?.generatedThrough;
    const config: RecurrenceConfig = {
        ...candidate,
        generatedThrough: typeof previousMark === 'string' ? previousMark : null,
    };

    const now = new Date();
    const timeZone = await getTimeZone();

    await db.doc(RECURRENCE_DOC).set({
        enabled: config.enabled,
        daysOfWeek: config.daysOfWeek,
        startTime: config.startTime,
        endTime: config.endTime,
        weeksAhead: config.weeksAhead,
        generatedThrough: config.generatedThrough,
        updatedAt: now.toISOString(),
        updatedBy: context.auth.uid,
    }, { merge: true });

    const created = await topUpCalendar(db, config, now, timeZone);

    const pattern = config.daysOfWeek.map(d => DAY_NAMES[d]).join(', ');
    await writeAuditLog(db, {
        action: 'doc.update',
        actorUid: context.auth.uid,
        actorName: 'Manager',
        targetCollection: 'settings',
        targetDocumentId: 'sabhaRecurrence',
        summary: config.enabled
            ? `Recurring sabha set to ${pattern} ${config.startTime}–${config.endTime}, `
                + `${config.weeksAhead} weeks ahead (created ${created.length})`
            : 'Recurring sabha turned off',
        details: { ...config, created },
    });

    return { config, created };
});
