// ============================================
// HTTP FUNCTION: updateNotificationSettings
// A manager decides which notifications the app sends, and how often.
// ============================================
//
// A CALLABLE RATHER THAN A CLIENT WRITE, even though `settings/{settingId}` already
// allows `create, update: if isManager()` and the panel could simply write the
// document. Three things the rule cannot do:
//
//   1. VALIDATE THE SHAPE. The rule checks who is writing, not what. A hand-edit, an
//      old client, or a bug could put `alertBands: ['soon']` in there. `resolveX`
//      fails open so nothing would break, but the manager's panel would then show a
//      configuration that is not the one being enforced.
//   2. WRITE THE AUDIT ROW. `auditLogs` is not client-writable, deliberately — the
//      whole point of the collection is that the subject of a row cannot author it.
//      Switching off "Sarthi has arrived" is exactly the change somebody will need
//      explained three months later.
//   3. DROP THE SERVER'S CACHE. `getNotificationSettings` holds the config for a
//      minute per instance. Clearing it here makes THIS instance immediate; the rest
//      follow within the minute, which is what the panel tells the manager.
//
// THE PAYLOAD IS A WHOLE CONFIGURATION, not a patch. A patch would need merge
// semantics for a nested `enabled` map, and the panel already holds every value on
// screen — sending all of it means the document can never drift into a half-state
// where one field was written and another silently was not.

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { writeAuditLog } from '../utils/audit';
import {
    NOTIFICATION_KEYS,
    resolveNotificationSettings,
    specFor,
} from '../constants/notifications';
import {
    NOTIFICATION_SETTINGS_DOC,
    clearNotificationSettingsCache,
    getNotificationSettings,
} from '../utils/notificationSettings';

export const updateNotificationSettings = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const manager = await assertApprovedManager(db, uid, 'change notification settings');

    await checkRateLimit(uid, {
        maxRequests: 30, windowMs: 60 * 60 * 1000, functionName: 'updateNotificationSettings',
    });

    // NORMALISED THROUGH THE SHARED RESOLVER, so what is stored is exactly what the
    // server would have made of it anyway. Anything unrecognised is dropped rather
    // than rejected: the panel cannot send a band that is not in the choice list, so
    // a stray value is a bug or an old client, and refusing the whole save over it
    // would lose the legitimate changes alongside it.
    const next = resolveNotificationSettings(data);

    // What actually changed, for the audit line. Read BEFORE the write, and read
    // through the same resolver so a document that predates a new key compares as
    // "was on" rather than as a change nobody made.
    const before = await getNotificationSettings(db);
    const muted = NOTIFICATION_KEYS.filter(k => before.enabled[k] && !next.enabled[k]);
    const unmuted = NOTIFICATION_KEYS.filter(k => !before.enabled[k] && next.enabled[k]);

    await db.doc(NOTIFICATION_SETTINGS_DOC).set({
        enabled: next.enabled,
        alertBands: next.alertBands,
        nudgeCooldownSec: next.nudgeCooldownSec,
        reminderHour: next.reminderHour,
        reminderCadence: next.reminderCadence,
        updatedAt: new Date().toISOString(),
        updatedBy: uid,
    }, { merge: true });

    clearNotificationSettingsCache();

    // NAMED, not counted. "2 notifications switched off" is useless three months
    // later; "switched off Sarthi has arrived" is the whole answer.
    const label = (key: string) => specFor(key)?.label ?? key;
    const parts = [
        muted.length ? `switched off ${muted.map(label).join(', ')}` : '',
        unmuted.length ? `switched on ${unmuted.map(label).join(', ')}` : '',
    ].filter(Boolean);

    await writeAuditLog(db, {
        action: 'settings.notifications',
        actorUid: uid,
        actorName: String(manager.name ?? 'Manager'),
        targetCollection: 'settings',
        targetDocumentId: 'notifications',
        summary: parts.length
            ? `Notification settings: ${parts.join('; ')}.`
            : 'Notification settings updated (frequency only).',
        details: {
            muted, unmuted,
            alertBands: next.alertBands,
            nudgeCooldownSec: next.nudgeCooldownSec,
            reminderHour: next.reminderHour,
            reminderCadence: next.reminderCadence,
        },
    });

    return { success: true, settings: next };
});
