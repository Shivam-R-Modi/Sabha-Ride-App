// ============================================
// HTTP FUNCTION: publishNotice
// A manager posts to the notice board.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { writeAuditLog } from '../utils/audit';
import { notifyEveryone } from '../utils/notifications';

/** A long flyer, and nowhere near a payload. Mirrored in firestore.rules. */
const MAX_BODY = 4000;
/** How much of the body a push carries. A notification is a nudge, not the notice. */
const PUSH_EXCERPT = 120;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const publishNotice = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const manager = await assertApprovedManager(db, uid, 'publish a notice');

    // Line breaks are KEPT here, unlike managerBroadcast which collapses them —
    // a notice is rendered as a paragraph block with `whitespace-pre-line`, and
    // the flyer format depends on them. Only trailing whitespace goes.
    const body = String(data?.body ?? '').trim();
    if (!body) {
        throw new functions.https.HttpsError('invalid-argument', 'A message is required');
    }
    if (body.length > MAX_BODY) {
        throw new functions.https.HttpsError(
            'invalid-argument', `Keep it under ${MAX_BODY} characters`);
    }

    const showUntil = data?.showUntil ? String(data.showUntil) : null;
    if (showUntil && !ISO_DATE.test(showUntil)) {
        throw new functions.https.HttpsError('invalid-argument', 'showUntil must be YYYY-MM-DD');
    }
    const eventId = data?.eventId ? String(data.eventId) : null;
    if (eventId && !ISO_DATE.test(eventId)) {
        throw new functions.https.HttpsError('invalid-argument', 'eventId must be YYYY-MM-DD');
    }

    const imagePath = data?.imagePath ? String(data.imagePath) : null;
    const imageUrl = data?.imageUrl ? String(data.imageUrl) : null;
    // A path without a URL cannot be rendered; a URL without a path cannot be
    // deleted, which is how Storage silently fills up. Refuse half a pair.
    if (Boolean(imagePath) !== Boolean(imageUrl)) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'An image needs both its path and its URL');
    }
    // The path must be inside this notice's own folder — otherwise a manager
    // could point a notice at, and later delete, any object in the bucket.
    if (imagePath && (!imagePath.startsWith('notices/') || imagePath.includes('..'))) {
        throw new functions.https.HttpsError('invalid-argument', 'Image path is not a notice image');
    }

    await checkRateLimit(uid, {
        maxRequests: 20, windowMs: 60 * 60 * 1000, functionName: 'publishNotice',
    });

    const auditRef = await writeAuditLog(db, {
        action: 'notice.publish',
        actorUid: uid,
        actorName: String(manager.name ?? 'A manager'),
        targetCollection: 'notices',
        targetDocumentId: 'new',
        summary: `Published a notice: "${body.slice(0, 80)}"`,
        outcome: 'pending',
    });

    const ref = await db.collection('notices').add({
        body,
        imagePath,
        imageUrl,
        showUntil,
        eventId,
        createdAt: new Date().toISOString(),
        createdByUid: uid,
        createdByName: String(manager.name ?? 'A manager'),
    });

    if (auditRef) {
        await auditRef.set(
            { outcome: 'ok', targetDocumentId: ref.id, completedAt: new Date().toISOString() },
            { merge: true },
        );
    }

    // The push is deliberately AFTER the write and outside its own try/catch
    // boundary being fatal: the notice is published either way, and
    // notifyEveryone already swallows its own failures. Routing through it also
    // means a notice cannot dodge the congregation broadcast floor.
    if (data?.push === true) {
        const excerpt = body.length > PUSH_EXCERPT ? `${body.slice(0, PUSH_EXCERPT).trimEnd()}…` : body;
        await notifyEveryone('New notice', excerpt, { type: 'notice', noticeId: ref.id });
    }

    return { success: true, noticeId: ref.id };
});
