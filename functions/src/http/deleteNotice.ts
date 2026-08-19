// ============================================
// HTTP FUNCTION: deleteNotice
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { writeAuditLog } from '../utils/audit';
import { deleteNoticeImage } from '../utils/noticeStorage';

/**
 * Take a notice down, and its image with it.
 *
 * A client cannot do this — `firestore.rules` denies delete on `notices`
 * outright — because deleting the document first loses the only reference to the
 * Storage object and orphans it forever. Image first, then document.
 */
export const deleteNotice = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const noticeId = String(data?.noticeId ?? '');
    if (!noticeId) {
        throw new functions.https.HttpsError('invalid-argument', 'noticeId is required');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const manager = await assertApprovedManager(db, uid, 'remove a notice');

    const ref = db.collection('notices').doc(noticeId);
    const snap = await ref.get();
    if (!snap.exists) {
        // Idempotent: a second tap, or two managers at once, is not an error.
        return { success: true, alreadyGone: true };
    }

    const imageRemoved = await deleteNoticeImage(snap.data()?.imagePath);
    await ref.delete();

    await writeAuditLog(db, {
        action: 'notice.delete',
        actorUid: uid,
        actorName: String(manager.name ?? 'A manager'),
        targetCollection: 'notices',
        targetDocumentId: noticeId,
        summary: `Removed a notice${imageRemoved ? '' : ' (its image could not be deleted)'}`,
        outcome: 'ok',
    });

    return { success: true, alreadyGone: false, imageRemoved };
});
